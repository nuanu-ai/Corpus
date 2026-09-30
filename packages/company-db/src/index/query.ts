import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryFilters {
  domain?: string;
  type?: string;
  status?: string;
  documentId?: string;
  limit?: number;
  offset?: number;
  view?: EntityView;
}

export type EntityView = "full" | "summary";

export interface EntityResult {
  qualifiedId: string;
  type: string;
  domain: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
  title?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEAVY_FRONTMATTER_KEYS = new Set([
  "line_items",
  "cell_lineage",
  "statement_lines",
  "source_refs",
  "source_lineage",
]);

const DEFAULT_EXCLUDED_TYPES = new Set([
  "statement_lines_technical",
]);

const DOCUMENT_IMPORT_SUMMARY_BASE_KEYS = new Set([
  "id",
  "type",
  "subtype",
  "domain",
  "target_domain",
  "target_entity_type",
  "title",
  "document_id",
  "source_file_name",
  "file_type",
  "document_kind",
  "unit_count",
  "overall_confidence",
  "routing_confidence",
  "requires_review",
  "review_pending",
  "evidence_status",
  "ingestion_mode",
  "report_type",
  "book",
  "entity",
  "currency",
  "period_label",
  "period_start",
  "period_end",
  "sheet_name",
  "source_language",
  "created_at",
  "updated_at",
  "status",
]);

const SUMMARY_STRING_MAX_CHARS = 220;
const SUMMARY_ARRAY_ITEM_MAX_CHARS = 180;
const SUMMARY_ARRAY_ITEM_LIMIT = 3;

function truncateSummaryString(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function summarizeStringList(
  value: unknown,
  options?: {
    itemLimit?: number;
    itemMaxChars?: number;
  },
): { items: string[]; count: number } | null {
  if (!Array.isArray(value)) return null;

  const strings = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) =>
      truncateSummaryString(
        entry,
        options?.itemMaxChars ?? SUMMARY_ARRAY_ITEM_MAX_CHARS,
      ),
    );

  if (strings.length === 0) return null;

  return {
    items: strings.slice(0, options?.itemLimit ?? SUMMARY_ARRAY_ITEM_LIMIT),
    count: strings.length,
  };
}

function summarizeDocumentImport(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  for (const key of DOCUMENT_IMPORT_SUMMARY_BASE_KEYS) {
    const value = frontmatter[key];
    if (value !== undefined) {
      summary[key] = value;
    }
  }

  const listFields: Array<{
    key: string;
    countKey: string;
    includeItems?: boolean;
    itemLimit?: number;
    itemMaxChars?: number;
  }> = [
    {
      key: "routing_reasons",
      countKey: "routing_reason_count",
      includeItems: true,
      itemLimit: 2,
      itemMaxChars: 220,
    },
    {
      key: "review_flags",
      countKey: "review_flag_count",
      includeItems: true,
      itemLimit: 4,
      itemMaxChars: 120,
    },
    {
      key: "key_themes",
      countKey: "key_theme_count",
      includeItems: true,
      itemLimit: 3,
      itemMaxChars: 120,
    },
    { key: "risks", countKey: "risk_count" },
    { key: "topline_findings", countKey: "topline_finding_count" },
    { key: "assumptions", countKey: "assumption_count" },
    { key: "anomalies", countKey: "anomaly_count" },
    { key: "company_names_detected", countKey: "company_name_count" },
  ];

  for (const field of listFields) {
    const summarized = summarizeStringList(frontmatter[field.key], {
      itemLimit: field.itemLimit,
      itemMaxChars: field.itemMaxChars,
    });
    if (!summarized) continue;
    summary[field.countKey] = summarized.count;
    if (field.includeItems) {
      summary[field.key] = summarized.items;
    }
  }

  return summary;
}

