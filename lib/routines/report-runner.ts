import {
  createReportSourceEvidenceSnapshot,
  mergeSourceEvidenceSnapshotIntoExecutionContext,
} from "@/lib/report-jobs/source-evidence";
import {
  createPlannedReportJob,
  queueReportJob,
} from "@/lib/report-jobs/store";
import {
  getCompanyRoutine,
  getRoutineRun,
  updateRoutineRun,
} from "@/lib/routines/store";
import {
  DAILY_FINANCE_REPORT_TEMPLATE_KEY,
  MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY,
  type RoutineRunStatus,
  WEEKLY_OPERATING_REPORT_TEMPLATE_KEY,
  isReportAutomationTemplateKey,
} from "@/lib/routines/types";
import {
  resolveReportBuiltInSources,
  type ReportBuiltInSourceId,
} from "@/lib/routines/report-sources";

const REPORT_TIMEZONE = "UTC";

function formatLocalDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function reportWindow(input: {
  windowStart: Date | null;
  windowEnd: Date | null;
}): {
  startDate: string;
  endDate: string;
  label: string;
  timezone: string;
} {
  const timezone = REPORT_TIMEZONE;
  const endExclusive = input.windowEnd ?? new Date();
  const start = input.windowStart ?? new Date(endExclusive.getTime() - 7 * 24 * 60 * 60 * 1000);
  const endInclusive = new Date(endExclusive.getTime() - 1);
  const startDate = formatLocalDate(start, timezone);
  const endDate = formatLocalDate(endInclusive, timezone);
  return {
    startDate,
    endDate,
    label: `${startDate} to ${endDate}`,
    timezone,
  };
}

function sourcePhrase(sourceIds: readonly ReportBuiltInSourceId[]): string {
  const labels: Record<ReportBuiltInSourceId, string> = {
    company_db: "Company-DB",
    odoo: "Odoo",
    documents: "processed document",
  };
  return sourceIds.map((sourceId) => labels[sourceId]).join(", ");
}

function requestForTemplate(
  templateKey: string,
  window: ReturnType<typeof reportWindow>,
  sourceIds: readonly ReportBuiltInSourceId[],
): {
  request: string;
  outputFormat: "markdown" | "xlsx";
} {
  const sources = sourcePhrase(sourceIds);
  if (templateKey === DAILY_FINANCE_REPORT_TEMPLATE_KEY) {
    return {
      request: `Prepare a revenue report from ${window.startDate} to ${window.endDate} using ${sources} evidence.`,
      outputFormat: "markdown",
    };
  }
  if (templateKey === WEEKLY_OPERATING_REPORT_TEMPLATE_KEY) {
    return {
      request: `Prepare a revenue report from ${window.startDate} to ${window.endDate} by venue using ${sources} evidence.`,
      outputFormat: "xlsx",
    };
  }
  if (templateKey === MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY) {
    return {
      request: `Prepare a profit and loss report from ${window.startDate} to ${window.endDate} by venue using ${sources} evidence.`,
      outputFormat: "xlsx",
    };
  }
  return {
    request: `Prepare a revenue report from ${window.startDate} to ${window.endDate} using ${sources} evidence.`,
    outputFormat: "markdown",
  };
}

function routineRunStatusForChildJob(jobStatus: string): RoutineRunStatus {
  if (jobStatus === "completed") return "completed";
  if (jobStatus === "failed" || jobStatus === "cancelled") return "failed";
  if (jobStatus === "awaiting_clarification") return "completed_with_errors";
  return "running";
}

function maxItemsPerSource(sourcePolicy: unknown): number {
  if (!sourcePolicy || typeof sourcePolicy !== "object" || Array.isArray(sourcePolicy)) return 50;
  const value = (sourcePolicy as Record<string, unknown>).maxItemsPerSource;
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(1, Math.min(200, value))
    : 50;
}

