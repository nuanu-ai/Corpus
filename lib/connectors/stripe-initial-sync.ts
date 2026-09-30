/**
 * Stripe Initial Sync — writes recent charges directly to staging_records
 * for processing by the Company-DB reconciliation pipeline.
 *
 * This supplements the rawEvents-based sync (stripe-sync.ts / Inngest)
 * by populating the staging_records table used by /api/cron/reconcile.
 */

import Stripe from "stripe";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface StagingInsertResult {
  inserted: number;
  skipped: number;
}

/**
 * Fetch recent Stripe charges and insert them into staging_records
 * for the Company-DB reconciliation pipeline.
 */
export async function syncStripeToStaging(
  apiKey: string,
  companySlug: string,
  since?: Date
): Promise<StagingInsertResult> {
  const stripe = new Stripe(apiKey);

  // Default: last 90 days for initial sync
  const sinceDate = since ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d;
  })();
  const sinceUnix = Math.floor(sinceDate.getTime() / 1000);

  let inserted = 0;
  let skipped = 0;

  // Fetch recent charges (the most common Stripe event type)
  for await (const charge of stripe.charges.list({
    created: { gte: sinceUnix },
    limit: 100,
  })) {
    if (charge.status !== "succeeded") {
      skipped++;
      continue;
    }

    // Build a webhook-like payload so the reconciliation worker can process
    // it with the same transformStripeEvent logic
    const payload = {
      id: `evt_initial_${charge.id}`,
      type: "charge.succeeded",
      data: { object: charge },
      account: charge.transfer_data?.destination ?? undefined,
    };

    const externalId = payload.id;

    try {
      const result = await db.execute(sql`
        INSERT INTO staging_records (company_slug, source, external_id, payload)
        VALUES (${companySlug}, 'stripe', ${externalId}, ${JSON.stringify(payload)}::jsonb)
        ON CONFLICT (company_slug, source, external_id) DO NOTHING
      `);

      if (result.count > 0) {
        inserted++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`Failed to insert staging record for charge ${charge.id}:`, err);
      skipped++;
    }
  }

  // Also fetch recent payouts
  for await (const payout of stripe.payouts.list({
    created: { gte: sinceUnix },
    limit: 100,
  })) {
    const payload = {
      id: `evt_initial_${payout.id}`,
      type: "payout.paid",
      data: { object: payout },
    };

    const externalId = payload.id;

    try {
      const result = await db.execute(sql`
        INSERT INTO staging_records (company_slug, source, external_id, payload)
        VALUES (${companySlug}, 'stripe', ${externalId}, ${JSON.stringify(payload)}::jsonb)
        ON CONFLICT (company_slug, source, external_id) DO NOTHING
      `);

      if (result.count > 0) {
        inserted++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`Failed to insert staging record for payout ${payout.id}:`, err);
      skipped++;
    }
  }

  return { inserted, skipped };
}
