export const taxReserve = {
  totalEstimated: 5100,
  totalSetAside: 4218,
  percentFunded: 82.7,
  nextDue: "Apr 15, 2026",
  daysUntilDue: 46,
};

export const quarterlyTimeline = [
  {
    quarter: "Q1 2026",
    estimated: 5100,
    setAside: 4218,
    status: "in-progress" as const,
    dueDate: "Apr 15, 2026",
  },
  {
    quarter: "Q2 2026",
    estimated: 5400,
    setAside: 0,
    status: "upcoming" as const,
    dueDate: "Jun 15, 2026",
  },
  {
    quarter: "Q3 2026",
    estimated: 5800,
    setAside: 0,
    status: "upcoming" as const,
    dueDate: "Sep 15, 2026",
  },
  {
    quarter: "Q4 2026",
    estimated: 6100,
    setAside: 0,
    status: "upcoming" as const,
    dueDate: "Jan 15, 2027",
  },
];

export const taxBreakdown = [
  { type: "Income Tax", amount: 3200, pct: 62.7, color: "#3B82F6" },
  { type: "Self-Employment", amount: 1400, pct: 27.5, color: "#8B5CF6" },
  { type: "Sales Tax", amount: 500, pct: 9.8, color: "#F59E0B" },
];

export const recentAllocations = [
  { date: "Feb 27", description: "Stripe — Example Vendor", saleAmount: 450, taxReserve: 139.5, rate: 31 },
  { date: "Feb 26", description: "Stripe — Example Client D", saleAmount: 280, taxReserve: 86.8, rate: 31 },
  { date: "Feb 25", description: "Crypto wallet — Payout", saleAmount: 1200, taxReserve: 372.0, rate: 31 },
  { date: "Feb 24", description: "Stripe — Example Client E", saleAmount: 39, taxReserve: 12.09, rate: 31 },
  { date: "Feb 23", description: "Bank Transfer — Consulting", saleAmount: 2500, taxReserve: 775.0, rate: 31 },
  { date: "Feb 22", description: "Stripe — Example Client F", saleAmount: 156, taxReserve: 48.36, rate: 31 },
  { date: "Feb 21", description: "PayPal — Workshop Fee", saleAmount: 89, taxReserve: 27.59, rate: 31 },
  { date: "Feb 20", description: "Stripe — CloudBase Pro", saleAmount: 780, taxReserve: 241.8, rate: 31 },
];

export const nexusAlerts = [
  { jurisdiction: "Texas", flag: "🇺🇸", threshold: 500000, current: 435000, pct: 87, daysToThreshold: 45, status: "warning" as const },
  { jurisdiction: "California", flag: "🇺🇸", threshold: 500000, current: 210000, pct: 42, daysToThreshold: null, status: "safe" as const },
  { jurisdiction: "New York", flag: "🇺🇸", threshold: 500000, current: 165000, pct: 33, daysToThreshold: null, status: "safe" as const },
  { jurisdiction: "UK VAT", flag: "🇬🇧", threshold: 90000, current: 78200, pct: 87, daysToThreshold: 56, status: "warning" as const },
];

export function buildTaxJarSummary(): string {
  return [
    `\nTax Reserve (Tax Jar):`,
    `  Q1 2026: $${taxReserve.totalSetAside.toLocaleString()} of $${taxReserve.totalEstimated.toLocaleString()} set aside (${taxReserve.percentFunded}% funded)`,
    `  Next payment due: ${taxReserve.nextDue} (${taxReserve.daysUntilDue} days)`,
    `  Breakdown: Income Tax $${taxBreakdown[0].amount.toLocaleString()}, SE Tax $${taxBreakdown[1].amount.toLocaleString()}, Sales Tax $${taxBreakdown[2].amount.toLocaleString()}`,
    `  Nexus alerts: TX at ${nexusAlerts[0].pct}% of threshold (~${nexusAlerts[0].daysToThreshold} days), UK VAT at ${nexusAlerts[3].pct}% (~${nexusAlerts[3].daysToThreshold} days)`,
  ].join("\n");
}
