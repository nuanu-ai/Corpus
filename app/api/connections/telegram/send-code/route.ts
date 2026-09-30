import { NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  createTelegramClient,
  createTelegramLoginStateToken,
  exportTelegramSession,
  getTelegramErrorMessage,
  sendTelegramCode,
} from "@/lib/connectors/telegram";

function normalizePhone(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function POST(request: Request) {
  let client;

  try {
    await getSessionCompanyContext();

    const body = (await request.json().catch(() => ({}))) as { phone?: unknown };
    const phone = normalizePhone(body.phone);

    if (!/^\+?[1-9][0-9]{6,19}$/.test(phone)) {
      return NextResponse.json(
        { error: "Valid phone number is required" },
        { status: 400 },
      );
    }

    client = createTelegramClient();
    await client.connect();

    const result = await sendTelegramCode(client, phone);

    return NextResponse.json({
      phone,
      isCodeViaApp: result.isCodeViaApp,
      loginState: createTelegramLoginStateToken({
        phone,
        phoneCodeHash: result.phoneCodeHash,
        session: exportTelegramSession(client),
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("TELEGRAM_API_ID")) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (error instanceof Error && error.message !== "Internal server error") {
      const message = getTelegramErrorMessage(error);
      if (message !== "Telegram request failed") {
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    return handleApiError(error);
  } finally {
    await client?.disconnect().catch(() => {});
  }
}
