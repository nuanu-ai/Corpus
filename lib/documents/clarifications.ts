import type { CodexDocumentKind, CodexNormalizedMetadata, CodexTargetDomain } from "@/lib/codex-worker/types";
import { normalizeOcrResult } from "@/lib/codex-worker/ocr-result";
import type { CodexSourceContext } from "@/lib/codex-worker/source-context";
import type { CanonicalFinanceClarificationKey } from "@/lib/document-parsers/canonical-finance-types";

export type ClarificationQuestionKey =
  | "currency"
  | "entity"
  | "book"
  | "report_type"
  | "target_domain"
  | "period_label"
  | CanonicalFinanceClarificationKey;

export interface CodexReviewSummary {
  documentKind: string | null;
  targetDomain: string | null;
  requiresReview: boolean;
  reviewFlags: string[];
  overallConfidence: string | null;
  normalizedMetadata: Partial<CodexNormalizedMetadata>;
  ingestionMode: string | null;
  ingestionReason: string | null;
}

export interface DocumentClarificationQuestion {
  key: ClarificationQuestionKey;
  label: string;
  prompt: string;
  type: "text" | "select";
  required: boolean;
  templateEligible: boolean;
  options?: string[];
  currentValue?: string | null;
}

export interface DocumentClarificationState {
  answers: Partial<Record<ClarificationQuestionKey, string>>;
  answeredAt?: string | null;
  answeredBy?: string | null;
}

export type ClarificationAnswerMap =
  Partial<Record<ClarificationQuestionKey, string>>;

export interface ClarificationReuseScope {
  provider: string | null;
  sourceFolder: string;
  documentKind: string | null;
  reportType: string | null;
  targetDomain: string | null;
}

export interface CanonicalFinanceClarificationQuestionState {
  key: CanonicalFinanceClarificationKey;
  family: string;
  label: string;
  prompt: string;
  reason: string;
  required: boolean;
  templateEligible: boolean;
  options: string[];
}

export interface CanonicalFinanceClarificationState {
  recordCount: number;
  families: string[];
  warnings: string[];
  questions: CanonicalFinanceClarificationQuestionState[];
}

export interface PromptTemplateHint {
  provider: string | null;
  sourceFolder: string | null;
  documentKind: string | null;
  reportType: string | null;
  answers: Partial<Record<ClarificationQuestionKey, string>>;
  createdAt?: string | null;
  updatedAt?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLabel(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => item !== null);
}

const PERIOD_FLAGS = new Set([
  "inferred_period_start",
  "period_start_inferred",
  "manual_period_mapping_needed",
  "unknown_period",
]);

const DOMAIN_FLAGS = new Set([
  "domain_ambiguity",
]);

const ACCOUNTING_DOCUMENT_KINDS = new Set([
  "financial_report",
  "general_ledger",
  "trial_balance",
  "bank_statement",
  "payroll",
]);

const ACCOUNTING_REPORT_TYPES = new Set([
  "balance_sheet",
  "profit_and_loss",
  "cash_flow",
  "general_ledger",
  "trial_balance",
  "bank_reconciliation",
  "budget_vs_actual",
]);

const LEGALISH_DOMAINS = new Set([
  "legal",
  "governance",
]);

const REUSABLE_QUESTION_KEYS = new Set<ClarificationQuestionKey>([
  "currency",
  "entity",
  "book",
  "report_type",
  "pnl_sheet_name",
  "balance_sheet_sheet_name",
  "cash_flow_sheet_name",
  "projection_sheet_name",
  "metrics_sheet_name",
]);

const CANONICAL_FINANCE_QUESTION_KEYS = new Set<CanonicalFinanceClarificationKey>([
  "pnl_sheet_name",
  "balance_sheet_sheet_name",
  "cash_flow_sheet_name",
  "projection_sheet_name",
  "metrics_sheet_name",
]);

