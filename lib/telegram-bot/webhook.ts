import { timingSafeEqual } from "crypto";
import { type NextRequest, NextResponse } from "next/server";
import type { UIMessage } from "ai";

import { buildEphemeralAttachmentTextPreview } from "@/lib/chat/attachment-preview";
import {
  answerTelegramCallbackQuery,
  downloadTelegramFile,
  getTelegramFile,
  type TelegramReplyMarkup,
} from "@/lib/telegram-bot/api";
import {
  attachDocumentToTelegramBotThread,
  runTelegramBotCompanyChatTurn,
} from "@/lib/telegram-bot/chat";
import { getTelegramBotWebhookSecret } from "@/lib/telegram-bot/config";
import {
  deliverTelegramArtifact,
  deliverTelegramText,
} from "@/lib/telegram-bot/delivery";
import {
  getTelegramFileAttachment,
  getTelegramMessageText,
  getTelegramUpdateActor,
  getTelegramUpdateChat,
  getTelegramUpdateType,
  isTelegramPrivateChat,
  parseTelegramCommand,
  type TelegramCallbackQuery,
  type TelegramMessage,
  type TelegramUpdate,
} from "@/lib/telegram-bot/protocol";
import { enqueueTelegramBotUpdateProcessing } from "@/lib/telegram-bot/queue";
import {
  activateTelegramBotThread,
  clearTelegramBotPendingFileContext,
  createTelegramBotThread,
  createTelegramBotPendingFile,
  getActiveTelegramBotThread,
  getTelegramBotPendingFile,
  getTelegramBotUserByTelegramId,
  listTelegramBotThreads,
  linkTelegramBotUser,
  patchTelegramBotUserMetadata,
  recordTelegramBotUpdate,
  resolveTelegramBotAccess,
  setTelegramBotActiveCompany,
  touchTelegramBotUser,
  updateTelegramBotPendingFile,
} from "@/lib/telegram-bot/storage";
import { transcribeTelegramAudio } from "@/lib/telegram-bot/transcription";
import { consumeSingleUseTicketPayload } from "@/lib/single-use-ticket-store";
import { createCompanyForUser } from "@/lib/companies/create";
import {
  createCompanyDbProjectRecord,
  parseTelegramProjectSpec,
  type CompanyDbProjectStatus,
} from "@/lib/company-db/project-records";
import { createCompanyDocumentFromBytes } from "@/lib/documents/operations";
import { resolveChatApprovalDecision } from "@/lib/consultant/chat-approval-resolution";
import { db } from "@/lib/db";
import { chatApprovals, chatThreads } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { ChatThreadArtifactSummary, ChatThreadApprovalSummary } from "@/lib/consultant/store";

type TelegramBotChatTurnResult = Awaited<ReturnType<typeof runTelegramBotCompanyChatTurn>>;

const TELEGRAM_AUTO_CONTINUE_PROMPT =
  "Continue the previous request and produce the final user-facing answer now. " +
  "The previous turn reached the internal tool-call limit before finalizing. " +
  "Do not send only a progress update. Use already gathered evidence, use the minimum additional tools if needed, " +
  "and then answer with confirmed facts, source gaps, and next action.";

function hasCyrillic(text: string): boolean {
  return /[А-Яа-яЁё]/.test(text);
}

function isIncompleteTelegramChatTurn(result: TelegramBotChatTurnResult): boolean {
  if (result.finishReason === "tool-calls") return true;
  if (result.assistantText.trim().length > 0) return false;
  return result.newArtifacts.length === 0 && result.newApprovals.length === 0;
}

function buildIncompleteTelegramReply(input: {
  userText: string;
  result: TelegramBotChatTurnResult;
}): string {
  const stepSuffix =
    typeof input.result.stepCount === "number"
      ? ` Step count: ${input.result.stepCount}.`
      : "";
  if (hasCyrillic(input.userText)) {
    return (
      "Я не смог безопасно завершить ответ: внутренний chat-run остановился, пока ещё выполнял tool-calls. " +
      "Я не буду выдавать промежуточный текст как финальный результат. " +
      "Отправь “Continue”, и я продолжу этот же thread с уже собранным контекстом." +
      stepSuffix
    );
  }

  return (
    "I could not safely finalize the answer: the internal chat run stopped while it was still executing tool calls. " +
    "I will not present an intermediate progress message as the final answer. " +
    "Send “Continue” and I will continue the same thread with the context already gathered." +
    stepSuffix
  );
}

function mergeSummariesById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

export async function processTelegramBotRecordedUpdate(update: TelegramUpdate) {
  const actor = getTelegramUpdateActor(update);
  const chat = getTelegramUpdateChat(update);
  const telegramUserId = actor ? String(actor.id) : null;

  if (!telegramUserId || !chat) {
    return { ok: true, ignored: true };
  }

  await touchTelegramBotUser({
    telegramUserId,
    telegramUsername: actor?.username ?? null,
    firstName: actor?.first_name ?? null,
    lastName: actor?.last_name ?? null,
    languageCode: actor?.language_code ?? null,
  });

  if (update.callback_query) {
    await handleCallback({
      callback: update.callback_query,
      telegramUserId,
    });
    return { ok: true };
  }

  if (update.message) {
    await handleMessage({
      message: update.message,
      telegramUserId,
    });
  }

  return { ok: true };
}

type TelegramBotLinkPayload = {
  userId: string;
  preferredCompanyId?: string | null;
};

const MAX_TELEGRAM_NATIVE_FILE_PART_BYTES = 25 * 1024 * 1024;
const PENDING_CREATE_ACTION_TTL_MS = 30 * 60 * 1000;

type PendingCreateAction = {
  type: "create_company" | "create_project";
  requestedAt: string;
};

function buildMainMenuKeyboard(): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: "Switch company", callback_data: "m:companies" },
        { text: "Status", callback_data: "m:status" },
      ],
      [
        { text: "New chat", callback_data: "m:new" },
        { text: "Create project", callback_data: "m:create_project" },
      ],
      [
        { text: "Create company", callback_data: "m:create_company" },
        { text: "Help", callback_data: "m:help" },
      ],
    ],
  };
}

function parseNameAndDescription(text: string): {
  name: string;
  description: string | null;
} {
  const [namePart, ...descriptionParts] = text.split("|");
  const name = (namePart ?? "").replace(/\s+/g, " ").trim();
  const description = descriptionParts.join("|").replace(/\s+/g, " ").trim();
  return {
    name,
    description: description.length > 0 ? description : null,
  };
}

function parsePendingCreateAction(value: unknown): PendingCreateAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const type = record.type;
  const requestedAt = record.requestedAt;
  if (type !== "create_company" && type !== "create_project") return null;
  if (typeof requestedAt !== "string") return null;
  const requestedAtMs = Date.parse(requestedAt);
  if (!Number.isFinite(requestedAtMs)) return null;
  if (Date.now() - requestedAtMs > PENDING_CREATE_ACTION_TTL_MS) return null;
  return { type, requestedAt };
}

async function setPendingCreateAction(input: {
  telegramUserId: string;
  type: PendingCreateAction["type"];
}) {
  return patchTelegramBotUserMetadata({
    telegramUserId: input.telegramUserId,
    patch: {
      pendingCreateAction: {
        type: input.type,
        requestedAt: new Date().toISOString(),
      },
    },
  });
}

async function clearPendingCreateAction(telegramUserId: string) {
  return patchTelegramBotUserMetadata({
    telegramUserId,
    patch: {
      pendingCreateAction: null,
    },
  });
}

function buildCompanyKeyboard(input: {
  companyIds: string[];
  companyNames: string[];
}): TelegramReplyMarkup {
  return {
    inline_keyboard: input.companyIds.map((companyId, index) => [
      {
        text: input.companyNames[index] ?? companyId,
        callback_data: `c:${companyId}`,
      },
    ]),
  };
}

function buildPendingFileKeyboard(input: {
  pendingFileId: string;
  companyName: string | null;
}): TelegramReplyMarkup {
  const uploadLabel = input.companyName
    ? `Upload to ${input.companyName}`
    : "Upload";

  return {
    inline_keyboard: [
      [
        {
          text: "Discuss in chat",
          callback_data: `d:${input.pendingFileId}`,
        },
      ],
      [
        {
          text: uploadLabel,
          callback_data: `u:${input.pendingFileId}`,
        },
      ],
      [
        {
          text: "Choose company",
          callback_data: `s:${input.pendingFileId}`,
        },
      ],
      [
        {
          text: "Cancel",
          callback_data: `x:${input.pendingFileId}`,
        },
      ],
    ],
  };
}

