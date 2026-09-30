import { db } from "@/lib/db";
import { canonicalTxns, reconciledTxns, connections } from "@/lib/db/schema";
import { eq, and, gte, lt, sql, ne, isNull, or } from "drizzle-orm";
import { trustedAmountUsdOrNullSql, trustedAmountUsdSql } from "@/lib/canonical-txns";

export interface PnLSummary {
  revenue: number;
  expenses: number;
  netProfit: number;
  revenueChange: number; // % vs previous month
  expenseChange: number; // % vs previous month
}

export interface ExpenseBreakdown {
  category: string;
  amount: number;
  count: number;
  percentOfTotal: number;
}

export interface CashFlowMonth {
  month: string; // YYYY-MM
  inflows: number;
  outflows: number;
  net: number;
}

/** Helper: compute start-of-month and start-of-next-month for a given date. */
function monthRange(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start, end };
}

/** Helper: compute start-of-previous-month for a given date. */
function prevMonthRange(date: Date): { start: Date; end: Date } {
  const prev = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return monthRange(prev);
}

/**
 * Query revenue (credits) and expenses (debits) for a single month.
 * Filters out duplicates by left-joining with reconciledTxns and
 * excluding dedupStatus = 'duplicate'.
 */
async function getMonthTotals(
  companyId: string,
  start: Date,
  end: Date
): Promise<{ revenue: number; expenses: number }> {
  const rows = await db
    .select({
      type: canonicalTxns.type,
      total: sql<string>`coalesce(sum(${trustedAmountUsdSql(canonicalTxns)}), 0)`,
    })
    .from(canonicalTxns)
    .leftJoin(
      reconciledTxns,
      eq(reconciledTxns.canonicalTxnId, canonicalTxns.id)
    )
    .where(
      and(
        eq(canonicalTxns.companyId, companyId),
        ne(canonicalTxns.status, "superseded"),
        gte(canonicalTxns.date, start),
        lt(canonicalTxns.date, end),
        or(
          isNull(reconciledTxns.dedupStatus),
          ne(reconciledTxns.dedupStatus, "duplicate")
        )
      )
    )
    .groupBy(canonicalTxns.type);

  let revenue = 0;
  let expenses = 0;
  for (const row of rows) {
    const val = Number(row.total);
    if (row.type === "credit") revenue = val;
    else if (row.type === "debit") expenses = val;
  }
  return { revenue, expenses };
}

/**
 * Get P&L for a given month (defaults to current month).
 * Revenue = sum of credit amountUsd
 * Expenses = sum of debit amountUsd
 * Also computes month-over-month % change.
 */
export async function getPnLSummary(
  companyId: string,
  month?: Date
): Promise<PnLSummary> {
  const target = month ?? new Date();
  const { start, end } = monthRange(target);
  const prev = prevMonthRange(target);

  const [current, previous] = await Promise.all([
    getMonthTotals(companyId, start, end),
    getMonthTotals(companyId, prev.start, prev.end),
  ]);

  const revenueChange =
    previous.revenue > 0
      ? Number((((current.revenue - previous.revenue) / previous.revenue) * 100).toFixed(1))
      : 0;
  const expenseChange =
    previous.expenses > 0
      ? Number((((current.expenses - previous.expenses) / previous.expenses) * 100).toFixed(1))
      : 0;

  return {
    revenue: current.revenue,
    expenses: current.expenses,
    netProfit: current.revenue - current.expenses,
    revenueChange,
    expenseChange,
  };
}

/**
 * Get expense breakdown by category for a given month.
 * Joins canonicalTxns with reconciledTxns, filters type="debit",
 * groups by category.
 */
export async function getExpenseBreakdown(
  companyId: string,
  month?: Date
): Promise<ExpenseBreakdown[]> {
  const target = month ?? new Date();
  const { start, end } = monthRange(target);

  const rows = await db
    .select({
      category: sql<string>`coalesce(${reconciledTxns.category}, 'Uncategorized')`,
      amount: sql<string>`coalesce(sum(${trustedAmountUsdSql(canonicalTxns)}), 0)`,
      count: sql<string>`count(*)`,
    })
    .from(canonicalTxns)
    .innerJoin(
      reconciledTxns,
      eq(reconciledTxns.canonicalTxnId, canonicalTxns.id)
    )
    .where(
      and(
        eq(canonicalTxns.companyId, companyId),
        ne(canonicalTxns.status, "superseded"),
        eq(canonicalTxns.type, "debit"),
        gte(canonicalTxns.date, start),
        lt(canonicalTxns.date, end),
        or(
          isNull(reconciledTxns.dedupStatus),
          ne(reconciledTxns.dedupStatus, "duplicate")
        )
      )
    )
    .groupBy(reconciledTxns.category);

  const items = rows.map((r) => ({
    category: r.category,
    amount: Number(r.amount),
    count: Number(r.count),
    percentOfTotal: 0,
  }));

  const total = items.reduce((s, i) => s + i.amount, 0);

  for (const item of items) {
    item.percentOfTotal =
      total > 0 ? Number(((item.amount / total) * 100).toFixed(1)) : 0;
  }

  return items.sort((a, b) => b.amount - a.amount);
}