export function normalizeClarificationAnswers(
  value: unknown,
): ClarificationAnswerMap {
  if (!isRecord(value)) return {};
  const next: Partial<Record<ClarificationQuestionKey, string>> = {};
  for (const key of [
    "currency",
    "entity",
    "book",
    "report_type",
    "target_domain",
    "period_label",
    "pnl_sheet_name",
    "balance_sheet_sheet_name",
    "cash_flow_sheet_name",
    "projection_sheet_name",
    "metrics_sheet_name",
  ] as const) {
    const normalized = normalizeString(value[key]);
    if (normalized) {
      next[key] = normalized;
    }
  }
  return next;
}

function normalizeCanonicalFinanceQuestion(
  value: unknown,
): CanonicalFinanceClarificationQuestionState | null {
  if (!isRecord(value)) return null;
  const key = normalizeString(value.key);
  if (!key || !CANONICAL_FINANCE_QUESTION_KEYS.has(key as CanonicalFinanceClarificationKey)) {
    return null;
  }

  const options = normalizeStringArray(value.options);
  if (options.length === 0) return null;

  return {
    key: key as CanonicalFinanceClarificationKey,
    family: normalizeString(value.family) ?? "unknown",
    label: normalizeString(value.label) ?? key,
    prompt: normalizeString(value.prompt) ?? key,
    reason: normalizeString(value.reason) ?? "canonical_finance_clarification_needed",
    required: value.required !== false,
    templateEligible: value.template_eligible !== false,
    options,
  };
}

export function getCanonicalFinanceClarificationState(
  ocrResult: unknown,
): CanonicalFinanceClarificationState | null {
  const normalized = normalizeOcrResult(ocrResult);
  if (!normalized) return null;

  const raw = normalized.canonical_finance;
  if (!isRecord(raw)) return null;

  const questions = Array.isArray(raw.clarification_questions)
    ? raw.clarification_questions
      .map((question) => normalizeCanonicalFinanceQuestion(question))
      .filter((question): question is CanonicalFinanceClarificationQuestionState => question !== null)
    : [];

  if (questions.length === 0) return null;

  const recordCountRaw = raw.record_count;
  return {
    recordCount:
      typeof recordCountRaw === "number" && Number.isFinite(recordCountRaw) ? recordCountRaw : 0,
    families: normalizeStringArray(raw.families),
    warnings: normalizeStringArray(raw.warnings),
    questions,
  };
}

export function getDocumentClarificationState(
  ocrResult: unknown,
): DocumentClarificationState {
  const normalized = normalizeOcrResult(ocrResult);
  if (!normalized) return { answers: {} };

  const raw = normalized.clarification;
  if (!isRecord(raw)) return { answers: {} };

  return {
    answers: normalizeClarificationAnswers(raw.answers),
    answeredAt: normalizeString(raw.answered_at),
    answeredBy: normalizeString(raw.answered_by),
  };
}

export function mergeDocumentClarificationState(
  ocrResult: unknown,
  input: {
    answers: ClarificationAnswerMap;
    answeredAt?: string | null;
    answeredBy?: string | null;
  },
): Record<string, unknown> {
  const normalized = normalizeOcrResult(ocrResult) ?? {};
  const current = getDocumentClarificationState(ocrResult);
  const answers = {
    ...current.answers,
    ...normalizeClarificationAnswers(input.answers),
  };

  return {
    ...normalized,
    clarification: {
      answers,
      answered_at: input.answeredAt ?? current.answeredAt ?? null,
      answered_by: input.answeredBy ?? current.answeredBy ?? null,
    },
  };
}

