import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { db } from "@/lib/db";
import { documents, rawEvents } from "@/lib/db/schema";
import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import {
  validateUploadFile,
  validateUploadedBuffer,
  inferFileType,
} from "@/lib/documents";
import {
  buildDocumentIngressEvent,
  buildSimplifiedNarrativeShadowEvent,
  shouldUsePostIngressDispatch,
} from "@/lib/inngest/document-ingress-events";
import { enqueueOutboxEvent } from "@/lib/outbox";
import { storage, buildStorageKey } from "@/lib/storage";
import { resolveCompanyCodexWorkerPool } from "@/lib/codex-worker/pool";
import { buildQueuedCodexOcrResult } from "@/lib/codex-worker/status";
import type { CodexWorkerPool } from "@/lib/codex-worker/types";
import {
  buildDocumentAgentWorkflow,
  buildInitialDocumentOcrResult,
  InvalidDocumentUploadMetadataError,
  parseDocumentUploadMetadata,
  type ParsedDocumentUploadMetadata,
} from "@/lib/documents/upload-metadata";

const MAX_BATCH_SIZE = 20;
const BATCH_UPLOAD_CONCURRENCY = 4;

type FileResult = {
  fileName: string;
  documentId?: string;
  agentWorkflow?: ReturnType<typeof buildDocumentAgentWorkflow>;
  error?: string;
};

async function processFile(
  file: File,
  companyId: string,
  userId: string,
  getWorkerPool: () => Promise<CodexWorkerPool>,
  uploadMetadata: ParsedDocumentUploadMetadata,
  baseUrl: string,
): Promise<FileResult> {
  const validation = validateUploadFile({
    name: file.name,
    size: file.size,
    type: file.type,
  });

  if (!validation.valid) {
    return { fileName: file.name, error: validation.error };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const bufferValidation = validateUploadedBuffer(buffer);
  if (!bufferValidation.valid) {
    return { fileName: file.name, error: bufferValidation.error };
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const documentId = randomUUID();
  const fileType = inferFileType(file.name, file.type);
  const usePostIngressDispatch = shouldUsePostIngressDispatch({
    companyId,
    fileType,
  });
  const receivedAt = new Date().toISOString();
  const baseOcrResult = usePostIngressDispatch
    ? null
    : buildQueuedCodexOcrResult(undefined, await getWorkerPool());
  const initialOcrResult = buildInitialDocumentOcrResult({
    baseOcrResult,
    metadata: uploadMetadata,
    answeredAt: receivedAt,
    answeredBy: userId,
  });

  const storageKey = buildStorageKey({
    companyId,
    documentId,
    sha256,
    fileName: file.name,
  });

  await storage.put(storageKey, buffer);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(documents).values({
        id: documentId,
        companyId,
        fileName: file.name,
        fileType,
        fileSizeBytes: file.size,
        storageUrl: storageKey,
        sha256,
        source: usePostIngressDispatch ? "upload_batch" : "codex_upload",
        status: "processing",
        ocrResult: initialOcrResult,
      });

      await tx
        .insert(rawEvents)
        .values({
          companyId,
          sourceEventId: documentId,
          idempotencyKey: `${usePostIngressDispatch ? "upload_batch" : "codex_upload"}:${documentId}`,
          source: usePostIngressDispatch ? "upload_batch" : "codex_upload",
          eventType: usePostIngressDispatch
            ? "upload_batch.document.received"
            : "codex.document.queued",
          rawPayload: {
            documentId,
            fileName: file.name,
            fileType,
            fileSizeBytes: file.size,
            sha256,
            storageKey,
            ingressSource: uploadMetadata.sourceContext?.ingressSource ?? "upload_batch",
            sourceContext: uploadMetadata.sourceContext,
            clarificationAnswers:
              Object.keys(uploadMetadata.clarificationAnswers).length > 0
                ? uploadMetadata.clarificationAnswers
                : undefined,
            uploadProvenance: uploadMetadata.provenance,
          },
        })
        .onConflictDoNothing();

      if (usePostIngressDispatch) {
        await enqueueOutboxEvent(
          tx,
          buildDocumentIngressEvent({
            documentId,
            companyId,
            fileType,
            storageKey,
          }),
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
  } catch (dbErr) {
    await storage.remove(storageKey).catch(() => {});
    throw dbErr;
  }

  return {
    fileName: file.name,
    documentId,
    agentWorkflow: buildDocumentAgentWorkflow(documentId, baseUrl),
  };
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  const workerCount = Math.min(items.length, Math.max(1, concurrency));
  let cursor = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // Accept both "files" and "files[]" field names
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if ((key === "files" || key === "files[]") && value instanceof File) {
        files.push(value);
      }
    }

    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.write");
    const { companyId, userId } = auth;
    let uploadMetadata: ParsedDocumentUploadMetadata;
    try {
      uploadMetadata = parseDocumentUploadMetadata(formData, {
        fallbackIngressSource: auth.authMethod === "api_key" ? "api_batch_upload" : "upload_batch",
      });
    } catch (error) {
      if (error instanceof InvalidDocumentUploadMetadataError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No files provided" },
        { status: 400 },
      );
    }

    if (files.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        {
          error: `Too many files. Maximum ${MAX_BATCH_SIZE} files per batch, got ${files.length}`,
        },
        { status: 400 },
      );
    }

    let workerPoolPromise: Promise<CodexWorkerPool> | null = null;
    const getWorkerPool = () => {
      workerPoolPromise ??= resolveCompanyCodexWorkerPool(companyId);
      return workerPoolPromise;
    };
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (req.nextUrl ? req.nextUrl.origin : new URL(req.url).origin);

    const results = await mapWithConcurrency(
      files,
      BATCH_UPLOAD_CONCURRENCY,
      async (file) => {
        try {
          return await processFile(
            file,
            companyId,
            userId,
            getWorkerPool,
            uploadMetadata,
            baseUrl,
          );
        } catch (err) {
          return {
            fileName: file.name,
            error: err instanceof Error ? err.message : "Processing failed",
          };
        }
      },
    );
    const uploaded = results.filter((result) => !result.error).length;
    const failed = results.length - uploaded;

    return NextResponse.json({
      uploaded,
      failed,
      results,
      questionQueueUrl: `${baseUrl.replace(/\/$/, "")}/api/documents/questions`,
      acceptedMetadata: {
        sourceContext: uploadMetadata.sourceContext,
        clarificationAnswerKeys: Object.keys(uploadMetadata.clarificationAnswers),
        hasAgentNotes: Boolean(uploadMetadata.provenance?.agentNotes),
        hasRawMetadata: Boolean(uploadMetadata.rawMetadata),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
