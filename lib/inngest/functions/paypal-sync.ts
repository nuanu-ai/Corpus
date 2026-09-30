import { eq, and } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { getConnectionCredentials } from "@/lib/connections";
import {
  fetchPayPalTransactions,
  refreshPayPalToken,
  normalizePayPalTransaction,
} from "@/lib/connectors/paypal";
import { db } from "@/lib/db";
import { connections, rawEvents, canonicalTxns } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";
import { buildCanonicalTxnWriteValues } from "@/lib/canonical-txns";

const encryptionKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY environment variable is required");
  return key;
};

/**
 * Sync PayPal transactions for a connected account.
 * Triggered by initial connection or webhook / reconciliation poll.
 */
export const paypalTransactionSync = inngest.createFunction(
  {
    id: "paypal-transaction-sync",
    concurrency: [{ key: "event.data.connectionId", limit: 1 }],
  },
  [
    { event: "connection/paypal.connected" },
    { event: "paypal/sync.requested" },
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

    // Step 2: Refresh token if needed (check expiry with 5-min window)
    const accessToken = await step.run(
      "refresh-token-if-needed",
      async () => {
        const credentials = connection.credentials as Record<string, unknown>;
        let token = credentials.access_token as string;
        const refreshToken = credentials.refresh_token as string;
        const expiresAt = credentials.expires_at as number | undefined;

        if (!token)
          throw new Error("Missing PayPal access token in credentials");
        if (!refreshToken)
          throw new Error("Missing PayPal refresh token in credentials");

        // Refresh if token expires within the next 5 minutes (or no expiry recorded)
        const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
        const needsRefresh = !expiresAt || expiresAt < fiveMinutesFromNow;

        if (needsRefresh) {
          const refreshed = await refreshPayPalToken(refreshToken);

          // Compute the new expiry timestamp
          const newExpiresAt = Date.now() + refreshed.expiresIn * 1000;

          // Update the stored credentials
          const updatedCredentials = {
            ...credentials,
            access_token: refreshed.accessToken,
            refresh_token: refreshed.refreshToken,
            expires_at: newExpiresAt,
          };

          const credentialsEncrypted = encrypt(
            JSON.stringify(updatedCredentials),
            encryptionKey()
          );

          await db
            .update(connections)
            .set({ credentialsEncrypted, updatedAt: new Date() })
            .where(
              and(
                eq(connections.id, connectionId),
                eq(connections.companyId, companyId)
              )
            );

          token = refreshed.accessToken;
        }

        return token;
      }
    );

    // Step 3: Sync transactions — 31-day lookback (PayPal API max is 31 days)
    const result = await step.run("sync-transactions", async () => {
      const now = new Date();
      const lookback = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);

      const startDate = lookback.toISOString();
      const endDate = now.toISOString();

      let added = 0;
      let currentPage = 1;

      while (true) {
        const { transactions, totalPages } = await fetchPayPalTransactions(
          accessToken,
          startDate,
          endDate,
          currentPage,
          100
        );

        for (const txn of transactions) {
          const rawStatus = txn.transaction_info.transaction_status;
          if (rawStatus !== "S" && rawStatus !== "P") continue;

          const idempotencyKey = `paypal:${txn.transaction_info.transaction_id}`;

          const inserted = await db.transaction(async (tx) => {
            const [rawRow] = await tx
              .insert(rawEvents)
              .values({
                companyId,
                connectionId,
                sourceEventId: txn.transaction_info.transaction_id,
                idempotencyKey,
                source: "paypal",
                eventType: txn.transaction_info.transaction_event_code,
                rawPayload: txn as unknown as Record<string, unknown>,
              })
              .onConflictDoNothing()
              .returning({ id: rawEvents.id });

            if (!rawRow) return false;

            const normalized = normalizePayPalTransaction(txn);
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

        if (currentPage >= totalPages) break;
        currentPage++;
      }

      return { added };
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
      transactionsAdded: result.added,
    };
  }
);

/**
 * Reconciliation poll: every 4 hours, trigger a sync for all active PayPal connections.
 */
export const paypalReconciliationPoll = inngest.createFunction(
  { id: "paypal-reconciliation-poll" },
  { cron: "0 */4 * * *" },
  async ({ step }) => {
    // Step 1: List all active PayPal connections
    const activeConnections = await step.run(
      "list-active-paypal-connections",
      async () => {
        return db
          .select({ id: connections.id, companyId: connections.companyId })
          .from(connections)
          .where(
            and(
              eq(connections.provider, "paypal"),
              eq(connections.status, "active")
            )
          );
      }
    );

    // Step 2: Fan out sync events via step.sendEvent
    if (activeConnections.length > 0) {
      await step.sendEvent(
        "trigger-paypal-syncs",
        activeConnections.map((conn) => ({
          name: "paypal/sync.requested" as const,
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
