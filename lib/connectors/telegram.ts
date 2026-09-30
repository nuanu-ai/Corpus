import { decrypt, encrypt } from "@/lib/crypto";

const TELEGRAM_LOGIN_STATE_TTL_MS = 15 * 60 * 1000;
const UNSUPPORTED_MESSAGE =
  "Telegram MTProto is not included in the open-source build. Use a Bot API integration or install a compatible adapter.";

export interface TelegramChatMeta {
  chatId: string;
  title: string;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramResolvedChatMeta extends TelegramChatMeta {
  entityClass?: "User" | "Chat" | "Channel";
  accessHash?: string;
}

export interface TelegramSyncedChat extends TelegramResolvedChatMeta {
  lastSyncedMessageId: number;
  enabled: boolean;
}

export interface TelegramPeopleContext {
  chatId: string;
  participantId: string;
  displayName: string;
  telegramHandle?: string;
  relatedCompanies: string[];
  analysisContext?: string;
  contactFilePath?: string;
}

export interface TelegramConnectionMetadata {
  phone: string;
  syncedChats: TelegramSyncedChat[];
  peopleContext: TelegramPeopleContext[];
}

interface TelegramLoginStatePayload {
  phone: string;
  phoneCodeHash: string;
  session: string;
  issuedAt: number;
}

interface TelegramMessageLike {
  id: number;
  date: number;
  message?: string | null;
  media?: unknown;
  replyTo?: { replyToMsgId?: number | null } | null;
  senderId?: { toString(): string } | null;
  sender?: unknown;
  postAuthor?: string | null;
  out?: boolean;
}

export interface TelegramParticipantMeta {
  participantId: string;
  displayName: string;
  telegramHandle?: string;
  isBot: boolean;
}

export interface TelegramClientAdapter {
  session: { save(): string };
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

function encryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY environment variable is required");
  return key;
}

function stringValue(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input.trim() : null;
}

function stringArrayValue(input: unknown, limit = 24): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(input.map(stringValue).filter((value): value is string => Boolean(value))),
  ).slice(0, limit);
}

function unavailable(): never {
  throw new Error(UNSUPPORTED_MESSAGE);
}

export function buildTelegramSessionKey(phone: string): string {
  return `tg:${phone.trim()}`;
}

export function createTelegramClient(sessionString = ""): TelegramClientAdapter {
  return {
    session: { save: () => sessionString },
    connect: async () => unavailable(),
    disconnect: async () => {},
  };
}

export function exportTelegramSession(client: TelegramClientAdapter): string {
  return client.session.save();
}

export function createTelegramLoginStateToken(input: {
  phone: string;
  phoneCodeHash: string;
  session: string;
  issuedAt?: number;
}): string {
  return encrypt(
    JSON.stringify({
      phone: input.phone.trim(),
      phoneCodeHash: input.phoneCodeHash.trim(),
      session: input.session,
      issuedAt: input.issuedAt ?? Date.now(),
    } satisfies TelegramLoginStatePayload),
    encryptionKey(),
  );
}

export function readTelegramLoginStateToken(token: string): TelegramLoginStatePayload {
  const parsed = JSON.parse(decrypt(token, encryptionKey())) as Partial<TelegramLoginStatePayload>;
  if (
    typeof parsed.phone !== "string" ||
    typeof parsed.phoneCodeHash !== "string" ||
    typeof parsed.session !== "string" ||
    typeof parsed.issuedAt !== "number"
  ) {
    throw new Error("Invalid Telegram login state");
  }
  if (Date.now() - parsed.issuedAt > TELEGRAM_LOGIN_STATE_TTL_MS) {
    throw new Error("Telegram login state has expired");
  }
  return parsed as TelegramLoginStatePayload;
}

export function parseTelegramChatMeta(dialog: {
  id?: { toString(): string } | string | number | null;
  title?: string | null;
  name?: string | null;
  className?: string | null;
  megagroup?: boolean | null;
}): TelegramChatMeta {
  const chatId = dialog.id?.toString() ?? "";
  const className = dialog.className?.toLowerCase();
  const type: TelegramChatMeta["type"] =
    className === "user"
      ? "private"
      : className === "channel"
        ? dialog.megagroup
          ? "supergroup"
          : "channel"
        : "group";
  return { chatId, title: dialog.title ?? dialog.name ?? chatId, type };
}

export function parseTelegramDialogMeta(
  dialog: Parameters<typeof parseTelegramChatMeta>[0] & { entity?: unknown },
): TelegramResolvedChatMeta {
  return parseTelegramChatMeta(dialog);
}

