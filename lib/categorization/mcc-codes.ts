export const MCC_CATEGORY_MAP: Record<string, string> = {
  // Software & Technology
  "5734": "Software",
  "5817": "Software",
  "5818": "Software",
  "7372": "SaaS",
  "4816": "Technology",

  // Office & Supplies
  "5943": "Office Supplies",
  "5111": "Office Supplies",

  // Travel
  "3000": "Travel - Hotels",
  "3501": "Travel - Hotels",
  "4511": "Travel - Airlines",
  "4112": "Travel - Rail",
  "4121": "Travel - Rideshare",
  "7512": "Travel - Car Rental",

  // Food & Meals
  "5812": "Meals & Entertainment",
  "5813": "Meals & Entertainment",
  "5814": "Meals & Entertainment",

  // Professional Services
  "8111": "Legal",
  "8931": "Accounting",
  "7392": "Consulting",
  "8742": "Consulting",

  // Marketing & Advertising
  "7311": "Advertising",
  "7312": "Advertising",
  "5964": "Marketing",

  // Telecommunications
  "4812": "Telecommunications",
  "4814": "Telecommunications",
  "4899": "Telecommunications",

  // Insurance
  "6300": "Insurance",
  "6399": "Insurance",

  // Utilities
  "4900": "Utilities",

  // Shipping & Postage
  "4215": "Shipping",
  "4214": "Shipping",
  "9402": "Postage",

  // Banking & Financial
  "6012": "Banking Fees",
  "6051": "Banking Fees",
};

export function getCategoryByMcc(mcc: string): string | null {
  return MCC_CATEGORY_MAP[mcc] ?? null;
}
