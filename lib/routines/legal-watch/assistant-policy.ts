export interface LegalWatchAnswerEvidence {
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  jurisdiction?: string | null;
  sourceDate?: string | null;
  retrievedAt?: string | null;
  reviewStatus?: string | null;
  trustTier?: string | null;
  legalStatus?: string | null;
  confidenceScore?: number | null;
  fromApprovedCompanyDb?: boolean;
}

export interface LegalWatchGroundingDecision {
  allowed: boolean;
  warnings: string[];
  requiredDisclosure: string[];
}

export interface LegalWatchAnswerGroundingInput {
  intent?: "informational" | "operational_checklist" | "definitive_legal_advice";
  evidence: LegalWatchAnswerEvidence[];
}

export interface LegalWatchAnswerGroundingDecision {
  status: "grounded" | "caveat_required" | "refuse";
  approvedForAnswer: boolean;
  reasons: string[];
  requiredDisclosure: string[];
  caveats: string[];
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function sourceHasDate(evidence: LegalWatchAnswerEvidence): boolean {
  return hasText(evidence.sourceDate) || hasText(evidence.retrievedAt);
}

function sourceIsPrimaryOrOfficial(evidence: LegalWatchAnswerEvidence): boolean {
  return evidence.trustTier === "primary" || evidence.trustTier === "official";
}

function sourceIsApproved(evidence: LegalWatchAnswerEvidence): boolean {
  return evidence.reviewStatus === "approved";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function caveatFor(reason: string): string {
  switch (reason) {
    case "missing_source":
      return "A source title or URL is required before making a legal claim.";
    case "missing_jurisdiction":
      return "Jurisdiction is missing or ambiguous.";
    case "missing_source_or_retrieved_date":
      return "A source date or retrieved date is required.";
    case "missing_review_status":
      return "Review status must be visible.";
    case "not_approved":
      return "Unreviewed legal watch observations must be caveated.";
    case "secondary_commentary_only":
      return "Secondary commentary cannot establish a legal rule without primary or official confirmation.";
    case "missing_confidence":
      return "Confidence is missing, so uncertainty must be stated.";
    case "not_approved_company_db":
      return "The answer is not grounded in approved Company-DB legal watch content.";
    case "definitive_legal_advice":
      return "Definitive legal advice requires external counsel, notary, BKPM, or local regulator confirmation.";
    default:
      return reason;
  }
}

export function evaluateLegalWatchAnswerGrounding(
  evidence: LegalWatchAnswerEvidence,
): LegalWatchGroundingDecision {
  const warnings: string[] = [];
  const requiredDisclosure: string[] = [];

  if (!evidence.sourceUrl && !evidence.sourceTitle) {
    warnings.push("missing_source");
  } else {
    requiredDisclosure.push("source");
  }
  if (!evidence.jurisdiction) {
    warnings.push("missing_jurisdiction");
  } else {
    requiredDisclosure.push("jurisdiction");
  }
  if (!evidence.sourceDate && !evidence.retrievedAt) {
    warnings.push("missing_source_or_retrieved_date");
  } else {
    requiredDisclosure.push("source_date");
  }
  if (!evidence.reviewStatus) {
    warnings.push("missing_review_status");
  } else {
    requiredDisclosure.push("review_status");
  }
  if (evidence.reviewStatus && evidence.reviewStatus !== "approved") {
    warnings.push("not_approved");
  }
  if (evidence.trustTier === "secondary" || evidence.legalStatus === "commentary_only") {
    warnings.push("secondary_commentary_only");
  }

  return {
    allowed:
      warnings.length === 0 ||
      warnings.every((warning) => warning === "not_approved"),
    warnings,
    requiredDisclosure,
  };
}

export function evaluateLegalAnswerGrounding(
  input: LegalWatchAnswerGroundingInput,
): LegalWatchAnswerGroundingDecision {
  const warnings = input.evidence.flatMap((item) => evaluateLegalWatchAnswerGrounding(item).warnings);
  const requiredDisclosure = input.evidence.flatMap(
    (item) => evaluateLegalWatchAnswerGrounding(item).requiredDisclosure,
  );

  if (input.evidence.length === 0) warnings.push("missing_source");
  if (input.evidence.length > 0 && !input.evidence.some(sourceIsPrimaryOrOfficial)) {
    warnings.push("secondary_commentary_only");
  }
  if (input.evidence.length > 0 && !input.evidence.every(sourceHasDate)) {
    warnings.push("missing_source_or_retrieved_date");
  }
  if (input.evidence.length > 0 && !input.evidence.every(sourceIsApproved)) {
    warnings.push("not_approved");
  }
  if (
    input.evidence.length > 0 &&
    !input.evidence.every(
      (item) => typeof item.confidenceScore === "number" || item.legalStatus === "unclear",
    )
  ) {
    warnings.push("missing_confidence");
  }
  if (input.evidence.length > 0 && !input.evidence.some((item) => item.fromApprovedCompanyDb)) {
    warnings.push("not_approved_company_db");
  }
  if (input.intent === "definitive_legal_advice") {
    warnings.push("definitive_legal_advice");
  }

  const reasons = unique(warnings);
  const status = reasons.includes("missing_source") || reasons.includes("definitive_legal_advice")
    ? "refuse"
    : reasons.length > 0
      ? "caveat_required"
      : "grounded";

  return {
    status,
    approvedForAnswer: status !== "refuse",
    reasons,
    requiredDisclosure: unique(requiredDisclosure),
    caveats: reasons.map(caveatFor),
  };
}

export const LEGAL_WATCH_ASSISTANT_POLICY = [
  "For BKPM Legal Watch answers, use approved Company-DB legal/watch content first.",
  "State source, jurisdiction, source/retrieved date, review status, and confidence or uncertainty.",
  "Do not present unreviewed observations as legal advice.",
  "Secondary commentary can support interpretation only after primary or official source confirmation.",
  "When local counsel, notary, or BKPM confirmation is required, say so explicitly.",
].join("\n");
