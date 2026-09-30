import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

/** Mercury Bank API types */
export interface MercuryTransaction {
  id: string;
  amount: number; // positive = credit, negative = debit
  currency: string; // always "USD" for Mercury
  status: "pending" | "sent" | "cancelled" | "failed";
  note: string | null;
  counterpartyName: string | null;
  counterpartyNickname: string | null;
  kind:
    | "externalTransfer"
    | "internalTransfer"
    | "outgoingPayment"
    | "incomingPayment"
    | "checkDeposit"
    | "fee"
    | "other";
  postedAt: string | null; // ISO date, null if pending
  createdAt: string;
  bankDescription: string | null;
  externalMemo: string | null;
}

export interface MercuryAccount {
  id: string;
  name: string;
  status: "active" | "archived";
  type: "checking" | "savings";
  currentBalance: number;
  availableBalance: number;
}

export interface NormalizedMercuryTransaction {
  date: Date;
  amount: string;
  currency: string;
  amountUsd: string;
  description: string | null;
  merchantName: string | null;
  merchantMcc: string | null;
  sourceRef: string;
  type: "credit" | "debit";
  status: "pending" | "posted" | "cancelled" | "failed";
  metadata: Record<string, unknown>;
}

const MERCURY_API_BASE = "https://backend.mercury.com/api/v1";
const MERCURY_TIMEOUT_MS = 15_000;

/** Fetch all accounts for the authenticated Mercury user. */
export async function fetchMercuryAccounts(
  apiKey: string
): Promise<MercuryAccount[]> {
  const res = await fetchWithTimeoutAndRetry(
    `${MERCURY_API_BASE}/accounts`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    {
      timeoutMs: MERCURY_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );
  if (!res.ok)
    throw new Error(`Mercury accounts fetch failed (${res.status})`);
  const data = (await res.json()) as { accounts: MercuryAccount[] };
  return data.accounts;
}

/** Fetch transactions for a specific account with pagination. */
export async function fetchMercuryTransactions(
  apiKey: string,
  accountId: string,
  options?: { offset?: number; limit?: number; start?: string; end?: string }
): Promise<{ transactions: MercuryTransaction[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.offset) params.set("offset", String(options.offset));
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.start) params.set("start", options.start);
  if (options?.end) params.set("end", options.end);

  const url = `${MERCURY_API_BASE}/account/${accountId}/transactions?${params}`;
  const res = await fetchWithTimeoutAndRetry(
    url,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
    {
      timeoutMs: MERCURY_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );
  if (!res.ok)
    throw new Error(`Mercury transactions fetch failed (${res.status})`);
  const data = (await res.json()) as {
    transactions: MercuryTransaction[];
    total: number;
  };
  return data;
}

/** Normalize a Mercury transaction to canonical format. */
export function normalizeMercuryTransaction(
  txn: MercuryTransaction
): NormalizedMercuryTransaction {
  const type: "credit" | "debit" = txn.amount >= 0 ? "credit" : "debit";
  const absAmount = String(Math.abs(txn.amount));
  const date = txn.postedAt ? new Date(txn.postedAt) : new Date(txn.createdAt);
  const status: "pending" | "posted" | "cancelled" | "failed" =
    txn.status === "pending"
      ? "pending"
      : txn.status === "cancelled"
        ? "cancelled"
        : txn.status === "failed"
          ? "failed"
          : "posted";

  return {
    date,
    amount: absAmount,
    currency: txn.currency?.toUpperCase() || "USD",
    amountUsd: absAmount, // Mercury is always USD
    description: txn.bankDescription || txn.note || txn.externalMemo || null,
    merchantName: txn.counterpartyName || txn.counterpartyNickname || null,
    merchantMcc: null,
    sourceRef: txn.id,
    type,
    status,
    metadata: {
      kind: txn.kind,
      counterpartyNickname: txn.counterpartyNickname,
      externalMemo: txn.externalMemo,
    },
  };
}
