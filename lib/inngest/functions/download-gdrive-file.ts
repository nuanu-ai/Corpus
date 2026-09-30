import { createHash, randomUUID } from "crypto";
import { eq, and, ne, sql } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import {
  buildDocumentIngressEvent,
  buildSimplifiedNarrativeShadowEvent,
  shouldUsePostIngressDispatch,
} from "@/lib/inngest/document-ingress-events";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { NonRetriableError } from "inngest";

import { getGoogleDriveAccessToken } from "@/lib/connectors/google-drive-auth";
import {
  downloadDriveFile,
  GoogleDriveDownloadForbiddenError,
} from "@/lib/connectors/google-drive";
import {
  validateUploadFile,
  inferFileType,
} from "@/lib/documents";
import { parsePeriodFromSourcePath } from "@/lib/document-parsers/period-utils";
import { storage, buildStorageKey } from "@/lib/storage";
import { resolveCompanyCodexWorkerPool } from "@/lib/codex-worker/pool";
import {
  mergeCodexSourceContext,
  type CodexSourceContext,
} from "@/lib/codex-worker/source-context";
import { buildQueuedCodexOcrResult } from "@/lib/codex-worker/status";
import type { CodexWorkerPool } from "@/lib/codex-worker/types";
import {
  buildLargeFileChunkName,
  DEFAULT_LARGE_FILE_CHUNK_MAX_BYTES,
  DEFAULT_LARGE_FILE_CHUNK_TARGET_BYTES,
  isOversizedPdfForFallback,
  LARGE_FILE_CHUNK_ROLE,
  LARGE_FILE_PARENT_ROLE,
  splitPdfBufferForLargeFileFallback,
} from "@/lib/documents-large-file";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

const MAX_GOOGLE_DRIVE_IMPORT_BYTES = 100 * 1024 * 1024;
const MAX_GOOGLE_DRIVE_PDF_FALLBACK_DOWNLOAD_BYTES = 250 * 1024 * 1024;

function isPdfImportCandidate(fileName: string, mimeType: string): boolean {
  return (
    mimeType === "application/pdf" ||
    fileName.toLowerCase().endsWith(".pdf")
  );
}

function buildDuplicateGoogleDriveImportError(input: {
  existingDocumentId: string;
  existingFileName: string;
}) {
  return `Duplicate Google Drive import skipped; same content as document ${input.existingDocumentId} (${input.existingFileName}).`;
}

