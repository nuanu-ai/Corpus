import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import { getConnectionById } from "@/lib/connections";
import {
  coerceTelegramConnectionMetadata,
  type TelegramPeopleContext,
} from "@/lib/connectors/telegram";
import { db } from "@/lib/db";
import { connections } from "@/lib/db/schema";

function trimText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function trimStringArray(value: unknown, maxEntries = 24, maxLength = 160): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/)
      : [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of source) {
    const text = trimText(item, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    next.push(text);
    if (next.length >= maxEntries) break;
  }
  return next;
}

function normalizePeopleContext(value: unknown): TelegramPeopleContext[] | null {
  if (!Array.isArray(value)) return null;
  const next: TelegramPeopleContext[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const chatId = trimText(source.chatId, 120);
    const participantId = trimText(source.participantId, 120);
    const displayName = trimText(source.displayName, 160);
    if (!chatId || !participantId || !displayName) continue;
    const telegramHandle = trimText(source.telegramHandle, 80);
    const analysisContext = trimText(source.analysisContext, 2000);
    const contactFilePath = trimText(source.contactFilePath, 240);
    next.push({
      chatId,
      participantId,
      displayName,
      ...(telegramHandle ? { telegramHandle } : {}),
      relatedCompanies: trimStringArray(source.relatedCompanies),
      ...(analysisContext ? { analysisContext } : {}),
      ...(contactFilePath ? { contactFilePath } : {}),
    });
  }
  return next;
}

export async function POST(request: Request) {
  try {
    const auth = await getSessionPersonalProjectContext();
    const body = (await request.json().catch(() => ({}))) as {
      connectionId?: unknown;
      peopleContext?: unknown;
    };
    const connectionId = trimText(body.connectionId, 120);
    if (!connectionId) {
      return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
    }

    const incomingContext = normalizePeopleContext(body.peopleContext);
    if (!incomingContext) {
      return NextResponse.json({ error: "peopleContext array is required" }, { status: 400 });
    }

    const connection = await getConnectionById(connectionId, auth.projectId);
    if (!connection || connection.provider !== "telegram") {
      return NextResponse.json({ error: "Telegram connection not found" }, { status: 404 });
    }

    const metadata = coerceTelegramConnectionMetadata(connection.metadata);
    const enabledChatIds = new Set(
      metadata.syncedChats.filter((chat) => chat.enabled).map((chat) => chat.chatId),
    );
    const scopedIncoming = incomingContext.filter((context) => enabledChatIds.has(context.chatId));
    const incomingKeys = new Set(
      scopedIncoming.map((context) => `${context.chatId}:${context.participantId}`),
    );
    const nextMetadata = {
      ...metadata,
      personal: true,
      peopleContext: [
        ...metadata.peopleContext.filter(
          (context) => !incomingKeys.has(`${context.chatId}:${context.participantId}`),
        ),
        ...scopedIncoming,
      ],
    };

    await db
      .update(connections)
      .set({ metadata: nextMetadata, updatedAt: new Date() })
      .where(and(eq(connections.id, connectionId), eq(connections.companyId, auth.projectId)));

    return NextResponse.json({
      success: true,
      saved: scopedIncoming.length,
      peopleContext: nextMetadata.peopleContext,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
