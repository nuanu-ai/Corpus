export interface ExpenseCategory {
  category: string;
  amount: number;
  previousMonth: number;
  change: number;
  items: { name: string; amount: number; isAnomaly?: boolean }[];
  isAnomaly?: boolean;
}

export const expenseCategories: ExpenseCategory[] = [
  {
    category: "SaaS Subscriptions",
    amount: 2100,
    previousMonth: 1707,
    change: 23,
    isAnomaly: true,
    items: [
      { name: "AWS Services", amount: 685 },
      { name: "OpenAI API", amount: 340 },
      { name: "Anthropic API", amount: 230 },
      { name: "Datadog", amount: 145, isAnomaly: true },
      { name: "Intercom Starter", amount: 89 },
      { name: "Ahrefs Lite", amount: 99 },
      { name: "Mixpanel Growth", amount: 89 },
      { name: "Supabase Pro", amount: 75 },
      { name: "HubSpot CRM", amount: 50 },
      { name: "Sentry Developer", amount: 52 },
      { name: "Cloudflare Pro", amount: 45 },
      { name: "Crisp Chat", amount: 45 },
      { name: "Resend Email", amount: 35 },
      { name: "Vercel Pro", amount: 20 },
      { name: "Notion Team", amount: 16 },
      { name: "Figma Professional", amount: 15 },
      { name: "Loom Business", amount: 15 },
      { name: "Slack Pro", amount: 12.50 },
      { name: "Calendly Pro", amount: 12 },
      { name: "1Password Business", amount: 8 },
      { name: "Linear", amount: 8 },
      { name: "GitHub Team", amount: 14.50 },
      { name: "PostHog (free tier)", amount: 0 },
    ],
  },
  {
    category: "Contractors",
    amount: 3200,
    previousMonth: 3200,
    change: 0,
    items: [
      { name: "Example Contractor A (backend dev)", amount: 1500 },
      { name: "Example Contractor B (design)", amount: 1200 },
      { name: "Example Contractor C (copywriting)", amount: 500 },
    ],
  },
  {
    category: "Cloud & Hosting",
    amount: 450,
    previousMonth: 430,
    change: 4.7,
    items: [
      { name: "Hetzner Dedicated Server", amount: 180 },
      { name: "DigitalOcean Managed DB", amount: 150 },
      { name: "Bunny CDN", amount: 120 },
    ],
  },
  {
    category: "Marketing",
    amount: 800,
    previousMonth: 850,
    change: -5.9,
    items: [
      { name: "Google Ads", amount: 400 },
      { name: "Twitter/X Ads", amount: 250 },
      { name: "Sponsored Newsletter", amount: 150 },
    ],
  },
  {
    category: "Banking Fees",
    amount: 150,
    previousMonth: 140,
    change: 7.1,
    items: [
      { name: "Stripe Processing Fees", amount: 75 },
      { name: "Mercury Bank Fee", amount: 50 },
      { name: "Crypto Transaction Fees", amount: 25 },
    ],
  },
  {
    category: "Other",
    amount: 500,
    previousMonth: 600,
    change: -16.7,
    items: [
      { name: "Coworking Space", amount: 200 },
      { name: "Legal Consultation", amount: 200 },
      { name: "Domain Renewals", amount: 100 },
    ],
  },
];

export const totalExpenses = expenseCategories.reduce(
  (sum, c) => sum + c.amount,
  0
);

export const anomalyCategories = expenseCategories.filter((c) => c.isAnomaly);
