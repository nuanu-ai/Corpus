// ---------------------------------------------------------------------------
// Seed configs for synthetic example report formats
// ---------------------------------------------------------------------------
// Pre-built ReportConfig objects used by the public demo. They do not describe
// any real company or customer report layout.
// ---------------------------------------------------------------------------

import type { ReportConfig, ReportType } from "./report-types";

// ---- Example Northstar entity — P&L (IDR, section-based) ----

export const NORTHSTAR_PNL_CONFIG: ReportConfig = {
  report_type: "profit_and_loss",
  sheet_names: ["P&L", "Profit & Loss", "Income Statement", "P&L Statement"],
  extraction_type: "section",
  columns: {
    account_name: "A",
    actual: "B",
    budget: "C",
    variance: "D",
  },
  sections: {
    revenue: { start: "^\\s*(Revenue|Income|Sales)\\b", end: "^\\s*Total\\s+(Revenue|Income|Sales)" },
    cogs: { start: "^\\s*(Cost of (Sales|Goods Sold)|COGS)\\b", end: "^\\s*Total\\s+(Cost of (Sales|Goods Sold)|COGS)" },
    gross_profit: { start: "^\\s*Gross\\s+Profit\\b" },
    operating_expenses: { start: "^\\s*(Operating\\s+Expenses?|Expenses?)\\b", end: "^\\s*Total\\s+(Operating\\s+)?Expenses?" },
    other_income_expense: { start: "^\\s*Other\\s+(Income|Expense)", end: "^\\s*Total\\s+Other\\s+(Income|Expense)" },
    net_profit: { start: "^\\s*Net\\s+(Profit|Income|Loss)\\b" },
  },
  detection_rules: [
    { field: "sheet_name", pattern: "P&L|Profit.*Loss|Income\\s+Statement", weight: 0.9 },
    { field: "header_row", pattern: "Revenue|Income|Sales", weight: 0.7 },
    { field: "cell", pattern: "IDR|Rupiah", weight: 0.5 },
  ],
  book: "actual",
  currency: "IDR",
};

// ---- Example Northstar entity — Balance Sheet (IDR, section-based) ----

export const NORTHSTAR_BS_CONFIG: ReportConfig = {
  report_type: "balance_sheet",
  sheet_names: ["Balance Sheet", "BS", "Statement of Financial Position"],
  extraction_type: "section",
  columns: {
    account_name: "A",
    current_period: "B",
    prior_period: "C",
  },
  sections: {
    current_assets: { start: "^\\s*Current\\s+Assets\\b", end: "^\\s*Total\\s+Current\\s+Assets" },
    fixed_assets: { start: "^\\s*(Fixed|Non[- ]?Current)\\s+Assets\\b", end: "^\\s*Total\\s+(Fixed|Non[- ]?Current)\\s+Assets" },
    total_assets: { start: "^\\s*Total\\s+Assets\\b" },
    current_liabilities: { start: "^\\s*Current\\s+Liabilities\\b", end: "^\\s*Total\\s+Current\\s+Liabilities" },
    long_term_liabilities: { start: "^\\s*(Long[- ]?Term|Non[- ]?Current)\\s+Liabilities\\b", end: "^\\s*Total\\s+(Long[- ]?Term|Non[- ]?Current)\\s+Liabilities" },
    total_liabilities: { start: "^\\s*Total\\s+Liabilities\\b" },
    equity: { start: "^\\s*(Equity|Shareholders?[' ]?\\s*Equity)\\b", end: "^\\s*Total\\s+(Equity|Shareholders?[' ]?\\s*Equity)" },
  },
  detection_rules: [
    { field: "sheet_name", pattern: "Balance\\s+Sheet|\\bBS\\b|Financial\\s+Position", weight: 0.9 },
    { field: "header_row", pattern: "Assets|Liabilities|Equity", weight: 0.7 },
    { field: "cell", pattern: "IDR|Rupiah", weight: 0.5 },
  ],
  book: "actual",
  currency: "IDR",
};

// ---- Example Northstar entity — Trial Balance (IDR, tabular) ----

export const NORTHSTAR_TB_CONFIG: ReportConfig = {
  report_type: "trial_balance",
  sheet_names: ["Trial Balance", "TB"],
  extraction_type: "tabular",
  columns: {
    account_number: "A",
    account_name: "B",
    debit: "C",
    credit: "D",
  },
  detection_rules: [
    { field: "sheet_name", pattern: "Trial\\s+Balance|\\bTB\\b", weight: 0.9 },
    { field: "header_row", pattern: "Debit.*Credit|Account.*Number", weight: 0.7 },
    { field: "cell", pattern: "IDR|Rupiah", weight: 0.5 },
  ],
  book: "actual",
  currency: "IDR",
};

// ---- Aggregate exports ----

/** All seed configs for iteration / bulk seeding */
export const ALL_SEED_CONFIGS: ReportConfig[] = [
  NORTHSTAR_PNL_CONFIG,
  NORTHSTAR_BS_CONFIG,
  NORTHSTAR_TB_CONFIG,
];

// ---- Company slug -> config mapping ----

type CompanyConfigMap = Record<string, Partial<Record<ReportType, ReportConfig>>>;

const SEED_CONFIG_MAP: CompanyConfigMap = {
  "example-northstar": {
    profit_and_loss: NORTHSTAR_PNL_CONFIG,
    balance_sheet: NORTHSTAR_BS_CONFIG,
    trial_balance: NORTHSTAR_TB_CONFIG,
  },
};

/**
 * Look up a seed config by company slug and report type.
 * Returns the matching ReportConfig or null if no seed config exists.
 */
export function getSeedConfig(
  companySlug: string,
  reportType: ReportType,
): ReportConfig | null {
  const companyConfigs = SEED_CONFIG_MAP[companySlug];
  if (!companyConfigs) return null;
  return companyConfigs[reportType] ?? null;
}
