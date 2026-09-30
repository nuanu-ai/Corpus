import { and, eq, sql } from "drizzle-orm";

import { getConnectionCredentials } from "@/lib/connections";
import {
  coerceTelegramConnectionMetadata,
  createTelegramClient,
  fetchTelegramChatHistory,
  listTelegramDialogEntries,
  normalizeTelegramMessage,
} from "@/lib/connectors/telegram";
import { db } from "@/lib/db";
import { companies, connections } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest";
import { insertCommunicationMessage } from "@/lib/communications/store";
import {
  isTelegramCompanySyncTenant,
  selectTelegramSyncTargets,
} from "@/lib/inngest/functions/telegram-sync-targets";

async function markTelegramSyncState(input: {
  connectionId: string;
  companyId: string;
  metadata?: Record<string, unknown>;
  lastError?: string | null;
  lastSyncAt?: Date;
  incrementErrorCount?: boolean;
}) {
  const values: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (input.metadata !== undefined) values.metadata = input.metadata;
  if (input.lastError !== undefined) values.lastError = input.lastError;
  if (input.lastSyncAt !== undefined) values.lastSyncAt = input.lastSyncAt;
  if (input.incrementErrorCount) {
    values.errorCount = sql`${connections.errorCount} + 1`;
  }

  await db
    .update(connections)
    .set(values)
    .where(and(eq(connections.id, input.connectionId), eq(connections.companyId, input.companyId)));
}

export const telegramSync = inngest.createFunction(
  {
    id: "telegram-sync",
    concurrency: [{ key: "event.data.connectionId", limit: 1 }],
  },
  [
    { event: "connection/telegram.connected" },
    { event: "telegram/sync.requested" },
  ],
  async ({ event, step }) => {
    const { companyId, connectionId } = event.data as {
      companyId: string;
      connectionId: string;
    };

    const connection = await step.run("load-telegram-connection", async () => {
      const result = await getConnectionCredentials(connectionId, companyId);
      if (!result) {
        throw new Error(`Connection ${connectionId} not found`);
      }
      if (result.provider !== "telegram") {
        throw new Error(`Connection ${connectionId} is not Telegram`);
      }
      return result;
    });

    const tenant = await step.run("load-telegram-tenant", async () => {
      const [row] = await db
        .select({ tenantKind: companies.tenantKind })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);
      return row ?? null;
    });
    if (!tenant) {
      throw new Error(`Tenant ${companyId} not found`);
    }
    if (!isTelegramCompanySyncTenant(tenant.tenantKind)) {
      return {
        connectionId,
        companyId,
        synced: 0,
        chats: 0,
        skipped: "non_company_tenant",
      };
    }

    const session = typeof connection.credentials.session === "string"
      ? connection.credentials.session
      : "";
    if (!session) {
      throw new Error("Telegram connection is missing a saved session");
    }

    const metadata = coerceTelegramConnectionMetadata(connection.metadata);
    const enabledChats = metadata.syncedChats.filter((chat) => chat.enabled);
    if (enabledChats.length === 0) {
      await step.run("mark-noop-sync", async () => {
        await markTelegramSyncState({
          connectionId,
          companyId,
          lastSyncAt: new Date(),
          lastError: null,
        });
      });
      return { connectionId, companyId, synced: 0, chats: 0 };
    }

    let syncResult: {
      totalInserted: number;
      metadata: typeof metadata;
    };

    try {
      syncResult = await step.run("sync-telegram-chats", async () => {
        const client = createTelegramClient(session);
        await client.connect();

        let totalInserted = 0;
        const updatedChats = [...metadata.syncedChats];
        const dialogEntries = await listTelegramDialogEntries(client, 500);
        const dialogByChatId = new Map(
          dialogEntries.map((entry) => [entry.meta.chatId, entry]),
        );

        try {
          for (const chat of enabledChats) {
            const dialogEntry = dialogByChatId.get(chat.chatId);
            const messages = await fetchTelegramChatHistory(
              client,
              dialogEntry?.entity ?? chat.chatId,
              chat.lastSyncedMessageId,
              100,
            );

            let maxMessageId = chat.lastSyncedMessageId;

            for (const message of messages) {
              if (message.id > maxMessageId) {
                maxMessageId = message.id;
              }

              if (!message.message && !message.media) {
                continue;
              }

              await insertCommunicationMessage({
                companyId,
                ...normalizeTelegramMessage(message, {
                  chatId: chat.chatId,
                  title: chat.title,
                  type: chat.type,
                }),
              });
              totalInserted += 1;
            }

            const chatIndex = updatedChats.findIndex((entry) => entry.chatId === chat.chatId);
            if (chatIndex >= 0) {
              updatedChats[chatIndex] = {
                ...updatedChats[chatIndex]!,
                ...(dialogEntry?.meta.title ? { title: dialogEntry.meta.title } : {}),
                ...(dialogEntry?.meta.type ? { type: dialogEntry.meta.type } : {}),
                ...(dialogEntry?.meta.entityClass ? { entityClass: dialogEntry.meta.entityClass } : {}),
                ...(dialogEntry?.meta.accessHash ? { accessHash: dialogEntry.meta.accessHash } : {}),
                lastSyncedMessageId: maxMessageId,
              };
            }
          }
        } finally {
          await client.disconnect().catch(() => {});
        }

        return {
          totalInserted,
          metadata: {
            ...metadata,
            syncedChats: updatedChats,
          },
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Telegram sync failed";
      await step.run("mark-telegram-sync-failure", async () => {
        await markTelegramSyncFailure({
          connectionId,
          companyId,
          error: message,
        });
      });
      throw error;
    }

    await step.run("mark-telegram-sync-success", async () => {
      await markTelegramSyncState({
        connectionId,
        companyId,
        metadata: syncResult.metadata as unknown as Record<string, unknown>,
        lastSyncAt: new Date(),
        lastError: null,
      });
    });

    if (syncResult.totalInserted > 0) {
      await step.sendEvent("trigger-communications-synthesis", {
        name: "communications/synthesis.requested",
        data: {
          companyId,
          provider: "telegram",
          limit: 25,
        },
      });
    }

    return {
      connectionId,
      companyId,
      synced: syncResult.totalInserted,
      chats: enabledChats.length,
    };
  },
);

export const telegramReconciliationPoll = inngest.createFunction(
  { id: "telegram-reconciliation-poll" },
  { cron: "0 * * * *" },
  async ({ step }) => {
    const activeConnections = await step.run("list-active-telegram-connections", async () => {
      return db
        .select({
          id: connections.id,
          companyId: connections.companyId,
          tenantKind: companies.tenantKind,
          metadata: connections.metadata,
        })
        .from(connections)
        .innerJoin(companies, eq(companies.id, connections.companyId))
        .where(
          and(
            eq(connections.provider, "telegram"),
            eq(connections.status, "active"),
            eq(companies.tenantKind, "company"),
          ),
        );
    });

    const syncTargets = selectTelegramSyncTargets(activeConnections);

    if (syncTargets.length === 0) {
      return { triggered: 0 };
    }

    await step.sendEvent(
      "trigger-telegram-syncs",
      syncTargets.map((connection) => ({
        name: "telegram/sync.requested" as const,
        data: {
          companyId: connection.companyId,
          connectionId: connection.id,
        },
      })),
    );

    return { triggered: syncTargets.length };
  },
);

export async function markTelegramSyncFailure(input: {
  connectionId: string;
  companyId: string;
  error: string;
}) {
  await markTelegramSyncState({
    connectionId: input.connectionId,
    companyId: input.companyId,
    lastError: input.error,
    incrementErrorCount: true,
  });
}
