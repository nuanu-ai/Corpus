export type RoutineStatus = "draft" | "active" | "paused" | "archived";
export type RoutineScopeType = "company" | "project" | "operating_object" | "personal_project";
export type RoutineRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "cancelled";
export type CandidateStatus = "pending" | "approving" | "approved" | "rejected" | "superseded";

export type JsonRecord = Record<string, unknown>;

export interface RoutineTemplate {
  id: string;
  templateKey: string;
  title: string;
  domain: string;
  defaultJurisdiction: string | null;
  defaultTopic: string | null;
  defaultSources: JsonRecord[];
  defaultSchedulePolicy: JsonRecord;
  defaultReviewPolicy: JsonRecord;
  defaultDigestPolicy: JsonRecord;
  riskLevel: string;
  status: string;
}

export interface RoutineDefinition {
  id: string;
  scopeType: RoutineScopeType;
  scopeId: string | null;
  slug: string;
  title: string;
  templateKey: string;
  domain: string;
  jurisdiction: string | null;
  topic: string | null;
  status: RoutineStatus;
  createdFrom: string;
  createdByUserId: string | null;
  ownerUserId: string | null;
  schedulePolicy: JsonRecord;
  sourcePolicy: JsonRecord;
  reviewPolicy: JsonRecord;
  digestPolicy: JsonRecord;
  metadata: JsonRecord;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationManifest {
  version: "automation_manifest_v1";
  automation: {
    riskLevel: string;
    domain: string;
    templateKey: string;
  };
  trigger: {
    type: string;
    cadence?: string;
    timezone?: string;
    window?: string;
  };
  sources: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    trustTier: string;
  }>;
  steps: Array<{
    id: string;
    type: string;
  }>;
  outputs: Array<{
    id: string;
    type: string;
    publishPolicy: string;
    destination: {
      kind: string;
      domain?: string;
      path?: string;
    };
  }>;
  reviewPolicy: {
    required: boolean;
    mode: string;
  };
  runPolicy: {
    concurrency: string;
    timeoutSeconds: number;
    budget: JsonRecord;
  };
}

export interface RoutineSource {
  id: string;
  sourceKey: string;
  title: string;
  url: string;
  sourceType: string;
  authority: string;
  jurisdiction: string;
  topicTags: string[];
  fetchMode: string;
  checkFrequency: string;
  stalenessRisk: string;
  trustTier: string;
  status: string;
  lastSeenAt: string | null;
  lastChangedAt: string | null;
  lastError: string | null;
  metadata: JsonRecord;
  updatedAt: string;
}

export interface RoutineRun {
  id: string;
  trigger: string;
  status: RoutineRunStatus;
  windowStart: string | null;
  windowEnd: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  stats: JsonRecord;
  error: string | null;
  createdAt: string;
}

export interface RoutineScheduleWindowStatus {
  cadence: string;
  timezone: string;
  periodKey: string;
  windowStart: string;
  windowEnd: string;
  dueAt: string;
}

export interface RoutineScheduleStatus {
  cadence: string;
  timezone: string | null;
  schedulerEnabled: boolean;
  globalSchedulerEnabled: boolean;
  runnable: boolean;
  currentWindow: RoutineScheduleWindowStatus | null;
  latestDueWindow: RoutineScheduleWindowStatus | null;
  nextDueWindow: RoutineScheduleWindowStatus | null;
  decision: {
    action: string;
    reason: string | null;
    idempotencyKey: string | null;
    window: RoutineScheduleWindowStatus | null;
  };
  blockingRun: {
    id: string;
    trigger: string;
    status: RoutineRunStatus;
    windowStart: string | null;
    windowEnd: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  checkedAt: string;
}

export interface RoutineReportJobArtifact {
  id: string;
  reportJobId: string;
  companyId: string;
  kind: string;
  fileName: string;
  mimeType: string | null;
  downloadPath: string | null;
  viewPath: string | null;
  reviewPath?: string;
  previewable?: boolean;
  answerQuality?: {
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
      status: "unrated" | "useful" | "not_useful" | "unknown";
      source: string | null;
      reviewedBy: string | null;
      reviewedAt: string | null;
      note: string | null;
    };
  } | null;
  sourceEvidenceSummary?: JsonRecord | null;
  sourceEvidenceSources?: Array<{
    source: string;
    status: string;
    label: string;
    reason?: string | null;
    freshness?: JsonRecord;
    window?: JsonRecord;
    counts?: JsonRecord;
    idempotencyKey?: string | null;
    unavailableWording?: string | null;
    evidenceRefCount: number;
    truncated: boolean;
  }>;
  reviewStatus: "pending" | "approving" | "approved" | "rejected";
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

export interface RoutineReportJob {
  id: string;
  companyId: string;
  routineRunId: string | null;
  requestedByUserId: string;
  status: string;
  requestText: string;
  outputFormat: string;
  strictness: string;
  resultSummary: JsonRecord;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineReportJobWithArtifacts {
  job: RoutineReportJob;
  artifacts: RoutineReportJobArtifact[];
}

export interface RoutineObservation {
  id: string;
  routineRunId: string;
  routineSourceId: string;
  sourceKey: string;
  sourceConfigTitle: string;
  sourceType: string;
  trustTier: string;
  canonicalUrl: string;
  sourceTitle: string | null;
  sourceDate: string | null;
  fetchedAt: string;
  changeKind: string;
  status: string;
  metadata: JsonRecord;
  createdAt: string;
}

export interface RoutineReportJobsSummary {
  pendingArtifactCount: number;
  latestArtifact: RoutineReportJobArtifact | null;
}

export interface RoutineListSummary {
  pendingCandidateCount: number;
  pendingReportArtifactCount: number;
  latestReportArtifactStatus: string | null;
  latestReportArtifactAt: string | null;
  staleSourceCount: number;
  latestRunStatus: RoutineRunStatus | null;
  latestRunAt: string | null;
  latestDigestStatus: string | null;
  latestDigestAt: string | null;
}

export interface RoutineCandidate {
  id: string;
  targetDomain: string;
  targetPath: string;
  title: string;
  summary: string;
  jurisdiction: string;
  sourceDate: string | null;
  confidenceScore: string | null;
  reviewStatus: CandidateStatus;
  legalStatus: string;
  sourceUrls: string[];
  observationIds: string[];
  proposedFrontmatter: JsonRecord;
  proposedBody: string;
  reviewedAt: string | null;
  reviewReason: string | null;
  commitSha: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineDigest {
  id: string;
  windowStart: string;
  windowEnd: string;
  status: string;
  candidateCount: number;
  approvedCount: number;
  rejectedCount: number;
  changedSourceCount: number;
  previousWindowStats: JsonRecord;
  artifactPath: string | null;
  commitSha: string | null;
  metadata: JsonRecord;
  createdAt: string;
}

export interface RoutineCandidateDetail {
  candidate: RoutineCandidate;
  proposedFrontmatter: JsonRecord;
  proposedBody: string;
  sources: RoutineSource[];
}
