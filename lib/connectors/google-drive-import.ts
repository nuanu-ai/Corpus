import { randomUUID } from "crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { inferFileType } from "@/lib/documents";
import { db } from "@/lib/db";
import { documents, rawEvents } from "@/lib/db/schema";
import { enqueueOutboxEvent } from "@/lib/outbox";

import { listFolderFilesRecursive } from "./google-drive";

type GoogleDriveImportDbExecutor = Pick<typeof db, "insert" | "update">;

export interface GoogleDriveImportFileRequest {
  fileId: string;
  fileName: string;
  mimeType: string;
  modifiedTime?: string;
  version?: string;
  sourcePath?: string;
  rootPath?: string;
  connectionLabel?: string;
}

export interface GoogleDriveImportFolderSelection {
  folderId: string;
  driveId?: string;
  modifiedSince?: string;
  path?: string;
}

export type GoogleDriveImportResultStatus = "queued" | "error" | "skipped";

export interface GoogleDriveImportFolderError {
  folderId: string;
  path?: string;
  error: string;
}

export interface GoogleDriveImportSelectionResult {
  queued: number;
  skipped: number;
  total: number;
  results: Array<{
    fileId: string;
    fileName: string;
    status: GoogleDriveImportResultStatus;
    error?: string;
  }>;
  folderErrors?: GoogleDriveImportFolderError[];
}

interface ExistingGoogleDriveImportState {
  rawEventId: string;
  documentId: string | null;
  documentStatus: string | null;
  idempotencyKey: string;
  connectionId: string | null;
  driveModifiedTime: string | null;
  driveVersionToken: string | null;
}

function rawEventPayloadText(key: string) {
  return sql<string | null>`${rawEvents.rawPayload}->>${key}`;
}

type GoogleDriveImportDecision =
  | { action: "create" }
  | { action: "reuse"; documentId: string }
  | { action: "skip" };

export function shouldReuseExistingGoogleDriveRawEvent(
  exactVersionImport?: ExistingGoogleDriveImportState | null
): boolean {
  return !!(
    exactVersionImport &&
    (!exactVersionImport.documentId ||
      exactVersionImport.documentStatus === "deleted")
  );
}

function normalizeDriveTimestamp(value?: string | null): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function buildGoogleDriveRevisionToken(
  file: Pick<GoogleDriveImportFileRequest, "modifiedTime" | "version">
): string | null {
  if (typeof file.version === "string" && file.version.trim().length > 0) {
    return `v:${file.version.trim()}`;
  }

  const modifiedTime = normalizeDriveTimestamp(file.modifiedTime);
  if (modifiedTime) {
    return `m:${modifiedTime}`;
  }

  return null;
}

export function buildGoogleDriveImportIdempotencyKey(
  file: Pick<GoogleDriveImportFileRequest, "fileId" | "modifiedTime" | "version">
): string {
  const revisionToken = buildGoogleDriveRevisionToken(file);
  if (!revisionToken) {
    return `gdrive_import:${file.fileId}`;
  }
  return `gdrive_import:${file.fileId}:${revisionToken}`;
}

export function isGoogleDriveFileModifiedAfter(
  file: Pick<GoogleDriveImportFileRequest, "modifiedTime">,
  modifiedSince?: string | null
): boolean {
  if (!modifiedSince) return true;

  const modifiedAt = normalizeDriveTimestamp(file.modifiedTime);
  const threshold = normalizeDriveTimestamp(modifiedSince);

  if (!modifiedAt || !threshold) return true;
  return Date.parse(modifiedAt) > Date.parse(threshold);
}

export function decideGoogleDriveImportAction(input: {
  exactVersionImport?: ExistingGoogleDriveImportState | null;
  latestImport?: ExistingGoogleDriveImportState | null;
}): GoogleDriveImportDecision {
  const exactVersionImport = input.exactVersionImport ?? null;
  if (exactVersionImport) {
    if (!exactVersionImport.documentId) {
      return { action: "create" };
    }
    if (
      exactVersionImport.documentStatus === "failed" ||
      exactVersionImport.documentStatus === "deleted"
    ) {
      return { action: "reuse", documentId: exactVersionImport.documentId };
    }
    return { action: "skip" };
  }

  const latestImport = input.latestImport ?? null;
  if (!latestImport?.documentId) {
    return { action: "create" };
  }

  if (latestImport.documentStatus === "deleted") {
    return { action: "reuse", documentId: latestImport.documentId };
  }

  if (latestImport.documentStatus === "processing") {
    return { action: "create" };
  }

  return { action: "reuse", documentId: latestImport.documentId };
}