function normalizeReportType(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

function rowToResult(row: Record<string, unknown>): EntityResult {
  return {
    qualifiedId: row.qualified_id as string,
    type: row.type as string,
    domain: row.domain as string,
    filePath: row.file_path as string,
    frontmatter: JSON.parse(row.frontmatter as string) as Record<string, unknown>,
    title: (row.title as string) ?? undefined,
    status: (row.status as string) ?? undefined,
    createdAt: (row.created_at as string) ?? undefined,
    updatedAt: (row.updated_at as string) ?? undefined,
  };
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

function pickNumber(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((best, current) =>
    Math.abs(current) > Math.abs(best) ? current : best
  );
}

const LINE_ITEM_VALUE_KEY_PRIORITY = [
  "actual",
  "current_period",
  "amount",
  "mtd_actual",
  "ending_balance",
  "cash_balance",
  "cash_position",
  "ending_cash",
  "balance",
  "ytd_actual",
];

function normalizeValueKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isPercentLikeValueKey(key: string): boolean {
  const normalized = normalizeValueKey(key);
  return (
    normalized.includes("percent") ||
    normalized.endsWith("pct") ||
    normalized.endsWith("ratio") ||
    normalized.endsWith("margin")
  );
}

function getValueKeyPriority(key: string): number {
  const normalized = normalizeValueKey(key);
  const index = LINE_ITEM_VALUE_KEY_PRIORITY.indexOf(normalized);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function getLineItemValue(values: unknown): number | null {
  if (typeof values !== "object" || values === null) return null;

  const candidates = Object.entries(values as Record<string, unknown>)
    .map(([key, raw]) => ({
      key,
      value: toNumber(raw),
      priority: getValueKeyPriority(key),
      isPercentLike: isPercentLikeValueKey(key),
    }))
    .filter((entry): entry is { key: string; value: number; priority: number; isPercentLike: boolean } => entry.value !== null);

  if (candidates.length === 0) return null;

  const amountCandidates = candidates.filter((entry) => !entry.isPercentLike);
  const meaningfulCandidates = amountCandidates.filter((entry) => entry.value !== 0);
  const prioritizedPool = meaningfulCandidates.length > 0 ? meaningfulCandidates : amountCandidates;

  const prioritized = prioritizedPool
    .filter((entry) => Number.isFinite(entry.priority))
    .sort((a, b) => a.priority - b.priority)[0];
  if (prioritized) return prioritized.value;

  if (prioritizedPool.length === 1) {
    return prioritizedPool[0]?.value ?? null;
  }

  return null;
}

function readMetric(frontmatter: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = frontmatter[key];
    const parsed = toNumber(value);
    if (parsed !== null) return parsed;
  }

  const summaryMetrics = frontmatter.summary_metrics;
  if (summaryMetrics && typeof summaryMetrics === "object") {
    for (const key of keys) {
      const parsed = toNumber((summaryMetrics as Record<string, unknown>)[key]);
      if (parsed !== null) return parsed;
    }
  }

  return null;
}

function normalizeExpenseMagnitude(value: number | null): number | null {
  if (value === null) return null;
  return value < 0 ? Math.abs(value) : value;
}

type SnapshotLineItem = {
  account_name?: unknown;
  section?: unknown;
  subsection?: unknown;
  values?: unknown;
  is_total?: unknown;
};

function readLineItemMetric(frontmatter: Record<string, unknown>, keywords: string[]): number | null {
  const rawItems = frontmatter.line_items;
  if (!Array.isArray(rawItems)) return null;

  const totalCandidates: number[] = [];
  const fallbackCandidates: number[] = [];

  for (const raw of rawItems) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as SnapshotLineItem;

    const section = String(item.section ?? "").toLowerCase();
    const account = String(item.account_name ?? "").toLowerCase();
    const haystack = `${section} ${account}`;

    if (!keywords.some((keyword) => haystack.includes(keyword))) continue;

    const value = getLineItemValue(item.values);
    if (value === null) continue;

    const isTotal = Boolean(item.is_total) || /\btotal\b|\bnet\b/.test(account);
    if (isTotal) {
      totalCandidates.push(value);
    } else {
      fallbackCandidates.push(value);
    }
  }

  return pickNumber(totalCandidates) ?? pickNumber(fallbackCandidates);
}

function normalizeMetricText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

type MetricCandidate = {
  value: number;
  account: string;
  section: string;
  subsection: string;
  text: string;
  isTotal: boolean;
};

function collectMetricCandidates(frontmatter: Record<string, unknown>): MetricCandidate[] {
  const rawItems = frontmatter.line_items;
  if (!Array.isArray(rawItems)) return [];

  const candidates: MetricCandidate[] = [];
  for (const raw of rawItems) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as SnapshotLineItem;
    const value = getLineItemValue(item.values);
    if (value === null) continue;

    const account = normalizeMetricText(item.account_name);
    const section = normalizeMetricText(item.section);
    const subsection = normalizeMetricText(item.subsection);
    const text = `${account} ${section} ${subsection}`.trim();

    candidates.push({
      value,
      account,
      section,
      subsection,
      text,
      isTotal: Boolean(item.is_total) || /\b(total|net)\b/.test(account),
    });
  }

  return candidates;
}

function selectMetricCandidate(
  candidates: MetricCandidate[],
  scorer: (candidate: MetricCandidate) => number | null,
): number | null {
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scorer(candidate),
    }))
    .filter((entry): entry is { candidate: MetricCandidate; score: number } => entry.score !== null);

  if (scored.length === 0) return null;

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return Math.abs(right.candidate.value) - Math.abs(left.candidate.value);
  });

  return scored[0]?.candidate.value ?? null;
}

function scoreRevenueCandidate(candidate: MetricCandidate): number | null {
  const { account, section, text, isTotal } = candidate;
  if (!hasAny(text, ["revenue", "sales", "income", "renenue"])) return null;
  if (hasAny(text, ["cost", "expense", "cogs", "profit", "loss", "margin", "payable", "loan"])) {
    return null;
  }

  let score = 0;
  if (isTotal) score += 100;
  if (hasAny(account, ["total revenue", "total sales", "total income"])) score += 80;
  if (hasAny(account, ["total food beverage revenue", "total food beverage renenue"])) score += 120;
  if (account.includes("gross revenue")) score -= 25;
  if (section.includes("revenue")) score += 15;
  if (account.startsWith("total ")) score += 10;
  return score;
}

