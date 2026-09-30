import { NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getConnectionById } from "@/lib/connections";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { SYNCABLE_MODELS } from "@/lib/connectors/odoo";
import {
  coerceGoogleDriveConnectionMetadata,
  getDriveItemMetadata,
  getGoogleDriveRootSelection,
  isDriveItemWithinRoot,
  type GoogleDriveWatchedFolder,
} from "@/lib/connectors/google-drive";
import { getGoogleDriveAccessToken } from "@/lib/connectors/google-drive-auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { companyId } = await getSessionCompanyContext();
    const { id: connectionId } = await params;

    const conn = await getConnectionById(connectionId, companyId);
    if (!conn) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 },
      );
    }

    const body = await request.json();
    if (conn.provider === "odoo") {
      const { syncModels } = body as { syncModels: string[] };

      const validKeys = Object.keys(SYNCABLE_MODELS);
      const invalid = (syncModels || []).filter(
        (m: string) => !validKeys.includes(m),
      );
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Invalid sync models: ${invalid.join(", ")}` },
          { status: 400 },
        );
      }

      const existingMeta = (conn.metadata as Record<string, unknown>) || {};

      await db
        .update(connections)
        .set({
          metadata: { ...existingMeta, syncModels: syncModels || [] },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(connections.id, connectionId),
            eq(connections.companyId, companyId),
          ),
        );

      return NextResponse.json({ syncModels: syncModels || [] });
    }

    if (conn.provider === "google_drive") {
      const {
        watchedFolders,
        connectionLabel,
        rootFolderId,
        rootDriveId,
        rootBrowseMode,
        rootPath,
      } = body as {
        watchedFolders?: GoogleDriveWatchedFolder[];
        connectionLabel?: string | null;
        rootFolderId?: string | null;
        rootDriveId?: string | null;
        rootBrowseMode?: "sharedWithMe" | null;
        rootPath?: string | null;
      };
      const hasWatchedFoldersField = Object.prototype.hasOwnProperty.call(
        body,
        "watchedFolders"
      );

      if (hasWatchedFoldersField && !Array.isArray(watchedFolders)) {
        return NextResponse.json(
          { error: "watchedFolders must be an array" },
          { status: 400 }
        );
      }

      const existingMeta = coerceGoogleDriveConnectionMetadata(conn.metadata);
      const rawNextMeta = {
        ...existingMeta,
        connectionLabel,
        rootFolderId,
        rootDriveId,
        rootBrowseMode,
        rootPath,
        watchedFolders: hasWatchedFoldersField
          ? watchedFolders
          : existingMeta.watchedFolders,
      };
      const nextMeta = coerceGoogleDriveConnectionMetadata(rawNextMeta);
      const accessToken = await getGoogleDriveAccessToken(companyId, {
        connectionId,
      });
      const root = getGoogleDriveRootSelection(nextMeta);

      if (!root && nextMeta.watchedFolders.length > 0) {
        return NextResponse.json(
          {
            error:
              "Select a company root folder before enabling watched Google Drive folders.",
          },
          { status: 400 }
        );
      }

      if (root) {
        if (root.isSharedDriveRoot && !root.driveId) {
          return NextResponse.json(
            { error: "Shared Drive roots must include rootDriveId." },
            { status: 400 }
          );
        }

        if (!root.isSharedDriveRoot) {
          const metadata = await getDriveItemMetadata(accessToken, root.folderId);
          if (metadata.mimeType !== "application/vnd.google-apps.folder") {
            return NextResponse.json(
              { error: "Google Drive root must be a folder." },
              { status: 400 }
            );
          }
        }

        for (const folder of nextMeta.watchedFolders) {
          const allowed = await isDriveItemWithinRoot(
            accessToken,
            folder.folderId,
            root
          );
          if (!allowed) {
            return NextResponse.json(
              {
                error:
                  "Watched folders must stay within the configured company root folder.",
              },
              { status: 400 }
            );
          }
        }
      }

      await db
        .update(connections)
        .set({
          metadata: nextMeta as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(connections.id, connectionId),
            eq(connections.companyId, companyId),
          ),
        );

      return NextResponse.json({
        connectionLabel: nextMeta.connectionLabel,
        rootFolderId: nextMeta.rootFolderId,
        rootDriveId: nextMeta.rootDriveId,
        rootBrowseMode: nextMeta.rootBrowseMode,
        rootPath: nextMeta.rootPath,
        watchedFolders: nextMeta.watchedFolders,
        autoImportFrequency: nextMeta.autoImportFrequency,
      });
    }

    return NextResponse.json(
      { error: "Provider does not support config updates" },
      { status: 400 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
