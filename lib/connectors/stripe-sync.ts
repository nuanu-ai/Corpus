import type Stripe from "stripe";
import { db } from "@/lib/db";
import { rawEvents } from "@/lib/db/schema";

export interface StripeSyncResult {
  inserted: number;
  newEvents: Array<{
    rawEventId: string;
    source: string;
    eventType: string;
    rawPayload: Record<string, unknown>;
    connectionId: string;
  }>;
}

/**
 * Fetch Stripe balance transactions since `since` and insert them into raw_events.
 * Uses Stripe auto-pagination. Idempotent via onConflictDoNothing on the
 * (companyId, idempotencyKey) unique index.
 *
 * @returns count of newly inserted events and data needed for normalization
 */
export async function syncStripeBalanceTransactions(
  stripeClient: Stripe,
  companyId: string,
  connectionId: string,
  since: Date
): Promise<StripeSyncResult> {
  const sinceUnix = Math.floor(since.getTime() / 1000);

  let inserted = 0;
  const newEvents: StripeSyncResult["newEvents"] = [];

  // Stripe auto-pagination handles cursor management for us
  for await (const bt of stripeClient.balanceTransactions.list({
    created: { gte: sinceUnix },
    limit: 100,
  })) {
    const idempotencyKey = `stripe:bt_${bt.id}`;

    const result = await db
      .insert(rawEvents)
      .values({
        companyId,
        connectionId,
        sourceEventId: bt.id,
        idempotencyKey,
        source: "stripe",
        eventType: `balance_transaction.${bt.type}`,
        rawPayload: bt as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing()
      .returning({ id: rawEvents.id });

    if (result.length > 0) {
      inserted++;
      newEvents.push({
        rawEventId: result[0].id,
        source: "stripe",
        eventType: `balance_transaction.${bt.type}`,
        rawPayload: bt as unknown as Record<string, unknown>,
        connectionId,
      });
    }
  }

  return { inserted, newEvents };
}