/**
 * Get total balances across all connections for a company.
 * Sum of credits - debits for each connection/currency.
 */
export async function getAccountBalances(
  companyId: string
): Promise<
  Array<{
    connectionId: string | null;
    provider: string;
    currency: string;
    balance: number;
    nativeBalance: number;
    balanceUsd: number | null;
    balanceUsdTrusted: boolean;
    untrustedTxnCount: number;
    lastSyncAt: Date | null;
  }>
> {
  const rows = await db
    .select({
      connectionId: canonicalTxns.connectionId,
      provider: sql<string>`coalesce(${connections.provider}, 'unknown')`,
      currency: canonicalTxns.currency,
      nativeCredits: sql<string>`coalesce(sum(case when ${canonicalTxns.type} = 'credit' then ${canonicalTxns.amount} else 0 end), 0)`,
      nativeDebits: sql<string>`coalesce(sum(case when ${canonicalTxns.type} = 'debit' then ${canonicalTxns.amount} else 0 end), 0)`,
      credits: sql<string>`coalesce(sum(case when ${canonicalTxns.type} = 'credit' then ${trustedAmountUsdOrNullSql(canonicalTxns)} else 0 end), 0)`,
      debits: sql<string>`coalesce(sum(case when ${canonicalTxns.type} = 'debit' then ${trustedAmountUsdOrNullSql(canonicalTxns)} else 0 end), 0)`,
      untrustedTxnCount: sql<string>`count(case when ${canonicalTxns.currency} <> 'USD' and ${canonicalTxns.fxRate} is null then 1 end)`,
      lastSyncAt: connections.lastSyncAt,
    })
    .from(canonicalTxns)
    .leftJoin(connections, eq(connections.id, canonicalTxns.connectionId))
    .leftJoin(
      reconciledTxns,
      eq(reconciledTxns.canonicalTxnId, canonicalTxns.id)
    )
    .where(
      and(
        eq(canonicalTxns.companyId, companyId),
        ne(canonicalTxns.status, "superseded"),
        or(
          isNull(reconciledTxns.dedupStatus),
          ne(reconciledTxns.dedupStatus, "duplicate")
        )
      )
    )
    .groupBy(
      canonicalTxns.connectionId,
      connections.provider,
      canonicalTxns.currency,
      connections.lastSyncAt
    );

  return rows.map((r) => ({
    connectionId: r.connectionId,
    provider: r.provider,
    currency: r.currency,
    balance: Number(r.credits) - Number(r.debits),
    nativeBalance: Number(r.nativeCredits) - Number(r.nativeDebits),
    balanceUsd:
      Number(r.untrustedTxnCount) > 0 ? null : Number(r.credits) - Number(r.debits),
    balanceUsdTrusted: Number(r.untrustedTxnCount) === 0,
    untrustedTxnCount: Number(r.untrustedTxnCount),
    lastSyncAt: r.lastSyncAt,
  }));
}

/**
 * Get monthly cash flow (inflows/outflows) for the last N months.
 * Inflows = sum of credit amountUsd, outflows = sum of debit amountUsd.
 * Groups by calendar month and returns sorted oldest-first.
 */
export async function getCashFlowSummary(
  companyId: string,
  months: number = 12,
): Promise<CashFlowMonth[]> {
  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  const rows = await db
    .select({
      month: sql<string>`to_char(${canonicalTxns.date}, 'YYYY-MM')`,
      inflows: sql<string>`coalesce(sum(case when ${canonicalTxns.type} = 'credit' then ${trustedAmountUsdSql(canonicalTxns)} else 0 end), 0)`,
      outflows: sql<string>`coalesce(sum(case when ${canonicalTxns.type} = 'debit' then ${trustedAmountUsdSql(canonicalTxns)} else 0 end), 0)`,
    })
    .from(canonicalTxns)
    .leftJoin(
      reconciledTxns,
      eq(reconciledTxns.canonicalTxnId, canonicalTxns.id),
    )
    .where(
      and(
        eq(canonicalTxns.companyId, companyId),
        ne(canonicalTxns.status, "superseded"),
        gte(canonicalTxns.date, startDate),
        lt(canonicalTxns.date, endDate),
        or(
          isNull(reconciledTxns.dedupStatus),
          ne(reconciledTxns.dedupStatus, "duplicate"),
        ),
      ),
    )
    .groupBy(sql`to_char(${canonicalTxns.date}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${canonicalTxns.date}, 'YYYY-MM')`);

  return rows.map((r) => {
    const inflows = Number(r.inflows);
    const outflows = Number(r.outflows);
    return {
      month: r.month,
      inflows,
      outflows,
      net: inflows - outflows,
    };
  });
}
