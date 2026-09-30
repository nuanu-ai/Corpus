import {
  extractSnapshotStatementMetrics,
  normalizeFinancialReportType,
  type SnapshotStatementMetrics,
} from "@/lib/company-db/financial-metrics";
import {
  isUnknownReportingPeriod,
  normalizeReportingPeriodKey,
} from "@/lib/document-parsers/period-utils";

export type FinanceEntityLike = {
  qualifiedId: string;
  type: string;
  domain: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
  title: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CanonicalFinancePoint = {
  period: string;
  revenue: number | null;
  expenses: number | null;
  operatingExpenses: number | null;
  costOfSales: number | null;
  grossProfit: number | null;
  netIncome: number | null;
  cashPosition: number | null;
  runwayMonths: number | null;
  representativeIds: string[];
  statementTypes: string[];
  sourceKinds: string[];
  hasConflict: boolean;
  conflictMetrics: string[];
  importedOnly: boolean;
};

export type ProjectionPackSelection<T extends FinanceEntityLike = FinanceEntityLike> = {
  projectionEntities: T[];
  authoritativeEntities: T[];
  authoritativeLatestEntity: T | null;
  packCount: number;
};

type FinanceCandidate = {
  qualifiedId: string;
  period: string;
  reportType: string;
  sourceKind: "snapshot" | "statement" | "document_import" | "other";
  entityLabel: string | null;
  isExplicitCompanyWide: boolean;
  isConsolidated: boolean;
  updatedAt: string | null;
  metrics: SnapshotStatementMetrics;
};

const CONSOLIDATED_KEYWORDS = [
  "consolidated",
  "consolidation",
  "consilidation",
  "consilidat",
  "summary",
  "overall",
  "group",
  "total",
  "macro",
  "company wide",
  "companywide",
  "all departments",
];

const GENERIC_ENTITY_LABELS = new Set([
  "balance sheet",
  "bs",
  "cash flow",
  "financial statement",
  "general ledger",
  "gl",
  "profit and loss",
  "p and l",
  "p l",
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

function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
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

function normalizePeriod(period: unknown): string | null {
  const text = toText(period);
  if (!text) return null;
  if (text.startsWith("1970-01-01")) return null;

  const isoRange = text.match(/^(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})$/);
  if (isoRange) {
    const normalizedRange = normalizeReportingPeriodKey({
      start: isoRange[1],
      end: isoRange[2],
    });
    if (normalizedRange !== text) {
      return normalizePeriod(normalizedRange);
    }
    return normalizePeriod(isoRange[2]) ?? text;
  }

  const yearMonth = text.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) return text;

  const quarter = text.match(/^(\d{4})-q([1-4])$/i);
  if (quarter) return `${quarter[1]}-q${quarter[2]}`;

  const yearOnly = text.match(/^\d{4}$/);
  if (yearOnly) return text;

  const isoMonth = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMonth) return `${isoMonth[1]}-${isoMonth[2]}`;

  return text;
}

export function getFinanceEntityPeriodKey(frontmatter: Record<string, unknown>): string | null {
  const directKeys = [
    frontmatter.period_key,
    frontmatter.reporting_period_key,
    frontmatter.period,
    frontmatter.reporting_period_label,
    frontmatter.latest_period,
    frontmatter.period_label,
  ];

  for (const candidate of directKeys) {
    const normalized = normalizePeriod(candidate);
    if (normalized) return normalized;
  }

  const periodObject =
    typeof frontmatter.reporting_period === "object" && frontmatter.reporting_period !== null
      ? (frontmatter.reporting_period as { start?: string; end?: string; label?: string | null })
      : null;
  if (
    periodObject?.start &&
    periodObject?.end &&
    !isUnknownReportingPeriod({
      start: periodObject.start,
      end: periodObject.end,
      label: periodObject.label ?? undefined,
    })
  ) {
    return normalizePeriod(
      normalizeReportingPeriodKey({
        start: periodObject.start,
        end: periodObject.end,
        label: periodObject.label ?? undefined,
      }),
    );
  }

  const start = toText(frontmatter.period_start);
  const end = toText(frontmatter.period_end);
  if (start && end) {
    return normalizePeriod(normalizeReportingPeriodKey({ start, end }));
  }

  return null;
}