function scoreCostOfSalesCandidate(candidate: MetricCandidate): number | null {
  const { account, text, isTotal } = candidate;
  if (
    !hasAny(text, [
      "cost of sales",
      "cost of revenue",
      "cost of fb",
      "cost of food",
      "cost of beverage",
      "cost of goods sold",
      "cogs",
    ])
  ) {
    return null;
  }

  let score = 0;
  if (isTotal) score += 100;
  if (account.startsWith("total ")) score += 20;
  if (hasAny(account, ["total cost of sales", "total cost of revenue", "total cost of fb"])) {
    score += 60;
  }
  return score;
}

function scoreOperatingExpensesCandidate(candidate: MetricCandidate): number | null {
  const { account, text, isTotal } = candidate;
  if (!hasAny(text, ["expense", "operating expense", "payroll"])) return null;
  if (hasAny(text, ["cost of sales", "cost of revenue", "cost of fb", "cogs", "profit", "loss", "revenue", "sales"])) {
    return null;
  }

  let score = 0;
  if (isTotal) score += 100;
  if (hasAny(account, ["total expenses", "operating expenses", "total operating expenses"])) {
    score += 90;
  }
  if (hasAny(account, ["total payroll", "total payroll related exp"])) {
    score += 20;
  }
  if (account.startsWith("total ")) score += 10;
  return score;
}

function scoreGrossProfitCandidate(candidate: MetricCandidate): number | null {
  const { account, text, isTotal } = candidate;
  if (!hasAny(text, ["gross profit", "gross revenue"])) return null;

  let score = 0;
  if (isTotal) score += 100;
  if (account.startsWith("total ")) score += 20;
  return score;
}

function scoreNetIncomeCandidate(candidate: MetricCandidate): number | null {
  const { text, isTotal } = candidate;
  if (
    !hasAny(text, [
      "net income",
      "net profit",
      "profit loss",
      "profit and loss",
      "department profit",
      "departement profit",
      "profit loss current period",
      "profit and loss current period",
      "current period profit",
    ])
  ) {
    return null;
  }
  if (text.includes("gross profit")) return null;

  let score = 0;
  if (isTotal) score += 100;
  if (hasAny(text, ["net income", "net profit"])) score += 80;
  if (hasAny(text, ["department profit", "departement profit", "current period"])) score += 50;
  return score;
}

function scoreCashCandidate(candidate: MetricCandidate): number | null {
  const { section, text, isTotal } = candidate;
  if (!hasAny(text, ["cash", "bank"])) return null;
  if (hasAny(text, ["payable", "loan", "debt", "bank s loan", "bank loan"])) return null;

  let score = 0;
  if (hasAny(text, ["cash and bank", "cash balance", "cash position", "ending cash"])) {
    score += 100;
  }
  if (section.includes("current assets")) score += 20;
  if (isTotal) score += 10;
  return score;
}

