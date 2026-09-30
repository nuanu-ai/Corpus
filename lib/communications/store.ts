import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { communicationMessages, pendingSignals } from "@/lib/db/schema";
import type { CommunicationBatch, CommunicationMessageRow } from "@/lib/communications/types";

export interface InsertCommunicationMessageInput {
  companyId: string;
  provider: string;
  providerMessageId: string;
  providerChatId: string;
  providerThreadId: string;
  processingStatus?: string | null;
  subject?: string | null;
  senderName?: string | null;
  senderAddress?: string | null;
  senderId?: string | null;
  participantAddresses?: string[];
  attachmentRefs?: Array<Record<string, unknown>>;
  content?: string | null;
  rawPayload: Record<string, unknown>;
  receivedAt: Date;
}

export interface PendingSignalInsert {
  companyId: string;
  dedupKey: string;
  signalType: string;
  targetDomain: string;
  title: string;
  summary: string;
  sourceProvider?: string | null;
  sourceThreadId?: string | null;
  sourceLabel?: string | null;
  communicationMessageIds?: string[];
  structuredData?: Record<string, unknown>;
  proposedFilePath: string;
  proposedFrontmatter: Record<string, unknown>;
  proposedBody: string;
  confidenceScore?: string | null;
}

export interface PendingSignalRow {
  id: string;
  signalType: string;
  targetDomain: string;
  title: string;
  summary: string;
  sourceProvider: string | null;
  sourceThreadId: string | null;
  sourceLabel: string | null;
  communicationMessageIds: string[] | null;
  structuredData: Record<string, unknown>;
  proposedFilePath: string;
  proposedFrontmatter: Record<string, unknown>;
  proposedBody: string;
  status: string;
  confidenceScore: string | null;
  commitSha: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function findCommunicationMessageByProviderKey(input: {
  companyId: string;
  provider: string;
  providerChatId: string;
  providerMessageId: string;
}): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: communicationMessages.id })
    .from(communicationMessages)
    .where(
      and(
        eq(communicationMessages.companyId, input.companyId),
        eq(communicationMessages.provider, input.provider),
        eq(communicationMessages.providerChatId, input.providerChatId),
        eq(communicationMessages.providerMessageId, input.providerMessageId),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function insertCommunicationMessage(
  input: InsertCommunicationMessageInput,
): Promise<void> {
  await db
    .insert(communicationMessages)
    .values({
      companyId: input.companyId,
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      providerChatId: input.providerChatId,
      providerThreadId: input.providerThreadId,
      processingStatus: input.processingStatus ?? "pending",
      subject: input.subject ?? null,
      senderName: input.senderName ?? null,
      senderAddress: input.senderAddress ?? null,
      senderId: input.senderId ?? null,
      participantAddresses: input.participantAddresses ?? [],
      attachmentRefs: input.attachmentRefs ?? [],
      content: input.content ?? null,
      rawPayload: input.rawPayload,
      receivedAt: input.receivedAt,
    })
    .onConflictDoNothing({
      target: [
        communicationMessages.companyId,
        communicationMessages.provider,
        communicationMessages.providerChatId,
        communicationMessages.providerMessageId,
      ],
    });
}

export async function listPendingCommunicationBatches(limit = 50): Promise<CommunicationBatch[]> {
  const rows = await db.execute<{
    company_id: string;
    company_slug: string;
    company_db_port: number;
    provider: string;
    provider_chat_id: string;
    provider_thread_id: string;
    day_key: string;
  }>(sql`
    SELECT
      cm.company_id,
      c.slug AS company_slug,
      c.company_db_port,
      cm.provider,
      cm.provider_chat_id,
      cm.provider_thread_id,
      to_char(timezone('UTC', cm.received_at), 'YYYY-MM-DD') AS day_key
    FROM communication_messages cm
    JOIN companies c ON c.id = cm.company_id
    WHERE cm.processing_status = 'pending'
      AND c.tenant_kind = 'company'
    GROUP BY
      cm.company_id,
      c.slug,
      c.company_db_port,
      cm.provider,
      cm.provider_chat_id,
      cm.provider_thread_id,
      to_char(timezone('UTC', cm.received_at), 'YYYY-MM-DD')
    ORDER BY MIN(cm.received_at) ASC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    companyId: row.company_id,
    companySlug: row.company_slug,
    companyDbPort: Number(row.company_db_port),
    provider: row.provider,
    providerChatId: row.provider_chat_id,
    providerThreadId: row.provider_thread_id,
    dayKey: row.day_key,
  }));
}

export async function claimCommunicationBatch(
  batch: CommunicationBatch,
  synthesisBatchId: string,
): Promise<string[]> {
  const rows = await db
    .update(communicationMessages)
    .set({
      processingStatus: "processing",
      synthesisBatchId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(communicationMessages.companyId, batch.companyId),
        eq(communicationMessages.provider, batch.provider),
        eq(communicationMessages.providerChatId, batch.providerChatId),
        eq(communicationMessages.providerThreadId, batch.providerThreadId),
        sql`to_char(timezone('UTC', ${communicationMessages.receivedAt}), 'YYYY-MM-DD') = ${batch.dayKey}`,
        eq(communicationMessages.processingStatus, "pending"),
      ),
    )
    .returning({ id: communicationMessages.id });

  return rows.map((row) => row.id);
}

export async function loadCommunicationMessagesByIds(messageIds: string[]): Promise<CommunicationMessageRow[]> {
  const nextIds = messageIds.filter((value) => value.trim().length > 0);
  if (nextIds.length === 0) return [];

  const rows = await db
    .select({
      id: communicationMessages.id,
      providerMessageId: communicationMessages.providerMessageId,
      providerThreadId: communicationMessages.providerThreadId,
      providerChatId: communicationMessages.providerChatId,
      provider: communicationMessages.provider,
      subject: communicationMessages.subject,
      senderName: communicationMessages.senderName,
      senderAddress: communicationMessages.senderAddress,
      senderId: communicationMessages.senderId,
      participantAddresses: communicationMessages.participantAddresses,
      attachmentRefs: communicationMessages.attachmentRefs,
      content: communicationMessages.content,
      rawPayload: communicationMessages.rawPayload,
      receivedAt: communicationMessages.receivedAt,
    })
    .from(communicationMessages)
    .where(inArray(communicationMessages.id, nextIds))
    .orderBy(asc(communicationMessages.receivedAt));

  return rows.map((row) => ({
    ...row,
    participantAddresses: Array.isArray(row.participantAddresses)
      ? row.participantAddresses.filter((value): value is string => typeof value === "string")
      : [],
    attachmentRefs: Array.isArray(row.attachmentRefs)
      ? row.attachmentRefs.filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null)
      : [],
    rawPayload:
      row.rawPayload && typeof row.rawPayload === "object"
        ? (row.rawPayload as Record<string, unknown>)
        : {},
    receivedAt: row.receivedAt.toISOString(),
  }));
}

export async function markCommunicationBatchProcessed(messageIds: string[], synthesisBatchId: string): Promise<void> {
  const nextIds = messageIds.filter((value) => value.trim().length > 0);
  if (nextIds.length === 0) return;

  await db
    .update(communicationMessages)
    .set({
      processingStatus: "processed",
      synthesisBatchId,
      processedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(inArray(communicationMessages.id, nextIds));
}

export async function markCommunicationBatchFailed(messageIds: string[], synthesisBatchId: string): Promise<void> {
  const nextIds = messageIds.filter((value) => value.trim().length > 0);
  if (nextIds.length === 0) return;

  await db
    .update(communicationMessages)
    .set({
      processingStatus: "failed",
      synthesisBatchId,
      updatedAt: new Date(),
    })
    .where(inArray(communicationMessages.id, nextIds));
}

export async function insertPendingSignals(rows: PendingSignalInsert[]): Promise<void> {
  if (rows.length === 0) return;

  await db
    .insert(pendingSignals)
    .values(rows.map((row) => ({
      companyId: row.companyId,
      dedupKey: row.dedupKey,
      signalType: row.signalType,
      targetDomain: row.targetDomain,
      title: row.title,
      summary: row.summary,
      sourceProvider: row.sourceProvider ?? null,
      sourceThreadId: row.sourceThreadId ?? null,
      sourceLabel: row.sourceLabel ?? null,
      communicationMessageIds: row.communicationMessageIds ?? [],
      structuredData: row.structuredData ?? {},
      proposedFilePath: row.proposedFilePath,
      proposedFrontmatter: row.proposedFrontmatter,
      proposedBody: row.proposedBody,
      confidenceScore: row.confidenceScore ?? null,
    })))
    .onConflictDoNothing({ target: [pendingSignals.companyId, pendingSignals.dedupKey] });
}

export async function listPendingSignalsForCompany(companyId: string, limit = 50): Promise<PendingSignalRow[]> {
  return db
    .select({
      id: pendingSignals.id,
      signalType: pendingSignals.signalType,
      targetDomain: pendingSignals.targetDomain,
      title: pendingSignals.title,
      summary: pendingSignals.summary,
      sourceProvider: pendingSignals.sourceProvider,
      sourceThreadId: pendingSignals.sourceThreadId,
      sourceLabel: pendingSignals.sourceLabel,
      communicationMessageIds: pendingSignals.communicationMessageIds,
      structuredData: pendingSignals.structuredData,
      proposedFilePath: pendingSignals.proposedFilePath,
      proposedFrontmatter: pendingSignals.proposedFrontmatter,
      proposedBody: pendingSignals.proposedBody,
      status: pendingSignals.status,
      confidenceScore: pendingSignals.confidenceScore,
      commitSha: pendingSignals.commitSha,
      reviewedAt: pendingSignals.reviewedAt,
      createdAt: pendingSignals.createdAt,
      updatedAt: pendingSignals.updatedAt,
    })
    .from(pendingSignals)
    .where(and(eq(pendingSignals.companyId, companyId), eq(pendingSignals.status, "pending")))
    .orderBy(desc(pendingSignals.createdAt))
    .limit(limit);
}

export async function getPendingSignal(companyId: string, signalId: string): Promise<PendingSignalRow | null> {
  const [row] = await db
    .select({
      id: pendingSignals.id,
      signalType: pendingSignals.signalType,
      targetDomain: pendingSignals.targetDomain,
      title: pendingSignals.title,
      summary: pendingSignals.summary,
      sourceProvider: pendingSignals.sourceProvider,
      sourceThreadId: pendingSignals.sourceThreadId,
      sourceLabel: pendingSignals.sourceLabel,
      communicationMessageIds: pendingSignals.communicationMessageIds,
      structuredData: pendingSignals.structuredData,
      proposedFilePath: pendingSignals.proposedFilePath,
      proposedFrontmatter: pendingSignals.proposedFrontmatter,
      proposedBody: pendingSignals.proposedBody,
      status: pendingSignals.status,
      confidenceScore: pendingSignals.confidenceScore,
      commitSha: pendingSignals.commitSha,
      reviewedAt: pendingSignals.reviewedAt,
      createdAt: pendingSignals.createdAt,
      updatedAt: pendingSignals.updatedAt,
    })
    .from(pendingSignals)
    .where(and(eq(pendingSignals.companyId, companyId), eq(pendingSignals.id, signalId)))
    .limit(1);

  return row ?? null;
}

export async function resolvePendingSignal(
  companyId: string,
  signalId: string,
  input: { status: "approved" | "rejected"; reviewedBy: string; commitSha?: string | null },
): Promise<void> {
  await db
    .update(pendingSignals)
    .set({
      status: input.status,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
      commitSha: input.commitSha ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(pendingSignals.companyId, companyId), eq(pendingSignals.id, signalId)));
}
