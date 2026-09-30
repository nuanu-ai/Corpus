import { createHash } from "crypto";

import {
  getSummaryByPath,
  queryAllEntities,
  submitSummaryDelete,
  submitSummaryDoc,
  type CompanyDbRequestOptions,
  type EntityResult,
} from "@/lib/company-db/client";
import {
  filterDecisionGradeAdvisorEntities,
  getAdvisorDomainLabel,
  normalizeAdvisorReviewState,
  selectAdvisorEntities,
} from "@/lib/company-db/advisor-context";
import {
  buildCanonicalFinanceSeries,
  isCompanyWideFinanceEntity,
  isFinanceStatementEntity,
  selectAuthoritativeProjectionPack,
} from "@/lib/company-db/financial-canonical";
import {
  extractSnapshotStatementMetrics as extractStatementMetrics,
} from "@/lib/company-db/financial-metrics";
import {
  isUnknownReportingPeriod,
  normalizeReportingPeriodKey,
} from "@/lib/document-parsers/period-utils";
import {
  ensureSummaryBootstrap,
  loadSummaryTargets,
} from "@/lib/company-db/summary/registry";
import type {
  SummaryRefreshRequest,
  SummaryRefreshResult,
  SummaryRefreshResultItem,
  SummaryScope,
  SummaryTarget,
} from "@/lib/company-db/summary/types";

type SummaryBuild = {
  frontmatter: Record<string, unknown>;
  body: string;
};

const SUMMARY_VERSION = 1;
const MATERIALIZER_VERSION = 2;
const SUMMARY_HASH_VERSION = 2;

type BaseFrontmatterOptions = {
  qualityWarnings?: string[];
  drilldownQueries?: string[];
  coverageEntities?: EntityResult[];
  representativeEntities?: EntityResult[];
  preserveRepresentativeOrder?: boolean;
  coverageCompletenessOverride?: "thin" | "partial" | "complete";
};

function scopeWeight(scope: SummaryScope): number {
  switch (scope) {
    case "folder":
      return 0;
    case "domain":
      return 1;
    case "company":
      return 2;
  }
}

function orderTargets(targets: SummaryTarget[]): SummaryTarget[] {
  return [...targets].sort((a, b) => {
    const scopeDiff = scopeWeight(a.summaryScope) - scopeWeight(b.summaryScope);
    if (scopeDiff !== 0) return scopeDiff;
    return a.id.localeCompare(b.id);
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern: string): RegExp {
  let regex = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    const next = pattern[i + 1];

    if (char === "*" && next === "*") {
      regex += ".*";
      i += 1;
      continue;
    }
    if (char === "*") {
      regex += "[^/]*";
      continue;
    }
    regex += escapeRegex(char);
  }
  regex += "$";
  return new RegExp(regex);
}

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegex(pattern).test(path));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value !== null) {
    const amount = (value as { amount?: unknown }).amount;
    if (amount !== undefined) return toNumber(amount);
  }
  return null;
}

function readMetric(frontmatter: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const top = toNumber(frontmatter[key]);
    if (top !== null) return top;
  }

  const derived = frontmatter.derived_metrics;
  if (typeof derived === "object" && derived !== null) {
    const metrics = derived as Record<string, unknown>;
    for (const key of keys) {
      const value = toNumber(metrics[key]);
      if (value !== null) return value;
    }
  }

  const summaryMetrics = frontmatter.summary_metrics;
  if (typeof summaryMetrics === "object" && summaryMetrics !== null) {
    const metrics = summaryMetrics as Record<string, unknown>;
    for (const key of keys) {
      const value = toNumber(metrics[key]);
      if (value !== null) return value;
    }
  }

  return null;
}

function formatValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "N/A";
  return String(value);
}

function computeSummaryHash(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const hashFrontmatter = { ...frontmatter };
  delete hashFrontmatter.generated_at;
  delete hashFrontmatter.summary_hash;

  return createHash("sha1")
    .update(
      JSON.stringify({
        version: SUMMARY_HASH_VERSION,
        frontmatter: hashFrontmatter,
        body,
      }),
    )
    .digest("hex");
}

function finalizeSummaryBuild(summary: SummaryBuild): SummaryBuild {
  return {
    ...summary,
    frontmatter: {
      ...summary.frontmatter,
      summary_hash: computeSummaryHash(summary.frontmatter, summary.body),
    },
  };
}

type CanonicalActualStatementFamily = "pnl_month" | "balance_sheet_month" | "cash_flow_month";

type SourceDocumentRef = {
  documentId: string;
  fileName: string;
};

function getCanonicalFamily(frontmatter: Record<string, unknown>): string | null {
  return toText(frontmatter.canonical_family);
}

function getActualStatementFamily(entity: EntityResult): CanonicalActualStatementFamily | null {
  const family = getCanonicalFamily(entity.frontmatter);
  if (
    family === "pnl_month" ||
    family === "balance_sheet_month" ||
    family === "cash_flow_month"
  ) {
    return family;
  }

  switch (entity.type) {
    case "income_statement":
      return "pnl_month";
    case "balance_sheet":
      return "balance_sheet_month";
    case "cash_flow_statement":
      return "cash_flow_month";
    default:
      return null;
  }
}

function isCanonicalActualStatementEntity(entity: EntityResult): boolean {
  if (entity.domain !== "finance") return false;
  if (!entity.filePath.startsWith("finance/statements/")) return false;
  return getActualStatementFamily(entity) !== null;
}

function isCanonicalProjectionEntity(entity: EntityResult): boolean {
  if (entity.domain !== "finance") return false;
  if (!entity.filePath.startsWith("finance/projections/")) return false;
  return getCanonicalFamily(entity.frontmatter) === "financial_projection_plan" || entity.type === "forecast";
}

function isForecastOrProjectionFinanceEntity(entity: EntityResult): boolean {
  if (entity.domain !== "finance") return false;
  if (entity.type === "statement_lines_technical") return true;
  if (entity.filePath.endsWith(".statement-lines.qmd")) return true;
  if (entity.filePath.startsWith("finance/projections/")) return true;

  const book = toText(entity.frontmatter.book)?.toLowerCase() ?? "";
  if (book === "forecast" || book === "projection" || book === "budget" || book === "plan") {
    return true;
  }

  const reportType = toText(entity.frontmatter.report_type)?.toLowerCase() ?? "";
  if (reportType === "forecast" || reportType === "projection" || reportType === "budget") {
    return true;
  }

  return getCanonicalFamily(entity.frontmatter) === "financial_projection_plan";
}

function isObservedActualFinanceCoverageEntity(entity: EntityResult): boolean {
  if (!isFinanceStatementEntity(entity)) return false;
  if (isForecastOrProjectionFinanceEntity(entity)) return false;
  if (getPeriodKey(entity.frontmatter) === null) return false;

  if (entity.type === "document_import") {
    const reportType = toText(entity.frontmatter.report_type)?.toLowerCase() ?? "";
    return reportType !== "" && reportType !== "other";
  }

  return true;
}

function compareEntitiesByPeriodAndFreshness(left: EntityResult, right: EntityResult): number {
  const leftPeriod = getPeriodKey(left.frontmatter);
  const rightPeriod = getPeriodKey(right.frontmatter);
  const periodDelta = periodSortValue(rightPeriod ?? "") - periodSortValue(leftPeriod ?? "");
  if (periodDelta !== 0) return periodDelta;

  const leftUpdated = getEntityUpdatedAt(left) ?? "";
  const rightUpdated = getEntityUpdatedAt(right) ?? "";
  return rightUpdated.localeCompare(leftUpdated);
}

function sortPeriods(periods: string[]): string[] {
  return [...periods].sort((left, right) => periodSortValue(left) - periodSortValue(right));
}

function collectSourceDocuments(entities: EntityResult[]): SourceDocumentRef[] {
  const byId = new Map<string, SourceDocumentRef>();

  for (const entity of entities) {
    const documentId = toText(entity.frontmatter.document_id);
    if (!documentId || byId.has(documentId)) continue;

    byId.set(documentId, {
      documentId,
      fileName:
        toText(entity.frontmatter.source_document_name) ??
        toText(entity.frontmatter.source_file_name) ??
        toText(entity.title) ??
        documentId,
    });
  }

  return Array.from(byId.values());
}

function renderSourceDocumentLines(entities: EntityResult[]): string[] {
  const documents = collectSourceDocuments(entities);
  if (documents.length === 0) {
    return [
      "- No original source document link was resolved for this slice.",
    ];
  }

  return documents.slice(0, 8).map(
    (document) =>
      `- ${document.fileName} (document_id: ${document.documentId}) — use get_document_download(document_id=\"${document.documentId}\") to open the original workbook/file.`,
  );
}

function summarizeFilePaths(paths: string[]): string[] {
  return uniqueStrings(paths).slice(0, 8).map((path) => `- ${path}`);
}

