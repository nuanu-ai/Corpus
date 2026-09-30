import { eq, and } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { getConnectionCredentials } from "@/lib/connections";
import {
  fetchRutterTransactions,
  normalizeRutterTransaction,
} from "@/lib/connectors/rutter";
import { db } from "@/lib/db";
import { connections, rawEvents, canonicalTxns } from "@/lib/db/schema";
import { buildCanonicalTxnWriteValues } from "@/lib/canonical-txns";

/**
 * Sync Rutter transactions for a connected account.
 * Triggered by initial connection or webhook / reconciliation poll.
 */
export const rutterTransactionSync = inngest.createFunction(
  {
    id: "rutter-transaction-sync",
    concurrency: [{ key: "event.data.connectionId", limit: 1 }],
  },
  [
    { event: "connection/rutter.connected" },
    { event: "rutter/sync.requested" },
  ],
  async ({ event, step }) => {
    const { connectionId, companyId } = event.data as {
      connectionId: string;
      companyId: string;
    };

    // Step 1: Get credentials
    const accessToken = await step.run("get-credentials", async () => {
      const conn = await getConnectionCredentials(connectionId, companyId);
      if (!conn) throw new Error(`Connection ${connectionId} not found`);
      return conn.credentials.access_token as string;
    });

    // Step 2: Sync transactions — cursor-based pagination
    const result = await step.run("sync-transactions", async () => {
      let cursor: string | undefined;
      let added = 0;

      while (true) {
        const { transactions, nextCursor } = await fetchRutterTransactions(
          accessToken,
          { cursor, limit: 500 }
        );

        if (transactions.length === 0) break;

        for (const txn of transactions) {
          // Skip voided transactions
          if (txn.status === "void") continue;

          const idempotencyKey = `rutter:${txn.id}`;

          const inserted = await db.transaction(async (tx) => {
            const [rawRow] = await tx
              .insert(rawEvents)
              .values({
                companyId,
                connectionId,
                sourceEventId: txn.id,
                idempotencyKey,
                source: "rutter",
                eventType: txn.type,
                rawPayload: txn as unknown as Record<string, unknown>,
              })
              .onConflictDoNothing()
              .returning({ id: rawEvents.id });

            if (!rawRow) return false;

            const normalized = normalizeRutterTransaction(txn);
            await tx.insert(canonicalTxns).values(await buildCanonicalTxnWriteValues({
              companyId,
              rawEventId: rawRow.id,
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
          });

          if (inserted) {
            added++;
          }
        }

        if (!nextCursor) break;
        cursor = nextCursor;
      }

      return { added };
    });

    // Step 3: Update lastSyncAt
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
      transactionsAdded: result.added,
    };
  }
);

/**
 * Reconciliation poll: daily at 7 AM UTC, trigger a sync for all active Rutter connections.
 */
export const rutterReconciliationPoll = inngest.createFunction(
  { id: "rutter-reconciliation-poll" },
  { cron: "0 7 * * *" },
  async ({ step }) => {
    // Step 1: List all active Rutter connections
    const activeConnections = await step.run(
      "list-active-rutter-connections",
      async () => {
        return db
          .select({ id: connections.id, companyId: connections.companyId })
          .from(connections)
          .where(
            and(
              eq(connections.provider, "rutter"),
              eq(connections.status, "active")
            )
          );
      }
    );

    // Step 2: Fan out sync events via step.sendEvent
    if (activeConnections.length > 0) {
      await step.sendEvent(
        "trigger-rutter-syncs",
        activeConnections.map((conn) => ({
          name: "rutter/sync.requested" as const,
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
