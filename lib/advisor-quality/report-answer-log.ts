import type { ReportSourceEvidenceSnapshot } from "@/lib/report-jobs/source-evidence";
import type { ReportIntent } from "@/lib/report-jobs/types";

const MAX_ANSWER_TEXT_LENGTH = 16_000;
const MAX_EVIDENCE_REFS = 100;

export interface ReportAnswerQualityLog {
  schemaVersion: 1;
  recordType: "report_answer_quality_log";
  surface: "report_job";
  capturedAt: string;
  reportJobId?: string;
  routineRunId?: string;
  companyId: string;
  question: {
    text: string;
    reportFamily: string;
    subject: string;
    periodLabel: string;
    outputFormat: string;
    strictness: string;
  };
  evidence: {
    summary: ReportSourceEvidenceSnapshot["summary"] | null;
    refs: Array<{
      id: string;
      source: string;
      title?: string;
      url?: string;
      recordType?: string;
      observedAt?: string;
    }>;
    truncated: boolean;
  };
  answer: {
    artifactKind: string;
    mimeType: string;
    text: string;
    charCount: number;
    truncated: boolean;
    fullTextMetadataKey: "textContent";
  };
  usefulnessSignal: ReportAnswerUsefulnessSignal;
}

export interface ReportAnswerUsefulnessSignal {
  status: "unrated" | "useful" | "not_useful";
  source: "artifact_review" | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  note: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function truncateAnswerText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_ANSWER_TEXT_LENGTH) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_ANSWER_TEXT_LENGTH - 15)}...[truncated]`,
    truncated: true,
  };
}

function evidenceRefsFromSnapshot(
  sourceEvidence: ReportSourceEvidenceSnapshot | undefined,
): ReportAnswerQualityLog["evidence"] {
  if (!sourceEvidence) {
    return {
      summary: null,
      refs: [],
      truncated: false,
    };
  }

  const refs = sourceEvidence.sources.flatMap((source) =>
    source.refs.map((ref) => ({
      id: ref.id,
      source: ref.source || source.source,
      ...(ref.title ? { title: ref.title } : {}),
      ...(ref.url ? { url: ref.url } : {}),
      ...(ref.recordType ? { recordType: ref.recordType } : {}),
      ...(ref.observedAt ? { observedAt: ref.observedAt } : {}),
    })),
  );
  const cappedRefs = refs.slice(0, MAX_EVIDENCE_REFS);

  return {
    summary: sourceEvidence.summary,
    refs: cappedRefs,
    truncated: sourceEvidence.summary.truncated || refs.length > cappedRefs.length,
  };
}

export function createReportAnswerQualityLog(input: {
  intent: ReportIntent;
  answerText: string;
  artifactKind: string;
  mimeType: string;
  sourceEvidence?: ReportSourceEvidenceSnapshot;
  reportJobId?: string;
  routineRunId?: string | null;
  capturedAt?: string;
}): ReportAnswerQualityLog {
  const answer = truncateAnswerText(input.answerText);

  return {
    schemaVersion: 1,
    recordType: "report_answer_quality_log",
    surface: "report_job",
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    ...(input.reportJobId ? { reportJobId: input.reportJobId } : {}),
    ...(input.routineRunId ? { routineRunId: input.routineRunId } : {}),
    companyId: input.intent.companyId,
    question: {
      text: input.intent.request,
      reportFamily: input.intent.reportFamily,
      subject: input.intent.subject,
      periodLabel: input.intent.period.label,
      outputFormat: input.intent.outputFormat,
      strictness: input.intent.strictness,
    },
    evidence: evidenceRefsFromSnapshot(input.sourceEvidence),
    answer: {
      artifactKind: input.artifactKind,
      mimeType: input.mimeType,
      text: answer.text,
      charCount: input.answerText.length,
      truncated: answer.truncated,
      fullTextMetadataKey: "textContent",
    },
    usefulnessSignal: {
      status: "unrated",
      source: null,
      reviewedBy: null,
      reviewedAt: null,
      note: null,
    },
  };
}

export function applyReportAnswerReviewSignal(input: {
  metadata: Record<string, unknown>;
  reviewStatus: "approved" | "rejected";
  reviewedBy: string;
  reviewedAt: Date;
  reviewReason?: string | null;
}): Record<string, unknown> {
  const log = asRecord(input.metadata.answerQualityLog);
  if (!log) return input.metadata;

  return {
    ...input.metadata,
    answerQualityLog: {
      ...log,
      usefulnessSignal: {
        status: input.reviewStatus === "approved" ? "useful" : "not_useful",
        source: "artifact_review",
        reviewedBy: input.reviewedBy,
        reviewedAt: input.reviewedAt.toISOString(),
        note: input.reviewReason ?? null,
      },
    },
  };
}
