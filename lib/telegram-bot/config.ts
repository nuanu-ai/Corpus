function requireNonEmptyEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function getTelegramBotToken(): string {
  return requireNonEmptyEnv("CORPUS_TELEGRAM_BOT_TOKEN");
}

export function getTelegramBotUsername(): string {
  return requireNonEmptyEnv("CORPUS_TELEGRAM_BOT_USERNAME");
}

export function getTelegramBotWebhookSecret(): string | null {
  const value = process.env.CORPUS_TELEGRAM_BOT_WEBHOOK_SECRET?.trim();
  return value && value.length > 0 ? value : null;
}

export function getTelegramBotTranscriptionModel(): string {
  const value = process.env.CORPUS_TELEGRAM_BOT_TRANSCRIPTION_MODEL?.trim();
  return value && value.length > 0 ? value : "whisper-1";
}

export function buildTelegramBotDeepLink(ticket: string): string {
  const username = getTelegramBotUsername().replace(/^@+/, "");
  return `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(ticket)}`;
}

export function buildTelegramBotFileUrl(filePath: string): string {
  return `https://api.telegram.org/file/bot${getTelegramBotToken()}/${filePath.replace(/^\/+/, "")}`;
}