function buildDataUrl(input: {
  content: Buffer;
  mimeType?: string | null;
}) {
  const mimeType = input.mimeType?.trim() || "application/octet-stream";
  return `data:${mimeType};base64,${input.content.toString("base64")}`;
}

async function buildTelegramAttachmentChatParts(input: {
  content: Buffer;
  fileName: string;
  mimeType?: string | null;
  fileKind: string;
}): Promise<UIMessage["parts"]> {
  const preview = await buildEphemeralAttachmentTextPreview({
    buffer: input.content,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
  if (preview) {
    return [
      {
        type: "text",
        text: `<attachment name="${input.fileName}">\n${preview}\n</attachment>`,
      },
    ] as UIMessage["parts"];
  }

  const mimeType = input.mimeType?.trim() || "application/octet-stream";
  const canSendNativePart =
    input.content.length <= MAX_TELEGRAM_NATIVE_FILE_PART_BYTES &&
    (mimeType === "application/pdf" || mimeType.startsWith("image/"));
  if (!canSendNativePart) {
    throw new Error(
      `This file type or size cannot be discussed directly in chat yet. Use "Upload to Company-DB" instead.`,
    );
  }

  return [
    {
      type: mimeType.startsWith("image/") ? "image" : "file",
      url: buildDataUrl({ content: input.content, mimeType }),
      mediaType: mimeType,
      filename: input.fileName,
    },
    {
      type: "text",
      text: `[Attached: ${input.fileName}]`,
    },
  ] as UIMessage["parts"];
}

function buildApprovalKeyboard(approvalId: string): TelegramReplyMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: "Approve",
          callback_data: `aa:${approvalId}`,
        },
        {
          text: "Reject",
          callback_data: `ar:${approvalId}`,
        },
      ],
    ],
  };
}

function verifyTelegramWebhook(request: NextRequest) {
  const expected = getTelegramBotWebhookSecret();
  if (!expected) {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.CORPUS_TELEGRAM_BOT_TOKEN?.trim()
    ) {
      throw new Error("CORPUS_TELEGRAM_BOT_WEBHOOK_SECRET is required in production");
    }
    return;
  }

  const actual = request.headers.get("x-telegram-bot-api-secret-token")?.trim() ?? "";

  // Length guard: timingSafeEqual requires equal-length Buffers.
  // A length mismatch is still rejected, and the branch itself is not
  // secret — the rejection path is the same either way.
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(actual, "utf8");
  const valid =
    actualBuf.length === expectedBuf.length &&
    timingSafeEqual(actualBuf, expectedBuf);

  if (!valid) {
    throw new Error("Invalid Telegram webhook secret");
  }
}

async function sendBotText(input: {
  telegramUserId: string;
  chatId: string | number;
  companyId?: string | null;
  botUserId?: string | null;
  botThreadId?: string | null;
  sourceKind: string;
  dedupeKey?: string | null;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
  replyToMessageId?: number;
  long?: boolean;
}) {
  return deliverTelegramText({
    companyId: input.companyId ?? null,
    botUserId: input.botUserId ?? null,
    botThreadId: input.botThreadId ?? null,
    telegramUserId: input.telegramUserId,
    telegramChatId: String(input.chatId),
    sourceKind: input.sourceKind,
    dedupeKey: input.dedupeKey ?? null,
    text: input.text,
    replyMarkup: input.replyMarkup,
    replyToMessageId: input.replyToMessageId,
    long: input.long,
  });
}

async function sendBotArtifact(input: {
  telegramUserId: string;
  chatId: string | number;
  companyId: string;
  botUserId?: string | null;
  botThreadId?: string | null;
  sourceKind: string;
  dedupeKey?: string | null;
  threadId: string;
  artifact: ChatThreadArtifactSummary;
}) {
  return deliverTelegramArtifact({
    companyId: input.companyId,
    botUserId: input.botUserId ?? null,
    botThreadId: input.botThreadId ?? null,
    telegramUserId: input.telegramUserId,
    telegramChatId: String(input.chatId),
    sourceKind: input.sourceKind,
    dedupeKey: input.dedupeKey ?? null,
    threadId: input.threadId,
    artifact: input.artifact,
  });
}

function formatCompanyListText(input: {
  companyNames: string[];
  activeCompanyId: string | null;
  companyIds: string[];
}) {
  return input.companyNames
    .map((name, index) => {
      const companyId = input.companyIds[index];
      const marker = companyId === input.activeCompanyId ? "active" : "available";
      return `- ${name} (${marker})`;
    })
    .join("\n");
}

function formatThreadListText(input: {
  threads: Array<{
    id: string;
    title: string;
    status: string;
  }>;
}) {
  if (input.threads.length === 0) {
    return "No Telegram threads exist for the active company yet.";
  }

  return input.threads
    .map((thread, index) => {
      const marker = thread.status === "active" ? "active" : "available";
      return `${index + 1}. ${thread.title} (${marker})`;
    })
    .join("\n");
}

function buildHelpText() {
  return (
    `Commands:\n` +
    `/menu - open buttons\n` +
    `/companies - switch active company\n` +
    `/use <company> - switch by exact company name or slug\n` +
    `/create_company <name> | <description> - create a new company and switch to it\n` +
    `/create_project <name> | <description> - create a project record in the active company\n` +
    `/new [title] - create a new Telegram chat thread\n` +
    `/threads - list Telegram threads for active company\n` +
    `/thread <number> - switch active thread\n` +
    `/where or /status - show active company and thread\n` +
    `/cancel - cancel a pending create/upload action\n` +
    `/help - show this help\n\n` +
    `Files:\n` +
    `- send a file with a caption to discuss it in chat only\n` +
    `- send a file without caption to choose Discuss in chat or Upload to Company-DB\n` +
    `- uploads to Company-DB always require explicit confirmation\n\n` +
    `Voice notes are transcribed with Whisper and handled as normal Corpus turns.`
  );
}

async function sendCompanySelectionMessage(input: {
  chatId: string;
  telegramUserId: string;
  companyId?: string | null;
  botUserId?: string | null;
  companyIds: string[];
  companyNames: string[];
  text: string;
  dedupeKey?: string | null;
}) {
  await sendBotText({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    companyId: input.companyId ?? null,
    botUserId: input.botUserId ?? null,
    sourceKind: "company_selection",
    dedupeKey: input.dedupeKey ?? null,
    text: input.text,
    replyMarkup: buildCompanyKeyboard({
      companyIds: input.companyIds,
      companyNames: input.companyNames,
    }),
  });
}

async function deliverTelegramArtifacts(input: {
  chatId: string;
  telegramUserId: string;
  companyId: string;
  threadId: string;
  botUserId?: string | null;
  botThreadId?: string | null;
  artifacts: ChatThreadArtifactSummary[];
}) {
  for (const artifact of input.artifacts) {
    try {
      await sendBotArtifact({
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
        companyId: input.companyId,
        botUserId: input.botUserId ?? null,
        botThreadId: input.botThreadId ?? null,
        sourceKind: "assistant_artifact",
        dedupeKey: `assistant_artifact:${artifact.id}`,
        threadId: input.threadId,
        artifact,
      });
    } catch (error) {
      await sendBotText({
        telegramUserId: input.telegramUserId,
        chatId: input.chatId,
        companyId: input.companyId,
        botUserId: input.botUserId ?? null,
        botThreadId: input.botThreadId ?? null,
        sourceKind: "artifact_delivery_error",
        dedupeKey: `assistant_artifact_error:${artifact.id}`,
        text:
          error instanceof Error
            ? `I created ${artifact.title}, but could not deliver the file: ${error.message}`
            : `I created ${artifact.title}, but could not deliver the file.`,
      });
    }
  }
}

async function notifyTelegramApprovals(input: {
  chatId: string;
  telegramUserId: string;
  companyId: string;
  botUserId?: string | null;
  botThreadId?: string | null;
  approvals: ChatThreadApprovalSummary[];
}) {
  for (const approval of input.approvals) {
    if (approval.status !== "pending") continue;
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      companyId: input.companyId,
      botUserId: input.botUserId ?? null,
      botThreadId: input.botThreadId ?? null,
      sourceKind: "approval_request",
      dedupeKey: `approval_request:${approval.id}`,
      text:
        `Approval requested.\n` +
        `Action: ${approval.action}\n` +
        `Approval ID: ${approval.id}`,
      replyMarkup: buildApprovalKeyboard(approval.id),
    });
  }
}