async function findGoogleDriveImportStateByIdempotencyKey(input: {
  companyId: string;
  idempotencyKey: string;
}): Promise<ExistingGoogleDriveImportState | null> {
  const [row] = await db
    .select({
      rawEventId: rawEvents.id,
      documentId: rawEvents.sourceEventId,
      idempotencyKey: rawEvents.idempotencyKey,
      connectionId: rawEvents.connectionId,
      driveModifiedTime: rawEventPayloadText("driveModifiedTime"),
      driveVersionToken: rawEventPayloadText("driveVersionToken"),
      documentStatus: documents.status,
    })
    .from(rawEvents)
    .leftJoin(
      documents,
      and(
        sql`${documents.id}::text = ${rawEvents.sourceEventId}`,
        eq(documents.companyId, rawEvents.companyId)
      )
    )
    .where(
      and(
        eq(rawEvents.companyId, input.companyId),
        eq(rawEvents.idempotencyKey, input.idempotencyKey)
      )
    )
    .orderBy(desc(rawEvents.receivedAt))
    .limit(1);

  return row ?? null;
}

async function findLatestGoogleDriveImportStateByFileId(input: {
  companyId: string;
  fileId: string;
}): Promise<ExistingGoogleDriveImportState | null> {
  const [row] = await db
    .select({
      rawEventId: rawEvents.id,
      documentId: rawEvents.sourceEventId,
      idempotencyKey: rawEvents.idempotencyKey,
      connectionId: rawEvents.connectionId,
      driveModifiedTime: rawEventPayloadText("driveModifiedTime"),
      driveVersionToken: rawEventPayloadText("driveVersionToken"),
      documentStatus: documents.status,
    })
    .from(rawEvents)
    .leftJoin(
      documents,
      and(
        sql`${documents.id}::text = ${rawEvents.sourceEventId}`,
        eq(documents.companyId, rawEvents.companyId)
      )
    )
    .where(
      and(
        eq(rawEvents.companyId, input.companyId),
        eq(rawEvents.source, "google_drive"),
        sql`${rawEventPayloadText("driveFileId")} = ${input.fileId}`
      )
    )
    .orderBy(desc(rawEvents.receivedAt))
    .limit(1);

  return row ?? null;
}

async function createGoogleDriveDocumentRecord(input: {
  executor?: GoogleDriveImportDbExecutor;
  companyId: string;
  file: GoogleDriveImportFileRequest;
  fileType: string;
}): Promise<string> {
  const documentId = randomUUID();
  const executor = input.executor ?? db;
  await executor.insert(documents).values({
    id: documentId,
    companyId: input.companyId,
    fileName: input.file.fileName,
    fileType: input.fileType,
    fileSizeBytes: 0,
    storageUrl: "",
    sha256: "",
    source: "google_drive",
    status: "processing",
  });
  return documentId;
}

async function resetGoogleDriveDocumentRecord(input: {
  executor?: GoogleDriveImportDbExecutor;
  companyId: string;
  documentId: string;
  file: GoogleDriveImportFileRequest;
  fileType: string;
}) {
  const executor = input.executor ?? db;
  await executor
    .update(documents)
    .set({
      fileName: input.file.fileName,
      fileType: input.fileType,
      source: "google_drive",
      status: "processing",
      error: null,
      storageUrl: "",
      sha256: "",
      fileSizeBytes: 0,
      ocrResult: null,
      extractedTxnCount: 0,
      confidenceScore: null,
      documentType: null,
      reportingPeriod: null,
    })
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.companyId, input.companyId)
      )
    );
}

