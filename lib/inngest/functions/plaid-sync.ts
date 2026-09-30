import { eq, and } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { getConnectionCredentials } from "@/lib/connections";
import { getPlaidClient, normalizePlaidTransaction } from "@/lib/connectors/plaid";
import type { PlaidTransactionData } from "@/lib/connectors/plaid";
import { db } from "@/lib/db";
import { connections, rawEvents, canonicalTxns } from "@/lib/db/schema";
import { buildCanonicalTxnWriteValues } from "@/lib/canonical-txns";

/**
 * Sync Plaid transactions using the cursor-based transactionsSync API.
 * Triggered by initial connection or webhook notifications.
 */
export const plaidTransactionSync = inngest.createFunction(
  {
    id: "plaid-transaction-sync",
    concurrency: [{ key: "event.data.connectionId", limit: 1 }],
  },
  [
    { event: "connection/plaid.connected" },
    { event: "plaid/transactions.updated" },
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

    // Step 2: Use transactionsSync API (cursor-based, one step per page)
    const accessToken = connection.credentials.accessToken as string;
    if (!accessToken) throw new Error("Missing Plaid access token in credentials");

    let cursor = (connection.metadata as Record<string, unknown>)?.plaidCursor as string | undefined;
    let totalAdded = 0;
    let totalModified = 0;
    let totalRemoved = 0;
    let hasMore = true;
    let pageIndex = 0;

    while (hasMore) {
      const pageResult = await step.run(`sync-page-${pageIndex}`, async () => {
        const plaidClient = getPlaidClient();
        const response = await plaidClient.transactionsSync({
          access_token: accessToken,
          cursor: cursor || undefined,
        });

        const data = response.data;
        let added = 0;
        let modified = 0;
        let removed = 0;

        // Process added transactions
        for (const txn of data.added) {
          const plaidTxn = txn as unknown as PlaidTransactionData;
          const normalized = normalizePlaidTransaction(plaidTxn);
          const idempotencyKey = `plaid:${plaidTxn.transaction_id}`;

          const inserted = await db.transaction(async (tx) => {
            const rawResult = await tx
              .insert(rawEvents)
              .values({
                companyId,
                connectionId,
                sourceEventId: plaidTxn.transaction_id,
                idempotencyKey,
                source: "plaid",
                eventType: "transaction.added",
                rawPayload: plaidTxn as unknown as Record<string, unknown>,
              })
              .onConflictDoNothing()
              .returning();

            if (rawResult.length > 0) {
              await tx.insert(canonicalTxns).values(await buildCanonicalTxnWriteValues({
                companyId,
                rawEventId: rawResult[0].id,
                connectionId,
                date: normalized.date,
                amount: normalized.amount,
                currency: normalized.currency,
                description: normalized.description,
                merchantName: normalized.merchantName,
                merchantMcc: normalized.merchantMcc,
                sourceRef: normalized.sourceRef,
                type: normalized.type,
                status: normalized.status,
                metadata: normalized.metadata,
              }));
              return true;
            }
            return false;
          });

          if (inserted) added++;
        }

        // Process modified transactions (upsert pattern)
        for (const txn of data.modified) {
          const plaidTxn = txn as unknown as PlaidTransactionData;
          const normalized = normalizePlaidTransaction(plaidTxn);
          const modifiedKey = `plaid:modified_${plaidTxn.transaction_id}`;

          await db.transaction(async (tx) => {
            const canonicalValues = await buildCanonicalTxnWriteValues({
              companyId,
              rawEventId: "existing",
              connectionId,
              date: normalized.date,
              amount: normalized.amount,
              currency: normalized.currency,
              description: normalized.description,
              merchantName: normalized.merchantName,
              merchantMcc: normalized.merchantMcc,
              sourceRef: normalized.sourceRef,
              type: normalized.type,
              status: normalized.status,
              metadata: normalized.metadata,
            });

            await tx
              .insert(rawEvents)
              .values({
                companyId,
                connectionId,
                sourceEventId: plaidTxn.transaction_id,
                idempotencyKey: modifiedKey,
                source: "plaid",
                eventType: "transaction.modified",
                rawPayload: plaidTxn as unknown as Record<string, unknown>,
              })
              .onConflictDoNothing();

            await tx
              .update(canonicalTxns)
              .set({
                date: canonicalValues.date,
                amount: canonicalValues.amount,
                currency: canonicalValues.currency,
                amountUsd: canonicalValues.amountUsd,
                fxRate: canonicalValues.fxRate,
                description: canonicalValues.description,
                merchantName: canonicalValues.merchantName,
                merchantMcc: canonicalValues.merchantMcc,
                sourceRef: normalized.sourceRef,
                type: canonicalValues.type,
                status: canonicalValues.status,
                metadata: canonicalValues.metadata,
              })
              .where(
                and(
                  eq(canonicalTxns.sourceRef, plaidTxn.transaction_id),
                  eq(canonicalTxns.connectionId, connectionId),
                  eq(canonicalTxns.companyId, companyId)
                )
              );
          });

          modified++;
        }

        // Process removed transactions
        for (const removedTxn of data.removed) {
          const txnId = removedTxn.transaction_id;
          if (txnId) {
            await db.transaction(async (tx) => {
              await tx
                .insert(rawEvents)
                .values({
                  companyId,
                  connectionId,
                  sourceEventId: txnId,
                  idempotencyKey: `plaid:removed_${txnId}`,
                  source: "plaid",
                  eventType: "transaction.removed",
                  rawPayload: { transaction_id: txnId },
                })
                .onConflictDoNothing();

              await tx
                .update(canonicalTxns)
                .set({ status: "removed" })
                .where(
                  and(
                    eq(canonicalTxns.sourceRef, txnId),
                    eq(canonicalTxns.connectionId, connectionId),
                    eq(canonicalTxns.companyId, companyId)
                  )
                );
            });

            removed++;
          }
        }

        return {
          added,
          modified,
          removed,
          nextCursor: data.next_cursor,
          hasMore: data.has_more,
        };
      });

      totalAdded += pageResult.added;
      totalModified += pageResult.modified;
      totalRemoved += pageResult.removed;
      cursor = pageResult.nextCursor;
      hasMore = pageResult.hasMore;
      pageIndex++;
    }

    // Step 3: Save cursor to connection metadata
    await step.run("save-cursor", async () => {
      const existingMetadata = (connection.metadata as Record<string, unknown>) ?? {};
      await db
        .update(connections)
        .set({
          metadata: { ...existingMetadata, plaidCursor: cursor },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(connections.id, connectionId),
            eq(connections.companyId, companyId)
          )
        );
    });

    // Step 4: Update lastSyncAt
    await step.run("update-sync-timestamp", async () => {
      await db
        .update(connections)
        .set({ lastSyncAt: new Date(), updatedAt: new Date() })
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
      transactionsAdded: totalAdded,
      transactionsModified: totalModified,
      transactionsRemoved: totalRemoved,
    };
  }
);

/**
 * Reconciliation poll: every 6 hours, trigger a sync for all active Plaid connections.
 */
export const plaidReconciliationPoll = inngest.createFunction(
  { id: "plaid-reconciliation-poll" },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    // Step 1: List all active Plaid connections
    const activeConnections = await step.run(
      "list-active-plaid-connections",
      async () => {
        return db
          .select({ id: connections.id, companyId: connections.companyId })
          .from(connections)
          .where(
            and(
              eq(connections.provider, "plaid"),
              eq(connections.status, "active")
            )
          );
      }
    );

    // Step 2: Fan out sync events via step.sendEvent
    if (activeConnections.length > 0) {
      await step.sendEvent(
        "trigger-plaid-syncs",
        activeConnections.map((conn) => ({
          name: "plaid/transactions.updated" as const,
          data: {
            connectionId: conn.id,
            companyId: conn.companyId,
            webhookCode: "RECONCILIATION_POLL",
          },
        }))
      );
    }

    return { connectionsTriggered: activeConnections.length };
  }
);
