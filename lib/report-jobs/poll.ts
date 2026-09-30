import {
  getReportJobByIdForUser,
  listReportJobArtifactsForUser,
} from "@/lib/report-jobs/store";
import type { ReportJobArtifactRecord, ReportJobRecord } from "@/lib/report-jobs/types";

const TERMINAL_REPORT_JOB_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "awaiting_clarification",
]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ReportJobSnapshot = {
  job: ReportJobRecord | null;
  artifacts: ReportJobArtifactRecord[];
};

export type WaitForReportJobSnapshotResult = ReportJobSnapshot & {
  timedOut: boolean;
  polls: number;
  waitedMs: number;
};

export async function waitForReportJobSnapshot(
  loadSnapshot: () => Promise<ReportJobSnapshot>,
  input: {
    maxWaitMs: number;
    pollIntervalMs: number;
  },
): Promise<WaitForReportJobSnapshotResult> {
  const startedAt = Date.now();
  let polls = 0;

  while (true) {
    polls += 1;
    const snapshot = await loadSnapshot();
    const elapsed = Date.now() - startedAt;
    const status = snapshot.job?.status ?? null;
    const isTerminal = status !== null && TERMINAL_REPORT_JOB_STATUSES.has(status);
    if (isTerminal) {
      return {
        ...snapshot,
        timedOut: false,
        polls,
        waitedMs: elapsed,
      };
    }

    if (elapsed >= input.maxWaitMs) {
      return {
        ...snapshot,
        timedOut: true,
        polls,
        waitedMs: elapsed,
      };
    }

    await sleep(Math.min(input.pollIntervalMs, Math.max(input.maxWaitMs - elapsed, 1)));
  }
}

export async function waitForReportJobForUser(input: {
  jobId: string;
  userId: string;
  accessibleCompanyIds: string[];
  maxWaitMs: number;
  pollIntervalMs: number;
}): Promise<WaitForReportJobSnapshotResult> {
  return waitForReportJobSnapshot(async () => {
    const job = await getReportJobByIdForUser({
      jobId: input.jobId,
      userId: input.userId,
      accessibleCompanyIds: input.accessibleCompanyIds,
    });

    const artifacts = job
      ? await listReportJobArtifactsForUser({
          jobId: input.jobId,
          userId: input.userId,
          accessibleCompanyIds: input.accessibleCompanyIds,
        })
      : [];

    return { job, artifacts };
  }, input);
}
