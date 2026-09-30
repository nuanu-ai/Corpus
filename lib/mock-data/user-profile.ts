export const userProfile = {
  name: "Example User",
  role: "Solo Founder",
  livingCountry: "Thailand",
  citizenship: "Russia",
  isDigitalNomad: true,
  company: {
    name: "Example Software Ltd",
    jurisdiction: "Estonia",
    type: "SaaS",
    entityType: "OÜ (e-Residency)",
    description:
      "A small SaaS company selling workflow automation software to distributed teams.",
  },
  revenueRange: "$15-50K/mo",
  monthlyRevenue: 23400,
  tools: {
    bankAccount: true,
    stripe: true,
    cryptoWallet: true,
  },
};

export type UserProfile = typeof userProfile;
