import type { Account } from "../../schema/domain-types/finance.js";
import { writeQmd } from "../../qmd/writer.js";

// ── Account category ranges ────────────────────────────────────────────
// Standard GAAP/IFRS numbering:
//   1xxx: Assets
//   2xxx: Liabilities
//   3xxx: Equity
//   4xxx: Revenue
//   5xxx: Cost of Revenue
//   6xxx: Operating Expenses
//   7xxx: Other Income
//   8xxx: Other Expenses
//   9xxx: Tax

export interface AccountCategory {
  prefix: string;
  category: Account["category"];
  label: string;
  normal_balance: Account["normal_balance"];
}

const ACCOUNT_RANGES: readonly AccountCategory[] = [
  { prefix: "1", category: "asset", label: "Assets", normal_balance: "debit" },
  { prefix: "2", category: "liability", label: "Liabilities", normal_balance: "credit" },
  { prefix: "3", category: "equity", label: "Equity", normal_balance: "credit" },
  { prefix: "4", category: "revenue", label: "Revenue", normal_balance: "credit" },
  { prefix: "5", category: "expense", label: "Cost of Revenue", normal_balance: "debit" },
  { prefix: "6", category: "expense", label: "Operating Expenses", normal_balance: "debit" },
  { prefix: "7", category: "revenue", label: "Other Income", normal_balance: "credit" },
  { prefix: "8", category: "expense", label: "Other Expenses", normal_balance: "debit" },
  { prefix: "9", category: "expense", label: "Tax", normal_balance: "debit" },
] as const;

// ── Validation ─────────────────────────────────────────────────────────

const ACCOUNT_NUMBER_REGEX = /^[1-9]\d{3}$/;

/**
 * Validate an account number:
 * - Must be exactly 4 digits
 * - First digit must be 1-9
 */
export function validateAccountNumber(
  number: string,
): { valid: boolean; error?: string } {
  if (!ACCOUNT_NUMBER_REGEX.test(number)) {
    return {
      valid: false,
      error: `Account number "${number}" must be exactly 4 digits starting with 1-9`,
    };
  }
  return { valid: true };
}

/**
 * Return the account category metadata for a given account number.
 * Returns undefined if the number is invalid or the prefix is not mapped.
 */
export function getAccountCategory(
  number: string,
): AccountCategory | undefined {
  const validation = validateAccountNumber(number);
  if (!validation.valid) return undefined;

  const prefix = number[0];
  return ACCOUNT_RANGES.find((r) => r.prefix === prefix);
}

// ── Default Chart of Accounts ──────────────────────────────────────────

/**
 * Returns a standard chart of accounts suitable for a startup / small company.
 */
