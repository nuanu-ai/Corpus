import { extractMessageText, type ConsultantUIMessage } from "./messages";

export interface ChatRunUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

interface ChatRunUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails?: {
    reasoningTokens?: number;
  };
}

const ANTHROPIC_STANDARD_PRICING_USD_PER_MTOK = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite: 3.75,
} as const;

function roundUsd(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function normalizeTokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function summarizeLatestUserPrompt(
  messages: ConsultantUIMessage[],
  maxLength = 240,
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;

    const text = extractMessageText(message.parts)
      .replace(/\s+/g, " ")
      .trim();

    if (!text) continue;
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  return null;
}

export function normalizeChatRunUsage(
  usage: ChatRunUsageLike | null | undefined,
): ChatRunUsageMetrics | null {
  if (!usage) return null;

  const inputTokens = normalizeTokenCount(usage.inputTokens);
  const outputTokens = normalizeTokenCount(usage.outputTokens);
  const totalTokens = normalizeTokenCount(usage.totalTokens);
  const cacheReadTokens = normalizeTokenCount(usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens);
  const cacheWriteTokens = normalizeTokenCount(usage.inputTokenDetails?.cacheWriteTokens);
  const reasoningTokens = normalizeTokenCount(
    usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens,
  );

  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    totalTokens === 0 &&
    cacheReadTokens === 0 &&
    cacheWriteTokens === 0 &&
    reasoningTokens === 0
  ) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  };
}

function isAnthropicSonnet4Model(model: string | null | undefined): boolean {
  if (!model) return false;
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith("claude-sonnet-4");
}

export function estimateChatRunCostUsd(input: {
  provider: string | null | undefined;
  model: string | null | undefined;
  usage: ChatRunUsageMetrics | null;
}): number | null {
  const provider = input.provider?.trim().toLowerCase();
  if (provider !== "anthropic" || !isAnthropicSonnet4Model(input.model) || !input.usage) {
    return null;
  }

  const noCacheInputTokens = Math.max(
    0,
    input.usage.inputTokens - input.usage.cacheReadTokens - input.usage.cacheWriteTokens,
  );

  const estimatedUsd =
    (noCacheInputTokens / 1_000_000) * ANTHROPIC_STANDARD_PRICING_USD_PER_MTOK.input +
    (input.usage.outputTokens / 1_000_000) * ANTHROPIC_STANDARD_PRICING_USD_PER_MTOK.output +
    (input.usage.cacheReadTokens / 1_000_000) * ANTHROPIC_STANDARD_PRICING_USD_PER_MTOK.cacheRead +
    (input.usage.cacheWriteTokens / 1_000_000) * ANTHROPIC_STANDARD_PRICING_USD_PER_MTOK.cacheWrite;

  if (!Number.isFinite(estimatedUsd) || estimatedUsd <= 0) {
    return null;
  }

  return roundUsd(estimatedUsd);
}
