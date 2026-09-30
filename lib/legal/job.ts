/**
 * Legal contract comparison job: status machine + output schema (handoff CORPUS-42).
 *
 * A comparison job is tracked as a `chat_artifacts` row:
 *   - kind              = LEGAL_COMPARISON_ARTIFACT_KIND | LEGAL_ALIGNMENT_ARTIFACT_KIND
 *   - status (column)   = artifact lifecycle (draft while running, ready at awaiting_review/completed)
 *   - metadata.jobStatus = typed LegalJobStatus (source of truth for the workflow)
 *   - metadata          = LegalComparisonJobMeta (+ LegalComparisonOutput when done)
 *   - filePath          = markdown render of the final report
 *
 * Note: `failed` is terminal here. Transient failures (network/OCR) are retried
 * at the infra level (Inngest / Codex worker step retries); this machine only
 * records the final outcome.
 *
 * Pure logic here (status transitions, meta/output builders). DB persistence is
 * a thin wrapper in the store; the runner mutates status as it progresses.
 */
import { z } from "zod";

export type LegalJobStatus =
  | "queued"
  | "waiting_for_documents"
  | "extracting"
  | "comparing"
  | "drafting"
  | "awaiting_review"
  | "completed"
  | "failed";

export const LEGAL_JOB_STATUSES: readonly LegalJobStatus[] = [
  "queued", "waiting_for_documents", "extracting", "comparing",
  "drafting", "awaiting_review", "completed", "failed",
];

export const LEGAL_COMPARISON_ARTIFACT_KIND = "legal_contract_comparison";
export const LEGAL_ALIGNMENT_ARTIFACT_KIND = "legal_contract_template_alignment";

const TERMINAL: ReadonlySet<LegalJobStatus> = new Set(["completed", "failed"]);

// Valid forward transitions. From any non-terminal state, `failed` is allowed.
const TRANSITIONS: Record<LegalJobStatus, LegalJobStatus[]> = {
  queued: ["waiting_for_documents", "extracting", "failed"],
  waiting_for_documents: ["extracting", "failed"],
  extracting: ["comparing", "failed"],
  comparing: ["drafting", "awaiting_review", "failed"],
  drafting: ["awaiting_review", "failed"],
  awaiting_review: ["completed", "failed"],
  completed: [],
  failed: [],
};

export function isTerminalStatus(status: LegalJobStatus): boolean {
  return TERMINAL.has(status);
}

export function canTransition(from: LegalJobStatus, to: LegalJobStatus): boolean {
  if (from === to) return false;
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** Throw on illegal transitions — used by the runner to fail fast on logic bugs. */
export function assertCanTransition(from: LegalJobStatus, to: LegalJobStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal legal-job transition: ${from} -> ${to}`);
  }
}

export type LegalIntent = "compare" | "align_to_template";

/** Metadata persisted on the chat_artifacts row. */
export interface LegalComparisonJobMeta {
  artifactType: typeof LEGAL_COMPARISON_ARTIFACT_KIND | typeof LEGAL_ALIGNMENT_ARTIFACT_KIND;
  intent: LegalIntent;
  jobStatus: LegalJobStatus;
  modelDocumentId: string;
  targetDocumentId: string;
  requestedByUserId: string;
  projectId?: string;
  instructions?: string;
  error?: string;
  startedAt: string;
  updatedAt: string;
}

export const LegalClauseDifferenceSchema = z.object({
  clause: z.string(),
  change: z.enum(["added", "removed", "changed", "unchanged"]),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  modelText: z.string().optional(),
  targetText: z.string().optional(),
  note: z.string().optional(),
});
export type LegalClauseDifference = z.infer<typeof LegalClauseDifferenceSchema>;

/**
 * Structured comparison output (handoff "Output Contract For The Comparison
 * Comparison Pass"). The runner must satisfy this schema before transitioning
 * to awaiting_review/completed.
 */
export const LegalComparisonOutputSchema = z.object({
  summary: z.string(),
  overallRiskLevel: z.enum(["low", "medium", "high"]),
  // NOTE: no .min/.max constraints — GLM proxy rejects minimum/maximum in JSON schema.
  sameDocumentTypeConfidence: z.number().optional(),
  clauseDifferences: z.array(LegalClauseDifferenceSchema),
  missingClauses: z.array(z.string()),
  extraClauses: z.array(z.string()),
  aliasFindings: z.array(z.string()),
  entityMigrationFindings: z.array(z.string()),
  openQuestions: z.array(z.string()),
  sourceReferences: z.array(z.string()),
  extractionCaveats: z.array(z.string()),
  /** Only populated for align_to_template intent. */
  draftAgreementMarkdown: z.string().optional(),
  draftChangeLog: z.array(z.string()).optional(),
  fieldsNeedingHumanConfirmation: z.array(z.string()).optional(),
});
export type LegalComparisonOutput = z.infer<typeof LegalComparisonOutputSchema>;

/** Short human progress line for each status (rendered in chat while the job runs). */
export function progressMessage(status: LegalJobStatus): string {
  switch (status) {
    case "queued": return "Comparison queued.";
    case "waiting_for_documents": return "Waiting for both agreements to finish uploading.";
    case "extracting": return "Extracting text from the agreements (OCR for scanned pages).";
    case "comparing": return "Comparing clauses and flagging risks.";
    case "drafting": return "Drafting the template-aligned version.";
    case "awaiting_review": return "Comparison complete. Review required before the final output is approved.";
    case "completed": return "Comparison complete.";
    case "failed": return "Comparison failed.";
    default: {
      // Exhaustiveness guard — forces a compiler error if a status is added
      // without a case above.
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** Build the initial job metadata when the chat creates the job. */
export function buildInitialJobMeta(input: {
  intent: LegalIntent;
  modelDocumentId: string;
  targetDocumentId: string;
  requestedByUserId: string;
  projectId?: string;
  instructions?: string;
  nowIso: string;
}): LegalComparisonJobMeta {
  return {
    artifactType:
      input.intent === "align_to_template"
        ? LEGAL_ALIGNMENT_ARTIFACT_KIND
        : LEGAL_COMPARISON_ARTIFACT_KIND,
    intent: input.intent,
    jobStatus: "queued",
    modelDocumentId: input.modelDocumentId,
    targetDocumentId: input.targetDocumentId,
    requestedByUserId: input.requestedByUserId,
    projectId: input.projectId,
    instructions: input.instructions,
    startedAt: input.nowIso,
    updatedAt: input.nowIso,
  };
}
