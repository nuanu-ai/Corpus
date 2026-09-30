import { and, desc, eq, sql } from "drizzle-orm";

import { getConnectionCredentials } from "@/lib/connections";
import {
  coerceGoogleDriveConnectionMetadata,
  type GoogleDriveWatchedFolder,
} from "@/lib/connectors/google-drive";
import { queueGoogleDriveImportSelection } from "@/lib/connectors/google-drive-import";
import { getGoogleDriveAccessToken } from "@/lib/connectors/google-drive-auth";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest";

const AUTO_IMPORT_MAX_FILES = 1000;

async function markGoogleDriveSyncState(input: {
  connectionId: string;
  companyId: string;
  metadata?: Record<string, unknown>;
  lastError?: string | null;
  lastSyncAt?: Date;
  incrementErrorCount?: boolean;
}) {
  const values: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.metadata !== undefined) values.metadata = input.metadata;
  if (input.lastError !== undefined) values.lastError = input.lastError;
  if (input.lastSyncAt !== undefined) values.lastSyncAt = input.lastSyncAt;
  if (input.incrementErrorCount) {
    values.errorCount = sql`${connections.errorCount} + 1`;
  }

  await db
    .update(connections)
    .set(values)
    .where(
      and(
        eq(connections.id, input.connectionId),
        eq(connections.companyId, input.companyId)
      )
    );
}

function enabledWatchedFolders(watchedFolders: GoogleDriveWatchedFolder[]) {
  return watchedFolders.filter((folder) => folder.enabled !== false);
}

function folderModifiedSince(
  folder: GoogleDriveWatchedFolder,
  lastSuccessfulRunAt: string | null
): string | undefined {
  if (!lastSuccessfulRunAt) return undefined;

  if (!folder.watchCreatedAt) {
    return lastSuccessfulRunAt;
  }

  const watchCreatedAt = Date.parse(folder.watchCreatedAt);
  const lastRunAt = Date.parse(lastSuccessfulRunAt);
  if (!Number.isFinite(watchCreatedAt) || !Number.isFinite(lastRunAt)) {
    return lastSuccessfulRunAt;
  }

  return watchCreatedAt > lastRunAt ? undefined : lastSuccessfulRunAt;
}

export const googleDriveWatchedFolderSync = inngest.createFunction(
  {
    id: "google-drive-watched-folder-sync",
    concurrency: [{ key: "event.data.connectionId", limit: 1 }],
  },
  [
    { event: "connection/google_drive.connected" },
    { event: "gdrive/sync.requested" },
  ],
  async ({ event, step }) => {
    const { companyId, connectionId } = event.data as {
      companyId: string;
      connectionId: string;
    };

    const connection = await step.run("load-google-drive-connection", async () => {
      const result = await getConnectionCredentials(connectionId, companyId);
      if (!result) {
        throw new Error(`Connection ${connectionId} not found`);
      }
      if (result.provider !== "google_drive") {
        throw new Error(`Connection ${connectionId} is not Google Drive`);
      }
      return result;
    });

    const metadata = coerceGoogleDriveConnectionMetadata(connection.metadata);
    const watchedFolders = enabledWatchedFolders(metadata.watchedFolders);
    const now = new Date();
    const lastSuccessfulRunAt = metadata.autoImportLastRunAt ?? null;

    if (watchedFolders.length === 0) {
      await step.run("mark-gdrive-sync-noop", async () => {
        await markGoogleDriveSyncState({
          connectionId,
          companyId,
          lastSyncAt: now,
          lastError: null,
          metadata: {
            ...metadata,
            autoImportLastRunAt: now.toISOString(),
            autoImportLastQueued: 0,
            autoImportLastSkipped: 0,
            autoImportLastError: null,
          },
        });
      });

      return { connectionId, companyId, watchedFolders: 0, queued: 0, skipped: 0 };
    }

    let result: Awaited<ReturnType<typeof queueGoogleDriveImportSelection>>;

    try {
      const accessToken = await step.run("get-google-drive-access-token", async () =>
        getGoogleDriveAccessToken(companyId, { connectionId })
      );

      result = await step.run("queue-watched-google-drive-files", async () =>
        queueGoogleDriveImportSelection({
          companyId,
          accessToken,
          folderSelections: watchedFolders.map((folder) => ({
            folderId: folder.folderId,
            driveId: folder.driveId,
            modifiedSince: folderModifiedSince(folder, lastSuccessfulRunAt),
            path: folder.path,
          })),
          maxImportFiles: AUTO_IMPORT_MAX_FILES,
          connectionId,
          ingressSource: "google_drive_watch",
          rootPath: metadata.rootPath,
          connectionLabel: metadata.connectionLabel,
          // One oversize folder must not block syncing the rest.
          onFolderListFailure: "skip",
        })
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Google Drive auto-import failed";

      await step.run("mark-gdrive-sync-failure", async () => {
        await markGoogleDriveSyncState({
          connectionId,
          companyId,
          lastError: message,
          incrementErrorCount: true,
          metadata: {
            ...metadata,
            autoImportLastError: message,
          },
        });
      });

      throw error;
    }

    const folderErrors = result.folderErrors ?? [];
    const folderErrorSummary =
      folderErrors.length > 0
        ? `Skipped ${folderErrors.length} folder(s): ${folderErrors
            .map((e) => `${e.path ?? e.folderId}: ${e.error}`)
            .join("; ")
            .slice(0, 500)}`
        : null;

    await step.run("mark-gdrive-sync-success", async () => {
      await markGoogleDriveSyncState({
        connectionId,
        companyId,
        lastSyncAt: now,
        lastError: folderErrorSummary,
        metadata: {
          ...metadata,
          autoImportLastRunAt: now.toISOString(),
          autoImportLastQueued: result.queued,
          autoImportLastSkipped: result.skipped,
          autoImportLastError: folderErrorSummary,
          autoImportFolderErrors: folderErrors.length > 0 ? folderErrors : undefined,
        },
      });
    });

    return {
      connectionId,
      companyId,
      watchedFolders: watchedFolders.length,
      queued: result.queued,
      skipped: result.skipped,
      total: result.total,
      folderErrors: folderErrors.length,
    };
  }
);

export const googleDriveWatchedFolderPoll = inngest.createFunction(
  { id: "google-drive-watched-folder-poll" },
  { cron: "0 2 * * *" },
  async ({ step }) => {
    const activeConnections = await step.run("list-active-google-drive-connections", async () =>
      db
        .select({
          id: connections.id,
          companyId: connections.companyId,
          metadata: connections.metadata,
        })
        .from(connections)
        .where(
          and(
            eq(connections.provider, "google_drive"),
            eq(connections.status, "active")
          )
        )
        .orderBy(desc(connections.updatedAt), desc(connections.createdAt))
    );

    const syncTargets = activeConnections.filter((connection) => {
      const metadata = coerceGoogleDriveConnectionMetadata(connection.metadata);
      return enabledWatchedFolders(metadata.watchedFolders).length > 0;
    });

    if (syncTargets.length === 0) {
      return { triggered: 0 };
    }

    await step.sendEvent(
      "trigger-google-drive-watched-folder-syncs",
      syncTargets.map((connection) => ({
        name: "gdrive/sync.requested" as const,
        data: {
          companyId: connection.companyId,
          connectionId: connection.id,
        },
      }))
    );

    return { triggered: syncTargets.length };
  }
);
