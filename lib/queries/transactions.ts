import { db } from "@/lib/db";
import { canonicalTxns, reconciledTxns, connections } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, ilike, or, isNull, ne } from "drizzle-orm";
import { trustedAmountUsdOrNullSql } from "@/lib/canonical-txns";

export interface TransactionListItem {
  id: string;
  date: Date;
  amount: string;
  amountUsd: string | null;
  amountUsdTrusted: boolean;
  currency: string;
  fxRate: string | null;
  description: string | null;
  merchantName: string | null;
  type: "credit" | "debit";
  status: string;
  category: string | null;
  categoryConfidence: number | null;
  dedupStatus: string | null;
  connectionId: string | null;
  provider: string | null;
}

export interface TransactionListResult {
  items: TransactionListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Get paginated, filterable transaction list.
 * Left joins canonicalTxns with reconciledTxns and connections.
 */
export async function getTransactions(
  companyId: string,
  options?: {
    page?: number;
    pageSize?: number;
    category?: string;
    type?: "credit" | "debit";
    from?: Date;
    to?: Date;
    search?: string;
  }
): Promise<TransactionListResult> {
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  // Build dynamic filter conditions
  const conditions = [
    eq(canonicalTxns.companyId, companyId),
    ne(canonicalTxns.status, "superseded"),
  ];

  if (options?.type) {
    conditions.push(eq(canonicalTxns.type, options.type));
  }
  if (options?.from) {
    conditions.push(gte(canonicalTxns.date, options.from));
  }
  if (options?.to) {
    conditions.push(lte(canonicalTxns.date, options.to));
  }
  if (options?.category) {
    conditions.push(eq(reconciledTxns.category, options.category));
  }
  if (options?.search) {
    const escaped = options.search
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_");
    const pattern = `%${escaped}%`;
    conditions.push(
      or(
        ilike(canonicalTxns.description, pattern),
        ilike(canonicalTxns.merchantName, pattern)
      )!
    );
  }

  const whereClause = and(...conditions);

  // Count total
  const [countRow] = await db
    .select({ count: sql<string>`count(*)` })
    .from(canonicalTxns)
    .leftJoin(
      reconciledTxns,
      eq(reconciledTxns.canonicalTxnId, canonicalTxns.id)
    )
    .leftJoin(connections, eq(connections.id, canonicalTxns.connectionId))
    .where(whereClause);

  const total = Number(countRow?.count ?? 0);

  // Fetch page
  const rows = await db
    .select({
      id: canonicalTxns.id,
      date: canonicalTxns.date,
      amount: canonicalTxns.amount,
      amountUsd: trustedAmountUsdOrNullSql(canonicalTxns),
      fxRate: canonicalTxns.fxRate,
      currency: canonicalTxns.currency,
      description: canonicalTxns.description,
      merchantName: canonicalTxns.merchantName,
      type: canonicalTxns.type,
      status: canonicalTxns.status,
      category: reconciledTxns.category,
      categoryConfidence: reconciledTxns.categoryConfidence,
      dedupStatus: reconciledTxns.dedupStatus,
      connectionId: canonicalTxns.connectionId,
      provider: connections.provider,
    })
    .from(canonicalTxns)
    .leftJoin(
      reconciledTxns,
      eq(reconciledTxns.canonicalTxnId, canonicalTxns.id)
    )
    .leftJoin(connections, eq(connections.id, canonicalTxns.connectionId))
    .where(whereClause)
    .orderBy(sql`${canonicalTxns.date} desc`)
    .limit(pageSize)
    .offset(offset);

  const items: TransactionListItem[] = rows.map((r) => ({
    id: r.id,
    date: r.date,
    amount: r.amount,
    amountUsd: r.amountUsd,
    amountUsdTrusted: r.amountUsd !== null,
    currency: r.currency,
    fxRate: r.fxRate,
    description: r.description,
    merchantName: r.merchantName,
    type: r.type as "credit" | "debit",
    status: r.status,
    category: r.category,
    categoryConfidence: r.categoryConfidence ? Number(r.categoryConfidence) : null,
    dedupStatus: r.dedupStatus,
    connectionId: r.connectionId,
    provider: r.provider,
  }));

  return { items, total, page, pageSize };
}
