export const ADVISOR_DOMAIN_ORDER = [
  "finance",
  "banking",
  "revenue",
  "expenses",
  "legal",
  "tax",
  "governance",
  "strategy",
  "operations",
  "communications",
  "assets",
  "knowledge",
  "documents",
] as const;

export type AdvisorDomain = (typeof ADVISOR_DOMAIN_ORDER)[number];

export interface AdvisorSourceEntity {
  qualifiedId: string;
  type: string;
  domain: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
  title?: string | null;
  status?: string | null;
}

export interface AdvisorRecordSummary {
  id: string;
  domain: string;
  type: string;
  filePath: string;
  title: string | null;
  status: string | null;
  periodLabel: string | null;
  currency: string | null;
  documentKind: string | null;
  confidence: string | null;
  requiresReview: boolean;
  reviewFlags: string[];
  counterparties: string[];
  highlights: string[];
  risks: string[];
  quality: "verified" | "mixed" | "review_required";
  managerialSummary: string;
}

const LOW_SIGNAL_TYPES = new Set([
  "document_import_unit",
  "document_import_manifest",
  "manifest",
  "communication_thread_context",
]);

const LOW_SIGNAL_PATH_MARKERS = [
  "/_index.qmd",
  "/manifest.qmd",
  "/units/",
];

const DOMAIN_LABELS: Record<string, string> = {
  finance: "Finance",
  banking: "Banking",
  revenue: "Revenue",
  expenses: "Expenses",
  legal: "Legal",
  tax: "Tax",
  governance: "Governance",
  strategy: "Strategy",
  operations: "Operations",
  communications: "Communications",
  assets: "Assets",
  knowledge: "Knowledge",
  documents: "Documents",
};

const LEGAL_AGREEMENT_KEYWORDS = [
  "agreement",
  "contract",
  "term sheet",
  "termsheet",
  "addendum",
  "amendment",
  "lease",
  "loan",
  "cooperation",
  "commercial agreement",
  "service agreement",
];

const LEGAL_LICENSE_KEYWORDS = [
  "license",
  "permit",
  "nib",
  "kbli",
  "izin",
  "oss",
  "certificate",
  "sertifikat",
];

const LEGAL_CORPORATE_KEYWORDS = [
  "ahu",
  "akta",
  "incorporation",
  "establishment",
  "notary",
  "filing",
  "regulatory",
  "shareholder",
  "decree",
  "approval",
];

const LEGAL_PROPERTY_SUPPORT_KEYWORDS = [
  "zoning",
  "parcel",
  "land zoning",
  "land parcel",
  "site plan",
  "drawing",
  "layout",
];

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringList(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);
}

const READABLE_PDF_FALSE_NEGATIVE_FLAGS = new Set([
  "extraction_failed",
  "artifact_extraction_failed",
  "extractor_failed",
  "manual_text_recovery",
  "manual_pdf_review_needed",
  "ocr_failed",
  "ocr_extraction_failed",
  "image_only_pdf",
  "ocr_like_text_recovery",
  "sparse_artifacts",
  "sparse_generated_artifacts",
]);

function isPdfLikeAdvisorRecord(frontmatter: Record<string, unknown>): boolean {
  const fileType = toText(frontmatter.file_type)?.toLowerCase();
  if (fileType === "pdf" || fileType === "application/pdf") return true;

  const sourceFileName = toText(frontmatter.source_file_name)?.toLowerCase();
  if (sourceFileName?.endsWith(".pdf")) return true;

  return false;
}

