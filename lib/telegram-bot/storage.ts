import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  chatThreads,
  companies,
  telegramBotPendingFiles,
  telegramBotThreads,
  telegramBotUpdates,
  telegramBotUsers,
} from "@/lib/db/schema";
import { listCompanyMemberships, type CompanyMembership } from "@/lib/db/tenant";
import { syncNormalizedThreadMessages } from "@/lib/consultant/store";
import { ensureConsultantThreadWorkspace } from "@/lib/consultant/workspace";

type TelegramBotUserRecord = {
  id: string;
  telegramUserId: string;
  userId: string | null;
  telegramUsername: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  activeCompanyId: string | null;
  status: string;
  linkedAt: Date | null;
  lastSeenAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

type TelegramBotThreadRecord = {
  id: string;
  telegramUserId: string;
  telegramChatId: string;
  telegramChatType: string;
  userId: string | null;
  companyId: string | null;
  chatThreadId: string | null;
  title: string;
  status: string;
  metadata: Record<string, unknown>;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TelegramBotUpdateRecord = {
  id: string;
  updateId: string;
  telegramUserId: string | null;
  telegramChatId: string | null;
  companyId: string | null;
  userId: string | null;
  updateType: string;
  status: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export async function getTelegramBotUserByTelegramId(
  telegramUserId: string,
): Promise<TelegramBotUserRecord | null> {
  const [row] = await db
    .select()
    .from(telegramBotUsers)
    .where(eq(telegramBotUsers.telegramUserId, telegramUserId))
    .limit(1);

  return row ?? null;
}

export async function getActiveTelegramBotThread(input: {
  telegramUserId: string;
  telegramChatId: string;
  companyId: string;
}): Promise<TelegramBotThreadRecord | null> {
  const [row] = await db
    .select()
    .from(telegramBotThreads)
    .where(
      and(
        eq(telegramBotThreads.telegramUserId, input.telegramUserId),
        eq(telegramBotThreads.telegramChatId, input.telegramChatId),
        eq(telegramBotThreads.companyId, input.companyId),
        eq(telegramBotThreads.status, "active"),
      ),
    )
    .orderBy(desc(telegramBotThreads.updatedAt))
    .limit(1);

  return row ?? null;
}

export async function listTelegramBotThreads(input: {
  telegramUserId: string;
  telegramChatId: string;
  companyId: string;
  limit?: number;
}): Promise<TelegramBotThreadRecord[]> {
  return db
    .select()
    .from(telegramBotThreads)
    .where(
      and(
        eq(telegramBotThreads.telegramUserId, input.telegramUserId),
        eq(telegramBotThreads.telegramChatId, input.telegramChatId),
        eq(telegramBotThreads.companyId, input.companyId),
      ),
    )
    .orderBy(desc(telegramBotThreads.updatedAt))
    .limit(input.limit ?? 10);
}

export async function createTelegramBotThread(input: {
  telegramUserId: string;
  telegramChatId: string;
  telegramChatType?: string | null;
  userId: string;
  companyId: string;
  title?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const title = input.title?.trim() || "Telegram chat";

  const created = await db.transaction(async (tx) => {
    await tx
      .update(telegramBotThreads)
      .set({
        status: "inactive",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(telegramBotThreads.telegramUserId, input.telegramUserId),
          eq(telegramBotThreads.telegramChatId, input.telegramChatId),
          eq(telegramBotThreads.companyId, input.companyId),
          eq(telegramBotThreads.status, "active"),
        ),
      );

    const [chatThread] = await tx
      .insert(chatThreads)
      .values({
        companyId: input.companyId,
        userId: input.userId,
        title,
        messages: [],
      })
      .returning({
        id: chatThreads.id,
        title: chatThreads.title,
        createdAt: chatThreads.createdAt,
        updatedAt: chatThreads.updatedAt,
      });

    await syncNormalizedThreadMessages(tx, {
      threadId: chatThread.id,
      companyId: input.companyId,
      userId: input.userId,
      messages: [],
    });

    const [botThread] = await tx
      .insert(telegramBotThreads)
      .values({
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
        telegramChatType: input.telegramChatType?.trim() || "private",
        userId: input.userId,
        companyId: input.companyId,
        chatThreadId: chatThread.id,
        title: chatThread.title,
        status: "active",
        metadata: input.metadata ?? {},
        lastInboundAt: new Date(),
      })
      .returning();

    return { botThread, chatThread };
  });

  await ensureConsultantThreadWorkspace({
    companyId: input.companyId,
    threadId: created.chatThread.id,
    userId: input.userId,
    title: created.chatThread.title,
    createdAt: created.chatThread.createdAt,
    updatedAt: created.chatThread.updatedAt,
  }).catch((error) => {
    console.error("Failed to initialize Telegram consultant workspace:", error);
  });

  return created;
}

export async function activateTelegramBotThread(input: {
  telegramUserId: string;
  telegramChatId: string;
  companyId: string;
  botThreadId: string;
}) {
  const [target] = await db
    .select()
    .from(telegramBotThreads)
    .where(
      and(
        eq(telegramBotThreads.id, input.botThreadId),
        eq(telegramBotThreads.telegramUserId, input.telegramUserId),
        eq(telegramBotThreads.telegramChatId, input.telegramChatId),
        eq(telegramBotThreads.companyId, input.companyId),
      ),
    )
    .limit(1);

  if (!target) {
    throw new Error("Requested Telegram thread is not accessible");
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(telegramBotThreads)
      .set({
        status: "inactive",
        updatedAt: now,
      })
      .where(
        and(
          eq(telegramBotThreads.telegramUserId, input.telegramUserId),
          eq(telegramBotThreads.telegramChatId, input.telegramChatId),
          eq(telegramBotThreads.companyId, input.companyId),
          eq(telegramBotThreads.status, "active"),
        ),
      );

    await tx
      .update(telegramBotThreads)
      .set({
        status: "active",
        lastInboundAt: now,
        updatedAt: now,
      })
      .where(eq(telegramBotThreads.id, target.id));
  });

  return {
    ...target,
    status: "active",
    lastInboundAt: now,
    updatedAt: now,
  };
}

export async function touchTelegramBotThread(input: {
  botThreadId: string;
  direction: "inbound" | "outbound";
}) {
  const patch =
    input.direction === "inbound"
      ? { lastInboundAt: new Date(), updatedAt: new Date() }
      : { lastOutboundAt: new Date(), updatedAt: new Date() };

  const [updated] = await db
    .update(telegramBotThreads)
    .set(patch)
    .where(eq(telegramBotThreads.id, input.botThreadId))
    .returning();

  return updated ?? null;
}

export async function touchTelegramBotUser(input: {
  telegramUserId: string;
  telegramUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
}) {
  const now = new Date();
  const existing = await getTelegramBotUserByTelegramId(input.telegramUserId);

  if (!existing) {
    const [created] = await db
      .insert(telegramBotUsers)
      .values({
        telegramUserId: input.telegramUserId,
        telegramUsername: input.telegramUsername ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        languageCode: input.languageCode ?? null,
        status: "pending",
        lastSeenAt: now,
        metadata: {},
      })
      .returning();

    return created;
  }

  const [updated] = await db
    .update(telegramBotUsers)
    .set({
      telegramUsername: input.telegramUsername ?? existing.telegramUsername,
      firstName: input.firstName ?? existing.firstName,
      lastName: input.lastName ?? existing.lastName,
      languageCode: input.languageCode ?? existing.languageCode,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(telegramBotUsers.id, existing.id))
    .returning();

  return updated ?? existing;
}

export async function linkTelegramBotUser(input: {
  telegramUserId: string;
  userId: string;
  telegramUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
  preferredCompanyId?: string | null;
}) {
  const touched = await touchTelegramBotUser({
    telegramUserId: input.telegramUserId,
    telegramUsername: input.telegramUsername,
    firstName: input.firstName,
    lastName: input.lastName,
    languageCode: input.languageCode,
  });

  const memberships = await listCompanyMemberships(input.userId);
  const activeCompanyId =
    (input.preferredCompanyId &&
      memberships.find((membership) => membership.companyId === input.preferredCompanyId)
        ?.companyId) ??
    memberships[0]?.companyId ??
    null;

  const now = new Date();
  const [updated] = await db
    .update(telegramBotUsers)
    .set({
      userId: input.userId,
      telegramUsername: input.telegramUsername ?? touched.telegramUsername,
      firstName: input.firstName ?? touched.firstName,
      lastName: input.lastName ?? touched.lastName,
      languageCode: input.languageCode ?? touched.languageCode,
      activeCompanyId,
      status: "active",
      linkedAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(telegramBotUsers.id, touched.id))
    .returning();

  return {
    linkedUser: updated ?? touched,
    memberships,
    activeCompanyId,
  };
}

export async function resolveTelegramBotAccess(
  telegramUserId: string,
  preferredCompanyId?: string | null,
): Promise<{
  linkedUser: TelegramBotUserRecord;
  memberships: CompanyMembership[];
  activeCompany: CompanyMembership | null;
}> {
  const linkedUser = await getTelegramBotUserByTelegramId(telegramUserId);
  if (!linkedUser?.userId) {
    throw new Error("Telegram bot user is not linked");
  }

  const memberships = await listCompanyMemberships(linkedUser.userId);
  const activeCompany =
    memberships.find((membership) => membership.companyId === linkedUser.activeCompanyId) ??
    (preferredCompanyId
      ? memberships.find((membership) => membership.companyId === preferredCompanyId) ?? null
      : null) ??
    memberships[0] ??
    null;

  if (activeCompany && activeCompany.companyId !== linkedUser.activeCompanyId) {
    await db
      .update(telegramBotUsers)
      .set({
        activeCompanyId: activeCompany.companyId,
        updatedAt: new Date(),
      })
      .where(eq(telegramBotUsers.id, linkedUser.id));
  }

  return {
    linkedUser: {
      ...linkedUser,
      activeCompanyId: activeCompany?.companyId ?? null,
    },
    memberships,
    activeCompany,
  };
}

export async function setTelegramBotActiveCompany(input: {
  telegramUserId: string;
  companyId: string;
}) {
  const access = await resolveTelegramBotAccess(input.telegramUserId);
  const company = access.memberships.find(
    (membership) => membership.companyId === input.companyId,
  );
  if (!company) {
    throw new Error("Requested company is not accessible");
  }

  const [updated] = await db
    .update(telegramBotUsers)
    .set({
      activeCompanyId: company.companyId,
      updatedAt: new Date(),
    })
    .where(eq(telegramBotUsers.id, access.linkedUser.id))
    .returning();

  return {
    linkedUser: updated ?? access.linkedUser,
    company,
  };
}

export async function patchTelegramBotUserMetadata(input: {
  telegramUserId: string;
  patch: Record<string, unknown>;
}) {
  const existing = await getTelegramBotUserByTelegramId(input.telegramUserId);
  if (!existing) return null;

  const [updated] = await db
    .update(telegramBotUsers)
    .set({
      metadata: {
        ...(existing.metadata ?? {}),
        ...input.patch,
      },
      updatedAt: new Date(),
    })
    .where(eq(telegramBotUsers.id, existing.id))
    .returning();

  return updated ?? existing;
}

export async function recordTelegramBotUpdate(input: {
  updateId: string;
  telegramUserId?: string | null;
  telegramChatId?: string | null;
  companyId?: string | null;
  userId?: string | null;
  updateType: string;
  status?: string;
  payload: Record<string, unknown>;
}) {
  const rows = await db
    .insert(telegramBotUpdates)
    .values({
      updateId: input.updateId,
      telegramUserId: input.telegramUserId ?? null,
      telegramChatId: input.telegramChatId ?? null,
      companyId: input.companyId ?? null,
      userId: input.userId ?? null,
      updateType: input.updateType,
      status: input.status ?? "received",
      payload: input.payload,
    })
    .onConflictDoNothing({
      target: [telegramBotUpdates.updateId],
    })
    .returning({
      id: telegramBotUpdates.id,
    });

  return rows.length > 0;
}

export async function getTelegramBotUpdateByUpdateId(
  updateId: string,
): Promise<TelegramBotUpdateRecord | null> {
  const [row] = await db
    .select()
    .from(telegramBotUpdates)
    .where(eq(telegramBotUpdates.updateId, updateId))
    .limit(1);

  return row ?? null;
}

export async function claimTelegramBotUpdate(input: {
  updateId: string;
  fromStatuses?: string[];
}): Promise<TelegramBotUpdateRecord | null> {
  const [row] = await db
    .update(telegramBotUpdates)
    .set({
      status: "processing",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(telegramBotUpdates.updateId, input.updateId),
        inArray(telegramBotUpdates.status, input.fromStatuses ?? ["queued", "failed"]),
      ),
    )
    .returning();

  return row ?? null;
}

export async function markTelegramBotUpdateStatus(input: {
  updateId: string;
  status: string;
}): Promise<void> {
  await db
    .update(telegramBotUpdates)
    .set({
      status: input.status,
      updatedAt: new Date(),
    })
    .where(eq(telegramBotUpdates.updateId, input.updateId));
}

export async function listQueuedTelegramBotUpdates(input: {
  limit?: number;
} = {}): Promise<TelegramBotUpdateRecord[]> {
  return db
    .select()
    .from(telegramBotUpdates)
    .where(eq(telegramBotUpdates.status, "queued"))
    .orderBy(asc(telegramBotUpdates.createdAt))
    .limit(input.limit ?? 25);
}

export async function requeueStaleProcessingTelegramBotUpdates(input: {
  olderThanMinutes?: number;
} = {}): Promise<number> {
  const cutoff = new Date(
    Date.now() - (input.olderThanMinutes ?? 30) * 60 * 1000,
  );
  const rows = await db
    .update(telegramBotUpdates)
    .set({
      status: "queued",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(telegramBotUpdates.status, "processing"),
        lt(telegramBotUpdates.updatedAt, cutoff),
      ),
    )
    .returning({ id: telegramBotUpdates.id });

  return rows.length;
}

export async function createTelegramBotPendingFile(input: {
  telegramUserId: string;
  telegramChatId: string;
  telegramMessageId: string;
  userId: string;
  selectedCompanyId?: string | null;
  telegramFileId: string;
  telegramFileUniqueId?: string | null;
  fileKind: string;
  fileName: string;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  metadata?: Record<string, unknown>;
}) {
  const status = input.selectedCompanyId ? "pending_confirmation" : "pending_company";

  const [created] = await db
    .insert(telegramBotPendingFiles)
    .values({
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      telegramMessageId: input.telegramMessageId,
      userId: input.userId,
      selectedCompanyId: input.selectedCompanyId ?? null,
      telegramFileId: input.telegramFileId,
      telegramFileUniqueId: input.telegramFileUniqueId ?? null,
      fileKind: input.fileKind,
      fileName: input.fileName,
      mimeType: input.mimeType ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
      status,
      metadata: input.metadata ?? {},
    })
    .returning();

  return created;
}

export async function getTelegramBotPendingFile(pendingFileId: string) {
  const [row] = await db
    .select({
      id: telegramBotPendingFiles.id,
      telegramUserId: telegramBotPendingFiles.telegramUserId,
      telegramChatId: telegramBotPendingFiles.telegramChatId,
      telegramMessageId: telegramBotPendingFiles.telegramMessageId,
      userId: telegramBotPendingFiles.userId,
      selectedCompanyId: telegramBotPendingFiles.selectedCompanyId,
      documentId: telegramBotPendingFiles.documentId,
      telegramFileId: telegramBotPendingFiles.telegramFileId,
      telegramFileUniqueId: telegramBotPendingFiles.telegramFileUniqueId,
      telegramFilePath: telegramBotPendingFiles.telegramFilePath,
      fileKind: telegramBotPendingFiles.fileKind,
      fileName: telegramBotPendingFiles.fileName,
      mimeType: telegramBotPendingFiles.mimeType,
      fileSizeBytes: telegramBotPendingFiles.fileSizeBytes,
      status: telegramBotPendingFiles.status,
      metadata: telegramBotPendingFiles.metadata,
      companyName: companies.name,
    })
    .from(telegramBotPendingFiles)
    .leftJoin(companies, eq(telegramBotPendingFiles.selectedCompanyId, companies.id))
    .where(eq(telegramBotPendingFiles.id, pendingFileId))
    .limit(1);

  return row ?? null;
}

export async function updateTelegramBotPendingFile(input: {
  pendingFileId: string;
  selectedCompanyId?: string | null;
  documentId?: string | null;
  telegramFilePath?: string | null;
  status?: string;
  metadataPatch?: Record<string, unknown>;
}) {
  const existing = await getTelegramBotPendingFile(input.pendingFileId);
  if (!existing) return null;

  const [updated] = await db
    .update(telegramBotPendingFiles)
    .set({
      selectedCompanyId:
        input.selectedCompanyId !== undefined
          ? input.selectedCompanyId
          : existing.selectedCompanyId,
      documentId:
        input.documentId !== undefined ? input.documentId : existing.documentId,
      telegramFilePath:
        input.telegramFilePath !== undefined
          ? input.telegramFilePath
          : existing.telegramFilePath,
      status: input.status ?? existing.status,
      metadata: {
        ...(existing.metadata ?? {}),
        ...(input.metadataPatch ?? {}),
      },
      updatedAt: new Date(),
    })
    .where(eq(telegramBotPendingFiles.id, input.pendingFileId))
    .returning();

  return updated ?? existing;
}

export async function clearTelegramBotPendingFileContext(
  telegramUserId: string,
) {
  const existing = await getTelegramBotUserByTelegramId(telegramUserId);
  if (!existing) return null;

  const metadata = { ...(existing.metadata ?? {}) };
  delete metadata.awaitingPendingFileId;

  const [updated] = await db
    .update(telegramBotUsers)
    .set({
      metadata,
      updatedAt: new Date(),
    })
    .where(eq(telegramBotUsers.id, existing.id))
    .returning();

  return updated ?? existing;
}

export async function getTelegramBotCompanyName(companyId: string): Promise<string | null> {
  const [row] = await db
    .select({
      name: companies.name,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  return row?.name ?? null;
}
