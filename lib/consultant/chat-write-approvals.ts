import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  companies,
  merchantRules,
  reconciledTxns,
} from "@/lib/db/schema";

export const CHAT_DIRECT_WRITE_APPROVAL_ACTIONS = [
  "categorize_transaction",
  "create_merchant_rule",
  "confirm_profile",
] as const;

export type ChatDirectWriteApprovalAction =
  (typeof CHAT_DIRECT_WRITE_APPROVAL_ACTIONS)[number];

const categorizeTransactionPayloadSchema = z.object({
  transactionId: z.string().trim().min(1),
  category: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().trim().nullable().optional(),
});

const createMerchantRulePayloadSchema = z.object({
  merchantPattern: z.string().trim().min(1),
  category: z.string().trim().min(1),
});

const confirmProfilePayloadSchema = z.object({
  companyName: z.string().trim().min(1),
  businessType: z.string().trim().min(1),
  jurisdiction: z.string().trim().nullable().optional(),
  website: z.string().trim().nullable().optional(),
  reportingCurrency: z.string().trim().min(1).default("USD"),
});

export type NormalizedChatDirectWriteApprovalPayload =
  | {
      action: "categorize_transaction";
      transactionId: string;
      category: string;
      confidence: number;
      reasoning: string | null;
    }
  | {
      action: "create_merchant_rule";
      merchantPattern: string;
      category: string;
    }
  | {
      action: "confirm_profile";
      companyName: string;
      businessType: string;
      jurisdiction: string | null;
      website: string | null;
      reportingCurrency: string;
    };

export interface ChatDirectWriteExecutionResult {
  type: "chat_direct_write";
  action: ChatDirectWriteApprovalAction;
  targetId: string;
  executedAt: string;
  details: Record<string, unknown>;
}

export function isChatDirectWriteApprovalAction(
  action: string,
): action is ChatDirectWriteApprovalAction {
  return CHAT_DIRECT_WRITE_APPROVAL_ACTIONS.includes(
    action as ChatDirectWriteApprovalAction,
  );
}

export function normalizeChatDirectWriteApprovalPayload(
  action: ChatDirectWriteApprovalAction,
  payload: unknown,
): NormalizedChatDirectWriteApprovalPayload {
  if (action === "categorize_transaction") {
    const parsed = categorizeTransactionPayloadSchema.parse(payload);
    return {
      action,
      transactionId: parsed.transactionId,
      category: parsed.category,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning ?? null,
    };
  }

  if (action === "create_merchant_rule") {
    const parsed = createMerchantRulePayloadSchema.parse(payload);
    return {
      action,
      merchantPattern: parsed.merchantPattern,
      category: parsed.category,
    };
  }

  const parsed = confirmProfilePayloadSchema.parse(payload);
  return {
    action,
    companyName: parsed.companyName,
    businessType: parsed.businessType,
    jurisdiction: parsed.jurisdiction ?? null,
    website: parsed.website ?? null,
    reportingCurrency: parsed.reportingCurrency,
  };
}

export function getChatDirectWriteApprovalDedupeKey(
  action: ChatDirectWriteApprovalAction,
  payload: unknown,
): string {
  return JSON.stringify(normalizeChatDirectWriteApprovalPayload(action, payload));
}

export async function executeChatDirectWriteApproval(input: {
  action: ChatDirectWriteApprovalAction;
  payload: unknown;
  companyId: string;
  now?: Date;
}): Promise<ChatDirectWriteExecutionResult> {
  const now = input.now ?? new Date();
  const executedAt = now.toISOString();
  const payload = normalizeChatDirectWriteApprovalPayload(
    input.action,
    input.payload,
  );

  if (payload.action === "categorize_transaction") {
    const [updatedTxn] = await db
      .update(reconciledTxns)
      .set({
        category: payload.category,
        categoryConfidence: String(payload.confidence),
        categorizedBy: "approval_confirmed",
        categoryReasoning: payload.reasoning,
        isReviewed: true,
        updatedAt: now,
      })
      .where(
        and(
          eq(reconciledTxns.id, payload.transactionId),
          eq(reconciledTxns.companyId, input.companyId),
        ),
      )
      .returning({ id: reconciledTxns.id });

    if (!updatedTxn) {
      throw new Error("Transaction not found for approval execution");
    }

    return {
      type: "chat_direct_write",
      action: payload.action,
      targetId: updatedTxn.id,
      executedAt,
      details: {
        category: payload.category,
        confidence: payload.confidence,
      },
    };
  }

  if (payload.action === "create_merchant_rule") {
    const rule = await db.transaction(async (tx) => {
      const lockKey = `${input.companyId}:merchant_rule:${payload.merchantPattern}:${payload.category}`;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );

      const [existingRule] = await tx
        .select({ id: merchantRules.id })
        .from(merchantRules)
        .where(
          and(
            eq(merchantRules.companyId, input.companyId),
            eq(merchantRules.merchantPattern, payload.merchantPattern),
            eq(merchantRules.category, payload.category),
          ),
        )
        .limit(1);

      if (existingRule) {
        return { id: existingRule.id, deduped: true };
      }

      const [createdRule] = await tx
        .insert(merchantRules)
        .values({
          companyId: input.companyId,
          merchantPattern: payload.merchantPattern,
          category: payload.category,
          source: "approval_confirmed",
        })
        .returning({ id: merchantRules.id });

      if (!createdRule) {
        throw new Error("Merchant rule approval execution did not create a row");
      }

      return { id: createdRule.id, deduped: false };
    });

    return {
      type: "chat_direct_write",
      action: payload.action,
      targetId: rule.id,
      executedAt,
      details: {
        merchantPattern: payload.merchantPattern,
        category: payload.category,
        deduped: rule.deduped,
      },
    };
  }

  const [company] = await db
    .update(companies)
    .set({
      name: payload.companyName,
      businessType: payload.businessType,
      jurisdiction: payload.jurisdiction ?? undefined,
      website: payload.website,
      reportingCurrency: payload.reportingCurrency,
      updatedAt: now,
    })
    .where(eq(companies.id, input.companyId))
    .returning({ id: companies.id });

  if (!company) {
    throw new Error("Company profile not found for approval execution");
  }

  return {
    type: "chat_direct_write",
    action: payload.action,
    targetId: company.id,
    executedAt,
    details: {
      companyName: payload.companyName,
      businessType: payload.businessType,
      reportingCurrency: payload.reportingCurrency,
    },
  };
}
