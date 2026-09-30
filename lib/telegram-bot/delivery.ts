import { and, asc, eq, isNull, lte, or } from "drizzle-orm";

import {
  TELEGRAM_MESSAGE_CHAR_LIMIT,
  TelegramApiError,
  sendTelegramDocument,
  sendTelegramLongMessage,
  sendTelegramMessage,
  type TelegramReplyMarkup,
} from "@/lib/telegram-bot/api";
import { loadTelegramArtifactFile } from "@/lib/telegram-bot/chat";
import type { ChatThreadArtifactSummary } from "@/lib/consultant/store";
import { db } from "@/lib/db";
import { telegramBotDeliveries } from "@/lib/db/schema";

const MAX_TELEGRAM_DELIVERY_ATTEMPTS = 5;

type TelegramTextDeliveryPayload = {
  kind: "message" | "long_message";
  text: string;
  replyMarkup?: TelegramReplyMarkup;
  replyToMessageId?: number | null;
};

type TelegramArtifactDeliveryPayload = {
  kind: "artifact_document";
  companyId: string;
  threadId: string;
  artifact: ChatThreadArtifactSummary;
};

type TelegramDeliveryPayload =
  | TelegramTextDeliveryPayload
  | TelegramArtifactDeliveryPayload;

type TelegramDeliveryRow = typeof telegramBotDeliveries.$inferSelect;

function deliveryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Telegram delivery failed";
}

function isTelegramMessageTooLongError(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) return false;
  return (
    error.status === 400 &&
    /message is too long|message_too_long|too long/i.test(error.message)
  );
}

function isTransientTelegramError(error: unknown): boolean {
  if (error instanceof TelegramApiError) {
    return error.status === 429 || error.status >= 500;
  }

  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("timed out") ||
    message.includes("timeout")
  );
}

function computeRetryAt(input: {
  attemptCount: number;
  error: unknown;
}): Date | null {
  if (!isTransientTelegramError(input.error)) return null;

  if (input.error instanceof TelegramApiError && input.error.retryAfterSeconds) {
    return new Date(Date.now() + input.error.retryAfterSeconds * 1000);
  }

  const backoffMinutes = Math.min(30, Math.max(1, 2 ** Math.max(0, input.attemptCount - 1)));
  return new Date(Date.now() + backoffMinutes * 60 * 1000);
}

function extractTelegramMessageId(result: unknown): string | null {
  if (Array.isArray(result)) {
    const last = result[result.length - 1] as Record<string, unknown> | undefined;
    if (last && typeof last.message_id === "number") {
      return String(last.message_id);
    }
    return null;
  }

  if (result && typeof result === "object" && typeof (result as Record<string, unknown>).message_id === "number") {
    return String((result as Record<string, unknown>).message_id);
  }

  return null;
}

