import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { retryQueuedTelegramBotDeliveries } from "@/lib/telegram-bot/delivery";

function safeCompare(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function getCronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value ? value : null;
}

export async function POST(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    const cronHeader = req.headers.get("x-cron-secret");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const isAuthorized =
      (bearerToken !== null && safeCompare(bearerToken, cronSecret)) ||
      (cronHeader !== null && safeCompare(cronHeader, cronSecret));
    if (!isAuthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const result = await retryQueuedTelegramBotDeliveries({ limit: 50 });
  return NextResponse.json({
    ok: true,
    ...result,
  });
}
