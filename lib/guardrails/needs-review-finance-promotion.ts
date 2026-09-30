export interface NeedsReviewFinancePromotionInput {
  needsReview: boolean;
  approved: boolean;
  extractedTransactionCount: number;
  canonicalFinanceRecordCount: number;
  bankBalanceAccountCount: number;
}

export interface NeedsReviewFinancePromotionDecision {
  reviewPending: boolean;
  wouldBlockDecisionGradePromotion: boolean;
  blockedDecisionGradePromotion: boolean;
  extractedTxnCount: number;
  candidateCounts: {
    transactions: number;
    canonicalFinanceRecords: number;
    bankBalanceAccounts: number;
  };
}

export function resolveNeedsReviewFinancePromotion(
  input: NeedsReviewFinancePromotionInput,
): NeedsReviewFinancePromotionDecision {
  const reviewPending = input.needsReview && !input.approved;
  return {
    reviewPending,
    wouldBlockDecisionGradePromotion: reviewPending,
    blockedDecisionGradePromotion: reviewPending,
    extractedTxnCount: input.extractedTransactionCount,
    candidateCounts: {
      transactions: input.extractedTransactionCount,
      canonicalFinanceRecords: input.canonicalFinanceRecordCount,
      bankBalanceAccounts: input.bankBalanceAccountCount,
    },
  };
}
