export type CanonicalFinanceFamily =
  | "pnl_month"
  | "balance_sheet_month"
  | "cash_flow_month"
  | "projection_plan"
  | "metrics";

export type CanonicalMetricCadence =
  | "daily"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "unknown";

export interface CanonicalPeriod {
  start: string;
  end: string;
  label?: string;
}

export interface CanonicalSourceRef {
  sheetName: string;
  labelCell: string;
  valueCell: string;
  row: number;
  column: string;
  formula: string | null;
}

export interface CanonicalFinanceFact {
  key: string;
  label: string;
  value: number | null;
  rawValue: string | number | null;
  scenario: string;
  period: CanonicalPeriod;
  unit: "currency" | "count" | "percent" | "other";
  source: CanonicalSourceRef;
  confidence: number;
}

export interface CanonicalFinanceForm {
  family: CanonicalFinanceFamily;
  sheetName: string;
  entity: string;
  scopeKey: string;
  currency: string;
  cadence: CanonicalMetricCadence;
  period: CanonicalPeriod;
  facts: CanonicalFinanceFact[];
  sourceTabs: string[];
  supportingTabs: string[];
  notes: string[];
  needsReview: boolean;
}

export interface CanonicalFinanceWorkbookExtraction {
  fileName: string;
  entity: string;
  forms: CanonicalFinanceForm[];
  candidateTabs: string[];
  evidenceTabs: string[];
  warnings: string[];
}

export interface CanonicalFinanceParseOptions {
  fileName: string;
  sourcePath?: string | null;
  companyId?: string;
}

export type CanonicalFinanceRecordFamily =
  | "pnl_month"
  | "balance_sheet_month"
  | "cash_flow_month"
  | "financial_projection_plan"
  | "metrics_daily";

export type CanonicalFinanceClarificationKey =
  | "pnl_sheet_name"
  | "balance_sheet_sheet_name"
  | "cash_flow_sheet_name"
  | "projection_sheet_name"
  | "metrics_sheet_name";

export type CanonicalFinanceBook =
  | "actual"
  | "budget"
  | "forecast"
  | "projection";

export type CanonicalMetricUnit = "currency" | "count" | "percent";
export type CanonicalValueScale = "raw" | "thousands" | "millions";
export type CanonicalReviewStatus = "verified" | "review_pending";
export type CanonicalStatementLineKind =
  | "section"
  | "group"
  | "line_item"
  | "total";

export interface CanonicalFinanceSourceRef {
  file_name: string;
  sheet_name: string | null;
  cell_range: string | null;
  row_index?: number | null;
  formula?: string | null;
  note?: string | null;
}

export interface CanonicalFactCandidate {
  concept: string;
  raw_label: string;
  value: number | null;
  unit: CanonicalMetricUnit;
  scale: CanonicalValueScale;
  period_key: string;
  scope_key: string;
  source_ref: CanonicalFinanceSourceRef;
  confidence: number;
}

export interface CanonicalStatementLine {
  row_order: number;
  label: string;
  normalized_label: string;
  account_code: string | null;
  section_label: string | null;
  group_label: string | null;
  depth: number;
  line_kind: CanonicalStatementLineKind;
  value: number | null;
  source_ref: CanonicalFinanceSourceRef;
}

export interface CanonicalFinanceClarificationQuestion {
  key: CanonicalFinanceClarificationKey;
  family: CanonicalFinanceRecordFamily;
  label: string;
  prompt: string;
  reason: string;
  required: true;
  template_eligible: boolean;
  options: string[];
}

export interface CanonicalFinanceBaseRecord {
  family: CanonicalFinanceRecordFamily;
  period: CanonicalPeriod;
  period_key: string;
  revision_key?: string | null;
  currency: string | null;
  scale: CanonicalValueScale;
  scope_key: string;
  scope_label: string;
  company_wide: boolean;
  book: CanonicalFinanceBook;
  confidence: number;
  review_status: CanonicalReviewStatus;
  warnings: string[];
  source_document_name: string;
  source_refs: CanonicalFinanceSourceRef[];
}

export interface CanonicalPnlMonth extends CanonicalFinanceBaseRecord {
  family: "pnl_month";
  statement_lines: CanonicalStatementLine[];
  values: {
    revenue: number | null;
    cost_of_sales: number | null;
    gross_profit: number | null;
    other_income: number | null;
    other_expenses: number | null;
    operating_expenses: number | null;
    depreciation_amortization: number | null;
    ebitda: number | null;
    ebit: number | null;
    interest_expense: number | null;
    tax_expense: number | null;
    net_income: number | null;
  };
}

export interface CanonicalBalanceSheetMonth extends CanonicalFinanceBaseRecord {
  family: "balance_sheet_month";
  statement_lines: CanonicalStatementLine[];
  values: {
    cash_and_equivalents: number | null;
    accounts_receivable: number | null;
    inventory: number | null;
    other_current_assets: number | null;
    total_current_assets: number | null;
    fixed_assets: number | null;
    intangible_assets: number | null;
    other_non_current_assets: number | null;
    total_assets: number | null;
    accounts_payable: number | null;
    short_term_debt: number | null;
    other_current_liabilities: number | null;
    total_current_liabilities: number | null;
    long_term_debt: number | null;
    other_non_current_liabilities: number | null;
    total_liabilities: number | null;
    equity: number | null;
    retained_earnings: number | null;
  };
}

export interface CanonicalCashFlowMonth extends CanonicalFinanceBaseRecord {
  family: "cash_flow_month";
  statement_lines: CanonicalStatementLine[];
  values: {
    cash_from_operations: number | null;
    cash_from_investing: number | null;
    cash_from_financing: number | null;
    net_cash_flow: number | null;
    opening_cash: number | null;
    closing_cash: number | null;
  };
}

export interface CanonicalFinancialProjectionPlan extends CanonicalFinanceBaseRecord {
  family: "financial_projection_plan";
  scenario_key: string;
  plan_key: string;
  plan_status: "draft" | "working" | "approved";
  statement_lines: CanonicalStatementLine[];
  values: {
    revenue: number | null;
    cost_of_sales: number | null;
    gross_profit: number | null;
    operating_expenses: number | null;
    net_income: number | null;
  };
}

export interface CanonicalDailyMetricValue {
  metric_key: string;
  label: string;
  unit: CanonicalMetricUnit;
  value: number | null;
  source_ref: CanonicalFinanceSourceRef;
  confidence: number;
}

export interface CanonicalMetricsDaily extends CanonicalFinanceBaseRecord {
  family: "metrics_daily";
  template_key: string;
  metric_basis: Record<string, string>;
  metric_values: CanonicalDailyMetricValue[];
}

export type CanonicalFinanceRecord =
  | CanonicalPnlMonth
  | CanonicalBalanceSheetMonth
  | CanonicalCashFlowMonth
  | CanonicalFinancialProjectionPlan
  | CanonicalMetricsDaily;

export interface CanonicalFinanceBundle {
  records: CanonicalFinanceRecord[];
  warnings: string[];
  candidate_facts: CanonicalFactCandidate[];
  clarification_questions: CanonicalFinanceClarificationQuestion[];
}