function getProjectionSummaryMetrics(frontmatter: Record<string, unknown>): {
  revenue: number | null;
  expenses: number | null;
  grossProfit: number | null;
  netIncome: number | null;
  cashPosition: number | null;
} {
  const revenue =
    readMetric(frontmatter, ["revenue", "revenue_projection", "total_revenue"]);
  const operatingExpenses = readMetric(frontmatter, ["operating_expenses", "expense_projection"]);
  const costOfSales = readMetric(frontmatter, ["cost_of_sales", "cost_of_revenue"]);
  const expenses =
    operatingExpenses !== null && costOfSales !== null
      ? operatingExpenses + costOfSales
      : operatingExpenses ?? costOfSales ?? readMetric(frontmatter, ["expenses"]);

  return {
    revenue,
    expenses,
    grossProfit: readMetric(frontmatter, ["gross_profit"]),
    netIncome: readMetric(frontmatter, ["net_income"]),
    cashPosition: readMetric(frontmatter, ["cash_position", "ending_cash", "closing_cash"]),
  };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function uniqueEntityResults(
  entities: Array<EntityResult | null | undefined>,
): EntityResult[] {
  const seen = new Set<string>();
  const results: EntityResult[] = [];
  for (const entity of entities) {
    if (!entity || seen.has(entity.qualifiedId)) continue;
    seen.add(entity.qualifiedId);
    results.push(entity);
  }
  return results;
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringList(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function getEntityUpdatedAt(entity?: Partial<EntityResult> | null): string | null {
  if (!entity) return null;
  const frontmatter =
    entity.frontmatter && typeof entity.frontmatter === "object"
      ? entity.frontmatter
      : {};
  return (
    toIsoDate(entity.updatedAt) ??
    toIsoDate(entity.createdAt) ??
    toIsoDate(frontmatter.updated_at) ??
    toIsoDate(frontmatter.created_at) ??
    toIsoDate(frontmatter.date) ??
    toIsoDate(frontmatter.period_end) ??
    toIsoDate(frontmatter.period_start) ??
    toIsoDate(
      typeof frontmatter.reporting_period === "object" && frontmatter.reporting_period !== null
        ? (frontmatter.reporting_period as Record<string, unknown>).end
        : null,
    ) ??
    toIsoDate(
      typeof frontmatter.reporting_period === "object" && frontmatter.reporting_period !== null
        ? (frontmatter.reporting_period as Record<string, unknown>).start
        : null,
    ) ??
    null
  );
}

function getLatestEntity(entities: EntityResult[]): EntityResult | null {
  return [...entities]
    .filter((entity) => getEntityUpdatedAt(entity) !== null)
    .sort((a, b) => {
      const left = getEntityUpdatedAt(a) ?? "";
      const right = getEntityUpdatedAt(b) ?? "";
      return right.localeCompare(left);
    })[0] ?? entities[0] ?? null;
}

function getReportType(frontmatter: Record<string, unknown>): string {
  return String(frontmatter.report_type ?? frontmatter.type ?? "").toLowerCase();
}

function periodSortValue(period: string): number {
  const monthMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    return Date.UTC(Number(monthMatch[1]), Number(monthMatch[2]), 0) * 10 + 3;
  }

  const quarterMatch = period.match(/^(\d{4})-q([1-4])$/i);
  if (quarterMatch) {
    return Date.UTC(Number(quarterMatch[1]), Number(quarterMatch[2]) * 3, 0) * 10 + 2;
  }

  const yearMatch = period.match(/^(\d{4})$/);
  if (yearMatch) {
    return Date.UTC(Number(yearMatch[1]), 11, 31) * 10 + 1;
  }

  const parsed = Date.parse(period);
  return Number.isFinite(parsed) ? parsed * 10 : Number.NEGATIVE_INFINITY;
}

function isIncomeSnapshotReportType(reportType: string): boolean {
  return [
    "profit_and_loss",
    "income_statement",
    "pnl",
    "profit",
    "financial_statement",
  ].some((keyword) => reportType.includes(keyword));
}

function getSnapshotSortKey(entity: EntityResult): string {
  const frontmatter = entity.frontmatter ?? {};
  const periodKey = String(
    frontmatter.period_key ??
    frontmatter.reporting_period_key ??
    frontmatter.period ??
    "",
  ).trim();

  return (
    toIsoDate(frontmatter.period_end) ??
    toIsoDate(
      typeof frontmatter.reporting_period === "object" && frontmatter.reporting_period !== null
        ? (frontmatter.reporting_period as Record<string, unknown>).end
        : null,
    ) ??
    toIsoDate(frontmatter.period_start) ??
    toIsoDate(
      typeof frontmatter.reporting_period === "object" && frontmatter.reporting_period !== null
        ? (frontmatter.reporting_period as Record<string, unknown>).start
        : null,
    ) ??
    (periodKey ? `period:${periodKey}` : null) ??
    entity.updatedAt ??
    entity.createdAt ??
    ""
  );
}

function getSnapshotDecisionPriority(entity: EntityResult): number {
  const reportType = getReportType(entity.frontmatter);
  const lineItemCount = toNumber(entity.frontmatter.line_item_count) ?? 0;
  const name = String(
    entity.frontmatter.entity ??
    entity.frontmatter.sheet_name ??
    entity.title ??
    entity.qualifiedId,
  ).toLowerCase();

  let score = lineItemCount;
  if (/\b(consolidated|summary|overall|group|total)\b/.test(name)) score += 1000;
  if (/\b(f&b|fb|finance|pnl|profit and loss)\b/.test(name)) score += 250;
  if (/\bmacro\b/.test(name)) score -= 500;
  if (isIncomeSnapshotReportType(reportType) && lineItemCount <= 5) score -= 1000;
  return score;
}

function selectLatestSnapshotByReportType(
  entities: EntityResult[],
  keywords: string[],
): EntityResult | null {
  const matching = entities
    .filter((entity) => {
      const reportType = getReportType(entity.frontmatter);
      return keywords.some((keyword) => reportType.includes(keyword));
    })
    .sort((a, b) => getSnapshotSortKey(b).localeCompare(getSnapshotSortKey(a)));

  if (matching.length === 0) return null;

  const latestSortKey = getSnapshotSortKey(matching[0]!);
  const latestPeriodCandidates = matching.filter(
    (entity) => getSnapshotSortKey(entity) === latestSortKey,
  );

  return latestPeriodCandidates.sort(
    (a, b) => getSnapshotDecisionPriority(b) - getSnapshotDecisionPriority(a),
  )[0] ?? matching[0] ?? null;
}

function selectLatestIncomeLikeSnapshot(entities: EntityResult[]): EntityResult | null {
  return (
    selectLatestSnapshotByReportType(entities, [
      "profit_and_loss",
      "income_statement",
      "pnl",
      "profit",
      "financial_statement",
    ]) ??
    selectLatestSnapshotByReportType(entities, ["trial_balance"])
  );
}

function getLatestSnapshotEntity(entities: EntityResult[]): EntityResult | null {
  return [...entities]
    .sort((a, b) => getSnapshotSortKey(b).localeCompare(getSnapshotSortKey(a)))
    [0] ?? null;
}

function getMonthLastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeIsoPeriodDate(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  if (month < 1 || month > 12) return trimmed;
  const monthLastDay = getMonthLastDay(year, month);
  if (day === monthLastDay) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  return trimmed;
}

function getPeriodKey(frontmatter: Record<string, unknown>): string | null {
  const reportingPeriod =
    typeof frontmatter.reporting_period === "object" && frontmatter.reporting_period !== null
      ? (frontmatter.reporting_period as Record<string, unknown>)
      : null;
  const periodStart = typeof frontmatter.period_start === "string" ? frontmatter.period_start : null;
  const periodEnd = typeof frontmatter.period_end === "string" ? frontmatter.period_end : null;
  const periodLabel = typeof frontmatter.period_label === "string" ? frontmatter.period_label : null;

  if (
    reportingPeriod &&
    typeof reportingPeriod.start === "string" &&
    typeof reportingPeriod.end === "string"
  ) {
    const period = {
      start: reportingPeriod.start,
      end: reportingPeriod.end,
      label: typeof reportingPeriod.label === "string" ? reportingPeriod.label : periodLabel ?? undefined,
    };
    if (!isUnknownReportingPeriod(period)) {
      return normalizeReportingPeriodKey(period);
    }
  }

  if (periodStart && periodEnd) {
    const period = {
      start: periodStart,
      end: periodEnd,
      label: periodLabel ?? undefined,
    };
    if (!isUnknownReportingPeriod(period)) {
      return normalizeReportingPeriodKey(period);
    }
  }

  if (periodEnd) {
    const normalized = normalizeIsoPeriodDate(periodEnd);
    if (normalized && normalized !== "1970-01-01") return normalized;
  }

  if (periodStart) {
    const normalized = normalizeIsoPeriodDate(periodStart);
    if (normalized && normalized !== "1970-01-01") return normalized;
  }

  const fallbackValue =
    frontmatter.period_key ??
    frontmatter.reporting_period_key ??
    frontmatter.period ??
    periodLabel;

  if (typeof fallbackValue !== "string" || !fallbackValue.trim()) {
    return null;
  }

  const trimmed = fallbackValue.trim();
  if (trimmed.toLowerCase() === "unknown" || trimmed === "1970-01-01") {
    return null;
  }

  return normalizeIsoPeriodDate(trimmed) ?? trimmed;
}

function getStatementPackPeriodKey(frontmatter: Record<string, unknown>): string | null {
  const reportingPeriod =
    typeof frontmatter.reporting_period === "object" && frontmatter.reporting_period !== null
      ? (frontmatter.reporting_period as Record<string, unknown>)
      : null;
  const periodEnd =
    typeof reportingPeriod?.end === "string"
      ? reportingPeriod.end
      : typeof frontmatter.period_end === "string"
        ? frontmatter.period_end
        : null;

  if (periodEnd) {
    const normalized = normalizeIsoPeriodDate(periodEnd);
    if (normalized && normalized !== "1970-01-01") return normalized;
  }

  return getPeriodKey(frontmatter);
}

function sanitizeCoveragePeriod(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") return null;

  const normalizedIso = normalizeIsoPeriodDate(trimmed);
  const candidate = normalizedIso ?? trimmed;
  if (candidate === "1970-01" || candidate.startsWith("1970-01-01")) return null;
  return candidate;
}

function formatCoverageMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function expandCoveragePeriodMonths(period: string): string[] {
  const trimmed = period.trim().toLowerCase();
  if (!trimmed) return [];

  const monthlyMatch = trimmed.match(/^(\d{4})-(\d{2})$/);
  if (monthlyMatch) {
    return [formatCoverageMonth(Number(monthlyMatch[1]), Number(monthlyMatch[2]))];
  }

  const quarterMatch = trimmed.match(/^(\d{4})-q([1-4])$/);
  if (quarterMatch) {
    const year = Number(quarterMatch[1]);
    const quarter = Number(quarterMatch[2]);
    const startMonth = (quarter - 1) * 3 + 1;
    return [
      formatCoverageMonth(year, startMonth),
      formatCoverageMonth(year, startMonth + 1),
      formatCoverageMonth(year, startMonth + 2),
    ];
  }

  const yearMatch = trimmed.match(/^(\d{4})$/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return Array.from({ length: 12 }, (_, index) => formatCoverageMonth(year, index + 1));
  }

  const rangeMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})$/);
  if (!rangeMatch) return [];

  const start = new Date(`${rangeMatch[1]}T00:00:00Z`);
  const end = new Date(`${rangeMatch[2]}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const months: string[] = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endCursor = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= endCursor) {
    months.push(formatCoverageMonth(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return months;
}

function computeMissingMonthlyPeriods(periods: string[]): string[] {
  const monthly = uniqueStrings(periods.flatMap((period) => expandCoveragePeriodMonths(period))).sort();
  if (monthly.length < 2) return [];

  const missing: string[] = [];
  let current = new Date(`${monthly[0]}-01T00:00:00Z`);
  const end = new Date(`${monthly[monthly.length - 1]}-01T00:00:00Z`);
  const existing = new Set(monthly);

  while (current <= end) {
    const key = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!existing.has(key)) missing.push(key);
    current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
  }

  return missing;
}

function detectCurrencies(entities: EntityResult[]): string[] {
  return uniqueStrings(
    entities.map((entity) => {
      const value = entity.frontmatter.currency ?? entity.frontmatter.reporting_currency;
      return typeof value === "string" ? value.toUpperCase() : null;
    }),
  );
}

function detectStatuses(entities: EntityResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entity of entities) {
    const status = String(entity.status ?? entity.frontmatter.status ?? "unknown").toLowerCase();
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function getAmount(frontmatter: Record<string, unknown>): number | null {
  return (
    toNumber(frontmatter.amount) ??
    toNumber(frontmatter.total_amount) ??
    toNumber(frontmatter.balance) ??
    toNumber(frontmatter.outstanding_amount) ??
    readMetric(frontmatter, ["amount_total", "amount_residual", "amount_due"])
  );
}

function getTransactionMonthKey(frontmatter: Record<string, unknown>): string | null {
  const date = toText(frontmatter.date);
  if (date) {
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}`;
    }
  }

  const period = sanitizeCoveragePeriod(getPeriodKey(frontmatter));
  return period && /^\d{4}-\d{2}$/.test(period) ? period : null;
}

type BankingPeriodEstimate = {
  period: string;
  inflows: number | null;
  outflows: number | null;
  net: number | null;
  entities: EntityResult[];
};

function buildBankingPeriodEstimate(
  bankingEntities: EntityResult[],
  preferredPeriod: string | null,
): BankingPeriodEstimate | null {
  const groups = new Map<
    string,
    {
      inflows: number;
      inflowCount: number;
      outflows: number;
      outflowCount: number;
      entities: EntityResult[];
    }
  >();

  for (const entity of bankingEntities) {
    const period = getTransactionMonthKey(entity.frontmatter);
    const amount = getAmount(entity.frontmatter);
    if (!period || amount === null) continue;

    const bucket = groups.get(period) ?? {
      inflows: 0,
      inflowCount: 0,
      outflows: 0,
      outflowCount: 0,
      entities: [],
    };
    if (amount > 0) {
      bucket.inflows += amount;
      bucket.inflowCount += 1;
    } else if (amount < 0) {
      bucket.outflows += Math.abs(amount);
      bucket.outflowCount += 1;
    }
    bucket.entities.push(entity);
    groups.set(period, bucket);
  }

  if (groups.size === 0) return null;

  const targetPeriod =
    (preferredPeriod && groups.has(preferredPeriod) ? preferredPeriod : null) ??
    Array.from(groups.keys()).sort().at(-1) ??
    null;
  if (!targetPeriod) return null;

  const target = groups.get(targetPeriod);
  if (!target) return null;

  const inflows = target.inflowCount > 0 ? target.inflows : null;
  const outflows = target.outflowCount > 0 ? target.outflows : null;
  return {
    period: targetPeriod,
    inflows,
    outflows,
    net:
      inflows !== null && outflows !== null
        ? inflows - outflows
        : null,
    entities: target.entities,
  };
}

