import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";
import { amountUsdIfUsd } from "@/lib/finance/amount-usd";

/** Rutter unified API types */
export interface RutterTransaction {
  id: string;
  platform_id: string;
  account_id: string;
  amount: number; // in minor units (cents)
  currency_code: string;
  date: string; // ISO date
  description: string | null;
  type: "debit" | "credit";
  status: "pending" | "posted" | "void";
  line_items?: Array<{
    description?: string;
    amount: number;
    account_id?: string;
  }>;
  contact?: {
    id?: string;
    name?: string;
    email?: string;
  };
  updated_at: string;
  created_at: string;
}

export interface NormalizedRutterTransaction {
  date: Date;
  amount: string;
  currency: string;
  amountUsd: string | null;
  description: string | null;
  merchantName: string | null;
  merchantMcc: string | null;
  sourceRef: string;
  type: "credit" | "debit";
  status: "pending" | "posted" | "void";
  metadata: Record<string, unknown>;
}

const RUTTER_API_BASE = "https://production.rutterapi.com";
const RUTTER_TIMEOUT_MS = 15_000;

/** Fetch transactions from Rutter's unified API. */
export async function fetchRutterTransactions(
  accessToken: string,
  options?: { cursor?: string; limit?: number; updatedAtMin?: string }
): Promise<{ transactions: RutterTransaction[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.cursor) params.set("cursor", options.cursor);
  if (options?.updatedAtMin) params.set("updated_at_min", options.updatedAtMin);

  const res = await fetchWithTimeoutAndRetry(
    `${RUTTER_API_BASE}/versioned/transactions?${params}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    {
      timeoutMs: RUTTER_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );
  if (!res.ok) throw new Error(`Rutter transactions fetch failed (${res.status})`);
  const data = (await res.json()) as {
    connection: { id: string; platform: string };
    transactions: RutterTransaction[];
    next_cursor: string | null;
  };
  return { transactions: data.transactions, nextCursor: data.next_cursor };
}

/** Exchange a Rutter public token for an access token. */
export async function exchangeRutterToken(
  publicToken: string
): Promise<{ accessToken: string; connectionId: string; platform: string }> {
  const clientId = process.env.RUTTER_CLIENT_ID!;
  const clientSecret = process.env.RUTTER_CLIENT_SECRET!;

  const res = await fetchWithTimeoutAndRetry(
    `${RUTTER_API_BASE}/item/public_token/exchange`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        secret: clientSecret,
        public_token: publicToken,
      }),
    },
    {
      timeoutMs: RUTTER_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );
  if (!res.ok) throw new Error(`Rutter token exchange failed (${res.status})`);
  const data = (await res.json()) as {
    access_token: string;
    connection_id: string;
    platform: string;
  };
  return {
    accessToken: data.access_token,
    connectionId: data.connection_id,
    platform: data.platform,
  };
}

/** Normalize a Rutter transaction to canonical format. */
export function normalizeRutterTransaction(
  txn: RutterTransaction
): NormalizedRutterTransaction {
  // Rutter amounts are in minor units (cents)
  const amountMajor = String(Math.abs(txn.amount) / 100);
  const status: "pending" | "posted" | "void" =
    txn.status === "pending"
      ? "pending"
      : txn.status === "void"
        ? "void"
        : "posted";

  const lineItemDescription =
    txn.line_items
      ?.map((li) => li.description)
      .filter(Boolean)
      .join("; ") || null;

  return {
    date: new Date(txn.date),
    amount: amountMajor,
    currency: txn.currency_code.toUpperCase(),
    amountUsd: amountUsdIfUsd(amountMajor, txn.currency_code),
    description: txn.description || lineItemDescription,
    merchantName: txn.contact?.name || null,
    merchantMcc: null,
    sourceRef: `rutter_${txn.id}`,
    type: txn.type,
    status,
    metadata: {
      platformId: txn.platform_id,
      accountId: txn.account_id,
      contactEmail: txn.contact?.email || null,
    },
  };
}
