import { Buffer } from "node:buffer";

import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { chatAttachments, chatThreads, documents, rawEvents } from "@/lib/db/schema";
import {
  getSessionPersonalProjectContext,
  handleApiError,
} from "@/lib/api-auth";
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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const rawThreadId = formData.get("threadId");
    const threadId =
      typeof rawThreadId === "string" && rawThreadId.trim().length > 0
        ? rawThreadId.trim()
        : null;

    const auth = await getSessionPersonalProjectContext();
    const { projectId: companyId, userId } = auth;

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!threadId) {
      return NextResponse.json(
        { error: "threadId is required for personal chat uploads" },
        { status: 400 },
      );
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
    const fileType = inferFileType(file.name, file.type);
    const usePostIngressDispatch = shouldUsePostIngressDispatch({
      companyId,
      fileType,
    });
    const workerPool = usePostIngressDispatch
      ? null
      : await resolveCompanyCodexWorkerPool(companyId);
    const attachmentThreadId = await db
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
      .then((rows) => rows[0]?.id ?? null);

    if (!attachmentThreadId) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
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
          source: usePostIngressDispatch ? "personal_upload" : "codex_upload",
          status: "processing",
          ocrResult: usePostIngressDispatch
            ? null
            : buildQueuedCodexOcrResult(undefined, workerPool ?? undefined),
        });

        await tx
          .insert(rawEvents)
          .values({
            companyId,
            sourceEventId: documentId,
            idempotencyKey: `${usePostIngressDispatch ? "personal_upload" : "codex_upload"}:${documentId}`,
            source: usePostIngressDispatch ? "personal_upload" : "codex_upload",
            eventType: usePostIngressDispatch
              ? "personal_upload.document.received"
              : "codex.document.queued",
            rawPayload: {
              documentId,
              fileName: file.name,
              fileType,
              fileSizeBytes: file.size,
              sha256,
              storageKey,
              ingressSource: "personal_chat_upload",
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
                ingressSource: "personal_chat_upload",
                fileSizeBytes: file.size,
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

    return NextResponse.json({
      documentId,
      fileName: file.name,
      attachment,
      status: "processing",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
