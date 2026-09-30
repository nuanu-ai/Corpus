import type { CategorizationResult } from "./rules-engine";
import { categorizeByRules } from "./rules-engine";
import { categorizeWithQmd } from "./qmd-engine";
import { categorizeWithClaude } from "./claude-engine";
import { indexTransaction } from "./qmd-index";

export type { CategorizationResult };

export async function categorizeTransaction(
  txn: {
    merchantName: string | null;
    merchantMcc: string | null;
    description: string | null;
    amount: number;
    currency: string;
    type: "credit" | "debit";
  },
  companyId: string,
  context?: {
    businessType?: string;
    chartOfAccounts?: string[];
  }
): Promise<CategorizationResult> {
  try {
    return await runCascade(txn, companyId, context);
  } catch {
    return {
      category: "Uncategorized",
      confidence: 0,
      method: "ai",
      reasoning: "All categorization layers failed unexpectedly",
    };
  }
}

async function runCascade(
  txn: {
    merchantName: string | null;
    merchantMcc: string | null;
    description: string | null;
    amount: number;
    currency: string;
    type: "credit" | "debit";
  },
  companyId: string,
  context?: {
    businessType?: string;
    chartOfAccounts?: string[];
  }
): Promise<CategorizationResult> {
  // Layer 1: Rules Engine
  const rulesResult = await categorizeByRules(
    {
      merchantName: txn.merchantName,
      merchantMcc: txn.merchantMcc,
      description: txn.description,
    },
    companyId
  );

  if (rulesResult) {
    if (rulesResult.confidence >= 0.9) {
      indexTransaction(
        {
          merchantName: txn.merchantName,
          description: txn.description,
          amount: txn.amount,
          category: rulesResult.category,
        },
        companyId
      ).catch(() => {});
    }
    return rulesResult;
  }

  // Layer 2: QMD RAG
  const qmdResult = await categorizeWithQmd(
    {
      merchantName: txn.merchantName,
      description: txn.description,
      amount: txn.amount,
    },
    companyId
  );

  if (qmdResult) {
    if (qmdResult.confidence >= 0.9) {
      indexTransaction(
        {
          merchantName: txn.merchantName,
          description: txn.description,
          amount: txn.amount,
          category: qmdResult.category,
        },
        companyId
      ).catch(() => {});
    }
    return qmdResult;
  }

  // Layer 3: Claude AI (guaranteed fallback)
  const aiResult = await categorizeWithClaude(
    {
      merchantName: txn.merchantName,
      description: txn.description,
      amount: txn.amount,
      currency: txn.currency,
      type: txn.type,
    },
    context ?? {},
    { companyId }
  );

  if (aiResult.confidence >= 0.9) {
    indexTransaction(
      {
        merchantName: txn.merchantName,
        description: txn.description,
        amount: txn.amount,
        category: aiResult.category,
      },
      companyId
    ).catch(() => {});
  }

  return aiResult;
}
