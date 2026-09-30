import type { DomainEngine, EntityValidator } from "../domain-engine.js";
import type { BaseEntity } from "../../schema/domain-types/common.js";

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Register expense-domain validators on the engine.
 *
 * Rules:
 * - vendor must have a name
 * - bill must have at least one line_item
 */
export function registerExpenseValidators(engine: DomainEngine): void {
  const validator: EntityValidator = (entity: BaseEntity) => {
    const errors: string[] = [];
    const data = entity as Record<string, unknown>;

    switch (data.type) {
      case "vnd":
      case "vendor": {
        if (!data.name || (typeof data.name === "string" && data.name.trim() === "")) {
          errors.push("Vendor must have a name");
        }
        break;
      }
      case "bill": {
        const items = data.line_items;
        if (!Array.isArray(items) || items.length === 0) {
          errors.push("Bill must have at least one line item");
        }
        break;
      }
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  };

  engine.registerValidator("expenses", validator);
}

// ---------------------------------------------------------------------------
// Expense categorization
// ---------------------------------------------------------------------------

/** Keyword-to-category mapping for simple expense categorization. */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "Software & SaaS": [
    "software", "saas", "subscription", "license", "cloud", "hosting",
    "aws", "gcp", "azure", "heroku", "vercel", "github", "gitlab",
    "slack", "notion", "figma", "jira", "confluence",
  ],
  "Office & Supplies": [
    "office", "supplies", "furniture", "desk", "chair", "paper",
    "printer", "stationery",
  ],
  "Travel & Transportation": [
    "travel", "flight", "hotel", "uber", "lyft", "taxi", "airbnb",
    "rental car", "parking", "fuel", "gas",
  ],
  "Marketing & Advertising": [
    "marketing", "advertising", "ads", "google ads", "facebook ads",
    "campaign", "promotion", "branding", "seo", "social media",
  ],
  "Meals & Entertainment": [
    "meal", "lunch", "dinner", "restaurant", "food", "coffee",
    "catering", "entertainment",
  ],
  "Professional Services": [
    "consulting", "legal", "accounting", "audit", "advisory",
    "lawyer", "attorney", "cpa",
  ],
  "Insurance": [
    "insurance", "premium", "coverage", "liability",
  ],
  "Utilities": [
    "electricity", "water", "internet", "phone", "telecom",
    "utility", "utilities",
  ],
  "Payroll & Benefits": [
    "payroll", "salary", "wages", "benefits", "health", "dental",
    "401k", "pension", "bonus",
  ],
  "Rent & Facilities": [
    "rent", "lease", "coworking", "maintenance", "repair",
    "cleaning", "security",
  ],
};

/**
 * Simple keyword-based expense categorization.
 *
 * Matches the description against known keyword lists and returns
 * the best matching category. Falls back to "Uncategorized" if
 * no keywords match.
 */
export function categorizeExpense(description: string): string {
  const lower = description.toLowerCase();

  let bestCategory = "Uncategorized";
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}
