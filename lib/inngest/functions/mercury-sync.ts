import { eq, and } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { getConnectionCredentials } from "@/lib/connections";
import {
  fetchMercuryAccounts,
  fetchMercuryTransactions,
  normalizeMercuryTransaction,
} from "@/lib/connectors/mercury";
import { db } from "@/lib/db";
import { connections, rawEvents, canonicalTxns } from "@/lib/db/schema";
import { buildCanonicalTxnWriteValues } from "@/lib/canonical-txns";

/**
 * Sync Mercury Bank transactions for a connected account.
 * Triggered by initial connection or reconciliation poll.
 */
export const mercuryTransactionSync = inngest.createFunction(
  {
    id: "mercury-transaction-sync",
    concurrency: [{ key: "event.data.connectionId", limit: 1 }],
  },
  [
    { event: "connection/mercury.connected" },
    { event: "mercury/sync.requested" },
  ],
  async ({ event, step }) => {
    const { connectionId, companyId } = event.data as {
      connectionId: string;
      companyId: string;
    };

    // Step 1: Get credentials
    const apiKey = await step.run("get-credentials", async () => {
      const conn = await getConnectionCredentials(connectionId, companyId);
      if (!conn) throw new Error(`Connection ${connectionId} not found`);
      return conn.credentials.apiKey as string;
    });

    // Step 2: Fetch accounts
    const mercuryAccounts = await step.run("fetch-accounts", async () => {
      return fetchMercuryAccounts(apiKey);
    });

    // Step 3: Sync transactions for each account (paginated across steps)
    let totalSynced = 0;
    const now = new Date();
    const lookback = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const PAGE_LIMIT = 500;

    for (const account of mercuryAccounts) {
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const pageResult = await step.run(
          `sync-${account.id}-page-${offset}`,
          async () => {
            const { transactions } = await fetchMercuryTransactions(
              apiKey,
              account.id,
              {
                offset,
                limit: PAGE_LIMIT,
                start: lookback.toISOString().split("T")[0],
                end: now.toISOString().split("T")[0],
              }
            );

            if (transactions.length === 0) {
              return { count: 0, fetched: 0 };
            }

            let count = 0;
            for (const txn of transactions) {
              if (txn.status === "cancelled" || txn.status === "failed")
                continue;

              const idempotencyKey = `mercury:${txn.id}`;

              const inserted = await db.transaction(async (tx) => {
                const [row] = await tx
                  .insert(rawEvents)
                  .values({
                    companyId,
                    connectionId,
                    sourceEventId: txn.id,
                    idempotencyKey,
                    source: "mercury",
                    eventType: txn.kind,
                    rawPayload: txn as unknown as Record<string, unknown>,
                  })
                  .onConflictDoNothing()
                  .returning({ id: rawEvents.id });

                if (row) {
                  const normalized = normalizeMercuryTransaction(txn);
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

              if (inserted) count++;
            }

            return { count, fetched: transactions.length };
          }
        );

        totalSynced += pageResult.count;
        hasMore = pageResult.fetched >= PAGE_LIMIT;
        offset += PAGE_LIMIT;
      }
    }

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
      synced: totalSynced,
      accounts: mercuryAccounts.length,
    };
  }
);

/**
 * Reconciliation poll: every 15 minutes, trigger a sync for all active Mercury connections.
 */
export const mercuryReconciliationPoll = inngest.createFunction(
  { id: "mercury-reconciliation-poll" },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    // Step 1: List all active Mercury connections
    const activeConnections = await step.run(
      "list-active-mercury-connections",
      async () => {
        return db
          .select({ id: connections.id, companyId: connections.companyId })
          .from(connections)
          .where(
            and(
              eq(connections.provider, "mercury"),
              eq(connections.status, "active")
            )
          );
      }
    );

    // Step 2: Fan out sync events via step.sendEvent
    if (activeConnections.length > 0) {
      await step.sendEvent(
        "trigger-mercury-syncs",
        activeConnections.map((conn) => ({
          name: "mercury/sync.requested" as const,
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
