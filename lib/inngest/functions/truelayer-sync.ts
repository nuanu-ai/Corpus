import { eq, and } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { getConnectionCredentials } from "@/lib/connections";
import {
  fetchTrueLayerAccounts,
  fetchTrueLayerTransactions,
  refreshTrueLayerToken,
  normalizeTrueLayerTransaction,
} from "@/lib/connectors/truelayer";
import type { TrueLayerTransactionData } from "@/lib/connectors/truelayer";
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
 * Sync TrueLayer transactions for a connected bank account.
 * Triggered by initial connection or webhook notifications.
 */
export const truelayerTransactionSync = inngest.createFunction(
  {
    id: "truelayer-transaction-sync",
    concurrency: [{ key: "event.data.connectionId", limit: 1 }],
  },
  [
    { event: "connection/truelayer.connected" },
    { event: "truelayer/transactions.updated" },
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

    // Step 2: Refresh token if needed
    const accessToken = await step.run(
      "refresh-token-if-needed",
      async () => {
        const credentials = connection.credentials as Record<string, unknown>;
        let token = credentials.access_token as string;
        const refreshToken = credentials.refresh_token as string;
        const expiresAt = credentials.expires_at as number | undefined;

        if (!token) throw new Error("Missing TrueLayer access token in credentials");
        if (!refreshToken) throw new Error("Missing TrueLayer refresh token in credentials");

        // Refresh if token expires within the next 5 minutes (or no expiry recorded)
        const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
        const needsRefresh = !expiresAt || expiresAt < fiveMinutesFromNow;

        if (needsRefresh) {
          const refreshed = await refreshTrueLayerToken(refreshToken);

          // Compute the new expiry timestamp
          const newExpiresAt = Date.now() + refreshed.expires_in * 1000;

          // Update the stored credentials
          const updatedCredentials = {
            ...credentials,
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token,
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

          token = refreshed.access_token;
        }

        return token;
      }
    );

    // Step 3: Fetch accounts
    const truelayerAccounts = await step.run("fetch-accounts", async () => {
      return fetchTrueLayerAccounts(accessToken);
    });

    // Step 4: Sync transactions for each account (one step per account)
    const since = connection.lastSyncAt
      ? new Date(connection.lastSyncAt)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() - 90);
          return d;
        })();
    const to = new Date();

    let totalAdded = 0;

    for (const account of truelayerAccounts) {
      const accountResult = await step.run(
        `sync-account-${account.account_id}`,
        async () => {
          const transactions = await fetchTrueLayerTransactions(
            accessToken,
            account.account_id,
            since.toISOString(),
            to.toISOString()
          );

          let added = 0;

          for (const txn of transactions) {
            const normalized = normalizeTrueLayerTransaction(
              txn as TrueLayerTransactionData
            );
            const idempotencyKey = `truelayer:${txn.transaction_id}`;

            const inserted = await db.transaction(async (tx) => {
              const rawResult = await tx
                .insert(rawEvents)
                .values({
                  companyId,
                  connectionId,
                  sourceEventId: txn.transaction_id,
                  idempotencyKey,
                  source: "truelayer",
                  eventType: "transaction.added",
                  rawPayload: txn as unknown as Record<string, unknown>,
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

          return { added };
        }
      );

      totalAdded += accountResult.added;
    }

    const result = { added: totalAdded };

    // Step 5: Update lastSyncAt
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
      accountsFetched: truelayerAccounts.length,
      transactionsAdded: result.added,
    };
  }
);

/**
 * Reconciliation poll: every 6 hours, trigger a sync for all active TrueLayer connections.
 */
export const truelayerReconciliationPoll = inngest.createFunction(
  { id: "truelayer-reconciliation-poll" },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    // Step 1: List all active TrueLayer connections
    const activeConnections = await step.run(
      "list-active-truelayer-connections",
      async () => {
        return db
          .select({ id: connections.id, companyId: connections.companyId })
          .from(connections)
          .where(
            and(
              eq(connections.provider, "truelayer"),
              eq(connections.status, "active")
            )
          );
      }
    );

    // Step 2: Fan out sync events via step.sendEvent
    if (activeConnections.length > 0) {
      await step.sendEvent(
        "trigger-truelayer-syncs",
        activeConnections.map((conn) => ({
          name: "truelayer/transactions.updated" as const,
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
