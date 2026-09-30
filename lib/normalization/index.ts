import {
  normalizePlaidTransaction,
  type PlaidTransactionData,
} from "@/lib/connectors/plaid";
import {
  normalizeTrueLayerTransaction,
  type TrueLayerTransactionData,
} from "@/lib/connectors/truelayer";
import { amountUsdIfUsd } from "@/lib/finance/amount-usd";

// ── Canonical normalized transaction shape ───────────────────

export interface NormalizedTransaction {
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

// ── Stripe zero-decimal currencies (mirrored from lib/connectors/stripe.ts) ──

const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

function toMajorUnits(amountCents: number, currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase())
    ? amountCents
    : amountCents / 100;
}

// ── Stripe balance_transaction type → credit/debit mapping ───

const CREDIT_BT_TYPES = new Set([
  "charge",
  "payment",
  "adjustment",
  "application_fee",
  "application_fee_refund",
  "stripe_fee",
  "network_cost",
]);

const DEBIT_BT_TYPES = new Set([
  "payout",
  "transfer",
  "refund",
  "payout_cancel",
  "payout_failure",
]);

/**
 * Normalize a Stripe balance_transaction raw payload (NOT a Stripe.Event).
 * Balance transactions have: id, amount (cents), currency, description, fee,
 * net, type, created (unix timestamp), source (charge/payout/payment id).
 */
function normalizeStripeBalanceTransaction(
  payload: Record<string, unknown>
): NormalizedTransaction | null {
  const btType = payload.type as string | undefined;
  if (!btType) return null;

  const amountCents = payload.amount as number;
  if (typeof amountCents !== "number") return null;

  const currency = ((payload.currency as string) || "usd").toLowerCase();
  const normalizedCurrency = currency.toUpperCase();
  const majorAmount = toMajorUnits(Math.abs(amountCents), currency);
  const amountStr = String(majorAmount);

  let type: "credit" | "debit";
  if (CREDIT_BT_TYPES.has(btType)) {
    type = "credit";
  } else if (DEBIT_BT_TYPES.has(btType)) {
    type = "debit";
  } else {
    // Default: positive amounts are credits, negative are debits
    type = amountCents >= 0 ? "credit" : "debit";
  }

  const created = payload.created as number | undefined;
  const date = created ? new Date(created * 1000) : new Date();

  const sourceRef = (payload.id as string) || "";

  return {
    date,
    amount: amountStr,
    currency: normalizedCurrency,
    amountUsd: amountUsdIfUsd(amountStr, normalizedCurrency),
    description: (payload.description as string) ?? null,
    merchantName: null, // balance_transactions don't have merchant info
    merchantMcc: null,
    sourceRef,
    type,
    status: "posted",
    metadata: {
      fee: payload.fee ?? null,
      net: payload.net ?? null,
      balanceTransactionType: btType,
      source: payload.source ?? null,
    },
  };
}

// ── Central router ───────────────────────────────────────────

/**
 * Route a raw event to the appropriate source-specific normalizer.
 * Returns null if the event can't be normalized (e.g., unknown source).
 *
 * @param source - Data source identifier (e.g., "stripe", "plaid", "truelayer")
 * @param eventType - Event type string (e.g., "balance_transaction.charge")
 * @param rawPayload - The raw payload stored in the rawEvents table
 */
export function normalizeRawEvent(
  source: string,
  eventType: string,
  rawPayload: Record<string, unknown>
): NormalizedTransaction | null {
  switch (source) {
    case "stripe":
      return normalizeStripeBalanceTransaction(rawPayload);

    case "plaid": {
      const plaidResult = normalizePlaidTransaction(
        rawPayload as unknown as PlaidTransactionData
      );
      return {
        date: plaidResult.date,
        amount: plaidResult.amount,
        currency: plaidResult.currency,
        amountUsd: plaidResult.amountUsd,
        description: plaidResult.description,
        merchantName: plaidResult.merchantName,
        merchantMcc: plaidResult.merchantMcc,
        sourceRef: plaidResult.sourceRef,
        type: plaidResult.type,
        status: plaidResult.status,
        metadata: plaidResult.metadata,
      };
    }

    case "truelayer": {
      const tlResult = normalizeTrueLayerTransaction(
        rawPayload as unknown as TrueLayerTransactionData
      );
      return {
        date: tlResult.date,
        amount: tlResult.amount,
        currency: tlResult.currency,
        amountUsd: tlResult.amountUsd,
        description: tlResult.description,
        merchantName: tlResult.merchantName,
        merchantMcc: tlResult.merchantMcc,
        sourceRef: tlResult.sourceRef,
        type: tlResult.type,
        status: tlResult.status,
        metadata: tlResult.metadata,
      };
    }

    default:
      return null;
  }
}
