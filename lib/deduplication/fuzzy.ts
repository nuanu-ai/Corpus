import { db } from "@/lib/db";
import { canonicalTxns } from "@/lib/db/schema";
import { eq, and, ne, between, gte, lte, sql } from "drizzle-orm";
import type { DedupMatch } from "./deterministic";

/**
 * Simple Jaccard word similarity between two strings.
 * Returns 0-1 where 1 = identical.
 */
export function wordSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;

  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 0;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

/**
 * Detect if a transaction looks subscription/recurring-like based on description.
 * Simple heuristic: common subscription keywords.
 */
function isSubscriptionLike(description: string | null): boolean {
  if (!description) return false;
  const lower = description.toLowerCase();
  const keywords = [
    "subscription",
    "recurring",
    "monthly",
    "annual",
    "yearly",
    "weekly",
    "membership",
    "plan",
    "renewal",
    "autopay",
    "auto-pay",
  ];
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Find fuzzy matches for a new canonical transaction.
 * Matches on: amount +/-$0.01, date within 3 days, same currency, same type.
 *
 * Anti-false-positive guards:
 * - Skip if multiple same-amount transactions on the same day for either txn
 * - For recurring/subscription-like transactions, require description similarity > 0.7
 * - Confidence < 0.8 -> flagged for review
 */
export async function findFuzzyMatches(
  txn: {
    id: string;
    companyId: string;
    connectionId: string | null;
    amount: string;
    currency: string;
    type: string;
    date: Date;
    description: string | null;
    merchantName: string | null;
  }
): Promise<DedupMatch[]> {
  // Date range: +/-3 days
  const dateMin = new Date(txn.date.getTime() - 3 * 24 * 60 * 60 * 1000);
  const dateMax = new Date(txn.date.getTime() + 3 * 24 * 60 * 60 * 1000);

  // Amount range: +/-0.01
  const amt = parseFloat(txn.amount);
  const amountMin = String(amt - 0.01);
  const amountMax = String(amt + 0.01);

  const candidates = await db
    .select()
    .from(canonicalTxns)
    .where(
      and(
        eq(canonicalTxns.companyId, txn.companyId),
        eq(canonicalTxns.currency, txn.currency),
        eq(canonicalTxns.type, txn.type),
        ne(canonicalTxns.id, txn.id),
        txn.connectionId
          ? ne(canonicalTxns.connectionId, txn.connectionId)
          : sql`true`,
        between(canonicalTxns.date, dateMin, dateMax),
        gte(canonicalTxns.amount, amountMin),
        lte(canonicalTxns.amount, amountMax)
      )
    );

  if (candidates.length === 0) return [];

  // Anti-false-positive: check if source txn has multiple same-amount txns on same day
  const sourceDaySiblings = await db
    .select()
    .from(canonicalTxns)
    .where(
      and(
        eq(canonicalTxns.companyId, txn.companyId),
        ne(canonicalTxns.id, txn.id),
        txn.connectionId
          ? eq(canonicalTxns.connectionId, txn.connectionId)
          : sql`true`,
        gte(canonicalTxns.amount, amountMin),
        lte(canonicalTxns.amount, amountMax),
        between(
          canonicalTxns.date,
          new Date(txn.date.getTime() - 12 * 60 * 60 * 1000), // same day +/- 12hrs
          new Date(txn.date.getTime() + 12 * 60 * 60 * 1000)
        )
      )
    );

  // If there are multiple same-amount txns from the source connection on the same day,
  // it's ambiguous which one is the duplicate — skip all fuzzy matches
  if (sourceDaySiblings.length > 1) return [];

  const matches: DedupMatch[] = [];

  for (const candidate of candidates) {
    // Anti-false-positive: check candidate's connection for same-day same-amount siblings
    const candidateDaySiblings = await db
      .select()
      .from(canonicalTxns)
      .where(
        and(
          eq(canonicalTxns.companyId, txn.companyId),
          ne(canonicalTxns.id, candidate.id),
          candidate.connectionId
            ? eq(canonicalTxns.connectionId, candidate.connectionId)
            : sql`true`,
          gte(canonicalTxns.amount, amountMin),
          lte(canonicalTxns.amount, amountMax),
          between(
            canonicalTxns.date,
            new Date(candidate.date.getTime() - 12 * 60 * 60 * 1000),
            new Date(candidate.date.getTime() + 12 * 60 * 60 * 1000)
          )
        )
      );

    if (candidateDaySiblings.length > 1) continue;

    // Calculate confidence based on description and merchant similarity
    let confidence = 0.85; // base confidence for amount+date match

    const descSimilarity = wordSimilarity(txn.description, candidate.description);
    const merchantSimilarity = wordSimilarity(txn.merchantName, candidate.merchantName);

    // For subscription-like transactions, require higher description similarity
    if (isSubscriptionLike(txn.description) || isSubscriptionLike(candidate.description)) {
      if (descSimilarity < 0.7) continue; // skip — likely different subscriptions
    }

    // Boost or reduce confidence based on description similarity
    if (descSimilarity > 0.5) {
      confidence = Math.min(1.0, confidence + descSimilarity * 0.1);
    } else if (descSimilarity < 0.2 && txn.description && candidate.description) {
      confidence -= 0.15;
    }

    // If merchant names differ significantly, reduce confidence
    if (
      txn.merchantName &&
      candidate.merchantName &&
      merchantSimilarity < 0.3
    ) {
      confidence -= 0.2;
    }

    // Closer date = higher confidence
    const daysDiff =
      Math.abs(txn.date.getTime() - candidate.date.getTime()) /
      (24 * 60 * 60 * 1000);
    if (daysDiff <= 1) {
      confidence += 0.05;
    } else if (daysDiff > 2) {
      confidence -= 0.05;
    }

    // Clamp confidence
    confidence = Math.max(0, Math.min(1.0, confidence));

    // Discard matches below 0.5
    if (confidence < 0.5) continue;

    const reason = buildFuzzyReason(txn, candidate, confidence, descSimilarity, daysDiff);

    matches.push({
      txnId: txn.id,
      matchedTxnId: candidate.id,
      confidence: Math.round(confidence * 100) / 100,
      reason,
      method: "fuzzy",
    });
  }

  return matches;
}

function buildFuzzyReason(
  txn: { amount: string; description: string | null },
  candidate: { amount: string; description: string | null },
  confidence: number,
  descSimilarity: number,
  daysDiff: number
): string {
  const parts: string[] = [
    `Amount match ($${txn.amount} vs $${candidate.amount})`,
    `${daysDiff.toFixed(1)} day(s) apart`,
  ];
  if (descSimilarity > 0) {
    parts.push(`description similarity ${(descSimilarity * 100).toFixed(0)}%`);
  }
  if (confidence < 0.8) {
    parts.push("flagged for review");
  }
  return `Fuzzy match: ${parts.join(", ")}`;
}
