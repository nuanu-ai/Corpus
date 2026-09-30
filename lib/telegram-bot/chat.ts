import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import {
  readUIMessageStream,
  type UIDataTypes,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { and, eq } from "drizzle-orm";

import { executeCompanyChatTurn, type ChatTurnFinishMetadata } from "@/app/api/chat/route";
import {
  extractMessageText,
  normalizeStoredMessages,
  type ConsultantUIMessage,
} from "@/lib/consultant/messages";
import {
  loadThreadApprovals,
  loadThreadArtifacts,
  loadNormalizedThreadMessages,
  syncNormalizedThreadMessages,
  type ChatThreadApprovalSummary,
  type ChatThreadArtifactSummary,
} from "@/lib/consultant/store";
import { readConsultantArtifactData } from "@/lib/consultant/workspace";
import { db } from "@/lib/db";
import { chatAttachments, chatThreads } from "@/lib/db/schema";
import {
  createTelegramBotThread,
  getActiveTelegramBotThread,
  touchTelegramBotThread,
} from "@/lib/telegram-bot/storage";

function buildTelegramThreadTitle(input: {
  companyName: string;
  userText: string;
}) {
  const compact = input.userText.trim().replace(/\s+/g, " ");
  const base = compact.length > 0 ? compact : `Telegram chat · ${input.companyName}`;
  return base.length > 80 ? `${base.slice(0, 79)}…` : base;
}

function buildTelegramUserMessage(input: {
  text: string;
  uiMessageId?: string | null;
  metadata?: Record<string, unknown>;
  additionalParts?: UIMessage["parts"];
}): ConsultantUIMessage {
  const text = input.text.trim();
  const parts: UIMessage["parts"] = [];
  if (text.length > 0) {
    parts.push({
      type: "text",
      text,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  }
  if (Array.isArray(input.additionalParts)) {
    parts.push(...input.additionalParts);
  }

  return {
    id: input.uiMessageId?.trim() || randomUUID(),
    role: "user",
    parts,
  };
}

function buildStoredTelegramUserMessage(input: {
  text: string;
  uiMessageId?: string | null;
  metadata?: Record<string, unknown>;
  additionalParts?: UIMessage["parts"];
}): ConsultantUIMessage {
  const storageParts = (input.additionalParts ?? []).map((part) => {
    if (!part || typeof part !== "object") return part;
    const candidate = part as Record<string, unknown>;
    const type = typeof candidate.type === "string" ? candidate.type : null;
    if (type !== "file" && type !== "image") return part;

    const fileName =
      (typeof candidate.filename === "string" && candidate.filename.trim()) ||
      (typeof candidate.name === "string" && candidate.name.trim()) ||
      "attachment";
    const mediaType =
      typeof candidate.mediaType === "string" && candidate.mediaType.trim()
        ? candidate.mediaType.trim()
        : "application/octet-stream";

    return {
      type: "text" as const,
      text: `[Attached Telegram file: ${fileName} (${mediaType}); binary content omitted from stored chat history.]`,
    };
  });

  return buildTelegramUserMessage({
    text: input.text,
    uiMessageId: input.uiMessageId,
    metadata: input.metadata,
    additionalParts: storageParts as UIMessage["parts"],
  });
}

async function ensureTelegramChatThread(input: {
  telegramUserId: string;
  telegramChatId: string;
  telegramChatType: string;
  companyId: string;
  companyName: string;
  userId: string;
  initialUserText: string;
}) {
  const existing = await getActiveTelegramBotThread({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    companyId: input.companyId,
  });
  if (existing?.chatThreadId) {
    return existing;
  }

  const created = await createTelegramBotThread({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    telegramChatType: input.telegramChatType,
    userId: input.userId,
    companyId: input.companyId,
    title: buildTelegramThreadTitle({
      companyName: input.companyName,
      userText: input.initialUserText,
    }),
  });

  return created.botThread;
}

async function loadChatThreadState(input: {
  chatThreadId: string;
  companyId: string;
  userId: string;
}) {
  const [thread] = await db
    .select({
      id: chatThreads.id,
      title: chatThreads.title,
      messages: chatThreads.messages,
      createdAt: chatThreads.createdAt,
      updatedAt: chatThreads.updatedAt,
    })
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.id, input.chatThreadId),
        eq(chatThreads.companyId, input.companyId),
        eq(chatThreads.userId, input.userId),
      ),
    )
    .limit(1);

  if (!thread) {
    throw new Error("Telegram bot thread is missing its consultant thread");
  }

  const messageMap = await loadNormalizedThreadMessages([thread.id]);
  const storedMessages = normalizeStoredMessages(thread.messages);
  const normalizedMessages = messageMap.get(thread.id);
  const messages =
    normalizedMessages && normalizedMessages.length >= storedMessages.length
      ? normalizedMessages
      : storedMessages;

  return {
    thread,
    messages,
  };
}

function ensureAssistantMessageIdentity(message: UIMessage): ConsultantUIMessage {
  const candidate = message as UIMessage & { id?: string | null };
  return {
    ...candidate,
    id:
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : `assistant-${randomUUID()}`,
    role: "assistant",
    parts: Array.isArray(candidate.parts) ? candidate.parts : [],
  } as ConsultantUIMessage;
}