async function createGoogleDriveRawEvent(input: {
  executor?: GoogleDriveImportDbExecutor;
  companyId: string;
  documentId: string;
  connectionId?: string;
  file: GoogleDriveImportFileRequest;
  fileType: string;
  ingressSource: "google_drive" | "google_drive_watch";
  idempotencyKey: string;
  revisionToken: string | null;
}) {
  const executor = input.executor ?? db;
  await executor.insert(rawEvents).values({
    companyId: input.companyId,
    connectionId: input.connectionId ?? null,
    sourceEventId: input.documentId,
    idempotencyKey: input.idempotencyKey,
    source: "google_drive",
    eventType: "gdrive.document.queued",
    rawPayload: {
      documentId: input.documentId,
      fileName: input.file.fileName,
      fileType: input.fileType,
      driveFileId: input.file.fileId,
      mimeType: input.file.mimeType,
      driveModifiedTime: normalizeDriveTimestamp(input.file.modifiedTime),
      driveVersionToken: input.revisionToken,
      sourcePath:
        typeof input.file.sourcePath === "string" ? input.file.sourcePath : null,
      rootPath:
        typeof input.file.rootPath === "string" ? input.file.rootPath : null,
      connectionLabel:
        typeof input.file.connectionLabel === "string"
          ? input.file.connectionLabel
          : null,
      ingressSource: input.ingressSource,
    },
  });
}

