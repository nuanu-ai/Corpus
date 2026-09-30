import {
  type CreateReportJobInput,
  type ExecutionPlanDraft,
  type ReportOperatingScope,
  type ReportFamily,
  type ReportIntent,
  type ReportJobStatus,
  type ReportOutputFormat,
  type ReportPeriod,
  type ReportJobSummary,
  type ReportStrictness,
} from "@/lib/report-jobs/types";
import {
  expandOperatingEntitySearchTerms,
  resolveOperatingEntities,
} from "@/lib/operating-entities/registry";
import type { OperatingEntityRecord } from "@/lib/operating-entities/types";

const MONTH_INDEX: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const GENERIC_SCOPE_STOPWORDS = new Set([
  "report",
  "reports",
  "expense",
  "expenses",
  "revenue",
  "sales",
  "income",
  "profit",
  "loss",
  "summary",
  "analysis",
  "breakdown",
  "month",
  "week",
  "quarter",
  "year",
  "last",
  "this",
  "previous",
  "past",
  "current",
  "rolling",
  "calendar",
  "company",
  "business",
  "financial",
  "finance",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "january",
  "february",
  "q1",
  "q2",
  "q3",
  "q4",
  "docx",
  "xlsx",
  "pdf",
]);

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function detectOutputFormat(request: string, explicit?: ReportOutputFormat): ReportOutputFormat {
  if (explicit) return explicit;
  const lower = request.toLowerCase();
  if (lower.includes("xlsx") || lower.includes("excel")) return "xlsx";
  if (lower.includes("docx") || lower.includes("word")) return "docx";
  return "markdown";
}

function detectReportFamily(request: string): ReportFamily {
  const lower = request.toLowerCase();
  if (lower.includes("p&l") || lower.includes("pnl") || lower.includes("profit and loss")) {
    return "financial_analysis";
  }
  if (lower.includes("cash flow") || lower.includes("cash position")) return "cash_report";
  if (lower.includes("variance")) return "variance_report";
  if (lower.includes("expense") || lower.includes("cost")) return "expense_report";
  if (lower.includes("revenue") || lower.includes("sales") || lower.includes("income")) {
    return "revenue_report";
  }
  if (lower.includes("department")) return "department_report";
  return "custom_operational_report";
}

function detectDimensions(request: string): string[] {
  const lower = request.toLowerCase();
  const dimensions = new Set<string>();
  if (lower.includes("by venue")) dimensions.add("venue");
  if (lower.includes("by department")) dimensions.add("department");
  if (lower.includes("by project")) dimensions.add("project");
  if (lower.includes("by customer")) dimensions.add("customer");
  if (lower.includes("by channel")) dimensions.add("channel");
  return [...dimensions];
}

function detectMetrics(request: string, family: ReportFamily): string[] {
  const lower = request.toLowerCase();
  const metrics = new Set<string>();
  if (family === "revenue_report") metrics.add("revenue");
  if (family === "expense_report") metrics.add("expenses");
  if (family === "variance_report") metrics.add("variance");
  if (family === "cash_report") {
    metrics.add("cash_in");
    metrics.add("cash_out");
    metrics.add("net_cash_flow");
  }
  if (family === "financial_analysis") {
    metrics.add("revenue");
    metrics.add("gross_profit");
    metrics.add("net_profit");
  }
  if (lower.includes("invoice")) metrics.add("invoice_amount");
  if (lower.includes("balance")) metrics.add("balance");
  return [...metrics];
}

function detectSubject(request: string, family: ReportFamily): string {
  const lower = request.toLowerCase();
  if (lower.includes("f&b") || lower.includes("fnb")) return "F&B";
  if (lower.includes("multimedia")) return "multimedia";
  switch (family) {
    case "revenue_report":
      return "revenue";
    case "expense_report":
      return "expenses";
    case "cash_report":
      return "cash flow";
    case "financial_analysis":
      return "financial performance";
    case "variance_report":
      return "variance";
    case "department_report":
      return "department performance";
    default:
      return "custom analysis";
  }
}