async function queueTelegramBotDelivery(input: {
  companyId?: string | null;
  botUserId?: string | null;
  botThreadId?: string | null;
  telegramUserId: string;
  telegramChatId: string;
  sourceKind: string;
  dedupeKey?: string | null;
  payload: TelegramDeliveryPayload;
}) {
  if (input.dedupeKey?.trim()) {
    const [existing] = await db
      .select()
      .from(telegramBotDeliveries)
      .where(eq(telegramBotDeliveries.dedupeKey, input.dedupeKey.trim()))
      .limit(1);

    if (existing) return existing;
  }

  const [created] = await db
    .insert(telegramBotDeliveries)
    .values({
      companyId: input.companyId ?? null,
      botUserId: input.botUserId ?? null,
      botThreadId: input.botThreadId ?? null,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      sourceKind: input.sourceKind,
      dedupeKey: input.dedupeKey?.trim() || null,
      payload: input.payload as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({
      target: [telegramBotDeliveries.dedupeKey],
    })
    .returning();

  if (created) return created;

  if (input.dedupeKey?.trim()) {
    const [existing] = await db
      .select()
      .from(telegramBotDeliveries)
      .where(eq(telegramBotDeliveries.dedupeKey, input.dedupeKey.trim()))
      .limit(1);
    if (existing) return existing;
  }

  throw new Error("Failed to queue Telegram delivery");
}

async function sendQueuedTelegramDelivery(row: TelegramDeliveryRow) {
  const payload = row.payload as TelegramDeliveryPayload;

  switch (payload.kind) {
    case "message": {
      try {
        return await sendTelegramMessage({
          chatId: row.telegramChatId,
          text: payload.text,
          replyMarkup: payload.replyMarkup,
          replyToMessageId: payload.replyToMessageId ?? undefined,
        });
      } catch (error) {
        if (!isTelegramMessageTooLongError(error)) throw error;
        return sendTelegramLongMessage({
          chatId: row.telegramChatId,
          text: payload.text,
          replyMarkup: payload.replyMarkup,
          replyToMessageId: payload.replyToMessageId ?? undefined,
        });
      }
    }
    case "long_message":
      return sendTelegramLongMessage({
        chatId: row.telegramChatId,
        text: payload.text,
        replyMarkup: payload.replyMarkup,
        replyToMessageId: payload.replyToMessageId ?? undefined,
      });
    case "artifact_document": {
      const file = await loadTelegramArtifactFile({
        companyId: payload.companyId,
        threadId: payload.threadId,
        artifact: payload.artifact,
      });
      return sendTelegramDocument({
        chatId: row.telegramChatId,
        fileName: file.fileName,
        content: file.content,
        mimeType: file.mimeType,
        caption: payload.artifact.title,
      });
    }
    default:
      throw new Error(`Unsupported Telegram delivery kind: ${(payload as { kind?: string }).kind ?? "unknown"}`);
  }
}

async function claimTelegramBotDelivery(deliveryId: string) {
  const now = new Date();
  const [claimed] = await db
    .update(telegramBotDeliveries)
    .set({
      status: "sending",
      updatedAt: now,
    })
    .where(
      and(
        eq(telegramBotDeliveries.id, deliveryId),
        eq(telegramBotDeliveries.status, "queued"),
        or(
          isNull(telegramBotDeliveries.nextRetryAt),
          lte(telegramBotDeliveries.nextRetryAt, now),
        ),
      ),
    )
    .returning();

  if (claimed) return claimed;

  const [existing] = await db
    .select()
    .from(telegramBotDeliveries)
    .where(eq(telegramBotDeliveries.id, deliveryId))
    .limit(1);

  return existing ?? null;
}

export async function processTelegramBotDelivery(deliveryId: string) {
  const claimed = await claimTelegramBotDelivery(deliveryId);
  if (!claimed) {
    throw new Error("Telegram delivery not found");
  }
  if (claimed.status === "delivered") {
    return claimed;
  }
  if (claimed.status !== "sending") {
    return claimed;
  }

  const nextAttemptCount = claimed.attemptCount + 1;
  try {
    const result = await sendQueuedTelegramDelivery(claimed);
    const [updated] = await db
      .update(telegramBotDeliveries)
      .set({
        status: "delivered",
        attemptCount: nextAttemptCount,
        telegramMessageId: extractTelegramMessageId(result),
        lastError: null,
        nextRetryAt: null,
        result: {
          telegramResult: result,
        },
        updatedAt: new Date(),
      })
      .where(eq(telegramBotDeliveries.id, claimed.id))
      .returning();

    return updated ?? claimed;
  } catch (error) {
    const retryAt =
      nextAttemptCount < MAX_TELEGRAM_DELIVERY_ATTEMPTS
        ? computeRetryAt({ attemptCount: nextAttemptCount, error })
        : null;

    const [updated] = await db
      .update(telegramBotDeliveries)
      .set({
        status: retryAt ? "queued" : "failed",
        attemptCount: nextAttemptCount,
        lastError: deliveryErrorMessage(error),
        nextRetryAt: retryAt,
        updatedAt: new Date(),
      })
      .where(eq(telegramBotDeliveries.id, claimed.id))
      .returning();

    if (retryAt) {
      console.warn("[telegram-bot] queued delivery retry", {
        deliveryId: claimed.id,
        sourceKind: claimed.sourceKind,
        attemptCount: nextAttemptCount,
        nextRetryAt: retryAt.toISOString(),
        error: deliveryErrorMessage(error),
      });
    } else {
      console.error("[telegram-bot] delivery failed permanently", {
        deliveryId: claimed.id,
        sourceKind: claimed.sourceKind,
        attemptCount: nextAttemptCount,
        error: deliveryErrorMessage(error),
      });
    }

    return updated ?? claimed;
  }
}

export async function deliverTelegramText(input: {
  companyId?: string | null;
  botUserId?: string | null;
  botThreadId?: string | null;
  telegramUserId: string;
  telegramChatId: string;
  sourceKind: string;
  dedupeKey?: string | null;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
  replyToMessageId?: number;
  long?: boolean;
}) {
  const queued = await queueTelegramBotDelivery({
    companyId: input.companyId,
    botUserId: input.botUserId,
    botThreadId: input.botThreadId,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    sourceKind: input.sourceKind,
    dedupeKey: input.dedupeKey,
    payload: {
      kind:
        input.long || input.text.trim().length > TELEGRAM_MESSAGE_CHAR_LIMIT
          ? "long_message"
          : "message",
      text: input.text,
      replyMarkup: input.replyMarkup,
      replyToMessageId: input.replyToMessageId ?? null,
    },
  });

  return processTelegramBotDelivery(queued.id);
}

export async function deliverTelegramArtifact(input: {
  companyId: string;
  botUserId?: string | null;
  botThreadId?: string | null;
  telegramUserId: string;
  telegramChatId: string;
  sourceKind: string;
  dedupeKey?: string | null;
  threadId: string;
  artifact: ChatThreadArtifactSummary;
}) {
  const queued = await queueTelegramBotDelivery({
    companyId: input.companyId,
    botUserId: input.botUserId,
    botThreadId: input.botThreadId,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    sourceKind: input.sourceKind,
    dedupeKey: input.dedupeKey,
    payload: {
      kind: "artifact_document",
      companyId: input.companyId,
      threadId: input.threadId,
      artifact: input.artifact,
    },
  });

  return processTelegramBotDelivery(queued.id);
}

export async function retryQueuedTelegramBotDeliveries(input?: {
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(input?.limit ?? 50, 200));
  const now = new Date();

  const pending = await db
    .select({
      id: telegramBotDeliveries.id,
    })
    .from(telegramBotDeliveries)
    .where(
      and(
        eq(telegramBotDeliveries.status, "queued"),
        or(
          isNull(telegramBotDeliveries.nextRetryAt),
          lte(telegramBotDeliveries.nextRetryAt, now),
        ),
      ),
    )
    .orderBy(asc(telegramBotDeliveries.createdAt))
    .limit(limit);

  let delivered = 0;
  let failed = 0;
  let requeued = 0;

  for (const row of pending) {
    const result = await processTelegramBotDelivery(row.id);
    if (result.status === "delivered") {
      delivered += 1;
    } else if (result.status === "queued") {
      requeued += 1;
    } else if (result.status === "failed") {
      failed += 1;
    }
  }

  return {
    attempted: pending.length,
    delivered,
    failed,
    requeued,
  };
}
