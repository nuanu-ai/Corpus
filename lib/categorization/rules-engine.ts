import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { merchantRules, canonicalTxns } from "@/lib/db/schema";
import { getCategoryByMcc } from "./mcc-codes";

export interface CategorizationResult {
  category: string;
  confidence: number; // 0-1
  method: "rule" | "mcc" | "qmd" | "ai";
  reasoning?: string;
}

export async function categorizeByRules(
  txn: {
    merchantName: string | null;
    merchantMcc: string | null;
    description: string | null;
  },
  companyId: string
): Promise<CategorizationResult | null> {
  // 1. Try merchant rules if merchantName is provided
  if (txn.merchantName) {
    // First try company-specific rules
    const companyRules = await db
      .select()
      .from(merchantRules)
      .where(
        and(
          eq(merchantRules.companyId, companyId),
          sql`${txn.merchantName} ILIKE ${merchantRules.merchantPattern}`
        )
      )
      .limit(1);

    if (companyRules.length > 0) {
      const rule = companyRules[0];
      await db
        .update(merchantRules)
        .set({ matchCount: sql`${merchantRules.matchCount} + 1` })
        .where(eq(merchantRules.id, rule.id));

      return {
        category: rule.category,
        confidence: 1.0,
        method: "rule",
        reasoning: `Matched company rule: "${rule.merchantPattern}"`,
      };
    }

    // Then try global rules (companyId is null)
    const globalRules = await db
      .select()
      .from(merchantRules)
      .where(
        and(
          isNull(merchantRules.companyId),
          sql`${txn.merchantName} ILIKE ${merchantRules.merchantPattern}`
        )
      )
      .limit(1);

    if (globalRules.length > 0) {
      const rule = globalRules[0];
      await db
        .update(merchantRules)
        .set({ matchCount: sql`${merchantRules.matchCount} + 1` })
        .where(eq(merchantRules.id, rule.id));

      return {
        category: rule.category,
        confidence: 1.0,
        method: "rule",
        reasoning: `Matched global rule: "${rule.merchantPattern}"`,
      };
    }
  }

  // 2. Fall back to MCC lookup
  if (txn.merchantMcc) {
    const mccCategory = getCategoryByMcc(txn.merchantMcc);
    if (mccCategory) {
      return {
        category: mccCategory,
        confidence: 0.9,
        method: "mcc",
        reasoning: `MCC code ${txn.merchantMcc}`,
      };
    }
  }

  // 3. Nothing matched
  return null;
}

export async function shouldSuggestRule(
  merchantName: string,
  companyId: string
): Promise<boolean> {
  // Count canonical_txns with this exact merchantName for this company
  const txnCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(canonicalTxns)
    .where(
      and(
        eq(canonicalTxns.companyId, companyId),
        eq(canonicalTxns.merchantName, merchantName)
      )
    );

  const txnCount = txnCountResult[0]?.count ?? 0;

  if (txnCount < 3) {
    return false;
  }

  // Check if a rule already exists for this merchant
  const existingRules = await db
    .select()
    .from(merchantRules)
    .where(
      and(
        eq(merchantRules.companyId, companyId),
        sql`${merchantName} ILIKE ${merchantRules.merchantPattern}`
      )
    )
    .limit(1);

  return existingRules.length === 0;
}