function hasRecoveredLegalPdfSignal(frontmatter: Record<string, unknown>, domain: string): boolean {
  if (domain !== "legal") return false;
  if (!isPdfLikeAdvisorRecord(frontmatter)) return false;

  const documentKind = toText(frontmatter.document_kind)?.toLowerCase() ?? "";
  const targetEntityType = toText(frontmatter.target_entity_type)?.toLowerCase() ?? "";
  const confidence =
    toText(frontmatter.overall_confidence)?.toLowerCase() ??
    toText(frontmatter.routing_confidence)?.toLowerCase() ??
    "";

  if (
    documentKind !== "legal_document" &&
    documentKind !== "license_document" &&
    !targetEntityType.includes("license") &&
    !targetEntityType.includes("permit") &&
    !targetEntityType.includes("registration") &&
    !targetEntityType.includes("agreement") &&
    !targetEntityType.includes("contract")
  ) {
    return false;
  }

  const topFindingCount = Array.isArray(frontmatter.topline_findings)
    ? frontmatter.topline_findings.length
    : 0;
  const keyThemeCount = normalizeStringList(frontmatter.key_themes, 6).length;
  const companyCount = normalizeStringList(frontmatter.company_names_detected, 6).length;
  const hasStructuredIdentity =
    companyCount > 0 ||
    Boolean(toText(frontmatter.period_label)) ||
    Boolean(toText(frontmatter.period_start) && toText(frontmatter.period_end));

  if (confidence === "low") return false;
  return topFindingCount >= 2 || keyThemeCount >= 2 || hasStructuredIdentity;
}

export function normalizeAdvisorReviewState(input: {
  domain: string;
  frontmatter: Record<string, unknown>;
}): {
  requiresReview: boolean;
  reviewFlags: string[];
} {
  const { domain, frontmatter } = input;
  const rawReviewFlags = normalizeStringList(frontmatter.review_flags, 12);
  const shouldClearReadablePdfNoise = hasRecoveredLegalPdfSignal(frontmatter, domain);
  const reviewFlags = shouldClearReadablePdfNoise
    ? rawReviewFlags.filter((flag) => !READABLE_PDF_FALSE_NEGATIVE_FLAGS.has(flag))
    : rawReviewFlags;

  const confidence =
    toText(frontmatter.overall_confidence)?.toLowerCase() ??
    toText(frontmatter.routing_confidence)?.toLowerCase() ??
    "";

  const requiresReview =
    frontmatter.requires_review === true &&
    !(shouldClearReadablePdfNoise && reviewFlags.length === 0 && confidence !== "low");

  return {
    requiresReview,
    reviewFlags,
  };
}

function matchesKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function getRecordCorpus(record: AdvisorSourceEntity): string {
  const frontmatter = record.frontmatter ?? {};
  const normalizedReviewState = normalizeAdvisorReviewState({
    domain: record.domain,
    frontmatter,
  });
  return [
    record.title,
    record.type,
    toText(frontmatter.document_kind),
    toText(frontmatter.target_entity_type),
    toText(frontmatter.subtype),
    ...normalizeStringList(frontmatter.key_themes, 6),
    ...normalizedReviewState.reviewFlags.slice(0, 6),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

function extractToplineFindings(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.topline_findings;
  if (Array.isArray(raw)) {
    const findings = raw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const label = toText((item as Record<string, unknown>).label);
        const value = toText((item as Record<string, unknown>).value);
        if (label && value) return `${label}: ${value}`;
        return value ?? label;
      })
      .filter((item): item is string => Boolean(item));
    if (findings.length > 0) return findings.slice(0, 4);
  }

  const keyFigures = normalizeStringList(frontmatter.key_figures, 4);
  if (keyFigures.length > 0) return keyFigures;

  return normalizeStringList(frontmatter.key_themes, 3);
}

function extractRisks(frontmatter: Record<string, unknown>): string[] {
  const textualRisks = normalizeStringList(frontmatter.risks, 4);
  const rawAnomalies = frontmatter.anomalies;

  const anomalyRisks = Array.isArray(rawAnomalies)
    ? rawAnomalies
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const issue = toText((item as Record<string, unknown>).issue);
          const severity = toText((item as Record<string, unknown>).severity);
          if (!issue) return null;
          return severity ? `${issue} (${severity})` : issue;
        })
        .filter((item): item is string => Boolean(item))
        .slice(0, 3)
    : [];

  return [...textualRisks, ...anomalyRisks].slice(0, 4);
}

