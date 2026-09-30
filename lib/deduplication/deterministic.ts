import { db } from "@/lib/db";
import { canonicalTxns } from "@/lib/db/schema";
import { eq, and, ne, sql } from "drizzle-orm";

export interface DedupMatch {
  txnId: string;
  matchedTxnId: string;
  confidence: number;
  reason: string;
  method: "deterministic" | "fuzzy";
}

/**
 * Find deterministic matches for a new canonical transaction.
 * Checks:
 * 1. source_ref matching across different connections (e.g., Stripe charge ID found in bank statement)
 * 2. pending_transaction_id -> posted transition (Plaid specific: metadata.pendingTransactionId)
 */
export async function findDeterministicMatches(
  txn: {
    id: string;
    companyId: string;
    connectionId: string | null;
    sourceRef: string | null;
    amount: string;
    currency: string;
    type: string;
    metadata: Record<string, unknown>;
  }
): Promise<DedupMatch[]> {
  const matches: DedupMatch[] = [];

  // 1. Cross-source sourceRef match
  if (txn.sourceRef) {
    const sourceRefMatches = await db
      .select()
      .from(canonicalTxns)
      .where(
        and(
          eq(canonicalTxns.companyId, txn.companyId),
          eq(canonicalTxns.sourceRef, txn.sourceRef),
          ne(canonicalTxns.id, txn.id),
          txn.connectionId
            ? ne(canonicalTxns.connectionId, txn.connectionId)
            : sql`true`
        )
      );

    for (const match of sourceRefMatches) {
      matches.push({
        txnId: txn.id,
        matchedTxnId: match.id,
        confidence: 1.0,
        reason: `Cross-source duplicate: same sourceRef "${txn.sourceRef}" from different connection`,
        method: "deterministic",
      });
    }
  }

  // 2. Pending -> posted transition (Plaid-specific)
  const pendingTxnId = txn.metadata?.pendingTransactionId;
  if (typeof pendingTxnId === "string" && pendingTxnId) {
    const pendingMatches = await db
      .select()
      .from(canonicalTxns)
      .where(
        and(
          eq(canonicalTxns.companyId, txn.companyId),
          eq(canonicalTxns.sourceRef, pendingTxnId),
          ne(canonicalTxns.id, txn.id)
        )
      );

    for (const match of pendingMatches) {
      // Avoid adding duplicates if already matched by sourceRef
      if (!matches.some((m) => m.matchedTxnId === match.id)) {
        matches.push({
          txnId: txn.id,
          matchedTxnId: match.id,
          confidence: 1.0,
          reason: `Pending-to-posted transition: pendingTransactionId "${pendingTxnId}" matches sourceRef`,
          method: "deterministic",
        });
      }
    }
  }

  return matches;
}
