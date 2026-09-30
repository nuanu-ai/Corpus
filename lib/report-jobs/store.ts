import { createHash, randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import { applyReportAnswerReviewSignal } from "@/lib/advisor-quality/report-answer-log";
import { db } from "@/lib/db";
import { auditLog, reportJobArtifacts, reportJobs, routineRuns } from "@/lib/db/schema";
import { enqueueOutboxEvent } from "@/lib/outbox";
import {
  createReportJobInputSchema,
  reportJobArtifactRecordSchema,
  reportJobRecordSchema,
  type CreateReportJobInput,
  type ReportJobArtifactRecord,
  type ReportJobRecord,
  type ReportJobSummary,
} from "@/lib/report-jobs/types";
import { planReportJob } from "@/lib/report-jobs/planner";

export const REPORT_JOB_REQUESTED_EVENT = "report-job/requested" as const;

type ReportJobOutboxExecutor = Pick<typeof db, "update" | "insert">;

export const ACTIVE_REUSABLE_STATUSES = [
  "planning",
  "planned",
  "queued",
  "running",
  "awaiting_clarification",
] as const;

export function normalizeReportJobRequestFingerprint(input: CreateReportJobInput): string {
  const canonicalBase = {
    companyId: input.companyId,
    request: input.request.trim().replace(/\s+/g, " ").toLowerCase(),
    outputFormat: input.outputFormat ?? "markdown",
    strictness: input.strictness ?? "standard",
  };
  const canonical = JSON.stringify(
    input.routineRunId
      ? { ...canonicalBase, routineRunId: input.routineRunId }
      : canonicalBase,
  );

  return createHash("sha256").update(canonical).digest("hex");
}

async function assertRoutineRunBelongsToCompany(input: {
  companyId: string;
  routineRunId: string | null | undefined;
}): Promise<void> {
  if (!input.routineRunId) return;
  const [run] = await db
    .select({ id: routineRuns.id })
    .from(routineRuns)
    .where(
      and(
        eq(routineRuns.id, input.routineRunId),
        eq(routineRuns.companyId, input.companyId),
      ),
    )
    .limit(1);
  if (!run) {
    throw new Error("routineRunId must belong to the report job company");
  }
}

function mapReportJobRow(row: {
  id: string;
  companyId: string;
  routineRunId: string | null;
  requestedByUserId: string;
  status: string;
  requestText: string;
  requestFingerprint: string;
  plannerVersion: number;
  outputFormat: string;
  strictness: string;
  intentJson: Record<string, unknown>;
  executionPlanJson: Record<string, unknown> | null;
  executionContextJson: Record<string, unknown>;
  resultSummaryJson: Record<string, unknown>;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ReportJobRecord {
  return reportJobRecordSchema.parse({
    id: row.id,
    companyId: row.companyId,
    routineRunId: row.routineRunId,
    requestedByUserId: row.requestedByUserId,
    status: row.status,
    requestText: row.requestText,
    requestFingerprint: row.requestFingerprint,
    plannerVersion: row.plannerVersion,
    outputFormat: row.outputFormat,
    strictness: row.strictness,
    intent: row.intentJson,
    executionPlan: row.executionPlanJson,
    executionContext: row.executionContextJson,
    resultSummary: row.resultSummaryJson,
    error: row.error,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function reportJobSelection() {
  return {
    id: reportJobs.id,
    companyId: reportJobs.companyId,
    routineRunId: reportJobs.routineRunId,
    requestedByUserId: reportJobs.requestedByUserId,
    status: reportJobs.status,
    requestText: reportJobs.requestText,
    requestFingerprint: reportJobs.requestFingerprint,
    plannerVersion: reportJobs.plannerVersion,
    outputFormat: reportJobs.outputFormat,
    strictness: reportJobs.strictness,
    intentJson: reportJobs.intentJson,
    executionPlanJson: reportJobs.executionPlanJson,
    executionContextJson: reportJobs.executionContextJson,
    resultSummaryJson: reportJobs.resultSummaryJson,
    error: reportJobs.error,
    startedAt: reportJobs.startedAt,
    completedAt: reportJobs.completedAt,
    createdAt: reportJobs.createdAt,
    updatedAt: reportJobs.updatedAt,
  };
}

function reportJobArtifactSelection() {
  return {
    id: reportJobArtifacts.id,
    reportJobId: reportJobArtifacts.reportJobId,
    companyId: reportJobArtifacts.companyId,
    kind: reportJobArtifacts.kind,
    fileName: reportJobArtifacts.fileName,
    mimeType: reportJobArtifacts.mimeType,
    downloadPath: reportJobArtifacts.downloadPath,
    viewPath: reportJobArtifacts.viewPath,
    reviewStatus: reportJobArtifacts.reviewStatus,
    reviewedBy: reportJobArtifacts.reviewedBy,
    reviewedAt: reportJobArtifacts.reviewedAt,
    reviewReason: reportJobArtifacts.reviewReason,
    publishedBy: reportJobArtifacts.publishedBy,
    publishedAt: reportJobArtifacts.publishedAt,
    publishedTargetDomain: reportJobArtifacts.publishedTargetDomain,
    publishedTargetPath: reportJobArtifacts.publishedTargetPath,
    commitSha: reportJobArtifacts.commitSha,
    metadata: reportJobArtifacts.metadata,
    createdAt: reportJobArtifacts.createdAt,
  };
}

function mapReportJobArtifactRow(row: {
  id: string;
  reportJobId: string;
  companyId: string;
  kind: string;
  fileName: string;
  mimeType: string | null;
  downloadPath: string | null;
  viewPath: string | null;
  reviewStatus: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewReason: string | null;
  publishedBy: string | null;
  publishedAt: Date | null;
  publishedTargetDomain: string | null;
  publishedTargetPath: string | null;
  commitSha: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}): ReportJobArtifactRecord {
  return reportJobArtifactRecordSchema.parse(row);
}

export async function createPlannedReportJob(input: {
  companyId: string;
  requestedByUserId: string;
  routineRunId?: string | null;
  request: string;
  outputFormat?: CreateReportJobInput["outputFormat"];
  strictness?: CreateReportJobInput["strictness"];
  executionContext?: Record<string, unknown>;
}): Promise<{ job: ReportJobRecord; reusedExistingJob: boolean }> {
  const normalized = createReportJobInputSchema.parse({
    companyId: input.companyId,
    routineRunId: input.routineRunId ?? null,
    request: input.request,
    outputFormat: input.outputFormat,
    strictness: input.strictness,
  });

  await assertRoutineRunBelongsToCompany({
    companyId: normalized.companyId,
    routineRunId: normalized.routineRunId,
  });

  const requestFingerprint = normalizeReportJobRequestFingerprint(normalized);
  const dedupeFilters = [
    eq(reportJobs.companyId, normalized.companyId),
    eq(reportJobs.requestedByUserId, input.requestedByUserId),
    eq(reportJobs.requestFingerprint, requestFingerprint),
    normalized.routineRunId
      ? eq(reportJobs.routineRunId, normalized.routineRunId)
      : isNull(reportJobs.routineRunId),
    inArray(reportJobs.status, [...ACTIVE_REUSABLE_STATUSES]),
  ];
  const [existing] = await db
    .select(reportJobSelection())
    .from(reportJobs)
    .where(and(...dedupeFilters))
    .orderBy(desc(reportJobs.createdAt))
    .limit(1);

  if (existing) {
    const job = mapReportJobRow(existing);
    return {
      job: {
        ...job,
        resultSummary: {
          ...job.resultSummary,
          reusedExistingJob: true,
        },
      },
      reusedExistingJob: true,
    };
  }

  const planned = planReportJob(normalized);
  const [inserted] = await db
    .insert(reportJobs)
    .values({
      companyId: normalized.companyId,
      routineRunId: normalized.routineRunId ?? null,
      requestedByUserId: input.requestedByUserId,
      status: planned.status,
      requestText: normalized.request,
      requestFingerprint,
      plannerVersion: 1,
      outputFormat: normalized.outputFormat ?? "markdown",
      strictness: normalized.strictness ?? "standard",
      intentJson: planned.intent,
      executionPlanJson: planned.executionPlan,
      executionContextJson: input.executionContext ?? {},
      resultSummaryJson: planned.resultSummary,
    })
    .returning(reportJobSelection());

  return {
    job: mapReportJobRow(inserted),
    reusedExistingJob: false,
  };
}

export async function queueReportJob(
  jobId: string,
  executor?: ReportJobOutboxExecutor,
): Promise<ReportJobRecord | null> {
  const queueInExecutor = async (tx: ReportJobOutboxExecutor) => {
    const [row] = await tx
      .update(reportJobs)
      .set({
        status: "queued",
        updatedAt: new Date(),
        resultSummaryJson: {
          phase: "execution",
          summary: "The report job is queued for execution.",
          nextAction: "Wait for the worker to finish and then fetch artifacts.",
          clarificationQuestions: [],
          warnings: [],
          highlights: [],
          metricsSnapshot: {},
          artifactCount: 0,
          reusedExistingJob: false,
        },
      })
      .where(and(eq(reportJobs.id, jobId), eq(reportJobs.status, "planned")))
      .returning(reportJobSelection());

    if (!row) return null;

    await enqueueOutboxEvent(tx, {
      name: REPORT_JOB_REQUESTED_EVENT,
      data: {
        jobId: row.id,
        companyId: row.companyId,
        routineRunId: row.routineRunId,
      },
    });

    return mapReportJobRow(row);
  };

  if (executor) return queueInExecutor(executor);
  return db.transaction(queueInExecutor);
}

export async function getReportJobForExecution(jobId: string): Promise<ReportJobRecord | null> {
  const [row] = await db
    .select(reportJobSelection())
    .from(reportJobs)
    .where(eq(reportJobs.id, jobId))
    .limit(1);

  return row ? mapReportJobRow(row) : null;
}

export async function beginReportJob(jobId: string): Promise<ReportJobRecord | null> {
  const [row] = await db
    .update(reportJobs)
    .set({
      status: "running",
      startedAt: new Date(),
      updatedAt: new Date(),
      resultSummaryJson: {
        phase: "execution",
        summary: "The report worker is executing the typed plan.",
        nextAction: "Poll the job until the artifact is ready.",
        clarificationQuestions: [],
        warnings: [],
        highlights: [],
        metricsSnapshot: {},
        artifactCount: 0,
        reusedExistingJob: false,
      },
    })
    .where(and(eq(reportJobs.id, jobId), inArray(reportJobs.status, ["planned", "queued"])))
    .returning(reportJobSelection());

  return row ? mapReportJobRow(row) : null;
}

export async function completeReportJob(
  jobId: string,
  summary: ReportJobSummary,
): Promise<ReportJobRecord | null> {
  const [row] = await db
    .update(reportJobs)
    .set({
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date(),
      error: null,
      resultSummaryJson: summary,
    })
    .where(eq(reportJobs.id, jobId))
    .returning(reportJobSelection());

  return row ? mapReportJobRow(row) : null;
}

export async function failReportJob(
  jobId: string,
  error: string,
  options?: {
    summary?: string;
    nextAction?: string;
    warnings?: string[];
    metricsSnapshot?: Record<string, unknown>;
  },
): Promise<ReportJobRecord | null> {
  const [row] = await db
    .update(reportJobs)
    .set({
      status: "failed",
      completedAt: new Date(),
      updatedAt: new Date(),
      error,
      resultSummaryJson: {
        phase: "failed",
        summary: options?.summary ?? "The report job failed during execution.",
        nextAction:
          options?.nextAction ??
          "Adjust the request or connector configuration and create a new job.",
        clarificationQuestions: [],
        warnings: options?.warnings ?? [],
        highlights: [],
        metricsSnapshot: options?.metricsSnapshot ?? {},
        artifactCount: 0,
        reusedExistingJob: false,
      },
    })
    .where(eq(reportJobs.id, jobId))
    .returning(reportJobSelection());

  return row ? mapReportJobRow(row) : null;
}

export async function failStaleReportJobs(input: {
  now?: Date;
  staleAfterMs?: number;
  limit?: number;
  reason?: string;
} = {}) {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? 6 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const limit = Math.max(1, Math.min(200, input.limit ?? 50));
  const staleRows = await db
    .select(reportJobSelection())
    .from(reportJobs)
    .where(and(eq(reportJobs.status, "running"), lt(reportJobs.updatedAt, cutoff)))
    .orderBy(asc(reportJobs.updatedAt))
    .limit(limit);

  const recovered: ReportJobRecord[] = [];
  const reason = input.reason ?? "Report job failed because it was running without progress past the stale-run cutoff.";
  for (const row of staleRows) {
    const [updated] = await db
      .update(reportJobs)
      .set({
        status: "failed",
        completedAt: now,
        updatedAt: now,
        error: reason,
        resultSummaryJson: {
          phase: "failed",
          summary: reason,
          nextAction: "Create or backfill a new report job when you are ready to retry.",
          clarificationQuestions: [],
          warnings: [],
          highlights: [],
          metricsSnapshot: {
            staleRecovery: {
              previousStatus: row.status,
              recoveredAt: now.toISOString(),
              cutoff: cutoff.toISOString(),
            },
          },
          artifactCount: 0,
          reusedExistingJob: false,
        },
      })
      .where(and(eq(reportJobs.id, row.id), eq(reportJobs.status, "running")))
      .returning(reportJobSelection());
    if (updated) recovered.push(mapReportJobRow(updated));
  }

  return {
    scanned: staleRows.length,
    recovered: recovered.length,
    cutoff,
    jobs: recovered,
  };
}

export async function createReportJobArtifact(input: {
  reportJobId: string;
  companyId: string;
  kind: string;
  fileName: string;
  mimeType?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<ReportJobArtifactRecord> {
  const artifactId = randomUUID();
  const basePath = `/api/agent/report-jobs/${input.reportJobId}/artifacts/${artifactId}`;

  const [row] = await db
    .insert(reportJobArtifacts)
    .values({
      id: artifactId,
      reportJobId: input.reportJobId,
      companyId: input.companyId,
      kind: input.kind,
      fileName: input.fileName,
      mimeType: input.mimeType ?? null,
      downloadPath: `${basePath}?download=1`,
      viewPath: basePath,
      reviewStatus: "pending",
      metadata: input.metadata ?? {},
    })
    .returning(reportJobArtifactSelection());

  return mapReportJobArtifactRow(row);
}

export async function listReportJobsForUser(input: {
  userId: string;
  accessibleCompanyIds: string[];
  companyId?: string | null;
  routineRunId?: string | null;
  limit?: number;
}): Promise<ReportJobRecord[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const companyIds =
    input.companyId && input.accessibleCompanyIds.includes(input.companyId)
      ? [input.companyId]
      : input.accessibleCompanyIds;
  if (companyIds.length === 0) return [];

  const filters = [
    eq(reportJobs.requestedByUserId, input.userId),
    inArray(reportJobs.companyId, companyIds),
  ];
  if (input.routineRunId) filters.push(eq(reportJobs.routineRunId, input.routineRunId));

  const rows = await db
    .select(reportJobSelection())
    .from(reportJobs)
    .where(and(...filters))
    .orderBy(desc(reportJobs.createdAt))
    .limit(limit);

  return rows.map(mapReportJobRow);
}

export async function listReportJobArtifactsForUser(input: {
  jobId: string;
  userId: string;
  accessibleCompanyIds: string[];
}): Promise<ReportJobArtifactRecord[]> {
  if (input.accessibleCompanyIds.length === 0) return [];

  const rows = await db
    .select(reportJobArtifactSelection())
    .from(reportJobArtifacts)
    .innerJoin(reportJobs, eq(reportJobArtifacts.reportJobId, reportJobs.id))
    .where(
      and(
        eq(reportJobArtifacts.reportJobId, input.jobId),
        eq(reportJobs.requestedByUserId, input.userId),
        inArray(reportJobArtifacts.companyId, input.accessibleCompanyIds),
      ),
    )
    .orderBy(desc(reportJobArtifacts.createdAt));

  return rows.map(mapReportJobArtifactRow);
}

export async function listReportJobsForRoutine(input: {
  companyId: string;
  routineId: string;
  routineRunId?: string | null;
  limit?: number;
}): Promise<Array<{ job: ReportJobRecord; artifacts: ReportJobArtifactRecord[] }>> {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const filters = [
    eq(reportJobs.companyId, input.companyId),
    eq(routineRuns.companyId, input.companyId),
    eq(routineRuns.routineId, input.routineId),
  ];
  if (input.routineRunId) filters.push(eq(reportJobs.routineRunId, input.routineRunId));
  const rows = await db
    .select(reportJobSelection())
    .from(reportJobs)
    .innerJoin(routineRuns, eq(reportJobs.routineRunId, routineRuns.id))
    .where(and(...filters))
    .orderBy(desc(reportJobs.createdAt))
    .limit(limit);

  const jobs = rows.map(mapReportJobRow);
  if (jobs.length === 0) return [];

  const artifacts = await db
    .select(reportJobArtifactSelection())
    .from(reportJobArtifacts)
    .where(
      and(
        eq(reportJobArtifacts.companyId, input.companyId),
        inArray(reportJobArtifacts.reportJobId, jobs.map((job) => job.id)),
      ),
    )
    .orderBy(desc(reportJobArtifacts.createdAt));
  const artifactsByJob = new Map<string, ReportJobArtifactRecord[]>();
  for (const artifact of artifacts.map(mapReportJobArtifactRow)) {
    const existing = artifactsByJob.get(artifact.reportJobId) ?? [];
    existing.push(artifact);
    artifactsByJob.set(artifact.reportJobId, existing);
  }

  return jobs.map((job) => ({
    job,
    artifacts: artifactsByJob.get(job.id) ?? [],
  }));
}

export async function summarizeReportArtifactsForRoutine(input: {
  companyId: string;
  routineId: string;
}): Promise<{
  pendingArtifactCount: number;
  latestArtifact: ReportJobArtifactRecord | null;
}> {
  const filters = [
    eq(reportJobArtifacts.companyId, input.companyId),
    eq(reportJobs.companyId, input.companyId),
    eq(routineRuns.companyId, input.companyId),
    eq(routineRuns.routineId, input.routineId),
  ];

  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reportJobArtifacts)
    .innerJoin(reportJobs, eq(reportJobArtifacts.reportJobId, reportJobs.id))
    .innerJoin(routineRuns, eq(reportJobs.routineRunId, routineRuns.id))
    .where(and(...filters, eq(reportJobArtifacts.reviewStatus, "pending")))
    .limit(1);

  const [latest] = await db
    .select(reportJobArtifactSelection())
    .from(reportJobArtifacts)
    .innerJoin(reportJobs, eq(reportJobArtifacts.reportJobId, reportJobs.id))
    .innerJoin(routineRuns, eq(reportJobs.routineRunId, routineRuns.id))
    .where(and(...filters))
    .orderBy(desc(reportJobArtifacts.createdAt))
    .limit(1);

  return {
    pendingArtifactCount: Number(pending?.count ?? 0),
    latestArtifact: latest ? mapReportJobArtifactRow(latest) : null,
  };
}

export async function getReportJobByIdForUser(input: {
  jobId: string;
  userId: string;
  accessibleCompanyIds: string[];
}): Promise<ReportJobRecord | null> {
  if (input.accessibleCompanyIds.length === 0) return null;
  const [row] = await db
    .select(reportJobSelection())
    .from(reportJobs)
    .where(
      and(
        eq(reportJobs.id, input.jobId),
        eq(reportJobs.requestedByUserId, input.userId),
        inArray(reportJobs.companyId, input.accessibleCompanyIds),
      ),
    )
    .limit(1);

  return row ? mapReportJobRow(row) : null;
}

export async function getReportJobArtifactByIdForUser(input: {
  artifactId: string;
  jobId: string;
  userId: string;
  accessibleCompanyIds: string[];
}): Promise<ReportJobArtifactRecord | null> {
  if (input.accessibleCompanyIds.length === 0) return null;

  const [row] = await db
    .select(reportJobArtifactSelection())
    .from(reportJobArtifacts)
    .innerJoin(reportJobs, eq(reportJobArtifacts.reportJobId, reportJobs.id))
    .where(
      and(
        eq(reportJobArtifacts.id, input.artifactId),
        eq(reportJobArtifacts.reportJobId, input.jobId),
        eq(reportJobs.requestedByUserId, input.userId),
        inArray(reportJobArtifacts.companyId, input.accessibleCompanyIds),
      ),
    )
    .limit(1);

  return row ? mapReportJobArtifactRow(row) : null;
}

export async function getReportJobArtifactForRoutine(input: {
  companyId: string;
  routineId: string;
  jobId: string;
  artifactId: string;
}): Promise<ReportJobArtifactRecord | null> {
  const [row] = await db
    .select(reportJobArtifactSelection())
    .from(reportJobArtifacts)
    .innerJoin(reportJobs, eq(reportJobArtifacts.reportJobId, reportJobs.id))
    .innerJoin(routineRuns, eq(reportJobs.routineRunId, routineRuns.id))
    .where(
      and(
        eq(reportJobArtifacts.id, input.artifactId),
        eq(reportJobArtifacts.reportJobId, input.jobId),
        eq(reportJobArtifacts.companyId, input.companyId),
        eq(reportJobs.companyId, input.companyId),
        eq(routineRuns.companyId, input.companyId),
        eq(routineRuns.routineId, input.routineId),
      ),
    )
    .limit(1);

  return row ? mapReportJobArtifactRow(row) : null;
}

export async function claimReportJobArtifactForApproval(input: {
  companyId: string;
  artifactId: string;
  reviewedBy: string;
}): Promise<ReportJobArtifactRecord | null> {
  const [row] = await db
    .update(reportJobArtifacts)
    .set({
      reviewStatus: "approving",
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
      reviewReason: null,
    })
    .where(
      and(
        eq(reportJobArtifacts.companyId, input.companyId),
        eq(reportJobArtifacts.id, input.artifactId),
        eq(reportJobArtifacts.reviewStatus, "pending"),
      ),
    )
    .returning(reportJobArtifactSelection());

  return row ? mapReportJobArtifactRow(row) : null;
}

export async function releaseReportJobArtifactApprovalClaim(input: {
  companyId: string;
  artifactId: string;
  reviewedBy: string;
  error: string;
}): Promise<ReportJobArtifactRecord | null> {
  const [row] = await db
    .update(reportJobArtifacts)
    .set({
      reviewStatus: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: `Approval failed before publish: ${input.error}`.slice(0, 500),
      publishedBy: null,
      publishedAt: null,
      publishedTargetDomain: null,
      publishedTargetPath: null,
      commitSha: null,
    })
    .where(
      and(
        eq(reportJobArtifacts.companyId, input.companyId),
        eq(reportJobArtifacts.id, input.artifactId),
        eq(reportJobArtifacts.reviewStatus, "approving"),
        eq(reportJobArtifacts.reviewedBy, input.reviewedBy),
      ),
    )
    .returning(reportJobArtifactSelection());

  return row ? mapReportJobArtifactRow(row) : null;
}

export async function resolveReportJobArtifactReview(input: {
  companyId: string;
  artifactId: string;
  status: "approved" | "rejected";
  reviewedBy: string;
  reviewReason?: string | null;
  publishedTargetDomain?: string | null;
  publishedTargetPath?: string | null;
  commitSha?: string | null;
  expectedStatus?: "pending" | "approving";
}): Promise<ReportJobArtifactRecord | null> {
  return db.transaction(async (tx) => {
    const reviewedAt = new Date();
    const filters = [
      eq(reportJobArtifacts.companyId, input.companyId),
      eq(reportJobArtifacts.id, input.artifactId),
    ];
    if (input.expectedStatus) {
      filters.push(eq(reportJobArtifacts.reviewStatus, input.expectedStatus));
    }

    const [existing] = await tx
      .select({ metadata: reportJobArtifacts.metadata })
      .from(reportJobArtifacts)
      .where(and(...filters))
      .limit(1);
    if (!existing) return null;

    const [row] = await tx
      .update(reportJobArtifacts)
      .set({
        reviewStatus: input.status,
        reviewedBy: input.reviewedBy,
        reviewedAt,
        reviewReason: input.reviewReason ?? null,
        publishedBy: input.status === "approved" ? input.reviewedBy : null,
        publishedAt: input.status === "approved" ? reviewedAt : null,
        publishedTargetDomain:
          input.status === "approved" ? input.publishedTargetDomain ?? null : null,
        publishedTargetPath:
          input.status === "approved" ? input.publishedTargetPath ?? null : null,
        commitSha: input.status === "approved" ? input.commitSha ?? null : null,
        metadata: applyReportAnswerReviewSignal({
          metadata: existing.metadata ?? {},
          reviewStatus: input.status,
          reviewedBy: input.reviewedBy,
          reviewedAt,
          reviewReason: input.reviewReason,
        }),
      })
      .where(and(...filters))
      .returning(reportJobArtifactSelection());

    if (!row) return null;

    await tx.insert(auditLog).values({
      companyId: input.companyId,
      userId: input.reviewedBy,
      action: input.status === "approved"
        ? "report_artifact_approved"
        : "report_artifact_rejected",
      entityType: "report_job_artifact",
      entityId: input.artifactId,
      oldValue: { reviewStatus: input.expectedStatus ?? null },
      newValue: {
        reviewStatus: input.status,
        publishedTargetDomain: input.publishedTargetDomain ?? null,
        publishedTargetPath: input.publishedTargetPath ?? null,
        commitSha: input.commitSha ?? null,
      },
      details: {
        reviewReason: input.reviewReason ?? null,
      },
    });

    return mapReportJobArtifactRow(row);
  });
}

export async function cancelReportJobsForRoutineRun(input: {
  companyId: string;
  routineRunId: string;
  reason?: string;
}): Promise<ReportJobRecord[]> {
  const rows = await db
    .update(reportJobs)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      updatedAt: new Date(),
      resultSummaryJson: {
        phase: "cancelled",
        summary: input.reason ?? "The parent routine run was cancelled.",
        nextAction: "Create or backfill a new routine run when you are ready.",
        artifactCount: 0,
        clarificationQuestions: [],
        warnings: [],
        highlights: [],
        metricsSnapshot: {},
        reusedExistingJob: false,
      },
    })
    .where(
      and(
        eq(reportJobs.companyId, input.companyId),
        eq(reportJobs.routineRunId, input.routineRunId),
        inArray(reportJobs.status, ["planning", "planned", "queued", "awaiting_clarification"]),
      ),
    )
    .returning(reportJobSelection());

  return rows.map(mapReportJobRow);
}

export async function cancelReportJobForUser(input: {
  jobId: string;
  userId: string;
  accessibleCompanyIds: string[];
}): Promise<ReportJobRecord | null> {
  if (input.accessibleCompanyIds.length === 0) return null;

  const [row] = await db
    .update(reportJobs)
    .set({
      status: "cancelled",
      completedAt: new Date(),
      updatedAt: new Date(),
      resultSummaryJson: {
        phase: "cancelled",
        summary: "The report job was cancelled before execution.",
        nextAction: "Create a new report job when you are ready to run it again.",
        artifactCount: 0,
        clarificationQuestions: [],
        warnings: [],
        highlights: [],
        metricsSnapshot: {},
        reusedExistingJob: false,
      },
    })
    .where(
      and(
        eq(reportJobs.id, input.jobId),
        eq(reportJobs.requestedByUserId, input.userId),
        inArray(reportJobs.companyId, input.accessibleCompanyIds),
        inArray(reportJobs.status, ["planning", "planned", "queued", "awaiting_clarification"]),
      ),
    )
    .returning(reportJobSelection());

  return row ? mapReportJobRow(row) : null;
}
