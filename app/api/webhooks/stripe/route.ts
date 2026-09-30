import { NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { connections, rawEvents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

const HANDLED_EVENTS = new Set([
  "charge.succeeded",
  "payment_intent.succeeded",
  "payout.paid",
  "invoice.paid",
  // balance.available is stored as raw event but not normalized to a transaction
  "balance.available",
]);

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export async function POST(request: Request) {
  const stripe = getStripe();

  // Use raw body for signature verification
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Webhook signature verification failed: ${message}`);
    return NextResponse.json(
      { error: `Webhook signature verification failed` },
      { status: 400 }
    );
  }

  // Only handle events we care about
  if (!HANDLED_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  try {
    // Resolve the company from the Stripe account
    // event.account is only set for Connect accounts; for direct accounts it's undefined
    const stripeAccountId = event.account ?? null;

    if (!stripeAccountId) {
      console.warn(
        "Stripe webhook without account ID (direct account) — cannot route safely"
      );
      return NextResponse.json({ received: true });
    }

    const [connection] = await db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.externalAccountId, stripeAccountId),
          eq(connections.provider, "stripe"),
          eq(connections.status, "active")
        )
      )
      .limit(1);

    if (!connection) {
      // Return 200 to prevent Stripe from retrying for unknown accounts
      console.warn(
        `No active Stripe connection found for account: ${stripeAccountId ?? "direct"}. Acknowledging to prevent retries.`
      );
      return NextResponse.json({ received: true });
    }

    // Write to raw_events with idempotency
    const idempotencyKey = `stripe:${event.id}`;

    await db
      .insert(rawEvents)
      .values({
        companyId: connection.companyId,
        connectionId: connection.id,
        sourceEventId: event.id,
        idempotencyKey,
        source: "stripe",
        eventType: event.type,
        rawPayload: event as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing();

    // Return 200 immediately; processing happens async via Inngest later
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook DB error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
