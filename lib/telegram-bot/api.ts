import { buildTelegramBotFileUrl } from "@/lib/telegram-bot/config";
import botCommands from "@/lib/telegram-bot/commands.json";
import { getTelegramBotToken } from "@/lib/telegram-bot/config";
import { formatTelegramMessageText } from "@/lib/telegram-bot/formatting";

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

// Telegram caps message text at 4096 chars. Markdown escaping can expand text,
// so split below the hard limit before formatting.
export const TELEGRAM_MESSAGE_CHAR_LIMIT = 1800;

export class TelegramApiError extends Error {
  method: string;
  status: number;
  retryAfterSeconds: number | null;

  constructor(input: {
    method: string;
    status: number;
    description: string;
    retryAfterSeconds?: number | null;
  }) {
    super(input.description);
    this.name = "TelegramApiError";
    this.method = input.method;
    this.status = input.status;
    this.retryAfterSeconds =
      typeof input.retryAfterSeconds === "number" && Number.isFinite(input.retryAfterSeconds)
        ? input.retryAfterSeconds
        : null;
  }
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface TelegramReplyMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface TelegramBotCommand {
  command: string;
  description: string;
}

export const DEFAULT_TELEGRAM_BOT_COMMANDS: TelegramBotCommand[] =
  botCommands satisfies TelegramBotCommand[];

async function callTelegramApi<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = getTelegramBotToken();
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as TelegramApiResponse<T> | null;
  if (!response.ok || !payload?.ok || payload.result === undefined) {
    const detail = payload?.description || `Telegram API ${method} failed`;
    const retryAfterRaw = response.headers.get("retry-after");
    const retryAfterSeconds =
      retryAfterRaw && Number.isFinite(Number(retryAfterRaw))
        ? Number.parseInt(retryAfterRaw, 10)
        : null;
    throw new TelegramApiError({
      method,
      status: response.status,
      description: detail,
      retryAfterSeconds,
    });
  }

  return payload.result;
}

async function callTelegramMultipartApi<T>(
  method: string,
  formData: FormData,
): Promise<T> {
  const token = getTelegramBotToken();
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      body: formData,
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => null)) as TelegramApiResponse<T> | null;
  if (!response.ok || !payload?.ok || payload.result === undefined) {
    const detail = payload?.description || `Telegram API ${method} failed`;
    const retryAfterRaw = response.headers.get("retry-after");
    const retryAfterSeconds =
      retryAfterRaw && Number.isFinite(Number(retryAfterRaw))
        ? Number.parseInt(retryAfterRaw, 10)
        : null;
    throw new TelegramApiError({
      method,
      status: response.status,
      description: detail,
      retryAfterSeconds,
    });
  }

  return payload.result;
}

export function splitTelegramText(text: string): string[] {
  const normalized = text.trim();
  if (normalized.length <= TELEGRAM_MESSAGE_CHAR_LIMIT) {
    return normalized.length > 0 ? [normalized] : [];
  }

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > TELEGRAM_MESSAGE_CHAR_LIMIT) {
    const slice = remaining.slice(0, TELEGRAM_MESSAGE_CHAR_LIMIT);
    const breakpoint = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const splitAt = breakpoint > TELEGRAM_MESSAGE_CHAR_LIMIT * 0.5 ? breakpoint : TELEGRAM_MESSAGE_CHAR_LIMIT;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

export async function sendTelegramMessage(input: {
  chatId: string | number;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
  replyToMessageId?: number;
}) {
  const formatted = formatTelegramMessageText(input.text);
  const body = {
    chat_id: input.chatId,
    text: formatted.text,
    parse_mode: formatted.parseMode,
    disable_web_page_preview: true,
    reply_markup: input.replyMarkup,
    reply_to_message_id: input.replyToMessageId,
  };

  try {
    return await callTelegramApi("sendMessage", body);
  } catch (error) {
    if (
      error instanceof TelegramApiError &&
      error.status === 400 &&
      error.message.toLowerCase().includes("parse")
    ) {
      console.warn("[telegram-bot] formatted message parse failed, retrying as plain text", {
        error: error.message,
      });
      return callTelegramApi("sendMessage", {
        chat_id: input.chatId,
        text: input.text,
        reply_markup: input.replyMarkup,
        reply_to_message_id: input.replyToMessageId,
      });
    }
    throw error;
  }
}

export async function sendTelegramLongMessage(input: {
  chatId: string | number;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
  replyToMessageId?: number;
}) {
  const chunks = splitTelegramText(input.text);
  if (chunks.length === 0) return [];

  const results = [];
  for (let index = 0; index < chunks.length; index += 1) {
    results.push(
      await sendTelegramMessage({
        chatId: input.chatId,
        text: chunks[index]!,
        replyMarkup: index === chunks.length - 1 ? input.replyMarkup : undefined,
        replyToMessageId: index === 0 ? input.replyToMessageId : undefined,
      }),
    );
  }
  return results;
}

export async function answerTelegramCallbackQuery(input: {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
}) {
  return callTelegramApi("answerCallbackQuery", {
    callback_query_id: input.callbackQueryId,
    text: input.text,
    show_alert: input.showAlert ?? false,
  });
}

export async function getTelegramFile(fileId: string): Promise<{
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
}> {
  return callTelegramApi("getFile", {
    file_id: fileId,
  });
}

export async function downloadTelegramFile(filePath: string): Promise<Buffer> {
  const response = await fetch(buildTelegramBotFileUrl(filePath), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Telegram file download failed with status ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function sendTelegramDocument(input: {
  chatId: string | number;
  fileName: string;
  content: Buffer;
  mimeType?: string | null;
  caption?: string;
  replyMarkup?: TelegramReplyMarkup;
}) {
  const formData = new FormData();
  formData.set("chat_id", String(input.chatId));
  if (input.caption?.trim()) {
    formData.set("caption", input.caption.trim());
  }
  if (input.replyMarkup) {
    formData.set("reply_markup", JSON.stringify(input.replyMarkup));
  }
  formData.set(
    "document",
    new File([new Uint8Array(input.content)], input.fileName, {
      type: input.mimeType ?? "application/octet-stream",
    }),
  );

  return callTelegramMultipartApi("sendDocument", formData);
}

export async function getTelegramWebhookInfo(): Promise<Record<string, unknown>> {
  return callTelegramApi("getWebhookInfo", {});
}

export async function setTelegramWebhook(input: {
  url: string;
  secretToken?: string | null;
  allowedUpdates?: string[];
  dropPendingUpdates?: boolean;
}) {
  return callTelegramApi("setWebhook", {
    url: input.url,
    secret_token: input.secretToken?.trim() || undefined,
    allowed_updates: input.allowedUpdates,
    drop_pending_updates: input.dropPendingUpdates ?? false,
  });
}

export async function deleteTelegramWebhook(input?: {
  dropPendingUpdates?: boolean;
}) {
  return callTelegramApi("deleteWebhook", {
    drop_pending_updates: input?.dropPendingUpdates ?? false,
  });
}

export async function setTelegramBotCommands(
  commands: TelegramBotCommand[] = DEFAULT_TELEGRAM_BOT_COMMANDS,
) {
  return callTelegramApi("setMyCommands", {
    commands,
    scope: { type: "default" },
  });
}

export async function setTelegramBotMenuButton() {
  return callTelegramApi("setChatMenuButton", {
    menu_button: { type: "commands" },
  });
}