export function getCodexReviewSummary(
  ocrResult: unknown,
): CodexReviewSummary | null {
  const normalized = normalizeOcrResult(ocrResult);
  if (!normalized) return null;

  const raw = normalized.codex_review;
  if (!isRecord(raw)) return null;

  const metadata = isRecord(raw.normalized_metadata)
    ? raw.normalized_metadata
    : {};

  return {
    documentKind: normalizeString(raw.document_kind),
    targetDomain: normalizeString(raw.target_domain),
    requiresReview: raw.requires_review === true,
    reviewFlags: normalizeStringArray(raw.review_flags),
    overallConfidence: normalizeString(raw.overall_confidence),
    normalizedMetadata: {
      report_type: normalizeString(metadata.report_type),
      book: normalizeString(metadata.book),
      currency: normalizeString(metadata.currency),
      entity: normalizeString(metadata.entity),
      sheet_name: normalizeString(metadata.sheet_name),
      period_start: normalizeString(metadata.period_start),
      period_end: normalizeString(metadata.period_end),
      period_label: normalizeString(metadata.period_label),
      company_names_detected: normalizeStringArray(metadata.company_names_detected),
      source_language: normalizeString(metadata.source_language),
    },
    ingestionMode: normalizeString(raw.ingestion_mode),
    ingestionReason: normalizeString(raw.ingestion_reason),
  };
}

export function mergeCodexReviewSummary(
  ocrResult: unknown,
  input: {
    documentKind: CodexDocumentKind;
    targetDomain: CodexTargetDomain;
    rawTargetDomain?: CodexTargetDomain;
    requiresReview: boolean;
    reviewFlags: string[];
    overallConfidence: string;
    normalizedMetadata: CodexNormalizedMetadata;
    ingestionMode: string;
    ingestionReason: string;
  },
): Record<string, unknown> {
  const normalized = normalizeOcrResult(ocrResult) ?? {};
  return {
    ...normalized,
    codex_review: {
      document_kind: input.documentKind,
      target_domain: input.targetDomain,
      raw_target_domain: input.rawTargetDomain ?? null,
      requires_review: input.requiresReview,
      review_flags: input.reviewFlags,
      overall_confidence: input.overallConfidence,
      normalized_metadata: input.normalizedMetadata,
      ingestion_mode: input.ingestionMode,
      ingestion_reason: input.ingestionReason,
    },
  };
}

function needsCurrencyQuestion(review: CodexReviewSummary): boolean {
  if (!supportsCurrencyClarification(review)) return false;
  return review.normalizedMetadata.currency == null;
}

function needsEntityQuestion(review: CodexReviewSummary): boolean {
  if (review.normalizedMetadata.entity != null) return false;
  return (
    isAccountingDocument(review) ||
    isLegalEntityClarificationCandidate(review) ||
    isAssetEntityClarificationCandidate(review)
  );
}

function needsBookQuestion(review: CodexReviewSummary): boolean {
  if (!supportsBookClarification(review)) return false;
  const book = review.normalizedMetadata.book;
  return book == null || book === "unknown";
}

function needsReportTypeQuestion(review: CodexReviewSummary): boolean {
  if (!isAccountingDocument(review)) return false;
  const reportType = review.normalizedMetadata.report_type;
  return reportType == null;
}

function needsDomainQuestion(review: CodexReviewSummary): boolean {
  return (
    review.reviewFlags.some((flag) => DOMAIN_FLAGS.has(flag)) &&
    (review.targetDomain == null || review.targetDomain === "documents" || review.targetDomain === "knowledge")
  );
}

function needsPeriodQuestion(review: CodexReviewSummary): boolean {
  if (!supportsPeriodClarification(review)) return false;
  return (
    review.normalizedMetadata.period_label == null ||
    review.reviewFlags.some((flag) => PERIOD_FLAGS.has(flag))
  );
}

function isAccountingDocument(review: CodexReviewSummary): boolean {
  const kind = review.documentKind ?? "";
  if (ACCOUNTING_DOCUMENT_KINDS.has(kind)) return true;
  if (review.normalizedMetadata.report_type && ACCOUNTING_REPORT_TYPES.has(review.normalizedMetadata.report_type)) {
    return true;
  }
  return review.targetDomain === "finance" && kind !== "legal_document" && kind !== "tax_document";
}

function isLegalEntityClarificationCandidate(review: CodexReviewSummary): boolean {
  return LEGALISH_DOMAINS.has(review.targetDomain ?? "") ||
    review.documentKind === "legal_document" ||
    review.documentKind === "license_document";
}

