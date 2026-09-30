/**
 * Create a durable document from an in-memory buffer.
 *
 * Used by the legal contract-comparison workflow (handoff CORPUS-42) to persist
 * the two chat-attached agreements as real `documents` rows (so the Codex
 * worker can artifactize them) instead of parsing them inline in the chat
 * request. Reuses the same primitives as `app/api/documents/upload/route.ts`
 * (validate / inferFileType / storage / outbox ingress) but takes a buffer
 * directly — no formData, no HTTP, so the chat route can call it.
 */
import { createHash, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chatAttachments, chatThreads, documents, rawEvents } from "@/lib/db/schema";
import { inferFileType, validateUploadedBuffer } from "@/lib/documents";
import {
  buildDocumentIngressEvent,
  buildSimplifiedNarrativeShadowEvent,
  shouldUsePostIngressDispatch,
} from "@/lib/inngest/document-ingress-events";
import { enqueueOutboxEvent } from "@/lib/outbox";
import { storage, buildStorageKey } from "@/lib/storage";
import { resolveCompanyCodexWorkerPool } from "@/lib/codex-worker/pool";
import { buildQueuedCodexOcrResult } from "@/lib/codex-worker/status";

export interface CreateDocumentFromBufferInput {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  companyId: string;
  userId: string;
  /** Optional chat thread to attach the document to. */
  threadId?: string | null;
  /** Free-form ingress source label, e.g. "legal_chat_compare". */
  ingressSource?: string;
}

export interface CreatedDocument {
  documentId: string;
  storageKey: string;
  fileType: string;
  sha256: string;
  source: string;
  attachedToThread: boolean;
}

/** Pure: deterministic per-document fields (unit-testable). */
export function computeDocumentFields(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): { sha256: string; fileType: string } {
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const fileType = inferFileType(input.fileName, input.mimeType);
  return { sha256, fileType };
}

/**
 * Persist a buffer as a durable document + emit ingress events so the Codex
 * worker artifactizes it. Throws on invalid buffer or DB/storage failure
 * (storage is cleaned up on transaction failure).
 */
export async function createDocumentFromBuffer(
  input: CreateDocumentFromBufferInput,
): Promise<CreatedDocument> {
  const bufferValidation = validateUploadedBuffer(input.buffer);
  if (!bufferValidation.valid) {
    throw new Error(`Invalid document buffer: ${bufferValidation.error}`);
  }

  const { sha256, fileType } = computeDocumentFields(input);
  const documentId = randomUUID();
  const usePostIngressDispatch = shouldUsePostIngressDispatch({
    companyId: input.companyId,
    fileType,
  });
  const workerPool = usePostIngressDispatch
    ? null
    : await resolveCompanyCodexWorkerPool(input.companyId);
  const source = usePostIngressDispatch ? "upload" : "codex_upload";
  const storageKey = buildStorageKey({
    companyId: input.companyId,
    documentId,
    sha256,
    fileName: input.fileName,
  });
  // Chat-attached documents carry no formData metadata (no sourceContext /
  // clarificationAnswers / provenance), so we skip buildInitialDocumentOcrResult
  // and use the queued Codex state directly. The Codex worker picks it up.
  const ocrResult = usePostIngressDispatch
    ? null
    : buildQueuedCodexOcrResult(undefined, workerPool ?? undefined);

  // Verify the thread belongs to this user/company BEFORE writing storage, so
  // an invalid/unauthorized threadId throws without leaving an orphaned object
  // (matches the upload route, which 404s on thread-not-found).
  const attachmentThreadId =
    input.threadId && input.userId
      ? await db
          .select({ id: chatThreads.id })
          .from(chatThreads)
          .where(
            and(
              eq(chatThreads.id, input.threadId),
              eq(chatThreads.companyId, input.companyId),
              eq(chatThreads.userId, input.userId),
            ),
          )
          .limit(1)
          .then((rows) => rows[0]?.id ?? null)
      : null;
  if (input.threadId && !attachmentThreadId) {
    throw new Error("Thread not found or access denied");
  }

  await storage.put(storageKey, input.buffer);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(documents).values({
        id: documentId,
        companyId: input.companyId,
        fileName: input.fileName,
        fileType,
        fileSizeBytes: input.buffer.length,
        storageUrl: storageKey,
        sha256,
        source,
        status: "processing",
        processingStage: "received",
        ocrResult,
      });

      await tx
        .insert(rawEvents)
        .values({
          companyId: input.companyId,
          sourceEventId: documentId,
          idempotencyKey: `${source}:${documentId}`,
          source,
          eventType: usePostIngressDispatch
            ? "upload.document.received"
            : "codex.document.queued",
          rawPayload: {
            documentId,
            fileName: input.fileName,
            fileType,
            fileSizeBytes: input.buffer.length,
            sha256,
            storageKey,
            ingressSource: input.ingressSource ?? "chat",
          },
        })
        .onConflictDoNothing();

      if (attachmentThreadId) {
        await tx.insert(chatAttachments).values({
          threadId: attachmentThreadId,
          companyId: input.companyId,
          documentId,
          kind: "document",
          fileName: input.fileName,
          fileType,
          storageUrl: storageKey,
          status: "processing",
          metadata: {
            ingressSource: input.ingressSource ?? "chat",
            fileSizeBytes: input.buffer.length,
          },
        });
      }

      if (usePostIngressDispatch) {
        await enqueueOutboxEvent(
          tx,
          buildDocumentIngressEvent({ documentId, companyId: input.companyId, fileType, storageKey }),
        );
      }
      const shadowEvent = buildSimplifiedNarrativeShadowEvent({
        documentId,
        companyId: input.companyId,
        fileType,
        storageKey,
      });
      if (shadowEvent) {
        await enqueueOutboxEvent(tx, shadowEvent);
      }
    });
  } catch (dbErr) {
    await storage.remove(storageKey).catch(() => {});
    throw dbErr;
  }

  return {
    documentId,
    storageKey,
    fileType,
    sha256,
    source,
    attachedToThread: Boolean(attachmentThreadId),
  };
}
