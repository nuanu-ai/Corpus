import { inngest } from "@/lib/inngest";
import { TELEGRAM_BOT_UPDATE_EVENT } from "@/lib/telegram-bot/queue";
import {
  processTelegramBotUpdateByUpdateId,
  rescheduleQueuedTelegramBotUpdates,
} from "@/lib/telegram-bot/worker";

export const processTelegramBotUpdateFn = inngest.createFunction(
  {
    id: "process-telegram-bot-update",
    concurrency: [{ key: "event.data.scopeKey", limit: 1 }],
  },
  { event: TELEGRAM_BOT_UPDATE_EVENT },
  async ({ event, step }) => {
    const updateId = String(event.data.updateId);

    return step.run("process-telegram-bot-update", async () => {
      return processTelegramBotUpdateByUpdateId(updateId);
    });
  },
);

export const rescheduleQueuedTelegramBotUpdatesCron = inngest.createFunction(
  { id: "reschedule-queued-telegram-bot-updates", concurrency: 1 },
  { cron: "* * * * *" },
  async ({ step }) => {
    return step.run("reschedule", async () => rescheduleQueuedTelegramBotUpdates(25));
  },
);