async function findTelegramApprovalContext(input: {
  approvalId: string;
  userId: string;
}) {
  const [row] = await db
    .select({
      approvalId: chatApprovals.id,
      threadId: chatApprovals.threadId,
      companyId: chatApprovals.companyId,
      action: chatApprovals.action,
      status: chatApprovals.status,
    })
    .from(chatApprovals)
    .innerJoin(chatThreads, eq(chatApprovals.threadId, chatThreads.id))
    .where(
      and(
        eq(chatApprovals.id, input.approvalId),
        eq(chatThreads.userId, input.userId),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function handleStartCommand(input: {
  message: TelegramMessage;
  telegramUserId: string;
  args: string[];
}) {
  if (!isTelegramPrivateChat(input.message.chat)) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.message.chat.id,
      sourceKind: "link_status",
      dedupeKey: `start:non_private:${input.message.message_id}`,
      text: "Account linking works in direct messages only. Open the bot in DM and use the link from Corpus.",
    });
    return;
  }

  const existing = await getTelegramBotUserByTelegramId(input.telegramUserId);
  if (!input.args[0]) {
    if (!existing?.userId) {
      await sendBotText({
        telegramUserId: input.telegramUserId,
        chatId: input.message.chat.id,
        botUserId: existing?.id ?? null,
        sourceKind: "link_status",
        dedupeKey: `start:unlinked:${input.message.message_id}`,
        text: "This Telegram account is not linked yet. Open Corpus and generate a Telegram bot link first.",
      });
      return;
    }

    const access = await resolveTelegramBotAccess(input.telegramUserId);
    const activeCompanyName = access.activeCompany?.companyName ?? "none";
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.message.chat.id,
      companyId: access.activeCompany?.companyId ?? null,
      botUserId: access.linkedUser.id,
      sourceKind: "link_status",
      dedupeKey: `start:linked:${input.message.message_id}`,
      text:
        `Corpus bot is linked.\n` +
        `Active company: ${activeCompanyName}\n\n` +
        buildHelpText(),
      replyMarkup: buildMainMenuKeyboard(),
    });
    return;
  }

  const payload = await consumeSingleUseTicketPayload<TelegramBotLinkPayload>({
    namespace: "telegram_bot_link",
    id: input.args[0],
  });

  if (!payload?.userId) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.message.chat.id,
      botUserId: existing?.id ?? null,
      sourceKind: "link_status",
      dedupeKey: `start:invalid:${input.message.message_id}`,
      text: "This Telegram link is invalid or expired. Generate a new one from Corpus.",
    });
    return;
  }

  const linked = await linkTelegramBotUser({
    telegramUserId: input.telegramUserId,
    userId: payload.userId,
    telegramUsername: input.message.from?.username ?? null,
    firstName: input.message.from?.first_name ?? null,
    lastName: input.message.from?.last_name ?? null,
    languageCode: input.message.from?.language_code ?? null,
    preferredCompanyId: payload.preferredCompanyId ?? null,
  });

  const activeCompany =
    linked.memberships.find((membership) => membership.companyId === linked.activeCompanyId) ??
    linked.memberships[0] ??
    null;

  await sendBotText({
    telegramUserId: input.telegramUserId,
    chatId: input.message.chat.id,
    companyId: activeCompany?.companyId ?? null,
    botUserId: linked.linkedUser.id,
    sourceKind: "link_status",
    dedupeKey: `start:linked_success:${input.message.message_id}`,
    text:
      `Corpus bot is now linked to your account.\n` +
      `Active company: ${activeCompany?.companyName ?? "none"}\n\n` +
      `Use /menu to open buttons, /companies to switch company, /new to create a Telegram thread, and send files to discuss or upload them.`,
    replyMarkup: buildMainMenuKeyboard(),
  });
}

async function handleCompaniesCommand(input: {
  chatId: string;
  telegramUserId: string;
  dedupeSuffix?: string | null;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  if (access.memberships.length === 0) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      botUserId: access.linkedUser.id,
      sourceKind: "company_status",
      dedupeKey: `companies:empty:${input.chatId}:${input.dedupeSuffix ?? "state"}`,
      text: "No accessible companies are linked to this account.",
    });
    return;
  }

  const companyIds = access.memberships.map((membership) => membership.companyId);
  const companyNames = access.memberships.map((membership) => membership.companyName);
  await sendCompanySelectionMessage({
    chatId: input.chatId,
    telegramUserId: input.telegramUserId,
    companyId: access.activeCompany?.companyId ?? null,
    botUserId: access.linkedUser.id,
    companyIds,
    companyNames,
    dedupeKey: `companies:list:${input.chatId}:${access.activeCompany?.companyId ?? "none"}:${input.dedupeSuffix ?? "state"}`,
    text:
      `Accessible companies:\n${formatCompanyListText({
        companyIds,
        companyNames,
        activeCompanyId: access.activeCompany?.companyId ?? null,
      })}\n\nTap a company to make it active for this Telegram bot chat.`,
  });
}

async function handleUseCommand(input: {
  chatId: string;
  telegramUserId: string;
  args: string[];
  dedupeSuffix?: string | null;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  if (input.args.length === 0) {
    await handleCompaniesCommand(input);
    return;
  }

  const wanted = input.args.join(" ").trim().toLowerCase();
  const match = access.memberships.find((membership) => {
    const name = membership.companyName.trim().toLowerCase();
    const slug = membership.companySlug?.trim().toLowerCase() ?? "";
    return name === wanted || slug === wanted;
  });

  if (!match) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      companyId: access.activeCompany?.companyId ?? null,
      botUserId: access.linkedUser.id,
      sourceKind: "company_status",
      dedupeKey: `use:not_found:${input.chatId}:${input.args.join(" ").trim().toLowerCase()}:${input.dedupeSuffix ?? "state"}`,
      text: `Company "${input.args.join(" ")}" is not accessible. Use /companies to see the available list.`,
    });
    return;
  }

  await setTelegramBotActiveCompany({
    telegramUserId: input.telegramUserId,
    companyId: match.companyId,
  });

  await sendBotText({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    companyId: match.companyId,
    botUserId: access.linkedUser.id,
    sourceKind: "company_status",
    dedupeKey: `use:success:${input.chatId}:${match.companyId}:${input.dedupeSuffix ?? "state"}`,
    text:
      `Active company switched to ${match.companyName}.\n` +
      `Use /status to see the active Telegram thread for this company.`,
  });
}

