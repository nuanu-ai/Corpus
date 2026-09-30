import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";
import { amountUsdIfUsd } from "@/lib/finance/amount-usd";

// ── TrueLayer API client + transaction normalizer ────────────

const TRUELAYER_API_BASE = "https://api.truelayer.com";
const TRUELAYER_AUTH_BASE = "https://auth.truelayer.com";
const TRUELAYER_TIMEOUT_MS = 15_000;

// ── Types ────────────────────────────────────────────────────

export interface TrueLayerAccount {
  account_id: string;
  account_type: string;
  display_name: string;
  currency: string;
  provider: {
    display_name: string;
    provider_id: string;
  };
  update_timestamp: string;
}

export interface TrueLayerTransactionData {
  transaction_id: string;
  timestamp: string; // ISO 8601
  description: string;
  transaction_type: "DEBIT" | "CREDIT";
  transaction_category: string;
  transaction_classification: string[];
  amount: number; // always positive
  currency: string;
  merchant_name?: string;
  running_balance?: { amount: number; currency: string };
  meta?: Record<string, string>;
}

export interface NormalizedTrueLayerTransaction {
  date: Date;
  amount: string;
  currency: string;
  amountUsd: string | null;
  description: string | null;
  merchantName: string | null;
  merchantMcc: string | null;
  sourceRef: string;
  type: "credit" | "debit";
  status: string;
  metadata: Record<string, unknown>;
}

export interface TrueLayerTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

// ── API client functions ─────────────────────────────────────

/**
 * Fetch all connected bank accounts from TrueLayer Data API.
 */
export async function fetchTrueLayerAccounts(
  accessToken: string
): Promise<TrueLayerAccount[]> {
  const response = await fetchWithTimeoutAndRetry(
    `${TRUELAYER_API_BASE}/data/v1/accounts`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    {
      timeoutMs: TRUELAYER_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TrueLayer accounts fetch failed (${response.status}): ${text.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as { results: TrueLayerAccount[] };
  return data.results;
}

/**
 * Fetch transactions for a specific account within a date range.
 * @param from - ISO 8601 date string (inclusive)
 * @param to - ISO 8601 date string (inclusive)
 */
export async function fetchTrueLayerTransactions(
  accessToken: string,
  accountId: string,
  from: string,
  to: string
): Promise<TrueLayerTransactionData[]> {
  const params = new URLSearchParams({ from, to });
  const url = `${TRUELAYER_API_BASE}/data/v1/accounts/${accountId}/transactions?${params}`;

  const response = await fetchWithTimeoutAndRetry(
    url,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    {
      timeoutMs: TRUELAYER_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TrueLayer transactions fetch failed (${response.status}): ${text.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as { results: TrueLayerTransactionData[] };
  return data.results;
}

/**
 * Refresh a TrueLayer access token using the refresh token.
 */
export async function refreshTrueLayerToken(
  refreshToken: string
): Promise<TrueLayerTokenResponse> {
  const clientId = process.env.TRUELAYER_CLIENT_ID;
  const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing TRUELAYER_CLIENT_ID or TRUELAYER_CLIENT_SECRET environment variables"
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetchWithTimeoutAndRetry(
    `${TRUELAYER_AUTH_BASE}/connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    {
      timeoutMs: TRUELAYER_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TrueLayer token refresh failed (${response.status}): ${text.slice(0, 200)}`
    );
  }

  return (await response.json()) as TrueLayerTokenResponse;
}

// ── Transaction normalizer ───────────────────────────────────

/**
 * Normalize a TrueLayer transaction into our canonical transaction shape.
 *
 * TrueLayer amounts are always positive. The transaction_type field
 * indicates whether money was debited or credited.
 */
export function normalizeTrueLayerTransaction(
  txn: TrueLayerTransactionData
): NormalizedTrueLayerTransaction {
  const type: "credit" | "debit" =
    txn.transaction_type === "CREDIT" ? "credit" : "debit";

  const absAmount = String(txn.amount);
  const currency = txn.currency.toUpperCase();

  // Parse ISO 8601 timestamp as UTC
  const date = new Date(txn.timestamp);

  return {
    date,
    amount: absAmount,
    currency,
    amountUsd: amountUsdIfUsd(absAmount, currency),
    description: txn.description || null,
    merchantName: txn.merchant_name ?? null,
    merchantMcc: null, // TrueLayer does not expose MCC
    sourceRef: txn.transaction_id,
    type,
    status: "posted", // TrueLayer only returns settled transactions
    metadata: {
      transactionCategory: txn.transaction_category,
      transactionClassification: txn.transaction_classification,
      runningBalance: txn.running_balance ?? null,
      meta: txn.meta ?? null,
    },
  };
}