function extractCounterparties(frontmatter: Record<string, unknown>): string[] {
  return normalizeStringList(frontmatter.company_names_detected, 3);
}

function deriveQuality(frontmatter: Record<string, unknown>): AdvisorRecordSummary["quality"] {
  const domain = toText(frontmatter.domain)?.toLowerCase() ?? "documents";
  const normalizedReviewState = normalizeAdvisorReviewState({
    domain,
    frontmatter,
  });
  const requiresReview = normalizedReviewState.requiresReview;
  const reviewFlags = normalizedReviewState.reviewFlags;

  if (
    requiresReview ||
    reviewFlags.includes("extraction_failed") ||
    reviewFlags.includes("manual_legal_review") ||
    reviewFlags.includes("manual_routing_check")
  ) {
    return "review_required";
  }

  const confidence = toText(frontmatter.overall_confidence) ?? toText(frontmatter.routing_confidence);
  if (confidence === "high") return "verified";
  return "mixed";
}

function getPeriodLabel(frontmatter: Record<string, unknown>): string | null {
  return (
    toText(frontmatter.period_label) ??
    toText(frontmatter.reporting_period_key) ??
    toText(frontmatter.period_key) ??
    toText(frontmatter.period_end) ??
    toText(frontmatter.period_start)
  );
}

function getDocumentKind(frontmatter: Record<string, unknown>): string | null {
  return (
    toText(frontmatter.document_kind) ??
    toText(frontmatter.target_entity_type) ??
    toText(frontmatter.subtype) ??
    toText(frontmatter.report_type)
  );
}

function buildManagerialSummary(input: {
  documentKind: string | null;
  periodLabel: string | null;
  highlights: string[];
  risks: string[];
  quality: AdvisorRecordSummary["quality"];
  evidenceStatus?: string | null;
}): string {
  const parts: string[] = [];

  if (input.documentKind) parts.push(input.documentKind);
  if (input.periodLabel) parts.push(`period ${input.periodLabel}`);
  if (input.highlights.length > 0) parts.push(input.highlights[0]!);
  if (input.risks.length > 0) parts.push(`risk: ${input.risks[0]}`);
  if (input.evidenceStatus === "captured") parts.push("evidence captured");
  if (input.quality === "review_required") parts.push("manual review required");

  return parts.join(" | ");
}

function getLegalSignalScore(record: AdvisorSourceEntity): number {
  const frontmatter = record.frontmatter ?? {};
  const corpus = getRecordCorpus(record);
  const documentKind = toText(frontmatter.document_kind)?.toLowerCase() ?? "";
  const targetEntityType = toText(frontmatter.target_entity_type)?.toLowerCase() ?? "";
  const reviewFlags = normalizeAdvisorReviewState({
    domain: record.domain,
    frontmatter,
  }).reviewFlags;
  const counterparties = extractCounterparties(frontmatter);

  let score = 0;

  if (
    record.type.includes("contract") ||
    record.type.includes("agreement") ||
    matchesKeyword(corpus, LEGAL_AGREEMENT_KEYWORDS)
  ) {
    score += 120;
  }

  if (
    documentKind === "license_document" ||
    matchesKeyword(corpus, LEGAL_LICENSE_KEYWORDS)
  ) {
    score += 110;
  }

  if (
    targetEntityType.includes("incorporation") ||
    targetEntityType.includes("corporate") ||
    matchesKeyword(corpus, LEGAL_CORPORATE_KEYWORDS)
  ) {
    score += 100;
  }

  if (counterparties.length > 0) {
    score += 12 + counterparties.length * 6;
  }

  if (documentKind === "operational_document") score -= 45;
  if (targetEntityType === "land_parcel") score -= 55;
  if (matchesKeyword(corpus, LEGAL_PROPERTY_SUPPORT_KEYWORDS)) score -= 60;
  if (reviewFlags.includes("domain_ambiguity")) score -= 50;

  return score;
}

