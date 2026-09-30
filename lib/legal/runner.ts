/**
 * Legal contract comparison runner (handoff CORPUS-42, unit 4b).
 *
 * Orchestrates the full comparison pipeline:
 *   1. Load both document rows from the DB
 *   2. Load file buffers from storage
 *   3. Extract text (PDF → unstructured, knowledge → knowledge extractor)
 *   4. Run the bounded comparison pass (runLegalComparison)
 *   5. Render the output to markdown (renderComparisonMarkdown)
 *   6. Write the markdown to the consultant workspace (artifact file)
 *   7. Create / update the chat_artifacts row → status awaiting_review
 *   8. Transition the job metadata through the status machine
 *
 * All DB/storage/LLM dependencies are injected via RunnerDeps so the
 * orchestration logic is unit-testable without real infrastructure.
 */
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { chatArtifacts, documents } from "@/lib/db/schema";
import { loadDocumentFileBuffer } from "@/lib/inngest/document-file-loader";
import { extractKnowledgeText } from "@/lib/document-parsers/knowledge-extractor";
import { extractUnstructuredText } from "@/lib/document-parsers/unstructured-text";
import { writeConsultantArtifactFile } from "@/lib/consultant/workspace";

import {
  type LegalComparisonJobMeta,
  type LegalComparisonOutput,
  type LegalJobStatus,
  assertCanTransition,
  LEGAL_COMPARISON_ARTIFACT_KIND,
  LEGAL_ALIGNMENT_ARTIFACT_KIND,
} from "@/lib/legal/job";
import { runLegalComparison, type RunLegalComparisonInput } from "@/lib/legal/compare";
import { renderComparisonMarkdown } from "@/lib/legal/render";
import { createLegalApproval } from "@/lib/legal/approval";

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/** Max characters of extracted text to send to the comparison prompt.
 *  Matches the cap in compare.ts (MAX_AGREEMENT_LENGTH = 100_000). */
const MAX_EXTRACTED_TEXT_LENGTH = 100_000;

export interface DocumentTextResult {
  text: string;
  /** The extraction method used (for diagnostics). */
  method: "knowledge" | "unstructured_pdf";
}

/**
 * Extract agreement text from a document row.
 *
 * Uses the same extraction primitives as the ingestion pipeline:
 * - knowledge files (txt/md/docx) → extractKnowledgeText
 * - PDF files → extractUnstructuredText (pdfplumber / unstructured)
 *
 * Throws if the document type is unsupported or extraction fails.
 */
export async function extractDocumentText(input: {
  documentId: string;
  companyId: string;
  fileName: string;
  fileType: string;
  storageUrl: string; // storage key (field named storageUrl for legacy reasons)
}): Promise<DocumentTextResult> {
  const buffer = await loadDocumentFileBuffer({
    storageKey: input.storageUrl,
  });

  if (input.fileType === "knowledge") {
    const extracted = await extractKnowledgeText(buffer, input.fileName, input.fileType);
    return {
      text: extracted.text.slice(0, MAX_EXTRACTED_TEXT_LENGTH),
      method: "knowledge",
    };
  }

  if (input.fileType === "pdf") {
    const extracted = await extractUnstructuredText(buffer, {
      fileType: "pdf",
      fileName: input.fileName,
    });
    return {
      text: extracted.text.slice(0, MAX_EXTRACTED_TEXT_LENGTH),
      method: "unstructured_pdf",
    };
  }

  throw new Error(
    `Unsupported document type for legal comparison: "${input.fileType}" (document ${input.documentId})`,
  );
}

// ---------------------------------------------------------------------------
// Runner input / output
// ---------------------------------------------------------------------------

export interface RunLegalComparisonJobInput {
  /** The chat_artifacts row ID that tracks this job. */
  artifactId: string;
  threadId: string;
  companyId: string;
  /** Current job metadata from the chat_artifacts row. */
  jobMeta: LegalComparisonJobMeta;
  /** AI SDK LanguageModel to use for the comparison. */
  model: RunLegalComparisonInput["model"];
}

export interface RunLegalComparisonJobResult {
  artifactId: string;
  filePath: string;
  output: LegalComparisonOutput;
  finalStatus: LegalJobStatus;
}

// ---------------------------------------------------------------------------
// Status transition helper
// ---------------------------------------------------------------------------

function transitionMeta(
  meta: LegalComparisonJobMeta,
  nextStatus: LegalJobStatus,
  patch?: Partial<LegalComparisonJobMeta>,
): LegalComparisonJobMeta {
  assertCanTransition(meta.jobStatus, nextStatus);
  return {
    ...meta,
    ...patch,
    jobStatus: nextStatus,
    updatedAt: new Date().toISOString(),
  };
}

