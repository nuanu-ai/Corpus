import type Stripe from "stripe";

export interface NormalizedTransaction {
  amount: number; // in major currency units (dollars, yen, etc.)
  currency: string;
  description: string | null;
  merchantName: string | null;
  date: string; // ISO 8601
  sourceRef: string;
  type: "credit" | "debit";
}

// Stripe zero-decimal currencies where amount is already in major units.
// Stripe also has a small set of three-decimal currencies.
const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  "bhd",
  "jod",
  "kwd",
  "omr",
  "tnd",
]);

function toMajorUnits(
  amount: number,
  currency: string,
  kind: "charge" | "payment_intent" | "payout" | "invoice",
): number {
  const normalizedCurrency = currency.toLowerCase();
  if (
    kind === "payout" &&
    (normalizedCurrency === "huf" || normalizedCurrency === "twd")
  ) {
    return amount;
  }
  if (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return amount;
  }
  if (THREE_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
    return amount / 1000;
  }
  return amount / 100;
}

/**
 * Normalize a Stripe event into a canonical transaction shape.
 * Returns null for events that should not create a transaction (e.g. balance.available).
 */
export function normalizeStripeEvent(
  rawEvent: Stripe.Event
): NormalizedTransaction | null {
  switch (rawEvent.type) {
    case "charge.succeeded":
      return normalizeCharge(rawEvent);
    case "payment_intent.succeeded":
      return normalizePaymentIntent(rawEvent);
    case "payout.paid":
      return normalizePayout(rawEvent);
    case "invoice.paid":
      return normalizeInvoice(rawEvent);
    default:
      return null;
  }
}

function normalizeCharge(event: Stripe.Event): NormalizedTransaction {
  const charge = event.data.object as Stripe.Charge;
  return {
    amount: toMajorUnits(charge.amount, charge.currency, "charge"),
    currency: charge.currency.toUpperCase(),
    description: charge.description ?? null,
    merchantName: charge.billing_details?.name ?? null,
    date: new Date(charge.created * 1000).toISOString(),
    sourceRef: charge.id,
    type: "credit", // money IN for the business
  };
}

function normalizePaymentIntent(event: Stripe.Event): NormalizedTransaction {
  const pi = event.data.object as Stripe.PaymentIntent;
  return {
    amount: toMajorUnits(pi.amount, pi.currency, "payment_intent"),
    currency: pi.currency.toUpperCase(),
    description: pi.description ?? null,
    merchantName: null,
    date: new Date(pi.created * 1000).toISOString(),
    sourceRef: pi.id,
    type: "credit", // revenue
  };
}

function normalizePayout(event: Stripe.Event): NormalizedTransaction {
  const payout = event.data.object as Stripe.Payout;
  return {
    amount: toMajorUnits(payout.amount, payout.currency, "payout"),
    currency: payout.currency.toUpperCase(),
    description: payout.description ?? null,
    merchantName: null,
    date: new Date(payout.created * 1000).toISOString(),
    sourceRef: payout.id,
    type: "debit", // money OUT to bank
  };
}

function normalizeInvoice(event: Stripe.Event): NormalizedTransaction {
  const invoice = event.data.object as Stripe.Invoice;
  return {
    amount: toMajorUnits(invoice.amount_paid ?? 0, invoice.currency, "invoice"),
    currency: invoice.currency.toUpperCase(),
    description: invoice.description ?? `Invoice ${invoice.number ?? invoice.id}`,
    merchantName: invoice.customer_name ?? null,
    date: invoice.status_transitions?.paid_at
      ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
      : new Date(invoice.created * 1000).toISOString(),
    sourceRef: invoice.id,
    type: "credit", // revenue
  };
}
