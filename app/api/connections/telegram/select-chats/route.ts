import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getConnectionById } from "@/lib/connections";
import {
  coerceTelegramConnectionMetadata,
  type TelegramSyncedChat,
} from "@/lib/connectors/telegram";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest";

function isTelegramChatArray(value: unknown): value is TelegramSyncedChat[] {
  return Array.isArray(value) && value.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Record<string, unknown>;
      return (
        typeof candidate.chatId === "string" &&
        typeof candidate.title === "string" &&
        typeof candidate.type === "string" &&
        typeof candidate.enabled === "boolean"
    );
  });
}

export async function POST(request: Request) {
  try {
    const { companyId } = await getSessionCompanyContext();
    const body = (await request.json().catch(() => ({}))) as {
      connectionId?: unknown;
      chats?: unknown;
    };

    const connectionId = typeof body.connectionId === "string" ? body.connectionId : "";
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
    }
    if (!isTelegramChatArray(body.chats)) {
      return NextResponse.json({ error: "chats array is required" }, { status: 400 });
    }

    const connection = await getConnectionById(connectionId, companyId);
    if (!connection || connection.provider !== "telegram") {
      return NextResponse.json({ error: "Telegram connection not found" }, { status: 404 });
    }

    const existingMetadata = coerceTelegramConnectionMetadata(connection.metadata);
    const nextMetadata = {
      ...existingMetadata,
      syncedChats: body.chats.map((chat) => ({
        chatId: chat.chatId,
        title: chat.title,
        type: chat.type,
        ...(typeof chat.entityClass === "string" ? { entityClass: chat.entityClass } : {}),
        ...(typeof chat.accessHash === "string" ? { accessHash: chat.accessHash } : {}),
        enabled: chat.enabled,
        lastSyncedMessageId:
          typeof chat.lastSyncedMessageId === "number" && Number.isFinite(chat.lastSyncedMessageId)
            ? chat.lastSyncedMessageId
            : 0,
      })),
    };

    await db
      .update(connections)
      .set({
        metadata: nextMetadata,
        updatedAt: new Date(),
      })
      .where(and(eq(connections.id, connectionId), eq(connections.companyId, companyId)));

    await inngest.send({
      name: "telegram/sync.requested",
      data: { companyId, connectionId },
    });

    return NextResponse.json({
      success: true,
      connectionId,
      enabledChats: nextMetadata.syncedChats.filter((chat) => chat.enabled).length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