function detectScopeFilters(request: string): Record<string, unknown> {
  const explicitMatch = request.match(
    /\b(project|venue|outlet|cost center|cost centre|department|brand)\s+([A-Za-z0-9&'/-]+(?:\s+[A-Za-z0-9&'/-]+){0,4})\b/i,
  );
  if (explicitMatch) {
    return {
      scopeType: explicitMatch[1].toLowerCase().replace(/\s+/g, "_"),
      scopeLabel: explicitMatch[2].trim(),
    };
  }

  const genericMatch = request.match(
    /\b(?:for|of|about)\s+([A-Za-z][A-Za-z0-9&'/-]{2,})(?=[.!?,;:]?\s*(?:$|for\b|in\b|during\b|between\b|from\b|on\b|last\b|this\b|previous\b|past\b|rolling\b|january\b|february\b|march\b|april\b|may\b|june\b|july\b|august\b|september\b|october\b|november\b|december\b|\d{4}\b))/i,
  );
  if (genericMatch) {
    const candidate = genericMatch[1].trim();
    if (!GENERIC_SCOPE_STOPWORDS.has(candidate.toLowerCase())) {
      return { scopeLabel: candidate };
    }
  }

  return {};
}

function sourceMappingsForReport(record: OperatingEntityRecord): NonNullable<ReportOperatingScope>["sourceMappings"] {
  return {
    companyDb: {
      folders: record.sourceMappings.companyDb?.folders?.slice(0, 8) ?? [],
      queryAliases: record.sourceMappings.companyDb?.queryAliases?.slice(0, 12) ?? [],
    },
    odoo: {
      company: record.sourceMappings.odoo?.company ?? null,
      analyticAccounts: record.sourceMappings.odoo?.analyticAccounts?.slice(0, 8) ?? [],
      posConfigs: record.sourceMappings.odoo?.posConfigs?.slice(0, 8) ?? [],
      accounts: record.sourceMappings.odoo?.accounts?.slice(0, 8) ?? [],
      partners: record.sourceMappings.odoo?.partners?.slice(0, 8) ?? [],
    },
    customMcp: {
      tools: record.sourceMappings.customMcp?.tools?.slice(0, 8) ?? [],
    },
  };
}

function detectOperatingScope(request: string, filters: Record<string, unknown>): ReportOperatingScope {
  const explicitScope = typeof filters.scopeLabel === "string" ? filters.scopeLabel : null;
  const target = explicitScope ?? request;
  const match = resolveOperatingEntities(target, { limit: 1 })[0] ?? null;
  if (!match) return null;
  if (!explicitScope && match.score < 70) return null;

  return {
    operatingEntityId: match.record.id,
    canonicalName: match.record.canonicalName,
    objectType: match.record.objectType,
    grantsDataAccess: false,
    searchTerms: expandOperatingEntitySearchTerms(match.record.canonicalName, { limit: 1 }).slice(0, 16),
    sourceMappings: sourceMappingsForReport(match.record),
  };
}

function detectPeriod(request: string, now: Date): ReportPeriod {
  const lower = request.toLowerCase();
  const rangeMatch = lower.match(
    /\b(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and)\s+(\d{4}-\d{2}-\d{2})\b/,
  );
  if (rangeMatch) {
    return {
      kind: "absolute_range",
      label: `${rangeMatch[1]} to ${rangeMatch[2]}`,
      startDate: rangeMatch[1],
      endDate: rangeMatch[2],
      timezone: "UTC",
    };
  }

  const monthMatch = lower.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/,
  );
  if (monthMatch) {
    const month = MONTH_INDEX[monthMatch[1]];
    const year = Number(monthMatch[2]);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = endOfUtcDay(new Date(Date.UTC(year, month, 0)));
    return {
      kind: "calendar_month",
      label: `${monthMatch[1][0].toUpperCase()}${monthMatch[1].slice(1)} ${year}`,
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      timezone: "UTC",
    };
  }

  const quarterMatch = lower.match(/\bq([1-4])\s+(20\d{2})\b/);
  if (quarterMatch) {
    const quarter = Number(quarterMatch[1]);
    const year = Number(quarterMatch[2]);
    const monthOffset = (quarter - 1) * 3;
    const start = new Date(Date.UTC(year, monthOffset, 1));
    const end = endOfUtcDay(new Date(Date.UTC(year, monthOffset + 3, 0)));
    return {
      kind: "calendar_quarter",
      label: `Q${quarter} ${year}`,
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      timezone: "UTC",
    };
  }

  if (lower.includes("last month")) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = endOfUtcDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
    return {
      kind: "relative_range",
      label: "Last month",
      preset: "last_month",
      anchorDate: formatDateOnly(startOfUtcDay(now)),
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      timezone: "UTC",
    };
  }

  if (lower.includes("this month")) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return {
      kind: "relative_range",
      label: "This month",
      preset: "this_month",
      anchorDate: formatDateOnly(startOfUtcDay(now)),
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(endOfUtcDay(now)),
      timezone: "UTC",
    };
  }

  if (lower.includes("last week")) {
    const currentDay = startOfUtcDay(now);
    const currentWeekday = (currentDay.getUTCDay() + 6) % 7;
    const start = new Date(currentDay);
    start.setUTCDate(currentDay.getUTCDate() - currentWeekday - 7);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return {
      kind: "relative_range",
      label: "Last week",
      preset: "last_week",
      anchorDate: formatDateOnly(currentDay),
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      timezone: "UTC",
    };
  }

  if (
    lower.includes("last one month") ||
    lower.includes("last 30 days") ||
    lower.includes("past 30 days") ||
    lower.includes("rolling 30 days")
  ) {
    const end = endOfUtcDay(now);
    const start = startOfUtcDay(now);
    start.setUTCDate(start.getUTCDate() - 29);
    return {
      kind: "relative_range",
      label: "Last 30 days",
      preset: "last_30_days",
      anchorDate: formatDateOnly(startOfUtcDay(now)),
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      timezone: "UTC",
    };
  }

  return {
    kind: "unknown",
    label: "Period not resolved",
    timezone: "UTC",
  };
}