async function handleWhereCommand(input: {
  chatId: string;
  telegramUserId: string;
  telegramChatId: string;
  dedupeSuffix?: string | null;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  const activeThread = access.activeCompany
    ? await getActiveTelegramBotThread({
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
        companyId: access.activeCompany.companyId,
      })
    : null;
  await sendBotText({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    companyId: access.activeCompany?.companyId ?? null,
    botUserId: access.linkedUser.id,
    sourceKind: "thread_status",
    dedupeKey: `where:${input.telegramChatId}:${access.activeCompany?.companyId ?? "none"}:${input.dedupeSuffix ?? "state"}`,
    text: access.activeCompany
      ? `Active company: ${access.activeCompany.companyName}\n` +
        `Active thread: ${activeThread?.title ?? "none"}`
      : "No active company is currently selected.",
  });
}

async function handleMenuCommand(input: {
  chatId: string;
  telegramUserId: string;
  dedupeSuffix?: string | null;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  await sendBotText({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    companyId: access.activeCompany?.companyId ?? null,
    botUserId: access.linkedUser.id,
    sourceKind: "menu",
    dedupeKey: `menu:${input.chatId}:${input.dedupeSuffix ?? "state"}`,
    text:
      `Corpus Telegram menu\n` +
      `Active company: ${access.activeCompany?.companyName ?? "none"}\n\n` +
      `Send text or voice to chat. Send a file with a caption to discuss it without saving it. Send a file without caption to choose whether to discuss or upload it.`,
    replyMarkup: buildMainMenuKeyboard(),
  });
}

async function promptCreateAction(input: {
  chatId: string;
  telegramUserId: string;
  botUserId?: string | null;
  type: PendingCreateAction["type"];
  dedupeSuffix: string;
}) {
  await setPendingCreateAction({
    telegramUserId: input.telegramUserId,
    type: input.type,
  });

  const isCompany = input.type === "create_company";
  await sendBotText({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    botUserId: input.botUserId ?? null,
    sourceKind: isCompany ? "company_create_prompt" : "project_create_prompt",
    dedupeKey: `${input.type}:prompt:${input.dedupeSuffix}`,
    text: isCompany
      ? `Send the new company name.\nFormat: Company Name | optional short description\nUse /cancel to stop.`
      : `Send the new project name for the active company.\nFormat: Project Name | optional short description\nUse /cancel to stop.`,
  });
}

async function handleCreateCompanyCommand(input: {
  chatId: string;
  telegramUserId: string;
  argsText: string;
  dedupeSuffix: string;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  if (!access.linkedUser.userId) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      botUserId: access.linkedUser.id,
      sourceKind: "company_create_error",
      dedupeKey: `create_company:unlinked:${input.dedupeSuffix}`,
      text: "This Telegram account is not linked yet. Generate a Telegram bot link from Corpus first.",
    });
    return;
  }

  if (!input.argsText.trim()) {
    await promptCreateAction({
      chatId: input.chatId,
      telegramUserId: input.telegramUserId,
      botUserId: access.linkedUser.id,
      type: "create_company",
      dedupeSuffix: input.dedupeSuffix,
    });
    return;
  }

  const spec = parseNameAndDescription(input.argsText);
  try {
    const created = await createCompanyForUser({
      userId: access.linkedUser.userId,
      name: spec.name,
      companyDescription: spec.description,
    });
    await setTelegramBotActiveCompany({
      telegramUserId: input.telegramUserId,
      companyId: created.company.id,
    });
    await clearPendingCreateAction(input.telegramUserId);

    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      companyId: created.company.id,
      botUserId: access.linkedUser.id,
      sourceKind: "company_create_status",
      dedupeKey: `create_company:success:${created.company.id}:${input.dedupeSuffix}`,
      text:
        `Created company: ${created.company.name}\n` +
        `Active company switched to it.\n` +
        `Slug: ${created.company.slug ?? "pending"}\n` +
        `Company-DB: ${created.provisioning.ok ? "provisioned" : `provisioning failed (${created.provisioning.error})`}`,
    });
  } catch (error) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      botUserId: access.linkedUser.id,
      sourceKind: "company_create_error",
      dedupeKey: `create_company:error:${input.dedupeSuffix}`,
      text:
        error instanceof Error
          ? `I could not create the company: ${error.message}`
          : "I could not create the company.",
    });
  }
}

async function handleCreateProjectCommand(input: {
  chatId: string;
  telegramUserId: string;
  telegramChatId: string;
  argsText: string;
  dedupeSuffix: string;
  telegramMessageId?: number | string | null;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  if (!access.activeCompany || !access.linkedUser.userId) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      botUserId: access.linkedUser.id,
      sourceKind: "project_create_error",
      dedupeKey: `create_project:missing_company:${input.telegramChatId}:${input.dedupeSuffix}`,
      text: "Choose an active company first with /companies or /use <company>.",
    });
    return;
  }

  if (!input.argsText.trim()) {
    await promptCreateAction({
      chatId: input.chatId,
      telegramUserId: input.telegramUserId,
      botUserId: access.linkedUser.id,
      type: "create_project",
      dedupeSuffix: input.dedupeSuffix,
    });
    return;
  }

  try {
    const spec = parseTelegramProjectSpec(input.argsText);
    const status: CompanyDbProjectStatus = "active";
    const created = await createCompanyDbProjectRecord({
      companyId: access.activeCompany.companyId,
      companyDbPort: access.activeCompany.companyDbPort,
      userId: access.linkedUser.userId,
      name: spec.name,
      description: spec.description,
      status,
      source: "telegram_bot",
      telegram: {
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
        telegramMessageId: input.telegramMessageId ?? null,
      },
    });
    await clearPendingCreateAction(input.telegramUserId);

    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      companyId: access.activeCompany.companyId,
      botUserId: access.linkedUser.id,
      sourceKind: "project_create_status",
      dedupeKey: `create_project:success:${created.projectId}:${input.dedupeSuffix}`,
      text:
        `Created project in ${access.activeCompany.companyName}: ${created.name}\n` +
        `Status: ${created.status}\n` +
        `Company-DB file: ${created.filePath}\n` +
        `Commit: ${created.commitSha ?? "queued/unknown"}`,
    });
  } catch (error) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      companyId: access.activeCompany.companyId,
      botUserId: access.linkedUser.id,
      sourceKind: "project_create_error",
      dedupeKey: `create_project:error:${input.dedupeSuffix}`,
      text:
        error instanceof Error
          ? `I could not create the project: ${error.message}`
          : "I could not create the project.",
    });
  }
}

async function handlePendingCreateAction(input: {
  chatId: string;
  telegramUserId: string;
  telegramChatId: string;
  text: string;
  linkedUserMetadata: Record<string, unknown>;
  telegramMessageId: number;
}) {
  const pending = parsePendingCreateAction(input.linkedUserMetadata.pendingCreateAction);
  if (!pending) return false;

  if (pending.type === "create_company") {
    await handleCreateCompanyCommand({
      chatId: input.chatId,
      telegramUserId: input.telegramUserId,
      argsText: input.text,
      dedupeSuffix: String(input.telegramMessageId),
    });
    return true;
  }

  await handleCreateProjectCommand({
    chatId: input.chatId,
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    argsText: input.text,
    dedupeSuffix: String(input.telegramMessageId),
    telegramMessageId: input.telegramMessageId,
  });
  return true;
}

async function handleTextTurn(input: {
  chatId: string;
  telegramUserId: string;
  telegramChatId: string;
  telegramChatType: string;
  userText: string;
  uiMessageId?: string | null;
  messageMetadata?: Record<string, unknown>;
  additionalParts?: UIMessage["parts"];
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  if (!access.activeCompany || !access.linkedUser.userId) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      botUserId: access.linkedUser.id,
      sourceKind: "thread_status",
      dedupeKey: `thread:missing_company:${input.telegramChatId}`,
      text: "Choose an active company first with /companies or /use <company>.",
    });
    return;
  }

  try {
    let result = await runTelegramBotCompanyChatTurn({
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      telegramChatType: input.telegramChatType,
      companyId: access.activeCompany.companyId,
      companyName: access.activeCompany.companyName,
      userId: access.linkedUser.userId,
      userRole: access.activeCompany.role,
      userText: input.userText,
      uiMessageId: input.uiMessageId,
      messageMetadata: input.messageMetadata,
      additionalParts: input.additionalParts,
    });
    const attempts = [result];

    if (result.finishReason === "tool-calls") {
      result = await runTelegramBotCompanyChatTurn({
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
        telegramChatType: input.telegramChatType,
        companyId: access.activeCompany.companyId,
        companyName: access.activeCompany.companyName,
        userId: access.linkedUser.userId,
        userRole: access.activeCompany.role,
        userText: TELEGRAM_AUTO_CONTINUE_PROMPT,
        uiMessageId: `${input.uiMessageId ?? result.assistantMessage.id}:auto-continue-1`,
        messageMetadata: {
          source: "telegram_auto_continue",
          reason: "tool_calls_step_limit",
          originalUiMessageId: input.uiMessageId ?? null,
          previousAssistantMessageId: result.assistantMessage.id,
          previousChatRunId: result.chatRunId,
          previousFinishReason: result.finishReason,
          previousStepCount: result.stepCount,
        },
      });
      attempts.push(result);
    }

    const assistantReply = isIncompleteTelegramChatTurn(result)
      ? buildIncompleteTelegramReply({
          userText: input.userText,
          result,
        })
      : result.assistantText;
    const newArtifacts = mergeSummariesById(
      attempts.flatMap((attempt) => attempt.newArtifacts),
    );
    const newApprovals = mergeSummariesById(
      attempts.flatMap((attempt) => attempt.newApprovals),
    );

    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      companyId: access.activeCompany.companyId,
      botUserId: access.linkedUser.id,
      botThreadId: result.botThread.id,
      sourceKind: "assistant_reply",
      dedupeKey: `assistant_reply:${result.chatThreadId}:${input.uiMessageId ?? result.assistantMessage.id}`,
      text: assistantReply,
      long: true,
    });

    await deliverTelegramArtifacts({
      chatId: String(input.chatId),
      telegramUserId: input.telegramUserId,
      companyId: access.activeCompany.companyId,
      threadId: result.chatThreadId,
      botUserId: access.linkedUser.id,
      botThreadId: result.botThread.id,
      artifacts: newArtifacts,
    });

    await notifyTelegramApprovals({
      chatId: String(input.chatId),
      telegramUserId: input.telegramUserId,
      companyId: access.activeCompany.companyId,
      botUserId: access.linkedUser.id,
      botThreadId: result.botThread.id,
      approvals: newApprovals,
    });
  } catch (error) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      companyId: access.activeCompany.companyId,
      botUserId: access.linkedUser.id,
      sourceKind: "assistant_error",
      dedupeKey: `assistant_error:${input.telegramChatId}:${input.uiMessageId ?? input.userText.slice(0, 64)}`,
      text:
        error instanceof Error
          ? `I could not complete this Corpus turn: ${error.message}`
          : "I could not complete this Corpus turn.",
    });
  }
}