export async function queueGoogleDriveImportSelection(input: {
  companyId: string;
  accessToken: string;
  explicitFiles?: GoogleDriveImportFileRequest[];
  folderSelections?: GoogleDriveImportFolderSelection[];
  maxImportFiles?: number;
  connectionId?: string;
  ingressSource?: "google_drive" | "google_drive_watch";
  rootPath?: string | null;
  connectionLabel?: string | null;
  /**
   * When `"skip"`, a failing folder (e.g. oversize) is recorded in `folderErrors`
   * but does not abort the whole selection. Defaults to `"throw"` to preserve
   * interactive (picker) behaviour. Watch cron passes `"skip"`.
   */
  onFolderListFailure?: "throw" | "skip";
}): Promise<GoogleDriveImportSelectionResult> {
  const explicitFiles = input.explicitFiles ?? [];
  const folderSelections = input.folderSelections ?? [];
  const maxImportFiles =
    typeof input.maxImportFiles === "number" && input.maxImportFiles > 0
      ? input.maxImportFiles
      : undefined;
  const ingressSource = input.ingressSource ?? "google_drive";
  const onFolderListFailure = input.onFolderListFailure ?? "throw";

  const fileMap = new Map<string, GoogleDriveImportFileRequest>();
  const folderErrors: GoogleDriveImportFolderError[] = [];
  for (const file of explicitFiles) {
    if (!file?.fileId || !file?.fileName || !file?.mimeType) continue;
    fileMap.set(file.fileId, {
      ...file,
      rootPath: file.rootPath ?? input.rootPath ?? undefined,
      connectionLabel: file.connectionLabel ?? input.connectionLabel ?? undefined,
    });
  }

  for (const folderSelection of folderSelections) {
    let folderFiles: Awaited<ReturnType<typeof listFolderFilesRecursive>>;
    try {
      folderFiles = await listFolderFilesRecursive(
        input.accessToken,
        folderSelection.folderId,
        {
          driveId: folderSelection.driveId,
          ...(typeof maxImportFiles === "number" ? { maxFiles: maxImportFiles } : {}),
          rootPath: folderSelection.path ?? input.rootPath ?? undefined,
          ...(folderSelection.modifiedSince
            ? { modifiedAfter: folderSelection.modifiedSince }
            : {}),
        }
      );
    } catch (error) {
      if (onFolderListFailure === "throw") throw error;
      folderErrors.push({
        folderId: folderSelection.folderId,
        path: folderSelection.path,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const file of folderFiles) {
      // Defense in depth: server-side modifiedTime filter is primary; this
      // guards against Drive rounding a timestamp or future callers passing
      // folderFiles in from a different source.
      if (!isGoogleDriveFileModifiedAfter(file, folderSelection.modifiedSince)) {
        continue;
      }

      if (!fileMap.has(file.id)) {
        fileMap.set(file.id, {
          fileId: file.id,
          fileName: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          version: file.version,
          sourcePath: file.path,
          rootPath: folderSelection.path ?? input.rootPath ?? undefined,
          connectionLabel: input.connectionLabel ?? undefined,
        });
      }
    }
  }

  const allFiles = Array.from(fileMap.values());

  if (typeof maxImportFiles === "number" && allFiles.length > maxImportFiles) {
    throw new Error(
      `Too many files (${allFiles.length}). Select a smaller folder or import in batches.`
    );
  }

  if (allFiles.length === 0) {
    return {
      queued: 0,
      skipped: 0,
      total: 0,
      results: [],
      ...(folderErrors.length > 0 ? { folderErrors } : {}),
    };
  }

  const results: GoogleDriveImportSelectionResult["results"] = [];

  for (const file of allFiles) {
    try {
      const fileType = inferFileType(file.fileName, file.mimeType);
      const revisionToken = buildGoogleDriveRevisionToken(file);
      const idempotencyKey = buildGoogleDriveImportIdempotencyKey(file);

      const [exactVersionImport, latestImport] = await Promise.all([
        findGoogleDriveImportStateByIdempotencyKey({
          companyId: input.companyId,
          idempotencyKey,
        }),
        findLatestGoogleDriveImportStateByFileId({
          companyId: input.companyId,
          fileId: file.fileId,
        }),
      ]);

      const decision = decideGoogleDriveImportAction({
        exactVersionImport,
        latestImport,
      });
      const resolvedConnectionId =
        input.connectionId ??
        exactVersionImport?.connectionId ??
        latestImport?.connectionId ??
        undefined;

      if (decision.action === "skip") {
        results.push({
          fileId: file.fileId,
          fileName: file.fileName,
          status: "skipped",
        });
        continue;
      }

      await db.transaction(async (tx) => {
        let documentId: string;
        if (decision.action === "create") {
          documentId = await createGoogleDriveDocumentRecord({
            executor: tx,
            companyId: input.companyId,
            file,
            fileType,
          });
        } else {
          documentId = decision.documentId;
          await resetGoogleDriveDocumentRecord({
            executor: tx,
            companyId: input.companyId,
            documentId,
            file,
            fileType,
          });
        }

        const reuseExistingRawEvent = shouldReuseExistingGoogleDriveRawEvent(
          exactVersionImport
        );
        if (reuseExistingRawEvent && exactVersionImport) {
          await tx
            .update(rawEvents)
            .set({
              sourceEventId: documentId,
              connectionId: resolvedConnectionId ?? null,
            })
            .where(eq(rawEvents.id, exactVersionImport.rawEventId));
        } else {
          await createGoogleDriveRawEvent({
            executor: tx,
            companyId: input.companyId,
            documentId,
            connectionId: resolvedConnectionId,
            file,
            fileType,
            ingressSource,
            idempotencyKey,
            revisionToken,
          });
        }

        await enqueueOutboxEvent(tx, {
          name: "document/gdrive-download",
          data: {
            documentId,
            companyId: input.companyId,
            connectionId: resolvedConnectionId,
            fileId: file.fileId,
            fileName: file.fileName,
            mimeType: file.mimeType,
            fileType,
            sourcePath: file.sourcePath,
            rootPath: file.rootPath,
            connectionLabel: file.connectionLabel,
            ingressSource,
          },
        });
      });

      results.push({
        fileId: file.fileId,
        fileName: file.fileName,
        status: "queued",
      });
    } catch (error) {
      const isUniqueViolation =
        error instanceof Error &&
        (error.message.includes("unique constraint") ||
          error.message.includes("duplicate key") ||
          (error as unknown as Record<string, unknown>).code === "23505");

      if (isUniqueViolation) {
        results.push({
          fileId: file.fileId,
          fileName: file.fileName,
          status: "skipped",
        });
      } else {
        console.error(
          `[gdrive-import] Failed to create records for ${file.fileId}:`,
          error
        );
        results.push({
          fileId: file.fileId,
          fileName: file.fileName,
          status: "error",
          error: "Failed to create import record",
        });
      }
    }
  }

  return {
    queued: results.filter((result) => result.status === "queued").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    total: allFiles.length,
    results,
    ...(folderErrors.length > 0 ? { folderErrors } : {}),
  };
}
