import { createHash, randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { documents, rawEvents } from "@/lib/db/schema";
import { validateUploadFile, inferFileType } from "@/lib/documents";
import {
  buildDocumentIngressEvent,
  buildSimplifiedNarrativeShadowEvent,
  shouldUsePostIngressDispatch,
} from "@/lib/inngest/document-ingress-events";
import { enqueueOutboxEvent } from "@/lib/outbox";
import { storage, buildStorageKey } from "@/lib/storage";
import { resolveCompanyCodexWorkerPool } from "@/lib/codex-worker/pool";
import { buildQueuedCodexOcrResult } from "@/lib/codex-worker/status";
import { buildInitialDocumentOcrResult } from "@/lib/documents/upload-metadata";

export interface SaveDocumentFromChatInput {
  companyId: string;
  userId: string;
  fileName: string;
  mediaType: string;
  buffer: Buffer;
  /**
   * Free-text "agent notes" recorded on the upload provenance, e.g. the
   * sentence the user said when asking the agent to save the file.
   */
  agentNotes?: string | null;
}

export interface SaveDocumentFromChatResult {
  documentId: string;
  fileName: string;
  fileSizeBytes: number;
  fileType: string;
  status: "processing";
  storageKey: string;
}

export class SaveDocumentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveDocumentValidationError";
  }
}

/**
 * Persist a chat-attached file as a real `documents` row and trigger the
 * normal ingest pipeline (Inngest `process-document`).
 *
 * This is the programmatic equivalent of `POST /api/documents/upload`,
 * minus the chat_attachments / clarifications surface that's tied to the
 * multipart upload UI. Used by the agent-facing `save_attached_file` tool
 * so persistence becomes an explicit, opt-in user action instead of
 * silent default behaviour.
 */
export async function saveDocumentFromChat(
  input: SaveDocumentFromChatInput,
): Promise<SaveDocumentFromChatResult> {
  const { companyId, userId, fileName, mediaType, buffer, agentNotes } = input;

  const validation = validateUploadFile({
    name: fileName,
    size: buffer.length,
    type: mediaType,
  });
  if (!validation.valid) {
    throw new SaveDocumentValidationError(validation.error ?? "File rejected by validateUploadFile");
  }

  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const documentId = randomUUID();
  const fileType = inferFileType(fileName, mediaType);
  const usePostIngressDispatch = shouldUsePostIngressDispatch({ companyId, fileType });
  const workerPool = usePostIngressDispatch
    ? null
    : await resolveCompanyCodexWorkerPool(companyId);
  const receivedAt = new Date().toISOString();
  const baseOcrResult = usePostIngressDispatch
    ? null
    : buildQueuedCodexOcrResult(undefined, workerPool ?? undefined);
  const initialOcrResult = buildInitialDocumentOcrResult({
    baseOcrResult,
    metadata: {
      sourceContext: { ingressSource: "chat_save_attached_file" },
      clarificationAnswers: {},
      provenance: agentNotes ? { agentNotes } : null,
      rawMetadata: null,
    },
    answeredAt: receivedAt,
    answeredBy: userId,
  });

  const storageKey = buildStorageKey({ companyId, documentId, sha256, fileName });
  await storage.put(storageKey, buffer);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(documents).values({
        id: documentId,
        companyId,
        fileName,
        fileType,
        fileSizeBytes: buffer.length,
        storageUrl: storageKey,
        sha256,
        source: usePostIngressDispatch ? "upload" : "codex_upload",
        status: "processing",
        ocrResult: initialOcrResult,
      });

      await tx
        .insert(rawEvents)
        .values({
          companyId,
          sourceEventId: documentId,
          idempotencyKey: `${usePostIngressDispatch ? "upload" : "codex_upload"}:${documentId}`,
          source: usePostIngressDispatch ? "upload" : "codex_upload",
          eventType: usePostIngressDispatch
            ? "upload.document.received"
            : "codex.document.queued",
          rawPayload: {
            documentId,
            fileName,
            fileType,
            fileSizeBytes: buffer.length,
            sha256,
            storageKey,
            ingressSource: "chat_save_attached_file",
            sourceContext: { ingressSource: "chat_save_attached_file" },
            uploadProvenance: agentNotes ? { agentNotes } : undefined,
          },
        })
        .onConflictDoNothing();

      if (usePostIngressDispatch) {
        await enqueueOutboxEvent(
          tx,
          buildDocumentIngressEvent({ documentId, companyId, fileType, storageKey }),
        );
      }
      const shadowEvent = buildSimplifiedNarrativeShadowEvent({
        documentId,
        companyId,
        fileType,
        storageKey,
      });
      if (shadowEvent) {
        await enqueueOutboxEvent(tx, shadowEvent);
      }
    });
  } catch (err) {
    await storage.remove(storageKey).catch(() => {});
    throw err;
  }

  return {
    documentId,
    fileName,
    fileSizeBytes: buffer.length,
    fileType,
    status: "processing",
    storageKey,
  };
}
