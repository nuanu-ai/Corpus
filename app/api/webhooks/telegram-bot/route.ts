import { NextRequest, NextResponse } from "next/server";

import { handleTelegramBotWebhook } from "@/lib/telegram-bot/webhook";

export async function POST(req: NextRequest) {
  try {
    return await handleTelegramBotWebhook(req);
  } catch (error) {
    console.error("[telegram-bot] webhook failure", error);
    if (error instanceof Error && error.message === "Invalid Telegram webhook secret") {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Telegram bot webhook failed",
      },
      { status: 500 },
    );
  }
}
