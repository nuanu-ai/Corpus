import { NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getLatestConnectionCredentialsByProvider } from "@/lib/connections";
import {
  coerceTelegramConnectionMetadata,
  createTelegramClient,
  listTelegramDialogs,
} from "@/lib/connectors/telegram";

export async function GET() {
  let client;

  try {
    const { companyId } = await getSessionCompanyContext();
    const connection = await getLatestConnectionCredentialsByProvider(companyId, "telegram");

    if (!connection) {
      return NextResponse.json({ error: "Telegram not connected" }, { status: 404 });
    }

    const session = typeof connection.credentials.session === "string"
      ? connection.credentials.session
      : "";
    if (!session) {
      return NextResponse.json({ error: "Telegram session is missing" }, { status: 400 });
    }

    const metadata = coerceTelegramConnectionMetadata(connection.metadata);

    client = createTelegramClient(session);
    await client.connect();

    const dialogs = await listTelegramDialogs(client);
    const savedByChatId = new Map(metadata.syncedChats.map((chat) => [chat.chatId, chat]));

    return NextResponse.json({
      connectionId: connection.id,
      phone: metadata.phone,
      chats: dialogs.map((dialog) => {
        const existing = savedByChatId.get(dialog.chatId);
        return {
          ...dialog,
          enabled: existing?.enabled ?? false,
          lastSyncedMessageId: existing?.lastSyncedMessageId ?? 0,
        };
      }),
    });
  } catch (error) {
    return handleApiError(error);
  } finally {
    await client?.disconnect().catch(() => {});
  }
}