function combineExpenses(
  revenue: number | null,
  operatingExpenses: number | null,
  costOfSales: number | null,
  netIncome: number | null,
): number | null {
  if (operatingExpenses !== null && costOfSales !== null) {
    if (revenue !== null && netIncome !== null) {
      const withoutCogsDelta = Math.abs(revenue - operatingExpenses - netIncome);
      const withCogsDelta = Math.abs(revenue - operatingExpenses - costOfSales - netIncome);
      if (withoutCogsDelta <= withCogsDelta) {
        return operatingExpenses;
      }
    }
    return operatingExpenses + costOfSales;
  }

  return operatingExpenses ?? costOfSales ?? null;
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

function isCashFlowSnapshotReportType(reportType: string): boolean {
  return [
    "cash_flow",
    "cash-flow",
    "financial_statement",
  ].some((keyword) => reportType.includes(keyword));
}

function isBalanceSheetSnapshotReportType(reportType: string): boolean {
  return [
    "balance_sheet",
    "statement_of_financial_position",
    "financial_position",
  ].some((keyword) => reportType.includes(keyword));
}

function summarizeFinancialSnapshot(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  const reportType = normalizeReportType(String(frontmatter.report_type ?? frontmatter.type ?? ""));
  const lineCandidates = collectMetricCandidates(frontmatter);

  for (const [key, value] of Object.entries(frontmatter)) {
    if (HEAVY_FRONTMATTER_KEYS.has(key)) continue;
    summary[key] = value;
  }

  if (frontmatter.line_items !== undefined) {
    summary.raw_line_items_omitted = true;
    if (summary.line_item_count === undefined && Array.isArray(frontmatter.line_items)) {
      summary.line_item_count = frontmatter.line_items.length;
    }
  }

  const revenue = isIncomeSnapshotReportType(reportType)
    ? selectMetricCandidate(lineCandidates, scoreRevenueCandidate) ??
      readMetric(summary, ["revenue", "total_revenue", "sales", "income"])
    : readMetric(summary, ["revenue", "total_revenue", "sales", "income"]);
  const operatingExpenses = isIncomeSnapshotReportType(reportType)
    ? selectMetricCandidate(lineCandidates, scoreOperatingExpensesCandidate) ??
      readMetric(summary, ["operating_expenses", "total_expenses", "expenses"])
    : readMetric(summary, ["operating_expenses", "total_expenses", "expenses"]);
  const costOfSales = isIncomeSnapshotReportType(reportType)
    ? selectMetricCandidate(lineCandidates, scoreCostOfSalesCandidate) ??
      readMetric(summary, ["cost_of_sales", "cost_of_revenue", "cogs"])
    : readMetric(summary, ["cost_of_sales", "cost_of_revenue", "cogs"]);
  const netIncome = isIncomeSnapshotReportType(reportType)
    ? selectMetricCandidate(lineCandidates, scoreNetIncomeCandidate) ??
      readMetric(summary, ["net_income", "net_profit", "profit"])
    : readMetric(summary, ["net_income", "net_profit", "profit"]);
  const grossProfit = isIncomeSnapshotReportType(reportType)
    ? selectMetricCandidate(lineCandidates, scoreGrossProfitCandidate) ??
      readMetric(summary, ["gross_profit", "gross_income"])
    : readMetric(summary, ["gross_profit", "gross_income"]);
  const normalizedOperatingExpenses = isIncomeSnapshotReportType(reportType)
    ? normalizeExpenseMagnitude(operatingExpenses)
    : operatingExpenses;
  const normalizedCostOfSales = isIncomeSnapshotReportType(reportType)
    ? normalizeExpenseMagnitude(costOfSales)
    : costOfSales;
  const expenses = combineExpenses(
    revenue,
    normalizedOperatingExpenses,
    normalizedCostOfSales,
    netIncome,
  );
  const cashPosition = (
    (isCashFlowSnapshotReportType(reportType) || isBalanceSheetSnapshotReportType(reportType))
      ? selectMetricCandidate(lineCandidates, scoreCashCandidate) ??
        readMetric(summary, [
          "cash_position",
          "ending_balance",
          "cash_balance",
          "ending_cash",
        ])
      : readMetric(summary, [
          "cash_position",
          "ending_balance",
          "cash_balance",
          "ending_cash",
        ])
  );
  const runway =
    readMetric(summary, ["runway_months", "cash_runway_months", "runway"]);

  const summaryMetrics: Record<string, number> = {};
  if (revenue !== null) {
    summaryMetrics.revenue = revenue;
    summary.revenue = revenue;
  }
  if (expenses !== null) {
    summaryMetrics.expenses = expenses;
    summary.expenses = expenses;
  }
  if (normalizedOperatingExpenses !== null) {
    summaryMetrics.operating_expenses = normalizedOperatingExpenses;
    summary.operating_expenses = normalizedOperatingExpenses;
  }
  if (normalizedCostOfSales !== null) {
    summaryMetrics.cost_of_sales = normalizedCostOfSales;
    summary.cost_of_sales = normalizedCostOfSales;
  }
  if (grossProfit !== null) {
    summaryMetrics.gross_profit = grossProfit;
    summary.gross_profit = grossProfit;
  }
  if (netIncome !== null) {
    summaryMetrics.net_income = netIncome;
    summary.net_income = netIncome;
  }
  if (cashPosition !== null) {
    summaryMetrics.cash_position = cashPosition;
    summary.cash_position = cashPosition;
    summary.ending_balance = cashPosition;
  }
  if (runway !== null) {
    summaryMetrics.runway_months = runway;
    summary.runway_months = runway;
  }

  if (Object.keys(summaryMetrics).length > 0) {
    summary.summary_metrics = summaryMetrics;
  }

  return summary;
}

function applyEntityView(entity: EntityResult, view: EntityView = "full"): EntityResult {
  if (view !== "summary") return entity;

  if (entity.type === "financial_snapshot") {
    return {
      ...entity,
      frontmatter: summarizeFinancialSnapshot(entity.frontmatter),
    };
  }

  if (entity.type === "document_import") {
    return {
      ...entity,
      frontmatter: summarizeDocumentImport(entity.frontmatter),
    };
  }

  const summaryFrontmatter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity.frontmatter)) {
    if (HEAVY_FRONTMATTER_KEYS.has(key)) continue;
    summaryFrontmatter[key] = value;
  }

  return {
    ...entity,
    frontmatter: summaryFrontmatter,
  };
}

// ---------------------------------------------------------------------------
// queryEntities
// ---------------------------------------------------------------------------

/**
 * Query entities with optional filters on domain, type, and status.
 * Supports pagination via limit (default 100) and offset (default 0).
 */
