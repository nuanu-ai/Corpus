import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { reconciledTxns } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { findDeterministicMatches } from "./deterministic";
import { findFuzzyMatches } from "./fuzzy";
import type { DedupMatch } from "./deterministic";

export type { DedupMatch };

export interface DedupResult {
  txnId: string;
  status: "unique" | "duplicate" | "review";
  matches: DedupMatch[];
  groupId: string | null;
}

/**
 * Run deduplication for a canonical transaction.
 * First tries deterministic matching, then fuzzy matching.
 * Updates the reconciled_txns table with results.
 */
export async function deduplicateTransaction(
  txn: {
    id: string;
    companyId: string;
    connectionId: string | null;
    sourceRef: string | null;
    amount: string;
    currency: string;
    type: string;
    date: Date;
    description: string | null;
    merchantName: string | null;
    metadata: Record<string, unknown>;
  }
): Promise<DedupResult> {
  // 1. Try deterministic matches first
  const deterministicMatches = await findDeterministicMatches(txn);

  if (deterministicMatches.length > 0) {
    const groupId = await resolveGroupId(deterministicMatches, txn);
    await updateDedupRecords(txn, deterministicMatches, "duplicate", groupId);
    return {
      txnId: txn.id,
      status: "duplicate",
      matches: deterministicMatches,
      groupId,
    };
  }

  // 2. Try fuzzy matches
  const fuzzyMatches = await findFuzzyMatches(txn);

  if (fuzzyMatches.length > 0) {
    // Determine status based on highest confidence match
    const maxConfidence = Math.max(...fuzzyMatches.map((m) => m.confidence));
    const status = maxConfidence >= 0.8 ? "duplicate" : "review";
    const groupId = await resolveGroupId(fuzzyMatches, txn);
    await updateDedupRecords(txn, fuzzyMatches, status, groupId);
    return {
      txnId: txn.id,
      status,
      matches: fuzzyMatches,
      groupId,
    };
  }

  // 3. No matches — unique
  await updateDedupRecords(txn, [], "unique", null);
  return {
    txnId: txn.id,
    status: "unique",
    matches: [],
    groupId: null,
  };
}

/**
 * Find or create a dedup group ID.
 * If any matched transaction already has a dedupGroupId, use that.
 * Otherwise, generate a new UUID.
 */
async function resolveGroupId(
  matches: DedupMatch[],
  txn: { companyId: string }
): Promise<string> {
  if (matches.length === 0) return randomUUID();

  // Batch query: fetch all matched txns' dedupGroupIds in one query
  const matchedIds = matches.map((m) => m.matchedTxnId);
  const existing = await db
    .select({ dedupGroupId: reconciledTxns.dedupGroupId })
    .from(reconciledTxns)
    .where(
      and(
        inArray(reconciledTxns.canonicalTxnId, matchedIds),
        eq(reconciledTxns.companyId, txn.companyId)
      )
    );

  const existingGroupId = existing.find((e) => e.dedupGroupId)?.dedupGroupId;
  return existingGroupId ?? randomUUID();
}

/**
 * Update reconciled_txns records for the transaction and its matches.
 */
async function updateDedupRecords(
  txn: { id: string; companyId: string },
  matches: DedupMatch[],
  status: "unique" | "duplicate" | "review",
  groupId: string | null
): Promise<void> {
  // Update the new transaction's reconciled record
  await db
    .update(reconciledTxns)
    .set({
      dedupGroupId: groupId,
      dedupStatus: status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reconciledTxns.canonicalTxnId, txn.id),
        eq(reconciledTxns.companyId, txn.companyId)
      )
    );

  // Batch update matched transactions to be part of the same group
  if (matches.length > 0) {
    const matchedIds = matches.map((m) => m.matchedTxnId);
    await db
      .update(reconciledTxns)
      .set({
        dedupGroupId: groupId,
        dedupStatus: status === "review" ? "review" : "duplicate",
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(reconciledTxns.canonicalTxnId, matchedIds),
          eq(reconciledTxns.companyId, txn.companyId)
        )
      );
  }
}