function isCanonicalProjectionLike(entity: FinanceEntityLike): boolean {
  if (entity.domain !== "finance") return false;
  if (!entity.filePath.startsWith("finance/projections/")) return false;
  const family = toText(entity.frontmatter.canonical_family);
  return family === "financial_projection_plan" || entity.type === "forecast";
}

function getProjectionPackKey(entity: FinanceEntityLike): string {
  const documentId =
    toText(entity.frontmatter.document_id) ??
    toText(entity.frontmatter.documentId) ??
    toText(entity.frontmatter.source_document_name) ??
    toText(entity.frontmatter.source_file_name) ??
    "unknown-document";
  const planKey = toText(entity.frontmatter.plan_key) ?? "default-projection";
  const scenarioKey =
    toText(entity.frontmatter.scenario_key) ??
    toText(entity.frontmatter.scenario) ??
    "base";
  const scopeKey = normalizeLabelText(
    toText(entity.frontmatter.scope_key) ??
      toText(entity.frontmatter.scope_label) ??
      toText(entity.frontmatter.entity) ??
      "company",
  );

  return `${documentId}::${planKey}::${scenarioKey}::${scopeKey}`;
}

function getEntityRecencyScore(entity: FinanceEntityLike): number {
  const reportingPeriod =
    typeof entity.frontmatter.reporting_period === "object" && entity.frontmatter.reporting_period !== null
      ? (entity.frontmatter.reporting_period as Record<string, unknown>)
      : null;
  const updatedAt =
    toIsoDate(entity.updatedAt) ??
    toIsoDate(entity.createdAt) ??
    toIsoDate(entity.frontmatter.updated_at) ??
    toIsoDate(entity.frontmatter.created_at) ??
    toIsoDate(entity.frontmatter.date) ??
    toIsoDate(entity.frontmatter.period_end) ??
    toIsoDate(entity.frontmatter.period_start) ??
    toIsoDate(reportingPeriod?.end) ??
    toIsoDate(reportingPeriod?.start);

  if (!updatedAt) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(updatedAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function selectAuthoritativeProjectionPack<T extends FinanceEntityLike>(
  entities: T[],
): ProjectionPackSelection<T> {
  const projectionEntities = entities.filter(isCanonicalProjectionLike);
  if (projectionEntities.length === 0) {
    return {
      projectionEntities: [],
      authoritativeEntities: [],
      authoritativeLatestEntity: null,
      packCount: 0,
    };
  }

  const groups = new Map<string, T[]>();
  for (const entity of projectionEntities) {
    const key = getProjectionPackKey(entity);
    const bucket = groups.get(key) ?? [];
    bucket.push(entity);
    groups.set(key, bucket);
  }

  const reviewRank = (entity: T): number => {
    switch (toText(entity.frontmatter.review_status)) {
      case "verified":
        return 0;
      case "review_pending":
        return 1;
      case "needs_review":
        return 2;
      default:
        return 3;
    }
  };

  const compareProjectionEntities = (left: T, right: T): number => {
    const leftRecency = getEntityRecencyScore(left);
    const rightRecency = getEntityRecencyScore(right);
    if (leftRecency !== rightRecency) return rightRecency - leftRecency;

    const leftReview = reviewRank(left);
    const rightReview = reviewRank(right);
    if (leftReview !== rightReview) return leftReview - rightReview;

    const leftCompanyWide = isCompanyWideFinanceEntity(left);
    const rightCompanyWide = isCompanyWideFinanceEntity(right);
    if (leftCompanyWide !== rightCompanyWide) return leftCompanyWide ? -1 : 1;

    return (
      periodSortValue(getFinanceEntityPeriodKey(right.frontmatter) ?? "") -
      periodSortValue(getFinanceEntityPeriodKey(left.frontmatter) ?? "")
    );
  };

  const periodGroups = new Map<string, T[]>();
  for (const entity of projectionEntities) {
    const period = getFinanceEntityPeriodKey(entity.frontmatter);
    if (!period) continue;
    const bucket = periodGroups.get(period) ?? [];
    bucket.push(entity);
    periodGroups.set(period, bucket);
  }

  const authoritativeEntities = Array.from(periodGroups.values())
    .map((bucket) => [...bucket].sort(compareProjectionEntities)[0] ?? null)
    .filter((entity): entity is T => entity !== null);

  const authoritativeLatestEntity =
    [...authoritativeEntities].sort((left, right) => {
      const periodDelta =
        periodSortValue(getFinanceEntityPeriodKey(right.frontmatter) ?? "") -
        periodSortValue(getFinanceEntityPeriodKey(left.frontmatter) ?? "");
      if (periodDelta !== 0) return periodDelta;
      return compareProjectionEntities(left, right);
    })[0] ?? null;

  return {
    projectionEntities,
    authoritativeEntities,
    authoritativeLatestEntity,
    packCount: groups.size,
  };
}

function getEntityLabel(frontmatter: Record<string, unknown>, title: string | null): string | null {
  for (const key of ENTITY_LABEL_KEYS) {
    const value = toText(frontmatter[key]);
    if (value) return value;
  }
  return toText(title);
}

function isConsolidatedEntity(
  frontmatter: Record<string, unknown>,
  title: string | null,
): boolean {
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

function isExplicitCompanyWideFrontmatter(frontmatter: Record<string, unknown>): boolean {
  if (frontmatter.company_wide === true) return true;
  const scopeKey = normalizeLabelText(
    toText(frontmatter.scope_key) ??
      toText(frontmatter.scope_label) ??
      "",
  );
  return scopeKey === "company";
}

export function isCompanyWideFinanceEntity(entity: FinanceEntityLike): boolean {
  if (entity.frontmatter.company_wide === false) return false;
  if (isExplicitCompanyWideFrontmatter(entity.frontmatter)) return true;
  return isConsolidatedEntity(entity.frontmatter, entity.title);
}

function countMetricCoverage(metrics: SnapshotStatementMetrics): number {
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

function getSourceKind(entity: FinanceEntityLike): FinanceCandidate["sourceKind"] {
  if (entity.type === "financial_snapshot") return "snapshot";
  if (
    entity.type === "income_statement" ||
    entity.type === "balance_sheet" ||
    entity.type === "cash_flow_statement"
  ) {
    return "statement";
  }
  if (entity.type === "document_import") return "document_import";
  return "other";
}

function getSourceKindWeight(kind: FinanceCandidate["sourceKind"]): number {
  switch (kind) {
    case "statement":
      return 0;
    case "document_import":
      return 1;
    case "snapshot":
      return 2;
    default:
      return 3;
  }
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
  metricKey: keyof SnapshotStatementMetrics,
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

function compareCandidates(left: FinanceCandidate, right: FinanceCandidate): number {
  if (left.isExplicitCompanyWide !== right.isExplicitCompanyWide) {
    return left.isExplicitCompanyWide ? -1 : 1;
  }

  if (left.isConsolidated !== right.isConsolidated) {
    return left.isConsolidated ? -1 : 1;
  }

  const sourceKindDelta = getSourceKindWeight(left.sourceKind) - getSourceKindWeight(right.sourceKind);
  if (sourceKindDelta !== 0) return sourceKindDelta;

  const metricCoverageDelta = countMetricCoverage(right.metrics) - countMetricCoverage(left.metrics);
  if (metricCoverageDelta !== 0) return metricCoverageDelta;

  const leftUpdated = left.updatedAt ? Date.parse(left.updatedAt) : 0;
  const rightUpdated = right.updatedAt ? Date.parse(right.updatedAt) : 0;
  return rightUpdated - leftUpdated;
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

function getNormalizedMetricValue(value: number | null): string | null {
  if (value === null) return null;
  return Number(value.toFixed(2)).toString();
}

function resolveMetricForPeriod(
  candidates: FinanceCandidate[],
  metricKey: keyof SnapshotStatementMetrics,
): {
  value: number | null;
  representativeIds: string[];
  reportTypes: string[];
  sourceKinds: string[];
  hasConflict: boolean;
} {
  const withMetric = candidates
    .filter((candidate) => candidate.metrics[metricKey] !== null)
    .sort(compareCandidates);

  if (withMetric.length === 0) {
    return {
      value: null,
      representativeIds: [],
      reportTypes: [],
      sourceKinds: [],
      hasConflict: false,
    };
  }

  const bestPriority = Math.max(
    ...withMetric.map((candidate) => getMetricReportPriority(candidate.reportType, metricKey)),
  );
  const metricPreferred = withMetric.filter(
    (candidate) => getMetricReportPriority(candidate.reportType, metricKey) === bestPriority,
  );
  const chosen = metricPreferred[0]!;
  const distinctValues = new Set(
    metricPreferred
      .map((candidate) => getNormalizedMetricValue(candidate.metrics[metricKey]))
      .filter((value): value is string => value !== null),
  );

  return {
    value: chosen.metrics[metricKey],
    representativeIds: [chosen.qualifiedId],
    reportTypes: [chosen.reportType],
    sourceKinds: [chosen.sourceKind],
    hasConflict: distinctValues.size > 1,
  };
}

export function isFinanceStatementEntity(entity: FinanceEntityLike): boolean {
  if (entity.domain && entity.domain !== "finance") return false;
  if (toText(entity.frontmatter.report_type)) return true;
  if (
    toNumber(entity.frontmatter.revenue) !== null ||
    toNumber(entity.frontmatter.expenses) !== null ||
    toNumber(entity.frontmatter.net_income) !== null ||
    toNumber(entity.frontmatter.net_profit) !== null ||
    toNumber(entity.frontmatter.cash_position) !== null ||
    toNumber(entity.frontmatter.ending_balance) !== null
  ) {
    return true;
  }
  if (
    entity.type === "financial_snapshot" ||
    entity.type === "income_statement" ||
    entity.type === "balance_sheet" ||
    entity.type === "cash_flow_statement"
  ) {
    return true;
  }
  if (entity.type === "document_import") {
    return Boolean(toText(entity.frontmatter.report_type)) || toText(entity.frontmatter.target_entity_type) === "financial_report";
  }
  return false;
}

export function buildCanonicalFinanceSeries(
  entities: FinanceEntityLike[],
): CanonicalFinancePoint[] {
  const candidates: FinanceCandidate[] = entities
    .filter(isFinanceStatementEntity)
    .map((entity) => {
      const reportType = normalizeFinancialReportType(
        String(entity.frontmatter.report_type ?? entity.frontmatter.type ?? "unknown"),
      );
      const metrics = extractSnapshotStatementMetrics(entity.frontmatter, reportType);
      const period =
        getFinanceEntityPeriodKey(entity.frontmatter) ??
        normalizePeriod(entity.updatedAt) ??
        normalizePeriod(entity.createdAt) ??
        (countMetricCoverage(metrics) > 0 ? "undated" : null);
      if (!period) return null;

      return {
        qualifiedId: entity.qualifiedId,
        period,
        reportType,
        sourceKind: getSourceKind(entity),
        entityLabel: getEntityLabel(entity.frontmatter, entity.title),
        isExplicitCompanyWide: isExplicitCompanyWideFrontmatter(entity.frontmatter),
        isConsolidated: isConsolidatedEntity(entity.frontmatter, entity.title),
        updatedAt: entity.updatedAt ?? entity.createdAt,
        metrics,
      } satisfies FinanceCandidate;
    })
    .filter((value): value is FinanceCandidate => Boolean(value));

  const groups = new Map<string, FinanceCandidate[]>();
  for (const candidate of candidates) {
    const bucket = groups.get(candidate.period) ?? [];
    bucket.push(candidate);
    groups.set(candidate.period, bucket);
  }

  return Array.from(groups.entries())
    .map(([period, periodCandidates]) => {
      const revenue = resolveMetricForPeriod(periodCandidates, "revenue");
      const expenses = resolveMetricForPeriod(periodCandidates, "expenses");
      const operatingExpenses = resolveMetricForPeriod(periodCandidates, "operating_expenses");
      const costOfSales = resolveMetricForPeriod(periodCandidates, "cost_of_sales");
      const grossProfit = resolveMetricForPeriod(periodCandidates, "gross_profit");
      const netIncome = resolveMetricForPeriod(periodCandidates, "net_income");
      const cashPosition = resolveMetricForPeriod(periodCandidates, "cash_position");
      const runwayMonths = resolveMetricForPeriod(periodCandidates, "runway_months");

      const representativeIds = Array.from(
        new Set([
          ...revenue.representativeIds,
          ...expenses.representativeIds,
          ...operatingExpenses.representativeIds,
          ...costOfSales.representativeIds,
          ...grossProfit.representativeIds,
          ...netIncome.representativeIds,
          ...cashPosition.representativeIds,
          ...runwayMonths.representativeIds,
        ]),
      );
      const statementTypes = Array.from(
        new Set([
          ...revenue.reportTypes,
          ...expenses.reportTypes,
          ...operatingExpenses.reportTypes,
          ...costOfSales.reportTypes,
          ...grossProfit.reportTypes,
          ...netIncome.reportTypes,
          ...cashPosition.reportTypes,
          ...runwayMonths.reportTypes,
        ]),
      );
      const sourceKinds = Array.from(
        new Set([
          ...revenue.sourceKinds,
          ...expenses.sourceKinds,
          ...operatingExpenses.sourceKinds,
          ...costOfSales.sourceKinds,
          ...grossProfit.sourceKinds,
          ...netIncome.sourceKinds,
          ...cashPosition.sourceKinds,
          ...runwayMonths.sourceKinds,
        ]),
      );

      const conflictMetrics = [
        revenue.hasConflict ? "revenue" : null,
        expenses.hasConflict ? "expenses" : null,
        operatingExpenses.hasConflict ? "operating_expenses" : null,
        costOfSales.hasConflict ? "cost_of_sales" : null,
        grossProfit.hasConflict ? "gross_profit" : null,
        netIncome.hasConflict ? "net_income" : null,
        cashPosition.hasConflict ? "cash_position" : null,
        runwayMonths.hasConflict ? "runway_months" : null,
      ].filter((value): value is string => Boolean(value));

      return {
        period,
        revenue: revenue.value,
        expenses: expenses.value,
        operatingExpenses: operatingExpenses.value,
        costOfSales: costOfSales.value,
        grossProfit: grossProfit.value,
        netIncome:
          netIncome.value ??
          (revenue.value !== null && expenses.value !== null ? revenue.value - expenses.value : null),
        cashPosition: cashPosition.value,
        runwayMonths: runwayMonths.value,
        representativeIds,
        statementTypes,
        sourceKinds,
        hasConflict: conflictMetrics.length > 0,
        conflictMetrics,
        importedOnly:
          sourceKinds.length > 0 &&
          sourceKinds.every((sourceKind) => sourceKind === "document_import"),
      } satisfies CanonicalFinancePoint;
    })
    .sort((left, right) => periodSortValue(left.period) - periodSortValue(right.period));
}

export function summarizeCanonicalFinanceCoverage(
  entities: FinanceEntityLike[],
  points: CanonicalFinancePoint[],
): string[] {
  const statementEntities = entities.filter(isFinanceStatementEntity);
  if (statementEntities.length === 0) return [];

  const typeSummary = Array.from(
    new Set(
      statementEntities
        .map((entity) =>
          normalizeFinancialReportType(String(entity.frontmatter.report_type ?? entity.type ?? "unknown")),
        )
        .filter(Boolean),
    ),
  ).join(", ");

  const lines = [`Financial statements: ${statementEntities.length} records`];
  if (points.length > 0) {
    lines.push(`Reporting periods: ${points.map((point) => point.period).join(", ")}`);
  }
  if (typeSummary) {
    lines.push(`Statement types: ${typeSummary}`);
  }
  return lines;
}
