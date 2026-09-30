import { db } from "@/lib/db";
import { canonicalTxns, reconciledTxns, connections } from "@/lib/db/schema";
import { eq, and, sql, ne, or, isNull } from "drizzle-orm";
import { trustedAmountUsdOrNullSql } from "@/lib/canonical-txns";

export interface ConnectionSummary {
  id: string;
  provider: string;
  status: string;
  lastSyncAt: Date | null;
  transactionCount: number;
  totalCredits: number | null;
  totalDebits: number | null;
  netBalance: number | null;
  usdTotalsTrusted: boolean;
  untrustedTxnCount: number;
}

/**
 * Get summary of all connections with transaction stats.
 * Aggregates credit/debit totals per connection, filtering out duplicates.
 */
export async function getConnectionSummaries(
  companyId: string
): Promise<ConnectionSummary[]> {
  const rows = await db
    .select({
      id: connections.id,
      provider: connections.provider,
      status: connections.status,
      lastSyncAt: connections.lastSyncAt,
      transactionCount: sql<string>`count(${canonicalTxns.id})`,
      totalCredits: sql<string>`coalesce(sum(case when ${canonicalTxns.type} = 'credit' then ${trustedAmountUsdOrNullSql(canonicalTxns)} else 0 end), 0)`,
      totalDebits: sql<string>`coalesce(sum(case when ${canonicalTxns.type} = 'debit' then ${trustedAmountUsdOrNullSql(canonicalTxns)} else 0 end), 0)`,
      untrustedTxnCount: sql<string>`count(case when ${canonicalTxns.currency} <> 'USD' and ${canonicalTxns.fxRate} is null then 1 end)`,
    })
    .from(connections)
    .leftJoin(
      canonicalTxns,
      and(
        eq(canonicalTxns.connectionId, connections.id),
        eq(canonicalTxns.companyId, companyId),
        ne(canonicalTxns.status, "superseded"),
      )
    )
    .leftJoin(
      reconciledTxns,
      eq(reconciledTxns.canonicalTxnId, canonicalTxns.id)
    )
    .where(
      and(
        eq(connections.companyId, companyId),
        ne(connections.status, "disconnected"),
        or(
          isNull(reconciledTxns.dedupStatus),
          ne(reconciledTxns.dedupStatus, "duplicate"),
          isNull(canonicalTxns.id)
        )
      )
    )
    .groupBy(
      connections.id,
      connections.provider,
      connections.status,
      connections.lastSyncAt
    );

  return rows.map((r) => {
    const untrustedTxnCount = Number(r.untrustedTxnCount);
    const totalCredits = Number(r.totalCredits);
    const totalDebits = Number(r.totalDebits);

    return {
      id: r.id,
      provider: r.provider,
      status: r.status,
      lastSyncAt: r.lastSyncAt,
      transactionCount: Number(r.transactionCount),
      totalCredits: untrustedTxnCount > 0 ? null : totalCredits,
      totalDebits: untrustedTxnCount > 0 ? null : totalDebits,
      netBalance: untrustedTxnCount > 0 ? null : totalCredits - totalDebits,
      usdTotalsTrusted: untrustedTxnCount === 0,
      untrustedTxnCount,
    };
  });
}