export async function executeReportAutomationRun(input: {
  companyId: string;
  routineId: string;
  runId: string;
  requestedByUserId?: string | null;
}): Promise<{
  status: "completed" | "failed" | "skipped";
  routineId: string;
  runId: string;
  reportJobId?: string;
  reason?: string;
}> {
  const routine = await getCompanyRoutine(input.companyId, input.routineId);
  if (!routine) {
    return {
      status: "skipped",
      routineId: input.routineId,
      runId: input.runId,
      reason: "routine_not_found",
    };
  }
  if (!isReportAutomationTemplateKey(routine.templateKey)) {
    return {
      status: "skipped",
      routineId: input.routineId,
      runId: input.runId,
      reason: "not_report_automation",
    };
  }
  const run = await getRoutineRun({
    companyId: input.companyId,
    routineId: input.routineId,
    runId: input.runId,
  });
  if (!run) {
    return {
      status: "skipped",
      routineId: input.routineId,
      runId: input.runId,
      reason: "run_not_found",
    };
  }
  if (
    run.status === "cancelled" ||
    run.status === "completed" ||
    run.status === "completed_with_errors" ||
    run.status === "failed"
  ) {
    return {
      status: "skipped",
      routineId: input.routineId,
      runId: input.runId,
      reason: `run_already_${run.status}`,
    };
  }

  const ownerUserId = input.requestedByUserId ?? routine.ownerUserId ?? routine.createdByUserId;
  if (!ownerUserId) {
    await updateRoutineRun({
      companyId: input.companyId,
      routineId: input.routineId,
      runId: input.runId,
      status: "failed",
      error: "Report automation has no owner user id",
      finishedAt: new Date(),
      activeOnly: true,
    });
    return {
      status: "failed",
      routineId: input.routineId,
      runId: input.runId,
      reason: "owner_user_missing",
    };
  }

  await updateRoutineRun({
    companyId: input.companyId,
    routineId: input.routineId,
    runId: input.runId,
    status: "running",
    startedAt: new Date(),
    activeOnly: true,
  });

  try {
    const window = reportWindow({
      windowStart: run.windowStart,
      windowEnd: run.windowEnd,
    });
    const enabledReportSources = resolveReportBuiltInSources(routine.sourcePolicy);
    const sourceItemLimit = maxItemsPerSource(routine.sourcePolicy);
    const reportRequest = requestForTemplate(routine.templateKey, window, enabledReportSources);
    const sourceEvidence = createReportSourceEvidenceSnapshot(
      enabledReportSources.map((sourceId) => {
        if (sourceId === "odoo") {
          return {
            source: "odoo",
            status: "partial" as const,
            label: "Odoo finance connector",
            reason: "The report worker will collect bounded live Odoo finance evidence for this run.",
            window,
          };
        }
        if (sourceId === "company_db") {
          return {
            source: "company_db",
            status: "partial" as const,
            label: "Company-DB finance evidence",
            reason: "The report worker will collect compact Company-DB finance cross-checks for this run.",
            window,
          };
        }
        return {
          source: "documents",
          status: "partial" as const,
          label: "Processed company documents",
          reason: "The report worker will collect bounded processed document evidence for this run.",
          window,
        };
      }),
      { generatedAt: new Date().toISOString() },
    );
    const executionContext = mergeSourceEvidenceSnapshotIntoExecutionContext(
      {
        surface: "routine_automation",
        routineId: routine.id,
        routineRunId: run.id,
        templateKey: routine.templateKey,
        companyAccessSource: "direct",
        allowedDomains: null,
        domainAccessLevels: null,
        allowedConnectorScopes: null,
        enabledReportSources,
        maxItemsPerSource: sourceItemLimit,
      },
      sourceEvidence,
    );
    const created = await createPlannedReportJob({
      companyId: input.companyId,
      requestedByUserId: ownerUserId,
      routineRunId: run.id,
      request: reportRequest.request,
      outputFormat: reportRequest.outputFormat,
      strictness: "standard",
      executionContext,
    });

    let job = created.job;
    if (job.status === "planned") {
      const queued = await queueReportJob(job.id);
      if (queued) job = queued;
    }

    await updateRoutineRun({
      companyId: input.companyId,
      routineId: input.routineId,
      runId: input.runId,
      status: routineRunStatusForChildJob(job.status),
      stats: {
        reportJobId: job.id,
        reportJobStatus: job.status,
        reusedExistingJob: created.reusedExistingJob,
        childExecutionStatus:
          job.status === "queued" || job.status === "planned" || job.status === "running"
            ? "report_job_queued"
            : "report_job_terminal",
        sourceEvidence: sourceEvidence.summary,
      },
      ...(job.status === "queued" || job.status === "planned" || job.status === "running"
        ? {}
        : { finishedAt: new Date() }),
      activeOnly: true,
    });

    return {
      status: "completed",
      routineId: input.routineId,
      runId: input.runId,
      reportJobId: job.id,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await updateRoutineRun({
      companyId: input.companyId,
      routineId: input.routineId,
      runId: input.runId,
      status: "failed",
      error: reason,
      finishedAt: new Date(),
      activeOnly: true,
    });
    return {
      status: "failed",
      routineId: input.routineId,
      runId: input.runId,
      reason,
    };
  }
}
