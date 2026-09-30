export interface ChannelROAS {
  channel: string;
  adSpend: number;
  attributedRevenue: number;
  platformROAS: number;
  costs: {
    platformFees: number;
    refunds: number;
    infrastructure: number;
    support: number;
  };
  totalCosts: number;
  realRevenue: number;
  realROAS: number;
  contributionMargin: number;
}

export const channelROAS: ChannelROAS[] = [
  {
    channel: "Google Ads",
    adSpend: 400,
    attributedRevenue: 2800,
    platformROAS: 7.0,
    costs: { platformFees: 81, refunds: 140, infrastructure: 42, support: 28 },
    totalCosts: 291,
    realRevenue: 2509,
    realROAS: 6.27,
    contributionMargin: 52.8,
  },
  {
    channel: "Twitter/X Ads",
    adSpend: 250,
    attributedRevenue: 1100,
    platformROAS: 4.4,
    costs: { platformFees: 32, refunds: 165, infrastructure: 22, support: 44 },
    totalCosts: 263,
    realRevenue: 837,
    realROAS: 3.35,
    contributionMargin: 23.9,
  },
  {
    channel: "Sponsored Newsletter",
    adSpend: 150,
    attributedRevenue: 620,
    platformROAS: 4.13,
    costs: { platformFees: 18, refunds: 0, infrastructure: 12, support: 8 },
    totalCosts: 38,
    realRevenue: 582,
    realROAS: 3.88,
    contributionMargin: 43.9,
  },
];

export const organicBaseline = {
  channel: "Organic",
  revenue: 18530,
  costs: { platformFees: 537, refunds: 185, infrastructure: 280, support: 142 },
  totalCosts: 1144,
  realRevenue: 17386,
  contributionMargin: 71.2,
};

export const roasSummary = {
  totalAdSpend: 800,
  totalAttributedRevenue: 4520,
  blendedPlatformROAS: 5.65,
  blendedRealROAS: 4.91,
  maxSustainableCAC: 312,
};

export const monthlyROASTrend = [
  { month: "Sep 2025", platformROAS: 4.8, realROAS: 3.9 },
  { month: "Oct 2025", platformROAS: 5.1, realROAS: 4.1 },
  { month: "Nov 2025", platformROAS: 5.3, realROAS: 4.3 },
  { month: "Dec 2025", platformROAS: 5.0, realROAS: 4.0 },
  { month: "Jan 2026", platformROAS: 5.4, realROAS: 4.5 },
  { month: "Feb 2026", platformROAS: 5.65, realROAS: 4.91 },
];

export function buildROASSummary(): string {
  return [
    `\nReal ROAS (Ad Performance):`,
    `  Total ad spend: $${roasSummary.totalAdSpend}/mo across ${channelROAS.length} channels`,
    `  Blended platform ROAS: ${roasSummary.blendedPlatformROAS}x → Real ROAS: ${roasSummary.blendedRealROAS}x (after fees, refunds, infra, support)`,
    `  Best channel: Google Ads (real ${channelROAS[0].realROAS}x, ${channelROAS[0].contributionMargin}% margin)`,
    `  Worst channel: Twitter/X (real ${channelROAS[1].realROAS}x, ${channelROAS[1].contributionMargin}% margin, high refunds)`,
    `  Organic baseline: ${organicBaseline.contributionMargin}% margin — paid channels should beat this to be worth scaling`,
    `  Max sustainable CAC: $${roasSummary.maxSustainableCAC}`,
  ].join("\n");
}
