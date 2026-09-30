import { db } from "@/lib/db";
import { inngest } from "@/lib/inngest";
import { enqueueOutboxEvent } from "@/lib/outbox";

export const TELEGRAM_BOT_UPDATE_EVENT = "telegram-bot/update.received";

export function getTelegramBotUpdateScopeKey(input: {
  telegramChatId?: string | null;
  telegramUserId?: string | null;
  updateId: string;
}) {
  if (input.telegramChatId) return `telegram:chat:${input.telegramChatId}`;
  if (input.telegramUserId) return `telegram:user:${input.telegramUserId}`;
  return `telegram:update:${input.updateId}`;
}

export async function enqueueTelegramBotUpdateProcessing(input: {
  updateId: string;
  telegramUserId?: string | null;
  telegramChatId?: string | null;
  fallbackToOutbox?: boolean;
}) {
  const data = {
    updateId: input.updateId,
    telegramUserId: input.telegramUserId ?? null,
    telegramChatId: input.telegramChatId ?? null,
    scopeKey: getTelegramBotUpdateScopeKey(input),
  };

  try {
    await inngest.send({
      name: TELEGRAM_BOT_UPDATE_EVENT,
      data,
    });
    return { mode: "inngest" as const };
  } catch (error) {
    if (input.fallbackToOutbox === false) {
      console.error("Failed to reschedule Telegram update via Inngest:", error);
      return { mode: "failed" as const };
    }

    console.error("Failed to enqueue Telegram update via Inngest, using outbox:", error);
    await enqueueOutboxEvent(db, {
      name: TELEGRAM_BOT_UPDATE_EVENT,
      data,
    });
    return { mode: "outbox" as const };
  }
}
