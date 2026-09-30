import { type TelegramUpdate } from "@/lib/telegram-bot/protocol";
import { enqueueTelegramBotUpdateProcessing } from "@/lib/telegram-bot/queue";
import {
  claimTelegramBotUpdate,
  getTelegramBotUpdateByUpdateId,
  listQueuedTelegramBotUpdates,
  markTelegramBotUpdateStatus,
  requeueStaleProcessingTelegramBotUpdates,
} from "@/lib/telegram-bot/storage";
import { processTelegramBotRecordedUpdate } from "@/lib/telegram-bot/webhook";

export async function processTelegramBotUpdateByUpdateId(updateId: string) {
  const claimed = await claimTelegramBotUpdate({ updateId });
  if (!claimed) {
    const existing = await getTelegramBotUpdateByUpdateId(updateId);
    return {
      ok: true,
      skipped: true,
      reason: existing ? `status:${existing.status}` : "missing",
    };
  }

  try {
    await processTelegramBotRecordedUpdate(claimed.payload as unknown as TelegramUpdate);
    await markTelegramBotUpdateStatus({ updateId, status: "completed" });
    return { ok: true, updateId };
  } catch (error) {
    await markTelegramBotUpdateStatus({ updateId, status: "failed" });
    throw error;
  }
}

export async function rescheduleQueuedTelegramBotUpdates(limit = 25) {
  const requeued = await requeueStaleProcessingTelegramBotUpdates({
    olderThanMinutes: 30,
  });
  const queued = await listQueuedTelegramBotUpdates({ limit });

  for (const row of queued) {
    await enqueueTelegramBotUpdateProcessing({
      updateId: row.updateId,
      telegramUserId: row.telegramUserId,
      telegramChatId: row.telegramChatId,
      fallbackToOutbox: false,
    });
  }

  return { queued: queued.length, requeued };
}
