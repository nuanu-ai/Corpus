import { eq } from "drizzle-orm";

import {
  getDomainSummary,
  queryEntitiesWithCount,
  type CompanyDbRequestOptions,
  type EntityResult,
  type QueryResultWithCount,
} from "@/lib/company-db/client";
import {
  extractSnapshotStatementMetrics,
  isTrialBalanceSnapshotReportType,
  normalizeFinancialReportType,
} from "@/lib/company-db/financial-metrics";
import { selectAuthoritativeProjectionPack } from "@/lib/company-db/financial-canonical";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { normalizeReportingPeriodKey, isUnknownReportingPeriod } from "@/lib/document-parsers/period-utils";
import { attachReportingBalances } from "@/lib/fx/reporting-balances";
import {
  getAccountBalances,
  getCashFlowSummary,
  getExpenseBreakdown,
  getPnLSummary,
  type CashFlowMonth,
  type ExpenseBreakdown,
} from "@/lib/queries/financial-summary";

export type FinancialCoverageMode =
  | "summary-complete"
  | "docs-partial"
  | "txns-estimate"
  | "no-finance-data";

export type FinancialOverviewSource =
  | "uploaded_statements"
  | "trial_balance"
  | "transactions"
  | "none";

export type FinancialQuality =
  | "verified"
  | "partial"
  | "estimated"
  | "none";

export interface FinancialSeriesPoint {
  period: string;
  revenue: number | null;
  expenses: number | null;
  operatingExpenses: number | null;
  costOfSales: number | null;
  grossProfit: number | null;
  netIncome: number | null;
  cashPosition: number | null;
  runwayMonths: number | null;
}

export interface BalanceSheetSeriesPoint {
  period: string;
  cashAndEquivalents: number | null;
  inventory: number | null;
  totalCurrentAssets: number | null;
  fixedAssets: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  retainedEarnings: number | null;
}

export interface ProjectionSeriesPoint {
  period: string;
  revenue: number | null;
  expenses: number | null;
  grossProfit: number | null;
  netIncome: number | null;
  cashPosition: number | null;
}

export interface PlanVsActualSeriesPoint {
  period: string;
  actualRevenue: number | null;
  plannedRevenue: number | null;
  actualExpenses: number | null;
  plannedExpenses: number | null;
  actualNetIncome: number | null;
  plannedNetIncome: number | null;
}

export interface FinancialOverview {
  mode: FinancialCoverageMode;
  source: FinancialOverviewSource;
  sourceLabel: string;
  sourcePeriod: string | null;
  currency: string;
  quality: FinancialQuality;
  warnings: string[];
  pnl: {
    revenue: number | null;
    expenses: number | null;
    operatingExpenses: number | null;
    costOfSales: number | null;
    grossProfit: number | null;
    netProfit: number | null;
    marginPct: number | null;
    revenueChange: number | null;
    expenseChange: number | null;
  };
  cash: {
    cashPosition: number | null;
    runwayMonths: number | null;
    avgMonthlyBurn: number | null;
    avgMonthlyRevenue: number | null;
    avgMonthlyProfit: number | null;
    chartKind: "cash_flow" | "cash_position" | "none";
  };
  balanceSheet: {
    cashAndEquivalents: number | null;
    inventory: number | null;
    totalCurrentAssets: number | null;
    fixedAssets: number | null;
    totalAssets: number | null;
    totalLiabilities: number | null;
    equity: number | null;
    retainedEarnings: number | null;
  };
  projection: {
    available: boolean;
    latestPlanPeriod: string | null;
    comparableThroughPeriod: string | null;
    revenue: number | null;
    expenses: number | null;
    grossProfit: number | null;
    netIncome: number | null;
    cashPosition: number | null;
    varianceRevenue: number | null;
    varianceExpenses: number | null;
    varianceNetIncome: number | null;
  };
  expenses: {
    total: number | null;
    operatingExpenses: number | null;
    costOfSales: number | null;
    breakdown: ExpenseBreakdown[];
    breakdownBasis: "transactions" | "statements" | "none";
    transactionCount: number;
  };
  series: {
    pnl: FinancialSeriesPoint[];
    cash: Array<{ period: string; cashPosition: number; source: "statements" }>;
    balanceSheet: BalanceSheetSeriesPoint[];
    expenses: Array<{
      period: string;
      expenses: number | null;
      operatingExpenses: number | null;
      costOfSales: number | null;
    }>;
    cashFlow: CashFlowMonth[];
    projections: ProjectionSeriesPoint[];
    planVsActual: PlanVsActualSeriesPoint[];
  };
  provenance: {
    summaryPath: string | null;
    snapshotCount: number;
    statementTypes: string[];
    departmentLevelOnly: boolean;
    seriesSource: "statements" | "transactions" | "mixed" | "none";
    representativeSnapshotIds: string[];
  };
}

interface ResolvedCompanyContext {
  reportingCurrency: string;
  companyDb: CompanyDbRequestOptions;
}

interface SnapshotCandidate {
  qualifiedId: string;
  period: string;
  reportType: string;
  currency: string | null;
  entityLabel: string | null;
  isConsolidated: boolean;
  updatedAt: string | null;
  metrics: ReturnType<typeof extractSnapshotStatementMetrics>;
}

interface AggregatedSnapshotPoint extends FinancialSeriesPoint {
  representativeIds: string[];
  statementTypes: string[];
  departmentLevelOnly: boolean;
  basis: FinancialOverviewSource;
}

interface SnapshotSeriesContext {
  companyWideFallbackEntityLabel: string | null;
  hasMultipleDepartmentTracks: boolean;
}

type CanonicalStatementFamily = "pnl_month" | "balance_sheet_month" | "cash_flow_month";

interface CanonicalSelectionPoint {
  period: string;
  qualifiedId: string;
  type: string;
  filePath: string;
  updatedAt: string | null;
  documentId: string | null;
  sourceDocumentName: string | null;
  family: CanonicalStatementFamily;
  companyWide: boolean;
  departmentLevelOnly: boolean;
  warnings: string[];
  reviewStatus: string | null;
  currency: string | null;
}

interface CanonicalPnlPoint extends CanonicalSelectionPoint, FinancialSeriesPoint {
  family: "pnl_month";
}

interface CanonicalBalanceSheetPoint extends CanonicalSelectionPoint, BalanceSheetSeriesPoint {
  family: "balance_sheet_month";
}

interface CanonicalCashFlowPoint extends CanonicalSelectionPoint {
  family: "cash_flow_month";
  inflows: number;
  outflows: number;
  net: number | null;
  cashPosition: number | null;
}

interface CanonicalProjectionPoint extends ProjectionSeriesPoint {
  qualifiedId: string;
  period: string;
  filePath: string;
  updatedAt: string | null;
  documentId: string | null;
  sourceDocumentName: string | null;
  companyWide: boolean;
  warnings: string[];
  reviewStatus: string | null;
  currency: string | null;
}

const CONSOLIDATED_KEYWORDS = [
  "consolidated",
  "consolidation",
  "consilidation",
  "consolidat",
  "consilidat",
  "summary",
  "macro",
  "overall",
  "company wide",
  "companywide",
  "all departments",
  "group total",
];

const GENERIC_ENTITY_LABELS = new Set([
  "balance sheet",
  "bs",
  "cash flow",
  "financial statement",
  "general ledger",
  "gl",
  "output file",
  "p and l",
  "p l",
  "profit and loss",
  "trial balance",
]);

const ENTITY_LABEL_KEYS = [
  "entity",
  "business_unit",
  "department",
  "department_name",
  "department_label",
  "property",
  "location",
  "branch",
  "outlet",
  "segment",
];

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

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLabelText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readMetric(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const direct = toNumber(source[key]);
    if (direct !== null) return direct;
  }
  return null;
}

function normalizeExpenseMagnitude(value: number | null): number | null {
  if (value === null) return null;
  return value < 0 ? Math.abs(value) : value;
}

function buildSyntheticExpenseBreakdown(input: {
  total: number | null;
  operatingExpenses: number | null;
  costOfSales: number | null;
}): ExpenseBreakdown[] {
  const rows: ExpenseBreakdown[] = [];
  const { total, operatingExpenses, costOfSales } = input;

  if (costOfSales !== null && costOfSales !== 0) {
    rows.push({
      category: "Cost of Sales",
      amount: costOfSales,
      count: 0,
      percentOfTotal: 0,
    });
  }

  if (operatingExpenses !== null && operatingExpenses !== 0) {
    rows.push({
      category: "Operating Expenses",
      amount: operatingExpenses,
      count: 0,
      percentOfTotal: 0,
    });
  }

  if (total !== null) {
    const accounted = rows.reduce((sum, row) => sum + row.amount, 0);
    const other = Number((total - accounted).toFixed(2));

    if (rows.length === 0) {
      rows.push({
        category: "Total Expenses",
        amount: total,
        count: 0,
        percentOfTotal: 100,
      });
    } else if (other > 0.009) {
      rows.push({
        category: "Other Expenses",
        amount: other,
        count: 0,
        percentOfTotal: 0,
      });
    }
  }

  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  return rows.map((row) => ({
    ...row,
    percentOfTotal:
      totalAmount > 0 ? Number(((row.amount / totalAmount) * 100).toFixed(1)) : 0,
  }));
}

function normalizePeriod(period: unknown): string | null {
  const text = toText(period);
  if (!text) return null;

  if (text.startsWith("1970-01-01")) {
    return null;
  }

  const isoRange = text.match(/^(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})$/);
  if (isoRange) {
    return normalizePeriod(isoRange[2]) ?? text;
  }

  const yearMonth = text.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) {
    if (yearMonth[1] === "1970" && yearMonth[2] === "01") {
      return null;
    }
    return text;
  }

  const quarter = text.match(/^(\d{4})-q([1-4])$/i);
  if (quarter) return `${quarter[1]}-q${quarter[2]}`;

  const yearOnly = text.match(/^\d{4}$/);
  if (yearOnly) return text;

  const isoMonth = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMonth) {
    if (isoMonth[2] === "01" && isoMonth[3] === "01" && text.startsWith("1970-01-01")) {
      return null;
    }
    return `${isoMonth[1]}-${isoMonth[2]}`;
  }

  return text;
}

function getFinanceImportPeriod(entity: EntityResult): string | null {
  const frontmatter = entity.frontmatter;
  return (
    normalizePeriod(frontmatter.period_key) ??
    normalizePeriod(frontmatter.reporting_period_key) ??
    normalizePeriod(frontmatter.period_end) ??
    normalizePeriod(frontmatter.period) ??
    normalizePeriod(frontmatter.reporting_period_label) ??
    normalizePeriod(frontmatter.latest_period)
  );
}

