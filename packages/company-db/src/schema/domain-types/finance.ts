import type { BaseEntity, MoneyAmount, PostingStatus, PeriodStatus } from "./common.js";

export interface Account extends BaseEntity {
  type: "account";
  number: string;
  name: string;
  category: "asset" | "liability" | "equity" | "revenue" | "expense";
  sub_category?: string;
  normal_balance: "debit" | "credit";
  is_active: boolean;
  parent_account?: string;
  currency?: string;
}

export interface JournalEntryLine {
  account_id: string;
  debit?: number;
  credit?: number;
  description?: string;
  ref?: string;
  currency?: string;
  fx_rate?: number;
}

export interface JournalEntry extends BaseEntity {
  type: "journal_entry";
  date: string;
  period: string;
  description: string;
  lines: JournalEntryLine[];
  status: PostingStatus;
  source?: string;
  source_ref?: string;
  posted_by?: string;
  posted_at?: string;
  reversing_entry?: string;
  tags?: string[];
}

export interface PeriodClose extends BaseEntity {
  type: "period_close";
  period: string;
  status: PeriodStatus;
  closed_by?: string;
  closed_at?: string;
  hard_closed_by?: string;
  hard_closed_at?: string;
  notes?: string;
}

export interface IncomeStatement extends BaseEntity {
  type: "income_statement";
  period: string;
  revenue: MoneyAmount;
  cost_of_revenue: MoneyAmount;
  gross_profit: MoneyAmount;
  operating_expenses: MoneyAmount;
  operating_income: MoneyAmount;
  net_income: MoneyAmount;
  currency: string;
}

export interface BalanceSheet extends BaseEntity {
  type: "balance_sheet";
  period: string;
  total_assets: MoneyAmount;
  total_liabilities: MoneyAmount;
  total_equity: MoneyAmount;
  currency: string;
}

export interface CashFlowStatement extends BaseEntity {
  type: "cash_flow_statement";
  period: string;
  operating: MoneyAmount;
  investing: MoneyAmount;
  financing: MoneyAmount;
  net_change: MoneyAmount;
  currency: string;
}

export interface Forecast extends BaseEntity {
  type: "forecast";
  year: string;
  scenario: "base" | "bull" | "bear";
  revenue_projection: MoneyAmount;
  expense_projection: MoneyAmount;
  cash_runway_months?: number;
}

export interface FinancialSnapshotLineItem {
  account_name: string;
  account_number?: string;
  section: string;
  subsection?: string;
  values: Record<string, number | null>;
  depth: number;
  is_total: boolean;
}

export interface FinancialSnapshot extends BaseEntity {
  type: "financial_snapshot";
  report_type: "profit_and_loss" | "balance_sheet" | "trial_balance" | "general_ledger" | "financial_statement";
  /** Legacy compatibility period field; canonical consumers should use period_key/start/end/label. */
  period: string;
  period_key?: string;
  period_start?: string;
  period_end?: string;
  period_label?: string;
  reporting_period?: {
    start: string;
    end: string;
    label?: string | null;
  };
  book: "actual" | "budget" | "forecast";
  currency: string;
  entity?: string;
  department?: string;
  line_items?: FinancialSnapshotLineItem[];
  line_items_embedded?: boolean;
  line_items_location?: "frontmatter" | "body";
  summary_metrics?: {
    revenue?: number;
    expenses?: number;
    operating_expenses?: number;
    cost_of_sales?: number;
    gross_profit?: number;
    net_income?: number;
    cash_position?: number;
    runway_months?: number;
  };
  derived_metrics?: Record<string, number>;
  cell_lineage?: {
    source_sheet: string;
    source_row_range: string;
    line_count: number;
  };
}