async function persistJobStatus(
  artifactId: string,
  threadId: string,
  companyId: string,
  meta: LegalComparisonJobMeta,
  artifactDbStatus?: string,
): Promise<void> {
  await db
    .update(chatArtifacts)
    .set({
      metadata: meta as unknown as Record<string, unknown>,
      ...(artifactDbStatus ? { status: artifactDbStatus } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatArtifacts.id, artifactId),
        eq(chatArtifacts.threadId, threadId),
        eq(chatArtifacts.companyId, companyId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

/**
 * Run the full legal comparison job.
 *
 * Expects the chat_artifacts row to already exist (created by the chat
 * integration when the user sends the comparison request). Transitions
 * the job through: extracting → comparing → (drafting) → awaiting_review.
 *
 * On failure, transitions to `failed` with the error message persisted
 * in the job metadata.
 */
export async function runLegalComparisonJob(
  input: RunLegalComparisonJobInput,
): Promise<RunLegalComparisonJobResult> {
  let meta = input.jobMeta;

  try {
    // ── Step 1: Transition → extracting ──────────────────────────────────
    meta = transitionMeta(meta, "extracting");
    await persistJobStatus(input.artifactId, input.threadId, input.companyId, meta);

    // ── Step 2: Load document rows ──────────────────────────────────────
    const [modelDoc] = await db
      .select({
        id: documents.id,
        companyId: documents.companyId,
        fileName: documents.fileName,
        fileType: documents.fileType,
        storageUrl: documents.storageUrl,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, meta.modelDocumentId),
          eq(documents.companyId, input.companyId),
        ),
      )
      .limit(1);

    const [targetDoc] = await db
      .select({
        id: documents.id,
        companyId: documents.companyId,
        fileName: documents.fileName,
        fileType: documents.fileType,
        storageUrl: documents.storageUrl,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, meta.targetDocumentId),
          eq(documents.companyId, input.companyId),
        ),
      )
      .limit(1);

    if (!modelDoc) {
      throw new Error(`Model document not found: ${meta.modelDocumentId}`);
    }
    if (!targetDoc) {
      throw new Error(`Target document not found: ${meta.targetDocumentId}`);
    }

    // ── Step 3: Extract text from both documents ────────────────────────
    const [modelText, targetText] = await Promise.all([
      extractDocumentText({
        documentId: modelDoc.id,
        companyId: modelDoc.companyId,
        fileName: modelDoc.fileName,
        fileType: modelDoc.fileType,
        storageUrl: modelDoc.storageUrl,
      }),
      extractDocumentText({
        documentId: targetDoc.id,
        companyId: targetDoc.companyId,
        fileName: targetDoc.fileName,
        fileType: targetDoc.fileType,
        storageUrl: targetDoc.storageUrl,
      }),
    ]);

    // ── Step 4: Transition → comparing ──────────────────────────────────
    meta = transitionMeta(meta, "comparing");
    await persistJobStatus(input.artifactId, input.threadId, input.companyId, meta);

    // ── Step 5: Run the bounded comparison pass ─────────────────────────
    const comparisonOutput = await runLegalComparison({
      model: input.model,
      modelText: modelText.text,
      targetText: targetText.text,
      intent: meta.intent,
      instructions: meta.instructions,
    });

    // ── Step 6: If align_to_template, transition through drafting ────────
    if (meta.intent === "align_to_template" && comparisonOutput.draftAgreementMarkdown) {
      meta = transitionMeta(meta, "drafting");
      await persistJobStatus(input.artifactId, input.threadId, input.companyId, meta);
    }

    // ── Step 7: Render markdown report ──────────────────────────────────
    const markdownReport = renderComparisonMarkdown(comparisonOutput);

    // ── Step 8: Write artifact file to consultant workspace ─────────────
    const artifactFile = await writeConsultantArtifactFile({
      companyId: input.companyId,
      threadId: input.threadId,
      title: `Contract comparison — ${modelDoc.fileName} vs ${targetDoc.fileName}`,
      fileName: `legal-comparison-${input.artifactId.slice(0, 8)}.md`,
      destination: "artifacts",
      content: markdownReport,
    });

    // ── Step 9: Transition → awaiting_review + persist artifact path ────
    meta = transitionMeta(meta, "awaiting_review");
    await db
      .update(chatArtifacts)
      .set({
        filePath: artifactFile.relativePath,
        mimeType: "text/markdown",
        status: "ready",
        metadata: {
          ...(meta as unknown as Record<string, unknown>),
          comparisonOutput: comparisonOutput as unknown as Record<string, unknown>,
          modelFileName: modelDoc.fileName,
          targetFileName: targetDoc.fileName,
          modelExtractionMethod: modelText.method,
          targetExtractionMethod: targetText.method,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chatArtifacts.id, input.artifactId),
          eq(chatArtifacts.threadId, input.threadId),
          eq(chatArtifacts.companyId, input.companyId),
        ),
      );

    // ── Step 10: Create approval gate (chat_approvals) ──────────────────
    await createLegalApproval({
      artifactId: input.artifactId,
      threadId: input.threadId,
      companyId: input.companyId,
      requestedByUserId: input.jobMeta.requestedByUserId,
    });

    return {
      artifactId: input.artifactId,
      filePath: artifactFile.relativePath,
      output: comparisonOutput,
      finalStatus: "awaiting_review",
    };
  } catch (error) {
    // ── Failure: transition → failed + persist error ────────────────────
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    try {
      meta = transitionMeta(meta, "failed", { error: errorMessage });
    } catch {
      // If the status machine itself rejects the transition (e.g. already
      // terminal), force-set it so the DB record is not stuck.
      meta = {
        ...meta,
        jobStatus: "failed",
        error: errorMessage,
        updatedAt: new Date().toISOString(),
      };
    }

    await persistJobStatus(
      input.artifactId,
      input.threadId,
      input.companyId,
      meta,
      "draft", // keep artifact as draft on failure
    ).catch((persistErr) => {
      console.error(
        `[legal-runner] Failed to persist failure status for artifact ${input.artifactId}:`,
        persistErr,
      );
    });

    throw error;
  }
}
