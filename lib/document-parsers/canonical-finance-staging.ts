import type {
  CanonicalFinanceBundle,
  CanonicalFinanceRecord,
} from "./canonical-finance-types";
import { normalizeReportingPeriodKey, parsePeriodFromFileName } from "./period-utils";

export interface CanonicalFinanceStagingRow {
  companySlug: string;
  source: string;
  externalId: string;
  payload: Record<string, unknown>;
  status: "pending";
}

interface CanonicalFinanceDeferredRecord {
  family: CanonicalFinanceRecord["family"];
  period_key: string;
  scope_key: string;
  reasons: string[];
}

interface CanonicalFinancePromotionAssessment {
  promotableRecords: CanonicalFinanceRecord[];
  deferredRecords: CanonicalFinanceDeferredRecord[];
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function isMonthlyPeriodKey(periodKey: string): boolean {
  return /^\d{4}-\d{2}$/.test(periodKey);
}

function hasMissingPnlCoreMetrics(record: CanonicalFinanceRecord): boolean {
  return (
    record.family === "pnl_month" &&
    (record.warnings.includes("pnl_revenue_missing") ||
      record.warnings.includes("pnl_net_income_missing"))
  );
}

function hasAmbiguousCompanyWidePnlRevenue(record: CanonicalFinanceRecord): boolean {
  return (
    record.family === "pnl_month" &&
    record.company_wide &&
    record.warnings.includes("pnl_revenue_ambiguous_income_only")
  );
}

function isGenericInternalPnlScope(record: CanonicalFinanceRecord): boolean {
  if (record.family !== "pnl_month" || record.company_wide) return false;
  const normalizedScope = `${record.scope_key} ${record.scope_label}`.toLowerCase();
  return [
    "pl",
    "p&l",
    "profit and loss",
    "profit_loss",
    "profit_and_loss",
    "pnl",
    "lr",
    "laba rugi",
    "income statement",
    "income_statement",
    "summary",
    "detail",
    "details",
    "macro",
    "macro_a",
    "macro_b",
    "macro c",
    "macro_c",
  ].some((candidate) => normalizedScope.includes(candidate));
}

function promotionBlockingReasons(record: CanonicalFinanceRecord): string[] {
  const reasons: string[] = [];
  const workbookPeriod = parsePeriodFromFileName(record.source_document_name);
  const workbookPeriodKey = workbookPeriod
    ? normalizeReportingPeriodKey(workbookPeriod)
    : null;

  if (
    (record.family === "pnl_month" ||
      record.family === "balance_sheet_month" ||
      record.family === "cash_flow_month") &&
    workbookPeriodKey &&
    isMonthlyPeriodKey(workbookPeriodKey) &&
    !isMonthlyPeriodKey(record.period_key)
  ) {
    reasons.push("monthly_workbook_period_mismatch");
  }

  if (
    record.family === "pnl_month" &&
    record.company_wide &&
    record.scope_key !== "company"
  ) {
    reasons.push("company_wide_scope_ambiguous");
  }

  if (
    record.family === "pnl_month" &&
    record.company_wide &&
    hasMissingPnlCoreMetrics(record)
  ) {
    reasons.push("company_wide_pnl_core_metrics_missing");
  }

  if (hasAmbiguousCompanyWidePnlRevenue(record)) {
    reasons.push("company_wide_pnl_revenue_ambiguous");
  }

  if (
    record.family === "pnl_month" &&
    !record.company_wide &&
    hasMissingPnlCoreMetrics(record) &&
    isGenericInternalPnlScope(record)
  ) {
    reasons.push("internal_scope_generic_pnl_missing_core_metrics");
  }

  if (
    record.family === "pnl_month" &&
    !record.company_wide &&
    hasMissingPnlCoreMetrics(record) &&
    !isGenericInternalPnlScope(record) &&
    record.statement_lines.length <= 3
  ) {
    reasons.push("internal_scope_pnl_low_signal");
  }

  return reasons;
}

export function assessCanonicalFinancePromotion(
  bundle: CanonicalFinanceBundle | null | undefined,
): CanonicalFinancePromotionAssessment {
  if (!bundle || bundle.records.length === 0) {
    return {
      promotableRecords: [],
      deferredRecords: [],
    };
  }

  const promotableRecords: CanonicalFinanceRecord[] = [];
  const deferredRecords: CanonicalFinanceDeferredRecord[] = [];

  for (const record of bundle.records) {
    const reasons = promotionBlockingReasons(record);
    if (reasons.length === 0) {
      promotableRecords.push(record);
      continue;
    }

    deferredRecords.push({
      family: record.family,
      period_key: record.period_key,
      scope_key: record.scope_key,
      reasons,
    });
  }

  return {
    promotableRecords,
    deferredRecords,
  };
}

export function canonicalFinanceBundleRequiresReview(
  bundle: CanonicalFinanceBundle | null | undefined,
): boolean {
  return assessCanonicalFinancePromotion(bundle).deferredRecords.length > 0;
}

export function buildCanonicalFinanceExternalId(record: CanonicalFinanceRecord): string {
  switch (record.family) {
    case "financial_projection_plan":
      return [
        record.family,
        record.plan_key,
        record.scenario_key,
        record.period_key,
        record.scope_key,
      ].map(slugify).join(":");
    case "metrics_daily":
      return [
        record.family,
        record.template_key,
        record.period_key,
        record.scope_key,
      ].map(slugify).join(":");
    default:
      return [
        record.family,
        record.book,
        record.period_key,
        record.scope_key,
      ].map(slugify).join(":");
  }
}

export function buildCanonicalFinanceStagingRows(input: {
  companySlug: string;
  documentId: string;
  companyCurrency: string | null | undefined;
  bundle: CanonicalFinanceBundle | null | undefined;
}): CanonicalFinanceStagingRow[] {
  const { companySlug, documentId, companyCurrency, bundle } = input;
  if (!bundle || bundle.records.length === 0) return [];
  const assessment = assessCanonicalFinancePromotion(bundle);

  return assessment.promotableRecords.map((record) => ({
    companySlug,
    source: `canonical-finance-import:${record.family}`,
    externalId: buildCanonicalFinanceExternalId(record),
    payload: {
      documentId,
      document_id: documentId,
      company_currency: companyCurrency ?? null,
      record,
      warnings: bundle.warnings,
      candidate_facts: bundle.candidate_facts,
    },
    status: "pending",
  }));
}

export function buildCanonicalFinanceOcrState(
  bundle: CanonicalFinanceBundle | null | undefined,
): Record<string, unknown> | undefined {
  if (!bundle) return undefined;
  const assessment = assessCanonicalFinancePromotion(bundle);
  const deferredReasons = Array.from(
    new Set(assessment.deferredRecords.flatMap((record) => record.reasons)),
  );
  const warnings = [...bundle.warnings];
  if (assessment.deferredRecords.length > 0) {
    warnings.push("canonical_finance_records_deferred");
  }

  return {
    record_count: bundle.records.length,
    promotable_record_count: assessment.promotableRecords.length,
    deferred_record_count: assessment.deferredRecords.length,
    families: Array.from(new Set(bundle.records.map((record) => record.family))),
    promotable_families: Array.from(
      new Set(assessment.promotableRecords.map((record) => record.family)),
    ),
    deferred_reasons: deferredReasons,
    deferred_records: assessment.deferredRecords,
    warnings,
    clarification_questions: bundle.clarification_questions.map((question) => ({
      key: question.key,
      family: question.family,
      label: question.label,
      prompt: question.prompt,
      reason: question.reason,
      required: question.required,
      template_eligible: question.template_eligible,
      options: question.options,
    })),
  };
}