async function handleLargePdfFallback(input: {
  companyId: string;
  documentId: string;
  fileName: string;
  buffer: Buffer;
  maxImportedFileSizeBytes: number;
  workerPool: CodexWorkerPool;
  sourceContext: CodexSourceContext | null;
}) {
  const originalSha = sha256(input.buffer);
  const originalStorageKey = buildStorageKey({
    companyId: input.companyId,
    documentId: input.documentId,
    sha256: originalSha,
    fileName: input.fileName,
  });
  await storage.put(originalStorageKey, input.buffer);

  const chunks = await splitPdfBufferForLargeFileFallback({
    buffer: input.buffer,
    maxChunkBytes: DEFAULT_LARGE_FILE_CHUNK_MAX_BYTES,
    targetChunkBytes: DEFAULT_LARGE_FILE_CHUNK_TARGET_BYTES,
  });

  const childRows = chunks.map((chunk, index) => {
    const childDocumentId = randomUUID();
    const childFileName = buildLargeFileChunkName({
      fileName: input.fileName,
      chunkIndex: index + 1,
      chunkCount: chunks.length,
    });
    const childSha = sha256(chunk.buffer);
    const childStorageKey = buildStorageKey({
      companyId: input.companyId,
      documentId: childDocumentId,
      sha256: childSha,
      fileName: childFileName,
    });

    return {
      id: childDocumentId,
      fileName: childFileName,
      fileType: "pdf",
      fileSizeBytes: chunk.buffer.length,
      storageUrl: childStorageKey,
      sha256: childSha,
      status: "processing" as const,
      source: "codex_upload" as const,
      ocrResult: {
        ...mergeCodexSourceContext(
          buildQueuedCodexOcrResult(undefined, input.workerPool),
          input.sourceContext,
        ),
        large_file_fallback: {
          role: LARGE_FILE_CHUNK_ROLE,
          provider: "google_drive",
          parent_document_id: input.documentId,
          chunk_index: index + 1,
          chunk_count: chunks.length,
          page_start: chunk.pageStart,
          page_end: chunk.pageEnd,
          original_file_name: input.fileName,
          original_file_size_bytes: input.buffer.length,
        },
      },
      buffer: chunk.buffer,
    };
  });

  const storedKeys: string[] = [originalStorageKey];
  try {
    for (const child of childRows) {
      await storage.put(child.storageUrl, child.buffer);
      storedKeys.push(child.storageUrl);
    }

    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          fileName: input.fileName,
          fileType: "pdf",
          storageUrl: originalStorageKey,
          sha256: originalSha,
          fileSizeBytes: input.buffer.length,
          source: "google_drive",
          status: "completed",
          error: null,
          documentType: "large_file_fallback",
          ocrResult: {
            ...mergeCodexSourceContext({}, input.sourceContext),
            large_file_fallback: {
              role: LARGE_FILE_PARENT_ROLE,
              provider: "google_drive",
              chunk_count: childRows.length,
              child_document_ids: childRows.map((child) => child.id),
              original_file_name: input.fileName,
              original_file_size_bytes: input.buffer.length,
              original_storage_key: originalStorageKey,
              original_sha256: originalSha,
              chunk_max_bytes: DEFAULT_LARGE_FILE_CHUNK_MAX_BYTES,
              chunk_target_bytes: DEFAULT_LARGE_FILE_CHUNK_TARGET_BYTES,
            },
          },
        })
        .where(
          and(
            eq(documents.id, input.documentId),
            eq(documents.companyId, input.companyId),
          ),
        );

      await tx.insert(documents).values(
        childRows.map((child) => ({
          id: child.id,
          companyId: input.companyId,
          fileName: child.fileName,
          fileType: child.fileType,
          fileSizeBytes: child.fileSizeBytes,
          storageUrl: child.storageUrl,
          sha256: child.sha256,
          source: child.source,
          status: child.status,
          ocrResult: child.ocrResult,
        })),
      );
    });
  } catch (error) {
    for (const key of storedKeys) {
      await storage.remove(key).catch(() => null);
    }
    throw error;
  }

  return {
    storageKey: originalStorageKey,
    fileType: "pdf",
    usePostIngressDispatch: false,
    largeFileFallback: {
      chunkCount: childRows.length,
      childDocumentIds: childRows.map((child) => child.id),
      maxImportedFileSizeBytes: input.maxImportedFileSizeBytes,
    },
  };
}

/**
 * Downloads a file from Google Drive, stores it locally, and hands off
 * processing to the Codex worker pipeline.
 *
 * Event: document/gdrive-download
 *
 * This function bridges the async import flow (where document records are
 * created with empty storageUrl/sha256 and status "processing") with the
 * codex worker pipeline. It downloads the file, validates it, stores it via
 * the storage provider, and updates the document row as codex_upload.
 */
