import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";
import { amountUsdIfUsd } from "@/lib/finance/amount-usd";

/** Shopify Admin API types */
export interface ShopifyOrder {
  id: number;
  name: string; // "#1001"
  created_at: string;
  updated_at: string;
  financial_status:
    | "pending"
    | "authorized"
    | "paid"
    | "partially_paid"
    | "refunded"
    | "partially_refunded"
    | "voided";
  total_price: string; // "99.99"
  subtotal_price: string;
  total_tax: string;
  currency: string;
  customer?: {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  line_items: Array<{
    name: string;
    quantity: number;
    price: string;
  }>;
  refunds?: Array<{
    id: number;
    created_at: string;
    note?: string;
    refund_line_items: Array<{
      subtotal: string;
      total_tax: string;
    }>;
  }>;
  gateway: string;
  source_name: string;
}

export interface ShopifyPayout {
  id: number;
  status: "scheduled" | "in_transit" | "paid" | "failed" | "cancelled";
  amount: string;
  currency: string;
  date: string;
}

export interface NormalizedShopifyTransaction {
  date: Date;
  amount: string;
  currency: string;
  amountUsd: string | null;
  description: string | null;
  merchantName: string | null;
  merchantMcc: string | null;
  sourceRef: string;
  type: "credit" | "debit";
  status: "pending" | "posted" | "refunded" | "voided" | "failed" | "cancelled";
  metadata: Record<string, unknown>;
}

const SHOPIFY_API_VERSION = "2024-01";
const SHOP_DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
const SHOPIFY_TIMEOUT_MS = 15_000;

function validateShopDomain(domain: string): void {
  if (!SHOP_DOMAIN_RE.test(domain)) {
    throw new Error(`Invalid Shopify domain: ${domain}`);
  }
}

/** Fetch orders from Shopify Admin API with pagination. */
export async function fetchShopifyOrders(
  shopDomain: string,
  accessToken: string,
  options?: { sinceId?: string; limit?: number; updatedAtMin?: string }
): Promise<ShopifyOrder[]> {
  validateShopDomain(shopDomain);
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit || 250));
  params.set("status", "any");
  if (options?.sinceId) params.set("since_id", options.sinceId);
  if (options?.updatedAtMin)
    params.set("updated_at_min", options.updatedAtMin);

  const res = await fetchWithTimeoutAndRetry(
    `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params}`,
    { headers: { "X-Shopify-Access-Token": accessToken } },
    {
      timeoutMs: SHOPIFY_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );
  if (!res.ok) throw new Error(`Shopify orders fetch failed (${res.status})`);
  const data = (await res.json()) as { orders: ShopifyOrder[] };
  return data.orders;
}

/** Fetch payouts from Shopify Payments. */
export async function fetchShopifyPayouts(
  shopDomain: string,
  accessToken: string,
  options?: { sinceId?: string; limit?: number }
): Promise<ShopifyPayout[]> {
  validateShopDomain(shopDomain);
  const params = new URLSearchParams();
  params.set("limit", String(options?.limit || 250));
  if (options?.sinceId) params.set("since_id", options.sinceId);

  const res = await fetchWithTimeoutAndRetry(
    `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/shopify_payments/payouts.json?${params}`,
    { headers: { "X-Shopify-Access-Token": accessToken } },
    {
      timeoutMs: SHOPIFY_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );
  if (!res.ok)
    throw new Error(`Shopify payouts fetch failed (${res.status})`);
  const data = (await res.json()) as { payouts: ShopifyPayout[] };
  return data.payouts;
}

/** Normalize a Shopify order to canonical format. */
export function normalizeShopifyOrder(
  order: ShopifyOrder
): NormalizedShopifyTransaction {
  const paidStatuses = new Set([
    "paid",
    "partially_paid",
    "partially_refunded",
  ]);
  let status: NormalizedShopifyTransaction["status"] = "pending";
  if (paidStatuses.has(order.financial_status)) {
    status = "posted";
  } else if (order.financial_status === "voided") {
    status = "voided";
  } else if (order.financial_status === "refunded") {
    status = "refunded";
  }

  const customerName = order.customer
    ? [order.customer.first_name, order.customer.last_name]
        .filter(Boolean)
        .join(" ") || null
    : null;

  const itemSummary =
    order.line_items.length > 0
      ? order.line_items
          .map((li) => `${li.name} x${li.quantity}`)
          .join(", ")
      : null;

  return {
    date: new Date(order.created_at),
    amount: order.total_price,
    currency: order.currency.toUpperCase(),
    amountUsd: amountUsdIfUsd(order.total_price, order.currency),
    description: itemSummary
      ? `Order ${order.name}: ${itemSummary}`
      : `Order ${order.name}`,
    merchantName: customerName,
    merchantMcc: null,
    sourceRef: `shopify_order_${order.id}`,
    type: "credit",
    status,
    metadata: {
      orderName: order.name,
      financialStatus: order.financial_status,
      gateway: order.gateway,
      sourceName: order.source_name,
      subtotalPrice: order.subtotal_price,
      totalTax: order.total_tax,
      customerEmail: order.customer?.email || null,
    },
  };
}

/** Normalize a Shopify refund to canonical format. */
export function normalizeShopifyRefund(
  order: ShopifyOrder,
  refund: NonNullable<ShopifyOrder["refunds"]>[number]
): NormalizedShopifyTransaction {
  const refundTotal = refund.refund_line_items.reduce(
    (sum, rli) => sum + parseFloat(rli.subtotal) + parseFloat(rli.total_tax),
    0
  );

  return {
    date: new Date(refund.created_at),
    amount: String(Math.abs(refundTotal)),
    currency: order.currency.toUpperCase(),
    amountUsd: amountUsdIfUsd(String(Math.abs(refundTotal)), order.currency),
    description: refund.note || `Refund for order ${order.name}`,
    merchantName: null,
    merchantMcc: null,
    sourceRef: `shopify_refund_${refund.id}`,
    type: "debit",
    status: "posted",
    metadata: {
      orderId: order.id,
      orderName: order.name,
      refundNote: refund.note || null,
    },
  };
}

/** Normalize a Shopify payout to canonical format. */
export function normalizeShopifyPayout(
  payout: ShopifyPayout
): NormalizedShopifyTransaction {
  let status: NormalizedShopifyTransaction["status"] = "pending";
  if (payout.status === "paid") {
    status = "posted";
  } else if (payout.status === "failed") {
    status = "failed";
  } else if (payout.status === "cancelled") {
    status = "cancelled";
  }

  return {
    date: new Date(payout.date),
    amount: payout.amount,
    currency: payout.currency.toUpperCase(),
    amountUsd: amountUsdIfUsd(payout.amount, payout.currency),
    description: `Shopify payout`,
    merchantName: null,
    merchantMcc: null,
    sourceRef: `shopify_payout_${payout.id}`,
    type: "debit", // payout = money leaving Shopify to bank
    status,
    metadata: {
      payoutStatus: payout.status,
    },
  };
}
