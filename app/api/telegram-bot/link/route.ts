import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { buildTelegramBotDeepLink } from "@/lib/telegram-bot/config";
import { registerSingleUseTicketPayload } from "@/lib/single-use-ticket-store";

const TELEGRAM_BOT_LINK_TTL_MS = 10 * 60 * 1000;

export async function POST(_req: NextRequest) {
  try {
    const auth = await getSessionCompanyContext();
    const ticket = randomUUID();
    const expiresAt = new Date(Date.now() + TELEGRAM_BOT_LINK_TTL_MS);

    await registerSingleUseTicketPayload({
      namespace: "telegram_bot_link",
      id: ticket,
      payload: {
        userId: auth.userId,
        preferredCompanyId: auth.companyId,
      },
      expiresAt,
    });

    return NextResponse.json({
      ok: true,
      ticket,
      deepLink: buildTelegramBotDeepLink(ticket),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
