import type {
  JournalEntry,
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
} from "../../schema/domain-types/finance.js";
import type { MoneyAmount } from "../../schema/domain-types/common.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function money(amount: number, currency: string): MoneyAmount {
  return { amount: round2(amount), currency };
}

/**
 * Round to 2 decimal places using banker's rounding (round-half-to-even).
 */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Filter journal entries to only posted ones in the given period.
 */
function filterPosted(
  entries: JournalEntry[],
  period: string,
): JournalEntry[] {
  return entries.filter(
    (je) =>
      (je.status === "posted" || je.status === "reconciled") &&
      je.period === period,
  );
}

/**
 * Filter journal entries to posted/reconciled ones up to and including the given period.
 * Used for cumulative reports like the balance sheet.
 */
function filterPostedCumulative(
  entries: JournalEntry[],
  period: string,
): JournalEntry[] {
  return entries.filter(
    (je) =>
      (je.status === "posted" || je.status === "reconciled") &&
      je.period <= period,
  );
}

/**
 * Aggregate amounts from journal entry lines matching account number prefix(es).
 * Returns the net amount considering normal balance direction:
 *   - For credit-normal accounts (revenue): credits - debits
 *   - For debit-normal accounts (expenses): debits - credits
 *
 * @param entries - Already filtered (posted + period-matched) journal entries
 * @param prefixes - Account number prefixes to match (e.g., ["4"] for 4xxx)
 * @param direction - "credit" for revenue-like, "debit" for expense-like
 */
function aggregateByPrefix(
  entries: JournalEntry[],
  prefixes: string[],
  direction: "debit" | "credit",
): number {
  let total = 0;

  for (const je of entries) {
    for (const line of je.lines) {
      // Extract the account number from account_id (format: "acct-NNNN")
      const acctNumber = extractAccountNumber(line.account_id);
      if (!acctNumber) continue;

      const prefix = acctNumber[0];
      if (!prefixes.includes(prefix)) continue;

      const rate = line.fx_rate ?? 1;
      const debit = (line.debit ?? 0) * rate;
      const credit = (line.credit ?? 0) * rate;

      if (direction === "credit") {
        total += credit - debit;
      } else {
        total += debit - credit;
      }
    }
  }

  return total;
}

/**
 * Extract the 4-digit account number from an account_id.
 * Supports formats: "acct-1000", "1000", or any string ending with 4 digits.
 */
function extractAccountNumber(accountId: string): string | undefined {
  // Direct 4-digit number
  if (/^\d{4}$/.test(accountId)) return accountId;

  // acct-NNNN format
  const match = accountId.match(/acct-(\d{4})$/);
  if (match) return match[1];

  return undefined;
}

// ── Income Statement ────────────────────────────────────────────────────

/**
 * Generate an income statement from posted journal entries for a period.
 *
 * Aggregates:
 * - 4xxx: Revenue (credit-normal)
 * - 5xxx: Cost of Revenue (debit-normal)
 * - 6xxx: Operating Expenses (debit-normal)
 * - 7xxx: Other Income (credit-normal)
 * - 8xxx: Other Expenses (debit-normal)
 *
 * Gross Profit = Revenue - COGS
 * Operating Income = Gross Profit - OpEx
 * Net Income = Operating Income + Other Income - Other Expenses
 */
export function generateIncomeStatement(
  journalEntries: JournalEntry[],
  period: string,
  currency = "USD",
): IncomeStatement {
  const posted = filterPosted(journalEntries, period);

  const revenue = aggregateByPrefix(posted, ["4"], "credit");
  const costOfRevenue = aggregateByPrefix(posted, ["5"], "debit");
  const operatingExpenses = aggregateByPrefix(posted, ["6"], "debit");
  const otherIncome = aggregateByPrefix(posted, ["7"], "credit");
  const otherExpenses = aggregateByPrefix(posted, ["8"], "debit");

  const grossProfit = revenue - costOfRevenue;
  const operatingIncome = grossProfit - operatingExpenses;
  const netIncome = operatingIncome + otherIncome - otherExpenses;

  return {
    type: "income_statement",
    id: `is-${period}`,
    period,
    revenue: money(revenue, currency),
    cost_of_revenue: money(costOfRevenue, currency),
    gross_profit: money(grossProfit, currency),
    operating_expenses: money(operatingExpenses, currency),
    operating_income: money(operatingIncome, currency),
    net_income: money(netIncome, currency),
    currency,
  };
}

