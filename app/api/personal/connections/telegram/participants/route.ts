import { NextResponse } from "next/server";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import { getLatestConnectionCredentialsByProvider } from "@/lib/connections";
import {
  coerceTelegramConnectionMetadata,
  createTelegramClient,
  listTelegramChatParticipants,
  listTelegramDialogEntries,
} from "@/lib/connectors/telegram";

export async function GET(request: Request) {
  let client;

  try {
    const auth = await getSessionPersonalProjectContext();
    const url = new URL(request.url);
    const chatId = url.searchParams.get("chatId")?.trim() ?? "";
    if (!chatId) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }

    const connection = await getLatestConnectionCredentialsByProvider(auth.projectId, "telegram");
    if (!connection) {
      return NextResponse.json({ error: "Telegram not connected" }, { status: 404 });
    }

    const metadata = coerceTelegramConnectionMetadata(connection.metadata);
    const selectedChat = metadata.syncedChats.find((chat) => chat.chatId === chatId && chat.enabled);
    if (!selectedChat) {
      return NextResponse.json({ error: "Chat is not selected for personal context" }, { status: 400 });
    }

    const session = typeof connection.credentials.session === "string"
      ? connection.credentials.session
      : "";
    if (!session) {
      return NextResponse.json({ error: "Telegram session is missing" }, { status: 400 });
    }

    client = createTelegramClient(session);
    await client.connect();
    const dialogEntries = await listTelegramDialogEntries(client, 500);
    const dialogEntry = dialogEntries.find((entry) => entry.meta.chatId === chatId);
    const participants = await listTelegramChatParticipants(
      client,
      dialogEntry?.entity ?? chatId,
      100,
    );
    const contextByParticipant = new Map(
      metadata.peopleContext
        .filter((entry) => entry.chatId === chatId)
        .map((entry) => [entry.participantId, entry]),
    );

    return NextResponse.json(
      {
        connectionId: connection.id,
        chatId,
        chatTitle: selectedChat.title,
        participants: participants.map((participant) => {
          const context = contextByParticipant.get(participant.participantId);
          return {
            ...participant,
            relatedCompanies: context?.relatedCompanies ?? [],
            analysisContext: context?.analysisContext ?? "",
            contactFilePath: context?.contactFilePath ?? null,
          };
        }),
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return handleApiError(error);
  } finally {
    await client?.disconnect().catch(() => {});
  }
}