export function createDefaultChartOfAccounts(): Account[] {
  const accounts: Account[] = [
    // 1xxx — Assets
    acct("1000", "Cash and Cash Equivalents", "asset", "debit", "current_asset"),
    acct("1010", "Checking Account", "asset", "debit", "current_asset", "1000"),
    acct("1020", "Savings Account", "asset", "debit", "current_asset", "1000"),
    acct("1100", "Accounts Receivable", "asset", "debit", "current_asset"),
    acct("1200", "Prepaid Expenses", "asset", "debit", "current_asset"),
    acct("1300", "Inventory", "asset", "debit", "current_asset"),
    acct("1500", "Fixed Assets", "asset", "debit", "fixed_asset"),
    acct("1510", "Equipment", "asset", "debit", "fixed_asset", "1500"),
    acct("1520", "Furniture", "asset", "debit", "fixed_asset", "1500"),
    acct("1590", "Accumulated Depreciation", "asset", "credit", "fixed_asset"),

    // 2xxx — Liabilities
    acct("2000", "Accounts Payable", "liability", "credit", "current_liability"),
    acct("2100", "Accrued Expenses", "liability", "credit", "current_liability"),
    acct("2200", "Sales Tax Payable", "liability", "credit", "current_liability"),
    acct("2300", "Payroll Liabilities", "liability", "credit", "current_liability"),
    acct("2500", "Short-term Debt", "liability", "credit", "current_liability"),
    acct("2700", "Long-term Debt", "liability", "credit", "long_term_liability"),

    // 3xxx — Equity
    acct("3000", "Common Stock", "equity", "credit", "contributed_capital"),
    acct("3100", "Additional Paid-in Capital", "equity", "credit", "contributed_capital"),
    acct("3200", "Retained Earnings", "equity", "credit", "retained_earnings"),
    acct("3300", "Owner Draws", "equity", "debit", "draws"),

    // 4xxx — Revenue
    acct("4000", "Revenue", "revenue", "credit", "operating_revenue"),
    acct("4100", "Service Revenue", "revenue", "credit", "operating_revenue"),
    acct("4200", "Product Revenue", "revenue", "credit", "operating_revenue"),
    acct("4300", "Subscription Revenue", "revenue", "credit", "operating_revenue"),

    // 5xxx — Cost of Revenue
    acct("5000", "Cost of Revenue", "expense", "debit", "cost_of_revenue"),
    acct("5100", "Cost of Goods Sold", "expense", "debit", "cost_of_revenue"),
    acct("5200", "Hosting & Infrastructure", "expense", "debit", "cost_of_revenue"),

    // 6xxx — Operating Expenses
    acct("6000", "Operating Expenses", "expense", "debit", "operating_expense"),
    acct("6100", "Salaries & Wages", "expense", "debit", "operating_expense"),
    acct("6200", "Rent", "expense", "debit", "operating_expense"),
    acct("6300", "Utilities", "expense", "debit", "operating_expense"),
    acct("6400", "Marketing & Advertising", "expense", "debit", "operating_expense"),
    acct("6500", "Software & Subscriptions", "expense", "debit", "operating_expense"),
    acct("6600", "Professional Services", "expense", "debit", "operating_expense"),
    acct("6700", "Travel & Entertainment", "expense", "debit", "operating_expense"),
    acct("6800", "Office Supplies", "expense", "debit", "operating_expense"),
    acct("6900", "Depreciation Expense", "expense", "debit", "operating_expense"),

    // 7xxx — Other Income
    acct("7000", "Other Income", "revenue", "credit", "other_income"),
    acct("7100", "Interest Income", "revenue", "credit", "other_income"),
    acct("7200", "Gain on Foreign Exchange", "revenue", "credit", "other_income"),

    // 8xxx — Other Expenses
    acct("8000", "Other Expenses", "expense", "debit", "other_expense"),
    acct("8100", "Interest Expense", "expense", "debit", "other_expense"),
    acct("8200", "Loss on Foreign Exchange", "expense", "debit", "other_expense"),
    acct("8300", "Bank Fees", "expense", "debit", "other_expense"),

    // 9xxx — Tax
    acct("9000", "Income Tax Expense", "expense", "debit", "tax"),
    acct("9100", "Deferred Tax Expense", "expense", "debit", "tax"),
  ];

  return accounts;
}

// ── QMD serialization ──────────────────────────────────────────────────

/**
 * Serialize an array of Account objects into a single QMD document.
 */
export function buildChartOfAccountsQmd(accounts: Account[]): string {
  const frontmatter: Record<string, unknown> = {
    type: "chart_of_accounts",
    id: "coa-001",
    title: "Chart of Accounts",
    account_count: accounts.length,
    updated_at: new Date().toISOString(),
  };

  const lines: string[] = ["# Chart of Accounts", ""];

  // Group by first digit
  const grouped = new Map<string, Account[]>();
  for (const acct of accounts) {
    const prefix = acct.number[0];
    const existing = grouped.get(prefix) ?? [];
    existing.push(acct);
    grouped.set(prefix, existing);
  }

  for (const range of ACCOUNT_RANGES) {
    const group = grouped.get(range.prefix);
    if (!group || group.length === 0) continue;

    lines.push(`## ${range.prefix}xxx — ${range.label}`, "");
    for (const a of group) {
      const indent = a.parent_account ? "  " : "";
      lines.push(`${indent}- **${a.number}** ${a.name} (${a.normal_balance})`);
    }
    lines.push("");
  }

  return writeQmd(frontmatter, lines.join("\n"));
}

// ── Internal helper ────────────────────────────────────────────────────

function acct(
  number: string,
  name: string,
  category: Account["category"],
  normal_balance: Account["normal_balance"],
  sub_category?: string,
  parent_account?: string,
): Account {
  return {
    type: "account",
    id: `acct-${number}`,
    number,
    name,
    category,
    sub_category,
    normal_balance,
    is_active: true,
    parent_account,
  };
}
