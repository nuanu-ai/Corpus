export const cohortInfo = {
  description: "SaaS founders",
  revenueRange: "$10K–$50K MRR",
  segment: "B2B",
  cohortSize: 847,
};

export const expenseBenchmarks = [
  {
    category: "SaaS Subscriptions",
    yourSpend: 2100,
    yourPct: 9.0,
    peerMedian: 7.2,
    delta: 1.8,
    status: "above" as const,
    recommendation: "Audit unused subscriptions — PostHog, Loom, and Crisp overlap with existing tools",
  },
  {
    category: "Contractors",
    yourSpend: 3200,
    yourPct: 13.7,
    peerMedian: 15.0,
    delta: -1.3,
    status: "below" as const,
    recommendation: "Efficient contractor spend. Consider locking in rates before scaling",
  },
  {
    category: "Cloud & Hosting",
    yourSpend: 450,
    yourPct: 1.9,
    peerMedian: 3.1,
    delta: -1.2,
    status: "below" as const,
    recommendation: "Well-optimized infrastructure costs",
  },
  {
    category: "Marketing",
    yourSpend: 800,
    yourPct: 3.4,
    peerMedian: 8.5,
    delta: -5.1,
    status: "below" as const,
    recommendation: "Significantly under-spending vs peers. Growth opportunity if unit economics support it",
  },
  {
    category: "Banking Fees",
    yourSpend: 150,
    yourPct: 0.6,
    peerMedian: 1.2,
    delta: -0.6,
    status: "below" as const,
    recommendation: "Low fee structure. Crypto wallet + Stripe mix is efficient",
  },
];

export const revenueBenchmarks = [
  { metric: "Revenue Growth", yourValue: "12%/mo", peerMedian: "8%/mo", peerTop25: "15%/mo", status: "above" as const },
  { metric: "Net Margin", yourValue: "69.2%", peerMedian: "42%", peerTop25: "58%", status: "top" as const },
  { metric: "MRR per Customer", yourValue: "$118", peerMedian: "$85", peerTop25: "$130", status: "above" as const },
  { metric: "Monthly Churn", yourValue: "3.2%", peerMedian: "5.1%", peerTop25: "2.8%", status: "above" as const },
];

export const bestPractices = [
  {
    insight: "73% of SaaS founders at your stage who switched from monthly to annual pricing saw 22% lower churn",
    category: "Pricing",
    impact: "high" as const,
    peerPct: 73,
  },
  {
    insight: "Founders spending >10% of revenue on SaaS tools typically consolidate by month 18, saving 15–25%",
    category: "Ops",
    impact: "high" as const,
    peerPct: 68,
  },
  {
    insight: "B2B SaaS founders who added a second acquisition channel at your MRR grew 40% faster in the next 6 months",
    category: "Growth",
    impact: "medium" as const,
    peerPct: 61,
  },
  {
    insight: "82% of profitable founders at your stage set aside tax reserves per-transaction rather than quarterly",
    category: "Tax",
    impact: "medium" as const,
    peerPct: 82,
  },
];

export const seasonalPatterns = [
  { month: "Mar 2025", yourRevenue: 12800, peerMedian: 13200, peerUpper: 16500, peerLower: 9900 },
  { month: "Apr 2025", yourRevenue: 13100, peerMedian: 13500, peerUpper: 16800, peerLower: 10200 },
  { month: "May 2025", yourRevenue: 13500, peerMedian: 13800, peerUpper: 17100, peerLower: 10400 },
  { month: "Jun 2025", yourRevenue: 13200, peerMedian: 13100, peerUpper: 16300, peerLower: 9800 },
  { month: "Jul 2025", yourRevenue: 12900, peerMedian: 12400, peerUpper: 15500, peerLower: 9300 },
  { month: "Aug 2025", yourRevenue: 13400, peerMedian: 12800, peerUpper: 16000, peerLower: 9600 },
  { month: "Sep 2025", yourRevenue: 14200, peerMedian: 14100, peerUpper: 17600, peerLower: 10600 },
  { month: "Oct 2025", yourRevenue: 15800, peerMedian: 15200, peerUpper: 19000, peerLower: 11400 },
  { month: "Nov 2025", yourRevenue: 17500, peerMedian: 16800, peerUpper: 21000, peerLower: 12600 },
  { month: "Dec 2025", yourRevenue: 18900, peerMedian: 15500, peerUpper: 19400, peerLower: 11600 },
  { month: "Jan 2026", yourRevenue: 20900, peerMedian: 16200, peerUpper: 20300, peerLower: 12200 },
  { month: "Feb 2026", yourRevenue: 23400, peerMedian: 17100, peerUpper: 21400, peerLower: 12800 },
];

export function buildBenchmarksSummary(): string {
  return [
    `\nPeer Benchmarks (vs ${cohortInfo.cohortSize} ${cohortInfo.description}, ${cohortInfo.revenueRange}, ${cohortInfo.segment}):`,
    `  Expenses: SaaS tools above peers (+1.8pts), Marketing significantly below (-5.1pts = growth opportunity)`,
    `  Revenue: Growth 12%/mo (peer median 8%), Net margin 69.2% (peer median 42%), Churn 3.2% (peer median 5.1%)`,
    `  Key insight: Marketing spend at 3.4% of revenue vs peer median 8.5% — biggest gap and growth opportunity`,
  ].join("\n");
}
