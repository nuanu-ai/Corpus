import Stripe from "stripe";
import { eq, and } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { getConnectionCredentials } from "@/lib/connections";
import { syncStripeBalanceTransactions } from "@/lib/connectors/stripe-sync";
import { syncStripeToStaging } from "@/lib/connectors/stripe-initial-sync";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { triggerReconciliationForCompany } from "@/lib/workers/reconciliation-trigger";

/**
 * Triggered when a Stripe connection is established.
 * Backfills the last 6 months of balance transactions into raw_events.
 */
export const stripeSync = inngest.createFunction(
  {
    id: "stripe-initial-sync",
    concurrency: [{ key: "event.data.connectionId", limit: 1 }],
  },
  { event: "connection/stripe.connected" },
  async ({ event, step }) => {
    const { connectionId, companyId } = event.data as {
      connectionId: string;
      companyId: string;
    };

    // Step 1: Fetch and decrypt connection credentials
    const connection = await step.run("get-credentials", async () => {
      const conn = await getConnectionCredentials(connectionId, companyId);
      if (!conn) throw new Error(`Connection ${connectionId} not found`);
      return conn;
    });

    // Step 2: Create Stripe client and sync balance transactions
    const result = await step.run("sync-balance-transactions", async () => {
      const apiKey =
        (connection.credentials.access_token as string) ||
        (connection.credentials.apiKey as string);
      if (!apiKey) throw new Error("Missing Stripe API key in credentials");

      const stripe = new Stripe(apiKey);

      // Use lastSyncAt for incremental sync, fall back to 6 months for initial
      const since = connection.lastSyncAt
        ? new Date(connection.lastSyncAt)
        : (() => {
            const d = new Date();
            d.setMonth(d.getMonth() - 6);
            return d;
          })();

      return syncStripeBalanceTransactions(
        stripe,
        companyId,
        connectionId,
        since
      );
    });

    // Step 3: Fire normalization events for new raw events
    if (result.newEvents.length > 0) {
      await step.sendEvent(
        "fire-normalization-events",
        result.newEvents.map((evt) => ({
          name: "raw-event/created" as const,
          data: {
            rawEventId: evt.rawEventId,
            companyId,
            connectionId: evt.connectionId,
            source: evt.source,
            eventType: evt.eventType,
            rawPayload: evt.rawPayload,
          },
        }))
      );
    }

    // Step 4: Populate staging_records for the Company-DB reconciliation pipeline
    const stagingResult = await step.run("sync-to-staging-records", async () => {
      const apiKey =
        (connection.credentials.access_token as string) ||
        (connection.credentials.apiKey as string);
      if (!apiKey) return { inserted: 0, skipped: 0 };

      const companySlug = await getCompanySlug(companyId);
      const since = connection.lastSyncAt
        ? new Date(connection.lastSyncAt)
        : undefined; // defaults to 90 days in syncStripeToStaging

      return syncStripeToStaging(apiKey, companySlug, since);
    });

    if (stagingResult.inserted > 0) {
      await step.run("trigger-reconciliation", async () => {
        try {
          const companySlug = await getCompanySlug(companyId);
          return await triggerReconciliationForCompany(companySlug);
        } catch (error) {
          console.error("[stripe-sync] Reconciliation trigger failed:", error);
          return {
            processed: 0,
            failed: 0,
            skipped: 0,
            recovered: 0,
          };
        }
      });
    }

    // Step 5: Update connection's lastSyncAt (scoped to companyId for safety)
    await step.run("update-sync-timestamp", async () => {
      await db
        .update(connections)
        .set({ lastSyncAt: new Date(), updatedAt: new Date() })
        .where(
          and(eq(connections.id, connectionId), eq(connections.companyId, companyId))
        );
    });

    return {
      connectionId,
      companyId,
      transactionsInserted: result.inserted,
      normalizationEventsFired: result.newEvents.length,
      stagingRecordsInserted: stagingResult.inserted,
    };
  }
);

/**
 * Daily cron that triggers a sync for every active Stripe connection.
 * Runs at 6am UTC.
 */
export const stripeDailySync = inngest.createFunction(
  { id: "stripe-daily-sync" },
  { cron: "0 6 * * *" },
  async ({ step }) => {
    // Step 1: List all active Stripe connections
    const activeConnections = await step.run(
      "list-active-connections",
      async () => {
        return db
          .select({ id: connections.id, companyId: connections.companyId })
          .from(connections)
          .where(
            and(
              eq(connections.provider, "stripe"),
              eq(connections.status, "active")
            )
          );
      }
    );

    // Step 2: Fan out sync events via step.sendEvent (not inngest.send inside step.run)
    if (activeConnections.length > 0) {
      await step.sendEvent(
        "trigger-syncs",
        activeConnections.map((conn) => ({
          name: "connection/stripe.connected" as const,
          data: {
            connectionId: conn.id,
            companyId: conn.companyId,
          },
        }))
      );
    }

    return { connectionsTriggered: activeConnections.length };
  }
);