function isAssetEntityClarificationCandidate(review: CodexReviewSummary): boolean {
  return review.targetDomain === "assets" && review.documentKind === "operational_document";
}

function supportsCurrencyClarification(review: CodexReviewSummary): boolean {
  return isAccountingDocument(review) || review.targetDomain === "assets";
}

function supportsBookClarification(review: CodexReviewSummary): boolean {
  return isAccountingDocument(review);
}

function supportsPeriodClarification(review: CodexReviewSummary): boolean {
  return isAccountingDocument(review);
}

export function buildPendingDocumentClarificationQuestions(input: {
  review: CodexReviewSummary | null;
  answers?: ClarificationAnswerMap;
  canonicalFinance?: CanonicalFinanceClarificationState | null;
}): DocumentClarificationQuestion[] {
  const answers = normalizeClarificationAnswers(input.answers);
  return buildDocumentClarificationQuestions({
    review: input.review,
    answers,
    canonicalFinance: input.canonicalFinance,
  }).filter((question) => {
    const answer = normalizeString(answers[question.key]);
    if (!answer) return true;
    if (question.type !== "select" || !question.options || question.options.length === 0) {
      return false;
    }
    const normalizedAnswer = normalizeLabel(answer);
    return !question.options.some((option) => normalizeLabel(option) === normalizedAnswer);
  });
}

export function buildDocumentClarificationQuestions(input: {
  review: CodexReviewSummary | null;
  answers?: Partial<Record<ClarificationQuestionKey, string>>;
  canonicalFinance?: CanonicalFinanceClarificationState | null;
}): DocumentClarificationQuestion[] {
  const answers = normalizeClarificationAnswers(input.answers);
  const questions: DocumentClarificationQuestion[] = [];
  const canonicalFinance = input.canonicalFinance;

  for (const question of canonicalFinance?.questions ?? []) {
    questions.push({
      key: question.key,
      label: question.label,
      prompt: question.prompt,
      type: "select",
      required: question.required,
      templateEligible: question.templateEligible,
      options: question.options,
      currentValue: answers[question.key] ?? null,
    });
  }

  if (!input.review) return questions;

  const review = input.review;

  if (needsCurrencyQuestion(review)) {
    questions.push({
      key: "currency",
      label: "Statement currency",
      prompt: "What currency should we use for this document?",
      type: "text",
      required: true,
      templateEligible: true,
      currentValue: answers.currency ?? review.normalizedMetadata.currency ?? null,
    });
  }

  if (needsEntityQuestion(review)) {
    questions.push({
      key: "entity",
      label: "Legal entity or business unit",
      prompt: "Which company or business unit does this document belong to?",
      type: "text",
      required: true,
      templateEligible: true,
      currentValue: answers.entity ?? review.normalizedMetadata.entity ?? null,
    });
  }

  if (needsBookQuestion(review)) {
    questions.push({
      key: "book",
      label: "Book type",
      prompt: "Are these numbers actuals, budget, or forecast?",
      type: "select",
      required: true,
      templateEligible: true,
      options: ["actual", "budget", "forecast"],
      currentValue: answers.book ?? review.normalizedMetadata.book ?? null,
    });
  }

  if (needsReportTypeQuestion(review)) {
    questions.push({
      key: "report_type",
      label: "Report type",
      prompt: "What kind of finance document is this?",
      type: "select",
      required: true,
      templateEligible: true,
      options: [
        "balance_sheet",
        "profit_and_loss",
        "cash_flow",
        "general_ledger",
        "trial_balance",
        "bank_reconciliation",
        "budget_vs_actual",
        "other",
      ],
      currentValue: answers.report_type ?? review.normalizedMetadata.report_type ?? null,
    });
  }

  if (needsDomainQuestion(review)) {
    questions.push({
      key: "target_domain",
      label: "Storage domain",
      prompt: "Where should this document live in Company-DB?",
      type: "select",
      required: true,
      templateEligible: true,
      options: [
        "finance",
        "legal",
        "tax",
        "governance",
        "operations",
        "assets",
        "knowledge",
        "documents",
      ],
      currentValue: answers.target_domain ?? review.targetDomain ?? null,
    });
  }

  if (needsPeriodQuestion(review)) {
    questions.push({
      key: "period_label",
      label: "Reporting period",
      prompt: "What reporting period does this document cover? Use a concrete label like 'Jul 2025' or '2025-07-01 to 2025-07-31'.",
      type: "text",
      required: true,
      templateEligible: false,
      currentValue: answers.period_label ?? review.normalizedMetadata.period_label ?? null,
    });
  }

  return questions;
}

