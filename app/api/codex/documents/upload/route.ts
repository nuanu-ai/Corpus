import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { documents, rawEvents } from "@/lib/db/schema";
import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import { inferFileType, validateUploadFile, validateUploadedBuffer } from "@/lib/documents";
import { resolveCompanyCodexWorkerPool } from "@/lib/codex-worker/pool";
import { buildStorageKey, storage } from "@/lib/storage";
import { buildQueuedCodexOcrResult } from "@/lib/codex-worker/status";
import {
  buildDocumentAgentWorkflow,
  buildInitialDocumentOcrResult,
  InvalidDocumentUploadMetadataError,
  parseDocumentUploadMetadata,
} from "@/lib/documents/upload-metadata";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.write");
    const { companyId, userId } = auth;
    let uploadMetadata;
    try {
      uploadMetadata = parseDocumentUploadMetadata(formData, {
        fallbackIngressSource: auth.authMethod === "api_key" ? "api_codex_upload" : "codex_upload",
      });
    } catch (error) {
      if (error instanceof InvalidDocumentUploadMetadataError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const validation = validateUploadFile({
      name: file.name,
      size: file.size,
      type: file.type,
    });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const bufferValidation = validateUploadedBuffer(buffer);
    if (!bufferValidation.valid) {
      return NextResponse.json({ error: bufferValidation.error }, { status: 400 });
    }
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const documentId = randomUUID();
    const workerPool = await resolveCompanyCodexWorkerPool(companyId);
    const fileType = inferFileType(file.name, file.type);
    const receivedAt = new Date().toISOString();
    const initialOcrResult = buildInitialDocumentOcrResult({
      baseOcrResult: buildQueuedCodexOcrResult(undefined, workerPool),
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
          source: "codex_upload",
          status: "processing",
          ocrResult: initialOcrResult,
        });

        await tx
          .insert(rawEvents)
          .values({
            companyId,
            sourceEventId: documentId,
            idempotencyKey: `codex_upload:${documentId}`,
            source: "codex_upload",
            eventType: "codex.document.queued",
            rawPayload: {
              documentId,
              fileName: file.name,
              fileType,
              fileSizeBytes: file.size,
              sha256,
              storageKey,
              ingressSource: uploadMetadata.sourceContext?.ingressSource ?? "codex_upload",
              sourceContext: uploadMetadata.sourceContext,
              clarificationAnswers:
                Object.keys(uploadMetadata.clarificationAnswers).length > 0
                  ? uploadMetadata.clarificationAnswers
                  : undefined,
              uploadProvenance: uploadMetadata.provenance,
            },
          })
          .onConflictDoNothing();
      });
    } catch (error) {
      await storage.remove(storageKey).catch(() => {});
      throw error;
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (req.nextUrl ? req.nextUrl.origin : new URL(req.url).origin);

    return NextResponse.json({
      documentId,
      fileName: file.name,
      status: "processing",
      mode: "codex_worker",
      agentWorkflow: buildDocumentAgentWorkflow(documentId, baseUrl),
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
