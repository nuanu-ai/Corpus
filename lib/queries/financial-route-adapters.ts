import type { FinancialOverview, FinancialSeriesPoint } from "@/lib/queries/financial-overview";
import type { CashFlowMonth, ExpenseBreakdown } from "@/lib/queries/financial-summary";

export interface LegacyPnLRoutePayload {
  revenue: number | null;
  expenses: number | null;
  netProfit: number | null;
  revenueChange: number | null;
  expenseChange: number | null;
  warnings: string[];
}

export function getLegacyRouteWarnings(overview: FinancialOverview): string[] {
  return Array.from(new Set(overview.warnings.filter(Boolean)));
}

function percentageChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function toPeriodKey(month?: Date): string | null {
  if (!month || Number.isNaN(month.getTime())) return null;
  return `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
}

function findSeriesPoint(
  points: FinancialSeriesPoint[],
  periodKey: string | null,
): { point: FinancialSeriesPoint | null; previous: FinancialSeriesPoint | null } {
  if (!periodKey) return { point: null, previous: null };

  const index = points.findIndex((point) => point.period === periodKey);
  if (index === -1) return { point: null, previous: null };

  return {
    point: points[index] ?? null,
    previous: index > 0 ? points[index - 1] ?? null : null,
  };
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

export function toLegacyPnLRoutePayload(
  overview: FinancialOverview,
  month?: Date,
): LegacyPnLRoutePayload {
  const periodKey = toPeriodKey(month);
  if (!periodKey) {
    return {
      revenue: overview.pnl.revenue,
      expenses: overview.pnl.expenses,
      netProfit: overview.pnl.netProfit,
      revenueChange: overview.pnl.revenueChange,
      expenseChange: overview.pnl.expenseChange,
      warnings: getLegacyRouteWarnings(overview),
    };
  }

  const { point, previous } = findSeriesPoint(overview.series.pnl, periodKey);
  if (!point) {
    return {
      revenue: null,
      expenses: null,
      netProfit: null,
      revenueChange: null,
      expenseChange: null,
      warnings: getLegacyRouteWarnings(overview),
    };
  }

  return {
    revenue: point.revenue,
    expenses: point.expenses,
    netProfit: point.netIncome,
    revenueChange: percentageChange(point.revenue, previous?.revenue ?? null),
    expenseChange: percentageChange(point.expenses, previous?.expenses ?? null),
    warnings: getLegacyRouteWarnings(overview),
  };
}

export function toLegacyExpenseBreakdown(
  overview: FinancialOverview,
  month?: Date,
): ExpenseBreakdown[] {
  const periodKey = toPeriodKey(month);

  if (!periodKey) {
    return overview.expenses.breakdown.length > 0
      ? overview.expenses.breakdown
      : buildSyntheticExpenseBreakdown({
          total: overview.expenses.total,
          operatingExpenses: overview.expenses.operatingExpenses,
          costOfSales: overview.expenses.costOfSales,
        });
  }

  const point = overview.series.expenses.find((entry) => entry.period === periodKey);
  if (!point) return [];

  return buildSyntheticExpenseBreakdown({
    total: point.expenses,
    operatingExpenses: point.operatingExpenses,
    costOfSales: point.costOfSales,
  });
}

export function toLegacyCashFlowSummary(overview: FinancialOverview): CashFlowMonth[] {
  return overview.series.cashFlow;
}
