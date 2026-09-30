export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  width?: number;
  height?: number;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id?: string;
  mime_type?: string;
  file_size?: number;
  duration?: number;
}

export interface TelegramAudio {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  duration?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
  voice?: TelegramVoice;
  audio?: TelegramAudio;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramFileAttachment {
  kind: "document" | "photo" | "voice" | "audio";
  fileId: string;
  fileUniqueId?: string;
  fileName: string;
  mimeType?: string | null;
  fileSize?: number | null;
}

export function getTelegramUpdateType(update: TelegramUpdate): string {
  if (update.callback_query) return "callback_query";
  if (update.message?.document) return "message_document";
  if (update.message?.voice) return "message_voice";
  if (update.message?.audio) return "message_audio";
  if ((update.message?.photo?.length ?? 0) > 0) return "message_photo";
  if (typeof update.message?.text === "string" && update.message.text.trim()) {
    return "message_text";
  }
  if (typeof update.message?.caption === "string" && update.message.caption.trim()) {
    return "message_caption";
  }
  return "unknown";
}

export function getTelegramUpdateActor(update: TelegramUpdate): TelegramUser | null {
  return update.callback_query?.from ?? update.message?.from ?? null;
}

export function getTelegramUpdateChat(update: TelegramUpdate): TelegramChat | null {
  return update.callback_query?.message?.chat ?? update.message?.chat ?? null;
}

export function getTelegramMessageText(message: TelegramMessage | undefined): string {
  return message?.text?.trim() ?? message?.caption?.trim() ?? "";
}

export function parseTelegramCommand(text: string): {
  command: string;
  args: string[];
} | null {
  const normalized = text.trim();
  if (!normalized.startsWith("/")) return null;
  const [rawCommand, ...args] = normalized.split(/\s+/);
  const command = rawCommand.slice(1).split("@")[0]?.trim().toLowerCase();
  if (!command) return null;
  return {
    command,
    args,
  };
}

export function isTelegramPrivateChat(chat: TelegramChat | null | undefined): boolean {
  return (chat?.type ?? "").toLowerCase() === "private";
}

export function getTelegramFileAttachment(
  message: TelegramMessage | undefined,
): TelegramFileAttachment | null {
  if (message?.document) {
    return {
      kind: "document",
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      fileName: message.document.file_name?.trim() || "telegram-document",
      mimeType: message.document.mime_type ?? null,
      fileSize: message.document.file_size ?? null,
    };
  }

  if (message?.voice) {
    const suffix = message.voice.file_unique_id?.trim() || message.voice.file_id.trim();
    return {
      kind: "voice",
      fileId: message.voice.file_id,
      fileUniqueId: message.voice.file_unique_id,
      fileName: `telegram-voice-${suffix}.ogg`,
      mimeType: message.voice.mime_type ?? "audio/ogg",
      fileSize: message.voice.file_size ?? null,
    };
  }

  if (message?.audio) {
    return {
      kind: "audio",
      fileId: message.audio.file_id,
      fileUniqueId: message.audio.file_unique_id,
      fileName: message.audio.file_name?.trim() || "telegram-audio",
      mimeType: message.audio.mime_type ?? null,
      fileSize: message.audio.file_size ?? null,
    };
  }

  const largestPhoto = [...(message?.photo ?? [])].sort(
    (left, right) => (right.file_size ?? 0) - (left.file_size ?? 0),
  )[0];
  if (!largestPhoto) return null;

  const suffix = largestPhoto.file_unique_id?.trim() || largestPhoto.file_id.trim();
  return {
    kind: "photo",
    fileId: largestPhoto.file_id,
    fileUniqueId: largestPhoto.file_unique_id,
    fileName: `telegram-photo-${suffix}.jpg`,
    mimeType: "image/jpeg",
    fileSize: largestPhoto.file_size ?? null,
  };
}
