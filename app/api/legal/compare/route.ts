/**
 * POST /api/legal/compare — entry point for the legal contract comparison
 * workflow (handoff CORPUS-42). Accepts two agreement files (model + target)
 * via formData, creates durable documents, launches the comparison runner,
 * and returns the job artifact ID + initial progress.
 *
 * This endpoint enables e2e testing of the full pipeline (intent → docs →
 * compare → artifact) without modifying the 3500-line chat route. The chat UI
 * can call this endpoint client-side when legal comparison intent is detected.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { chatArtifacts } from "@/lib/db/schema";
import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { createDocumentFromBuffer } from "@/lib/documents/create-from-buffer";
import { buildInitialJobMeta, progressMessage, type LegalIntent } from "@/lib/legal/job";
import { runLegalComparisonJob } from "@/lib/legal/runner";
import { anthropic } from "@ai-sdk/anthropic";

const LEGAL_MODEL = process.env.LEGAL_COMPARISON_MODEL ?? "claude-sonnet-4-6";

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext();
    const { companyId, userId } = auth;

    const formData = await req.formData();
    const modelFile = formData.get("modelAgreement");
    const targetFile = formData.get("targetAgreement");
    const intent = (formData.get("intent") as string) === "align_to_template"
      ? "align_to_template"
      : "compare";
    const instructions = (formData.get("instructions") as string | null) ?? undefined;
    const rawThreadId = formData.get("threadId") as string | null;
    const threadId = rawThreadId?.trim() || null;

    if (!modelFile || !(modelFile instanceof File)) {
      return NextResponse.json(
        { error: "modelAgreement file is required" },
        { status: 400 },
      );
    }
    if (!targetFile || !(targetFile instanceof File)) {
      return NextResponse.json(
        { error: "targetAgreement file is required" },
        { status: 400 },
      );
    }

    // 1. Create durable documents for both files
    const modelBuffer = Buffer.from(await modelFile.arrayBuffer());
    const targetBuffer = Buffer.from(await targetFile.arrayBuffer());

    const [modelDoc, targetDoc] = await Promise.all([
      createDocumentFromBuffer({
        buffer: modelBuffer,
        fileName: modelFile.name,
        mimeType: modelFile.type || "application/octet-stream",
        companyId,
        userId,
        threadId,
        ingressSource: "legal_compare",
      }),
      createDocumentFromBuffer({
        buffer: targetBuffer,
        fileName: targetFile.name,
        mimeType: targetFile.type || "application/octet-stream",
        companyId,
        userId,
        threadId,
        ingressSource: "legal_compare",
      }),
    ]);

    // 2. Create the job artifact (chat_artifacts row)
    const nowIso = new Date().toISOString();
    const jobMeta = buildInitialJobMeta({
      intent: intent as LegalIntent,
      modelDocumentId: modelDoc.documentId,
      targetDocumentId: targetDoc.documentId,
      requestedByUserId: userId,
      instructions,
      nowIso,
    });
    const artifactId = randomUUID();

    // chat_artifacts requires a threadId (NOT NULL FK). If no thread provided,
    // we cannot create the artifact row. For MVP, require a thread.
    if (!threadId) {
      return NextResponse.json(
        { error: "threadId is required for legal comparison" },
        { status: 400 },
      );
    }

    await db.insert(chatArtifacts).values({
      id: artifactId,
      threadId,
      companyId,
      kind: jobMeta.artifactType,
      title: `Contract comparison — ${modelFile.name} vs ${targetFile.name}`,
      filePath: "pending",
      status: "draft",
      metadata: jobMeta as unknown as Record<string, unknown>,
    });

    // 3. Fire-and-forget the runner (MVP: not durable across restarts, but
    // simple. The runner updates the artifact when done — the client polls
    // or refreshes to see results.)
    const model = anthropic(LEGAL_MODEL);
    runLegalComparisonJob({
      artifactId,
      threadId,
      companyId,
      jobMeta,
      model,
    }).catch((err) => {
      console.error(`[legal-compare] Runner failed for artifact ${artifactId}:`, err);
    });

    // 4. Return progress
    return NextResponse.json({
      artifactId,
      status: "queued",
      jobStatus: jobMeta.jobStatus,
      message: progressMessage(jobMeta.jobStatus),
      modelDocumentId: modelDoc.documentId,
      targetDocumentId: targetDoc.documentId,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