function inferSources(family: ReportFamily, request: string): string[] {
  const lower = request.toLowerCase();
  const sources = new Set<string>();
  if (lower.includes("odoo") || family !== "custom_operational_report") {
    sources.add("odoo");
  }
  sources.add("company_db");
  if (lower.includes("document") || lower.includes("evidence")) {
    sources.add("documents");
  }
  return [...sources];
}

function buildClarificationQuestions(intent: Omit<ReportIntent, "needsClarification" | "clarificationQuestions">): string[] {
  const questions: string[] = [];
  if (intent.period.kind === "unknown") {
    questions.push("Which exact reporting period should the report cover?");
  }
  if (intent.reportFamily === "custom_operational_report") {
    questions.push("What exact metric or business question should the report answer?");
  }
  const unsupportedDimensions = intent.dimensions.filter(
    (dimension) => !["venue", "department"].includes(dimension),
  );
  if (unsupportedDimensions.length > 0) {
    questions.push(
      `Only venue and department segmentation are supported right now. Which supported segment should the report use instead of ${unsupportedDimensions.join(", ")}?`,
    );
  }
  return questions;
}

function buildExecutionPlan(intent: ReportIntent): ExecutionPlanDraft {
  const planStatus = intent.needsClarification ? "needs_clarification" : "ready";
  return {
    version: 1,
    companyId: intent.companyId,
    planStatus,
    sources: inferSources(intent.reportFamily, intent.request),
    steps: intent.needsClarification
      ? []
      : [
          {
            id: "step-1-source",
            kind: "connector_query",
            source: "odoo",
            description: `Collect ${intent.subject} records for ${intent.period.label}`,
            args: {
              reportFamily: intent.reportFamily,
              period: intent.period,
              metrics: intent.metrics,
              dimensions: intent.dimensions,
              operatingScope: intent.operatingScope,
            },
          },
          {
            id: "step-2-cross-check",
            kind: "company_db_query",
            source: "company_db",
            description: "Cross-check the primary ERP result against Company-DB summaries and evidence.",
            args: {
              period: intent.period,
              metrics: intent.metrics,
              operatingScope: intent.operatingScope,
            },
          },
          {
            id: "step-3-aggregate",
            kind: "aggregation",
            description: "Aggregate, segment, and compute the requested report metrics.",
            args: {
              dimensions: intent.dimensions,
              metrics: intent.metrics,
              operatingScope: intent.operatingScope,
            },
          },
          {
            id: "step-4-render",
            kind: "artifact_render",
            description: `Render the final report as ${intent.outputFormat}.`,
            args: {
              outputFormat: intent.outputFormat,
              subject: intent.subject,
            },
          },
        ],
    evidencePolicy: {
      includeTopRecords: true,
      maxEvidenceItems: 20,
    },
    renderPolicy: {
      outputFormat: intent.outputFormat,
      titleHint: `${intent.subject} report`,
    },
    timeoutBudgetMs: 120_000,
  };
}

