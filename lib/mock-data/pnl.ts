export interface PnLMonth {
  month: string;
  label: string;
  revenue: number;
  expenses: number;
  netProfit: number;
  revenueChange: number;
  expenseChange: number;
}

export const pnlHistory: PnLMonth[] = [
  {
    month: "2025-09",
    label: "Sep 2025",
    revenue: 14200,
    expenses: 5800,
    netProfit: 8400,
    revenueChange: 9.2,
    expenseChange: 2.1,
  },
  {
    month: "2025-10",
    label: "Oct 2025",
    revenue: 15800,
    expenses: 6200,
    netProfit: 9600,
    revenueChange: 11.3,
    expenseChange: 6.9,
  },
  {
    month: "2025-11",
    label: "Nov 2025",
    revenue: 17500,
    expenses: 6500,
    netProfit: 11000,
    revenueChange: 10.8,
    expenseChange: 4.8,
  },
  {
    month: "2025-12",
    label: "Dec 2025",
    revenue: 18900,
    expenses: 7100,
    netProfit: 11800,
    revenueChange: 8.0,
    expenseChange: 9.2,
  },
  {
    month: "2026-01",
    label: "Jan 2026",
    revenue: 20900,
    expenses: 7420,
    netProfit: 13480,
    revenueChange: 10.6,
    expenseChange: 4.5,
  },
  {
    month: "2026-02",
    label: "Feb 2026",
    revenue: 23400,
    expenses: 7200,
    netProfit: 16200,
    revenueChange: 12.0,
    expenseChange: -3.0,
  },
];

export const currentMonth: PnLMonth = pnlHistory[pnlHistory.length - 1];

export const revenueBreakdown: {
  source: string;
  amount: number;
}[] = [
  { source: "Stripe", amount: 18400 },
  { source: "Crypto payments", amount: 3500 },
  { source: "Direct Bank Transfers", amount: 1500 },
];

export const expenseBreakdown = [
  { category: "SaaS Subscriptions", amount: 2100 },
  { category: "Contractors", amount: 3200 },
  { category: "Cloud & Hosting", amount: 450 },
  { category: "Marketing", amount: 800 },
  { category: "Banking Fees", amount: 150 },
  { category: "Other", amount: 500 },
];

export const taxEstimate = {
  q1: 4050,
  dueDate: "2026-03-15",
  daysUntil: 14,
};
