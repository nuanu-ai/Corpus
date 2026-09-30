import { pnlHistory, currentMonth, revenueBreakdown } from "./pnl";
import { totalBalance } from "./accounts";

// ── Cash Health ──────────────────────────────────────────────────────────────

const avgMonthlyExpenses =
  pnlHistory.reduce((sum, m) => sum + m.expenses, 0) / pnlHistory.length;
const netBurn = currentMonth.expenses - currentMonth.revenue;

export const cashHealth = {
  cashPosition: totalBalance,
  grossBurnRate: currentMonth.expenses,
  netBurnRate: netBurn, // negative = net positive (revenue > expenses)
  cashRunwayMonths: Math.round((totalBalance / avgMonthlyExpenses) * 10) / 10,
  avgMonthlyBurn: Math.round(avgMonthlyExpenses),
  isNetPositive: currentMonth.revenue > currentMonth.expenses,
};

// ── Revenue Metrics ──────────────────────────────────────────────────────────

export const revenueMetrics = {
  mrr: 18400,
  arr: 220800,
  revenueGrowthRate: 12,
  revenueByChannel: revenueBreakdown.map((r) => ({
    channel: r.source,
    amount: r.amount,
    pct: Math.round((r.amount / currentMonth.revenue) * 100),
  })),
  mrrHistory: [
    { month: "Sep 2025", mrr: 11200 },
    { month: "Oct 2025", mrr: 12500 },
    { month: "Nov 2025", mrr: 14000 },
    { month: "Dec 2025", mrr: 15200 },
    { month: "Jan 2026", mrr: 16400 },
    { month: "Feb 2026", mrr: 18400 },
  ],
};

// ── Unit Economics ────────────────────────────────────────────────────────────

export const unitEconomics = {
  cac: 127,
  ltv: 2950,
  ltvCacRatio: 23.2,
  paybackPeriodMonths: 1.1,
  totalCustomers: 156,
  newCustomersThisMonth: 18,
  avgRevenuePerCustomer: 118,
  monthlyChurnRate: 3.2,
};

export const unitEconomicsHistory = [
  { month: "Sep 2025", cac: 155, ltv: 2200, ratio: 14.2 },
  { month: "Oct 2025", cac: 148, ltv: 2400, ratio: 16.2 },
  { month: "Nov 2025", cac: 140, ltv: 2550, ratio: 18.2 },
  { month: "Dec 2025", cac: 135, ltv: 2700, ratio: 20.0 },
  { month: "Jan 2026", cac: 130, ltv: 2850, ratio: 21.9 },
  { month: "Feb 2026", cac: 127, ltv: 2950, ratio: 23.2 },
];

// ── Cash Forecast ────────────────────────────────────────────────────────────

export const forecast = [
  // Historical (3 months)
  { month: "Dec 2025", cashBalance: 72000, upper: null, lower: null, isProjected: false },
  { month: "Jan 2026", cashBalance: 82000, upper: null, lower: null, isProjected: false },
  { month: "Feb 2026", cashBalance: 91550, upper: null, lower: null, isProjected: false },
  // Projected (6 months)
  { month: "Mar 2026", cashBalance: 104000, upper: 112000, lower: 96000, isProjected: true },
  { month: "Apr 2026", cashBalance: 118000, upper: 130000, lower: 106000, isProjected: true },
  { month: "May 2026", cashBalance: 133000, upper: 150000, lower: 116000, isProjected: true },
  { month: "Jun 2026", cashBalance: 149000, upper: 172000, lower: 126000, isProjected: true },
  { month: "Jul 2026", cashBalance: 166000, upper: 196000, lower: 136000, isProjected: true },
  { month: "Aug 2026", cashBalance: 184000, upper: 222000, lower: 146000, isProjected: true },
];

// ── Break-Even Projection ────────────────────────────────────────────────────

export const breakEvenProjection = {
  isAlreadyProfitable: true,
  profitableSince: "Sep 2025",
  netMargin: 69.2,
};

// ── Financial Health Score ───────────────────────────────────────────────────

export const financialHealthScore = {
  overall: 92,
  components: [
    { name: "Cash Health", score: 95, color: "#10B981" },
    { name: "Revenue Growth", score: 88, color: "#3B82F6" },
    { name: "Efficiency", score: 92, color: "#8B5CF6" },
    { name: "Burn Management", score: 90, color: "#F59E0B" },
  ],
};

// ── AI Summary Builder ───────────────────────────────────────────────────────

export function buildMetricsSummary(): string {
  const lines = [
    `\nKey Business Metrics:`,
    `  MRR: $${revenueMetrics.mrr.toLocaleString()} | ARR: $${revenueMetrics.arr.toLocaleString()} | Growth: +${revenueMetrics.revenueGrowthRate}%/mo`,
    `  Unit Economics: CAC $${unitEconomics.cac} | LTV $${unitEconomics.ltv.toLocaleString()} | LTV:CAC ${unitEconomics.ltvCacRatio}x | Payback ${unitEconomics.paybackPeriodMonths} months`,
    `  Customers: ${unitEconomics.totalCustomers} total | ${unitEconomics.newCustomersThisMonth} new this month | ARPU $${unitEconomics.avgRevenuePerCustomer} | Churn ${unitEconomics.monthlyChurnRate}%`,
    `  Cash Runway: ${cashHealth.cashRunwayMonths} months (${cashHealth.isNetPositive ? "net positive — effectively unlimited" : "burning cash"})`,
    `  Financial Health Score: ${financialHealthScore.overall}/100`,
    `  Status: ${breakEvenProjection.isAlreadyProfitable ? `Profitable since ${breakEvenProjection.profitableSince}, net margin ${breakEvenProjection.netMargin}%` : "Pre-profit"}`,
  ];
  return lines.join("\n");
}
