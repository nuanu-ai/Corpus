import type { LanguageModelUsage } from "ai";
import { and, eq, gte, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { llmUsageEvents } from "@/lib/db/schema";

export type LlmUsageSubsystem =
  | "chat_consultant"
  | "communications_synthesis"
  | "legal_watch"
  | "report_config_generation"
  | "transaction_categorization";

export interface LlmUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

export interface RecordLlmUsageEventInput {
  companyId?: string | null;
  userId?: string | null;
  provider: string;
  model: string;
  subsystem: LlmUsageSubsystem;
  operation: string;
  executor?: string | null;
  billingMode?: "api" | "subscription" | "unknown" | null;
  threadId?: string | null;
  documentId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  usage: LlmUsageMetrics;
  estimatedCostUsd?: number | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

const ANTHROPIC_SONNET_4_PRICING_USD_PER_MTOK = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
} as const;

const ANTHROPIC_HAIKU_4_PRICING_USD_PER_MTOK = {
  input: 1,
  output: 5,
  cacheRead: 0.1,
  cacheWrite: 1.25,
} as const;

function normalizeTokenCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export function normalizeLlmUsage(
  usage: Partial<LanguageModelUsage> | Record<string, unknown> | null | undefined,
): LlmUsageMetrics | null {
  if (!usage || typeof usage !== "object") return null;

  const record = usage as Record<string, unknown>;
  const inputTokenDetails =
    record.inputTokenDetails && typeof record.inputTokenDetails === "object"
      ? (record.inputTokenDetails as Record<string, unknown>)
      : null;
  const outputTokenDetails =
    record.outputTokenDetails && typeof record.outputTokenDetails === "object"
      ? (record.outputTokenDetails as Record<string, unknown>)
      : null;

  const metrics = {
    inputTokens: normalizeTokenCount(record.inputTokens ?? record.input_tokens),
    outputTokens: normalizeTokenCount(record.outputTokens ?? record.output_tokens),
    cacheReadTokens: normalizeTokenCount(
      inputTokenDetails?.cacheReadTokens ??
        record.cachedInputTokens ??
        record.cached_input_tokens ??
        record.cache_read_input_tokens,
    ),
    cacheWriteTokens: normalizeTokenCount(
      inputTokenDetails?.cacheWriteTokens ?? record.cache_creation_input_tokens,
    ),
    reasoningTokens: normalizeTokenCount(
      outputTokenDetails?.reasoningTokens ?? record.reasoningTokens ?? record.reasoning_tokens,
    ),
  };

  if (
    metrics.inputTokens === 0 &&
    metrics.outputTokens === 0 &&
    metrics.cacheReadTokens === 0 &&
    metrics.cacheWriteTokens === 0 &&
    metrics.reasoningTokens === 0
  ) {
    return null;
  }

  return metrics;
}

function resolveAnthropicPricing(model: string) {
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith("claude-sonnet-4")) return ANTHROPIC_SONNET_4_PRICING_USD_PER_MTOK;
  if (normalized.startsWith("claude-haiku-4")) return ANTHROPIC_HAIKU_4_PRICING_USD_PER_MTOK;
  return null;
}

export function estimateAnthropicUsageCostUsd(input: {
  model: string;
  usage: LlmUsageMetrics | null;
}): number | null {
  if (!input.usage) return null;
  const pricing = resolveAnthropicPricing(input.model);
  if (!pricing) return null;

  const noCacheInputTokens = Math.max(
    0,
    input.usage.inputTokens - input.usage.cacheReadTokens - input.usage.cacheWriteTokens,
  );

  const estimatedUsd =
    (noCacheInputTokens / 1_000_000) * pricing.input +
    (input.usage.outputTokens / 1_000_000) * pricing.output +
    (input.usage.cacheReadTokens / 1_000_000) * pricing.cacheRead +
    (input.usage.cacheWriteTokens / 1_000_000) * pricing.cacheWrite;

  if (!Number.isFinite(estimatedUsd) || estimatedUsd <= 0) {
    return null;
  }

  return Math.round(estimatedUsd * 1_000_000) / 1_000_000;
}

export async function recordLlmUsageEvent(input: RecordLlmUsageEventInput): Promise<void> {
  const estimatedCostUsd =
    input.estimatedCostUsd ?? (
      input.provider.trim().toLowerCase() === "anthropic"
        ? estimateAnthropicUsageCostUsd({ model: input.model, usage: input.usage })
        : null
    );

  await db.insert(llmUsageEvents).values({
    companyId: input.companyId ?? null,
    userId: input.userId ?? null,
    provider: input.provider,
    model: input.model,
    subsystem: input.subsystem,
    operation: input.operation,
    executor: input.executor ?? null,
    billingMode: input.billingMode ?? null,
    threadId: input.threadId ?? null,
    documentId: input.documentId ?? null,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cacheReadTokens: input.usage.cacheReadTokens,
    cacheWriteTokens: input.usage.cacheWriteTokens,
    reasoningTokens: input.usage.reasoningTokens,
    estimatedCostUsd: estimatedCostUsd != null ? String(estimatedCostUsd) : null,
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? new Date(),
  });
}

export async function hasRecentLlmUsageEvent(input: {
  companyId?: string | null;
  userId?: string | null;
  provider?: string | null;
  subsystem: LlmUsageSubsystem;
  operation: string;
  referenceType?: string | null;
  referenceId?: string | null;
  since: Date;
}): Promise<boolean> {
  const conditions = [gte(llmUsageEvents.createdAt, input.since)];

  if (input.companyId !== undefined) {
    conditions.push(
      input.companyId === null
        ? isNull(llmUsageEvents.companyId)
        : eq(llmUsageEvents.companyId, input.companyId),
    );
  }
  if (input.userId !== undefined) {
    conditions.push(
      input.userId === null
        ? isNull(llmUsageEvents.userId)
        : eq(llmUsageEvents.userId, input.userId),
    );
  }
  if (input.provider !== undefined) {
    conditions.push(
      input.provider === null
        ? isNull(llmUsageEvents.provider)
        : eq(llmUsageEvents.provider, input.provider),
    );
  }
  if (input.referenceType !== undefined) {
    conditions.push(
      input.referenceType === null
        ? isNull(llmUsageEvents.referenceType)
        : eq(llmUsageEvents.referenceType, input.referenceType),
    );
  }
  if (input.referenceId !== undefined) {
    conditions.push(
      input.referenceId === null
        ? isNull(llmUsageEvents.referenceId)
        : eq(llmUsageEvents.referenceId, input.referenceId),
    );
  }

  conditions.push(eq(llmUsageEvents.subsystem, input.subsystem));
  conditions.push(eq(llmUsageEvents.operation, input.operation));

  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(llmUsageEvents)
    .where(and(...conditions))
    .limit(1);

  return Number(rows[0]?.count ?? 0) > 0;
}