export function queryEntities(
  db: Database.Database,
  filters: QueryFilters
): EntityResult[] {
  const view = filters.view ?? "full";
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.type === undefined) {
    conditions.push(
      `type NOT IN (${Array.from(DEFAULT_EXCLUDED_TYPES)
        .map((_, index) => `@excludedType${index}`)
        .join(", ")})`,
    );
    Array.from(DEFAULT_EXCLUDED_TYPES).forEach((type, index) => {
      params[`excludedType${index}`] = type;
    });
  }

  if (filters.domain !== undefined) {
    conditions.push("domain = @domain");
    params.domain = filters.domain;
  }

  if (filters.type !== undefined) {
    conditions.push("type = @type");
    params.type = filters.type;
  }

  if (filters.status !== undefined) {
    conditions.push("status = @status");
    params.status = filters.status;
  }
  if (filters.documentId !== undefined) {
    conditions.push("json_extract(frontmatter, '$.document_id') = @documentId");
    params.documentId = filters.documentId;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  const sql = `
    SELECT qualified_id, type, domain, file_path, frontmatter, title, status, created_at, updated_at
    FROM entities
    ${whereClause}
    ORDER BY qualified_id
    LIMIT @limit OFFSET @offset
  `;

  params.limit = limit;
  params.offset = offset;

  const rows = db.prepare(sql).all(params) as Array<Record<string, unknown>>;
  return rows.map((row) => applyEntityView(rowToResult(row), view));
}

// ---------------------------------------------------------------------------
// getEntity
// ---------------------------------------------------------------------------

/**
 * Get a single entity by its qualified ID.
 * Returns null if not found.
 */
export function getEntity(
  db: Database.Database,
  qualifiedId: string,
  view: EntityView = "full",
): EntityResult | null {
  const row = db
    .prepare(
      `SELECT qualified_id, type, domain, file_path, frontmatter, title, status, created_at, updated_at
       FROM entities
       WHERE qualified_id = ?`
    )
    .get(qualifiedId) as Record<string, unknown> | undefined;

  if (!row) return null;
  return applyEntityView(rowToResult(row), view);
}

// ---------------------------------------------------------------------------
// queryByRef
// ---------------------------------------------------------------------------

/**
 * Find all entities that the source entity references (via the refs table).
 * Joins refs.target_id -> entities.qualified_id for a given source_id.
 */
export function queryByRef(
  db: Database.Database,
  sourceId: string
): EntityResult[] {
  const rows = db
    .prepare(
      `SELECT e.qualified_id, e.type, e.domain, e.file_path, e.frontmatter, e.title, e.status, e.created_at, e.updated_at
       FROM refs r
       JOIN entities e ON e.qualified_id = r.target_id
       WHERE r.source_id = ?
       ORDER BY e.qualified_id`
    )
    .all(sourceId) as Array<Record<string, unknown>>;

  return rows.map(rowToResult);
}

// ---------------------------------------------------------------------------
// getEntityStats
// ---------------------------------------------------------------------------

export interface DomainStats {
  [domain: string]: number;
}

export interface EntityStats {
  totalEntities: number;
  domains: DomainStats;
}

/**
 * Count entities matching the given filters (without fetching data).
 * Used to detect truncation when a query uses LIMIT.
 */
