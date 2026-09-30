import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import { triggerReconciliationForCompany } from "@/lib/workers/reconciliation-trigger";

/**
 * POST /api/webhooks/ingest
 *
 * Generic webhook ingress endpoint.
 * Receives webhook payloads, resolves tenant from connector registration,
 * and inserts into staging_records for async processing.
 *
 * Query params:
 *   source - connector source (e.g. 'stripe', 'custom')
 *
 * Headers:
 *   stripe-signature / x-webhook-signature
 */
export async function POST(req: NextRequest) {
  const requestUrl = new URL(req.url);
  const source = requestUrl.searchParams.get("source");
  if (!source) {
    return NextResponse.json({ error: "Missing source param" }, { status: 400 });
  }

  if (source === "plaid" || source === "paypal") {
    return NextResponse.json(
      { error: `Source "${source}" must use its provider-specific webhook route` },
      { status: 400 },
    );
  }

  // Read raw body BEFORE parsing JSON — needed for HMAC signature verification
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: "Failed to read request body" }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Extract external ID for idempotency (source-specific)
  const externalId = extractExternalId(source, payload);
  if (!externalId) {
    return NextResponse.json({ error: "Cannot extract external ID" }, { status: 400 });
  }

  // Resolve company from connector registration
  const accountId = extractAccountId(source, payload, requestUrl, req);
  if (!accountId) {
    return NextResponse.json({ error: "Cannot resolve tenant" }, { status: 400 });
  }

  // Look up connector registration by source AND account_id for tenant isolation
  const registration = await db.execute<{ company_slug: string; webhook_secret: string | null }>(sql`
    SELECT company_slug, webhook_secret
    FROM connector_registrations
    WHERE source = ${source}
      AND account_id = ${accountId}
      AND is_active = true
    LIMIT 1
  `);

  if (!registration.length) {
    return NextResponse.json({ error: "No active registration for source/account" }, { status: 404 });
  }

  const companySlug = registration[0].company_slug;

  // For Stripe, use the endpoint secret from env var — Stripe signs webhooks with
  // its own secret (configured in Stripe Dashboard), not our DB-stored random secret.
  // For other providers, use the DB-stored secret we generated at registration time.
  const webhookSecret =
    source === "stripe"
      ? process.env.STRIPE_WEBHOOK_SECRET ?? null
      : registration[0].webhook_secret;

  // Reject webhook payloads if signature verification is not configured.
  if (!webhookSecret) {
    console.error(
      `[webhook-ingest] Webhook secret is not configured for source="${source}" ` +
      `(company="${companySlug}") — rejecting request`,
    );
    return NextResponse.json({ error: "Webhook signature verification not configured" }, { status: 500 });
  }

  // Verify webhook signature when secret is configured
  const isValid = verifySignature(source, req, rawBody, webhookSecret);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  // Insert into staging_records (idempotent via UNIQUE constraint)
  let inserted = false;
  try {
    const result = await db.execute(sql`
      INSERT INTO staging_records (company_slug, source, external_id, payload)
      VALUES (${companySlug}, ${source}, ${externalId}, ${rawBody}::jsonb)
      ON CONFLICT (company_slug, source, external_id) DO NOTHING
    `);
    inserted = result.count > 0;
  } catch (err) {
    console.error("Failed to insert staging record:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  if (inserted) {
    try {
      await triggerReconciliationForCompany(companySlug);
    } catch (err) {
      console.error("[webhook-ingest] Reconciliation trigger failed:", err);
    }
  }

  return NextResponse.json({ status: "accepted" });
}

/**
 * Verify webhook signature using source-specific HMAC scheme.
 */
function verifySignature(source: string, req: NextRequest, rawBody: string, secret: string): boolean {
  switch (source) {
    case "stripe":
      return verifyStripeSignature(req, rawBody, secret);
    default:
      return verifyHmacSha256(req.headers.get("x-webhook-signature"), rawBody, secret);
  }
}

/**
 * Stripe uses a custom signature format: t=timestamp,v1=hmac
 * The signed payload is `${timestamp}.${body}`.
 */
function verifyStripeSignature(req: NextRequest, rawBody: string, secret: string): boolean {
  const sigHeader = req.headers.get("stripe-signature");
  if (!sigHeader) return false;

  const elements = Object.fromEntries(
    sigHeader.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key, rest.join("=")];
    }),
  );

  const timestamp = elements["t"];
  const expectedSig = elements["v1"];
  if (!timestamp || !expectedSig) return false;

  // Reject timestamps outside ±5 minute window (replay + clock-skew protection)
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (Math.abs(age) > 300) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const computed = createHmac("sha256", secret).update(signedPayload).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

/**
 * Generic HMAC-SHA256 verification for custom/simple webhook sources.
 */
function verifyHmacSha256(signature: string | null, rawBody: string, secret: string): boolean {
  if (!signature) return false;

  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch {
    return false;
  }
}

function extractExternalId(source: string, payload: Record<string, unknown>): string | null {
  switch (source) {
    case "stripe":
      return (payload.id as string) ?? null;
    case "plaid":
      // Use item_id + webhook_code combo for uniqueness (webhook_code alone is not unique)
      return payload.item_id && payload.webhook_code
        ? `${payload.item_id}-${payload.webhook_code}-${payload.webhook_type ?? "unknown"}`
        : null;
    case "shopify":
      return String(payload.id ?? "") || null;
    default:
      return (payload.id as string) ?? (payload.external_id as string) ?? null;
  }
}

function extractAccountId(
  source: string,
  payload: Record<string, unknown>,
  requestUrl: URL,
  req: NextRequest,
): string | null {
  // Allow explicit account_id via query param (useful for direct/non-Connect Stripe accounts)
  const queryAccountId = requestUrl.searchParams.get("account_id");
  if (queryAccountId) return queryAccountId;

  switch (source) {
    case "stripe":
      // For Connect platforms: event.account is the connected account ID
      // For direct accounts: account is absent — use query param above
      return (payload.account as string) ?? null;
    case "plaid":
      return (payload.item_id as string) ?? null;
    case "shopify":
      // Use shop domain as account_id (globally unique per Shopify store)
      return req.headers.get("x-shopify-shop-domain")
        ?? (payload.myshopify_domain as string)
        ?? null;
    default:
      return (payload.account_id as string) ?? null;
  }
}
