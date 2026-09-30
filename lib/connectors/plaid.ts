import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";
import { amountUsdIfUsd } from "@/lib/finance/amount-usd";

/**
 * Create a configured Plaid API client.
 * Reads PLAID_CLIENT_ID, PLAID_SECRET, and PLAID_ENV from environment variables.
 */
export function getPlaidClient(): PlaidApi {
  const config = new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
        "PLAID-SECRET": process.env.PLAID_SECRET!,
      },
    },
  });
  return new PlaidApi(config);
}

// Re-export for convenience in route handlers
export { Products, CountryCode };

// ── Plaid transaction normalizer ──────────────────────────────

export interface PlaidTransactionData {
  transaction_id: string;
  account_id: string;
  date: string; // YYYY-MM-DD
  amount: number; // positive = money out (debit), negative = money in (credit) -- Plaid convention
  iso_currency_code: string | null;
  unofficial_currency_code: string | null;
  name: string;
  merchant_name: string | null;
  personal_finance_category?: {
    primary: string;
    detailed: string;
  } | null;
  merchant_entity_id?: string | null;
  payment_channel: string;
  pending: boolean;
  pending_transaction_id: string | null;
}

export interface NormalizedPlaidTransaction {
  date: Date;
  amount: string; // for numeric DB column
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

/**
 * Normalize a Plaid transaction into our canonical transaction shape.
 *
 * Key inversion: Plaid amounts are inverted relative to our convention.
 *   - Plaid positive = money spent (debit)
 *   - Plaid negative = money received (credit)
 */
export function normalizePlaidTransaction(
  txn: PlaidTransactionData
): NormalizedPlaidTransaction {
  // Plaid: positive = money out (debit), negative = money in (credit)
  const type: "credit" | "debit" = txn.amount > 0 ? "debit" : "credit";
  const absAmount = String(Math.abs(txn.amount));
  const currency = (
    txn.iso_currency_code ||
    txn.unofficial_currency_code ||
    "USD"
  ).toUpperCase();

  // Parse YYYY-MM-DD as UTC midnight
  const [year, month, day] = txn.date.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return {
    date,
    amount: absAmount,
    currency,
    amountUsd: amountUsdIfUsd(absAmount, currency),
    description: txn.name || null,
    merchantName: txn.merchant_name ?? null,
    merchantMcc: null, // Plaid doesn't expose MCC directly
    sourceRef: txn.transaction_id,
    type,
    status: txn.pending ? "pending" : "posted",
    metadata: {
      accountId: txn.account_id,
      paymentChannel: txn.payment_channel,
      personalFinanceCategory: txn.personal_finance_category ?? null,
      pendingTransactionId: txn.pending_transaction_id,
    },
  };
}