export async function runTelegramBotCompanyChatTurn(input: {
  telegramUserId: string;
  telegramChatId: string;
  telegramChatType: string;
  companyId: string;
  companyName: string;
  userId: string;
  userRole: string;
  userText: string;
  uiMessageId?: string | null;
  messageMetadata?: Record<string, unknown>;
  additionalParts?: UIMessage["parts"];
}) {
  const botThread = await ensureTelegramChatThread({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    telegramChatType: input.telegramChatType,
    companyId: input.companyId,
    companyName: input.companyName,
    userId: input.userId,
    initialUserText: input.userText,
  });

  if (!botThread.chatThreadId) {
    throw new Error("Telegram bot thread has no linked consultant thread");
  }

  const { thread, messages: existingMessages } = await loadChatThreadState({
    chatThreadId: botThread.chatThreadId,
    companyId: input.companyId,
    userId: input.userId,
  });

  const priorArtifacts = (await loadThreadArtifacts([thread.id])).get(thread.id) ?? [];
  const priorApprovals = (await loadThreadApprovals([thread.id])).get(thread.id) ?? [];

  const userMessage = buildTelegramUserMessage({
    text: input.userText,
    uiMessageId: input.uiMessageId,
    metadata: input.messageMetadata,
    additionalParts: input.additionalParts,
  });
  const storedUserMessage = buildStoredTelegramUserMessage({
    text: input.userText,
    uiMessageId: input.uiMessageId,
    metadata: input.messageMetadata,
    additionalParts: input.additionalParts,
  });
  const nextMessages = existingMessages.concat(userMessage);
  const nextStoredMessages = existingMessages.concat(storedUserMessage);

  await touchTelegramBotThread({
    botThreadId: botThread.id,
    direction: "inbound",
  }).catch(() => null);

  const finishMetadataRef: { current: ChatTurnFinishMetadata | null } = {
    current: null,
  };
  const result = await executeCompanyChatTurn({
    messages: nextMessages as UIMessage[],
    threadId: thread.id,
    authContext: {
      companyId: input.companyId,
      userId: input.userId,
      role: input.userRole,
    },
    onFinishMetadata: (metadata) => {
      finishMetadataRef.current = metadata;
    },
  });

  if (result instanceof Response) {
    const payload = (await result.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error?.trim() || `Corpus chat failed with status ${result.status}`);
  }

  let finalAssistantMessage: UIMessage | null = null;
  const messageStream = readUIMessageStream({
    stream: result.toUIMessageStream() as unknown as ReadableStream<
      UIMessageChunk<unknown, UIDataTypes>
    >,
  });
  for await (const message of messageStream) {
    finalAssistantMessage = structuredClone(message);
  }

  if (!finalAssistantMessage) {
    throw new Error("Corpus chat returned no assistant message");
  }
  const assistantMessage = ensureAssistantMessageIdentity(finalAssistantMessage);

  const persistedMessages = nextStoredMessages.concat(
    assistantMessage,
  );
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(chatThreads)
      .set({
        messages: persistedMessages as Array<Record<string, unknown>>,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatThreads.id, thread.id),
          eq(chatThreads.companyId, input.companyId),
          eq(chatThreads.userId, input.userId),
        ),
      );

    await syncNormalizedThreadMessages(tx, {
      threadId: thread.id,
      companyId: input.companyId,
      userId: input.userId,
      messages: persistedMessages,
    });
  });

  await touchTelegramBotThread({
    botThreadId: botThread.id,
    direction: "outbound",
  }).catch(() => null);

  const currentArtifacts = (await loadThreadArtifacts([thread.id])).get(thread.id) ?? [];
  const currentApprovals = (await loadThreadApprovals([thread.id])).get(thread.id) ?? [];
  const priorArtifactIds = new Set(priorArtifacts.map((artifact) => artifact.id));
  const priorApprovalIds = new Set(priorApprovals.map((approval) => approval.id));
  const finishMetadata = finishMetadataRef.current;

  return {
    botThread,
    chatThreadId: thread.id,
    assistantMessage,
    assistantText: extractMessageText(assistantMessage.parts),
    finishReason: finishMetadata?.finishReason ?? null,
    stepCount: finishMetadata?.stepCount ?? null,
    chatRunId: finishMetadata?.chatRunId ?? null,
    newArtifacts: currentArtifacts.filter((artifact) => !priorArtifactIds.has(artifact.id)),
    newApprovals: currentApprovals.filter((approval) => !priorApprovalIds.has(approval.id)),
  };
}

export async function attachDocumentToTelegramBotThread(input: {
  telegramUserId: string;
  telegramChatId: string;
  companyId: string;
  documentId: string;
  fileName: string;
  fileType: string | null;
  storageUrl?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const activeThread = await getActiveTelegramBotThread({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    companyId: input.companyId,
  });

  if (!activeThread?.chatThreadId) {
    return null;
  }

  const [attachment] = await db
    .insert(chatAttachments)
    .values({
      threadId: activeThread.chatThreadId,
      companyId: input.companyId,
      documentId: input.documentId,
      kind: "document",
      fileName: input.fileName,
      fileType: input.fileType,
      storageUrl: input.storageUrl ?? null,
      status: "processing",
      metadata: input.metadata ?? {},
    })
    .returning({
      id: chatAttachments.id,
    });

  return attachment ?? null;
}

export async function loadTelegramArtifactFile(input: {
  companyId: string;
  threadId: string;
  artifact: ChatThreadArtifactSummary;
}) {
  const artifactFile = await readConsultantArtifactData({
    companyId: input.companyId,
    threadId: input.threadId,
    relativePath: input.artifact.filePath,
  });

  return {
    fileName: basename(input.artifact.filePath),
    content: artifactFile.content,
    mimeType: input.artifact.mimeType ?? "application/octet-stream",
  };
}

export type TelegramGeneratedArtifact = ChatThreadArtifactSummary;
export type TelegramPendingApproval = ChatThreadApprovalSummary;
