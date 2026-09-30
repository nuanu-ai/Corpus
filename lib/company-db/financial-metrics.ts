type NumericRecord = Record<string, unknown>;

export type SnapshotLineItemLike = {
  account_name?: unknown;
  section?: unknown;
  subsection?: unknown;
  values?: unknown;
  is_total?: unknown;
};

type TrialBalanceDerivedMetrics = {
  revenue: number | null;
  operatingExpenses: number | null;
  costOfSales: number | null;
  netIncome: number | null;
};

export type SnapshotStatementMetrics = {
  revenue: number | null;
  operating_expenses: number | null;
  cost_of_sales: number | null;
  expenses: number | null;
  net_income: number | null;
  gross_profit: number | null;
  cash_position: number | null;
  runway_months: number | null;
};

const LINE_ITEM_VALUE_KEY_PRIORITY = [
  "total",
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

const NON_AMOUNT_VALUE_KEYS = new Set([
  "account_code",
  "account_name",
  "account_number",
  "code",
  "row",
  "line",
  "note",
  "notes",
  "label",
  "description",
]);

function normalizeValueKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function compactMetricText(value: unknown): string {
  return normalizeMetricText(value).replace(/\s+/g, "");
}

function isPercentLikeValueKey(key: string): boolean {
  const normalized = normalizeValueKey(key);
  return (
    normalized.includes("percent") ||
    normalized.includes("pct") ||
    normalized.includes("margin") ||
    normalized.includes("ratio") ||
    normalized.includes("rate") ||
    key.includes("%")
  );
}

function getValueKeyPriority(key: string): number {
  const normalized = normalizeValueKey(key);
  const exactIndex = LINE_ITEM_VALUE_KEY_PRIORITY.findIndex((candidate) => normalized === candidate);
  if (exactIndex !== -1) {
    return exactIndex;
  }
  for (let index = 0; index < LINE_ITEM_VALUE_KEY_PRIORITY.length; index += 1) {
    if (normalized.includes(LINE_ITEM_VALUE_KEY_PRIORITY[index]!)) {
      return index + LINE_ITEM_VALUE_KEY_PRIORITY.length;
    }
  }
  return Number.POSITIVE_INFINITY;
}

function hasAny(text: string, candidates: string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}

function normalizeExpenseMagnitude(value: number | null): number | null {
  if (value === null) return null;
  return value < 0 ? Math.abs(value) : value;
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
    const metrics = derived as NumericRecord;
    for (const key of keys) {
      const value = toNumber(metrics[key]);
      if (value !== null) return value;
    }
  }

  const summaryMetrics = frontmatter.summary_metrics;
  if (typeof summaryMetrics === "object" && summaryMetrics !== null) {
    const metrics = summaryMetrics as NumericRecord;
    for (const key of keys) {
      const value = toNumber(metrics[key]);
      if (value !== null) return value;
    }
  }

  return null;
}

function parseNumericFindingValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("%")) return null;

  const negative = /\b(loss|negative)\b/i.test(trimmed) || /^\(.*\)$/.test(trimmed);
  const match = trimmed.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0].replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return negative && parsed > 0 ? -parsed : parsed;
}

function readToplineFindingMetric(
  frontmatter: Record<string, unknown>,
  options: {
    include: string[];
    exclude?: string[];
    negativeIfLabelIncludes?: string[];
  },
): number | null {
  const raw = frontmatter.topline_findings;
  if (!Array.isArray(raw)) return null;

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const label = normalizeMetricText((item as NumericRecord).label);
    const value = String((item as NumericRecord).value ?? "").trim();
    if (!label || !value) continue;
    if (!hasAny(label, options.include)) continue;
    if (options.exclude && hasAny(label, options.exclude)) continue;

    const parsed = parseNumericFindingValue(value);
    if (parsed === null) continue;
    if (options.negativeIfLabelIncludes && hasAny(label, options.negativeIfLabelIncludes) && parsed > 0) {
      return -parsed;
    }
    return parsed;
  }

  return null;
}