async function handleNewThreadCommand(input: {
  chatId: string;
  telegramUserId: string;
  telegramChatId: string;
  telegramChatType: string;
  args: string[];
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  if (!access.activeCompany || !access.linkedUser.userId) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      botUserId: access.linkedUser.id,
      sourceKind: "thread_status",
      dedupeKey: `new:missing_company:${input.telegramChatId}`,
      text: "Choose an active company first with /companies or /use <company>.",
    });
    return;
  }

  const created = await createTelegramBotThread({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    telegramChatType: input.telegramChatType,
    userId: access.linkedUser.userId,
    companyId: access.activeCompany.companyId,
    title: input.args.join(" ").trim() || `Telegram chat · ${access.activeCompany.companyName}`,
  });

  await sendBotText({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    companyId: access.activeCompany.companyId,
    botUserId: access.linkedUser.id,
    botThreadId: created.botThread.id,
    sourceKind: "thread_status",
    dedupeKey: `new:created:${created.botThread.id}`,
    text:
      `Created thread: ${created.botThread.title}\n` +
      `Company: ${access.activeCompany.companyName}\n\n` +
      `Use /threads to switch between Telegram threads for this company.`,
  });
}

async function handleThreadsCommand(input: {
  chatId: string;
  telegramUserId: string;
  telegramChatId: string;
  dedupeSuffix?: string | null;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  if (!access.activeCompany) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      botUserId: access.linkedUser.id,
      sourceKind: "thread_status",
      dedupeKey: `threads:missing_company:${input.telegramChatId}:${input.dedupeSuffix ?? "state"}`,
      text: "Choose an active company first with /companies or /use <company>.",
    });
    return;
  }

  const threads = await listTelegramBotThreads({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    companyId: access.activeCompany.companyId,
  });

  await sendBotText({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    companyId: access.activeCompany.companyId,
    botUserId: access.linkedUser.id,
    sourceKind: "thread_status",
    dedupeKey: `threads:list:${input.telegramChatId}:${access.activeCompany.companyId}:${input.dedupeSuffix ?? "state"}`,
    text:
      `Threads for ${access.activeCompany.companyName}:\n` +
      `${formatThreadListText({ threads })}\n\n` +
      `Use /thread <number> to switch or /new to create a new one.`,
  });
}

async function handleThreadCommand(input: {
  chatId: string;
  telegramUserId: string;
  telegramChatId: string;
  args: string[];
  dedupeSuffix?: string | null;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  if (!access.activeCompany) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      botUserId: access.linkedUser.id,
      sourceKind: "thread_status",
      dedupeKey: `thread:missing_company:${input.telegramChatId}:${input.dedupeSuffix ?? "state"}`,
      text: "Choose an active company first with /companies or /use <company>.",
    });
    return;
  }

  const threads = await listTelegramBotThreads({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    companyId: access.activeCompany.companyId,
  });

  if (input.args.length === 0 || threads.length === 0) {
    await handleThreadsCommand(input);
    return;
  }

  const rawSelection = input.args.join(" ").trim();
  const numericSelection = Number.parseInt(rawSelection, 10);
  const selected =
    Number.isFinite(numericSelection) && numericSelection >= 1
      ? threads[numericSelection - 1] ?? null
      : threads.find(
          (thread) => thread.title.trim().toLowerCase() === rawSelection.toLowerCase(),
        ) ?? null;

  if (!selected) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      companyId: access.activeCompany.companyId,
      botUserId: access.linkedUser.id,
      sourceKind: "thread_status",
      dedupeKey: `thread:not_found:${input.telegramChatId}:${rawSelection.toLowerCase()}:${input.dedupeSuffix ?? "state"}`,
      text:
        `Thread "${rawSelection}" was not found for ${access.activeCompany.companyName}.\n\n` +
        `${formatThreadListText({ threads })}`,
    });
    return;
  }

  const activeThread = await activateTelegramBotThread({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    companyId: access.activeCompany.companyId,
    botThreadId: selected.id,
  });

  await sendBotText({
    telegramUserId: input.telegramUserId,
    chatId: input.chatId,
    companyId: access.activeCompany.companyId,
    botUserId: access.linkedUser.id,
    botThreadId: activeThread.id,
    sourceKind: "thread_status",
    dedupeKey: `thread:active:${activeThread.id}:${input.dedupeSuffix ?? "state"}`,
    text: `Active thread switched to ${activeThread.title}.`,
  });
}

async function discussPendingTelegramFile(input: {
  pendingFileId: string;
  telegramUserId: string;
  chatId: string;
  telegramChatType: string;
  userText?: string | null;
  callbackQueryId?: string | null;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  const pending = await getTelegramBotPendingFile(input.pendingFileId);

  if (!pending || pending.telegramUserId !== input.telegramUserId) {
    if (input.callbackQueryId) {
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callbackQueryId,
        text: "File request not found.",
        showAlert: true,
      });
    }
    return;
  }

  const company =
    access.memberships.find((membership) => membership.companyId === pending.selectedCompanyId) ??
    access.activeCompany;
  if (!company) {
    if (input.callbackQueryId) {
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callbackQueryId,
        text: "Choose a company first.",
        showAlert: true,
      });
    }
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      botUserId: access.linkedUser.id,
      sourceKind: "file_status",
      dedupeKey: `file:discuss:missing_company:${pending.id}`,
      text: "Choose an active company first with /companies, then discuss this file.",
    });
    return;
  }

  await setTelegramBotActiveCompany({
    telegramUserId: input.telegramUserId,
    companyId: company.companyId,
  });
  await updateTelegramBotPendingFile({
    pendingFileId: pending.id,
    selectedCompanyId: company.companyId,
    status: "discussing",
  });

  try {
    const fileInfo = pending.telegramFilePath
      ? { file_path: pending.telegramFilePath }
      : await getTelegramFile(pending.telegramFileId);
    const filePath = fileInfo.file_path;
    if (!filePath) {
      throw new Error("Telegram did not return a downloadable file path");
    }

    const content = await downloadTelegramFile(filePath);
    const additionalParts = await buildTelegramAttachmentChatParts({
      content,
      fileName: pending.fileName,
      mimeType: pending.mimeType,
      fileKind: pending.fileKind,
    });
    const userText =
      input.userText?.trim() ||
      `Please review the attached Telegram file "${pending.fileName}" in this chat. Do not save it to Company-DB unless I explicitly ask.`;

    if (input.callbackQueryId) {
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callbackQueryId,
        text: "Discussing file in chat.",
      });
    }

    await updateTelegramBotPendingFile({
      pendingFileId: pending.id,
      selectedCompanyId: company.companyId,
      telegramFilePath: filePath,
      status: "discussed",
      metadataPatch: {
        discussedAt: new Date().toISOString(),
      },
    });

    await handleTextTurn({
      chatId: input.chatId,
      telegramUserId: input.telegramUserId,
      telegramChatId: pending.telegramChatId,
      telegramChatType: input.telegramChatType,
      userText,
      uiMessageId: `telegram-file-chat-${pending.telegramMessageId}`,
      messageMetadata: {
        source: "telegram_file_chat",
        telegramMessageId: pending.telegramMessageId,
        telegramFileId: pending.telegramFileId,
        telegramFileUniqueId: pending.telegramFileUniqueId ?? null,
        pendingFileId: pending.id,
        fileName: pending.fileName,
        mimeType: pending.mimeType ?? null,
        fileKind: pending.fileKind,
      },
      additionalParts,
    });
  } catch (error) {
    await updateTelegramBotPendingFile({
      pendingFileId: pending.id,
      status: "rejected",
      metadataPatch: {
        lastError: error instanceof Error ? error.message : "Telegram file discussion failed",
      },
    });
    if (input.callbackQueryId) {
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callbackQueryId,
        text: "Could not discuss file.",
        showAlert: true,
      });
    }
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      companyId: company.companyId,
      botUserId: access.linkedUser.id,
      sourceKind: "file_error",
      dedupeKey: `file:discuss:error:${pending.id}`,
      text:
        error instanceof Error
          ? `I could not discuss this file in chat: ${error.message}`
          : "I could not discuss this file in chat.",
    });
  }
}