export const downloadGdriveFile = inngest.createFunction(
  {
    id: "download-gdrive-file",
    retries: 3,
    concurrency: [{ key: "event.data.documentId", limit: 1 }],
  },
  { event: "document/gdrive-download" },
  async ({ event, step }) => {
    const { documentId, companyId, connectionId, fileId, fileName, mimeType } =
      event.data as {
        documentId: string;
        companyId: string;
        connectionId?: string;
        fileId: string;
        fileName: string;
        mimeType: string;
        sourcePath?: string;
        rootPath?: string;
        connectionLabel?: string;
        ingressSource?: string;
      };

    try {
      const maxImportedFileSizeBytes = MAX_GOOGLE_DRIVE_IMPORT_BYTES;
      const sourceContext: CodexSourceContext | null = {
        provider: "google_drive",
        sourcePath:
          typeof event.data.sourcePath === "string" ? event.data.sourcePath : null,
        rootPath:
          typeof event.data.rootPath === "string" ? event.data.rootPath : null,
        connectionLabel:
          typeof event.data.connectionLabel === "string"
            ? event.data.connectionLabel
            : null,
        ingressSource:
          typeof event.data.ingressSource === "string"
            ? event.data.ingressSource
            : "google_drive",
        driveFileId: fileId,
        inferredPeriod:
          typeof event.data.sourcePath === "string"
            ? parsePeriodFromSourcePath(event.data.sourcePath)
            : null,
      };
      let workerPoolPromise: Promise<CodexWorkerPool> | null = null;
      const getWorkerPool = () => {
        workerPoolPromise ??= resolveCompanyCodexWorkerPool(companyId);
        return workerPoolPromise;
      };

      // Step 1: Get a valid OAuth access token for this company
      const accessToken = await step.run("get-access-token", async () => {
        return getGoogleDriveAccessToken(companyId, { connectionId });
      });

      // Step 2+3 combined in one step to avoid serializing large buffer payloads.
      const normalized = await step.run("download-validate-store", async () => {
        const maxDownloadBytes = isPdfImportCandidate(fileName, mimeType)
          ? MAX_GOOGLE_DRIVE_PDF_FALLBACK_DOWNLOAD_BYTES
          : maxImportedFileSizeBytes;
        const downloadResult = await downloadDriveFile(
          accessToken,
          fileId,
          mimeType,
          fileName,
          { maxBytes: maxDownloadBytes },
        );
        const buffer = downloadResult.buffer;
        const normalizedFileType = inferFileType(
          downloadResult.fileName,
          downloadResult.mimeType,
        );
        const usePostIngressDispatch = shouldUsePostIngressDispatch({
          companyId,
          fileType: normalizedFileType,
        });

        // Validate the downloaded file
        const validation = validateUploadFile(
          {
            name: downloadResult.fileName,
            size: buffer.length,
            type: downloadResult.mimeType,
          },
          {
            maxFileSizeBytes: maxImportedFileSizeBytes,
          },
        );

        if (!validation.valid) {
          if (
            isOversizedPdfForFallback({
              fileName: downloadResult.fileName,
              mimeType: downloadResult.mimeType,
              sizeBytes: buffer.length,
              maxFileSizeBytes: maxImportedFileSizeBytes,
            })
          ) {
            return handleLargePdfFallback({
              companyId,
              documentId,
              fileName: downloadResult.fileName,
              buffer,
              maxImportedFileSizeBytes,
              workerPool: await getWorkerPool(),
              sourceContext,
            });
          }

          throw new Error(`File validation failed: ${validation.error}`);
        }

        // Compute SHA256 hash
        const fileSha256 = sha256(buffer);

        // Build storage key and persist the file
        const key = buildStorageKey({
          companyId,
          documentId,
          sha256: fileSha256,
          fileName: downloadResult.fileName,
        });

        await storage.put(key, buffer);

        const duplicateOf = await db.transaction(async (tx) => {
          // Serialize same-company/same-content decisions so two copies from
          // one folder import cannot both become active before either row is
          // visible to the duplicate check.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`${companyId}:${fileSha256}`}, 0))`,
          );

          const [existingDuplicate] = await tx
            .select({
              id: documents.id,
              fileName: documents.fileName,
            })
            .from(documents)
            .where(
              and(
                eq(documents.companyId, companyId),
                eq(documents.sha256, fileSha256),
                ne(documents.id, documentId),
                sql`${documents.status} not in ('deleted', 'failed')`,
              ),
            )
            .limit(1);

          if (existingDuplicate) {
            await tx
              .update(documents)
              .set({
                fileName: downloadResult.fileName,
                fileType: normalizedFileType,
                storageUrl: "",
                sha256: fileSha256,
                fileSizeBytes: buffer.length,
                source: "google_drive",
                status: "deleted",
                error: buildDuplicateGoogleDriveImportError({
                  existingDocumentId: existingDuplicate.id,
                  existingFileName: existingDuplicate.fileName,
                }),
                ocrResult: mergeCodexSourceContext(
                  {
                    duplicate_of: {
                      document_id: existingDuplicate.id,
                      file_name: existingDuplicate.fileName,
                      sha256: fileSha256,
                    },
                  },
                  sourceContext,
                ),
              })
              .where(
                and(
                  eq(documents.id, documentId),
                  eq(documents.companyId, companyId),
                ),
              );

            return {
              documentId: existingDuplicate.id,
              fileName: existingDuplicate.fileName,
            };
          }

          // Update the document row with storage details and queue Codex processing.
          await tx
            .update(documents)
            .set({
              fileName: downloadResult.fileName,
              fileType: normalizedFileType,
              storageUrl: key,
              sha256: fileSha256,
              fileSizeBytes: buffer.length,
              source: usePostIngressDispatch ? "google_drive" : "codex_upload",
              status: "processing",
              error: null,
              ocrResult: usePostIngressDispatch
                ? mergeCodexSourceContext({}, sourceContext)
                : mergeCodexSourceContext(
                  buildQueuedCodexOcrResult(undefined, await getWorkerPool()),
                  sourceContext,
                ),
            })
            .where(
              and(
                eq(documents.id, documentId),
                eq(documents.companyId, companyId),
              ),
            );

          return null;
        });

        if (duplicateOf) {
          await storage.remove(key).catch(() => null);
          return {
            storageKey: key,
            fileType: normalizedFileType,
            usePostIngressDispatch: false,
            duplicateOf,
          };
        }

        return {
          storageKey: key,
          fileType: normalizedFileType,
          usePostIngressDispatch,
        };
      });

      if ("duplicateOf" in normalized && normalized.duplicateOf) {
        return {
          documentId,
          fileType: normalized.fileType,
          status: "duplicate_skipped",
          duplicateOf: normalized.duplicateOf,
        };
      }

      const events = [];
      if (normalized.usePostIngressDispatch) {
        events.push(
          buildDocumentIngressEvent({
            documentId,
            companyId,
            fileType: normalized.fileType,
            storageKey: normalized.storageKey,
          }),
        );
      }
      const shadowEvent = buildSimplifiedNarrativeShadowEvent({
        documentId,
        companyId,
        fileType: normalized.fileType,
        storageKey: normalized.storageKey,
      });
      if (shadowEvent) {
        events.push(shadowEvent);
      }

      if (events.length > 0) {
        await step.sendEvent("dispatch-post-ingress", events);
      }

      return {
        documentId,
        storageKey: normalized.storageKey,
        fileType: normalized.fileType,
        status: normalized.usePostIngressDispatch
          ? "queued_for_ingress_dispatch"
          : "queued_for_codex",
      };
    } catch (error) {
      // Drive owner disabled download → non-retryable. Mark the doc failed
      // with a specific reason and stop Inngest from re-running the step,
      // which prevents 3× duplicate stack traces in nextjs-error.log per
      // affected file.
      const isForbiddenByOwner =
        error instanceof GoogleDriveDownloadForbiddenError;
      const errorMessage = isForbiddenByOwner
        ? `Google Drive download forbidden by file owner (viewer download disabled): ${error.fileName}`
        : error instanceof Error
          ? error.message
          : String(error);

      await step.run("mark-document-failed", async () => {
        await db
          .update(documents)
          .set({
            status: "failed",
            error: errorMessage,
          })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.companyId, companyId)
            )
          );
      });

      if (isForbiddenByOwner) {
        throw new NonRetriableError(errorMessage, { cause: error });
      }

      throw error;
    }
  }
);
