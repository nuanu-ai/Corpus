import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { CategorizationResult } from "./rules-engine";
import {
  estimateAnthropicUsageCostUsd,
  normalizeLlmUsage,
  recordLlmUsageEvent,
} from "@/lib/llm-usage-events";

const DEFAULT_CATEGORIES = [
  "Revenue",
  "Cost of Goods Sold",
  "Software",
  "SaaS",
  "Hosting & Infrastructure",
  "Payroll & Contractors",
  "Marketing & Advertising",
  "Travel",
  "Meals & Entertainment",
  "Office Supplies",
  "Legal",
  "Accounting",
  "Insurance",
  "Banking Fees",
  "Telecommunications",
  "Utilities",
  "Shipping",
  "Subscriptions",
  "Equipment",
  "Professional Services",
  "Rent",
  "Taxes & Licenses",
  "Miscellaneous",
];

export async function categorizeWithClaude(
  txn: {
    merchantName: string | null;
    description: string | null;
    amount: number;
    currency: string;
    type: "credit" | "debit";
  },
  context: {
    businessType?: string;
    chartOfAccounts?: string[];
  },
  telemetry?: {
    companyId?: string;
  },
): Promise<CategorizationResult> {
  const categories = context.chartOfAccounts?.length
    ? context.chartOfAccounts
    : DEFAULT_CATEGORIES;

  const parts: string[] = [
    "Categorize this transaction into one of the given categories.",
    `Transaction: ${txn.type} ${txn.amount} ${txn.currency}`,
  ];

  if (txn.merchantName) parts.push(`Merchant: ${txn.merchantName}`);
  if (txn.description) parts.push(`Description: ${txn.description}`);
  if (context.businessType) parts.push(`Business type: ${context.businessType}`);

  parts.push(`Categories: ${categories.join(", ")}`);
  parts.push('Respond with JSON only: {"category":"...","confidence":0.0-1.0,"reasoning":"..."}');

  const prompt = parts.join("\n");

  try {
    const { text, usage } = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: "You are a financial transaction categorizer. Respond with valid JSON only, no markdown fencing.",
      prompt,
    });
    const normalizedUsage = normalizeLlmUsage(usage);
    if (normalizedUsage) {
      try {
        await recordLlmUsageEvent({
          companyId: telemetry?.companyId ?? null,
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
          subsystem: "transaction_categorization",
          operation: "fallback_ai_categorization",
          executor: "categorization_claude_engine",
          billingMode: "api",
          usage: normalizedUsage,
          estimatedCostUsd: estimateAnthropicUsageCostUsd({
            model: "claude-haiku-4-5-20251001",
            usage: normalizedUsage,
          }),
          referenceType: "transaction_categorization",
          referenceId: telemetry?.companyId ?? null,
          metadata: {
            amount: txn.amount,
            currency: txn.currency,
            type: txn.type,
            merchantName: txn.merchantName,
          },
        });
      } catch {
        // Do not fail categorization because observability failed.
      }
    }

    // Strip markdown fencing if present
    const cleaned = text.replace(/^```(?:json)?\n?|\n?```$/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (
      typeof parsed.category !== "string" ||
      typeof parsed.confidence !== "number"
    ) {
      throw new Error("Invalid response shape");
    }

    return {
      category: parsed.category,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      method: "ai",
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    };
  } catch {
    return {
      category: "Uncategorized",
      confidence: 0.1,
      method: "ai",
      reasoning: "Failed to parse AI response",
    };
  }
}
