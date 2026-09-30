import type { Forecast, IncomeStatement } from "../../schema/domain-types/finance.js";
import type { MoneyAmount } from "../../schema/domain-types/common.js";

// ── Types ────────────────────────────────────────────────────────────────

export type Scenario = "base" | "bull" | "bear";

export interface ForecastInput {
  year: string;
  historicalStatements: IncomeStatement[];
  cashBalance?: number;
  monthlyBurnRate?: number;
  growthOverrides?: Partial<Record<Scenario, { revenueGrowth: number; expenseGrowth: number }>>;
}

export interface ForecastResult {
  base: Forecast;
  bull: Forecast;
  bear: Forecast;
}

// ── Default growth assumptions ─────────────────────────────────────────

const DEFAULT_GROWTH: Record<Scenario, { revenueGrowth: number; expenseGrowth: number }> = {
  base: { revenueGrowth: 0.10, expenseGrowth: 0.05 },
  bull: { revenueGrowth: 0.25, expenseGrowth: 0.08 },
  bear: { revenueGrowth: -0.05, expenseGrowth: 0.10 },
};

// ── Helpers ──────────────────────────────────────────────────────────────

function money(amount: number, currency: string): MoneyAmount {
  return {
    amount: Math.round((amount + Number.EPSILON) * 100) / 100,
    currency,
  };
}

/**
 * Compute the average monthly burn rate from historical income statements.
 * Burn rate = (total expenses - total revenue) / number of months.
 * A negative value means the company is cash-flow positive (not burning).
 */
function computeAvgMonthlyBurn(statements: IncomeStatement[]): number {
  if (statements.length === 0) return 0;

  let totalExpenses = 0;
  let totalRevenue = 0;

  for (const stmt of statements) {
    totalRevenue += stmt.revenue.amount;
    totalExpenses +=
      stmt.cost_of_revenue.amount +
      stmt.operating_expenses.amount;
  }

  // Each statement represents one month
  const months = statements.length;
  return (totalExpenses - totalRevenue) / months;
}

/**
 * Compute cash runway in months given current cash and monthly burn rate.
 * Returns undefined if the company is not burning cash.
 */
function computeRunway(cashBalance: number, monthlyBurn: number): number | undefined {
  if (monthlyBurn <= 0) return undefined; // Not burning cash
  if (cashBalance <= 0) return 0;
  return Math.floor(cashBalance / monthlyBurn);
}

// ── Forecast generation ────────────────────────────────────────────────

/**
 * Generate three-scenario forecasts (base/bull/bear) for a given year.
 *
 * Uses the most recent historical income statement as the baseline,
 * then applies growth rates for revenue and expenses.
 */
export function generateForecasts(input: ForecastInput): ForecastResult {
  const { year, historicalStatements, cashBalance, growthOverrides } = input;

  // Find the most recent statement for baseline
  const sorted = [...historicalStatements].sort((a, b) =>
    b.period.localeCompare(a.period),
  );

  // Annualize from whatever data we have
  const months = sorted.length || 1;
  const baseRevenue = sorted.reduce((sum, s) => sum + s.revenue.amount, 0);
  const baseExpenses = sorted.reduce(
    (sum, s) => sum + s.cost_of_revenue.amount + s.operating_expenses.amount,
    0,
  );

  // Annualize if less than 12 months
  const annualizedRevenue = months < 12 ? (baseRevenue / months) * 12 : baseRevenue;
  const annualizedExpenses = months < 12 ? (baseExpenses / months) * 12 : baseExpenses;

  const currency = sorted[0]?.currency ?? "USD";

  const monthlyBurn = input.monthlyBurnRate ?? computeAvgMonthlyBurn(sorted);
  const currentCash = cashBalance ?? 0;

  const scenarios: Scenario[] = ["base", "bull", "bear"];
  const results: Record<string, Forecast> = {};

  for (const scenario of scenarios) {
    const growth = growthOverrides?.[scenario] ?? DEFAULT_GROWTH[scenario];
    const projectedRevenue = annualizedRevenue * (1 + growth.revenueGrowth);
    const projectedExpenses = annualizedExpenses * (1 + growth.expenseGrowth);

    // Estimate new monthly burn after applying growth
    const projectedMonthlyBurn =
      (projectedExpenses - projectedRevenue) / 12;
    const runway = computeRunway(currentCash, projectedMonthlyBurn);

    results[scenario] = {
      type: "forecast",
      id: `fcst-${year}-${scenario}`,
      year,
      scenario,
      revenue_projection: money(projectedRevenue, currency),
      expense_projection: money(projectedExpenses, currency),
      cash_runway_months: runway,
    };
  }

  return {
    base: results["base"],
    bull: results["bull"],
    bear: results["bear"],
  };
}

/**
 * Simple scenario comparison: returns the variance between bull and bear
 * for revenue and expenses.
 */
export function computeScenarioSpread(result: ForecastResult): {
  revenueSpread: number;
  expenseSpread: number;
} {
  return {
    revenueSpread:
      result.bull.revenue_projection.amount - result.bear.revenue_projection.amount,
    expenseSpread:
      result.bear.expense_projection.amount - result.bull.expense_projection.amount,
  };
}
