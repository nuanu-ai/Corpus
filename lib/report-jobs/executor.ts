import {
  collectReportCompanyDbSourceEvidence,
  collectReportDocumentsSourceEvidence,
  collectReportOdooSourceEvidence,
} from "@/lib/report-jobs/source-adapters";
import { renderReportArtifacts } from "@/lib/report-jobs/render";
import {
  createReportSourceEvidenceSnapshot,
  type ReportSourceEvidenceInput,
} from "@/lib/report-jobs/source-evidence";
import {
  beginReportJob,
  completeReportJob,
  createReportJobArtifact,
  failReportJob,
  getReportJobForExecution,
} from "@/lib/report-jobs/store";
import { requireReportJobExecutionAccess } from "@/lib/report-jobs/access";
import { updateRoutineRun } from "@/lib/routines/store";
import {
  resolveReportBuiltInSources,
  type ReportBuiltInSourceId,
} from "@/lib/routines/report-sources";
import type { EntityResult } from "@/lib/company-db/client";
import type { ReportFinanceSnapshot } from "@/lib/report-jobs/odoo-finance";

function summarizeFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "Report execution failed";
}

function emptyFinanceSnapshot(): ReportFinanceSnapshot {
  return {
    rows: [],
    breakdowns: [],
    totals: {
      revenueTotal: 0,
      expenseTotal: 0,
      netTotal: 0,
      currency: null,
      revenueCount: 0,
      expenseCount: 0,
    },
  };
}

function enabledReportSourcesFromContext(context: Record<string, unknown>): ReportBuiltInSourceId[] {
  return resolveReportBuiltInSources({ builtInSources: context.enabledReportSources });
}

function maxItemsPerSourceFromContext(context: Record<string, unknown>): number {
  const value = context.maxItemsPerSource;
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(1, Math.min(200, value))
    : 50;
}

async function completeParentRoutineRun(input: {
  job: { id: string; companyId: string; routineRunId: string | null; status?: string };
  status: "completed" | "completed_with_errors" | "failed";
  stats?: Record<string, unknown>;
  error?: string | null;
}) {
  if (!input.job.routineRunId) return;
  await updateRoutineRun({
    companyId: input.job.companyId,
    runId: input.job.routineRunId,
    status: input.status,
    mergeStats: true,
    stats: {
      reportJobId: input.job.id,
      reportJobStatus: input.job.status ?? (input.status === "failed" ? "failed" : "completed"),
      ...(input.stats ?? {}),
    },
    error: input.error,
    finishedAt: new Date(),
    activeOnly: true,
  });
}

