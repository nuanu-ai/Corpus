import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import { getConnectionById } from "@/lib/connections";
import {
  coerceTelegramConnectionMetadata,
  type TelegramSyncedChat,
} from "@/lib/connectors/telegram";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";

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
    const auth = await getSessionPersonalProjectContext();
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

    const connection = await getConnectionById(connectionId, auth.projectId);
    if (!connection || connection.provider !== "telegram") {
      return NextResponse.json({ error: "Telegram connection not found" }, { status: 404 });
    }

    const existingMetadata = coerceTelegramConnectionMetadata(connection.metadata);
    const enabledChatIds = new Set(
      body.chats.filter((chat) => chat.enabled).map((chat) => chat.chatId),
    );
    const nextMetadata = {
      ...existingMetadata,
      personal: true,
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
      peopleContext: existingMetadata.peopleContext.filter((context) =>
        enabledChatIds.has(context.chatId),
      ),
    };

    await db
      .update(connections)
      .set({ metadata: nextMetadata, updatedAt: new Date() })
      .where(and(eq(connections.id, connectionId), eq(connections.companyId, auth.projectId)));

    return NextResponse.json({
      success: true,
      connectionId,
      enabledChats: nextMetadata.syncedChats.filter((chat) => chat.enabled).length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