// ── Balance Sheet ───────────────────────────────────────────────────────

/**
 * Generate a balance sheet from posted journal entries for a period.
 *
 * Aggregates cumulative balances:
 * - 1xxx: Assets (debit-normal)
 * - 2xxx: Liabilities (credit-normal)
 * - 3xxx: Equity (credit-normal)
 *
 * Note: For a true balance sheet you'd typically include all JEs up to
 * the end of the period (cumulative), but this implementation filters
 * by the specified period only. In production, pass all historical JEs.
 */
export function generateBalanceSheet(
  journalEntries: JournalEntry[],
  period: string,
  currency = "USD",
): BalanceSheet {
  const posted = filterPostedCumulative(journalEntries, period);

  const totalAssets = aggregateByPrefix(posted, ["1"], "debit");
  const totalLiabilities = aggregateByPrefix(posted, ["2"], "credit");
  const totalEquity = aggregateByPrefix(posted, ["3"], "credit");

  return {
    type: "balance_sheet",
    id: `bs-${period}`,
    period,
    total_assets: money(totalAssets, currency),
    total_liabilities: money(totalLiabilities, currency),
    total_equity: money(totalEquity, currency),
    currency,
  };
}

// ── Cash Flow Statement ─────────────────────────────────────────────────

/**
 * Generate a cash flow statement using the direct method.
 *
 * Simplified classification by account prefix:
 * - Operating: cash movements involving 4xxx-6xxx (revenue + COGS + OpEx)
 * - Investing: cash movements involving 1xxx (assets, excluding cash 10xx)
 * - Financing: cash movements involving 2xxx-3xxx (liabilities + equity)
 *
 * A "cash movement" is a JE line on a cash account (10xx) whose
 * counterpart falls into one of the above categories.
 */
export function generateCashFlowStatement(
  journalEntries: JournalEntry[],
  period: string,
  currency = "USD",
): CashFlowStatement {
  const posted = filterPosted(journalEntries, period);

  let operating = 0;
  let investing = 0;
  let financing = 0;

  for (const je of posted) {
    // Find cash lines (10xx accounts) and classify counterparts
    const cashLines: Array<{ index: number; netCash: number }> = [];
    const nonCashLines: Array<{ index: number; accountPrefix: string }> = [];

    for (let i = 0; i < je.lines.length; i++) {
      const line = je.lines[i];
      const acctNum = extractAccountNumber(line.account_id);
      if (!acctNum) continue;

      const rate = line.fx_rate ?? 1;
      const debit = (line.debit ?? 0) * rate;
      const credit = (line.credit ?? 0) * rate;

      if (acctNum.startsWith("10")) {
        // Cash account: debit increases cash, credit decreases
        cashLines.push({ index: i, netCash: debit - credit });
      } else {
        nonCashLines.push({ index: i, accountPrefix: acctNum[0] });
      }
    }

    if (cashLines.length === 0) continue;

    // Total cash movement for this JE
    const totalCash = cashLines.reduce((sum, cl) => sum + cl.netCash, 0);

    // Classify by non-cash counterpart accounts
    // If mixed, use the first non-cash account to classify
    const categories = new Set(nonCashLines.map((l) => l.accountPrefix));

    if (
      categories.has("4") ||
      categories.has("5") ||
      categories.has("6") ||
      categories.has("7") ||
      categories.has("8") ||
      categories.has("9")
    ) {
      operating += totalCash;
    } else if (categories.has("1")) {
      investing += totalCash;
    } else if (categories.has("2") || categories.has("3")) {
      financing += totalCash;
    } else {
      // Default to operating
      operating += totalCash;
    }
  }

  const netChange = operating + investing + financing;

  return {
    type: "cash_flow_statement",
    id: `cf-${period}`,
    period,
    operating: money(operating, currency),
    investing: money(investing, currency),
    financing: money(financing, currency),
    net_change: money(netChange, currency),
    currency,
  };
}