function getCounterparty(frontmatter: Record<string, unknown>): string | null {
  const candidates = [
    frontmatter.customer_name,
    frontmatter.vendor_name,
    frontmatter.partner_name,
    frontmatter.counterparty,
    frontmatter.merchant_name,
    frontmatter.description,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function buildBaseFrontmatter(
  target: SummaryTarget,
  entities: EntityResult[],
  body: string,
  keyMetrics: Record<string, unknown>,
  options: BaseFrontmatterOptions = {},
): Record<string, unknown> {
  const {
    qualityWarnings = [],
    drilldownQueries = [],
    coverageEntities = entities,
    representativeEntities = entities,
    preserveRepresentativeOrder = false,
    coverageCompletenessOverride,
  } = options;
  const latestUpdatedAt = uniqueStrings(entities.map((entity) => getEntityUpdatedAt(entity))).sort().at(-1) ?? null;
  const periods = uniqueStrings(
    coverageEntities.map((entity) => sanitizeCoveragePeriod(getPeriodKey(entity.frontmatter))),
  );
  const completeness = coverageCompletenessOverride ?? (entities.length === 0 ? "thin" : "complete");
  const orderedRepresentativeIds = preserveRepresentativeOrder
    ? uniqueEntityResults(representativeEntities)
        .slice(0, 5)
        .map((entity) => entity.qualifiedId)
    : [...representativeEntities]
        .sort((a, b) => {
          const typeWeight = getSnapshotDecisionPriority(b) - getSnapshotDecisionPriority(a);
          if (typeWeight !== 0) return typeWeight;
          return (getEntityUpdatedAt(b) ?? "").localeCompare(getEntityUpdatedAt(a) ?? "");
        })
        .slice(0, 5)
        .map((entity) => entity.qualifiedId);

  return {
    id: `summary-${target.id}`,
    type:
      target.summaryScope === "folder"
        ? "folder_summary"
        : target.summaryScope === "domain"
          ? "domain_summary"
          : "company_summary",
    title: target.title,
    domain: target.domain,
    logical_path: target.logicalPath,
    physical_path: target.physicalPath,
    summary_scope: target.summaryScope,
    summary_template: target.summaryTemplate,
    summary_version: SUMMARY_VERSION,
    materializer_version: MATERIALIZER_VERSION,
    generated_at: new Date().toISOString(),
    source_entity_count: entities.length,
    source_file_count: entities.length,
    source_types: uniqueStrings(entities.map((entity) => entity.type)),
    freshness: {
      status: latestUpdatedAt ? "fresh" : "stale",
      latest_source_updated_at: latestUpdatedAt,
    },
    coverage: {
      completeness,
      periods,
      missing_periods: computeMissingMonthlyPeriods(periods),
    },
    quality: {
      status: qualityWarnings.length > 0 ? "partial" : completeness,
      warnings: qualityWarnings,
    },
    key_metrics: keyMetrics,
    drilldown: {
      representative_ids: orderedRepresentativeIds,
      suggested_queries: drilldownQueries,
    },
  };
}

type LegalBucket =
  | "agreement"
  | "license"
  | "corporate"
  | "property_support"
  | "other";

type LegalRedFlagRegisterEntry = {
  id: string;
  title: string | null;
  type: string;
  document_kind: string | null;
  period_label: string | null;
  confidence: string | null;
  review_flags: string[];
  counterparties: string[];
  managerial_summary: string;
};

const LEGAL_AGREEMENT_KEYWORDS = [
  "agreement",
  "contract",
  "term sheet",
  "termsheet",
  "addendum",
  "amendment",
  "lease",
  "loan",
  "cooperation",
  "service agreement",
  "commercial agreement",
  "employment agreement",
];

const LEGAL_LICENSE_KEYWORDS = [
  "license",
  "permit",
  "nib",
  "kbli",
  "izin",
  "oss",
  "certificate",
  "sertifikat",
  "approval letter",
];

const LEGAL_CORPORATE_KEYWORDS = [
  "ahu",
  "akta",
  "incorporation",
  "establishment",
  "notary",
  "filing",
  "regulatory",
  "shareholder",
  "capital",
  "board resolution",
  "decree",
  "approval",
];

const LEGAL_PROPERTY_SUPPORT_KEYWORDS = [
  "zoning",
  "parcel",
  "land parcel",
  "land zoning",
  "site plan",
  "drawing",
  "layout",
  "plot",
];

function matchesKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function getLegalTextCorpus(entity: EntityResult): string {
  const frontmatter = entity.frontmatter ?? {};
  const parts = [
    entity.title,
    entity.type,
    toText(frontmatter.document_kind),
    toText(frontmatter.target_entity_type),
    toText(frontmatter.subtype),
    ...normalizeStringList(frontmatter.key_themes, 6),
    ...normalizeStringList(frontmatter.review_flags, 6),
  ];

  return parts
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

function classifyLegalEntity(entity: EntityResult): LegalBucket {
  const corpus = getLegalTextCorpus(entity);
  const frontmatter = entity.frontmatter ?? {};
  const targetEntityType = toText(frontmatter.target_entity_type)?.toLowerCase() ?? "";
  const documentKind = toText(frontmatter.document_kind)?.toLowerCase() ?? "";

  if (
    matchesKeyword(corpus, LEGAL_AGREEMENT_KEYWORDS) ||
    entity.type.includes("contract") ||
    entity.type.includes("agreement")
  ) {
    return "agreement";
  }

  if (
    documentKind === "license_document" ||
    matchesKeyword(corpus, LEGAL_LICENSE_KEYWORDS)
  ) {
    return "license";
  }

  if (
    targetEntityType.includes("incorporation") ||
    targetEntityType.includes("corporate") ||
    matchesKeyword(corpus, LEGAL_CORPORATE_KEYWORDS)
  ) {
    return "corporate";
  }

  if (
    targetEntityType === "land_parcel" ||
    documentKind === "operational_document" ||
    matchesKeyword(corpus, LEGAL_PROPERTY_SUPPORT_KEYWORDS)
  ) {
    return "property_support";
  }

  return "other";
}

function isLegalRedFlagEntity(entity: EntityResult): boolean {
  if (classifyLegalEntity(entity) === "property_support") return false;

  const normalizedReviewState = normalizeAdvisorReviewState({
    domain: entity.domain,
    frontmatter: entity.frontmatter,
  });

  if (normalizedReviewState.requiresReview) return true;

  if (normalizedReviewState.reviewFlags.length > 0) return true;

  const explicitRisks = normalizeStringList(entity.frontmatter.risks, 4);
  if (explicitRisks.length > 0) return true;

  const anomalies = Array.isArray(entity.frontmatter.anomalies)
    ? entity.frontmatter.anomalies.filter((item) => item && typeof item === "object")
    : [];
  return anomalies.length > 0;
}

function buildLegalRedFlagRegister(entities: EntityResult[]): LegalRedFlagRegisterEntry[] {
  return selectAdvisorEntities(
    entities.filter((entity) => entity.domain === "legal" && isLegalRedFlagEntity(entity)),
    5,
  ).map((summary) => ({
    id: summary.id,
    title: summary.title,
    type: summary.type,
    document_kind: summary.documentKind,
    period_label: summary.periodLabel,
    confidence: summary.confidence,
    review_flags: summary.reviewFlags,
    counterparties: summary.counterparties,
    managerial_summary: summary.managerialSummary,
  }));
}

function buildPeriodicSnapshotSummary(target: SummaryTarget, entities: EntityResult[]): SummaryBuild {
  const latestSnapshot = getLatestSnapshotEntity(entities);
  const latestFrontmatter = latestSnapshot?.frontmatter ?? {};
  const incomeSnapshot = selectLatestIncomeLikeSnapshot(entities);
  const cashFlowSnapshot = selectLatestSnapshotByReportType(entities, [
    "cash_flow",
    "cash-flow",
  ]);
  const balanceSheetSnapshot = selectLatestSnapshotByReportType(entities, [
    "balance_sheet",
    "statement_of_financial_position",
    "financial_position",
  ]);
  const incomeFrontmatter = incomeSnapshot?.frontmatter ?? latestFrontmatter;
  const liquidityFrontmatter =
    cashFlowSnapshot?.frontmatter ?? balanceSheetSnapshot?.frontmatter ?? incomeFrontmatter;
  const incomeMetrics = extractStatementMetrics(
    incomeFrontmatter,
    getReportType(incomeFrontmatter),
  );
  const liquidityMetrics = extractStatementMetrics(
    liquidityFrontmatter,
    getReportType(liquidityFrontmatter),
  );
  const latestPeriod =
    getPeriodKey(latestFrontmatter) ??
    getPeriodKey(incomeFrontmatter) ??
    getPeriodKey(liquidityFrontmatter) ??
    getPeriodKey(latestFrontmatter);
  const revenue = incomeMetrics.revenue;
  const expenses = incomeMetrics.expenses;
  const net = incomeMetrics.net_income;
  const cash = liquidityMetrics.cash_position;
  const missingPeriods = computeMissingMonthlyPeriods(
    entities.map((entity) => getPeriodKey(entity.frontmatter)).filter((value): value is string => Boolean(value)),
  );
  const warnings = missingPeriods.length > 0 ? ["missing_periods_detected"] : [];
  if (!latestPeriod) warnings.push("latest_period_missing");
  if (revenue === null && expenses === null && net === null && cash === null) {
    warnings.push("metrics_low_signal");
  }

  const keyMetrics = {
    latest_period: latestPeriod,
    latest_revenue: revenue,
    latest_expenses: expenses,
    latest_cost_of_sales: incomeMetrics.cost_of_sales,
    latest_operating_expenses: incomeMetrics.operating_expenses,
    latest_gross_profit: incomeMetrics.gross_profit,
    latest_net_income: net,
    latest_cash_position: cash,
  };

  const body = [
    "## Executive summary",
    `Latest reporting period: ${formatValue(latestPeriod)}`,
    "",
    "## Key facts",
    `- Revenue: ${formatValue(revenue)}`,
    `- Expenses: ${formatValue(expenses)}`,
    `- Cost of sales: ${formatValue(incomeMetrics.cost_of_sales)}`,
    `- Operating expenses: ${formatValue(incomeMetrics.operating_expenses)}`,
    `- Net income: ${formatValue(net)}`,
    `- Cash position: ${formatValue(cash)}`,
    "",
    "## Risks and gaps",
    missingPeriods.length > 0
      ? `- Missing periods: ${missingPeriods.join(", ")}`
      : "- No material coverage gaps detected in the current snapshot window.",
    "",
    "## Drill-down paths",
    "- Query latest financial snapshots for statement-level detail.",
  ].join("\n");

  return {
    frontmatter: buildBaseFrontmatter(
      target,
      entities,
      body,
      keyMetrics,
      {
        qualityWarnings: warnings,
        drilldownQueries: [`domain=${target.domain}&type=financial_snapshot&limit=20`],
        representativeEntities: uniqueEntityResults([
          incomeSnapshot,
          cashFlowSnapshot,
          balanceSheetSnapshot,
          latestSnapshot,
        ]),
      },
    ),
    body,
  };
}

function buildTransactionFlowSummary(target: SummaryTarget, entities: EntityResult[]): SummaryBuild {
  const amounts = entities.map((entity) => getAmount(entity.frontmatter)).filter((value): value is number => value !== null);
  const totalAmount = amounts.reduce((sum, value) => sum + value, 0);
  const statuses = detectStatuses(entities);
  const counterparties = new Map<string, number>();

  for (const entity of entities) {
    const counterparty = getCounterparty(entity.frontmatter);
    if (!counterparty) continue;
    counterparties.set(counterparty, (counterparties.get(counterparty) ?? 0) + 1);
  }

  const topCounterparties = Array.from(counterparties.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name} (${count})`);
  const overdueCount =
    (statuses.overdue ?? 0) +
    (statuses.past_due ?? 0) +
    (statuses.overdue_payment ?? 0);
  const latest = getLatestEntity(entities);
  const latestActivity = getEntityUpdatedAt(latest);

  const keyMetrics = {
    item_count: entities.length,
    total_amount: totalAmount,
    currencies: detectCurrencies(entities).join(", "),
    overdue_count: overdueCount,
    latest_activity_at: latestActivity,
  };

  const body = [
    "## Executive summary",
    `${target.title} covers ${entities.length} records across ${detectCurrencies(entities).join(", ") || "unknown currencies"}.`,
    "",
    "## Key facts",
    `- Total amount: ${formatValue(totalAmount)}`,
    `- Overdue items: ${formatValue(overdueCount)}`,
    `- Latest activity: ${formatValue(latestActivity)}`,
    topCounterparties.length > 0 ? `- Top counterparties: ${topCounterparties.join(", ")}` : "- No clear counterparty concentration detected.",
    "",
    "## Risks and gaps",
    overdueCount > 0
      ? `- ${overdueCount} items are overdue or past due.`
      : "- No overdue status markers detected in the current slice.",
    "",
    "## Drill-down paths",
    `- Query ${target.domain} entities by status for point inspection.`,
  ].join("\n");

  return {
    frontmatter: buildBaseFrontmatter(
      target,
      entities,
      body,
      keyMetrics,
      {
        drilldownQueries: [`domain=${target.domain}&limit=50`],
      },
    ),
    body,
  };
}

function buildKnowledgeCatalogSummary(target: SummaryTarget, entities: EntityResult[]): SummaryBuild {
  const totalWords = entities
    .map((entity) => toNumber(entity.frontmatter.word_count))
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => sum + value, 0);
  const latest = getLatestEntity(entities);
  const recentTitles = entities
    .slice()
    .sort((a, b) => (getEntityUpdatedAt(b) ?? "").localeCompare(getEntityUpdatedAt(a) ?? ""))
    .slice(0, 5)
    .map((entity) => String(entity.title ?? entity.frontmatter.title ?? entity.qualifiedId));

  const keyMetrics = {
    doc_count: entities.length,
    total_words: totalWords,
    latest_doc_updated_at: getEntityUpdatedAt(latest),
  };

  const body = [
    "## Executive summary",
    `${entities.length} knowledge documents are currently indexed for this scope.`,
    "",
    "## Key facts",
    `- Total words: ${formatValue(totalWords)}`,
    recentTitles.length > 0 ? `- Recent documents: ${recentTitles.join(", ")}` : "- No recent documents found.",
    "",
    "## Risks and gaps",
    entities.length === 0
      ? "- No knowledge documents are currently available."
      : "- Review stale policies manually if business-critical docs are missing.",
    "",
    "## Drill-down paths",
    "- Open the representative docs for source-of-truth reading.",
  ].join("\n");

  return {
    frontmatter: buildBaseFrontmatter(
      target,
      entities,
      body,
      keyMetrics,
      {
        drilldownQueries: [`domain=${target.domain}&limit=20`],
      },
    ),
    body,
  };
}

function buildLegalDecisionPack(target: SummaryTarget, entities: EntityResult[]): SummaryBuild {
  const rawLegalEntities = entities.filter((entity) => entity.domain === "legal");
  const legalEntities = filterDecisionGradeAdvisorEntities(rawLegalEntities);
  const representativeSummaries = selectAdvisorEntities(legalEntities, 5);
  const redFlagRegister = buildLegalRedFlagRegister(legalEntities);
  const representativesById = new Map(
    legalEntities.map((entity) => [entity.qualifiedId, entity] as const),
  );
  const representativeEntities = representativeSummaries
    .map((summary) => representativesById.get(summary.id) ?? null)
    .filter((entity): entity is EntityResult => Boolean(entity));

  let agreementCount = 0;
  let licenseCount = 0;
  let corporateCount = 0;
  let propertySupportCount = 0;
  let reviewRequiredCount = 0;
  let extractionFailedCount = 0;
  let ambiguousRoutingCount = 0;

  const counterparties = new Set<string>();
  for (const summary of representativeSummaries) {
    for (const counterparty of summary.counterparties) {
      counterparties.add(counterparty);
    }
  }

  for (const entity of legalEntities) {
    switch (classifyLegalEntity(entity)) {
      case "agreement":
        agreementCount += 1;
        break;
      case "license":
        licenseCount += 1;
        break;
      case "corporate":
        corporateCount += 1;
        break;
      case "property_support":
        propertySupportCount += 1;
        break;
      case "other":
        break;
    }

    const normalizedReviewState = normalizeAdvisorReviewState({
      domain: entity.domain,
      frontmatter: entity.frontmatter,
    });
    const reviewFlags = normalizedReviewState.reviewFlags;
    if (normalizedReviewState.requiresReview) reviewRequiredCount += 1;
    if (reviewFlags.includes("extraction_failed")) extractionFailedCount += 1;
    if (reviewFlags.includes("domain_ambiguity")) ambiguousRoutingCount += 1;
  }

  const highSignalClasses = [
    agreementCount > 0 ? `${agreementCount} agreements/contracts` : null,
    licenseCount > 0 ? `${licenseCount} licenses/permits` : null,
    corporateCount > 0 ? `${corporateCount} corporate filings/actions` : null,
  ].filter((value): value is string => Boolean(value));

  const warnings: string[] = [];
  if (reviewRequiredCount > 0) warnings.push("manual_legal_review_required");
  if (extractionFailedCount > 0) warnings.push("extraction_failed_docs_present");
  if (ambiguousRoutingCount > 0) warnings.push("ambiguous_legal_routing_present");
  if (propertySupportCount > 0) warnings.push("property_support_docs_present");
  if (highSignalClasses.length === 0) warnings.push("legal_signal_thin");

  const keyMetrics = {
    doc_count: legalEntities.length,
    raw_entity_count: rawLegalEntities.length,
    agreement_count: agreementCount,
    license_count: licenseCount,
    corporate_count: corporateCount,
    property_support_count: propertySupportCount,
    requires_review_count: reviewRequiredCount,
    extraction_failed_count: extractionFailedCount,
    ambiguous_routing_count: ambiguousRoutingCount,
    red_flag_count: redFlagRegister.length,
    counterparty_count: counterparties.size,
  };

  const redFlagLines = redFlagRegister.length > 0
    ? redFlagRegister.map((entry) => {
        const title = entry.title ?? entry.type;
        const details = [
          entry.managerial_summary,
          entry.review_flags.length > 0 ? `flags: ${entry.review_flags.join(", ")}` : null,
          entry.counterparties.length > 0
            ? `counterparties: ${entry.counterparties.join(", ")}`
            : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" | ");
        return `- ${title}${details ? `: ${details}` : ""}`;
      })
    : ["- No unresolved legal red flags surfaced in the current slice."];

  const keyDocLines = representativeSummaries.length > 0
    ? representativeSummaries.map((summary) => {
        const title = summary.title ?? summary.type;
        const details = [
          summary.managerialSummary,
          summary.counterparties.length > 0
            ? `counterparties: ${summary.counterparties.join(", ")}`
            : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" | ");
        return `- ${title}${details ? `: ${details}` : ""}`;
      })
    : ["- No decision-grade legal summaries are currently available."];

  const body = [
    "## Executive summary",
    legalEntities.length > 0
      ? `Legal pack covers ${legalEntities.length} records. Highest-signal documents currently center on ${highSignalClasses.join(", ") || "mixed legal material"}. ${reviewRequiredCount} documents require manual legal review${ambiguousRoutingCount > 0 ? ` and ${ambiguousRoutingCount} show routing ambiguity` : ""}. ${redFlagRegister.length} high-priority red flag${redFlagRegister.length === 1 ? "" : "s"} remain in decision-grade legal documents.`
      : rawLegalEntities.length > 0
        ? "Legal domain currently contains only scaffolding or meta files; no decision-grade legal records are available yet."
        : "No legal records are currently available in this domain.",
    "",
    "## Red-Flag Register",
    ...redFlagLines,
    "",
    "## Decision-relevant documents",
    ...keyDocLines,
    "",
    "## Legal posture",
    `- Agreements/contracts: ${formatValue(agreementCount)}`,
    `- Licenses/permits: ${formatValue(licenseCount)}`,
    `- Corporate filings/actions: ${formatValue(corporateCount)}`,
    counterparties.size > 0
      ? `- Counterparties surfaced in key docs: ${Array.from(counterparties).slice(0, 6).join(", ")}`
      : "- Counterparty extraction is thin; verify primary agreements manually.",
    "",
    "## Risks and gaps",
    reviewRequiredCount > 0
      ? `- ${reviewRequiredCount} documents are flagged for manual legal review.`
      : "- No manual legal review flags detected in the current slice.",
    extractionFailedCount > 0
      ? `- ${extractionFailedCount} documents had extraction failure and should not be treated as definitive.`
      : "- No extraction failures detected in the current slice.",
    propertySupportCount > 0
      ? `- ${propertySupportCount} documents look like land/zoning support material and should not drive legal decision context without asset review.`
      : "- No material land/zoning support noise detected in the current slice.",
    rawLegalEntities.length > legalEntities.length
      ? `- ${rawLegalEntities.length - legalEntities.length} scaffolding/meta files were excluded from this pack.`
      : "- No scaffolding/meta files were excluded from this pack.",
    "",
    "## Drill-down paths",
    "- Open the representative agreements, licenses, and corporate filings before any consequential legal or governance action.",
    "- Read raw source files for clauses, deadlines, penalties, governing law, and signature evidence.",
  ].join("\n");

  const frontmatter = buildBaseFrontmatter(
    target,
    legalEntities,
    body,
    keyMetrics,
    {
      qualityWarnings: warnings,
      representativeEntities,
      preserveRepresentativeOrder: true,
      drilldownQueries: [
        "domain=legal&limit=20",
        "domain=legal&q=agreement",
        "domain=legal&q=license",
        "domain=legal&q=ahu",
      ],
    },
  );

  return {
    frontmatter: {
      ...frontmatter,
      drilldown: {
        ...(frontmatter.drilldown as Record<string, unknown>),
        red_flag_ids: redFlagRegister.map((entry) => entry.id),
      },
      red_flag_register: redFlagRegister,
    },
    body,
  };
}

function buildAdvisoryDecisionPack(target: SummaryTarget, entities: EntityResult[]): SummaryBuild {
  const domainLabel = getAdvisorDomainLabel(target.domain);
  const rawScopedEntities = entities.filter((entity) => entity.domain === target.domain);
  const scopedEntities = filterDecisionGradeAdvisorEntities(rawScopedEntities);
  const representativeSummaries = selectAdvisorEntities(scopedEntities, 5);
  const representativesById = new Map(
    scopedEntities.map((entity) => [entity.qualifiedId, entity] as const),
  );
  const representativeEntities = representativeSummaries
    .map((summary) => representativesById.get(summary.id) ?? null)
    .filter((entity): entity is EntityResult => Boolean(entity));

  let reviewRequiredCount = 0;
  let extractionFailedCount = 0;
  let ambiguousRoutingCount = 0;
  const counterparties = new Set<string>();
  const documentKinds = new Map<string, number>();

  for (const summary of representativeSummaries) {
    for (const counterparty of summary.counterparties) {
      counterparties.add(counterparty);
    }
  }

  for (const entity of scopedEntities) {
    const normalizedReviewState = normalizeAdvisorReviewState({
      domain: entity.domain,
      frontmatter: entity.frontmatter,
    });
    const reviewFlags = normalizedReviewState.reviewFlags;
    if (normalizedReviewState.requiresReview) reviewRequiredCount += 1;
    if (reviewFlags.includes("extraction_failed")) extractionFailedCount += 1;
    if (reviewFlags.includes("domain_ambiguity")) ambiguousRoutingCount += 1;

    const documentKind =
      toText(entity.frontmatter.target_entity_type) ??
      toText(entity.frontmatter.document_kind) ??
      entity.type;
    documentKinds.set(documentKind, (documentKinds.get(documentKind) ?? 0) + 1);
  }

  const topKinds = Array.from(documentKinds.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([kind, count]) => `${count} ${kind}`);

  const warnings: string[] = [];
  if (reviewRequiredCount > 0) warnings.push("manual_review_required");
  if (extractionFailedCount > 0) warnings.push("extraction_failed_docs_present");
  if (ambiguousRoutingCount > 0) warnings.push("ambiguous_routing_present");
  if (topKinds.length === 0) warnings.push("domain_signal_thin");

  const keyMetrics = {
    doc_count: scopedEntities.length,
    raw_entity_count: rawScopedEntities.length,
    requires_review_count: reviewRequiredCount,
    extraction_failed_count: extractionFailedCount,
    ambiguous_routing_count: ambiguousRoutingCount,
    counterparty_count: counterparties.size,
    top_document_kinds: topKinds,
  };

  const keyDocLines = representativeSummaries.length > 0
    ? representativeSummaries.map((summary) => {
        const title = summary.title ?? summary.type;
        const details = [
          summary.managerialSummary,
          summary.counterparties.length > 0
            ? `counterparties: ${summary.counterparties.join(", ")}`
            : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" | ");
        return `- ${title}${details ? `: ${details}` : ""}`;
      })
    : ["- No decision-grade documents are currently available in this domain."];

  const body = [
    "## Executive summary",
    scopedEntities.length > 0
      ? `${domainLabel} pack covers ${scopedEntities.length} records. Highest-signal items currently center on ${topKinds.join(", ") || "mixed records"}. ${reviewRequiredCount} documents require manual review${ambiguousRoutingCount > 0 ? ` and ${ambiguousRoutingCount} show routing ambiguity` : ""}.`
      : rawScopedEntities.length > 0
        ? `${domainLabel} domain currently contains only scaffolding or meta files; no decision-grade records are available yet.`
        : `No ${target.domain} records are currently available in this domain.`,
    "",
    "## Decision-relevant documents",
    ...keyDocLines,
    "",
    `## ${domainLabel} posture`,
    topKinds.length > 0
      ? `- Top document kinds: ${topKinds.join(", ")}`
      : "- Top document kinds are not yet reliable in this domain.",
    counterparties.size > 0
      ? `- Counterparties surfaced in key docs: ${Array.from(counterparties).slice(0, 6).join(", ")}`
      : "- Counterparty extraction is thin in the current slice.",
    "",
    "## Risks and gaps",
    reviewRequiredCount > 0
      ? `- ${reviewRequiredCount} documents are flagged for manual review.`
      : "- No manual review flags detected in the current slice.",
    extractionFailedCount > 0
      ? `- ${extractionFailedCount} documents had extraction failure and should not be treated as definitive.`
      : "- No extraction failures detected in the current slice.",
    ambiguousRoutingCount > 0
      ? `- ${ambiguousRoutingCount} documents show routing ambiguity and should be verified before action.`
      : "- No routing ambiguity detected in the current slice.",
    rawScopedEntities.length > scopedEntities.length
      ? `- ${rawScopedEntities.length - scopedEntities.length} scaffolding/meta files were excluded from this pack.`
      : "- No scaffolding/meta files were excluded from this pack.",
    "",
    "## Drill-down paths",
    `- Open representative ${target.domain} documents before any consequential decision.`,
    `- Query ${target.domain} by document kind, period, and review flags for exact evidence.`,
  ].join("\n");

  return {
    frontmatter: buildBaseFrontmatter(
      target,
      scopedEntities,
      body,
      keyMetrics,
      {
        qualityWarnings: warnings,
        representativeEntities,
        preserveRepresentativeOrder: true,
        drilldownQueries: [
          `domain=${target.domain}&limit=20`,
          `domain=${target.domain}&status=active&limit=20`,
        ],
      },
    ),
    body,
  };
}

function buildCommunicationsDecisionPack(target: SummaryTarget, entities: EntityResult[]): SummaryBuild {
  const rawScopedEntities = entities.filter((entity) => entity.domain === "communications");
  const scopedEntities = filterDecisionGradeAdvisorEntities(rawScopedEntities);
  const signalEntities = scopedEntities.filter((entity) => entity.type === "communication_signal");
  const dailyLogs = scopedEntities.filter((entity) => entity.type === "communication_daily_log");
  const representativePool = signalEntities.length > 0 ? signalEntities : scopedEntities;
  const representativeSummaries = selectAdvisorEntities(representativePool, 5);
  const representativesById = new Map(
    representativePool.map((entity) => [entity.qualifiedId, entity] as const),
  );
  const representativeEntities = representativeSummaries
    .map((summary) => representativesById.get(summary.id) ?? null)
    .filter((entity): entity is EntityResult => Boolean(entity));

  let commitmentCount = 0;
  let decisionCount = 0;
  let deadlineCount = 0;
  let riskCount = 0;
  let approvalCandidateCount = 0;
  const counterparties = new Set<string>();

  for (const entity of signalEntities) {
    const signalType = toText(entity.frontmatter.signal_type)?.toLowerCase() ?? "";
    if (signalType === "commitment") commitmentCount += 1;
    if (signalType === "decision") decisionCount += 1;
    if (signalType === "deadline") deadlineCount += 1;
    if (signalType === "risk") riskCount += 1;

    const targetDomain = toText(entity.frontmatter.target_domain)?.toLowerCase() ?? "";
    if (targetDomain && targetDomain !== "communications" && targetDomain !== "people") {
      approvalCandidateCount += 1;
    }

    for (const counterparty of normalizeStringList(entity.frontmatter.counterparties, 12)) {
      counterparties.add(counterparty);
    }
  }

  const warnings: string[] = [];
  if (signalEntities.length === 0) warnings.push("communications_signals_missing");
  if (approvalCandidateCount > 0) warnings.push("cross_domain_signals_present");
  if (dailyLogs.length === 0) warnings.push("daily_logs_missing");

  const keyMetrics = {
    signal_count: signalEntities.length,
    daily_log_count: dailyLogs.length,
    raw_entity_count: rawScopedEntities.length,
    commitment_count: commitmentCount,
    decision_count: decisionCount,
    deadline_count: deadlineCount,
    risk_count: riskCount,
    approval_candidate_count: approvalCandidateCount,
    counterparty_count: counterparties.size,
  };

  const keyLines = representativeSummaries.length > 0
    ? representativeSummaries.map((summary) => {
        const title = summary.title ?? summary.type;
        return `- ${title}: ${summary.managerialSummary || "communication signal captured"}`;
      })
    : ["- No decision-grade communication records are currently available."];

  const body = [
    "## Executive summary",
    signalEntities.length > 0
      ? `Communications pack covers ${signalEntities.length} signals across ${dailyLogs.length} daily logs. Current signal mix includes ${commitmentCount} commitments, ${decisionCount} decisions, ${deadlineCount} deadlines, and ${riskCount} risks. ${approvalCandidateCount} signals point to cross-domain follow-up.`
      : rawScopedEntities.length > 0
        ? "Communications domain has raw records, but no decision-grade signals were materialized yet."
        : "No communications records are currently available.",
    "",
    "## Decision-relevant signals",
    ...keyLines,
    "",
    "## Operating posture",
    `- Commitments: ${formatValue(commitmentCount)}`,
    `- Decisions: ${formatValue(decisionCount)}`,
    `- Deadlines: ${formatValue(deadlineCount)}`,
    `- Risks: ${formatValue(riskCount)}`,
    counterparties.size > 0
      ? `- Counterparties mentioned: ${Array.from(counterparties).slice(0, 8).join(", ")}`
      : "- Counterparty extraction is thin in the current slice.",
    "",
    "## Risks and gaps",
    approvalCandidateCount > 0
      ? `- ${approvalCandidateCount} signals point to cross-domain follow-up and likely require explicit approval.`
      : "- No cross-domain approval candidates surfaced in the current slice.",
    dailyLogs.length > 0
      ? `- ${dailyLogs.length} daily communication logs are available for drill-down evidence.`
      : "- Daily communication logs are missing for the current slice.",
    rawScopedEntities.length > scopedEntities.length
      ? `- ${rawScopedEntities.length - scopedEntities.length} low-signal context files were excluded from the executive pack.`
      : "- No low-signal context files were excluded from the executive pack.",
    "",
    "## Drill-down paths",
    "- Query domain=communications&type=communication_signal for exact commitments and deadlines.",
    "- Read the matching communications/daily/*.qmd file before acting on a high-impact signal.",
  ].join("\n");

  return {
    frontmatter: buildBaseFrontmatter(
      target,
      scopedEntities,
      body,
      keyMetrics,
      {
        qualityWarnings: warnings,
        representativeEntities,
        preserveRepresentativeOrder: true,
        drilldownQueries: [
          "domain=communications&type=communication_signal&limit=20",
          "domain=communications&type=communication_daily_log&limit=20",
        ],
      },
    ),
    body,
  };
}

function buildFinanceDecisionPack(target: SummaryTarget, entities: EntityResult[]): SummaryBuild {
  const financeEntities = entities.filter((entity) => entity.domain === "finance");
  const canonicalActualStatements = financeEntities.filter((entity) =>
    isCanonicalActualStatementEntity(entity),
  );
  const canonicalCompanyWideStatements = canonicalActualStatements.filter((entity) =>
    isCompanyWideFinanceEntity(entity),
  );
  const projectionEntities = financeEntities.filter((entity) =>
    isCanonicalProjectionEntity(entity),
  );
  const observedFinanceEntities = financeEntities.filter((entity) =>
    isObservedActualFinanceCoverageEntity(entity),
  );
  const bankingEntities = entities.filter((entity) => entity.domain === "banking");
  const revenueEntities = entities.filter((entity) => entity.domain === "revenue");
  const expenseEntities = entities.filter((entity) => entity.domain === "expenses");
  const canonicalPoints = buildCanonicalFinanceSeries(canonicalActualStatements);
  const canonicalCompanyWidePoints = buildCanonicalFinanceSeries(canonicalCompanyWideStatements);
  const observedPoints = buildCanonicalFinanceSeries(observedFinanceEntities);
  const financeEntitiesById = new Map(
    canonicalActualStatements.map((entity) => [entity.qualifiedId, entity] as const),
  );
  const isCompanyWideRepresentativeId = (qualifiedId: string): boolean => {
    const entity = financeEntitiesById.get(qualifiedId);
    return entity ? isCompanyWideFinanceEntity(entity) : false;
  };
  const latestPoint = observedPoints.length > 0 ? observedPoints[observedPoints.length - 1]! : null;
  const latestCompanyWidePoint =
    canonicalCompanyWidePoints.length > 0
      ? canonicalCompanyWidePoints[canonicalCompanyWidePoints.length - 1]!
      : null;
  const latestCompanyWidePerformancePoint =
    canonicalCompanyWidePoints
      .slice()
      .reverse()
      .find(
        (point) =>
          point.revenue !== null ||
          point.expenses !== null ||
          point.operatingExpenses !== null ||
          point.costOfSales !== null ||
          point.grossProfit !== null ||
          point.netIncome !== null,
      ) ?? null;
  const representativeEntityIds = new Set([
    ...(latestCompanyWidePoint?.representativeIds ?? []),
    ...(latestCompanyWidePerformancePoint?.representativeIds ?? []),
  ]);
  const representativeFinanceEntities = canonicalActualStatements.filter((entity) =>
    representativeEntityIds.has(entity.qualifiedId),
  );
  const latestCompanyWideReviewPending = representativeFinanceEntities.some((entity) => {
    const reviewStatus = toText(entity.frontmatter.review_status);
    return reviewStatus !== null && reviewStatus !== "verified";
  });
  const latestPackPeriod = latestCompanyWidePoint?.period ?? null;
  const latestPeriodPnlEntity =
    latestPackPeriod !== null
      ? canonicalCompanyWideStatements.find(
          (entity) =>
            getActualStatementFamily(entity) === "pnl_month" &&
            getStatementPackPeriodKey(entity.frontmatter) === latestPackPeriod,
        ) ?? null
      : null;
  const latestPeriodBalanceSheetEntity =
    latestPackPeriod !== null
      ? canonicalCompanyWideStatements.find(
          (entity) =>
            getActualStatementFamily(entity) === "balance_sheet_month" &&
            getStatementPackPeriodKey(entity.frontmatter) === latestPackPeriod,
        ) ?? null
      : null;
  const latestPeriodCashFlowEntity =
    latestPackPeriod !== null
      ? canonicalCompanyWideStatements.find(
          (entity) =>
            getActualStatementFamily(entity) === "cash_flow_month" &&
            getStatementPackPeriodKey(entity.frontmatter) === latestPackPeriod,
        ) ?? null
      : null;
  const latestPackMissingPnl = latestPackPeriod !== null && latestPeriodPnlEntity === null;
  const latestPackMissingBalanceSheet =
    latestPackPeriod !== null && latestPeriodBalanceSheetEntity === null;
  const latestPackMissingCashFlow =
    latestPackPeriod !== null && latestPeriodCashFlowEntity === null;
  const latestPackIsPartial =
    latestPackMissingPnl || latestPackMissingBalanceSheet;

  const performancePoint = latestCompanyWidePerformancePoint ?? latestCompanyWidePoint;
  const latestFrontmatter = representativeFinanceEntities[0]?.frontmatter ?? {};
  const incomeMetrics = extractStatementMetrics(
    latestFrontmatter,
    getReportType(latestFrontmatter),
  );
  const preferredEstimatePeriod = latestCompanyWidePoint?.period ?? latestPoint?.period ?? null;
  const bankingEstimate = buildBankingPeriodEstimate(bankingEntities, preferredEstimatePeriod);

  const sumEntityAmounts = (rows: EntityResult[]): number | null => {
    const amounts = rows
      .map((entity) => getAmount(entity.frontmatter))
      .filter((value): value is number => value !== null);
    if (amounts.length === 0) return null;
    return amounts.reduce((sum, value) => sum + value, 0);
  };

  const revenueAmount =
    performancePoint?.revenue ??
    sumEntityAmounts(revenueEntities) ??
    (preferredEstimatePeriod ? bankingEstimate?.inflows ?? null : null) ??
    null;
  const expenseAmount =
    performancePoint?.expenses ??
    sumEntityAmounts(expenseEntities) ??
    (preferredEstimatePeriod ? bankingEstimate?.outflows ?? null : null) ??
    null;
  const netIncome =
    performancePoint?.netIncome ??
    (revenueAmount !== null && expenseAmount !== null
      ? revenueAmount - expenseAmount
      : preferredEstimatePeriod ? bankingEstimate?.net ?? null : null);
  const cashPosition = latestCompanyWidePoint?.cashPosition ?? null;
  const runway = latestCompanyWidePoint?.runwayMonths ?? null;
  const latestFinancePeriod =
    latestCompanyWidePoint?.period ??
    (preferredEstimatePeriod ? bankingEstimate?.period ?? null : null);
  const latestPerformancePeriod = performancePoint?.period ?? null;
  const latestObservedPeriod = latestPoint?.period ?? null;
  const overdueRevenue = revenueEntities.filter((entity) => {
    const status = String(entity.status ?? entity.frontmatter.status ?? "").toLowerCase();
    return status.includes("overdue") || status.includes("past_due");
  }).length;
  const overdueExpenses = expenseEntities.filter((entity) => {
    const status = String(entity.status ?? entity.frontmatter.status ?? "").toLowerCase();
    return status.includes("overdue") || status.includes("past_due");
  }).length;
  const projectionSelection = selectAuthoritativeProjectionPack(projectionEntities);
  const authoritativeProjectionEntities = projectionSelection.authoritativeEntities;
  const projectionPeriods = sortPeriods(
    uniqueStrings(authoritativeProjectionEntities.map((entity) => getPeriodKey(entity.frontmatter))),
  );
  const latestProjectionEntity = projectionSelection.authoritativeLatestEntity;
  const latestProjectionPeriod = latestProjectionEntity
    ? getPeriodKey(latestProjectionEntity.frontmatter)
    : null;
  const latestProjectionMetrics = latestProjectionEntity
    ? getProjectionSummaryMetrics(latestProjectionEntity.frontmatter)
    : {
        revenue: null,
        expenses: null,
        grossProfit: null,
        netIncome: null,
        cashPosition: null,
      };
  const warnings: string[] = [];
  if (!latestPoint) warnings.push("latest_finance_snapshot_missing");
  if (!latestCompanyWidePoint && latestPoint) warnings.push("finance_company_wide_metrics_missing");
  if (bankingEntities.length === 0) warnings.push("banking_flow_missing");
  if (revenueAmount === null && expenseAmount === null && netIncome === null && cashPosition === null) {
    warnings.push("finance_metrics_missing");
  }
  if (
    latestObservedPeriod &&
    latestFinancePeriod &&
    latestObservedPeriod !== latestFinancePeriod &&
    latestPoint?.sourceKinds.length &&
    latestPoint.sourceKinds.every((kind) => kind === "document_import")
  ) {
    warnings.push("finance_latest_period_imports_only");
  } else if (
    latestObservedPeriod &&
    latestFinancePeriod &&
    latestObservedPeriod !== latestFinancePeriod
  ) {
    warnings.push("finance_latest_period_internal_scope_only");
  }
  if (latestCompanyWidePoint?.hasConflict) warnings.push("finance_statement_conflict_detected");
  if (latestCompanyWidePoint?.importedOnly) warnings.push("finance_imports_only");
  if (latestFinancePeriod && latestCompanyWideReviewPending) {
    warnings.push("finance_company_wide_review_pending");
  }
  if (latestPackMissingPnl) warnings.push("latest_pnl_missing");
  if (latestPackMissingBalanceSheet) warnings.push("latest_balance_sheet_missing");
  if (latestPackIsPartial) warnings.push("finance_latest_pack_partial");
  if (
    bankingEstimate &&
    preferredEstimatePeriod &&
    (latestCompanyWidePoint?.importedOnly || !latestCompanyWidePoint) &&
    (expenseEntities.length === 0 || revenueEntities.length === 0)
  ) {
    warnings.push("finance_banking_estimate");
  }
  if (projectionSelection.packCount > 1) {
    warnings.push("finance_projection_multiple_packs_detected");
  }

  const keyMetrics = {
    latest_period: latestFinancePeriod,
    latest_performance_period: latestPerformancePeriod,
    latest_observed_period: latestObservedPeriod,
    projection_start_period: projectionPeriods[0] ?? null,
    projection_latest_period: latestProjectionPeriod,
    projection_period_count: projectionPeriods.length,
    revenue: revenueAmount,
    expenses: expenseAmount,
    operating_expenses: performancePoint?.operatingExpenses ?? incomeMetrics.operating_expenses,
    cost_of_sales: performancePoint?.costOfSales ?? incomeMetrics.cost_of_sales,
    gross_profit: performancePoint?.grossProfit ?? incomeMetrics.gross_profit,
    net_income: netIncome,
    cash_position: cashPosition,
    runway_months: runway,
    projection_revenue: latestProjectionMetrics.revenue,
    projection_expenses: latestProjectionMetrics.expenses,
    projection_gross_profit: latestProjectionMetrics.grossProfit,
    projection_net_income: latestProjectionMetrics.netIncome,
    banking_records: bankingEntities.length,
    open_revenue_alerts: overdueRevenue,
    open_expense_alerts: overdueExpenses,
  };

  const representativeEntities = uniqueEntityResults([
    ...representativeFinanceEntities,
    ...(bankingEstimate?.entities
      .slice()
      .sort(
        (left, right) =>
          Math.abs(getAmount(right.frontmatter) ?? 0) - Math.abs(getAmount(left.frontmatter) ?? 0),
      )
      .slice(0, 5) ?? []),
    latestProjectionEntity,
  ]);
  const summaryEntities = uniqueEntityResults([
    ...canonicalActualStatements,
    ...authoritativeProjectionEntities,
    ...bankingEntities,
    ...revenueEntities,
    ...expenseEntities,
  ]);

  const financeDrilldownPaths = uniqueStrings([
    latestFinancePeriod
      ? latestPeriodPnlEntity?.filePath ?? null
      : null,
    latestFinancePeriod
      ? latestPeriodBalanceSheetEntity?.filePath ?? null
      : null,
    latestFinancePeriod
      ? latestPeriodCashFlowEntity?.filePath ?? null
      : null,
    latestProjectionEntity?.filePath ?? null,
    canonicalActualStatements.length > 0 ? "finance/statements/_summary.qmd" : null,
    authoritativeProjectionEntities.length > 0 ? "finance/projections/_summary.qmd" : null,
    bankingEntities.length > 0 ? "banking/transactions/_summary.qmd" : null,
    revenueEntities.length > 0 ? "revenue/invoices/_summary.qmd" : null,
    expenseEntities.length > 0 ? "expenses/bills/_summary.qmd" : null,
  ]);
  const latestPeriodInternalScopeOnly =
    latestObservedPeriod &&
    latestFinancePeriod &&
    latestObservedPeriod !== latestFinancePeriod &&
    !warnings.includes("finance_latest_period_imports_only");
  const latestPeriodImportsOnly =
    latestObservedPeriod &&
    latestFinancePeriod &&
    latestObservedPeriod !== latestFinancePeriod &&
    warnings.includes("finance_latest_period_imports_only");
  const performancePeriodDiffers =
    latestPerformancePeriod !== null &&
    latestFinancePeriod !== null &&
    latestPerformancePeriod !== latestFinancePeriod;
  const latestCompanyWideHasConflict = latestCompanyWidePoint?.hasConflict === true;
  const latestFinanceLabel =
    latestPackIsPartial
      ? `Latest company-wide finance period ${formatValue(latestFinancePeriod)} is only partially materialized. Revenue ${formatValue(revenueAmount)}, expenses ${formatValue(expenseAmount)}, net ${formatValue(netIncome)}.`
      : latestCompanyWideReviewPending || latestCompanyWideHasConflict
        ? `Latest company-wide finance period ${formatValue(latestFinancePeriod)}. Revenue ${formatValue(revenueAmount)}, expenses ${formatValue(expenseAmount)}, net ${formatValue(netIncome)}.`
        : `Latest verified company-wide finance period ${formatValue(latestFinancePeriod)}. Revenue ${formatValue(revenueAmount)}, expenses ${formatValue(expenseAmount)}, net ${formatValue(netIncome)}.`;
  const hasStructuredPerformanceCoverage =
    revenueAmount !== null ||
    expenseAmount !== null ||
    netIncome !== null ||
    cashPosition !== null;
  const latestFinanceNarrative = [
    latestFinanceLabel,
    performancePeriodDiffers
      ? `Latest company-wide performance metrics currently come from ${formatValue(latestPerformancePeriod)}.`
      : null,
    latestPeriodInternalScopeOnly
      ? `Newer finance files reach ${formatValue(latestObservedPeriod)}, but those newer statements are internal-scope only and are not treated as one company total.`
      : null,
    latestPeriodImportsOnly
      ? `Newer finance imports reach ${formatValue(latestObservedPeriod)}, but they are not promoted into canonical company-wide statements yet.`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const drilldownLines = summarizeFilePaths(financeDrilldownPaths);

  const body = [
    "## Executive summary",
    latestFinancePeriod
      ? latestFinanceNarrative
      : latestObservedPeriod
        ? `Latest finance files reach ${formatValue(latestObservedPeriod)}, but a company-wide finance period is not yet verified. Internal-scope statements are available, but they are not treated as one company total.`
        : "No verified company-wide finance period is currently available.",
    "",
    "## Liquidity",
    `- Cash position: ${formatValue(cashPosition)}`,
    `- Runway: ${formatValue(runway)} months`,
    `- Banking records in scope: ${formatValue(bankingEntities.length)}`,
    "",
    "## Performance",
    `- Revenue: ${formatValue(revenueAmount)}`,
    `- Cost of sales: ${formatValue(performancePoint?.costOfSales ?? incomeMetrics.cost_of_sales)}`,
    `- Operating expenses: ${formatValue(performancePoint?.operatingExpenses ?? incomeMetrics.operating_expenses)}`,
    `- Gross profit: ${formatValue(performancePoint?.grossProfit ?? incomeMetrics.gross_profit)}`,
    `- Net income: ${formatValue(netIncome)}`,
    "",
    "## Projection outlook",
    latestProjectionPeriod
      ? `- Projection horizon: ${formatValue(projectionPeriods[0] ?? null)} to ${formatValue(latestProjectionPeriod)} (${projectionPeriods.length} monthly slices).`
      : "- No canonical finance projection plan is currently available.",
    latestProjectionPeriod
      ? `- Latest projection period ${formatValue(latestProjectionPeriod)}: revenue ${formatValue(latestProjectionMetrics.revenue)}, expenses ${formatValue(latestProjectionMetrics.expenses)}, net ${formatValue(latestProjectionMetrics.netIncome)}.`
      : "- Projection metrics are unavailable.",
    "",
    "## Risks and gaps",
    warnings.length > 0
      ? `- ${warnings.join(", ")}`
      : "- No critical data-quality gaps detected in the current finance pack.",
    latestCompanyWidePoint?.hasConflict
      ? `- Conflicting statement metrics detected for ${latestCompanyWidePoint.period}: ${latestCompanyWidePoint.conflictMetrics.join(", ")}.`
      : "- No conflicting finance statements detected for the latest period.",
    latestCompanyWidePoint?.importedOnly
      ? "- Latest period currently depends on imported finance documents, not promoted snapshots."
      : latestFinancePeriod
        ? latestPackIsPartial
          ? `- Latest promoted company-wide pack for ${formatValue(latestFinancePeriod)} is partial: P&L ${latestPeriodPnlEntity ? "present" : "missing"}, Balance Sheet ${latestPeriodBalanceSheetEntity ? "present" : "missing"}, Cash Flow ${latestPeriodCashFlowEntity ? "present" : "missing"}.`
          : "- Latest period includes promoted finance statement coverage."
        : "- No promoted company-wide finance statement coverage is available for the latest observed period.",
    latestFinancePeriod
      ? latestPackIsPartial
        ? "- Latest company-wide period has verified promoted statements where available, but the latest statement pack is incomplete."
        : latestCompanyWideReviewPending
        ? "- Latest company-wide period still includes review-pending statements."
        : "- Latest company-wide period is backed by verified statements only."
      : "- No company-wide statement review status is available.",
    performancePeriodDiffers
      ? `- Latest company-wide performance metrics currently come from ${formatValue(latestPerformancePeriod)}, while the newest company-wide finance period is ${formatValue(latestFinancePeriod)}.`
      : "- Latest company-wide performance metrics align with the latest company-wide finance period.",
    warnings.includes("finance_latest_period_internal_scope_only")
      ? `- The newest finance files are for ${formatValue(latestObservedPeriod)}, but they remain internal-scope statements and were excluded from the company-wide pack.`
      : warnings.includes("finance_latest_period_imports_only")
      ? `- The newest finance files are raw imports for ${formatValue(latestObservedPeriod)}; promote or reprocess them before treating them as company-wide statement coverage.`
      : "- The latest observed finance files do not currently introduce newer internal-scope-only coverage.",
    warnings.includes("finance_banking_estimate")
      ? `- Revenue/expense coverage for ${formatValue(latestFinancePeriod)} is partially estimated from banking transactions because structured revenue/expense records are incomplete.`
      : hasStructuredPerformanceCoverage
        ? "- Revenue and expense coverage reflects structured finance sources for the latest period."
        : "- Structured revenue and expense coverage is incomplete for the latest period.",
    revenueEntities.length > 0
      ? `- Revenue domain records in scope: ${revenueEntities.length}.`
      : "- No structured revenue-domain records are currently linked into this finance pack.",
    expenseEntities.length > 0
      ? `- Expense domain records in scope: ${expenseEntities.length}.`
      : "- No structured expense-domain records are currently linked into this finance pack.",
    overdueRevenue > 0 ? `- ${overdueRevenue} revenue records show overdue or past-due status.` : "- No overdue revenue markers detected.",
    overdueExpenses > 0 ? `- ${overdueExpenses} expense records show overdue or past-due status.` : "- No overdue expense markers detected.",
    "",
    "## Source documents",
    ...renderSourceDocumentLines(uniqueEntityResults([
      ...representativeFinanceEntities,
      ...authoritativeProjectionEntities,
    ])),
    "",
    "## Drill-down paths",
    ...(drilldownLines.length > 0
      ? drilldownLines
      : ["- No deeper finance drill-down summaries are currently materialized."]),
  ].join("\n");

  return {
    frontmatter: buildBaseFrontmatter(
      target,
      summaryEntities,
      body,
      keyMetrics,
      {
        qualityWarnings: warnings,
        coverageCompletenessOverride: latestPackIsPartial ? "partial" : undefined,
        coverageEntities: canonicalActualStatements,
        representativeEntities,
        drilldownQueries: [
          "domain=finance&limit=20",
          "domain=finance&type=income_statement&limit=20",
          "domain=finance&type=forecast&limit=20",
          "domain=banking&limit=20",
          "domain=revenue&limit=20",
          "domain=expenses&limit=20",
        ],
      },
    ),
    body,
  };
}

function buildFinanceStatementsPack(target: SummaryTarget, entities: EntityResult[]): SummaryBuild {
  const statementEntities = entities
    .filter((entity) => isCanonicalActualStatementEntity(entity))
    .sort(compareEntitiesByPeriodAndFreshness);
  const companyWideEntities = statementEntities.filter((entity) => isCompanyWideFinanceEntity(entity));
  const effectiveEntities = companyWideEntities.length > 0 ? companyWideEntities : statementEntities;
  const periods = sortPeriods(
    uniqueStrings(effectiveEntities.map((entity) => getStatementPackPeriodKey(entity.frontmatter))),
  );
  const latestPeriod = periods.at(-1) ?? null;
  const latestPeriodEntities = effectiveEntities.filter(
    (entity) => getStatementPackPeriodKey(entity.frontmatter) === latestPeriod,
  );
  const pickLatestFamilyEntity = (family: CanonicalActualStatementFamily): EntityResult | null => {
    const familyEntities = latestPeriodEntities.filter(
      (entity) => getActualStatementFamily(entity) === family,
    );
    if (familyEntities.length === 0) return null;

    const explicitCompanyWide = familyEntities.filter((entity) => {
      if (entity.frontmatter.company_wide === true) return true;
      const normalizedScope = String(
        toText(entity.frontmatter.scope_key) ??
          toText(entity.frontmatter.scope_label) ??
          "",
      )
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      return normalizedScope === "company";
    });

    const preferredPool = explicitCompanyWide.length > 0 ? explicitCompanyWide : familyEntities;
    return preferredPool[0] ?? null;
  };

  const latestPnl = pickLatestFamilyEntity("pnl_month");
  const latestBalanceSheet = pickLatestFamilyEntity("balance_sheet_month");
  const latestCashFlow = pickLatestFamilyEntity("cash_flow_month");

  const familyPeriods = (family: CanonicalActualStatementFamily) =>
    sortPeriods(
      uniqueStrings(
        effectiveEntities
          .filter((entity) => getActualStatementFamily(entity) === family)
          .map((entity) => getStatementPackPeriodKey(entity.frontmatter)),
      ),
    );

  const pnlPeriods = familyPeriods("pnl_month");
  const balanceSheetPeriods = familyPeriods("balance_sheet_month");
  const cashFlowPeriods = familyPeriods("cash_flow_month");

  const latestPnlMetrics = latestPnl
    ? extractStatementMetrics(latestPnl.frontmatter, getReportType(latestPnl.frontmatter))
    : null;

  const warnings: string[] = [];
  if (statementEntities.length === 0) warnings.push("finance_statements_missing");
  if (!latestPeriod) warnings.push("finance_statement_period_missing");
  if (!latestPnl) warnings.push("latest_pnl_missing");
  if (!latestBalanceSheet) warnings.push("latest_balance_sheet_missing");
  if (!latestCashFlow) warnings.push("latest_cash_flow_missing");
  if (companyWideEntities.length === 0 && statementEntities.length > 0) {
    warnings.push("finance_company_wide_metrics_missing");
  }

  const keyMetrics = {
    latest_period: latestPeriod,
    statement_count: statementEntities.length,
    company_wide_statement_count: companyWideEntities.length,
    pnl_period_count: pnlPeriods.length,
    balance_sheet_period_count: balanceSheetPeriods.length,
    cash_flow_period_count: cashFlowPeriods.length,
    revenue: latestPnlMetrics?.revenue ?? null,
    expenses: latestPnlMetrics?.expenses ?? null,
    net_income: latestPnlMetrics?.net_income ?? null,
    cash_position:
      latestCashFlow
        ? readMetric(latestCashFlow.frontmatter, ["closing_cash", "cash_position", "ending_cash"])
        : null,
  };

  const representativeEntities = uniqueEntityResults([
    latestPnl,
    latestBalanceSheet,
    latestCashFlow,
  ]);

  const body = [
    "## Executive summary",
    latestPeriod
      ? `Canonical monthly finance statements are available through ${formatValue(latestPeriod)}. Latest pack coverage: P&L ${latestPnl ? "present" : "missing"}, Balance Sheet ${latestBalanceSheet ? "present" : "missing"}, Cash Flow ${latestCashFlow ? "present" : "missing"}.`
      : "No canonical monthly finance statements are currently available.",
    "",
    "## Latest monthly pack",
    latestPnl
      ? `- P&L ${formatValue(latestPeriod)}: revenue ${formatValue(latestPnlMetrics?.revenue ?? null)}, expenses ${formatValue(latestPnlMetrics?.expenses ?? null)}, net income ${formatValue(latestPnlMetrics?.net_income ?? null)}.`
      : "- P&L for the latest monthly pack is missing.",
    latestBalanceSheet
      ? `- Balance Sheet ${formatValue(latestPeriod)}: total assets ${formatValue(readMetric(latestBalanceSheet.frontmatter, ["total_assets"]))}, total liabilities ${formatValue(readMetric(latestBalanceSheet.frontmatter, ["total_liabilities"]))}, equity ${formatValue(readMetric(latestBalanceSheet.frontmatter, ["equity"]))}.`
      : "- Balance Sheet for the latest monthly pack is missing.",
    latestCashFlow
      ? `- Cash Flow ${formatValue(latestPeriod)}: closing cash ${formatValue(readMetric(latestCashFlow.frontmatter, ["closing_cash", "cash_position", "ending_cash"]))}, net cash flow ${formatValue(readMetric(latestCashFlow.frontmatter, ["net_cash_flow"]))}.`
      : "- Cash Flow for the latest monthly pack is missing.",
    "",
    "## Coverage",
    `- P&L periods: ${pnlPeriods.length > 0 ? pnlPeriods.join(", ") : "none"}`,
    `- Balance Sheet periods: ${balanceSheetPeriods.length > 0 ? balanceSheetPeriods.join(", ") : "none"}`,
    `- Cash Flow periods: ${cashFlowPeriods.length > 0 ? cashFlowPeriods.join(", ") : "none"}`,
    "",
    "## Source documents",
    ...renderSourceDocumentLines(representativeEntities),
    "",
    "## Drill-down paths",
    ...summarizeFilePaths(
      uniqueStrings([
        latestPnl?.filePath ?? null,
        latestBalanceSheet?.filePath ?? null,
        latestCashFlow?.filePath ?? null,
      ]),
    ),
  ].join("\n");

  return {
    frontmatter: buildBaseFrontmatter(
      target,
      statementEntities,
      body,
      keyMetrics,
      {
        qualityWarnings: warnings,
        coverageEntities: effectiveEntities,
        representativeEntities,
        preserveRepresentativeOrder: true,
        drilldownQueries: [
          "domain=finance&type=income_statement&limit=20",
          "domain=finance&type=balance_sheet&limit=20",
          "domain=finance&type=cash_flow_statement&limit=20",
        ],
      },
    ),
    body,
  };
}

function buildFinanceProjectionsPack(target: SummaryTarget, entities: EntityResult[]): SummaryBuild {
  const projectionSelection = selectAuthoritativeProjectionPack(
    entities.filter((entity) => isCanonicalProjectionEntity(entity)),
  );
  const projectionEntities = [...projectionSelection.projectionEntities].sort(compareEntitiesByPeriodAndFreshness);
  const effectiveEntities = [...projectionSelection.authoritativeEntities].sort(compareEntitiesByPeriodAndFreshness);
  const periods = sortPeriods(
    uniqueStrings(effectiveEntities.map((entity) => getPeriodKey(entity.frontmatter))),
  );
  const latestEntity = projectionSelection.authoritativeLatestEntity;
  const latestPeriod = latestEntity ? getPeriodKey(latestEntity.frontmatter) : null;
  const latestMetrics = latestEntity
    ? getProjectionSummaryMetrics(latestEntity.frontmatter)
    : {
        revenue: null,
        expenses: null,
        grossProfit: null,
        netIncome: null,
        cashPosition: null,
      };

  const primaryPlanKey =
    toText(latestEntity?.frontmatter.plan_key) ??
    toText(effectiveEntities[0]?.frontmatter.plan_key) ??
    null;
  const primaryScenarioKey =
    toText(latestEntity?.frontmatter.scenario_key) ??
    toText(effectiveEntities[0]?.frontmatter.scenario_key) ??
    null;

  const warnings: string[] = [];
  if (projectionEntities.length === 0) warnings.push("finance_projection_missing");
  if (projectionSelection.packCount > 1) {
    warnings.push("finance_projection_multiple_packs_detected");
  }

  const keyMetrics = {
    plan_key: primaryPlanKey,
    scenario_key: primaryScenarioKey,
    latest_period: latestPeriod,
    start_period: periods[0] ?? null,
    projection_period_count: periods.length,
    revenue: latestMetrics.revenue,
    expenses: latestMetrics.expenses,
    gross_profit: latestMetrics.grossProfit,
    net_income: latestMetrics.netIncome,
    cash_position: latestMetrics.cashPosition,
  };

  const body = [
    "## Executive summary",
    latestPeriod
      ? `Canonical finance projection plan ${formatValue(primaryPlanKey)} / ${formatValue(primaryScenarioKey)} covers ${formatValue(periods[0] ?? null)} to ${formatValue(latestPeriod)} across ${effectiveEntities.length} monthly slices.`
      : "No canonical finance projection plan is currently available.",
    "",
    "## Latest projection slice",
    latestPeriod
      ? `- Period ${formatValue(latestPeriod)}: revenue ${formatValue(latestMetrics.revenue)}, expenses ${formatValue(latestMetrics.expenses)}, gross profit ${formatValue(latestMetrics.grossProfit)}, net income ${formatValue(latestMetrics.netIncome)}.`
      : "- Projection metrics are unavailable.",
    latestPeriod
      ? `- Cash position: ${formatValue(latestMetrics.cashPosition)}`
      : "- Cash position is unavailable.",
    "",
    "## Coverage",
    `- Plan key: ${formatValue(primaryPlanKey)}`,
    `- Scenario: ${formatValue(primaryScenarioKey)}`,
    `- Periods: ${periods.length > 0 ? periods.join(", ") : "none"}`,
    "",
    "## Source documents",
    ...renderSourceDocumentLines(effectiveEntities),
    "",
    "## Drill-down paths",
    ...summarizeFilePaths(uniqueStrings([latestEntity?.filePath ?? null])),
  ].join("\n");

  return {
    frontmatter: buildBaseFrontmatter(
      target,
      projectionEntities,
      body,
      keyMetrics,
      {
        qualityWarnings: warnings,
        coverageEntities: effectiveEntities,
        representativeEntities: latestEntity ? [latestEntity] : [],
        preserveRepresentativeOrder: true,
        drilldownQueries: [
          "domain=finance&type=forecast&limit=20",
        ],
      },
    ),
    body,
  };
}

function buildExecutiveOverview(target: SummaryTarget, entities: EntityResult[]): SummaryBuild {
  const byDomain: Record<string, number> = {};
  for (const entity of entities) {
    byDomain[entity.domain] = (byDomain[entity.domain] ?? 0) + 1;
  }

  const body = [
    "## Executive summary",
    "Company overview is based on the currently enabled live domains.",
    "",
    "## Key facts",
    ...Object.entries(byDomain).map(([domain, count]) => `- ${domain}: ${count}`),
    "",
    "## Risks and gaps",
    entities.length === 0
      ? "- No source entities available for company overview."
      : "- Domain-specific summaries should be reviewed for drill-down.",
    "",
    "## Drill-down paths",
    "- Review domain summaries for finance, banking, revenue, expenses, and knowledge.",
  ].join("\n");

  return {
    frontmatter: buildBaseFrontmatter(
      target,
      entities,
      body,
      { domain_count: Object.keys(byDomain).length, entity_count: entities.length },
      {
        drilldownQueries: Object.keys(byDomain).map((domain) => `domain=${domain}&limit=20`),
      },
    ),
    body,
  };
}

function buildSummary(target: SummaryTarget, entities: EntityResult[]): SummaryBuild {
  const summary = (() => {
    switch (target.summaryTemplate) {
    case "periodic_snapshot":
      return buildPeriodicSnapshotSummary(target, entities);
    case "transaction_flow":
      return buildTransactionFlowSummary(target, entities);
    case "knowledge_catalog":
      return buildKnowledgeCatalogSummary(target, entities);
    case "legal_decision_pack":
      return buildLegalDecisionPack(target, entities);
    case "advisory_decision_pack":
      return buildAdvisoryDecisionPack(target, entities);
    case "communications_decision_pack":
      return buildCommunicationsDecisionPack(target, entities);
    case "finance_decision_pack":
      return buildFinanceDecisionPack(target, entities);
    case "finance_statements_pack":
      return buildFinanceStatementsPack(target, entities);
    case "finance_projections_pack":
      return buildFinanceProjectionsPack(target, entities);
    case "executive_overview":
      return buildExecutiveOverview(target, entities);
    }
  })();

  return finalizeSummaryBuild(summary);
}

export const __test__ = {
  buildPeriodicSnapshotSummary,
  buildLegalDecisionPack,
  buildAdvisoryDecisionPack,
  buildCommunicationsDecisionPack,
  buildFinanceDecisionPack,
  getSnapshotSortKey,
  buildSummary,
};

function shouldIncludeEntity(target: SummaryTarget, entity: EntityResult): boolean {
  if (!target.sourceDomains.includes(entity.domain)) return false;
  if (entity.type === "statement_lines_technical") return false;
  if (entity.filePath.endsWith(".statement-lines.qmd")) return false;
  if (target.includeTypes && target.includeTypes.length > 0 && !target.includeTypes.includes(entity.type)) {
    return false;
  }
  if (!matchesAny(entity.filePath, target.sourcePaths)) return false;
  if (matchesAny(entity.filePath, target.excludePaths)) return false;
  return !entity.filePath.endsWith("/_summary.qmd");
}

async function loadTargetEntities(
  target: SummaryTarget,
  opts: CompanyDbRequestOptions,
): Promise<EntityResult[]> {
  const results = new Map<string, EntityResult>();
  for (const domain of target.sourceDomains) {
    const entities = await queryAllEntities({ domain }, opts);
    for (const entity of entities) {
      if (shouldIncludeEntity(target, entity)) {
        results.set(entity.qualifiedId, entity);
      }
    }
  }
  return Array.from(results.values());
}

async function materializeTarget(
  target: SummaryTarget,
  request: SummaryRefreshRequest,
): Promise<SummaryRefreshResultItem> {
  const requestOpts: CompanyDbRequestOptions = {
    companySlug: request.companySlug,
    callerId: `summary-materializer-${request.companySlug}`,
    callerRole: "cfo_agent",
    port: request.port,
  };

  const entities = await loadTargetEntities(target, requestOpts);
  if (entities.length === 0) {
    const existing = await getSummaryByPath(target.physicalPath, requestOpts);
    if (existing) {
      const result = await submitSummaryDelete(
        request.companySlug,
        {
          targetId: target.id,
          domain: target.domain,
          filePath: target.physicalPath,
          metadata: {
            refreshReason: request.reason ?? "manual",
            sourceDomains: target.sourceDomains,
            emptyTarget: true,
          },
        },
        request.writeQueuePort,
      );
      return {
        targetId: target.id,
        path: target.physicalPath,
        status: "deleted",
        commitSha: result.commitSha,
      };
    }
    return {
      targetId: target.id,
      path: target.physicalPath,
      status: "skipped",
      commitSha: null,
    };
  }

  const summary = buildSummary(target, entities);
  const existing = await getSummaryByPath(target.physicalPath, requestOpts);
  const existingHash = String(existing?.frontmatter.summary_hash ?? "");
  const nextHash = String(summary.frontmatter.summary_hash ?? "");
  if (existingHash && nextHash && existingHash === nextHash) {
    return {
      targetId: target.id,
      path: target.physicalPath,
      status: "noop",
      commitSha: null,
    };
  }

  const result = await submitSummaryDoc(
    request.companySlug,
    {
      targetId: target.id,
      domain: target.domain,
      filePath: target.physicalPath,
      frontmatter: summary.frontmatter,
      body: summary.body,
      metadata: {
        refreshReason: request.reason ?? "manual",
        sourceDomains: target.sourceDomains,
      },
    },
    request.writeQueuePort,
  );

  return {
    targetId: target.id,
    path: target.physicalPath,
    status: "updated",
    commitSha: result.commitSha,
  };
}

export async function refreshSummaryTargets(
  request: SummaryRefreshRequest,
): Promise<SummaryRefreshResult> {
  await ensureSummaryBootstrap(request.companySlug);
  const targets = await loadSummaryTargets(request.companySlug);
  const filtered = orderTargets(
    targets.filter((target) => {
      if (!target.enabled) return false;
      if (request.targetIds && request.targetIds.length > 0) {
        return request.targetIds.includes(target.id);
      }
      if (request.domains && request.domains.length > 0) {
        return target.sourceDomains.some((domain) => request.domains?.includes(domain));
      }
      return true;
    }),
  );

  const items: SummaryRefreshResultItem[] = [];
  for (const target of filtered) {
    items.push(await materializeTarget(target, request));
  }

  return {
    companySlug: request.companySlug,
    items,
  };
}