async function handleFileMessage(input: {
  message: TelegramMessage;
  telegramUserId: string;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  if (!access.linkedUser.userId) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.message.chat.id,
      botUserId: access.linkedUser.id,
      sourceKind: "link_status",
      dedupeKey: `file:unlinked:${input.message.message_id}`,
      text: "This Telegram account is not linked yet. Generate a link from Corpus first.",
    });
    return;
  }

  const attachment = getTelegramFileAttachment(input.message);
  if (!attachment) return;

  if (attachment.kind === "voice" || attachment.kind === "audio") {
    try {
      const fileInfo = await getTelegramFile(attachment.fileId);
      const filePath = fileInfo.file_path;
      if (!filePath) {
        throw new Error("Telegram did not return a downloadable audio path");
      }

      const content = await downloadTelegramFile(filePath);
      const transcript = await transcribeTelegramAudio({
        content,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        prompt: "Business, finance, legal, tax, and operations vocabulary for Corpus company discussions.",
      });

      await sendBotText({
        telegramUserId: input.telegramUserId,
        chatId: input.message.chat.id,
        companyId: access.activeCompany?.companyId ?? null,
        botUserId: access.linkedUser.id,
        sourceKind: "voice_transcript",
        dedupeKey: `voice:transcript:${input.message.message_id}`,
        text:
          `Transcript received.\n` +
          `${transcript.length > 600 ? `${transcript.slice(0, 599)}…` : transcript}`,
        replyToMessageId: input.message.message_id,
      });

      await handleTextTurn({
        chatId: String(input.message.chat.id),
        telegramUserId: input.telegramUserId,
        telegramChatId: String(input.message.chat.id),
        telegramChatType: input.message.chat.type,
        userText: transcript,
        uiMessageId: `telegram-voice-${input.message.message_id}`,
        messageMetadata: {
          source: "telegram_voice",
          telegramMessageId: input.message.message_id,
          telegramFileId: attachment.fileId,
          telegramFileUniqueId: attachment.fileUniqueId ?? null,
          mimeType: attachment.mimeType ?? null,
        },
      });
    } catch (error) {
      await sendBotText({
        telegramUserId: input.telegramUserId,
        chatId: input.message.chat.id,
        companyId: access.activeCompany?.companyId ?? null,
        botUserId: access.linkedUser.id,
        sourceKind: "voice_error",
        dedupeKey: `voice:error:${input.message.message_id}`,
        text:
          error instanceof Error
            ? `I could not transcribe this audio message: ${error.message}`
            : "I could not transcribe this audio message.",
        replyToMessageId: input.message.message_id,
      });
    }
    return;
  }

  const pending = await createTelegramBotPendingFile({
    telegramUserId: input.telegramUserId,
    telegramChatId: String(input.message.chat.id),
    telegramMessageId: String(input.message.message_id),
    userId: access.linkedUser.userId,
    selectedCompanyId: access.activeCompany?.companyId ?? null,
    telegramFileId: attachment.fileId,
    telegramFileUniqueId: attachment.fileUniqueId ?? null,
    fileKind: attachment.kind,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType ?? null,
    fileSizeBytes: attachment.fileSize ?? null,
    metadata: {
      caption: input.message.caption ?? null,
    },
  });

  const caption = input.message.caption?.trim() ?? "";
  if (caption.length > 0) {
    await discussPendingTelegramFile({
      pendingFileId: pending.id,
      telegramUserId: input.telegramUserId,
      chatId: String(input.message.chat.id),
      telegramChatType: input.message.chat.type,
      userText: caption,
    });
    return;
  }

  await sendBotText({
    telegramUserId: input.telegramUserId,
    chatId: input.message.chat.id,
    companyId: access.activeCompany?.companyId ?? null,
    botUserId: access.linkedUser.id,
    sourceKind: "file_status",
    dedupeKey: `file:pending:${pending.id}`,
    text:
      `I received ${attachment.fileName}.\n` +
      `Current company: ${access.activeCompany?.companyName ?? "none"}\n\n` +
      `Choose whether to discuss it only in this chat or upload it into Company-DB.`,
    replyMarkup: buildPendingFileKeyboard({
      pendingFileId: pending.id,
      companyName: access.activeCompany?.companyName ?? null,
    }),
    replyToMessageId: input.message.message_id,
  });
}

async function ingestPendingTelegramFile(input: {
  pendingFileId: string;
  telegramUserId: string;
  callbackQueryId: string;
  chatId: string;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  const pending = await getTelegramBotPendingFile(input.pendingFileId);

  if (!pending || pending.telegramUserId !== input.telegramUserId) {
    await answerTelegramCallbackQuery({
      callbackQueryId: input.callbackQueryId,
      text: "File request not found.",
      showAlert: true,
    });
    return;
  }

  const company =
    access.memberships.find((membership) => membership.companyId === pending.selectedCompanyId) ??
    access.activeCompany;
  if (!company) {
    await answerTelegramCallbackQuery({
      callbackQueryId: input.callbackQueryId,
      text: "Choose a company first.",
      showAlert: true,
    });
    return;
  }

  await updateTelegramBotPendingFile({
    pendingFileId: pending.id,
    selectedCompanyId: company.companyId,
    status: "processing",
  });

  try {
    const fileInfo = pending.telegramFilePath
      ? { file_path: pending.telegramFilePath }
      : await getTelegramFile(pending.telegramFileId);
    const filePath = fileInfo.file_path;
    if (!filePath) {
      throw new Error("Telegram did not return a downloadable file path");
    }

    const content = await downloadTelegramFile(filePath);
    const created = await createCompanyDocumentFromBytes({
      companyId: company.companyId,
      userId: access.linkedUser.userId!,
      fileName: pending.fileName,
      mimeType: pending.mimeType,
      content,
      source: "telegram_bot",
      ingressSource: "telegram_bot",
      rawPayload: {
        telegramChatId: pending.telegramChatId,
        telegramMessageId: pending.telegramMessageId,
        telegramUserId: pending.telegramUserId,
        telegramFileId: pending.telegramFileId,
        telegramFileUniqueId: pending.telegramFileUniqueId,
        telegramFilePath: filePath,
        pendingFileId: pending.id,
      },
    });

    await updateTelegramBotPendingFile({
      pendingFileId: pending.id,
      selectedCompanyId: company.companyId,
      documentId: created.documentId,
      telegramFilePath: filePath,
      status: "uploaded",
    });

    await attachDocumentToTelegramBotThread({
      telegramUserId: input.telegramUserId,
      telegramChatId: pending.telegramChatId,
      companyId: company.companyId,
      documentId: created.documentId,
      fileName: created.fileName,
      fileType: created.fileType ?? null,
      metadata: {
        ingressSource: "telegram_bot",
        pendingFileId: pending.id,
      },
    }).catch((error) => {
      console.warn("Failed to attach Telegram document to consultant thread", error);
    });

    await clearTelegramBotPendingFileContext(input.telegramUserId);
    await answerTelegramCallbackQuery({
      callbackQueryId: input.callbackQueryId,
      text: "File queued for processing.",
    });
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      companyId: company.companyId,
      botUserId: access.linkedUser.id,
      sourceKind: "file_status",
      dedupeKey: `file:uploaded:${pending.id}`,
      text:
        `Queued ${created.fileName} for ${company.companyName}.\n` +
        `Document ID: ${created.documentId}\n` +
        `Status: ${created.status}`,
    });
  } catch (error) {
    await updateTelegramBotPendingFile({
      pendingFileId: pending.id,
      status: "rejected",
      metadataPatch: {
        lastError: error instanceof Error ? error.message : "Telegram upload failed",
      },
    });

    await answerTelegramCallbackQuery({
      callbackQueryId: input.callbackQueryId,
      text: "Upload failed.",
      showAlert: true,
    });
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      companyId: company.companyId,
      botUserId: access.linkedUser.id,
      sourceKind: "file_error",
      dedupeKey: `file:error:${pending.id}`,
      text:
        error instanceof Error
          ? `I could not queue this file: ${error.message}`
          : "I could not queue this file.",
    });
  }
}