export function countEntities(
  db: Database.Database,
  filters: Omit<QueryFilters, "limit" | "offset">,
): number {
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (filters.type === undefined) {
    conditions.push(
      `type NOT IN (${Array.from(DEFAULT_EXCLUDED_TYPES)
        .map((_, index) => `@excludedType${index}`)
        .join(", ")})`,
    );
    Array.from(DEFAULT_EXCLUDED_TYPES).forEach((type, index) => {
      params[`excludedType${index}`] = type;
    });
  }

  if (filters.domain !== undefined) {
    conditions.push("domain = @domain");
    params.domain = filters.domain;
  }
  if (filters.type !== undefined) {
    conditions.push("type = @type");
    params.type = filters.type;
  }
  if (filters.status !== undefined) {
    conditions.push("status = @status");
    params.status = filters.status;
  }
  if (filters.documentId !== undefined) {
    conditions.push("json_extract(frontmatter, '$.document_id') = @documentId");
    params.documentId = filters.documentId;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM entities ${whereClause}`).get(params) as { cnt: number };
  return row.cnt;
}

/**
 * Get aggregate entity statistics: total count and per-domain breakdown.
 */
export function getEntityStats(db: Database.Database): EntityStats {
  const rows = db
    .prepare("SELECT domain, COUNT(*) as count FROM entities GROUP BY domain")
    .all() as Array<{ domain: string; count: number }>;

  const domains: DomainStats = {};
  let totalEntities = 0;

  for (const row of rows) {
    domains[row.domain] = row.count;
    totalEntities += row.count;
  }

  return { totalEntities, domains };
}

// ---------------------------------------------------------------------------
// searchFullText
// ---------------------------------------------------------------------------

/**
 * Sanitize user input for FTS5 MATCH.
 *
 * FTS5 special syntax characters (-, :, *, OR, AND, NOT, NEAR, etc.) can
 * cause SQLITE_ERROR when passed raw. We wrap each whitespace-delimited
 * token in double quotes so they're treated as literal terms, and escape
 * any embedded double quotes.
 */
function sanitizeFts5Query(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '""';

  return trimmed
    .split(/\s+/)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" ");
}

const FINANCE_SEARCH_TERMS = [
  "finance",
  "financial",
  "revenue",
  "profit",
  "net income",
  "gross profit",
  "expenses",
  "expense",
  "p&l",
  "pnl",
  "profit and loss",
  "balance sheet",
  "cash flow",
  "cash position",
  "liabilities",
  "equity",
  "assets",
  "forecast",
  "projection",
  "budget",
  "plan",
];

const FINANCE_PROJECTION_TERMS = [
  "forecast",
  "projection",
  "budget",
  "plan",
  "planned",
  "target",
];

const FINANCE_PNL_TERMS = [
  "p&l",
  "pnl",
  "profit and loss",
  "revenue",
  "gross profit",
  "net income",
  "ebitda",
  "opex",
  "cogs",
  "expenses",
];

const FINANCE_BALANCE_SHEET_TERMS = [
  "balance sheet",
  "assets",
  "liabilities",
  "equity",
  "retained earnings",
  "cash position",
];

const FINANCE_CASH_FLOW_TERMS = [
  "cash flow",
  "runway",
  "burn",
  "operating cash",
  "closing cash",
  "net cash",
];

const MONTH_NAME_TO_NUMBER: Record<string, string> = {
  january: "01",
  jan: "01",
  february: "02",
  feb: "02",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  may: "05",
  june: "06",
  jun: "06",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  sept: "09",
  october: "10",
  oct: "10",
  november: "11",
  nov: "11",
  december: "12",
  dec: "12",
};

interface FinanceSearchIntent {
  isFinance: boolean;
  wantsProjection: boolean;
  wantsPnl: boolean;
  wantsBalanceSheet: boolean;
  wantsCashFlow: boolean;
  prefersStatementSummary: boolean;
  broadFinance: boolean;
  requestedPeriods: Set<string>;
}

const EXPLICIT_PNL_STATEMENT_TERMS = ["p&l", "pnl", "profit and loss"] as const;
const EXPLICIT_BALANCE_SHEET_TERMS = ["balance sheet"] as const;
const EXPLICIT_CASH_FLOW_TERMS = ["cash flow"] as const;

function normalizeSearchText(value: string): string {
  return ` ${value.trim().toLowerCase().replace(/\s+/g, " ")} `;
}

function includesAnyTerm(normalizedQuery: string, terms: readonly string[]): boolean {
  return terms.some((term) => normalizedQuery.includes(` ${term} `));
}

function extractRequestedPeriods(query: string): Set<string> {
  const periods = new Set<string>();
  const normalized = query.toLowerCase();

  for (const match of normalized.matchAll(/\b(20\d{2})[-/](0[1-9]|1[0-2])\b/g)) {
    periods.add(`${match[1]}-${match[2]}`);
  }

  for (const match of normalized.matchAll(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\s+(20\d{2})\b/g,
  )) {
    const month = MONTH_NAME_TO_NUMBER[match[1]];
    if (month) {
      periods.add(`${match[2]}-${month}`);
    }
  }

  return periods;
}

function classifyFinanceSearchIntent(query: string): FinanceSearchIntent {
  const normalized = normalizeSearchText(query);
  const requestedPeriods = extractRequestedPeriods(query);
  const wantsProjection = includesAnyTerm(normalized, FINANCE_PROJECTION_TERMS);
  const wantsPnl = includesAnyTerm(normalized, FINANCE_PNL_TERMS);
  const wantsBalanceSheet = includesAnyTerm(normalized, FINANCE_BALANCE_SHEET_TERMS);
  const wantsCashFlow = includesAnyTerm(normalized, FINANCE_CASH_FLOW_TERMS);
  const prefersStatementSummary =
    includesAnyTerm(normalized, EXPLICIT_PNL_STATEMENT_TERMS) ||
    includesAnyTerm(normalized, EXPLICIT_BALANCE_SHEET_TERMS) ||
    includesAnyTerm(normalized, EXPLICIT_CASH_FLOW_TERMS);
  const isFinance =
    wantsProjection ||
    wantsPnl ||
    wantsBalanceSheet ||
    wantsCashFlow ||
    includesAnyTerm(normalized, FINANCE_SEARCH_TERMS);

  return {
    isFinance,
    wantsProjection,
    wantsPnl,
    wantsBalanceSheet,
    wantsCashFlow,
    prefersStatementSummary,
    broadFinance: isFinance && requestedPeriods.size === 0,
    requestedPeriods,
  };
}

function getFrontmatterString(
  result: EntityResult,
  key: string,
): string | null {
  const value = result.frontmatter[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getCanonicalFamily(result: EntityResult): string | null {
  return getFrontmatterString(result, "canonical_family");
}

function isFinanceDomainSummary(result: EntityResult): boolean {
  return result.filePath === "finance/_summary.qmd";
}

function isFinanceStatementsSummary(result: EntityResult): boolean {
  return result.filePath === "finance/statements/_summary.qmd";
}

function isFinanceProjectionsSummary(result: EntityResult): boolean {
  return result.filePath === "finance/projections/_summary.qmd";
}

function isFinanceSummary(result: EntityResult): boolean {
  return (
    isFinanceDomainSummary(result) ||
    isFinanceStatementsSummary(result) ||
    isFinanceProjectionsSummary(result)
  );
}

function isCanonicalActualStatement(result: EntityResult): boolean {
  const family = getCanonicalFamily(result);
  return (
    family === "pnl_month" ||
    family === "balance_sheet_month" ||
    family === "cash_flow_month"
  );
}

function isCanonicalProjection(result: EntityResult): boolean {
  return getCanonicalFamily(result) === "financial_projection_plan";
}

function matchesRequestedPeriod(result: EntityResult, requestedPeriods: Set<string>): boolean {
  if (requestedPeriods.size === 0) return false;
  const period =
    getFrontmatterString(result, "period_key") ??
    getFrontmatterString(result, "period");
  return period !== null && requestedPeriods.has(period);
}

function matchesRequestedFinanceFamily(result: EntityResult, intent: FinanceSearchIntent): boolean {
  const family = getCanonicalFamily(result);
  if (!family) return false;

  if (intent.wantsProjection) {
    return family === "financial_projection_plan";
  }

  if (intent.wantsBalanceSheet) {
    return family === "balance_sheet_month";
  }

  if (intent.wantsCashFlow) {
    return family === "cash_flow_month";
  }

  if (intent.wantsPnl) {
    return family === "pnl_month";
  }

  return false;
}

function financeRetrievalBoost(result: EntityResult, intent: FinanceSearchIntent): number {
  if (!intent.isFinance) return 0;

  if (
    result.domain !== "finance" &&
    result.domain !== "banking" &&
    result.domain !== "revenue" &&
    result.domain !== "expenses"
  ) {
    if (
      result.type === "document_import" ||
      result.type === "document_import_manifest" ||
      result.type === "document_import_unit"
    ) {
      return -250;
    }
    return 0;
  }

  if (result.domain !== "finance") return 0;

  const hasRequestedPeriod = intent.requestedPeriods.size > 0;
  const matchesPeriod = matchesRequestedPeriod(result, intent.requestedPeriods);
  const matchesFamily = matchesRequestedFinanceFamily(result, intent);

  if (hasRequestedPeriod) {
    if (matchesPeriod && matchesFamily) return 1600;
    if (matchesPeriod && isCanonicalActualStatement(result)) return 1450;
    if (matchesPeriod && isCanonicalProjection(result)) return intent.wantsProjection ? 1450 : 900;
    if (isFinanceStatementsSummary(result)) return intent.wantsProjection ? 500 : 850;
    if (isFinanceProjectionsSummary(result)) return intent.wantsProjection ? 850 : 500;
    if (isFinanceDomainSummary(result)) return 780;
    if (matchesFamily && isCanonicalActualStatement(result)) return 700;
    if (matchesFamily && isCanonicalProjection(result)) return 650;
    return 0;
  }

  if (intent.wantsProjection) {
    if (isFinanceProjectionsSummary(result)) return 1500;
    if (isFinanceDomainSummary(result)) return 1300;
    if (isCanonicalProjection(result)) return 1100;
    if (isFinanceStatementsSummary(result)) return 700;
    if (isCanonicalActualStatement(result)) return 350;
    return 0;
  }

  if (intent.broadFinance) {
    if (intent.prefersStatementSummary) {
      if (isFinanceStatementsSummary(result)) return 1500;
      if (isFinanceDomainSummary(result)) return 1400;
    } else {
      if (isFinanceDomainSummary(result)) return 1500;
      if (isFinanceStatementsSummary(result)) return 1400;
    }
    if (isCanonicalActualStatement(result) && matchesFamily) return 1100;
    if (isCanonicalActualStatement(result)) return 950;
    if (isFinanceProjectionsSummary(result)) return 750;
    if (isCanonicalProjection(result)) return 500;
    return 0;
  }

  if (isFinanceStatementsSummary(result)) return 1250;
  if (isFinanceDomainSummary(result)) return 1200;
  if (matchesFamily && isCanonicalActualStatement(result)) return 1050;
  if (isCanonicalActualStatement(result)) return 850;
  if (isFinanceProjectionsSummary(result)) return 700;
  if (isCanonicalProjection(result)) return 450;
  return 0;
}

function rerankFinanceSearchResults(
  results: EntityResult[],
  query: string,
): EntityResult[] {
  const intent = classifyFinanceSearchIntent(query);
  if (!intent.isFinance) return results;

  return results
    .map((result, index) => ({
      result,
      index,
      boost: financeRetrievalBoost(result, intent),
    }))
    .sort((left, right) => {
      if (right.boost !== left.boost) return right.boost - left.boost;
      return left.index - right.index;
    })
    .map((entry) => entry.result);
}

function loadSupplementalFinanceCandidates(
  db: Database.Database,
  intent: FinanceSearchIntent,
  limit: number,
  view: EntityView,
): EntityResult[] {
  const excludedTypes = Array.from(DEFAULT_EXCLUDED_TYPES);
  const summaryPaths = [
    "finance/_summary.qmd",
    "finance/statements/_summary.qmd",
    "finance/projections/_summary.qmd",
  ];
  const summaryRows = db
    .prepare(
      `SELECT qualified_id, type, domain, file_path, frontmatter, title, status, created_at, updated_at
       FROM entities
       WHERE file_path IN (${summaryPaths.map(() => "?").join(", ")})
         AND type NOT IN (${excludedTypes.map(() => "?").join(", ")})`
    )
    .all(...summaryPaths, ...excludedTypes) as Array<Record<string, unknown>>;

  const generalParams: Array<string | number> = [...excludedTypes];
  const generalWhereParts = [
    "domain = 'finance'",
    `type NOT IN (${excludedTypes.map(() => "?").join(", ")})`,
  ];

  if (intent.requestedPeriods.size > 0) {
    const periodConditions = Array.from(intent.requestedPeriods).map(
      () => "(json_extract(frontmatter, '$.period') = ? OR json_extract(frontmatter, '$.period_key') = ?)",
    );
    generalWhereParts.push(`(${periodConditions.join(" OR ")})`);
    for (const period of intent.requestedPeriods) {
      generalParams.push(period, period);
    }
  }

  generalParams.push(Math.max(limit, intent.requestedPeriods.size > 0 ? 32 : 120));

  const generalRows = db
    .prepare(
      `SELECT qualified_id, type, domain, file_path, frontmatter, title, status, created_at, updated_at
       FROM entities
       WHERE ${generalWhereParts.join(" AND ")}
       ORDER BY updated_at DESC, created_at DESC, qualified_id
       LIMIT ?`
    )
    .all(...generalParams) as Array<Record<string, unknown>>;

  const familyFilters: string[] = [];
  if (intent.wantsPnl) familyFilters.push("pnl_month");
  if (intent.wantsBalanceSheet) familyFilters.push("balance_sheet_month");
  if (intent.wantsCashFlow) familyFilters.push("cash_flow_month");
  if (intent.wantsProjection) familyFilters.push("financial_projection_plan");

  const familyRows =
    familyFilters.length > 0
      ? (db
          .prepare(
            `SELECT qualified_id, type, domain, file_path, frontmatter, title, status, created_at, updated_at
             FROM entities
             WHERE domain = 'finance'
               AND type NOT IN (${excludedTypes.map(() => "?").join(", ")})
               AND json_extract(frontmatter, '$.canonical_family') IN (${familyFilters.map(() => "?").join(", ")})
             ORDER BY updated_at DESC, created_at DESC, qualified_id
             LIMIT ?`
          )
          .all(
            ...excludedTypes,
            ...familyFilters,
            Math.max(limit, 24),
          ) as Array<Record<string, unknown>>)
      : [];

  const merged = new Map<string, EntityResult>();
  for (const row of [...summaryRows, ...familyRows, ...generalRows]) {
    const result = applyEntityView(rowToResult(row), view);
    if (!merged.has(result.qualifiedId)) {
      merged.set(result.qualifiedId, result);
    }
  }

  return Array.from(merged.values());
}

/**
 * Full-text search using FTS5 MATCH.
 * Results are ranked by relevance (bm25). Default limit is 20.
 */
export function searchFullText(
  db: Database.Database,
  query: string,
  limit?: number,
  view: EntityView = "full",
  domain?: string,
): EntityResult[] {
  const effectiveLimit = limit ?? 20;
  const safeQuery = sanitizeFts5Query(query);
  const financeIntent = classifyFinanceSearchIntent(query);
  const candidateLimit = financeIntent.isFinance
    ? Math.min(Math.max(effectiveLimit * 8, 50), 200)
    : effectiveLimit;

  const domainFilter = domain?.trim().toLowerCase();
  const excludedTypePlaceholders = Array.from(DEFAULT_EXCLUDED_TYPES).map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT e.qualified_id, e.type, e.domain, e.file_path, e.frontmatter, e.title, e.status, e.created_at, e.updated_at
       FROM entities_fts fts
       JOIN entities e ON e.qualified_id = fts.qualified_id
       WHERE entities_fts MATCH ?
         AND e.type NOT IN (${excludedTypePlaceholders})
         ${domainFilter ? "AND e.domain = ?" : ""}
       ORDER BY rank
       LIMIT ?`
    )
    .all(
      safeQuery,
      ...Array.from(DEFAULT_EXCLUDED_TYPES),
      ...(domainFilter ? [domainFilter] : []),
      candidateLimit,
    ) as Array<Record<string, unknown>>;

  const lexicalResults = rows.map((row) => applyEntityView(rowToResult(row), view));
  const mergedResults =
    financeIntent.isFinance && (!domainFilter || domainFilter === "finance")
      ? (() => {
          const supplemental = loadSupplementalFinanceCandidates(db, financeIntent, candidateLimit, view);
          const merged = new Map<string, EntityResult>();
          for (const result of lexicalResults) {
            merged.set(result.qualifiedId, result);
          }
          for (const result of supplemental) {
            if (!merged.has(result.qualifiedId)) {
              merged.set(result.qualifiedId, result);
            }
          }
          return Array.from(merged.values());
        })()
      : lexicalResults;

  const ranked = rerankFinanceSearchResults(mergedResults, query);

  return ranked.slice(0, effectiveLimit);
}
