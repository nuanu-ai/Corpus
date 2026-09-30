export const LEGAL_WATCH_BKPM_TEMPLATE_KEY = "legal_watch_bkpm" as const;
export const DAILY_FINANCE_REPORT_TEMPLATE_KEY = "daily_finance_report" as const;
export const WEEKLY_OPERATING_REPORT_TEMPLATE_KEY = "weekly_operating_report" as const;
export const MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY = "monthly_management_report" as const;
export const LEGAL_WATCH_RUN_EVENT = "routine/legal-watch.run.requested" as const;
export const ROUTINE_REPORT_RUN_EVENT = "routine/report.run.requested" as const;

export const REPORT_AUTOMATION_TEMPLATE_KEYS = [
  DAILY_FINANCE_REPORT_TEMPLATE_KEY,
  WEEKLY_OPERATING_REPORT_TEMPLATE_KEY,
  MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY,
] as const;

export type ReportAutomationTemplateKey =
  (typeof REPORT_AUTOMATION_TEMPLATE_KEYS)[number];

export function isReportAutomationTemplateKey(
  value: string,
): value is ReportAutomationTemplateKey {
  return REPORT_AUTOMATION_TEMPLATE_KEYS.includes(value as ReportAutomationTemplateKey);
}

export type RoutineScopeType =
  | "company"
  | "project"
  | "operating_object"
  | "personal_project";

export type RoutineStatus = "draft" | "active" | "paused" | "archived";
export type RoutineRunTrigger = "manual" | "scheduled" | "backfill" | "test";
export type RoutineRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "cancelled";

export type {
  RoutineSourceDefinition,
  RoutineSourceFetchMode,
  RoutineSourceStalenessRisk,
  RoutineSourceStatus,
  RoutineSourceTrustTier,
  RoutineSourceType,
  RoutineSourceCheckFrequency as RoutineSourceFrequency,
} from "@/lib/routines/source-registry";

export type RoutineObservationChangeKind =
  | "new"
  | "changed"
  | "unchanged"
  | "gone"
  | "error";

export type RoutineObservationStatus =
  | "observed"
  | "normalized"
  | "candidate_created"
  | "ignored"
  | "failed";

export type RoutineCandidateReviewStatus =
  | "pending"
  | "approving"
  | "approved"
  | "rejected"
  | "superseded";

export type RoutineLegalStatus =
  | "active"
  | "possibly_superseded"
  | "unclear"
  | "commentary_only";

export interface RoutineRunStats {
  sourceCount: number;
  fetchedCount: number;
  changedCount: number;
  unchangedCount: number;
  candidateCount: number;
  errorCount: number;
  providerCounts?: Record<string, number>;
  apifyRunCount?: number;
  providerErrorCount?: number;
}

export interface RoutineSourceFetchResult {
  sourceKey: string;
  canonicalUrl: string;
  title: string;
  sourceDate: string | null;
  contentType: string;
  contentHash: string;
  bodyText: string;
  rawSnapshot: Record<string, unknown>;
  fetchedAt: string;
}