function getLineItemValue(values: unknown): number | null {
  if (typeof values !== "object" || values === null) return null;

  const candidates = Object.entries(values as NumericRecord)
    .map(([key, raw]) => ({
      key,
      normalizedKey: normalizeValueKey(key),
      value: toNumber(raw),
      priority: getValueKeyPriority(key),
      isPercentLike: isPercentLikeValueKey(key),
    }))
    .filter(
      (entry): entry is {
        key: string;
        normalizedKey: string;
        value: number;
        priority: number;
        isPercentLike: boolean;
      } => entry.value !== null,
    );

  if (candidates.length === 0) return null;

  const amountCandidates = candidates.filter(
    (entry) => !entry.isPercentLike && !NON_AMOUNT_VALUE_KEYS.has(entry.normalizedKey),
  );
  const meaningfulCandidates = amountCandidates.filter((entry) => entry.value !== 0);
  const prioritizedPool = meaningfulCandidates.length > 0 ? meaningfulCandidates : amountCandidates;

  const totalCandidate = prioritizedPool.find((entry) => entry.normalizedKey === "total");
  if (totalCandidate) return totalCandidate.value;

  const prioritized = prioritizedPool
    .filter((entry) => Number.isFinite(entry.priority))
    .sort((a, b) => a.priority - b.priority)[0];
  if (prioritized) return prioritized.value;

  const periodCandidates = prioritizedPool
    .map((entry) => {
      const match = entry.normalizedKey.match(/^period_(\d+)$/);
      return match ? { index: Number(match[1]), value: entry.value } : null;
    })
    .filter((entry): entry is { index: number; value: number } => entry !== null)
    .sort((left, right) => right.index - left.index);
  if (periodCandidates.length > 0) {
    return periodCandidates[0]!.value;
  }

  if (prioritizedPool.length === 1) {
    return prioritizedPool[0]?.value ?? null;
  }

  return null;
}