function getSignalScore(record: AdvisorSourceEntity): number {
  let score = 0;

  if (record.filePath.endsWith("/_summary.qmd")) score -= 100;
  if (LOW_SIGNAL_PATH_MARKERS.some((marker) => record.filePath.includes(marker))) score -= 45;
  if (LOW_SIGNAL_TYPES.has(record.type)) score -= 35;
  if (record.type === "document_import") score += 70;
  if (record.type === "knowledge-doc") score += 75;
  if (record.type === "financial_snapshot") score += 20;
  if (record.type === "communication_signal") score += 78;
  if (record.type === "communication_daily_log") score += 34;
  if (record.type.includes("contract")) score += 85;
  if (record.type.includes("agreement")) score += 85;
  if (record.title) score += 10;

  const highlights = extractToplineFindings(record.frontmatter);
  const risks = extractRisks(record.frontmatter);
  score += highlights.length * 10;
  score += Math.min(risks.length, 2) * 5;

  if (record.frontmatter.requires_review === true) score -= 5;
  if (record.domain === "legal") score += getLegalSignalScore(record);

  return score;
}

export function getAdvisorDomainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] ?? domain;
}

export function isDecisionGradeAdvisorEntity(record: AdvisorSourceEntity): boolean {
  if (record.filePath.endsWith("/_summary.qmd")) return false;
  if (LOW_SIGNAL_TYPES.has(record.type)) return false;
  if (LOW_SIGNAL_PATH_MARKERS.some((marker) => record.filePath.includes(marker))) return false;
  return true;
}

export function filterDecisionGradeAdvisorEntities<T extends AdvisorSourceEntity>(
  records: T[],
): T[] {
  return records.filter((record) => isDecisionGradeAdvisorEntity(record));
}

export function summarizeAdvisorEntity(record: AdvisorSourceEntity): AdvisorRecordSummary {
  const periodLabel = getPeriodLabel(record.frontmatter);
  const currency =
    toText(record.frontmatter.currency) ??
    toText(record.frontmatter.reporting_currency);
  const documentKind = getDocumentKind(record.frontmatter);
  const confidence =
    toText(record.frontmatter.overall_confidence) ??
    toText(record.frontmatter.routing_confidence) ??
    toText(record.frontmatter.confidence);
  const normalizedReviewState = normalizeAdvisorReviewState({
    domain: record.domain,
    frontmatter: record.frontmatter,
  });
  const reviewFlags = normalizedReviewState.reviewFlags.slice(0, 6);
  const highlights = extractToplineFindings(record.frontmatter);
  const risks = extractRisks(record.frontmatter);
  const counterparties = extractCounterparties(record.frontmatter);
  const quality = deriveQuality({
    ...record.frontmatter,
    domain: record.domain,
  });
  const evidenceStatus = toText(record.frontmatter.evidence_status);

  return {
    id: record.qualifiedId,
    domain: record.domain,
    type: record.type,
    filePath: record.filePath,
    title: record.title ?? null,
    status: record.status ?? null,
    periodLabel,
    currency,
    documentKind,
    confidence,
    requiresReview: normalizedReviewState.requiresReview,
    reviewFlags,
    counterparties,
    highlights,
    risks,
    quality,
    managerialSummary: buildManagerialSummary({
      documentKind,
      periodLabel,
      highlights,
      risks,
      quality,
      evidenceStatus,
    }),
  };
}

export function selectAdvisorEntities(
  records: AdvisorSourceEntity[],
  limit = 3,
): AdvisorRecordSummary[] {
  return [...records]
    .sort((left, right) => getSignalScore(right) - getSignalScore(left))
    .slice(0, Math.max(limit, 0))
    .map((record) => summarizeAdvisorEntity(record));
}
