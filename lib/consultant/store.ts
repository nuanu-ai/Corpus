import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  chatApprovals,
  chatArtifacts,
  chatAttachments,
  chatMessages,
  documents,
} from "@/lib/db/schema";

import {
  extractMessageText,
  normalizeStoredMessages,
  type ConsultantUIMessage,
} from "./messages";

type DbLike = Pick<typeof db, "delete" | "insert" | "select">;

export interface ChatThreadRow {
  id: string;
  executor?: string | null;
  authProfileId?: string | null;
  workspaceRoot?: string | null;
  runtimeMetadata?: Record<string, unknown> | null;
  title: string;
  messages: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatThreadAttachmentSummary {
  id: string;
  documentId: string | null;
  fileName: string;
  fileType: string | null;
  status: string;
  documentStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatThreadArtifactSummary {
  id: string;
  kind: string;
  title: string;
  filePath: string;
  mimeType: string | null;
  status: string;
  uiMessageId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChatThreadApprovalSummary {
  id: string;
  artifactId: string | null;
  action: string;
  status: string;
  payload: Record<string, unknown>;
  requestedBy: string | null;
  approvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function buildChatThreadResponse(
  row: ChatThreadRow,
  messages?: ConsultantUIMessage[],
  attachments: ChatThreadAttachmentSummary[] = [],
  artifacts: ChatThreadArtifactSummary[] = [],
  approvals: ChatThreadApprovalSummary[] = [],
) {
  const storedMessages = normalizeStoredMessages(row.messages);
  const resolvedMessages =
    messages && messages.length >= storedMessages.length
      ? messages
      : storedMessages;

  return {
    id: row.id,
    executor: row.executor ?? null,
    authProfileId: row.authProfileId ?? null,
    workspaceRoot: row.workspaceRoot ?? null,
    runtimeMetadata: row.runtimeMetadata ?? {},
    title: row.title,
    messages: resolvedMessages,
    attachments,
    artifacts,
    approvals,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadNormalizedThreadMessages(
  threadIds: string[],
  executor: DbLike = db,
): Promise<Map<string, ConsultantUIMessage[]>> {
  const nextThreadIds = threadIds.filter((value) => value.trim().length > 0);
  if (nextThreadIds.length === 0) {
    return new Map<string, ConsultantUIMessage[]>();
  }

  const rows = await executor
    .select({
      threadId: chatMessages.threadId,
      uiMessageId: chatMessages.uiMessageId,
      role: chatMessages.role,
      parts: chatMessages.parts,
    })
    .from(chatMessages)
    .where(inArray(chatMessages.threadId, nextThreadIds))
    .orderBy(asc(chatMessages.threadId), asc(chatMessages.messageIndex));

  const grouped = new Map<string, ConsultantUIMessage[]>();
  for (const row of rows) {
    const current = grouped.get(row.threadId) ?? [];
    grouped.set(
      row.threadId,
      current.concat(
        normalizeStoredMessages([
          {
            id: row.uiMessageId,
            role: row.role,
            parts: Array.isArray(row.parts) ? row.parts : [],
          },
        ]),
      ),
    );
  }

  return grouped;
}

export async function loadThreadAttachments(
  threadIds: string[],
  executor: DbLike = db,
): Promise<Map<string, ChatThreadAttachmentSummary[]>> {
  const nextThreadIds = threadIds.filter((value) => value.trim().length > 0);
  if (nextThreadIds.length === 0) {
    return new Map<string, ChatThreadAttachmentSummary[]>();
  }

  const rows = await executor
    .select({
      threadId: chatAttachments.threadId,
      id: chatAttachments.id,
      documentId: chatAttachments.documentId,
      fileName: chatAttachments.fileName,
      fileType: chatAttachments.fileType,
      // legacyStatus exists only to back-fill rows whose documentId is NULL
      // (no document attached). Once those are migrated/cleaned up, this
      // column read can drop entirely. See docs/architecture/document-pipeline-stability.md (Tier A4).
      legacyStatus: chatAttachments.status,
      documentStatus: documents.status,
      createdAt: chatAttachments.createdAt,
      updatedAt: chatAttachments.updatedAt,
    })
    .from(chatAttachments)
    .leftJoin(documents, eq(chatAttachments.documentId, documents.id))
    .where(inArray(chatAttachments.threadId, nextThreadIds))
    .orderBy(desc(chatAttachments.createdAt));

  const grouped = new Map<string, ChatThreadAttachmentSummary[]>();
  for (const row of rows) {
    const current = grouped.get(row.threadId) ?? [];
    // Single source of truth: prefer the joined documents.status. Only fall
    // back to chat_attachments.status when the row predates the join (no
    // documentId) — we never write that column anymore for new rows.
    const derivedStatus = row.documentStatus ?? row.legacyStatus;
    current.push({
      id: row.id,
      documentId: row.documentId,
      fileName: row.fileName,
      fileType: row.fileType,
      status: derivedStatus,
      documentStatus: row.documentStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
    grouped.set(row.threadId, current);
  }

  return grouped;
}

export async function loadThreadArtifacts(
  threadIds: string[],
  executor: DbLike = db,
): Promise<Map<string, ChatThreadArtifactSummary[]>> {
  const nextThreadIds = threadIds.filter((value) => value.trim().length > 0);
  if (nextThreadIds.length === 0) {
    return new Map<string, ChatThreadArtifactSummary[]>();
  }

  const rows = await executor
    .select({
      threadId: chatArtifacts.threadId,
      id: chatArtifacts.id,
      kind: chatArtifacts.kind,
      title: chatArtifacts.title,
      filePath: chatArtifacts.filePath,
      mimeType: chatArtifacts.mimeType,
      status: chatArtifacts.status,
      uiMessageId: chatArtifacts.uiMessageId,
      metadata: chatArtifacts.metadata,
      createdAt: chatArtifacts.createdAt,
      updatedAt: chatArtifacts.updatedAt,
    })
    .from(chatArtifacts)
    .where(inArray(chatArtifacts.threadId, nextThreadIds))
    .orderBy(desc(chatArtifacts.createdAt));

  const grouped = new Map<string, ChatThreadArtifactSummary[]>();
  for (const row of rows) {
    const current = grouped.get(row.threadId) ?? [];
    current.push({
      id: row.id,
      kind: row.kind,
      title: row.title,
      filePath: row.filePath,
      mimeType: row.mimeType,
      status: row.status,
      uiMessageId: row.uiMessageId,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
    grouped.set(row.threadId, current);
  }

  return grouped;
}

export async function loadThreadApprovals(
  threadIds: string[],
  executor: DbLike = db,
): Promise<Map<string, ChatThreadApprovalSummary[]>> {
  const nextThreadIds = threadIds.filter((value) => value.trim().length > 0);
  if (nextThreadIds.length === 0) {
    return new Map<string, ChatThreadApprovalSummary[]>();
  }

  const rows = await executor
    .select({
      threadId: chatApprovals.threadId,
      id: chatApprovals.id,
      artifactId: chatApprovals.artifactId,
      action: chatApprovals.action,
      status: chatApprovals.status,
      payload: chatApprovals.payload,
      requestedBy: chatApprovals.requestedBy,
      approvedBy: chatApprovals.approvedBy,
      resolvedAt: chatApprovals.resolvedAt,
      createdAt: chatApprovals.createdAt,
      updatedAt: chatApprovals.updatedAt,
    })
    .from(chatApprovals)
    .where(inArray(chatApprovals.threadId, nextThreadIds))
    .orderBy(desc(chatApprovals.createdAt));

  const grouped = new Map<string, ChatThreadApprovalSummary[]>();
  for (const row of rows) {
    const current = grouped.get(row.threadId) ?? [];
    current.push({
      id: row.id,
      artifactId: row.artifactId,
      action: row.action,
      status: row.status,
      payload: row.payload,
      requestedBy: row.requestedBy,
      approvedBy: row.approvedBy,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
    grouped.set(row.threadId, current);
  }

  return grouped;
}

export async function syncNormalizedThreadMessages(
  executor: DbLike,
  input: {
    threadId: string;
    companyId: string;
    userId: string;
    messages: unknown;
  },
): Promise<ConsultantUIMessage[]> {
  const messages = normalizeStoredMessages(input.messages);

  await executor.delete(chatMessages).where(eq(chatMessages.threadId, input.threadId));

  if (messages.length === 0) {
    return messages;
  }

  const now = new Date();
  await executor.insert(chatMessages).values(
    messages.map((message, index) => ({
      threadId: input.threadId,
      companyId: input.companyId,
      userId: input.userId,
      uiMessageId: message.id,
      role: message.role,
      messageIndex: index,
      textContent: extractMessageText(message.parts),
      parts: message.parts as Array<Record<string, unknown>>,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    })),
  );

  return messages;
}
