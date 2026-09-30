import type { DocumentClassification } from "@/lib/document-parsers/document-classification";

export interface IngestRoutingFlags {
  classifierEnabled: boolean;
  routerSplitEnabled: boolean;
  nonFinancialWriterEnabled: boolean;
  ingressAssistNonFinancialEnabled: boolean;
  ingressAutoRouteLowRiskEnabled: boolean;
  ingressBudgetGuardEnabled: boolean;
}

const HIGH_RISK_NON_FINANCIAL_DOMAINS = new Set([
  "legal",
  "tax",
  "governance",
]);

const LOW_RISK_NON_FINANCIAL_DOMAINS = new Set([
  "documents",
  "strategy",
  "operations",
  "assets",
]);

function primaryDomain(classification: DocumentClassification): string {
  return classification.candidate_domains[0] ?? "documents";
}

function isHighRiskNonFinancialDomain(classification: DocumentClassification): boolean {
  return HIGH_RISK_NON_FINANCIAL_DOMAINS.has(primaryDomain(classification));
}

function isLowRiskNonFinancialDomain(classification: DocumentClassification): boolean {
  return LOW_RISK_NON_FINANCIAL_DOMAINS.has(primaryDomain(classification));
}

function parseCompanyIdSet(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

/**
 * If canary list is provided, enable the flag only for listed companies.
 * If no list is provided, the global flag value is used as-is.
 */
export function resolveFlagForCompany(
  globallyEnabled: boolean,
  companyId: string,
  canaryCompanyIdsRaw?: string,
): boolean {
  if (!globallyEnabled) return false;
  const canarySet = parseCompanyIdSet(canaryCompanyIdsRaw);
  if (canarySet.size === 0) return true;
  return canarySet.has(companyId);
}

export function fallbackFinancialClassification(): DocumentClassification {
  return {
    document_kind: "financial",
    candidate_domains: ["finance", "documents"],
    confidence: 0.5,
    routing_reason: "classifier_disabled",
  };
}

export function shouldRunFinancialParser(
  flags: IngestRoutingFlags,
  classification: DocumentClassification,
): boolean {
  if (!flags.routerSplitEnabled) return true;
  return classification.document_kind === "financial";
}

export function shouldStageDocumentEvidence(
  flags: IngestRoutingFlags,
): boolean {
  if (!flags.routerSplitEnabled) return false;
  if (!flags.nonFinancialWriterEnabled) return false;
  return true;
}

export function shouldStageNonFinancial(
  flags: IngestRoutingFlags,
  classification: DocumentClassification,
): boolean {
  if (!flags.routerSplitEnabled) return false;
  if (!flags.nonFinancialWriterEnabled) return false;
  if (!flags.ingressAssistNonFinancialEnabled) return false;
  if (classification.document_kind !== "non_financial") return false;
  if (classification.confidence < 0.7) return false;

  // Phase 1 compatibility: with autoroute-low-risk disabled, keep current assist behavior.
  if (!flags.ingressAutoRouteLowRiskEnabled) return true;

  if (isHighRiskNonFinancialDomain(classification)) return false;
  return isLowRiskNonFinancialDomain(classification);
}

export function resolveNeedsReview(
  flags: IngestRoutingFlags,
  classification: DocumentClassification,
  parserNeedsReview: boolean,
): boolean {
  if (parserNeedsReview) return true;
  if (!flags.routerSplitEnabled) return false;
  if (classification.document_kind === "unclassified") return true;
  if (classification.document_kind === "non_financial") {
    if (!flags.ingressAssistNonFinancialEnabled) return true;
    if (classification.confidence < 0.7) return true;
    if (!flags.ingressAutoRouteLowRiskEnabled) return false;
    if (isHighRiskNonFinancialDomain(classification)) return true;
    if (!isLowRiskNonFinancialDomain(classification)) return true;
  }
  return false;
}