async function handleCallback(input: {
  callback: TelegramCallbackQuery;
  telegramUserId: string;
}) {
  const data = input.callback.data?.trim() ?? "";
  const chat = input.callback.message?.chat;
  const chatId = String(chat?.id ?? "");
  if (!data || !chatId || !isTelegramPrivateChat(chat)) {
    await answerTelegramCallbackQuery({
      callbackQueryId: input.callback.id,
      text: "Telegram bot actions currently work in direct messages only.",
      showAlert: true,
    });
    return;
  }

  const [kind, value] = data.split(":", 2);

  if (kind === "m" && value) {
    if (value === "companies") {
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callback.id,
        text: "Opening company selector.",
      });
      await handleCompaniesCommand({
        chatId,
        telegramUserId: input.telegramUserId,
        dedupeSuffix: input.callback.id,
      });
      return;
    }

    if (value === "status") {
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callback.id,
        text: "Checking status.",
      });
      await handleWhereCommand({
        chatId,
        telegramUserId: input.telegramUserId,
        telegramChatId: chatId,
        dedupeSuffix: input.callback.id,
      });
      return;
    }

    if (value === "new") {
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callback.id,
        text: "Creating a new chat.",
      });
      await handleNewThreadCommand({
        chatId,
        telegramUserId: input.telegramUserId,
        telegramChatId: chatId,
        telegramChatType: chat?.type ?? "private",
        args: [],
      });
      return;
    }

    if (value === "create_company") {
      const linkedUser = await getTelegramBotUserByTelegramId(input.telegramUserId);
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callback.id,
        text: "Send company name.",
      });
      await promptCreateAction({
        chatId,
        telegramUserId: input.telegramUserId,
        botUserId: linkedUser?.id ?? null,
        type: "create_company",
        dedupeSuffix: input.callback.id,
      });
      return;
    }

    if (value === "create_project") {
      const linkedUser = await getTelegramBotUserByTelegramId(input.telegramUserId);
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callback.id,
        text: "Send project name.",
      });
      await promptCreateAction({
        chatId,
        telegramUserId: input.telegramUserId,
        botUserId: linkedUser?.id ?? null,
        type: "create_project",
        dedupeSuffix: input.callback.id,
      });
      return;
    }

    if (value === "help") {
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callback.id,
        text: "Opening help.",
      });
      await sendBotText({
        telegramUserId: input.telegramUserId,
        chatId,
        sourceKind: "help",
        dedupeKey: `help:callback:${input.callback.id}`,
        text: buildHelpText(),
      });
      return;
    }
  }

  if (kind === "c" && value) {
    const access = await setTelegramBotActiveCompany({
      telegramUserId: input.telegramUserId,
      companyId: value,
    });
    const linkedUser = await patchTelegramBotUserMetadata({
      telegramUserId: input.telegramUserId,
      patch: {},
    });
    const awaitingPendingFileId =
      typeof linkedUser?.metadata?.awaitingPendingFileId === "string"
        ? linkedUser.metadata.awaitingPendingFileId
        : null;

    await answerTelegramCallbackQuery({
      callbackQueryId: input.callback.id,
      text: `Active company: ${access.company.companyName}`,
    });

    if (awaitingPendingFileId) {
      await updateTelegramBotPendingFile({
        pendingFileId: awaitingPendingFileId,
        selectedCompanyId: access.company.companyId,
        status: "pending_confirmation",
      });
      await clearTelegramBotPendingFileContext(input.telegramUserId);
      await sendBotText({
        telegramUserId: input.telegramUserId,
        chatId,
        companyId: access.company.companyId,
        botUserId: linkedUser?.id ?? null,
        sourceKind: "file_status",
        dedupeKey: `callback:company_selected:${awaitingPendingFileId}:${input.callback.id}`,
        text: `Selected ${access.company.companyName}. Choose whether to discuss or upload this file.`,
        replyMarkup: buildPendingFileKeyboard({
          pendingFileId: awaitingPendingFileId,
          companyName: access.company.companyName,
        }),
      });
      return;
    }

    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId,
      companyId: access.company.companyId,
      botUserId: linkedUser?.id ?? null,
      sourceKind: "company_status",
      dedupeKey: `callback:company_switched:${access.company.companyId}:${input.callback.id}`,
      text: `Active company switched to ${access.company.companyName}.`,
    });
    return;
  }

  if (kind === "s" && value) {
    const access = await resolveTelegramBotAccess(input.telegramUserId);
    await patchTelegramBotUserMetadata({
      telegramUserId: input.telegramUserId,
      patch: {
        awaitingPendingFileId: value,
      },
    });
    await answerTelegramCallbackQuery({
      callbackQueryId: input.callback.id,
      text: "Choose a company.",
    });
    await sendCompanySelectionMessage({
      chatId,
      telegramUserId: input.telegramUserId,
      companyId: access.activeCompany?.companyId ?? null,
      botUserId: access.linkedUser.id,
      companyIds: access.memberships.map((membership) => membership.companyId),
      companyNames: access.memberships.map((membership) => membership.companyName),
      dedupeKey: `callback:choose_company:${value}:${input.callback.id}`,
      text: "Choose the target company for this file.",
    });
    return;
  }

  if (kind === "d" && value) {
    await discussPendingTelegramFile({
      pendingFileId: value,
      telegramUserId: input.telegramUserId,
      callbackQueryId: input.callback.id,
      chatId,
      telegramChatType: chat?.type ?? "private",
    });
    return;
  }

  if (kind === "u" && value) {
    await ingestPendingTelegramFile({
      pendingFileId: value,
      telegramUserId: input.telegramUserId,
      callbackQueryId: input.callback.id,
      chatId,
    });
    return;
  }

  if (kind === "x" && value) {
    const linkedUser = await getTelegramBotUserByTelegramId(input.telegramUserId);
    await updateTelegramBotPendingFile({
      pendingFileId: value,
      status: "cancelled",
    });
    await clearTelegramBotPendingFileContext(input.telegramUserId);
    await answerTelegramCallbackQuery({
      callbackQueryId: input.callback.id,
      text: "Upload cancelled.",
    });
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId,
      botUserId: linkedUser?.id ?? null,
      sourceKind: "file_status",
      dedupeKey: `callback:file_cancelled:${value}`,
      text: "The pending file upload was cancelled.",
    });
    return;
  }

  if ((kind === "aa" || kind === "ar") && value) {
    const linkedUser = await getTelegramBotUserByTelegramId(input.telegramUserId);
    if (!linkedUser?.userId) {
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callback.id,
        text: "Telegram account is not linked.",
        showAlert: true,
      });
      return;
    }

    const approvalContext = await findTelegramApprovalContext({
      approvalId: value,
      userId: linkedUser.userId,
    });
    if (!approvalContext) {
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callback.id,
        text: "Approval not found.",
        showAlert: true,
      });
      return;
    }

    try {
      const approval = await resolveChatApprovalDecision({
        threadId: approvalContext.threadId,
        approvalId: approvalContext.approvalId,
        companyId: approvalContext.companyId,
        userId: linkedUser.userId,
        status: kind === "aa" ? "approved" : "rejected",
      });

      if (!approval) {
        await answerTelegramCallbackQuery({
          callbackQueryId: input.callback.id,
          text: "Approval not found.",
          showAlert: true,
        });
        return;
      }

      await answerTelegramCallbackQuery({
        callbackQueryId: input.callback.id,
        text: kind === "aa" ? "Approval granted." : "Approval rejected.",
      });
      await sendBotText({
        telegramUserId: input.telegramUserId,
        chatId,
        companyId: approvalContext.companyId,
        botUserId: linkedUser.id,
        sourceKind: "approval_status",
        dedupeKey: `approval_resolution:${approval.id}:${approval.status}`,
        text:
          `Approval ${approval.status}.\n` +
          `Action: ${approval.action}\n` +
          `Approval ID: ${approval.id}`,
      });
    } catch (error) {
      await answerTelegramCallbackQuery({
        callbackQueryId: input.callback.id,
        text: "Approval failed.",
        showAlert: true,
      });
      await sendBotText({
        telegramUserId: input.telegramUserId,
        chatId,
        companyId: approvalContext.companyId,
        botUserId: linkedUser.id,
        sourceKind: "approval_error",
        dedupeKey: `approval_error:${approvalContext.approvalId}`,
        text:
          error instanceof Error
            ? `I could not resolve this approval: ${error.message}`
            : "I could not resolve this approval.",
      });
    }
    return;
  }

  await answerTelegramCallbackQuery({
    callbackQueryId: input.callback.id,
    text: "Unsupported callback payload.",
    showAlert: true,
  });
}