export function coerceTelegramConnectionMetadata(
  input: unknown,
  fallbackPhone = "",
): TelegramConnectionMetadata {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const syncedChats = Array.isArray(record.syncedChats)
    ? record.syncedChats.flatMap((value): TelegramSyncedChat[] => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const item = value as Record<string, unknown>;
        const chatId = stringValue(item.chatId);
        const title = stringValue(item.title);
        const type = item.type;
        if (!chatId || !title || !["private", "group", "supergroup", "channel"].includes(String(type))) return [];
        return [{
          chatId,
          title,
          type: type as TelegramChatMeta["type"],
          lastSyncedMessageId: typeof item.lastSyncedMessageId === "number" ? item.lastSyncedMessageId : 0,
          enabled: item.enabled !== false,
          ...(stringValue(item.entityClass) ? { entityClass: item.entityClass as TelegramResolvedChatMeta["entityClass"] } : {}),
          ...(stringValue(item.accessHash) ? { accessHash: stringValue(item.accessHash)! } : {}),
        }];
      })
    : [];
  const peopleContext = Array.isArray(record.peopleContext)
    ? record.peopleContext.flatMap((value): TelegramPeopleContext[] => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const item = value as Record<string, unknown>;
        const chatId = stringValue(item.chatId);
        const participantId = stringValue(item.participantId);
        const displayName = stringValue(item.displayName);
        if (!chatId || !participantId || !displayName) return [];
        return [{
          chatId,
          participantId,
          displayName,
          relatedCompanies: stringArrayValue(item.relatedCompanies),
          ...(stringValue(item.telegramHandle) ? { telegramHandle: stringValue(item.telegramHandle)! } : {}),
          ...(stringValue(item.analysisContext) ? { analysisContext: stringValue(item.analysisContext)! } : {}),
          ...(stringValue(item.contactFilePath) ? { contactFilePath: stringValue(item.contactFilePath)! } : {}),
        }];
      })
    : [];
  return {
    phone: stringValue(record.phone) ?? fallbackPhone,
    syncedChats,
    peopleContext,
  };
}

export async function sendTelegramCode(
  _client: TelegramClientAdapter,
  _phone: string,
): Promise<{ isCodeViaApp: boolean; phoneCodeHash: string }> {
  return unavailable();
}

export async function signInTelegramWithCode(_input: {
  client: TelegramClientAdapter;
  phone: string;
  phoneCodeHash: string;
  code: string;
}): Promise<void> {
  unavailable();
}

export async function signInTelegramWithPassword(
  _client: TelegramClientAdapter,
  _password: string,
): Promise<void> {
  unavailable();
}

export function isTelegramPasswordRequired(_error: unknown): boolean {
  return false;
}

export function getTelegramErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "Telegram request failed";
}

export async function listTelegramDialogs(
  _client: TelegramClientAdapter,
  _limit = 500,
): Promise<TelegramChatMeta[]> {
  return unavailable();
}

export async function listTelegramChatParticipants(
  _client: TelegramClientAdapter,
  _chatRef: unknown,
  _limit = 100,
): Promise<TelegramParticipantMeta[]> {
  return unavailable();
}

export async function listTelegramDialogEntries(
  _client: TelegramClientAdapter,
  _limit?: number,
): Promise<Array<{ meta: TelegramResolvedChatMeta; entity: unknown }>> {
  return unavailable();
}

export async function fetchTelegramChatHistory(
  _client: TelegramClientAdapter,
  _chatRef: unknown,
  _sinceMessageId: number,
  _limit = 100,
): Promise<TelegramMessageLike[]> {
  return unavailable();
}

export function normalizeTelegramMessage(
  message: TelegramMessageLike,
  chatMeta: TelegramChatMeta,
) {
  const sender = message.sender && typeof message.sender === "object"
    ? (message.sender as Record<string, unknown>)
    : null;
  const senderAddress = sender ? stringValue(sender.username) : null;
  return {
    provider: "telegram" as const,
    providerMessageId: String(message.id),
    providerChatId: chatMeta.chatId,
    providerThreadId: chatMeta.chatId,
    subject: chatMeta.title,
    senderName: stringValue(message.postAuthor) ?? (message.out ? "You" : null),
    senderAddress,
    senderId: message.senderId?.toString() ?? null,
    participantAddresses: senderAddress ? [senderAddress] : [],
    attachmentRefs: message.media ? [{ kind: "telegram_media" }] : [],
    content: stringValue(message.message),
    rawPayload: { id: message.id },
    receivedAt: new Date(message.date * 1000),
    replyToProviderMessageId: message.replyTo?.replyToMsgId?.toString() ?? null,
  };
}