export async function executeReportJob(jobId: string): Promise<{
  status: "completed" | "failed" | "skipped";
  jobId: string;
  artifactCount?: number;
  reason?: string;
}> {
  const current = await getReportJobForExecution(jobId);
  if (!current) {
    return { status: "skipped", jobId, reason: "job_not_found" };
  }

  if (["completed", "failed", "cancelled", "awaiting_clarification"].includes(current.status)) {
    return { status: "skipped", jobId, reason: current.status };
  }

  const job = await beginReportJob(jobId);
  if (!job) {
    return { status: "skipped", jobId, reason: "already_started" };
  }

  let executionAccessChecked = false;
  try {
    if (!job.executionPlan || job.executionPlan.planStatus !== "ready") {
      throw new Error("The report job does not have an executable plan.");
    }
    requireReportJobExecutionAccess(job);
    executionAccessChecked = true;

    const warnings: string[] = [];
    let finance = emptyFinanceSnapshot();
    let companyDbEvidence: EntityResult[] = [];
    let documentEvidenceCount = 0;
    const sourceEvidenceInputs: ReportSourceEvidenceInput[] = [];
    const enabledReportSources = enabledReportSourcesFromContext(job.executionContext);
    const maxItemsPerSource = maxItemsPerSourceFromContext(job.executionContext);

    if (enabledReportSources.includes("odoo")) {
      const odooResult = await collectReportOdooSourceEvidence({ intent: job.intent });
      finance = odooResult.payload?.odooFinance ?? finance;
      sourceEvidenceInputs.push(odooResult.source);
      if (odooResult.source.error) warnings.push(odooResult.source.error);
    }

    if (enabledReportSources.includes("company_db")) {
      const companyDbResult = await collectReportCompanyDbSourceEvidence({
        companyId: job.companyId,
        intent: job.intent,
        domains: ["finance"],
        limit: maxItemsPerSource,
      });
      companyDbEvidence = companyDbResult.payload?.companyDbEvidence ?? [];
      sourceEvidenceInputs.push(companyDbResult.source);
      if (companyDbResult.source.error) warnings.push(companyDbResult.source.error);
    }

    if (enabledReportSources.includes("documents")) {
      const documentsResult = await collectReportDocumentsSourceEvidence({
        companyId: job.companyId,
        limit: maxItemsPerSource,
      });
      documentEvidenceCount = documentsResult.payload?.documents?.length ?? 0;
      sourceEvidenceInputs.push(documentsResult.source);
      if (documentsResult.source.error) warnings.push(documentsResult.source.error);
    }

    const sourceEvidence = createReportSourceEvidenceSnapshot(sourceEvidenceInputs);
    for (const source of sourceEvidence.sources) {
      if (source.unavailableWording) warnings.push(source.unavailableWording);
    }
    if (!enabledReportSources.includes("odoo")) {
      warnings.push(
        "Odoo finance source is disabled for this automation; do not treat connector totals as zero.",
      );
    }

    const artifacts = await renderReportArtifacts({
      intent: job.intent,
      finance,
      warnings,
      companyDbEvidence,
      sourceEvidence,
      reportJobId: job.id,
      routineRunId: job.routineRunId,
    });

    const storedArtifacts = [];
    for (const artifact of artifacts) {
      storedArtifacts.push(
        await createReportJobArtifact({
          reportJobId: job.id,
          companyId: job.companyId,
          kind: artifact.kind,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          metadata: artifact.metadata,
        }),
      );
    }

    const odooUnavailable = !enabledReportSources.includes("odoo") || sourceEvidence.sources.some(
      (source) => source.source === "odoo" && (source.status === "failed" || source.status === "unavailable"),
    );
    const odooUnavailableSummaryReason = enabledReportSources.includes("odoo")
      ? "Odoo source collection failed"
      : "Odoo source is disabled for this automation";
    const highlights = [
      odooUnavailable
        ? `Revenue total: unavailable (${odooUnavailableSummaryReason}; not zero)`
        : `Revenue total: ${finance.totals.currency ?? ""} ${finance.totals.revenueTotal.toFixed(2)}`.trim(),
      odooUnavailable
        ? `Expense total: unavailable (${odooUnavailableSummaryReason}; not zero)`
        : `Expense total: ${finance.totals.currency ?? ""} ${finance.totals.expenseTotal.toFixed(2)}`.trim(),
      odooUnavailable
        ? `Net total: unavailable (${odooUnavailableSummaryReason}; not zero)`
        : `Net total: ${finance.totals.currency ?? ""} ${finance.totals.netTotal.toFixed(2)}`.trim(),
      ...(finance.breakdowns.length > 0
        ? [`Segment rows: ${finance.breakdowns.length}`]
        : []),
    ];

    await completeReportJob(job.id, {
      phase: "completed",
      summary: odooUnavailable
        ? `Completed ${job.intent.reportFamily} for ${job.intent.period.label} with unavailable finance totals because ${odooUnavailableSummaryReason}.`
        : `Completed ${job.intent.reportFamily} for ${job.intent.period.label} using live Odoo data and Company-DB cross-checks.`,
      nextAction: "Fetch the artifact and review the evidence section before sharing the report.",
      clarificationQuestions: [],
      warnings,
      highlights,
      metricsSnapshot: {
        currency: finance.totals.currency,
        revenueTotal: finance.totals.revenueTotal,
        expenseTotal: finance.totals.expenseTotal,
        netTotal: finance.totals.netTotal,
        revenueCount: finance.totals.revenueCount,
        expenseCount: finance.totals.expenseCount,
        breakdownCount: finance.breakdowns.length,
        companyDbEvidenceCount: companyDbEvidence.length,
        documentEvidenceCount,
        sourceEvidence: sourceEvidence.summary,
      },
      artifactCount: storedArtifacts.length,
      reusedExistingJob: false,
    });

    await completeParentRoutineRun({
      job: { ...job, status: "completed" },
      status: odooUnavailable || sourceEvidence.summary.failedSources > 0
        ? "completed_with_errors"
        : "completed",
      stats: {
        artifactCount: storedArtifacts.length,
        sourceEvidence: sourceEvidence.summary,
      },
    });

    return { status: "completed", jobId, artifactCount: storedArtifacts.length };
  } catch (error) {
    const message = summarizeFailure(error);
    if (executionAccessChecked) {
      try {
        await createReportJobArtifact({
          reportJobId: job.id,
          companyId: job.companyId,
          kind: "failure",
          fileName: `report-job-${job.id}-failure.md`,
          mimeType: "text/markdown; charset=utf-8",
          metadata: {
            textContent: [
              `# Report job failed`,
              "",
              `- Report job: ${job.id}`,
              `- Routine run: ${job.routineRunId ?? "manual"}`,
              `- Period: ${job.intent.period.label}`,
              `- Error: ${message}`,
            ].join("\n"),
            previewable: true,
            period: {
              kind: job.intent.period.kind,
              label: job.intent.period.label,
              startDate: job.intent.period.startDate ?? null,
              endDate: job.intent.period.endDate ?? null,
              timezone: job.intent.period.timezone ?? "UTC",
              preset: job.intent.period.preset ?? null,
              anchorDate: job.intent.period.anchorDate ?? null,
            },
            delivery: {
              channel: "artifact",
              mode: "disabled",
              reason: "Report worker failed before any delivery adapter could run.",
              idempotencyKey: `report-job-failure:${job.id}`,
              recipientCount: 0,
              recipients: [],
              deliveryIds: [],
              statusSummary: "not_sent",
              payloadHash: null,
              payloadPreview: null,
              payloadTruncated: false,
            },
            worker: {
              status: "failed",
              renderStatus: "failed",
              reportJobId: job.id,
              routineRunId: job.routineRunId,
              failure: {
                message,
                failedAt: new Date().toISOString(),
              },
            },
          },
        });
      } catch {
        // Preserve the fail-closed state even if the diagnostic artifact cannot be written.
      }
    }
    await failReportJob(job.id, message, {
      summary: `The report worker could not complete ${job.intent.reportFamily} for ${job.intent.period.label}.`,
      nextAction:
        "Refine the request or supply an exact company-specific Odoo filter, then create a new report job.",
      warnings: [],
      metricsSnapshot: {},
    });
    await completeParentRoutineRun({
      job: { ...job, status: "failed" },
      status: "failed",
      stats: {},
      error: message,
    });
    return { status: "failed", jobId, reason: message };
  }
}