export function countPendingClarificationQuestions(
  ocrResult: unknown,
  options?: {
    review?: CodexReviewSummary | null;
    answers?: ClarificationAnswerMap;
    canonicalFinance?: CanonicalFinanceClarificationState | null;
  },
): number {
  const review = options?.review === undefined
    ? getCodexReviewSummary(ocrResult)
    : options.review;
  const canonicalFinance = options?.canonicalFinance === undefined
    ? getCanonicalFinanceClarificationState(ocrResult)
    : options.canonicalFinance;
  const clarification = getDocumentClarificationState(ocrResult);
  return buildPendingDocumentClarificationQuestions({
    review,
    canonicalFinance,
    answers: {
      ...normalizeClarificationAnswers(options?.answers),
      ...clarification.answers,
    },
  }).length;
}

export function sourceFolderFromContext(
  sourceContext: CodexSourceContext | null | undefined,
): string | null {
  const sourcePath = normalizeString(sourceContext?.sourcePath);
  if (!sourcePath) return null;
  const parts = sourcePath.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join(" / ");
}

export function isReusableClarificationQuestionKey(
  key: ClarificationQuestionKey,
): boolean {
  return REUSABLE_QUESTION_KEYS.has(key);
}

export function getClarificationReuseScope(input: {
  review: CodexReviewSummary | null;
  sourceContext: CodexSourceContext | null | undefined;
}): ClarificationReuseScope | null {
  if (!input.review) return null;
  const sourceFolder = sourceFolderFromContext(input.sourceContext);
  if (!sourceFolder) return null;

  return {
    provider: normalizeString(input.sourceContext?.provider),
    sourceFolder,
    documentKind: normalizeString(input.review.documentKind),
    reportType: normalizeString(input.review.normalizedMetadata.report_type),
    targetDomain: normalizeString(input.review.targetDomain),
  };
}

export function matchesClarificationReuseScope(
  input: {
    review: CodexReviewSummary | null;
    sourceContext: CodexSourceContext | null | undefined;
  },
  scope: ClarificationReuseScope,
): boolean {
  if (!input.review) return false;
  const sourceFolder = sourceFolderFromContext(input.sourceContext);
  if (!sourceFolder || sourceFolder !== scope.sourceFolder) return false;
  if (normalizeString(input.sourceContext?.provider) !== scope.provider) return false;
  if (normalizeString(input.review.documentKind) !== scope.documentKind) return false;
  if (normalizeString(input.review.targetDomain) !== scope.targetDomain) return false;
  if (scope.reportType) {
    return normalizeString(input.review.normalizedMetadata.report_type) === scope.reportType;
  }
  return true;
}

export function renderClarificationAnswers(
  answers: Partial<Record<ClarificationQuestionKey, string>>,
): string[] {
  const normalized = normalizeClarificationAnswers(answers);
  return Object.entries(normalized).map(([key, value]) => `- ${key}=${value}`);
}

export function renderTemplateHints(
  templates: PromptTemplateHint[],
): string[] {
  return templates.map((template) => {
    const answerText = Object.entries(template.answers)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ");
    const scope = [
      template.provider ? `provider=${template.provider}` : null,
      template.sourceFolder ? `source_folder=${template.sourceFolder}` : null,
      template.documentKind ? `document_kind=${template.documentKind}` : null,
      template.reportType ? `report_type=${template.reportType}` : null,
    ].filter((value): value is string => value !== null);
    return `- ${scope.join(", ")} -> ${answerText}`;
  });
}