type MetricCandidate = {
  value: number;
  account: string;
  accountCompact: string;
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
    const item = raw as SnapshotLineItemLike;
    const value = getLineItemValue(item.values);
    if (value === null) continue;

    const account = normalizeMetricText(item.account_name);
    const section = normalizeMetricText(item.section);
    const subsection = normalizeMetricText(item.subsection);
    const text = `${account} ${section} ${subsection}`.trim();

    candidates.push({
      value,
      account,
      accountCompact: compactMetricText(item.account_name),
      section,
      subsection,
      text,
      isTotal:
        Boolean(item.is_total) ||
        /\b(total|net)\b/.test(account),
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

function getTrialBalanceDebit(values: unknown): number {
  if (typeof values !== "object" || values === null) return 0;
  return toNumber((values as NumericRecord).debit) ?? 0;
}

function getTrialBalanceCredit(values: unknown): number {
  if (typeof values !== "object" || values === null) return 0;
  return toNumber((values as NumericRecord).credit) ?? 0;
}

function extractTrialBalanceAccountClass(
  accountName: unknown,
  values: unknown,
): string | null {
  if (typeof values === "object" && values !== null) {
    const rawAccountCode = (values as NumericRecord).account_code;
    const normalizedCode = String(rawAccountCode ?? "")
      .trim()
      .replace(/[^A-Za-z0-9]/g, "");
    const codeMatch = normalizedCode.match(/(\d{2,})/);
    if (codeMatch?.[1]) return codeMatch[1][0] ?? null;
  }

  const compact = compactMetricText(accountName);
  const accountMatch = compact.match(/[a-z]+(\d{2,})/i) ?? compact.match(/(\d{2,})/);
  return accountMatch?.[1]?.[0] ?? null;
}

function isIncomeLikeTrialBalanceCandidate(candidate: MetricCandidate): boolean {
  if (candidate.isTotal) return false;
  const accountClass = extractTrialBalanceAccountClass(candidate.accountCompact, null);
  if (
    hasAny(candidate.text, [
      "retained earning",
      "retained earnings",
      "current year earning",
      "current year earnings",
      "unallocated earning",
      "capital",
      "equity",
    ])
  ) {
    return false;
  }

  if (accountClass === "1" || accountClass === "2" || accountClass === "3") {
    return false;
  }

  if (accountClass === "4" || accountClass === "8") {
    return true;
  }

  if (
    hasAny(candidate.text, [
      "revenue",
      "sales",
      "income",
      "interest income",
      "other income",
      "gain",
    ])
  ) {
    return true;
  }

  return false;
}

function isCostOfSalesTrialBalanceCandidate(candidate: MetricCandidate): boolean {
  return hasAny(candidate.text, [
    "cost of sales",
    "cost of revenue",
    "cost of fb",
    "cost of food",
    "cost of beverage",
    "cost of goods sold",
    "cogs",
  ]);
}

function isExpenseLikeTrialBalanceCandidate(candidate: MetricCandidate): boolean {
  if (candidate.isTotal) return false;
  if (isCostOfSalesTrialBalanceCandidate(candidate)) return true;
  const accountClass = extractTrialBalanceAccountClass(candidate.accountCompact, null);
  if (accountClass === "1" || accountClass === "2" || accountClass === "3" || accountClass === "4" || accountClass === "8") {
    return false;
  }
  if (accountClass === "5" || accountClass === "6" || accountClass === "7" || accountClass === "9") {
    return true;
  }
  const explicitExpenseSignal = hasAny(candidate.text, [
    "expense",
    "allowance",
    "salary",
    "sallary",
    "wage",
    "payroll",
    "fee",
    "charges",
    "rental",
    "subscription",
    "depreciation",
    "depr",
    "advertising",
    "marketing",
    "entertainment",
    "transport",
    "fuel",
    "vat expense",
    "meal",
    "office",
    "printing",
    "postage",
    "consultant",
    "professional",
    "legal",
    "permit",
    "bank charges",
    "witholding tax",
    "withholding tax",
  ]);
  if (
    hasAny(candidate.text, [
      "payable",
      "receivable",
      "current liabilities",
      "liabilities",
      "equity",
      "capital",
      "loan",
      "deposit",
      "bank mandiri",
      "bank ocbc",
      "cash advance",
      "prepaid",
      "accounts payable",
      "security deposit",
      "clearing suspense",
    ]) &&
    !explicitExpenseSignal
  ) {
    return false;
  }
  if (
    explicitExpenseSignal
  ) {
    return true;
  }
  return false;
}

function deriveTrialBalanceMetrics(
  frontmatter: Record<string, unknown>,
  candidates: MetricCandidate[],
): TrialBalanceDerivedMetrics {
  const rawItems = Array.isArray(frontmatter.line_items) ? frontmatter.line_items : [];
  let incomeCredits = 0;
  let incomeNet = 0;
  let incomeSeen = false;
  let incomeNonZeroSeen = false;
  let expenseNet = 0;
  let expenseSeen = false;
  let expenseNonZeroSeen = false;
  let costOfSalesNet = 0;
  let costOfSalesSeen = false;
  let costOfSalesNonZeroSeen = false;

  rawItems.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null) return;
    const candidate = candidates[index];
    if (!candidate) return;

    const item = raw as SnapshotLineItemLike;
    const debit = getTrialBalanceDebit(item.values);
    const credit = getTrialBalanceCredit(item.values);

    if (isIncomeLikeTrialBalanceCandidate(candidate)) {
      incomeCredits += credit;
      incomeNet += credit - debit;
      incomeSeen = true;
      if (debit !== 0 || credit !== 0) {
        incomeNonZeroSeen = true;
      }
      return;
    }

    if (isExpenseLikeTrialBalanceCandidate(candidate)) {
      const amount = debit - credit;
      if (isCostOfSalesTrialBalanceCandidate(candidate)) {
        costOfSalesNet += amount;
        costOfSalesSeen = true;
        if (debit !== 0 || credit !== 0) {
          costOfSalesNonZeroSeen = true;
        }
      }
      expenseNet += amount;
      expenseSeen = true;
      if (debit !== 0 || credit !== 0) {
        expenseNonZeroSeen = true;
      }
    }
  });

  const revenue = incomeSeen && incomeNonZeroSeen ? Math.max(incomeCredits, 0) : null;
  const operatingExpenses = expenseSeen && expenseNonZeroSeen
    ? Math.max(expenseNet - (costOfSalesSeen ? costOfSalesNet : 0), 0)
    : null;
  const costOfSales =
    costOfSalesSeen && costOfSalesNonZeroSeen ? Math.max(costOfSalesNet, 0) : null;
  const netIncome =
    incomeNonZeroSeen || expenseNonZeroSeen ? incomeNet - expenseNet : null;

  return {
    revenue,
    operatingExpenses,
    costOfSales,
    netIncome,
  };
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

export function normalizeFinancialReportType(reportType: string): string {
  return reportType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isTrialBalanceSnapshotReportType(reportType: string): boolean {
  return [
    "trial_balance",
    "trialbalance",
  ].some((keyword) => reportType.includes(keyword));
}

export function isIncomeSnapshotReportType(reportType: string): boolean {
  return [
    "profit_and_loss",
    "income_statement",
    "pnl",
    "profit",
    "financial_statement",
    "trial_balance",
  ].some((keyword) => reportType.includes(keyword));
}

export function isCashFlowSnapshotReportType(reportType: string): boolean {
  return [
    "cash_flow",
    "cash-flow",
    "financial_statement",
  ].some((keyword) => reportType.includes(keyword));
}

export function isBalanceSheetSnapshotReportType(reportType: string): boolean {
  return [
    "balance_sheet",
    "statement_of_financial_position",
    "financial_position",
  ].some((keyword) => reportType.includes(keyword));
}

export function readFinancialMetric(
  frontmatter: Record<string, unknown>,
  keys: string[],
): number | null {
  return readMetric(frontmatter, keys);
}

export function extractSnapshotStatementMetrics(
  frontmatter: Record<string, unknown>,
  reportTypeInput?: string,
): SnapshotStatementMetrics {
  const reportType = normalizeFinancialReportType(
    reportTypeInput ?? String(frontmatter.report_type ?? frontmatter.type ?? ""),
  );
  const candidates = collectMetricCandidates(frontmatter);
  const incomeLike = isIncomeSnapshotReportType(reportType);
  const liquidityLike =
    isCashFlowSnapshotReportType(reportType) ||
    isBalanceSheetSnapshotReportType(reportType) ||
    isTrialBalanceSnapshotReportType(reportType);

  const lineRevenue = incomeLike ? selectMetricCandidate(candidates, scoreRevenueCandidate) : null;
  const lineCostOfSales = incomeLike ? selectMetricCandidate(candidates, scoreCostOfSalesCandidate) : null;
  const lineOperatingExpenses = incomeLike
    ? selectMetricCandidate(candidates, scoreOperatingExpensesCandidate)
    : null;
  const lineNetIncome = incomeLike ? selectMetricCandidate(candidates, scoreNetIncomeCandidate) : null;
  const lineGrossProfit = incomeLike ? selectMetricCandidate(candidates, scoreGrossProfitCandidate) : null;
  const lineCashPosition = liquidityLike ? selectMetricCandidate(candidates, scoreCashCandidate) : null;
  const trialBalanceDerived = isTrialBalanceSnapshotReportType(reportType)
    ? deriveTrialBalanceMetrics(frontmatter, candidates)
    : null;

  const revenue =
    trialBalanceDerived?.revenue ??
    lineRevenue ??
    readMetric(frontmatter, ["revenue", "total_revenue", "sales", "income"]) ??
    readToplineFindingMetric(frontmatter, {
      include: ["revenue", "sales"],
      exclude: ["budget", "occupancy", "arr", "adr", "revpar", "profit", "loss", "margin"],
    });
  const operatingExpenses =
    trialBalanceDerived?.operatingExpenses ??
    lineOperatingExpenses ??
    readMetric(frontmatter, ["operating_expenses", "total_expenses", "expenses"]) ??
    readToplineFindingMetric(frontmatter, {
      include: ["operating expenses", "opex", "total expenses", "expenses"],
      exclude: ["budget", "variance"],
    });
  const costOfSales =
    trialBalanceDerived?.costOfSales ??
    lineCostOfSales ??
    readMetric(frontmatter, ["cost_of_sales", "cost_of_revenue", "cogs"]) ??
    readToplineFindingMetric(frontmatter, {
      include: ["cost of sales", "cost of revenue", "cogs"],
      exclude: ["budget", "variance"],
    });
  const netIncome =
    trialBalanceDerived?.netIncome ??
    lineNetIncome ??
    readMetric(frontmatter, ["net_income", "net_profit", "profit"]) ??
    readToplineFindingMetric(frontmatter, {
      include: ["net income", "net profit", "net loss", "profit loss", "profit and loss", "loss"],
      exclude: ["gross profit", "gross loss", "budget", "margin"],
      negativeIfLabelIncludes: ["loss"],
    });
  const grossProfit =
    lineGrossProfit ??
    readMetric(frontmatter, ["gross_profit", "gross_income"]) ??
    readToplineFindingMetric(frontmatter, {
      include: ["gross profit"],
      exclude: ["budget", "margin"],
    });
  const cashPosition =
    lineCashPosition ??
    readMetric(frontmatter, [
      "cash_position",
      "ending_balance",
      "cash_balance",
      "ending_cash",
    ]) ??
    readToplineFindingMetric(frontmatter, {
      include: ["cash position", "cash and bank", "cash balance", "ending balance", "ending cash"],
      exclude: ["budget", "variance"],
    });
  const runwayMonths =
    readMetric(frontmatter, ["runway_months", "cash_runway_months", "runway"]) ??
    readToplineFindingMetric(frontmatter, {
      include: ["runway"],
      exclude: ["budget", "variance"],
    });
  const normalizedOperatingExpenses = incomeLike
    ? normalizeExpenseMagnitude(operatingExpenses)
    : operatingExpenses;
  const normalizedCostOfSales = incomeLike
    ? normalizeExpenseMagnitude(costOfSales)
    : costOfSales;
  const expenses = combineExpenses(
    revenue,
    normalizedOperatingExpenses,
    normalizedCostOfSales,
    netIncome,
  );
  const derivedGrossProfit =
    grossProfit ??
    (revenue !== null && normalizedCostOfSales !== null
      ? revenue - normalizedCostOfSales
      : null);
  const derivedNetIncome =
    netIncome ??
    (revenue !== null && expenses !== null ? revenue - expenses : null);

  return {
    revenue,
    operating_expenses: normalizedOperatingExpenses,
    cost_of_sales: normalizedCostOfSales,
    expenses,
    net_income: derivedNetIncome,
    gross_profit: derivedGrossProfit,
    cash_position: cashPosition,
    runway_months: runwayMonths,
  };
}
