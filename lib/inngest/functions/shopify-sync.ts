import { eq, and } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { getConnectionCredentials } from "@/lib/connections";
import {
  fetchShopifyOrders,
  fetchShopifyPayouts,
  normalizeShopifyOrder,
  normalizeShopifyRefund,
  normalizeShopifyPayout,
} from "@/lib/connectors/shopify";
import { db } from "@/lib/db";
import { connections, rawEvents, canonicalTxns } from "@/lib/db/schema";
import { buildCanonicalTxnWriteValues } from "@/lib/canonical-txns";

/**
 * Sync Shopify orders, refunds, and payouts for a connected account.
 * Triggered by initial connection or webhook / reconciliation poll.
 */
export const shopifyTransactionSync = inngest.createFunction(
  {
    id: "shopify-transaction-sync",
    concurrency: [{ key: "event.data.connectionId", limit: 1 }],
  },
  [
    { event: "connection/shopify.connected" },
    { event: "shopify/sync.requested" },
  ],
  async ({ event, step }) => {
    const { connectionId, companyId } = event.data as {
      connectionId: string;
      companyId: string;
    };

    // Step 1: Get credentials
    const connection = await step.run("get-credentials", async () => {
      const conn = await getConnectionCredentials(connectionId, companyId);
      if (!conn) throw new Error(`Connection ${connectionId} not found`);
      return conn;
    });

    const credentials = connection.credentials as Record<string, unknown>;
    const accessToken = credentials.access_token as string;
    const shopDomain = connection.externalAccountId as string;

    if (!accessToken)
      throw new Error("Missing Shopify access token in credentials");
    if (!shopDomain)
      throw new Error("Missing Shopify shop domain in connection");

    // Step 2: Sync orders — 90-day lookback, paginated via sinceId
    const now = new Date();
    const lookback = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const updatedAtMin = lookback.toISOString();

    let totalOrdersAdded = 0;
    let totalRefundsAdded = 0;
    let sinceId: string | undefined;
    let hasMoreOrders = true;
    let pageIndex = 0;

    while (hasMoreOrders) {
      const pageResult = await step.run(`sync-orders-page-${pageIndex}`, async () => {
        const orders = await fetchShopifyOrders(shopDomain, accessToken, {
          updatedAtMin,
          sinceId,
          limit: 250,
        });

        let ordersAdded = 0;
        let refundsAdded = 0;
        let lastOrderId: string | undefined;

        for (const order of orders) {
          lastOrderId = String(order.id);

          const inserted = await db.transaction(async (tx) => {
            const [insertedOrder] = await tx
              .insert(rawEvents)
              .values({
                companyId,
                connectionId,
                sourceEventId: String(order.id),
                idempotencyKey: `shopify:order_${order.id}`,
                source: "shopify",
                eventType: "order",
                rawPayload: order as unknown as Record<string, unknown>,
              })
              .onConflictDoNothing()
              .returning({ id: rawEvents.id });

            if (insertedOrder) {
              const normalized = normalizeShopifyOrder(order);
              await tx.insert(canonicalTxns).values(await buildCanonicalTxnWriteValues({
                companyId,
                rawEventId: insertedOrder.id,
                connectionId,
                date: normalized.date,
                amount: normalized.amount,
                currency: normalized.currency,
                description: normalized.description,
                merchantName: normalized.merchantName,
                sourceRef: normalized.sourceRef,
                type: normalized.type,
                status: normalized.status,
                metadata: normalized.metadata,
              }));
              return true;
            }
            return false;
          });
          if (inserted) ordersAdded++;

          // Insert refunds for this order
          if (order.refunds) {
            for (const refund of order.refunds) {
              const refundInserted = await db.transaction(async (tx) => {
                const [insertedRefund] = await tx
                  .insert(rawEvents)
                  .values({
                    companyId,
                    connectionId,
                    sourceEventId: String(refund.id),
                    idempotencyKey: `shopify:refund_${refund.id}`,
                    source: "shopify",
                    eventType: "refund",
                    rawPayload: refund as unknown as Record<string, unknown>,
                  })
                  .onConflictDoNothing()
                  .returning({ id: rawEvents.id });

                if (insertedRefund) {
                  const normalized = normalizeShopifyRefund(order, refund);
                  await tx.insert(canonicalTxns).values(await buildCanonicalTxnWriteValues({
                    companyId,
                    rawEventId: insertedRefund.id,
                    connectionId,
                    date: normalized.date,
                    amount: normalized.amount,
                    currency: normalized.currency,
                    description: normalized.description,
                    merchantName: normalized.merchantName,
                    sourceRef: normalized.sourceRef,
                    type: normalized.type,
                    status: normalized.status,
                    metadata: normalized.metadata,
                  }));
                  return true;
                }
                return false;
              });
              if (refundInserted) refundsAdded++;
            }
          }
        }

        return { ordersAdded, refundsAdded, lastOrderId, fetched: orders.length };
      });

      totalOrdersAdded += pageResult.ordersAdded;
      totalRefundsAdded += pageResult.refundsAdded;
      sinceId = pageResult.lastOrderId;
      hasMoreOrders = pageResult.fetched >= 250;
      pageIndex++;
    }

    const ordersResult = { ordersAdded: totalOrdersAdded, refundsAdded: totalRefundsAdded };

    // Step 3: Sync payouts
    const payoutsResult = await step.run("sync-payouts", async () => {
      const payouts = await fetchShopifyPayouts(shopDomain, accessToken);

      let payoutsAdded = 0;

      for (const payout of payouts) {
        const inserted = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(rawEvents)
            .values({
              companyId,
              connectionId,
              sourceEventId: String(payout.id),
              idempotencyKey: `shopify:payout_${payout.id}`,
              source: "shopify",
              eventType: "payout",
              rawPayload: payout as unknown as Record<string, unknown>,
            })
            .onConflictDoNothing()
            .returning({ id: rawEvents.id });

          if (row) {
            const normalized = normalizeShopifyPayout(payout);
            await tx.insert(canonicalTxns).values(await buildCanonicalTxnWriteValues({
              companyId,
              rawEventId: row.id,
              connectionId,
              date: normalized.date,
              amount: normalized.amount,
              currency: normalized.currency,
              description: normalized.description,
              merchantName: normalized.merchantName,
              sourceRef: normalized.sourceRef,
              type: normalized.type,
              status: normalized.status,
              metadata: normalized.metadata,
            }));
            return true;
          }
          return false;
        });

        if (inserted) payoutsAdded++;
      }

      return { payoutsAdded };
    });

    // Step 4: Update lastSyncAt
    await step.run("update-sync-timestamp", async () => {
      await db
        .update(connections)
        .set({
          lastSyncAt: new Date(),
          errorCount: 0,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(connections.id, connectionId),
            eq(connections.companyId, companyId)
          )
        );
    });

    return {
      connectionId,
      companyId,
      ordersAdded: ordersResult.ordersAdded,
      refundsAdded: ordersResult.refundsAdded,
      payoutsAdded: payoutsResult.payoutsAdded,
    };
  }
);

/**
 * Reconciliation poll: daily at 06:00, trigger a sync for all active Shopify connections.
 */
export const shopifyReconciliationPoll = inngest.createFunction(
  { id: "shopify-reconciliation-poll" },
  { cron: "0 6 * * *" },
  async ({ step }) => {
    // Step 1: List all active Shopify connections
    const activeConnections = await step.run(
      "list-active-shopify-connections",
      async () => {
        return db
          .select({ id: connections.id, companyId: connections.companyId })
          .from(connections)
          .where(
            and(
              eq(connections.provider, "shopify"),
              eq(connections.status, "active")
            )
          );
      }
    );

    // Step 2: Fan out sync events via step.sendEvent
    if (activeConnections.length > 0) {
      await step.sendEvent(
        "trigger-shopify-syncs",
        activeConnections.map((conn) => ({
          name: "shopify/sync.requested" as const,
          data: {
            connectionId: conn.id,
            companyId: conn.companyId,
          },
        }))
      );
    }

    return { triggered: activeConnections.length };
  }
);
