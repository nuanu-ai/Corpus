import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

import type { db as appDb } from "@/lib/db";
import { communicationMessages, companies, llmUsageEvents, users } from "@/lib/db/schema";

type Db = typeof appDb;

function toCount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundUsd(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export async function getLlmObservabilityOverview(db: Db) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const anthropicScope = and(
    gte(llmUsageEvents.createdAt, since),
    eq(llmUsageEvents.provider, "anthropic"),
  );

  const [
    trackedBySubsystemRows,
    topCompanyRows,
    topReferenceRows,
    recentRows,
    communicationsProxyRows,
    topUserRows,
    topSystemActorRows,
  ] = await Promise.all([
    db
      .select({
        subsystem: llmUsageEvents.subsystem,
        operation: llmUsageEvents.operation,
        provider: llmUsageEvents.provider,
        model: llmUsageEvents.model,
        runCount: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)::int`,
        estimatedCostUsd: sql<number>`coalesce(sum(coalesce(${llmUsageEvents.estimatedCostUsd}, 0)), 0)::numeric`,
      })
      .from(llmUsageEvents)
      .where(anthropicScope)
      .groupBy(
        llmUsageEvents.subsystem,
        llmUsageEvents.operation,
        llmUsageEvents.provider,
        llmUsageEvents.model,
      )
      .orderBy(desc(sql`coalesce(sum(coalesce(${llmUsageEvents.estimatedCostUsd}, 0)), 0)::numeric`)),
    db
      .select({
        companyId: llmUsageEvents.companyId,
        companyName: companies.name,
        runCount: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)::int`,
        estimatedCostUsd: sql<number>`coalesce(sum(coalesce(${llmUsageEvents.estimatedCostUsd}, 0)), 0)::numeric`,
      })
      .from(llmUsageEvents)
      .leftJoin(companies, eq(llmUsageEvents.companyId, companies.id))
      .where(anthropicScope)
      .groupBy(llmUsageEvents.companyId, companies.name)
      .orderBy(desc(sql`coalesce(sum(coalesce(${llmUsageEvents.estimatedCostUsd}, 0)), 0)::numeric`))
      .limit(20),
    db
      .select({
        companyId: llmUsageEvents.companyId,
        companyName: companies.name,
        subsystem: llmUsageEvents.subsystem,
        operation: llmUsageEvents.operation,
        referenceType: llmUsageEvents.referenceType,
        referenceId: llmUsageEvents.referenceId,
        fileName: sql<string | null>`${llmUsageEvents.metadata} ->> 'fileName'`,
        runCount: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)::int`,
        estimatedCostUsd: sql<number>`coalesce(sum(coalesce(${llmUsageEvents.estimatedCostUsd}, 0)), 0)::numeric`,
        lastSeenAt: sql<string | null>`max(${llmUsageEvents.createdAt})::text`,
      })
      .from(llmUsageEvents)
      .leftJoin(companies, eq(llmUsageEvents.companyId, companies.id))
      .where(anthropicScope)
      .groupBy(
        llmUsageEvents.companyId,
        companies.name,
        llmUsageEvents.subsystem,
        llmUsageEvents.operation,
        llmUsageEvents.referenceType,
        llmUsageEvents.referenceId,
        sql`${llmUsageEvents.metadata} ->> 'fileName'`,
      )
      .orderBy(desc(sql`coalesce(sum(coalesce(${llmUsageEvents.estimatedCostUsd}, 0)), 0)::numeric`))
      .limit(20),
    db
      .select({
        createdAt: llmUsageEvents.createdAt,
        companyId: llmUsageEvents.companyId,
        companyName: companies.name,
        userId: llmUsageEvents.userId,
        userEmail: users.email,
        provider: llmUsageEvents.provider,
        model: llmUsageEvents.model,
        subsystem: llmUsageEvents.subsystem,
        operation: llmUsageEvents.operation,
        executor: llmUsageEvents.executor,
        billingMode: llmUsageEvents.billingMode,
        referenceType: llmUsageEvents.referenceType,
        referenceId: llmUsageEvents.referenceId,
        fileName: sql<string | null>`${llmUsageEvents.metadata} ->> 'fileName'`,
        inputTokens: llmUsageEvents.inputTokens,
        outputTokens: llmUsageEvents.outputTokens,
        estimatedCostUsd: llmUsageEvents.estimatedCostUsd,
      })
      .from(llmUsageEvents)
      .leftJoin(companies, eq(llmUsageEvents.companyId, companies.id))
      .leftJoin(users, eq(llmUsageEvents.userId, users.id))
      .where(anthropicScope)
      .orderBy(desc(llmUsageEvents.createdAt))
      .limit(40),
    db
      .select({
        companyId: communicationMessages.companyId,
        companyName: companies.name,
        processedMessages: sql<number>`count(*) filter (where ${communicationMessages.processingStatus} = 'processed')::int`,
        synthesisBatches: sql<number>`count(distinct ${communicationMessages.synthesisBatchId}) filter (where ${communicationMessages.synthesisBatchId} is not null)::int`,
        lastProcessedAt: sql<string | null>`max(${communicationMessages.processedAt})`,
      })
      .from(communicationMessages)
      .leftJoin(companies, eq(communicationMessages.companyId, companies.id))
      .where(
        gte(
          sql<Date>`coalesce(${communicationMessages.processedAt}, ${communicationMessages.updatedAt}, ${communicationMessages.createdAt})`,
          since,
        ),
      )
      .groupBy(communicationMessages.companyId, companies.name)
      .orderBy(desc(sql`count(distinct ${communicationMessages.synthesisBatchId}) filter (where ${communicationMessages.synthesisBatchId} is not null)::int`))
      .limit(20),
    db
      .select({
        userId: llmUsageEvents.userId,
        userName: users.name,
        userEmail: users.email,
        runCount: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)::int`,
        estimatedCostUsd: sql<number>`coalesce(sum(coalesce(${llmUsageEvents.estimatedCostUsd}, 0)), 0)::numeric`,
        lastSeenAt: sql<string | null>`max(${llmUsageEvents.createdAt})::text`,
      })
      .from(llmUsageEvents)
      .leftJoin(users, eq(llmUsageEvents.userId, users.id))
      .where(anthropicScope)
      .groupBy(llmUsageEvents.userId, users.name, users.email)
      .orderBy(desc(sql`coalesce(sum(coalesce(${llmUsageEvents.estimatedCostUsd}, 0)), 0)::numeric`))
      .limit(20),
    db
      .select({
        executor: sql<string>`coalesce(${llmUsageEvents.executor}, 'unknown_executor')`,
        subsystem: llmUsageEvents.subsystem,
        operation: llmUsageEvents.operation,
        runCount: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)::int`,
        estimatedCostUsd: sql<number>`coalesce(sum(coalesce(${llmUsageEvents.estimatedCostUsd}, 0)), 0)::numeric`,
        lastSeenAt: sql<string | null>`max(${llmUsageEvents.createdAt})::text`,
      })
      .from(llmUsageEvents)
      .where(and(anthropicScope, isNull(llmUsageEvents.userId)))
      .groupBy(sql`coalesce(${llmUsageEvents.executor}, 'unknown_executor')`, llmUsageEvents.subsystem, llmUsageEvents.operation)
      .orderBy(desc(sql`coalesce(sum(coalesce(${llmUsageEvents.estimatedCostUsd}, 0)), 0)::numeric`))
      .limit(20),
  ]);

  return {
    trackedUsageBySubsystem24h: trackedBySubsystemRows.map((row) => ({
      subsystem: row.subsystem,
      operation: row.operation,
      provider: row.provider,
      model: row.model,
      runCount: toCount(row.runCount),
      inputTokens: toCount(row.inputTokens),
      outputTokens: toCount(row.outputTokens),
      estimatedCostUsd: roundUsd(row.estimatedCostUsd),
    })),
    topCompanies24h: topCompanyRows.map((row) => ({
      companyId: row.companyId,
      companyName: row.companyName ?? "Unknown company",
      runCount: toCount(row.runCount),
      inputTokens: toCount(row.inputTokens),
      outputTokens: toCount(row.outputTokens),
      estimatedCostUsd: roundUsd(row.estimatedCostUsd),
    })),
    topReferences24h: topReferenceRows.map((row) => ({
      companyId: row.companyId,
      companyName: row.companyName ?? "Unknown company",
      subsystem: row.subsystem,
      operation: row.operation,
      referenceType: row.referenceType ?? null,
      referenceId: row.referenceId ?? null,
      fileName: row.fileName ?? null,
      runCount: toCount(row.runCount),
      inputTokens: toCount(row.inputTokens),
      outputTokens: toCount(row.outputTokens),
      estimatedCostUsd: roundUsd(row.estimatedCostUsd),
      lastSeenAt: row.lastSeenAt,
    })),
    recentEvents24h: recentRows.map((row) => ({
      createdAt: row.createdAt?.toISOString?.() ?? String(row.createdAt),
      companyId: row.companyId,
      companyName: row.companyName ?? "Unknown company",
      userId: row.userId,
      userEmail: row.userEmail ?? null,
      provider: row.provider,
      model: row.model,
      subsystem: row.subsystem,
      operation: row.operation,
      executor: row.executor ?? null,
      billingMode: row.billingMode ?? null,
      referenceType: row.referenceType ?? null,
      referenceId: row.referenceId ?? null,
      fileName: row.fileName ?? null,
      inputTokens: toCount(row.inputTokens),
      outputTokens: toCount(row.outputTokens),
      estimatedCostUsd: roundUsd(row.estimatedCostUsd),
    })),
    communicationsProxy24h: communicationsProxyRows.map((row) => ({
      companyId: row.companyId,
      companyName: row.companyName ?? "Unknown company",
      processedMessages: toCount(row.processedMessages),
      synthesisBatches: toCount(row.synthesisBatches),
      lastProcessedAt: row.lastProcessedAt,
    })),
    topUsers24h: topUserRows.map((row) => ({
      userId: row.userId ?? "unknown",
      userName: row.userName ?? "Unknown user",
      userEmail: row.userEmail ?? null,
      runCount: toCount(row.runCount),
      inputTokens: toCount(row.inputTokens),
      outputTokens: toCount(row.outputTokens),
      estimatedCostUsd: roundUsd(row.estimatedCostUsd),
      lastSeenAt: row.lastSeenAt,
    })),
    topSystemActors24h: topSystemActorRows.map((row) => ({
      executor: row.executor ?? "unknown_executor",
      subsystem: row.subsystem,
      operation: row.operation,
      runCount: toCount(row.runCount),
      inputTokens: toCount(row.inputTokens),
      outputTokens: toCount(row.outputTokens),
      estimatedCostUsd: roundUsd(row.estimatedCostUsd),
      lastSeenAt: row.lastSeenAt,
    })),
  };
}
