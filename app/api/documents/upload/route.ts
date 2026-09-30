import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureCompanyProvisioned } from "@/lib/company-db/provisioning";
import { checkUploadQuota } from "@/lib/auth/usage-limits";
import { chatAttachments, chatThreads, documents, rawEvents } from "@/lib/db/schema";
import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import { validateUploadFile, validateUploadedBuffer, inferFileType } from "@/lib/documents";
import {
  buildDocumentIngressEvent,
  buildSimplifiedNarrativeShadowEvent,
  shouldUsePostIngressDispatch,
} from "@/lib/inngest/document-ingress-events";
import { enqueueOutboxEvent } from "@/lib/outbox";
import { storage, buildStorageKey } from "@/lib/storage";
import { resolveCompanyCodexWorkerPool } from "@/lib/codex-worker/pool";
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
    const rawThreadId = formData.get("threadId");
    const threadId =
      typeof rawThreadId === "string" && rawThreadId.trim().length > 0
        ? rawThreadId.trim()
        : null;

    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.write");
    const { companyId, userId } = auth;

    // Daily upload quota for tier='community' (no-op for managed accounts).
    const quota = await checkUploadQuota(userId);
    if (!quota.ok) {
      return NextResponse.json(
        {
          error: quota.message,
          reason: quota.reason,
          used: quota.used,
          limit: quota.limit,
          resetAt: quota.resetAt,
        },
        { status: 429 },
      );
    }

    let uploadMetadata;
    try {
      uploadMetadata = parseDocumentUploadMetadata(formData, {
        fallbackIngressSource: auth.authMethod === "api_key" ? "api_upload" : "upload",
      });
    } catch (error) {
      if (error instanceof InvalidDocumentUploadMetadataError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 },
      );
    }

    const validation = validateUploadFile({
      name: file.name,
      size: file.size,
      type: file.type,
    });

    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const bufferValidation = validateUploadedBuffer(buffer);
    if (!bufferValidation.valid) {
      return NextResponse.json({ error: bufferValidation.error }, { status: 400 });
    }
    // Reject before persisting a document when its knowledge service is down.
    await ensureCompanyProvisioned(companyId);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const documentId = randomUUID();
    const fileType = inferFileType(file.name, file.type);
    const usePostIngressDispatch = shouldUsePostIngressDispatch({
      companyId,
      fileType,
    });
    const workerPool = usePostIngressDispatch
      ? null
      : await resolveCompanyCodexWorkerPool(companyId);
    const receivedAt = new Date().toISOString();
    const baseOcrResult = usePostIngressDispatch
      ? null
      : buildQueuedCodexOcrResult(undefined, workerPool ?? undefined);
    const initialOcrResult = buildInitialDocumentOcrResult({
      baseOcrResult,
      metadata: uploadMetadata,
      answeredAt: receivedAt,
      answeredBy: userId,
    });
    const attachmentThreadId = threadId
      ? await db
          .select({ id: chatThreads.id })
          .from(chatThreads)
          .where(
            and(
              eq(chatThreads.id, threadId),
              eq(chatThreads.companyId, companyId),
              eq(chatThreads.userId, userId),
            ),
          )
          .limit(1)
          .then((rows) => rows[0]?.id ?? null)
      : null;

    if (threadId && !attachmentThreadId) {
      return NextResponse.json(
        { error: "Thread not found" },
        { status: 404 },
      );
    }

    const storageKey = buildStorageKey({
      companyId,
      documentId,
      sha256,
      fileName: file.name,
    });

    await storage.put(storageKey, buffer);

    let attachment:
      | {
          id: string;
          documentId: string | null;
          fileName: string;
          fileType: string | null;
          status: string;
          documentStatus: string;
          createdAt: string;
          updatedAt: string;
        }
      | null = null;

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
              fileName: file.name,
              fileType,
              fileSizeBytes: file.size,
              sha256,
              storageKey,
              ingressSource: uploadMetadata.sourceContext?.ingressSource ?? "upload",
              sourceContext: uploadMetadata.sourceContext,
              clarificationAnswers:
                Object.keys(uploadMetadata.clarificationAnswers).length > 0
                  ? uploadMetadata.clarificationAnswers
                  : undefined,
              uploadProvenance: uploadMetadata.provenance,
            },
          })
          .onConflictDoNothing();

        if (attachmentThreadId) {
          const [row] = await tx
            .insert(chatAttachments)
            .values({
              threadId: attachmentThreadId,
              companyId,
              documentId,
              kind: "document",
              fileName: file.name,
              fileType,
              storageUrl: storageKey,
              status: "processing",
              metadata: {
                ingressSource: "chat_upload",
                fileSizeBytes: file.size,
                sourceContext: uploadMetadata.sourceContext,
                uploadProvenance: uploadMetadata.provenance,
              },
            })
            .returning({
              id: chatAttachments.id,
              documentId: chatAttachments.documentId,
              fileName: chatAttachments.fileName,
              fileType: chatAttachments.fileType,
              status: chatAttachments.status,
              createdAt: chatAttachments.createdAt,
              updatedAt: chatAttachments.updatedAt,
            });

          attachment = {
            id: row.id,
            documentId: row.documentId,
            fileName: row.fileName,
            fileType: row.fileType,
            status: row.status,
            documentStatus: "processing",
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          };
        }

        // Tier A3 outbox: enqueue ingress events INSIDE the same transaction
        // as the documents row. Replaces post-tx fire-and-forget
        // `inngest.send().catch(console.error)` whose silent failures used to
        // strand documents in `processing` until the cron found them.
        if (usePostIngressDispatch) {
          await enqueueOutboxEvent(tx, buildDocumentIngressEvent({
            documentId,
            companyId,
            fileType,
            storageKey,
          }));
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

    // Onboarding bump: if this upload was attached to an onboarding-kind
    // chat thread, increment the per-company documents-uploaded counter
    // so the bot's next snapshot reflects the new evidence. Best-effort
    // — never block the upload response on this side effect.
    if (attachmentThreadId) {
      try {
        const [threadRow] = await db
          .select({ kind: chatThreads.kind })
          .from(chatThreads)
          .where(eq(chatThreads.id, attachmentThreadId))
          .limit(1);
        if (threadRow?.kind === "onboarding") {
          const { handleOnboardingDocumentUpload } = await import(
            "@/lib/onboarding/context"
          );
          await handleOnboardingDocumentUpload({ companyId });
        }
      } catch (err) {
        console.error("[upload] onboarding bump failed", err);
      }
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (req.nextUrl ? req.nextUrl.origin : new URL(req.url).origin);

    return NextResponse.json({
      documentId,
      fileName: file.name,
      attachment,
      status: "processing",
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