function isActualFinanceImport(entity: EntityResult): boolean {
  if (entity.domain !== "finance" || entity.type !== "document_import") return false;
  const book = String(entity.frontmatter.book ?? "actual").toLowerCase();
  return !["budget", "forecast", "projection", "plan"].includes(book);
}

function buildNewerUnpromotedImportWarning(
  entities: EntityResult[],
  canonicalPeriod: string | null,
): string | null {
  if (!canonicalPeriod) return null;
  const canonicalSort = periodSortValue(canonicalPeriod);

  const latest = entities
    .filter(isActualFinanceImport)
    .map((entity) => ({
      entity,
      period: getFinanceImportPeriod(entity),
    }))
    .filter((entry): entry is { entity: EntityResult; period: string } =>
      Boolean(entry.period && periodSortValue(entry.period) > canonicalSort),
    )
    .sort((left, right) => periodSortValue(right.period) - periodSortValue(left.period))[0];

  if (!latest) return null;

  const fileName =
    toText(latest.entity.frontmatter.source_file_name) ??
    latest.entity.title ??
    latest.entity.filePath;
  return `Newer unpromoted finance import is available for ${latest.period}: ${fileName}; dashboard canonical metrics remain at ${canonicalPeriod} until review/promotion completes.`;
}

function getPeriodKey(frontmatter: Record<string, unknown>): string | null {
  const directKeys = [
    frontmatter.period_key,
    frontmatter.reporting_period_key,
    frontmatter.period,
    frontmatter.reporting_period_label,
    frontmatter.latest_period,
  ];

  for (const candidate of directKeys) {
    const normalized = normalizePeriod(candidate);
    if (normalized) return normalized;
  }

  const periodObject =
    typeof frontmatter.reporting_period === "object" && frontmatter.reporting_period !== null
      ? (frontmatter.reporting_period as { start?: string; end?: string; label?: string })
      : null;
  if (
    periodObject?.start &&
    periodObject?.end &&
    !isUnknownReportingPeriod({
      start: periodObject.start,
      end: periodObject.end,
      label: periodObject.label,
    })
  ) {
    return normalizePeriod(
      normalizeReportingPeriodKey({
        start: periodObject.start,
        end: periodObject.end,
        label: periodObject.label,
      }),
    );
  }

  const start = toText(frontmatter.period_start);
  const end = toText(frontmatter.period_end);
  if (start && end) {
    return normalizePeriod(
      normalizeReportingPeriodKey({
        start,
        end,
      }),
    );
  }

  return null;
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

function isDashboardSeriesPeriod(period: string): boolean {
  return /^\d{4}-\d{2}$/.test(period) || /^\d{4}-q[1-4]$/i.test(period);
}

function getEntityLabel(frontmatter: Record<string, unknown>, title: string | null): string | null {
  for (const key of ENTITY_LABEL_KEYS) {
    const value = toText(frontmatter[key]);
    if (value) return value;
  }
  const titleText = toText(title);
  return titleText;
}

function isGenericEntityLabel(entityLabel: string | null): boolean {
  if (!entityLabel) return false;
  return GENERIC_ENTITY_LABELS.has(normalizeLabelText(entityLabel));
}

function isConsolidatedSnapshot(frontmatter: Record<string, unknown>, title: string | null): boolean {
  const entityLabel = getEntityLabel(frontmatter, title);
  const corpus = [
    toText(title),
    ...ENTITY_LABEL_KEYS.map((key) => toText(frontmatter[key])),
    toText(frontmatter.sheet_name),
    toText(frontmatter.document_kind),
    toText(frontmatter.target_entity_type),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  if (CONSOLIDATED_KEYWORDS.some((keyword) => corpus.includes(keyword))) {
    return true;
  }

  const normalizedLabel = entityLabel ? normalizeLabelText(entityLabel) : null;
  if (normalizedLabel && GENERIC_ENTITY_LABELS.has(normalizedLabel)) {
    return true;
  }

  return entityLabel === null;
}

function countMetricCoverage(metrics: ReturnType<typeof extractSnapshotStatementMetrics>): number {
  return [
    metrics.revenue,
    metrics.expenses,
    metrics.operating_expenses,
    metrics.cost_of_sales,
    metrics.gross_profit,
    metrics.net_income,
    metrics.cash_position,
    metrics.runway_months,
  ].filter((value) => value !== null).length;
}

function isFinanceOverviewEntityType(entity: EntityResult): boolean {
  const type = String(entity.type ?? entity.frontmatter.type ?? "").trim().toLowerCase();
  return (
    type === "income_statement" ||
    type === "balance_sheet" ||
    type === "cash_flow_statement"
  );
}

function getCanonicalFamily(entity: EntityResult): CanonicalStatementFamily | "financial_projection_plan" | null {
  const family = toText(entity.frontmatter.canonical_family);
  if (
    family === "pnl_month" ||
    family === "balance_sheet_month" ||
    family === "cash_flow_month" ||
    family === "financial_projection_plan"
  ) {
    return family;
  }
  return null;
}

function isCanonicalFinanceActualEntity(entity: EntityResult): boolean {
  if (entity.domain !== "finance") return false;
  const family = getCanonicalFamily(entity);
  if (family !== "pnl_month" && family !== "balance_sheet_month" && family !== "cash_flow_month") {
    return false;
  }
  const filePath = entity.filePath ?? "";
  return filePath.startsWith("finance/statements/");
}

function isCanonicalFinanceProjectionEntity(entity: EntityResult): boolean {
  if (entity.domain !== "finance") return false;
  const family = getCanonicalFamily(entity);
  if (family !== "financial_projection_plan") return false;
  const filePath = entity.filePath ?? "";
  return filePath.startsWith("finance/projections/");
}

function getCanonicalWarnings(frontmatter: Record<string, unknown>): string[] {
  return Array.isArray(frontmatter.warnings)
    ? frontmatter.warnings.map((value) => String(value))
    : [];
}

function getCanonicalReviewStatus(frontmatter: Record<string, unknown>): string | null {
  return toText(frontmatter.review_status);
}

function isCanonicalCompanyWideEntity(entity: EntityResult): boolean {
  const companyWideFlag = entity.frontmatter.company_wide;
  if (companyWideFlag === true) return true;
  const scopeKey = normalizeLabelText(
    toText(entity.frontmatter.scope_key) ??
      toText(entity.frontmatter.scope_label) ??
      "",
  );
  if (scopeKey === "company") return true;
  return isConsolidatedSnapshot(entity.frontmatter, entity.title);
}

function canonicalReviewRank(reviewStatus: string | null): number {
  switch (reviewStatus) {
    case "verified":
      return 0;
    case "review_pending":
      return 1;
    case "needs_review":
      return 2;
    default:
      return 3;
  }
}

function compareCanonicalEntities(left: EntityResult, right: EntityResult): number {
  const leftCompanyWide = isCanonicalCompanyWideEntity(left);
  const rightCompanyWide = isCanonicalCompanyWideEntity(right);
  if (leftCompanyWide !== rightCompanyWide) {
    return leftCompanyWide ? -1 : 1;
  }

  const leftReview = canonicalReviewRank(getCanonicalReviewStatus(left.frontmatter));
  const rightReview = canonicalReviewRank(getCanonicalReviewStatus(right.frontmatter));
  if (leftReview !== rightReview) {
    return leftReview - rightReview;
  }

  const leftUpdated = left.updatedAt ? Date.parse(left.updatedAt) : 0;
  const rightUpdated = right.updatedAt ? Date.parse(right.updatedAt) : 0;
  return rightUpdated - leftUpdated;
}

function readFrontmatterMetric(frontmatter: Record<string, unknown>, keys: string[]): number | null {
  const summaryMetrics =
    typeof frontmatter.summary_metrics === "object" && frontmatter.summary_metrics !== null
      ? (frontmatter.summary_metrics as Record<string, unknown>)
      : null;

  const summaryValue = summaryMetrics ? readMetric(summaryMetrics, keys) : null;
  if (summaryValue !== null) return summaryValue;
  return readMetric(frontmatter, keys);
}

function buildCanonicalPointBase<TFamily extends CanonicalStatementFamily>(
  entity: EntityResult,
  family: TFamily,
  period: string,
): CanonicalSelectionPoint & { family: TFamily } {
  const companyWide = isCanonicalCompanyWideEntity(entity);
  return {
    period,
    qualifiedId: entity.qualifiedId,
    type: entity.type,
    filePath: entity.filePath,
    updatedAt: entity.updatedAt ?? entity.createdAt,
    documentId: toText(entity.frontmatter.document_id),
    sourceDocumentName: toText(entity.frontmatter.source_document_name),
    family,
    companyWide,
    departmentLevelOnly: !companyWide,
    warnings: getCanonicalWarnings(entity.frontmatter),
    reviewStatus: getCanonicalReviewStatus(entity.frontmatter),
    currency:
      toText(entity.frontmatter.reporting_currency) ??
      toText(entity.frontmatter.currency),
  };
}

function sumPositive(values: Array<number | null>): number {
  const total = values.reduce<number>(
    (sum, value) => sum + (value !== null && value > 0 ? value : 0),
    0,
  );
  return Number(total.toFixed(2));
}

function sumNegativeMagnitude(values: Array<number | null>): number {
  const total = values.reduce<number>(
    (sum, value) => sum + (value !== null && value < 0 ? Math.abs(value) : 0),
    0,
  );
  return Number(total.toFixed(2));
}

function deriveRevenueFromNetIncome(input: {
  netIncome: number | null;
  expenses: number | null;
  operatingExpenses: number | null;
  costOfSales: number | null;
  otherIncome: number | null;
  otherExpenses: number | null;
  interestExpense: number | null;
  taxExpense: number | null;
}): number | null {
  if (
    input.netIncome === null ||
    input.expenses === null ||
    input.operatingExpenses === null ||
    input.costOfSales === null
  ) {
    return null;
  }

  const reconstructed =
    input.netIncome +
    input.expenses -
    (input.otherIncome ?? 0) +
    (input.otherExpenses ?? 0) +
    (input.interestExpense ?? 0) +
    (input.taxExpense ?? 0);

  return Number(reconstructed.toFixed(2));
}

function buildCanonicalPnlSeries(entities: EntityResult[]): CanonicalPnlPoint[] {
  const groups = new Map<string, EntityResult[]>();
  for (const entity of entities) {
    const family = getCanonicalFamily(entity);
    if (family !== "pnl_month") continue;
    const period = getPeriodKey(entity.frontmatter);
    if (!period) continue;
    if (!isDashboardSeriesPeriod(period)) continue;
    const bucket = groups.get(period) ?? [];
    bucket.push(entity);
    groups.set(period, bucket);
  }

  const points = Array.from(groups.entries())
    .map<CanonicalPnlPoint | null>(([period, periodEntities]) => {
      const selected = [...periodEntities].sort(compareCanonicalEntities)[0];
      if (!selected) return null;
      const recordedRevenue = readFrontmatterMetric(selected.frontmatter, ["revenue"]);
      const costOfSales = normalizeExpenseMagnitude(
        readFrontmatterMetric(selected.frontmatter, ["cost_of_sales", "cost_of_revenue"]),
      );
      const operatingExpenses = normalizeExpenseMagnitude(
        readFrontmatterMetric(selected.frontmatter, ["operating_expenses"]),
      );
      const expenses =
        normalizeExpenseMagnitude(readFrontmatterMetric(selected.frontmatter, ["expenses"])) ??
        (costOfSales !== null || operatingExpenses !== null
          ? (costOfSales ?? 0) + (operatingExpenses ?? 0)
          : null);
      const recordedGrossProfit = readFrontmatterMetric(selected.frontmatter, ["gross_profit"]);
      const netIncome = readFrontmatterMetric(selected.frontmatter, ["net_income", "net_profit"]);
      const otherIncome = readFrontmatterMetric(selected.frontmatter, ["other_income"]);
      const otherExpenses = normalizeExpenseMagnitude(
        readFrontmatterMetric(selected.frontmatter, ["other_expenses"]),
      );
      const interestExpense = normalizeExpenseMagnitude(
        readFrontmatterMetric(selected.frontmatter, ["interest_expense"]),
      );
      const taxExpense = normalizeExpenseMagnitude(
        readFrontmatterMetric(selected.frontmatter, ["tax_expense"]),
      );
      const revenue =
        recordedRevenue ??
        (recordedGrossProfit !== null && costOfSales !== null
          ? recordedGrossProfit + costOfSales
          : null) ??
        deriveRevenueFromNetIncome({
          netIncome,
          expenses,
          operatingExpenses,
          costOfSales,
          otherIncome,
          otherExpenses,
          interestExpense,
          taxExpense,
        });
      const grossProfit =
        recordedGrossProfit ??
        (revenue !== null && costOfSales !== null ? revenue - costOfSales : null);

      return {
        ...buildCanonicalPointBase(selected, "pnl_month", period),
        revenue,
        expenses,
        operatingExpenses,
        costOfSales,
        grossProfit,
        netIncome,
        cashPosition: null,
        runwayMonths: null,
      };
    })
    .filter((value): value is CanonicalPnlPoint => value !== null);

  return points.sort((left, right) => periodSortValue(left.period) - periodSortValue(right.period));
}

function buildCanonicalBalanceSheetSeries(entities: EntityResult[]): CanonicalBalanceSheetPoint[] {
  const groups = new Map<string, EntityResult[]>();
  for (const entity of entities) {
    const family = getCanonicalFamily(entity);
    if (family !== "balance_sheet_month") continue;
    const period = getPeriodKey(entity.frontmatter);
    if (!period) continue;
    if (!isDashboardSeriesPeriod(period)) continue;
    const bucket = groups.get(period) ?? [];
    bucket.push(entity);
    groups.set(period, bucket);
  }

  const points = Array.from(groups.entries())
    .map<CanonicalBalanceSheetPoint | null>(([period, periodEntities]) => {
      const selected = [...periodEntities].sort(compareCanonicalEntities)[0];
      if (!selected) return null;

      return {
        ...buildCanonicalPointBase(selected, "balance_sheet_month", period),
        cashAndEquivalents: readFrontmatterMetric(selected.frontmatter, ["cash_and_equivalents", "cash_position"]),
        inventory: readFrontmatterMetric(selected.frontmatter, ["inventory"]),
        totalCurrentAssets: readFrontmatterMetric(selected.frontmatter, ["total_current_assets"]),
        fixedAssets: readFrontmatterMetric(selected.frontmatter, ["fixed_assets"]),
        totalAssets: readFrontmatterMetric(selected.frontmatter, ["total_assets"]),
        totalLiabilities: readFrontmatterMetric(selected.frontmatter, ["total_liabilities"]),
        equity: readFrontmatterMetric(selected.frontmatter, ["total_equity", "equity"]),
        retainedEarnings: readFrontmatterMetric(selected.frontmatter, ["retained_earnings"]),
      };
    })
    .filter((value): value is CanonicalBalanceSheetPoint => value !== null);

  return points.sort((left, right) => periodSortValue(left.period) - periodSortValue(right.period));
}

function buildCanonicalCashFlowSeries(entities: EntityResult[]): CanonicalCashFlowPoint[] {
  const groups = new Map<string, EntityResult[]>();
  for (const entity of entities) {
    const family = getCanonicalFamily(entity);
    if (family !== "cash_flow_month") continue;
    const period = getPeriodKey(entity.frontmatter);
    if (!period) continue;
    if (!isDashboardSeriesPeriod(period)) continue;
    const bucket = groups.get(period) ?? [];
    bucket.push(entity);
    groups.set(period, bucket);
  }

  const points = Array.from(groups.entries())
    .map<CanonicalCashFlowPoint | null>(([period, periodEntities]) => {
      const selected = [...periodEntities].sort(compareCanonicalEntities)[0];
      if (!selected) return null;
      const operating = readFrontmatterMetric(selected.frontmatter, ["operating", "cash_from_operations"]);
      const investing = readFrontmatterMetric(selected.frontmatter, ["investing", "cash_from_investing"]);
      const financing = readFrontmatterMetric(selected.frontmatter, ["financing", "cash_from_financing"]);
      const componentValues = [operating, investing, financing];
      const net =
        readFrontmatterMetric(selected.frontmatter, ["net_change", "net_cash_flow"]) ??
        (componentValues.some((value) => value !== null)
          ? componentValues.reduce<number>((sum, value) => (value === null ? sum : sum + value), 0)
          : null);
      const closingCash = readFrontmatterMetric(selected.frontmatter, ["closing_cash", "ending_cash", "cash_position"]);

      return {
        ...buildCanonicalPointBase(selected, "cash_flow_month", period),
        inflows: sumPositive([operating, investing, financing]),
        outflows: sumNegativeMagnitude([operating, investing, financing]),
        net,
        cashPosition: closingCash,
      };
    })
    .filter((value): value is CanonicalCashFlowPoint => value !== null);

  return points.sort((left, right) => periodSortValue(left.period) - periodSortValue(right.period));
}

function buildCanonicalProjectionSeries(entities: EntityResult[]): CanonicalProjectionPoint[] {
  const projectionSelection = selectAuthoritativeProjectionPack(entities);
  const groups = new Map<string, EntityResult[]>();
  for (const entity of projectionSelection.authoritativeEntities) {
    if (!isCanonicalFinanceProjectionEntity(entity)) continue;
    const period = getPeriodKey(entity.frontmatter);
    if (!period) continue;
    if (!isDashboardSeriesPeriod(period)) continue;
    const bucket = groups.get(period) ?? [];
    bucket.push(entity);
    groups.set(period, bucket);
  }

  const points = Array.from(groups.entries())
    .map<CanonicalProjectionPoint | null>(([period, periodEntities]) => {
      const selected = [...periodEntities].sort(compareCanonicalEntities)[0];
      if (!selected) return null;
      const costOfSales = normalizeExpenseMagnitude(readFrontmatterMetric(selected.frontmatter, ["cost_of_sales"]));
      const operatingExpenses = normalizeExpenseMagnitude(
        readFrontmatterMetric(selected.frontmatter, ["operating_expenses"]),
      );
      const expenses =
        normalizeExpenseMagnitude(readFrontmatterMetric(selected.frontmatter, ["expenses", "expense_projection"])) ??
        (costOfSales !== null || operatingExpenses !== null
          ? (costOfSales ?? 0) + (operatingExpenses ?? 0)
          : null);

      return {
        period,
        qualifiedId: selected.qualifiedId,
        filePath: selected.filePath,
        updatedAt: selected.updatedAt ?? selected.createdAt,
        documentId: toText(selected.frontmatter.document_id),
        sourceDocumentName: toText(selected.frontmatter.source_document_name),
        companyWide: isCanonicalCompanyWideEntity(selected),
        warnings: getCanonicalWarnings(selected.frontmatter),
        reviewStatus: getCanonicalReviewStatus(selected.frontmatter),
        currency:
          toText(selected.frontmatter.reporting_currency) ??
          toText(selected.frontmatter.currency),
        revenue:
          readFrontmatterMetric(selected.frontmatter, ["revenue", "revenue_projection"]),
        expenses,
        grossProfit: readFrontmatterMetric(selected.frontmatter, ["gross_profit"]),
        netIncome: readFrontmatterMetric(selected.frontmatter, ["net_income", "net_profit"]),
        cashPosition: readFrontmatterMetric(selected.frontmatter, ["cash_position", "closing_cash"]),
      };
    })
    .filter((value): value is CanonicalProjectionPoint => value !== null);

  return points.sort((left, right) => periodSortValue(left.period) - periodSortValue(right.period));
}

function normalizeComparableDocumentLabel(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? null;
  return normalized && normalized.length > 0 ? normalized : null;
}

function isIndependentComparablePlan(
  actual: CanonicalPnlPoint,
  plan: CanonicalProjectionPoint,
  actualSeries: CanonicalPnlPoint[],
): boolean {
  if (actual.documentId && plan.documentId) {
    if (actual.documentId === plan.documentId) return false;
    if (actualSeries.some((point) => point.documentId === plan.documentId)) return false;
    return true;
  }

  const actualSourceName = normalizeComparableDocumentLabel(actual.sourceDocumentName);
  const planSourceName = normalizeComparableDocumentLabel(plan.sourceDocumentName);
  if (actualSourceName && planSourceName) {
    if (actualSourceName === planSourceName) return false;
    if (
      actualSeries.some(
        (point) => normalizeComparableDocumentLabel(point.sourceDocumentName) === planSourceName,
      )
    ) {
      return false;
    }
    return true;
  }

  return actual.filePath !== plan.filePath;
}

function deriveRunwayMonths(input: {
  cashPosition: number | null;
  avgMonthlyRevenue: number | null;
  avgMonthlyExpenses: number | null;
  avgMonthlyProfit: number | null;
}): number | null {
  if (input.cashPosition === null) return null;
  if (input.avgMonthlyProfit !== null && input.avgMonthlyProfit < 0) {
    return Number((input.cashPosition / Math.abs(input.avgMonthlyProfit)).toFixed(1));
  }
  if (input.avgMonthlyRevenue !== null && input.avgMonthlyExpenses !== null) {
    const netBurn = input.avgMonthlyExpenses - input.avgMonthlyRevenue;
    if (netBurn > 0) {
      return Number((input.cashPosition / netBurn).toFixed(1));
    }
  }
  return null;
}

function averageNumber(values: Array<number | null>): number | null {
  const defined = values.filter((value): value is number => value !== null);
  if (defined.length === 0) return null;
  return Number((defined.reduce((sum, value) => sum + value, 0) / defined.length).toFixed(2));
}

function limitSeriesToRecentPeriods<T extends { period: string }>(
  points: T[],
  months: number,
): T[] {
  if (!Number.isFinite(months) || months <= 0 || points.length <= months) {
    return points;
  }

  return [...points]
    .sort((left, right) => periodSortValue(left.period) - periodSortValue(right.period))
    .slice(-months);
}

function limitCashFlowMonthsToRecentPeriods(
  points: CashFlowMonth[],
  months: number,
): CashFlowMonth[] {
  if (!Number.isFinite(months) || months <= 0 || points.length <= months) {
    return points;
  }

  return [...points]
    .sort((left, right) => periodSortValue(left.month) - periodSortValue(right.month))
    .slice(-months);
}

function humanizeCanonicalWarning(value: string): string {
  switch (value) {
    case "cash_flow_rollforward_mismatch":
      return "Cash flow rollforward mismatch";
    case "balance_sheet_equation_mismatch":
      return "Balance sheet equation mismatch";
    case "pnl_equation_mismatch":
      return "P&L equation mismatch";
    default:
      return value.replace(/_/g, " ");
  }
}

function buildAccountFxCoverageWarning(
  excludedCount: number,
  reportingCurrency: string,
): string | null {
  if (excludedCount <= 0) return null;
  return `${excludedCount} live account balance${excludedCount === 1 ? "" : "s"} excluded from ${reportingCurrency} totals until FX rates are available`;
}

function buildCanonicalFinancialOverview(input: {
  reportingCurrency: string;
  entities: EntityResult[];
  txnCashFlow: CashFlowMonth[];
  accountBalances: Awaited<ReturnType<typeof getAccountBalances>>;
  txnCurrentPnL: Awaited<ReturnType<typeof getPnLSummary>> | null;
  expenseBreakdown: ExpenseBreakdown[];
  months: number;
}): FinancialOverview | null {
  const actualEntities = input.entities.filter(isCanonicalFinanceActualEntity);
  const projectionEntities = input.entities.filter(isCanonicalFinanceProjectionEntity);

  const pnlSeries = limitSeriesToRecentPeriods(
    buildCanonicalPnlSeries(actualEntities),
    input.months,
  );
  const balanceSheetSeries = limitSeriesToRecentPeriods(
    buildCanonicalBalanceSheetSeries(actualEntities),
    input.months,
  );
  const cashFlowSeries = limitSeriesToRecentPeriods(
    buildCanonicalCashFlowSeries(actualEntities),
    input.months,
  );
  const projectionSeries = limitSeriesToRecentPeriods(
    buildCanonicalProjectionSeries(projectionEntities),
    input.months,
  );

  if (
    pnlSeries.length === 0 &&
    balanceSheetSeries.length === 0 &&
    cashFlowSeries.length === 0 &&
    projectionSeries.length === 0
  ) {
    return null;
  }

  const latestPnl = getLatestPoint(pnlSeries);
  const previousPnl = getPreviousPoint(pnlSeries);
  const latestBalanceSheet = getLatestPoint(balanceSheetSeries);
  const latestCashFlow = getLatestPoint(cashFlowSeries);
  const latestProjection = getLatestPoint(projectionSeries);

  const latestActualPeriod =
    latestPnl?.period ??
    latestBalanceSheet?.period ??
    latestCashFlow?.period ??
    null;

  const transactionExpenseBreakdown =
    latestActualPeriod !== null &&
    latestActualPeriod === (input.txnCashFlow[input.txnCashFlow.length - 1]?.month ?? null)
      ? input.expenseBreakdown
      : [];
  const syntheticExpenseBreakdown = buildSyntheticExpenseBreakdown({
    total: latestPnl?.expenses ?? input.txnCurrentPnL?.expenses ?? null,
    operatingExpenses: latestPnl?.operatingExpenses ?? null,
    costOfSales: latestPnl?.costOfSales ?? null,
  });
  const expenseBreakdown =
    transactionExpenseBreakdown.length > 0
      ? transactionExpenseBreakdown
      : syntheticExpenseBreakdown;
  const txnExpenseCount = transactionExpenseBreakdown.reduce((sum, row) => sum + row.count, 0);

  const cashSeriesPoints = balanceSheetSeries.length > 0
    ? balanceSheetSeries
        .filter((point) => point.cashAndEquivalents !== null)
        .map((point) => ({
          period: point.period,
          cashPosition: point.cashAndEquivalents as number,
          source: "statements" as const,
        }))
    : cashFlowSeries
        .filter((point) => point.cashPosition !== null)
        .map((point) => ({
          period: point.period,
          cashPosition: point.cashPosition as number,
          source: "statements" as const,
        }));

  const canonicalCashFlowSummary: CashFlowMonth[] = cashFlowSeries.map((point) => ({
    month: point.period,
    inflows: point.inflows,
    outflows: point.outflows,
    net: point.net ?? 0,
  }));

  const effectiveCashFlowSeries = canonicalCashFlowSummary.length > 0
    ? canonicalCashFlowSummary
    : limitCashFlowMonthsToRecentPeriods(input.txnCashFlow, input.months);

  const avgMonthlyRevenue = averageNumber(pnlSeries.map((point) => point.revenue));
  const avgMonthlyExpenses = averageNumber(pnlSeries.map((point) => point.expenses));
  const avgMonthlyProfit = averageNumber(pnlSeries.map((point) => point.netIncome));
  const cashPosition =
    latestBalanceSheet?.cashAndEquivalents ??
    latestCashFlow?.cashPosition ??
    (input.accountBalances.length > 0
      ? input.accountBalances.reduce((sum, row) => sum + row.balance, 0)
      : null);

  const comparablePairs = [...projectionSeries]
    .reverse()
    .map((plan) => ({
      plan,
      actual: pnlSeries.find((point) => point.period === plan.period) ?? null,
    }))
    .filter(
      (pair): pair is { plan: CanonicalProjectionPoint; actual: CanonicalPnlPoint } =>
        pair.actual !== null,
    );
  const latestComparablePair = comparablePairs[0] ?? null;
  const latestIndependentComparablePair =
    comparablePairs.find((pair) => isIndependentComparablePlan(pair.actual, pair.plan, pnlSeries)) ??
    null;
  const selectedComparablePair = latestIndependentComparablePair ?? latestComparablePair;
  const latestComparablePlan = selectedComparablePair?.plan ?? null;
  const latestComparableActual = selectedComparablePair?.actual ?? null;
  const latestPnlRevenue = latestPnl?.revenue ?? null;
  const latestPnlNetIncome = latestPnl?.netIncome ?? null;

  const planVsActualPeriods = Array.from(
    new Set([...pnlSeries.map((point) => point.period), ...projectionSeries.map((point) => point.period)]),
  ).sort((left, right) => periodSortValue(left) - periodSortValue(right));

  const planVsActual = planVsActualPeriods.map((period) => {
    const actual = pnlSeries.find((point) => point.period === period) ?? null;
    const planned = projectionSeries.find((point) => point.period === period) ?? null;
    return {
      period,
      actualRevenue: actual?.revenue ?? null,
      plannedRevenue: planned?.revenue ?? null,
      actualExpenses: actual?.expenses ?? null,
      plannedExpenses: planned?.expenses ?? null,
      actualNetIncome: actual?.netIncome ?? null,
      plannedNetIncome: planned?.netIncome ?? null,
    } satisfies PlanVsActualSeriesPoint;
  });

  const latestWarnings = Array.from(
    new Set(
      [
        ...(latestPnl?.warnings ?? []),
        ...(latestBalanceSheet?.warnings ?? []),
        ...(latestCashFlow?.warnings ?? []),
        ...(latestProjection?.warnings ?? []),
      ].map(humanizeCanonicalWarning),
    ),
  );

  const hasCanonicalPnl = latestPnl !== null;
  const hasCanonicalLiquidity = latestBalanceSheet !== null || latestCashFlow !== null;
  const mode: FinancialCoverageMode =
    hasCanonicalPnl && hasCanonicalLiquidity
      ? "summary-complete"
      : "docs-partial";

  const hasCoreMetrics =
    latestPnl?.revenue !== null ||
    latestPnl?.expenses !== null ||
    latestPnl?.netIncome !== null ||
    cashPosition !== null;

  const warnings = Array.from(new Set([
    ...(mode === "docs-partial" ? ["Partial coverage"] : []),
    ...latestWarnings,
    ...(!hasCoreMetrics ? ["Core finance metrics are incomplete"] : []),
  ]));

  return {
    mode,
    source: "uploaded_statements",
    sourceLabel: "From canonical statements",
    sourcePeriod: latestActualPeriod ?? latestProjection?.period ?? null,
    currency: input.reportingCurrency,
    quality:
      latestWarnings.length > 0 ||
      (latestPnl?.reviewStatus && latestPnl.reviewStatus !== "verified") ||
      (latestBalanceSheet?.reviewStatus && latestBalanceSheet.reviewStatus !== "verified") ||
      (latestCashFlow?.reviewStatus && latestCashFlow.reviewStatus !== "verified")
        ? "partial"
        : "verified",
    warnings,
    pnl: {
      revenue: latestPnl?.revenue ?? input.txnCurrentPnL?.revenue ?? null,
      expenses: latestPnl?.expenses ?? input.txnCurrentPnL?.expenses ?? null,
      operatingExpenses: latestPnl?.operatingExpenses ?? null,
      costOfSales: latestPnl?.costOfSales ?? null,
      grossProfit: latestPnl?.grossProfit ?? null,
      netProfit: latestPnl?.netIncome ?? input.txnCurrentPnL?.netProfit ?? null,
      marginPct:
        latestPnlRevenue !== null &&
        latestPnlRevenue !== 0 &&
        latestPnlNetIncome !== null
          ? Number(((latestPnlNetIncome / latestPnlRevenue) * 100).toFixed(1))
          : null,
      revenueChange: percentageChange(latestPnl?.revenue ?? null, previousPnl?.revenue ?? null),
      expenseChange: percentageChange(latestPnl?.expenses ?? null, previousPnl?.expenses ?? null),
    },
    cash: {
      cashPosition,
      runwayMonths: deriveRunwayMonths({
        cashPosition,
        avgMonthlyRevenue,
        avgMonthlyExpenses,
        avgMonthlyProfit,
      }),
      avgMonthlyBurn:
        averageNumber(effectiveCashFlowSeries.map((point) => point.outflows)) ??
        avgMonthlyExpenses,
      avgMonthlyRevenue,
      avgMonthlyProfit,
      chartKind:
        canonicalCashFlowSummary.length > 0
          ? "cash_flow"
          : cashSeriesPoints.length > 0
            ? "cash_position"
            : input.txnCashFlow.length > 0
              ? "cash_flow"
              : "none",
    },
    balanceSheet: {
      cashAndEquivalents: latestBalanceSheet?.cashAndEquivalents ?? null,
      inventory: latestBalanceSheet?.inventory ?? null,
      totalCurrentAssets: latestBalanceSheet?.totalCurrentAssets ?? null,
      fixedAssets: latestBalanceSheet?.fixedAssets ?? null,
      totalAssets: latestBalanceSheet?.totalAssets ?? null,
      totalLiabilities: latestBalanceSheet?.totalLiabilities ?? null,
      equity: latestBalanceSheet?.equity ?? null,
      retainedEarnings: latestBalanceSheet?.retainedEarnings ?? null,
    },
    projection: {
      available: projectionSeries.length > 0,
      latestPlanPeriod: latestProjection?.period ?? latestComparablePlan?.period ?? null,
      comparableThroughPeriod: latestComparablePlan?.period ?? null,
      revenue: latestComparablePlan?.revenue ?? latestProjection?.revenue ?? null,
      expenses: latestComparablePlan?.expenses ?? latestProjection?.expenses ?? null,
      grossProfit: latestComparablePlan?.grossProfit ?? latestProjection?.grossProfit ?? null,
      netIncome: latestComparablePlan?.netIncome ?? latestProjection?.netIncome ?? null,
      cashPosition: latestComparablePlan?.cashPosition ?? latestProjection?.cashPosition ?? null,
      varianceRevenue:
        latestComparablePlan && latestComparableActual
          ? latestComparableActual.revenue !== null && latestComparablePlan.revenue !== null
            ? latestComparableActual.revenue - latestComparablePlan.revenue
            : null
          : null,
      varianceExpenses:
        latestComparablePlan && latestComparableActual
          ? latestComparableActual.expenses !== null && latestComparablePlan.expenses !== null
            ? latestComparableActual.expenses - latestComparablePlan.expenses
            : null
          : null,
      varianceNetIncome:
        latestComparablePlan && latestComparableActual
          ? latestComparableActual.netIncome !== null && latestComparablePlan.netIncome !== null
            ? latestComparableActual.netIncome - latestComparablePlan.netIncome
            : null
          : null,
    },
    expenses: {
      total: latestPnl?.expenses ?? input.txnCurrentPnL?.expenses ?? null,
      operatingExpenses: latestPnl?.operatingExpenses ?? null,
      costOfSales: latestPnl?.costOfSales ?? null,
      breakdown: expenseBreakdown,
      breakdownBasis:
        transactionExpenseBreakdown.length > 0
          ? "transactions"
          : expenseBreakdown.length > 0
            ? "statements"
            : "none",
      transactionCount: txnExpenseCount,
    },
    series: {
      pnl: pnlSeries.map((point) => ({
        period: point.period,
        revenue: point.revenue,
        expenses: point.expenses,
        operatingExpenses: point.operatingExpenses,
        costOfSales: point.costOfSales,
        grossProfit: point.grossProfit,
        netIncome: point.netIncome,
        cashPosition: point.cashPosition,
        runwayMonths: point.runwayMonths,
      })),
      cash: cashSeriesPoints,
      balanceSheet: balanceSheetSeries.map((point) => ({
        period: point.period,
        cashAndEquivalents: point.cashAndEquivalents,
        inventory: point.inventory,
        totalCurrentAssets: point.totalCurrentAssets,
        fixedAssets: point.fixedAssets,
        totalAssets: point.totalAssets,
        totalLiabilities: point.totalLiabilities,
        equity: point.equity,
        retainedEarnings: point.retainedEarnings,
      })),
      expenses: pnlSeries.map((point) => ({
        period: point.period,
        expenses: point.expenses,
        operatingExpenses: point.operatingExpenses,
        costOfSales: point.costOfSales,
      })),
      cashFlow: effectiveCashFlowSeries,
      projections: projectionSeries.map((point) => ({
        period: point.period,
        revenue: point.revenue,
        expenses: point.expenses,
        grossProfit: point.grossProfit,
        netIncome: point.netIncome,
        cashPosition: point.cashPosition,
      })),
      planVsActual,
    },
    provenance: {
      summaryPath: null,
      snapshotCount: actualEntities.length + projectionEntities.length,
      statementTypes: Array.from(
        new Set([
          ...actualEntities.map((entity) => String(entity.type)),
          ...projectionEntities.map((entity) => String(entity.type)),
        ]),
      ),
      departmentLevelOnly:
        latestPnl?.departmentLevelOnly ??
        latestBalanceSheet?.departmentLevelOnly ??
        latestCashFlow?.departmentLevelOnly ??
        false,
      seriesSource: canonicalCashFlowSummary.length > 0 || pnlSeries.length > 0 ? "statements" : "none",
      representativeSnapshotIds: Array.from(
        new Set([
          ...(latestPnl ? [latestPnl.qualifiedId] : []),
          ...(latestBalanceSheet ? [latestBalanceSheet.qualifiedId] : []),
          ...(latestCashFlow ? [latestCashFlow.qualifiedId] : []),
          ...(latestProjection ? [latestProjection.qualifiedId] : []),
        ]),
      ),
    },
  };
}

function compareSnapshotCandidates(left: SnapshotCandidate, right: SnapshotCandidate): number {
  if (left.isConsolidated !== right.isConsolidated) {
    return left.isConsolidated ? -1 : 1;
  }

  const metricCoverageDelta = countMetricCoverage(right.metrics) - countMetricCoverage(left.metrics);
  if (metricCoverageDelta !== 0) return metricCoverageDelta;

  const leftUpdated = left.updatedAt ? Date.parse(left.updatedAt) : 0;
  const rightUpdated = right.updatedAt ? Date.parse(right.updatedAt) : 0;
  return rightUpdated - leftUpdated;
}

function isIncomeStatementReportType(reportType: string): boolean {
  return (
    reportType.includes("profit_and_loss") ||
    reportType.includes("income_statement") ||
    reportType === "pnl"
  );
}

function isLiquidityStatementReportType(reportType: string): boolean {
  return reportType.includes("balance_sheet") || reportType.includes("cash_flow");
}

function getMetricReportPriority(
  reportType: string,
  metricKey: keyof SnapshotCandidate["metrics"],
): number {
  if (
    metricKey === "revenue" ||
    metricKey === "expenses" ||
    metricKey === "operating_expenses" ||
    metricKey === "cost_of_sales" ||
    metricKey === "gross_profit" ||
    metricKey === "net_income"
  ) {
    if (isIncomeStatementReportType(reportType)) return 3;
    if (reportType.includes("trial_balance")) return 2;
    return 1;
  }

  if (metricKey === "cash_position" || metricKey === "runway_months") {
    if (isLiquidityStatementReportType(reportType)) return 3;
    if (reportType.includes("trial_balance")) return 2;
    if (isIncomeStatementReportType(reportType)) return 1;
  }

  return 0;
}

function isIncomeStatementMetricKey(
  metricKey: keyof SnapshotCandidate["metrics"],
): boolean {
  return (
    metricKey === "revenue" ||
    metricKey === "expenses" ||
    metricKey === "operating_expenses" ||
    metricKey === "cost_of_sales" ||
    metricKey === "gross_profit" ||
    metricKey === "net_income"
  );
}

function shouldSuppressZeroConsolidatedMetric(
  candidates: SnapshotCandidate[],
  chosen: SnapshotCandidate,
  metricKey: keyof SnapshotCandidate["metrics"],
): boolean {
  if (!isIncomeStatementMetricKey(metricKey)) return false;
  if (chosen.metrics[metricKey] !== 0) return false;
  if (!chosen.isConsolidated) return false;
  if (!isIncomeStatementReportType(chosen.reportType)) return false;

  return candidates.some(
    (candidate) =>
      candidate.qualifiedId !== chosen.qualifiedId &&
      isIncomeStatementReportType(candidate.reportType) &&
      !candidate.isConsolidated &&
      countMetricCoverage(candidate.metrics) === 0,
  );
}

function buildSnapshotCandidates(entities: EntityResult[]): SnapshotCandidate[] {
  return entities
    .map((entity) => {
      const period = getPeriodKey(entity.frontmatter);
      if (!period) return null;

      const reportType = String(entity.frontmatter.report_type ?? entity.frontmatter.type ?? "unknown")
        .trim();
      const normalizedReportType = normalizeFinancialReportType(reportType);

      return {
        qualifiedId: entity.qualifiedId,
        period,
        reportType: normalizedReportType,
        currency:
          toText(entity.frontmatter.currency) ??
          (Array.isArray(entity.frontmatter.currencies)
            ? toText(entity.frontmatter.currencies[0])
            : null),
        entityLabel: getEntityLabel(entity.frontmatter, entity.title),
        isConsolidated: isConsolidatedSnapshot(entity.frontmatter, entity.title),
        updatedAt: entity.updatedAt,
        metrics: extractSnapshotStatementMetrics(entity.frontmatter, normalizedReportType),
      } satisfies SnapshotCandidate;
    })
    .filter((value): value is SnapshotCandidate => Boolean(value));
}

function buildSnapshotSeriesContext(candidates: SnapshotCandidate[]): SnapshotSeriesContext {
  const specificEntityLabels = Array.from(
    new Set(
      candidates
        .filter(
          (candidate) =>
            !candidate.isConsolidated &&
            !isGenericEntityLabel(candidate.entityLabel) &&
            countMetricCoverage(candidate.metrics) > 0,
        )
        .map((candidate) =>
          candidate.entityLabel ? normalizeLabelText(candidate.entityLabel) : null,
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return {
    companyWideFallbackEntityLabel:
      specificEntityLabels.length === 1 ? specificEntityLabels[0]! : null,
    hasMultipleDepartmentTracks: specificEntityLabels.length > 1,
  };
}

function resolveMetricForPeriod(
  candidates: SnapshotCandidate[],
  context: SnapshotSeriesContext,
  metricKey: keyof SnapshotCandidate["metrics"],
): {
  value: number | null;
  departmentLevelOnly: boolean;
  representativeIds: string[];
  reportTypes: string[];
  basis: FinancialOverviewSource;
} {
  const withMetric = candidates
    .filter((candidate) => candidate.metrics[metricKey] !== null)
    .sort(compareSnapshotCandidates);

  if (withMetric.length === 0) {
    return {
      value: null,
      departmentLevelOnly: false,
      representativeIds: [],
      reportTypes: [],
      basis: "none",
    };
  }

  const nonZeroMetric = withMetric.filter((candidate) => candidate.metrics[metricKey] !== 0);
  const signalPool = nonZeroMetric.length > 0 ? nonZeroMetric : withMetric;

  const bestReportPriority = Math.max(
    ...signalPool.map((candidate) => getMetricReportPriority(candidate.reportType, metricKey)),
  );
  const metricPreferred = signalPool.filter(
    (candidate) => getMetricReportPriority(candidate.reportType, metricKey) === bestReportPriority,
  );

  const consolidated = metricPreferred.filter((candidate) => candidate.isConsolidated);
  const chosen = consolidated.length > 0 ? [consolidated[0]!] : [];
  if (chosen.length > 0) {
    if (shouldSuppressZeroConsolidatedMetric(candidates, chosen[0]!, metricKey)) {
      return {
        value: null,
        departmentLevelOnly: true,
        representativeIds: [chosen[0]!.qualifiedId],
        reportTypes: [chosen[0]!.reportType],
        basis: "none",
      };
    }

    return {
      value: chosen[0]!.metrics[metricKey],
      departmentLevelOnly: false,
      representativeIds: [chosen[0]!.qualifiedId],
      reportTypes: [chosen[0]!.reportType],
      basis: chosen[0]!.reportType.includes("trial_balance") ? "trial_balance" : "uploaded_statements",
    };
  }

  const distinctSpecificEntityLabels = new Set(
    metricPreferred
      .map((candidate) =>
        candidate.entityLabel && !isGenericEntityLabel(candidate.entityLabel)
          ? normalizeLabelText(candidate.entityLabel)
          : null,
      )
      .filter((value): value is string => Boolean(value)),
  );

  if (distinctSpecificEntityLabels.size > 1) {
    return {
      value: null,
      departmentLevelOnly: true,
      representativeIds: metricPreferred.map((candidate) => candidate.qualifiedId),
      reportTypes: Array.from(new Set(metricPreferred.map((candidate) => candidate.reportType))),
      basis: "none",
    };
  }

  const best = metricPreferred[0]!;
  const normalizedEntityLabel = best.entityLabel ? normalizeLabelText(best.entityLabel) : null;
  const genericEntity =
    normalizedEntityLabel !== null && GENERIC_ENTITY_LABELS.has(normalizedEntityLabel);

  if (
    !best.isConsolidated &&
    !genericEntity &&
    context.hasMultipleDepartmentTracks &&
    context.companyWideFallbackEntityLabel !== normalizedEntityLabel
  ) {
    return {
      value: null,
      departmentLevelOnly: true,
      representativeIds: [best.qualifiedId],
      reportTypes: [best.reportType],
      basis: "none",
    };
  }

  return {
    value: best.metrics[metricKey],
    departmentLevelOnly: !best.isConsolidated && !genericEntity,
    representativeIds: [best.qualifiedId],
    reportTypes: [best.reportType],
    basis: best.reportType.includes("trial_balance") ? "trial_balance" : "uploaded_statements",
  };
}

function buildSnapshotSeries(candidates: SnapshotCandidate[]): AggregatedSnapshotPoint[] {
  const context = buildSnapshotSeriesContext(candidates);
  const groups = new Map<string, SnapshotCandidate[]>();
  for (const candidate of candidates) {
    const bucket = groups.get(candidate.period) ?? [];
    bucket.push(candidate);
    groups.set(candidate.period, bucket);
  }

  const points: AggregatedSnapshotPoint[] = [];
  for (const [period, periodCandidates] of groups.entries()) {
    const revenue = resolveMetricForPeriod(periodCandidates, context, "revenue");
    const expenses = resolveMetricForPeriod(periodCandidates, context, "expenses");
    const operatingExpenses = resolveMetricForPeriod(periodCandidates, context, "operating_expenses");
    const costOfSales = resolveMetricForPeriod(periodCandidates, context, "cost_of_sales");
    const grossProfit = resolveMetricForPeriod(periodCandidates, context, "gross_profit");
    const netIncome = resolveMetricForPeriod(periodCandidates, context, "net_income");
    const cashPosition = resolveMetricForPeriod(periodCandidates, context, "cash_position");
    const runwayMonths = resolveMetricForPeriod(periodCandidates, context, "runway_months");

    const representativeIds = Array.from(
      new Set(
        [
          ...revenue.representativeIds,
          ...expenses.representativeIds,
          ...operatingExpenses.representativeIds,
          ...costOfSales.representativeIds,
          ...grossProfit.representativeIds,
          ...netIncome.representativeIds,
          ...cashPosition.representativeIds,
          ...runwayMonths.representativeIds,
        ],
      ),
    );
    const statementTypes = Array.from(
      new Set(
        [
          ...revenue.reportTypes,
          ...expenses.reportTypes,
          ...operatingExpenses.reportTypes,
          ...costOfSales.reportTypes,
          ...grossProfit.reportTypes,
          ...netIncome.reportTypes,
          ...cashPosition.reportTypes,
          ...runwayMonths.reportTypes,
        ],
      ),
    );

    const basisSources = [
      revenue.basis,
      expenses.basis,
      operatingExpenses.basis,
      costOfSales.basis,
      grossProfit.basis,
      netIncome.basis,
      cashPosition.basis,
      runwayMonths.basis,
    ].filter((value) => value !== "none");

    const basis =
      basisSources.length === 0
        ? "none"
        : basisSources.every((value) => value === "trial_balance")
          ? "trial_balance"
          : "uploaded_statements";

    points.push({
      period,
      revenue: revenue.value,
      expenses: expenses.value,
      operatingExpenses: operatingExpenses.value,
      costOfSales: costOfSales.value,
      grossProfit: grossProfit.value,
      netIncome:
        netIncome.value ??
        (revenue.value !== null && expenses.value !== null
          ? revenue.value - expenses.value
          : null),
      cashPosition: cashPosition.value,
      runwayMonths: runwayMonths.value,
      representativeIds,
      statementTypes,
      departmentLevelOnly:
        revenue.departmentLevelOnly ||
        expenses.departmentLevelOnly ||
        operatingExpenses.departmentLevelOnly ||
        costOfSales.departmentLevelOnly ||
        grossProfit.departmentLevelOnly ||
        netIncome.departmentLevelOnly ||
        cashPosition.departmentLevelOnly ||
        runwayMonths.departmentLevelOnly,
      basis,
    });
  }

  return points.sort((left, right) => periodSortValue(left.period) - periodSortValue(right.period));
}

function percentageChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
}

function getLatestPoint<T extends { period: string }>(points: T[]): T | null {
  return points.length > 0 ? points[points.length - 1]! : null;
}

function getPreviousPoint<T extends { period: string }>(points: T[]): T | null {
  return points.length > 1 ? points[points.length - 2]! : null;
}

function parseMonthPeriodToDate(period: string | null): Date | null {
  if (!period) return null;
  const monthMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (!monthMatch) return null;

  const year = Number(monthMatch[1]);
  const monthIndex = Number(monthMatch[2]) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }

  return new Date(year, monthIndex, 1);
}

function buildTransactionPnLSeries(cashFlow: CashFlowMonth[]): FinancialSeriesPoint[] {
  return cashFlow.map((point) => ({
    period: point.month,
    revenue: point.inflows,
    expenses: point.outflows,
    operatingExpenses: null,
    costOfSales: null,
    grossProfit: null,
    netIncome: point.net,
    cashPosition: null,
    runwayMonths: null,
  }));
}

function hasSummaryMetricSignal(summaryMetrics: ReturnType<typeof getSummaryMetrics>): boolean {
  return [
    summaryMetrics.metrics.revenue,
    summaryMetrics.metrics.expenses,
    summaryMetrics.metrics.operatingExpenses,
    summaryMetrics.metrics.costOfSales,
    summaryMetrics.metrics.grossProfit,
    summaryMetrics.metrics.netProfit,
    summaryMetrics.metrics.cashPosition,
    summaryMetrics.metrics.runwayMonths,
  ].some((value) => value !== null);
}

function hasCoreSnapshotMetrics(point: AggregatedSnapshotPoint): boolean {
  return (
    point.revenue !== null ||
    point.expenses !== null ||
    point.netIncome !== null ||
    point.cashPosition !== null ||
    point.runwayMonths !== null
  );
}

function hasPnlSnapshotMetrics(point: AggregatedSnapshotPoint): boolean {
  return (
    point.revenue !== null ||
    point.expenses !== null ||
    point.operatingExpenses !== null ||
    point.costOfSales !== null ||
    point.grossProfit !== null ||
    point.netIncome !== null
  );
}

function hasExpenseSnapshotMetrics(point: AggregatedSnapshotPoint): boolean {
  return (
    point.expenses !== null ||
    point.operatingExpenses !== null ||
    point.costOfSales !== null
  );
}

function hasIncomeSnapshotMetrics(candidates: SnapshotCandidate[]): boolean {
  return candidates.some(
    (candidate) =>
      candidate.metrics.revenue !== null ||
      candidate.metrics.expenses !== null ||
      candidate.metrics.operating_expenses !== null ||
      candidate.metrics.cost_of_sales !== null ||
      candidate.metrics.net_income !== null,
  );
}

function shouldHydrateFullFinanceSnapshots(
  summaryMetrics: ReturnType<typeof getSummaryMetrics>,
  candidates: SnapshotCandidate[],
): boolean {
  const hasTrialBalance = candidates.some((candidate) => isTrialBalanceSnapshotReportType(candidate.reportType));
  const hasPnLStatement = candidates.some((candidate) =>
    candidate.reportType.includes("profit_and_loss") ||
    candidate.reportType.includes("income_statement") ||
    candidate.reportType === "pnl",
  );

  if (!hasTrialBalance || hasPnLStatement) return false;
  if (summaryMetrics.metrics.revenue !== null || summaryMetrics.metrics.expenses !== null || summaryMetrics.metrics.netProfit !== null) {
    return false;
  }

  return !hasIncomeSnapshotMetrics(candidates);
}

function getSummaryMetrics(summary: Awaited<ReturnType<typeof getDomainSummary>>): {
  period: string | null;
  currency: string | null;
  bankingRecords: number | null;
  metrics: {
    revenue: number | null;
    expenses: number | null;
    operatingExpenses: number | null;
    costOfSales: number | null;
    grossProfit: number | null;
    netProfit: number | null;
    cashPosition: number | null;
    runwayMonths: number | null;
  };
  warnings: string[];
} {
  const frontmatter = summary?.frontmatter ?? {};
  const keyMetrics =
    typeof frontmatter.key_metrics === "object" && frontmatter.key_metrics !== null
      ? (frontmatter.key_metrics as Record<string, unknown>)
      : {};
  const quality =
    typeof frontmatter.quality === "object" && frontmatter.quality !== null
      ? (frontmatter.quality as Record<string, unknown>)
      : {};

  return {
    period: normalizePeriod(keyMetrics.latest_period ?? frontmatter.latest_period),
    currency:
      toText(frontmatter.currency) ??
      (Array.isArray(frontmatter.currencies) ? toText(frontmatter.currencies[0]) : null),
    bankingRecords: readMetric(keyMetrics, ["banking_records"]),
    metrics: {
      revenue: readMetric(keyMetrics, ["revenue", "latest_revenue"]),
      expenses: normalizeExpenseMagnitude(readMetric(keyMetrics, ["expenses", "latest_expenses"])),
      operatingExpenses: normalizeExpenseMagnitude(
        readMetric(keyMetrics, ["operating_expenses", "latest_operating_expenses"]),
      ),
      costOfSales: normalizeExpenseMagnitude(
        readMetric(keyMetrics, ["cost_of_sales", "latest_cost_of_sales"]),
      ),
      grossProfit: readMetric(keyMetrics, ["gross_profit", "latest_gross_profit"]),
      netProfit: readMetric(keyMetrics, ["net_income", "latest_net_income"]),
      cashPosition: readMetric(keyMetrics, ["cash_position", "latest_cash_position"]),
      runwayMonths: readMetric(keyMetrics, ["runway_months"]),
    },
    warnings: Array.isArray(quality.warnings)
      ? quality.warnings.map((value) => String(value))
      : [],
  };
}

function isSummaryComplete(summaryMetrics: ReturnType<typeof getSummaryMetrics>): boolean {
  const pnlCount = [
    summaryMetrics.metrics.revenue,
    summaryMetrics.metrics.expenses,
    summaryMetrics.metrics.netProfit,
  ].filter((value) => value !== null).length;
  const hasLiquidity =
    summaryMetrics.metrics.cashPosition !== null ||
    summaryMetrics.metrics.runwayMonths !== null;
  return Boolean(summaryMetrics.period) && (pnlCount >= 2 || hasLiquidity);
}

function hasSnapshotData(points: AggregatedSnapshotPoint[]): boolean {
  return points.some(
    (point) =>
      point.revenue !== null ||
      point.expenses !== null ||
      point.netIncome !== null ||
      point.cashPosition !== null,
  );
}

function inferSourceLabel(source: FinancialOverviewSource): string {
  switch (source) {
    case "uploaded_statements":
      return "From uploaded statements";
    case "trial_balance":
      return "Derived from trial balance";
    case "transactions":
      return "Estimated from transactions";
    default:
      return "No finance data";
  }
}

function parsePeriodToFreshnessDate(period: string | null): number | null {
  if (!period) return null;
  const monthMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    return Date.UTC(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 28);
  }
  const quarterMatch = period.match(/^(\d{4})-q([1-4])$/i);
  if (quarterMatch) {
    return Date.UTC(Number(quarterMatch[1]), Number(quarterMatch[2]) * 3 - 1, 28);
  }
  const yearMatch = period.match(/^(\d{4})$/);
  if (yearMatch) {
    return Date.UTC(Number(yearMatch[1]), 11, 31);
  }
  const parsed = Date.parse(period);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildWarnings(input: {
  mode: FinancialCoverageMode;
  source: FinancialOverviewSource;
  sourcePeriod: string | null;
  summaryWarnings: string[];
  latestSnapshot: AggregatedSnapshotPoint | null;
  cashFlowSeries: CashFlowMonth[];
  hasBankHistorySignal: boolean;
  hasCoreMetrics: boolean;
}): string[] {
  const warnings = new Set<string>();
  const summaryComplete = input.mode === "summary-complete";

  if (input.mode === "docs-partial") {
    warnings.add("Partial coverage");
  }
  if (input.mode === "txns-estimate") {
    warnings.add("Estimated from transactions");
  }
  if (!input.hasCoreMetrics) {
    warnings.add("Core finance metrics are incomplete");
  }
  if (input.source === "trial_balance") {
    warnings.add("Derived from trial balance");
  }
  if (!summaryComplete && input.latestSnapshot?.departmentLevelOnly) {
    warnings.add("Department-level only");
  }
  if (!input.hasBankHistorySignal && input.cashFlowSeries.length < 3) {
    warnings.add("No bank history");
  }

  const freshnessDate = parsePeriodToFreshnessDate(input.sourcePeriod);
  const staleThreshold = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth() - 2,
    1,
  );
  if (freshnessDate !== null && freshnessDate < staleThreshold) {
    warnings.add("Stale period");
  }

  for (const rawWarning of input.summaryWarnings) {
    if (rawWarning === "metrics_low_signal") warnings.add("Core finance metrics are incomplete");
    if (rawWarning === "banking_flow_missing") warnings.add("No bank history");
    if (rawWarning === "latest_finance_snapshot_missing") warnings.add("Latest finance statement coverage missing");
  }

  return Array.from(warnings);
}

async function resolveCompanyContext(
  companyId: string,
  callerId?: string,
  callerRole?: string,
): Promise<ResolvedCompanyContext> {
  const [companyRow] = await db
    .select({
      reportingCurrency: companies.reportingCurrency,
      companyDbPort: companies.companyDbPort,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!companyRow) {
    throw new Error(`Company not found: ${companyId}`);
  }

  const slug = await getCompanySlug(companyId);
  return {
    reportingCurrency: companyRow.reportingCurrency ?? "USD",
    companyDb: {
      companySlug: slug,
      port: companyRow.companyDbPort ?? 3100,
      callerId,
      callerRole,
    },
  };
}

export async function getFinancialOverview(
  companyId: string,
  input: {
    callerId?: string;
    callerRole?: string;
    months?: number;
  } = {},
): Promise<FinancialOverview> {
  const months = input.months ?? 12;
  const { reportingCurrency, companyDb } = await resolveCompanyContext(
    companyId,
    input.callerId,
    input.callerRole,
  );

  const [
    financeSummary,
    initialFinanceEntities,
    txnCashFlow,
    accountBalances,
  ] = await Promise.all([
    getDomainSummary("finance", companyDb).catch(() => null),
    queryEntitiesWithCount(
      { domain: "finance", limit: 500, view: "summary" },
      companyDb,
    ).catch(() => ({ data: [], count: 0 } satisfies QueryResultWithCount)),
    getCashFlowSummary(companyId, months).catch(() => []),
    getAccountBalances(companyId).catch(() => []),
  ]);

  const latestTxnPeriod = txnCashFlow.length > 0 ? txnCashFlow[txnCashFlow.length - 1]?.month ?? null : null;
  const latestTxnMonth = parseMonthPeriodToDate(latestTxnPeriod);
  const [txnCurrentPnL, expenseBreakdown] = latestTxnMonth
    ? await Promise.all([
        getPnLSummary(companyId, latestTxnMonth).catch(() => null),
    getExpenseBreakdown(companyId, latestTxnMonth).catch(() => []),
      ])
    : [null, [] as ExpenseBreakdown[]];

  const reportingAccountBalances = await attachReportingBalances(accountBalances, reportingCurrency);
  const excludedAccountBalanceCount = reportingAccountBalances.filter(
    (row) => row.reportingBalance === null && row.currency !== reportingCurrency,
  ).length;
  const accountFxCoverageWarning = buildAccountFxCoverageWarning(
    excludedAccountBalanceCount,
    reportingCurrency,
  );
  const accountBalancesInReportingCurrency = reportingAccountBalances.map((row) => ({
    ...row,
    balance: row.reportingBalance ?? 0,
  }));

  const canonicalOverview = buildCanonicalFinancialOverview({
    reportingCurrency,
    entities: initialFinanceEntities.data,
    txnCashFlow,
    accountBalances: accountBalancesInReportingCurrency,
    txnCurrentPnL,
    expenseBreakdown,
    months,
  });
  if (canonicalOverview) {
    const newerImportWarning = buildNewerUnpromotedImportWarning(
      initialFinanceEntities.data,
      canonicalOverview.sourcePeriod,
    );
    const extraWarnings = [accountFxCoverageWarning, newerImportWarning].filter(
      (warning): warning is string => Boolean(warning),
    );
    if (extraWarnings.length === 0) return canonicalOverview;

    return {
      ...canonicalOverview,
      quality: "partial",
      warnings: Array.from(new Set([...canonicalOverview.warnings, ...extraWarnings])),
    };
  }

  const initialFinanceSnapshots = {
    ...initialFinanceEntities,
    data: initialFinanceEntities.data.filter(isFinanceOverviewEntityType),
  };

  const summaryMetrics = getSummaryMetrics(financeSummary);
  let financeSnapshots = initialFinanceSnapshots;
  let snapshotCandidates = buildSnapshotCandidates(financeSnapshots.data);

  if (shouldHydrateFullFinanceSnapshots(summaryMetrics, snapshotCandidates)) {
    const fullFinanceSnapshots = await queryEntitiesWithCount(
      { domain: "finance", limit: 500 },
      companyDb,
    )
      .then((result) => ({
        ...result,
        data: result.data.filter(isFinanceOverviewEntityType),
      }))
      .catch(() => null);

    if (fullFinanceSnapshots && fullFinanceSnapshots.data.length > 0) {
      financeSnapshots = fullFinanceSnapshots;
      snapshotCandidates = buildSnapshotCandidates(financeSnapshots.data);
    }
  }

  const snapshotSeries = buildSnapshotSeries(snapshotCandidates);
  const metricSnapshotSeries = snapshotSeries.filter(hasCoreSnapshotMetrics);
  const latestSnapshot = getLatestPoint(metricSnapshotSeries);
  const previousSnapshot = getPreviousPoint(metricSnapshotSeries);

  const txnExpenseCount = expenseBreakdown.reduce((sum, row) => sum + row.count, 0);
  const averageTxnRevenue =
    txnCashFlow.length > 0
      ? txnCashFlow.reduce((sum, row) => sum + row.inflows, 0) / txnCashFlow.length
      : null;
  const averageTxnExpenses =
    txnCashFlow.length > 0
      ? txnCashFlow.reduce((sum, row) => sum + row.outflows, 0) / txnCashFlow.length
      : null;
  const averageTxnProfit =
    txnCashFlow.length > 0
      ? txnCashFlow.reduce((sum, row) => sum + row.net, 0) / txnCashFlow.length
      : null;

  const summaryComplete = isSummaryComplete(summaryMetrics);
  const summaryPartialAvailable = hasSummaryMetricSignal(summaryMetrics);
  const snapshotAvailable = hasSnapshotData(snapshotSeries);
  const transactionEstimateAvailable =
    Boolean(txnCurrentPnL) ||
    txnCashFlow.length > 0 ||
    expenseBreakdown.length > 0;
  const totalAccountBalance =
    accountBalancesInReportingCurrency.length > 0
      ? accountBalancesInReportingCurrency.reduce((sum, row) => sum + row.balance, 0)
      : null;

  const mode: FinancialCoverageMode = summaryComplete
    ? "summary-complete"
    : snapshotAvailable
      ? "docs-partial"
      : transactionEstimateAvailable
        ? "txns-estimate"
        : summaryPartialAvailable
          ? "docs-partial"
        : "no-finance-data";

  const source: FinancialOverviewSource = summaryComplete
    ? latestSnapshot?.basis ?? "uploaded_statements"
    : snapshotAvailable
      ? latestSnapshot?.basis ?? "uploaded_statements"
      : transactionEstimateAvailable
        ? "transactions"
        : summaryPartialAvailable
          ? "uploaded_statements"
        : "none";

  const currency = reportingCurrency;

  const sourcePeriod =
    mode === "txns-estimate"
      ? latestTxnPeriod
      : summaryMetrics.period ??
        latestSnapshot?.period ??
        latestTxnPeriod;

  const pnlRevenue =
    mode === "txns-estimate"
      ? txnCurrentPnL?.revenue ??
        summaryMetrics.metrics.revenue ??
        latestSnapshot?.revenue ??
        null
      : summaryMetrics.metrics.revenue ??
        latestSnapshot?.revenue ??
        txnCurrentPnL?.revenue ??
        null;
  const pnlExpenses =
    mode === "txns-estimate"
      ? txnCurrentPnL?.expenses ??
        summaryMetrics.metrics.expenses ??
        latestSnapshot?.expenses ??
        null
      : summaryMetrics.metrics.expenses ??
        latestSnapshot?.expenses ??
        txnCurrentPnL?.expenses ??
        null;
  const pnlOperatingExpenses =
    summaryMetrics.metrics.operatingExpenses ??
    latestSnapshot?.operatingExpenses ??
    null;
  const pnlCostOfSales =
    summaryMetrics.metrics.costOfSales ??
    latestSnapshot?.costOfSales ??
    null;
  const pnlGrossProfit =
    summaryMetrics.metrics.grossProfit ??
    latestSnapshot?.grossProfit ??
    (pnlRevenue !== null && pnlCostOfSales !== null ? pnlRevenue - pnlCostOfSales : null);
  const pnlNetProfit =
    mode === "txns-estimate"
      ? txnCurrentPnL?.netProfit ??
        summaryMetrics.metrics.netProfit ??
        latestSnapshot?.netIncome ??
        null
      : summaryMetrics.metrics.netProfit ??
        latestSnapshot?.netIncome ??
        txnCurrentPnL?.netProfit ??
        null;
  const cashPosition =
    summaryMetrics.metrics.cashPosition ??
    latestSnapshot?.cashPosition ??
    totalAccountBalance;
  const runwayMonths =
    summaryMetrics.metrics.runwayMonths ??
    latestSnapshot?.runwayMonths ??
    null;

  const revenueChange =
    latestSnapshot && previousSnapshot
      ? percentageChange(latestSnapshot.revenue, previousSnapshot.revenue)
      : txnCurrentPnL?.revenueChange ?? null;
  const expenseChange =
    latestSnapshot && previousSnapshot
      ? percentageChange(latestSnapshot.expenses, previousSnapshot.expenses)
      : txnCurrentPnL?.expenseChange ?? null;

  const hasCoreMetrics =
    [pnlRevenue, pnlExpenses, pnlNetProfit, cashPosition].some((value) => value !== null);
  const hasBankHistorySignal =
    txnCashFlow.length >= 3 ||
    (summaryMetrics.bankingRecords ?? 0) > 0 ||
    summaryMetrics.warnings.includes("finance_banking_estimate");

  const warnings = buildWarnings({
    mode,
    source,
    sourcePeriod,
    summaryWarnings: summaryMetrics.warnings,
    latestSnapshot,
    cashFlowSeries: txnCashFlow,
    hasBankHistorySignal,
    hasCoreMetrics,
  });
  if (accountFxCoverageWarning) {
    warnings.push(accountFxCoverageWarning);
  }

  const quality: FinancialQuality =
    mode === "summary-complete"
      ? "verified"
      : mode === "docs-partial"
        ? "partial"
        : mode === "txns-estimate"
          ? "estimated"
          : "none";

  const transactionPnlSeries = buildTransactionPnLSeries(txnCashFlow);
  const usableSnapshotSeries = snapshotSeries.filter(hasCoreSnapshotMetrics);
  const usableSnapshotPnlSeries = snapshotSeries.filter(hasPnlSnapshotMetrics);
  const usableSnapshotExpenseSeries = snapshotSeries.filter(hasExpenseSnapshotMetrics);
  const syntheticExpenseBreakdown = buildSyntheticExpenseBreakdown({
    total: pnlExpenses,
    operatingExpenses: pnlOperatingExpenses,
    costOfSales: pnlCostOfSales,
  });
  const effectiveExpenseBreakdown =
    expenseBreakdown.length > 0 ? expenseBreakdown : syntheticExpenseBreakdown;
  const effectivePnlSeries =
    usableSnapshotPnlSeries.length > 0
      ? usableSnapshotPnlSeries
      : transactionPnlSeries;
  const effectiveExpenseSeries =
    usableSnapshotExpenseSeries.length > 0
      ? usableSnapshotExpenseSeries
      : transactionPnlSeries;

  return {
    mode,
    source,
    sourceLabel: inferSourceLabel(source),
    sourcePeriod,
    currency,
    quality,
    warnings,
    pnl: {
      revenue: pnlRevenue,
      expenses: pnlExpenses,
      operatingExpenses: pnlOperatingExpenses,
      costOfSales: pnlCostOfSales,
      grossProfit: pnlGrossProfit,
      netProfit: pnlNetProfit,
      marginPct:
        pnlRevenue !== null && pnlRevenue !== 0 && pnlNetProfit !== null
          ? Number(((pnlNetProfit / pnlRevenue) * 100).toFixed(1))
          : null,
      revenueChange,
      expenseChange,
    },
    cash: {
      cashPosition,
      runwayMonths,
      avgMonthlyBurn: averageTxnExpenses,
      avgMonthlyRevenue: averageTxnRevenue,
      avgMonthlyProfit: averageTxnProfit,
      chartKind:
        txnCashFlow.length >= 3
          ? "cash_flow"
          : snapshotSeries.filter((point) => point.cashPosition !== null).length >= 3
            ? "cash_position"
            : "none",
    },
    balanceSheet: {
      cashAndEquivalents: null,
      inventory: null,
      totalCurrentAssets: null,
      fixedAssets: null,
      totalAssets: null,
      totalLiabilities: null,
      equity: null,
      retainedEarnings: null,
    },
    projection: {
      available: false,
      latestPlanPeriod: null,
      comparableThroughPeriod: null,
      revenue: null,
      expenses: null,
      grossProfit: null,
      netIncome: null,
      cashPosition: null,
      varianceRevenue: null,
      varianceExpenses: null,
      varianceNetIncome: null,
    },
    expenses: {
      total: pnlExpenses,
      operatingExpenses: pnlOperatingExpenses,
      costOfSales: pnlCostOfSales,
      breakdown: effectiveExpenseBreakdown,
      breakdownBasis:
        expenseBreakdown.length > 0
          ? "transactions"
          : effectiveExpenseBreakdown.length > 0
            ? "statements"
          : "none",
      transactionCount: txnExpenseCount,
    },
    series: {
      pnl: effectivePnlSeries.map((point) => ({
        period: point.period,
        revenue: point.revenue,
        expenses: point.expenses,
        operatingExpenses: point.operatingExpenses,
        costOfSales: point.costOfSales,
        grossProfit: point.grossProfit,
        netIncome: point.netIncome,
        cashPosition: point.cashPosition,
        runwayMonths: point.runwayMonths,
      })),
      cash: snapshotSeries
        .filter((point) => point.cashPosition !== null)
        .map((point) => ({
          period: point.period,
          cashPosition: point.cashPosition as number,
          source: "statements" as const,
        })),
      balanceSheet: [],
      expenses: effectiveExpenseSeries.map((point) => ({
        period: point.period,
        expenses: point.expenses,
        operatingExpenses: point.operatingExpenses,
        costOfSales: point.costOfSales,
      })),
      cashFlow: txnCashFlow,
      projections: [],
      planVsActual: [],
    },
    provenance: {
      summaryPath: financeSummary?.path ?? null,
      snapshotCount: financeSnapshots.count,
      statementTypes: Array.from(new Set(snapshotCandidates.map((candidate) => candidate.reportType))),
      departmentLevelOnly: summaryComplete ? false : latestSnapshot?.departmentLevelOnly ?? false,
      seriesSource:
        usableSnapshotSeries.length > 0 && txnCashFlow.length > 0
          ? "mixed"
          : usableSnapshotSeries.length > 0
            ? "statements"
              : txnCashFlow.length > 0
              ? "transactions"
              : "none",
      representativeSnapshotIds: latestSnapshot?.representativeIds ?? [],
    },
  };
}
