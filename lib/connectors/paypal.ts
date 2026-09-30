import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";
import { amountUsdIfUsd } from "@/lib/finance/amount-usd";

/** PayPal API types */
export interface PayPalTransaction {
  transaction_id: string;
  transaction_info: {
    transaction_id: string;
    transaction_event_code: string;
    transaction_initiation_date: string;
    transaction_updated_date: string;
    transaction_amount: {
      currency_code: string;
      value: string; // "-50.00" or "100.00"
    };
    transaction_status: string; // "S" (success), "P" (pending), "D" (denied)
    transaction_subject?: string;
    transaction_note?: string;
  };
  payer_info?: {
    payer_name?: {
      given_name?: string;
      surname?: string;
      alternate_full_name?: string;
    };
    email_address?: string;
  };
  cart_info?: {
    item_details?: Array<{
      item_name?: string;
      item_description?: string;
    }>;
  };
}

export interface NormalizedPayPalTransaction {
  date: Date;
  amount: string;
  currency: string;
  amountUsd: string | null;
  description: string | null;
  merchantName: string | null;
  merchantMcc: string | null;
  sourceRef: string;
  type: "credit" | "debit";
  status: "pending" | "posted" | "denied";
  metadata: Record<string, unknown>;
}

const PAYPAL_API_BASE = "https://api-m.paypal.com";
const PAYPAL_TIMEOUT_MS = 15_000;

/** Fetch PayPal transactions using the Transaction Search API. */
export async function fetchPayPalTransactions(
  accessToken: string,
  startDate: string,
  endDate: string,
  page?: number,
  pageSize?: number
): Promise<{ transactions: PayPalTransaction[]; totalPages: number }> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    page_size: String(pageSize || 100),
    page: String(page || 1),
    fields: "transaction_info,payer_info,cart_info",
  });

  const res = await fetchWithTimeoutAndRetry(
    `${PAYPAL_API_BASE}/v1/reporting/transactions?${params}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
    {
      timeoutMs: PAYPAL_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );
  if (!res.ok)
    throw new Error(`PayPal transactions fetch failed (${res.status})`);
  const data = (await res.json()) as {
    transaction_details: PayPalTransaction[];
    total_pages: number;
  };
  return {
    transactions: data.transaction_details || [],
    totalPages: data.total_pages || 1,
  };
}

/** Refresh a PayPal OAuth token. */
export async function refreshPayPalToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const clientId = process.env.PAYPAL_CLIENT_ID!;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET!;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64"
  );

  const res = await fetchWithTimeoutAndRetry(
    `${PAYPAL_API_BASE}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    },
    {
      timeoutMs: PAYPAL_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );
  if (!res.ok)
    throw new Error(`PayPal token refresh failed (${res.status})`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/** Normalize a PayPal transaction to canonical format. */
export function normalizePayPalTransaction(
  txn: PayPalTransaction
): NormalizedPayPalTransaction {
  const info = txn.transaction_info;
  const amountValue = parseFloat(info.transaction_amount.value);
  const type: "credit" | "debit" = amountValue >= 0 ? "credit" : "debit";
  const absAmount = String(Math.abs(amountValue));
  const currency = info.transaction_amount.currency_code.toUpperCase();

  const statusMap: Record<string, "pending" | "posted" | "denied"> = {
    S: "posted",
    P: "pending",
    D: "denied",
  };
  const status = statusMap[info.transaction_status] || "pending";

  const payerName =
    txn.payer_info?.payer_name?.alternate_full_name ||
    (txn.payer_info?.payer_name?.given_name &&
    txn.payer_info?.payer_name?.surname
      ? `${txn.payer_info.payer_name.given_name} ${txn.payer_info.payer_name.surname}`
      : null);

  const itemDescription = txn.cart_info?.item_details?.[0]?.item_name || null;

  return {
    date: new Date(info.transaction_initiation_date),
    amount: absAmount,
    currency,
    amountUsd: amountUsdIfUsd(absAmount, currency),
    description:
      info.transaction_subject || info.transaction_note || itemDescription,
    merchantName: payerName,
    merchantMcc: null,
    sourceRef: info.transaction_id,
    type,
    status,
    metadata: {
      eventCode: info.transaction_event_code,
      payerEmail: txn.payer_info?.email_address || null,
    },
  };
}