function buildSummary(
  status: ReportJobStatus,
  intent: ReportIntent,
  clarificationQuestions: string[],
): ReportJobSummary {
  if (status === "awaiting_clarification") {
    return {
      phase: "clarification_needed",
      summary: `Planning stopped because the request is still ambiguous for ${intent.subject}.`,
      nextAction: "Provide the missing clarification so the job can be executed safely.",
      clarificationQuestions,
      warnings: [],
      highlights: [],
      metricsSnapshot: {},
      artifactCount: 0,
      reusedExistingJob: false,
    };
  }

  return {
    phase: "planned",
    summary: `Planning completed for a ${intent.reportFamily} covering ${intent.period.label}.`,
    nextAction: "The executor can now queue the job and produce a report artifact.",
    clarificationQuestions: [],
    warnings: [],
    highlights: [],
    metricsSnapshot: {},
    artifactCount: 0,
    reusedExistingJob: false,
  };
}

export function planReportJob(
  input: CreateReportJobInput,
  now: Date = new Date(),
): {
  status: ReportJobStatus;
  intent: ReportIntent;
  executionPlan: ExecutionPlanDraft;
  resultSummary: ReportJobSummary;
} {
  const request = input.request.trim();
  const family = detectReportFamily(request);
  const outputFormat = detectOutputFormat(request, input.outputFormat);
  const strictness: ReportStrictness = input.strictness ?? "standard";
  const period = detectPeriod(request, now);
  const dimensions = detectDimensions(request);
  const metrics = detectMetrics(request, family);
  const subject = detectSubject(request, family);
  const filters = detectScopeFilters(request);
  const operatingScope = detectOperatingScope(request, filters);

  const intentBase = {
    request,
    companyId: input.companyId,
    reportFamily: family,
    subject,
    period,
    dimensions,
    metrics,
    filters,
    operatingScope,
    outputFormat,
    strictness,
  } satisfies Omit<ReportIntent, "needsClarification" | "clarificationQuestions">;

  const clarificationQuestions = buildClarificationQuestions(intentBase);
  const needsClarification = clarificationQuestions.length > 0;

  const intent: ReportIntent = {
    ...intentBase,
    needsClarification,
    clarificationQuestions,
  };

  const executionPlan = buildExecutionPlan(intent);
  const status: ReportJobStatus = needsClarification ? "awaiting_clarification" : "planned";
  const resultSummary = buildSummary(status, intent, clarificationQuestions);

  return {
    status,
    intent,
    executionPlan,
    resultSummary,
  };
}
