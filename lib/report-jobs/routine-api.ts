import type {
  ReportJobArtifactRecord,
  ReportJobRecord,
} from "@/lib/report-jobs/types";

export type RoutineReportAnswerUsefulnessStatus = "unrated" | "useful" | "not_useful" | "unknown";

export interface RoutineReportAnswerQualitySummary {
  capturedAt: string | null;
  question: {
    text: string | null;
    reportFamily: string | null;
    subject: string | null;
    periodLabel: string | null;
  };
  evidence: {
    totalSources: number | null;
    totalEvidenceRefs: number | null;
    truncated: boolean;
  };
  answer: {
    charCount: number | null;
    truncated: boolean;
  };
  usefulnessSignal: {
    status: RoutineReportAnswerUsefulnessStatus;
    source: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    note: string | null;
  };
}

export interface RoutineReportJobArtifactSummary {
  id: string;
  reportJobId: string;
  companyId: string;
  kind: string;
  fileName: string;
  mimeType: string | null;
  downloadPath: string;
  viewPath: string;
  reviewPath: string;
  previewable: boolean;
  answerQuality: RoutineReportAnswerQualitySummary | null;
  sourceEvidenceSummary: Record<string, unknown> | null;
  sourceEvidenceSources: Array<{
    source: string;
    status: string;
    label: string;
    reason: string | null;
    freshness: Record<string, unknown>;
    window: Record<string, unknown>;
    counts: Record<string, unknown>;
    idempotencyKey: string | null;
    unavailableWording: string | null;
    evidenceRefCount: number;
    truncated: boolean;
  }>;
  reviewStatus: ReportJobArtifactRecord["reviewStatus"];
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  publishedTargetDomain: string | null;
  publishedTargetPath: string | null;
  commitSha: string | null;
  createdAt: string;
}

export interface RoutineReportJobSummary {
  job: ReportJobRecord;
  artifacts: RoutineReportJobArtifactSummary[];
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function usefulnessStatus(value: unknown): RoutineReportAnswerUsefulnessStatus {
  return value === "unrated" || value === "useful" || value === "not_useful"
    ? value
    : "unknown";
}

function answerQualitySummary(metadata: Record<string, unknown>): RoutineReportAnswerQualitySummary | null {
  const log = asRecord(metadata.answerQualityLog);
  if (!log) return null;
  const question = asRecord(log.question);
  const evidence = asRecord(log.evidence);
  const evidenceSummary = asRecord(evidence?.summary);
  const answer = asRecord(log.answer);
  const signal = asRecord(log.usefulnessSignal);
  const status = asString(signal?.status);

  return {
    capturedAt: asString(log.capturedAt),
    question: {
      text: asString(question?.text),
      reportFamily: asString(question?.reportFamily),
      subject: asString(question?.subject),
      periodLabel: asString(question?.periodLabel),
    },
    evidence: {
      totalSources: asNumber(evidenceSummary?.totalSources),
      totalEvidenceRefs: asNumber(evidenceSummary?.totalEvidenceRefs),
      truncated: evidence?.truncated === true,
    },
    answer: {
      charCount: asNumber(answer?.charCount),
      truncated: answer?.truncated === true,
    },
    usefulnessSignal: {
      status: usefulnessStatus(status),
      source: asString(signal?.source),
      reviewedBy: asString(signal?.reviewedBy),
      reviewedAt: asString(signal?.reviewedAt),
      note: asString(signal?.note),
    },
  };
}

function sourceEvidenceSources(metadata: Record<string, unknown>) {
  const graph = asRecord(metadata.sourceEvidenceGraph);
  const sources = Array.isArray(graph?.sources) ? graph.sources : [];
  return sources
    .map((source) => {
      const sourceRecord = asRecord(source);
      if (!sourceRecord) return null;
      const refs = Array.isArray(sourceRecord.refs) ? sourceRecord.refs : [];
      return {
        source: typeof sourceRecord.source === "string" ? sourceRecord.source : "unknown",
        status: typeof sourceRecord.status === "string" ? sourceRecord.status : "unknown",
        label: typeof sourceRecord.label === "string" ? sourceRecord.label : "Unknown source",
        reason: typeof sourceRecord.reason === "string" ? sourceRecord.reason : null,
        freshness: asRecord(sourceRecord.freshness) ?? {},
        window: asRecord(sourceRecord.window) ?? {},
        counts: asRecord(sourceRecord.counts) ?? {},
        idempotencyKey: typeof sourceRecord.idempotencyKey === "string" ? sourceRecord.idempotencyKey : null,
        unavailableWording: typeof sourceRecord.unavailableWording === "string"
          ? sourceRecord.unavailableWording
          : null,
        evidenceRefCount: refs.length,
        truncated: sourceRecord.truncated === true,
      };
    })
    .filter((source): source is NonNullable<typeof source> => source !== null);
}

export function routineReportArtifactPath(input: {
  routineId: string;
  jobId: string;
  artifactId: string;
}): string {
  return `/api/routines/${input.routineId}/report-jobs/${input.jobId}/artifacts/${input.artifactId}`;
}

export function serializeRoutineReportArtifact(
  artifact: ReportJobArtifactRecord,
  routineId: string,
): RoutineReportJobArtifactSummary {
  const viewPath = routineReportArtifactPath({
    routineId,
    jobId: artifact.reportJobId,
    artifactId: artifact.id,
  });

  return {
    id: artifact.id,
    reportJobId: artifact.reportJobId,
    companyId: artifact.companyId,
    kind: artifact.kind,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    downloadPath: `${viewPath}?download=1`,
    viewPath,
    reviewPath: viewPath,
    previewable: artifact.metadata?.previewable === true,
    answerQuality: answerQualitySummary(artifact.metadata ?? {}),
    sourceEvidenceSummary: asRecord(artifact.metadata?.sourceEvidence),
    sourceEvidenceSources: sourceEvidenceSources(artifact.metadata ?? {}),
    reviewStatus: artifact.reviewStatus,
    reviewedBy: artifact.reviewedBy,
    reviewedAt: toIso(artifact.reviewedAt),
    reviewReason: artifact.reviewReason,
    publishedBy: artifact.publishedBy,
    publishedAt: toIso(artifact.publishedAt),
    publishedTargetDomain: artifact.publishedTargetDomain,
    publishedTargetPath: artifact.publishedTargetPath,
    commitSha: artifact.commitSha,
    createdAt: artifact.createdAt.toISOString(),
  };
}

export function serializeRoutineReportJobs(
  reportJobs: Array<{ job: ReportJobRecord; artifacts: ReportJobArtifactRecord[] }>,
  routineId: string,
): RoutineReportJobSummary[] {
  return reportJobs.map((item) => ({
    job: item.job,
    artifacts: item.artifacts.map((artifact) => serializeRoutineReportArtifact(artifact, routineId)),
  }));
}