async function handleMessage(input: {
  message: TelegramMessage;
  telegramUserId: string;
}) {
  const text = getTelegramMessageText(input.message);
  const command = parseTelegramCommand(text);
  const linkedUser = await getTelegramBotUserByTelegramId(input.telegramUserId);

  if (command?.command === "start") {
    await handleStartCommand({
      message: input.message,
      telegramUserId: input.telegramUserId,
      args: command.args,
    });
    return;
  }

  if (!isTelegramPrivateChat(input.message.chat)) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.message.chat.id,
      botUserId: linkedUser?.id ?? null,
      sourceKind: "link_status",
      dedupeKey: `message:non_private:${input.message.message_id}`,
      text: "This Telegram bot slice currently works in direct messages only.",
    });
    return;
  }

  if (!linkedUser?.userId) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.message.chat.id,
      botUserId: linkedUser?.id ?? null,
      sourceKind: "link_status",
      dedupeKey: `message:unlinked:${input.message.message_id}`,
      text: "This Telegram account is not linked yet. Generate a Telegram bot link from Corpus first.",
    });
    return;
  }

  if (command?.command === "help") {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.message.chat.id,
      companyId: linkedUser.activeCompanyId ?? null,
      botUserId: linkedUser.id,
      sourceKind: "help",
      dedupeKey: `help:${input.message.message_id}`,
      text: buildHelpText(),
      replyMarkup: buildMainMenuKeyboard(),
    });
    return;
  }

  if (command?.command === "menu") {
    await handleMenuCommand({
      chatId: String(input.message.chat.id),
      telegramUserId: input.telegramUserId,
      dedupeSuffix: String(input.message.message_id),
    });
    return;
  }

  if (command?.command === "companies") {
    await handleCompaniesCommand({
      chatId: String(input.message.chat.id),
      telegramUserId: input.telegramUserId,
      dedupeSuffix: String(input.message.message_id),
    });
    return;
  }

  if (command?.command === "use") {
    await handleUseCommand({
      chatId: String(input.message.chat.id),
      telegramUserId: input.telegramUserId,
      args: command.args,
      dedupeSuffix: String(input.message.message_id),
    });
    return;
  }

  if (command?.command === "create_company" || command?.command === "new_company") {
    await handleCreateCompanyCommand({
      chatId: String(input.message.chat.id),
      telegramUserId: input.telegramUserId,
      argsText: command.args.join(" "),
      dedupeSuffix: String(input.message.message_id),
    });
    return;
  }

  if (command?.command === "create_project" || command?.command === "project") {
    await handleCreateProjectCommand({
      chatId: String(input.message.chat.id),
      telegramUserId: input.telegramUserId,
      telegramChatId: String(input.message.chat.id),
      argsText: command.args.join(" "),
      dedupeSuffix: String(input.message.message_id),
      telegramMessageId: input.message.message_id,
    });
    return;
  }

  if (command?.command === "new") {
    await handleNewThreadCommand({
      chatId: String(input.message.chat.id),
      telegramUserId: input.telegramUserId,
      telegramChatId: String(input.message.chat.id),
      telegramChatType: input.message.chat.type,
      args: command.args,
    });
    return;
  }

  if (command?.command === "threads") {
    await handleThreadsCommand({
      chatId: String(input.message.chat.id),
      telegramUserId: input.telegramUserId,
      telegramChatId: String(input.message.chat.id),
      dedupeSuffix: String(input.message.message_id),
    });
    return;
  }

  if (command?.command === "thread") {
    await handleThreadCommand({
      chatId: String(input.message.chat.id),
      telegramUserId: input.telegramUserId,
      telegramChatId: String(input.message.chat.id),
      args: command.args,
      dedupeSuffix: String(input.message.message_id),
    });
    return;
  }

  if (command?.command === "cancel") {
    await clearPendingCreateAction(input.telegramUserId);
    await clearTelegramBotPendingFileContext(input.telegramUserId);
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.message.chat.id,
      companyId: linkedUser.activeCompanyId ?? null,
      botUserId: linkedUser.id,
      sourceKind: "action_cancelled",
      dedupeKey: `cancel:${input.message.message_id}`,
      text: "Cancelled pending bot action.",
    });
    return;
  }

  if (command?.command === "where" || command?.command === "status") {
    await handleWhereCommand({
      chatId: String(input.message.chat.id),
      telegramUserId: input.telegramUserId,
      telegramChatId: String(input.message.chat.id),
      dedupeSuffix: String(input.message.message_id),
    });
    return;
  }

  const file = getTelegramFileAttachment(input.message);
  if (file) {
    await handleFileMessage(input);
    return;
  }

  const pendingHandled = await handlePendingCreateAction({
    chatId: String(input.message.chat.id),
    telegramUserId: input.telegramUserId,
    telegramChatId: String(input.message.chat.id),
    text,
    linkedUserMetadata: linkedUser.metadata ?? {},
    telegramMessageId: input.message.message_id,
  });
  if (pendingHandled) {
    return;
  }

  if (text.trim().length === 0) {
    await sendBotText({
      telegramUserId: input.telegramUserId,
      chatId: input.message.chat.id,
      companyId: linkedUser.activeCompanyId ?? null,
      botUserId: linkedUser.id,
      sourceKind: "message_error",
      dedupeKey: `message:empty:${input.message.message_id}`,
      text: "I could not find any text in that message.",
    });
    return;
  }

  await handleTextTurn({
    chatId: String(input.message.chat.id),
    telegramUserId: input.telegramUserId,
    telegramChatId: String(input.message.chat.id),
    telegramChatType: input.message.chat.type,
    userText: text,
    uiMessageId: `telegram-text-${input.message.message_id}`,
    messageMetadata: {
      source: "telegram_text",
      telegramMessageId: input.message.message_id,
    },
  });
}

export async function handleTelegramBotWebhook(request: NextRequest) {
  verifyTelegramWebhook(request);

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid Telegram update JSON" }, { status: 400 });
  }

  const actor = getTelegramUpdateActor(update);
  const chat = getTelegramUpdateChat(update);
  const telegramUserId = actor ? String(actor.id) : null;

  if (telegramUserId) {
    await touchTelegramBotUser({
      telegramUserId,
      telegramUsername: actor?.username ?? null,
      firstName: actor?.first_name ?? null,
      lastName: actor?.last_name ?? null,
      languageCode: actor?.language_code ?? null,
    });
  }

  const linkedUser = telegramUserId
    ? await getTelegramBotUserByTelegramId(telegramUserId)
    : null;

  const inserted = await recordTelegramBotUpdate({
    updateId: String(update.update_id),
    telegramUserId,
    telegramChatId: chat ? String(chat.id) : null,
    companyId: linkedUser?.activeCompanyId ?? null,
    userId: linkedUser?.userId ?? null,
    updateType: getTelegramUpdateType(update),
    status: telegramUserId && chat ? "queued" : "ignored",
    payload: update as unknown as Record<string, unknown>,
  });

  if (!inserted) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (!telegramUserId || !chat) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const enqueueResult = await enqueueTelegramBotUpdateProcessing({
    updateId: String(update.update_id),
    telegramUserId,
    telegramChatId: String(chat.id),
  });

  return NextResponse.json({ ok: true, queued: true, mode: enqueueResult.mode });
}
