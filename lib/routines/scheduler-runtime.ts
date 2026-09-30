import { enqueueOutboxEvent } from "@/lib/outbox";
import { failStaleReportJobs } from "@/lib/report-jobs/store";
import {
  RoutineScheduledWindowConflictError,
  appendRoutineRunSchedulerEvent,
  createOrGetScheduledWindowRoutineRun,
  failStaleRoutineRuns,
  listActiveRoutineScheduleCandidates,
} from "@/lib/routines/store";
import {
  LEGAL_WATCH_BKPM_TEMPLATE_KEY,
  LEGAL_WATCH_RUN_EVENT,
  ROUTINE_REPORT_RUN_EVENT,
  isReportAutomationTemplateKey,
} from "@/lib/routines/types";
import {
  evaluateDueRoutineRun,
  previewBackfillRoutineScheduleWindows,
} from "@/lib/routines/scheduler";

const DEFAULT_SCAN_LIMIT = 100;

interface RoutineScheduleCandidate {
  id: string;
  companyId: string;
  templateKey: string;
  status: string;
  schedulePolicy: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

export interface RoutineSchedulerScanResult {
  enabled: boolean;
  scanned: number;
  due: number;
  queued: number;
  existing: number;
  blocked: number;
  skipped: number;
  errors: number;
  details: Array<{
    routineId: string;
    companyId: string;
    action: "queued" | "existing" | "blocked" | "skipped" | "error";
    reason?: string;
    runId?: string;
    periodKey?: string;
  }>;
}

export interface RoutineStaleRunReaperResult {
  enabled: boolean;
  scanned: number;
  recovered: number;
  cutoff?: string;
  reportJobs?: {
    scanned: number;
    recovered: number;
    cutoff?: string;
  };
}

export interface RoutineBackfillRunWindowResult {
  periodKey: string;
  windowStart: string;
  windowEnd: string;
  dueAt: string;
  idempotencyKey: string;
  action: "preview" | "queued" | "existing" | "blocked" | "error";
  runId?: string;
  reason?: string;
}

export interface RoutineBackfillRunResult {
  ok: boolean;
  dryRun: boolean;
  routineId: string;
  companyId: string;
  windowCount: number;
  queued: number;
  existing: number;
  blocked: number;
  errors: number;
  windows: RoutineBackfillRunWindowResult[];
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSchedulerEnabled(policy: unknown): policy is Record<string, unknown> {
  return isRecord(policy) && policy.schedulerEnabled === true;
}

function canScheduleRunner(routine: RoutineScheduleCandidate): boolean {
  if (routine.templateKey === LEGAL_WATCH_BKPM_TEMPLATE_KEY) return true;
  return (
    isReportAutomationTemplateKey(routine.templateKey) &&
    routine.metadata?.sourcesConfigured === true
  );
}

function eventNameForRoutine(routine: RoutineScheduleCandidate): string {
  return isReportAutomationTemplateKey(routine.templateKey)
    ? ROUTINE_REPORT_RUN_EVENT
    : LEGAL_WATCH_RUN_EVENT;
}

function serializeBackfillWindow(
  window: ReturnType<typeof previewBackfillRoutineScheduleWindows>["windows"][number],
  action: RoutineBackfillRunWindowResult["action"],
  extra: Pick<RoutineBackfillRunWindowResult, "runId" | "reason"> = {},
): RoutineBackfillRunWindowResult {
  return {
    periodKey: window.periodKey,
    windowStart: window.windowStart.toISOString(),
    windowEnd: window.windowEnd.toISOString(),
    dueAt: window.dueAt.toISOString(),
    idempotencyKey: window.idempotencyKey,
    action,
    ...extra,
  };
}

async function recordSchedulerEvent(input: {
  companyId: string;
  runId: string;
  currentStats?: Record<string, unknown> | null;
  kind: "scheduler_existing_window" | "scheduler_blocked_overlap";
  periodKey?: string;
  windowStart?: Date;
  windowEnd?: Date;
  message: string;
  now: Date;
}) {
  try {
    await appendRoutineRunSchedulerEvent({
      companyId: input.companyId,
      runId: input.runId,
      currentStats: input.currentStats,
      event: {
        kind: input.kind,
        observedAt: input.now.toISOString(),
        periodKey: input.periodKey,
        windowStart: input.windowStart?.toISOString(),
        windowEnd: input.windowEnd?.toISOString(),
        message: input.message,
      },
    });
  } catch (error) {
    console.warn("[routine-scheduler] failed to record scheduler event", error);
  }
}

export async function scanDueRoutineSchedules(input: {
  now?: Date;
  limit?: number;
  enabled?: boolean;
} = {}): Promise<RoutineSchedulerScanResult> {
  const enabled = input.enabled ?? process.env.ROUTINE_SCHEDULER_ENABLED === "1";
  const result: RoutineSchedulerScanResult = {
    enabled,
    scanned: 0,
    due: 0,
    queued: 0,
    existing: 0,
    blocked: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };
  if (!enabled) return result;

  const now = input.now ?? new Date();
  const routines = await listActiveRoutineScheduleCandidates(input.limit ?? DEFAULT_SCAN_LIMIT);

  for (const routine of routines) {
    result.scanned += 1;
    if (!isSchedulerEnabled(routine.schedulePolicy)) {
      result.skipped += 1;
      result.details.push({
        routineId: routine.id,
        companyId: routine.companyId,
        action: "skipped",
        reason: "scheduler disabled for routine",
      });
      continue;
    }
    if (!canScheduleRunner(routine)) {
      result.skipped += 1;
      result.details.push({
        routineId: routine.id,
        companyId: routine.companyId,
        action: "skipped",
        reason: "runner is not enabled for this automation template",
      });
      continue;
    }

    const decision = evaluateDueRoutineRun({
      routineId: routine.id,
      routineStatus: routine.status,
      schedulePolicy: routine.schedulePolicy,
      now,
    });
    if (decision.action !== "enqueue") {
      result.skipped += 1;
      result.details.push({
        routineId: routine.id,
        companyId: routine.companyId,
        action: "skipped",
        reason: decision.reason,
        periodKey: decision.window?.periodKey,
      });
      continue;
    }

    result.due += 1;
    try {
      const { run, created } = await createOrGetScheduledWindowRoutineRun({
        companyId: routine.companyId,
        routineId: routine.id,
        trigger: "scheduled",
        windowStart: decision.window.windowStart,
        windowEnd: decision.window.windowEnd,
        afterCreate: async (tx, createdRun) => {
          await enqueueOutboxEvent(tx, {
            name: eventNameForRoutine(routine),
            data: {
              companyId: routine.companyId,
              routineId: routine.id,
              runId: createdRun.id,
              trigger: "scheduled",
              windowStart: decision.window.windowStart.toISOString(),
              windowEnd: decision.window.windowEnd.toISOString(),
              periodKey: decision.window.periodKey,
            },
          });
        },
      });
      if (created) result.queued += 1;
      else {
        result.existing += 1;
        await recordSchedulerEvent({
          companyId: routine.companyId,
          runId: run.id,
          currentStats: isRecord(run.stats) ? run.stats : null,
          kind: "scheduler_existing_window",
          periodKey: decision.window.periodKey,
          windowStart: decision.window.windowStart,
          windowEnd: decision.window.windowEnd,
          message: "Scheduler found an existing run for this exact window and did not enqueue a duplicate.",
          now,
        });
      }
      result.details.push({
        routineId: routine.id,
        companyId: routine.companyId,
        action: created ? "queued" : "existing",
        runId: run.id,
        periodKey: decision.window.periodKey,
      });
    } catch (error) {
      if (error instanceof RoutineScheduledWindowConflictError) {
        result.blocked += 1;
        await recordSchedulerEvent({
          companyId: routine.companyId,
          runId: error.conflictingRun.id,
          currentStats: isRecord(error.conflictingRun.stats)
            ? error.conflictingRun.stats
            : null,
          kind: "scheduler_blocked_overlap",
          periodKey: decision.window.periodKey,
          windowStart: decision.window.windowStart,
          windowEnd: decision.window.windowEnd,
          message: "Scheduler blocked this due window because another scheduled/backfill run is still active.",
          now,
        });
        result.details.push({
          routineId: routine.id,
          companyId: routine.companyId,
          action: "blocked",
          reason: "active scheduled/backfill run overlaps the due window",
          runId: error.conflictingRun.id,
          periodKey: decision.window.periodKey,
        });
        continue;
      }
      result.errors += 1;
      result.details.push({
        routineId: routine.id,
        companyId: routine.companyId,
        action: "error",
        reason: error instanceof Error ? error.message : String(error),
        periodKey: decision.window.periodKey,
      });
    }
  }

  return result;
}

export async function enqueueRoutineBackfillRuns(input: {
  routine: RoutineScheduleCandidate;
  windowStart: Date;
  windowEnd: Date;
  dryRun?: boolean;
  confirm?: boolean;
  requestedByUserId?: string | null;
  maxWindowCount?: number;
  now?: Date;
}): Promise<RoutineBackfillRunResult> {
  const dryRun = input.dryRun !== false;
  const result: RoutineBackfillRunResult = {
    ok: true,
    dryRun,
    routineId: input.routine.id,
    companyId: input.routine.companyId,
    windowCount: 0,
    queued: 0,
    existing: 0,
    blocked: 0,
    errors: 0,
    windows: [],
  };

  if (!canScheduleRunner(input.routine)) {
    return {
      ...result,
      ok: false,
      error: "runner is not enabled for this automation template",
    };
  }

  const preview = previewBackfillRoutineScheduleWindows({
    routineId: input.routine.id,
    schedulePolicy: input.routine.schedulePolicy,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    maxWindowCount: input.maxWindowCount,
  });
  if (!preview.ok) {
    return {
      ...result,
      ok: false,
      error: preview.error ?? "invalid backfill window",
    };
  }

  result.windowCount = preview.windows.length;
  if (dryRun) {
    result.windows = preview.windows.map((window) => serializeBackfillWindow(window, "preview"));
    return result;
  }
  if (input.confirm !== true) {
    return {
      ...result,
      ok: false,
      error: "confirm=true is required to enqueue backfill runs",
    };
  }

  const now = input.now ?? new Date();
  for (const window of preview.windows) {
    try {
      const { run, created } = await createOrGetScheduledWindowRoutineRun({
        companyId: input.routine.companyId,
        routineId: input.routine.id,
        trigger: "backfill",
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        afterCreate: async (tx, createdRun) => {
          await enqueueOutboxEvent(tx, {
            name: eventNameForRoutine(input.routine),
            data: {
              companyId: input.routine.companyId,
              routineId: input.routine.id,
              runId: createdRun.id,
              trigger: "backfill",
              requestedByUserId: input.requestedByUserId ?? null,
              windowStart: window.windowStart.toISOString(),
              windowEnd: window.windowEnd.toISOString(),
              periodKey: window.periodKey,
            },
          });
        },
      });
      if (created) {
        result.queued += 1;
        result.windows.push(serializeBackfillWindow(window, "queued", { runId: run.id }));
      } else {
        result.existing += 1;
        await recordSchedulerEvent({
          companyId: input.routine.companyId,
          runId: run.id,
          currentStats: isRecord(run.stats) ? run.stats : null,
          kind: "scheduler_existing_window",
          periodKey: window.periodKey,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          message: "Backfill found an existing run for this exact window and did not enqueue a duplicate.",
          now,
        });
        result.windows.push(serializeBackfillWindow(window, "existing", { runId: run.id }));
      }
    } catch (error) {
      if (error instanceof RoutineScheduledWindowConflictError) {
        result.blocked += 1;
        await recordSchedulerEvent({
          companyId: input.routine.companyId,
          runId: error.conflictingRun.id,
          currentStats: isRecord(error.conflictingRun.stats)
            ? error.conflictingRun.stats
            : null,
          kind: "scheduler_blocked_overlap",
          periodKey: window.periodKey,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          message: "Backfill blocked this window because another scheduled/backfill run is still active.",
          now,
        });
        result.windows.push(serializeBackfillWindow(window, "blocked", {
          runId: error.conflictingRun.id,
          reason: "active scheduled/backfill run overlaps this window",
        }));
        continue;
      }
      result.errors += 1;
      result.windows.push(serializeBackfillWindow(window, "error", {
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  return {
    ...result,
    ok: result.errors === 0,
  };
}

export async function reapStaleRoutineRuns(input: {
  enabled?: boolean;
  now?: Date;
  staleAfterMs?: number;
  limit?: number;
} = {}): Promise<RoutineStaleRunReaperResult> {
  const enabled = input.enabled ?? process.env.ROUTINE_STALE_RUN_REAPER_ENABLED === "1";
  if (!enabled) {
    return { enabled: false, scanned: 0, recovered: 0 };
  }
  const result = await failStaleRoutineRuns({
    now: input.now,
    staleAfterMs: input.staleAfterMs,
    limit: input.limit,
  });
  const reportJobs = await failStaleReportJobs({
    now: input.now,
    staleAfterMs: input.staleAfterMs,
    limit: input.limit,
  });
  return {
    enabled: true,
    scanned: result.scanned,
    recovered: result.recovered,
    cutoff: result.cutoff.toISOString(),
    reportJobs: {
      scanned: reportJobs.scanned,
      recovered: reportJobs.recovered,
      cutoff: reportJobs.cutoff.toISOString(),
    },
  };
}
