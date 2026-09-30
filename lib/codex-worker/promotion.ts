import { createHash } from "crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies, documents, stagingRecords } from "@/lib/db/schema";
import { parseCodexPersistedBundle } from "@/lib/codex-worker/bundle";
import { resolveTxnCurrency } from "@/lib/finance/resolve-currency";
import { normalizeOcrResult } from "@/lib/codex-worker/ocr-result";
import { getCodexSourceContext } from "@/lib/codex-worker/source-context";
import { getCodexPreprocessState } from "@/lib/codex-worker/status";
import { queryAllEntities, submitCompanyDbDelete } from "@/lib/company-db/client";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import { toQmd } from "@/lib/company-db/summary/qmd";
import {
  parseDocument,
  type ParseDocumentSheetHint,
  type ParseResult,
} from "@/lib/document-parsers/format-router";
import {
  assessCanonicalFinancePromotion,
  buildCanonicalFinanceOcrState,
  buildCanonicalFinanceStagingRows,
} from "@/lib/document-parsers/canonical-finance-staging";
import { classifyDocumentForIngestion } from "@/lib/document-parsers/document-classification";
import { normalizeReportingPeriodKey } from "@/lib/document-parsers/period-utils";
import type { ExtractedReport } from "@/lib/document-parsers/report-types";
import { buildReportExternalId, resolveReportEntity } from "@/lib/document-parsers/report-identity";
import { getDocumentClarificationState } from "@/lib/documents/clarifications";
import { storage } from "@/lib/storage";
import { triggerReconciliationForCompany } from "@/lib/workers/reconciliation-trigger";

type PromotionStage = "queued" | "running" | "completed" | "failed";

const DOC_IMPORT_ALLOWED_DOMAINS = new Set([
  "documents",
  "legal",
  "governance",
  "strategy",
  "tax",
  "operations",
  "assets",
]);

interface CodexPromotionState {
  stage: PromotionStage;
  updated_at?: string;
  completed_at?: string;
  error?: string | null;
  report_staging_count?: number;
  canonical_finance_staging_count?: number;
  transaction_staging_count?: number;
  non_financial_staging_count?: number;
  promoted_domains?: string[];
  reconciliation?: Record<string, unknown> | null;
  classification?: Record<string, unknown> | null;
}

interface PromoteCodexDocRow {
  id: string;
  companyId: string;
  companySlug: string;
  companyDbPort: number;
  reportingCurrency: string;
  fileName: string;
  fileType: string;
  storageUrl: string;
  status: string;
  extractedTxnCount: number | null;
  ocrResult: Record<string, unknown> | null;
}

interface PendingCodexPromotionCandidate {
  id: string;
  createdAt: Date;
  promotionStage: string | null;
  promotionUpdatedAt: string | null;
}

export interface PromoteCodexDocumentResult {
  documentId: string;
  status: "completed" | "skipped" | "failed";
  reportStagingCount: number;
  canonicalFinanceStagingCount?: number;
  transactionStagingCount: number;
  nonFinancialStagingCount: number;
  promotedDomains: string[];
  reason?: string;
  error?: string;
}

interface PromoteCodexDocumentOptions {
  force?: boolean;
  verificationRetryCount?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldMarkDocumentCompletedAfterPromotion(
  documentStatus: string | null | undefined,
  ocrResult: Record<string, unknown> | null | undefined,
): boolean {
  if (documentStatus === "completed") return false;
  const preprocess = getCodexPreprocessState(ocrResult);
  const promotion = getCodexPromotionState(ocrResult);
  return preprocess?.stage === "completed" && promotion?.stage === "completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function canonicalStatementFileName(record: {
  family: string;
  period_key: string;
  book: string;
}): string {
  return record.book === "actual"
    ? `${record.period_key}.qmd`
    : `${record.period_key}-${slugify(record.book)}.qmd`;
}

function canonicalFinanceRecordPath(record: {
  family: string;
  period_key: string;
  book: string;
  scope_key: string;
  plan_key?: string;
  scenario_key?: string;
  template_key?: string;
}): string | null {
  const fileName = canonicalStatementFileName(record);
  switch (record.family) {
    case "pnl_month":
      return `finance/statements/pnl/${slugify(record.scope_key)}/${fileName}`;
    case "balance_sheet_month":
      return `finance/statements/balance-sheet/${slugify(record.scope_key)}/${fileName}`;
    case "cash_flow_month":
      return `finance/statements/cash-flow/${slugify(record.scope_key)}/${fileName}`;
    case "financial_projection_plan":
      return `finance/projections/${slugify(record.plan_key ?? "plan")}/${slugify(record.scenario_key ?? "scenario")}/${slugify(record.scope_key)}/${fileName}`;
    case "metrics_daily":
      return `metrics/daily/${slugify(record.scope_key)}/${slugify(record.template_key ?? "template")}/${fileName}`;
    default:
      return null;
  }
}

export function buildExpectedCanonicalFinancePaths(
  parseResult: ParseResult | null,
): string[] {
  const records = parseResult?.canonicalFinance
    ? assessCanonicalFinancePromotion(parseResult.canonicalFinance).promotableRecords
    : [];
  return records
    .map((record) =>
      canonicalFinanceRecordPath(record as {
        family: string;
        period_key: string;
        book: string;
        scope_key: string;
        plan_key?: string;
        scenario_key?: string;
        template_key?: string;
      }),
    )
    .filter((filePath): filePath is string => Boolean(filePath));
}

export function buildExpectedCanonicalFinanceArtifactPaths(
  parseResult: ParseResult | null,
): string[] {
  const primaryPaths = buildExpectedCanonicalFinancePaths(parseResult);
  const sidecarPaths = primaryPaths
    .filter((filePath) => filePath.startsWith("finance/"))
    .map((filePath) => filePath.replace(/\.qmd$/, ".statement-lines.qmd"));
  return Array.from(new Set([...primaryPaths, ...sidecarPaths]));
}

function isPromotionDocumentReady(doc: PromoteCodexDocRow): boolean {
  return doc.status === "completed" || getCodexPreprocessState(doc.ocrResult)?.stage === "completed";
}

function getCodexPromotionState(
  ocrResult: unknown,
): CodexPromotionState | null {
  const normalized = normalizeOcrResult(ocrResult);
  if (!normalized) return null;

  const raw = normalized.codex_promotion;
  if (!isRecord(raw)) return null;
  const stage = typeof raw.stage === "string" ? raw.stage : null;
  if (
    stage !== "queued" &&
    stage !== "running" &&
    stage !== "completed" &&
    stage !== "failed"
  ) {
    return null;
  }
  return raw as unknown as CodexPromotionState;
}

function parseSheetOrdinalFromSourceRef(sourceRef: unknown): number | null {
  if (typeof sourceRef !== "string") return null;
  const match = sourceRef.match(/(?:^|\/)sheet-(\d+)-/i);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function extractCodexBundleSheetHints(
  bundle: {
    files: Array<{
      path: string;
      frontmatter: Record<string, unknown>;
    }>;
  },
): ParseDocumentSheetHint[] {
  return bundle.files
    .filter((file) => file.path.includes("/units/"))
    .map((file) => {
      const frontmatter = file.frontmatter;
      const sheetOrdinal = parseSheetOrdinalFromSourceRef(frontmatter.source_ref);
      const title =
        typeof frontmatter.title === "string" && frontmatter.title.trim().length > 0
          ? frontmatter.title.trim()
          : null;
      const candidateRole =
        typeof frontmatter.candidate_role === "string" && frontmatter.candidate_role.trim().length > 0
          ? frontmatter.candidate_role.trim()
          : null;
      return {
        sheetOrdinal,
        title,
        candidateRole,
      };
    })
    .filter(
      (hint) =>
        typeof hint.sheetOrdinal === "number" ||
        typeof hint.title === "string" ||
        typeof hint.candidateRole === "string",
    );
}

function mergeCodexPromotionState(
  ocrResult: unknown,
  patch: Partial<CodexPromotionState>,
): Record<string, unknown> {
  const current = getCodexPromotionState(ocrResult) ?? { stage: "queued" as const };
  return {
    ...(normalizeOcrResult(ocrResult) ?? {}),
    codex_promotion: {
      ...current,
      ...patch,
    },
  };
}

function buildDocImportExternalId(
  documentId: string,
  primaryDomain: string,
  documentType: string | null | undefined,
): string {
  const docTypePart = (documentType ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "unknown";
  return `doc:${documentId}:${primaryDomain}:${docTypePart}:v1`;
}

function normalizeDocImportDomain(domain: string): string {
  const clean = domain
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "documents";
  return DOC_IMPORT_ALLOWED_DOMAINS.has(clean) ? clean : "documents";
}

async function loadDocument(documentId: string): Promise<PromoteCodexDocRow | null> {
  const rows = await db
    .select({
      id: documents.id,
      companyId: documents.companyId,
      companySlug: companies.slug,
      companyDbPort: companies.companyDbPort,
      reportingCurrency: companies.reportingCurrency,
      fileName: documents.fileName,
      fileType: documents.fileType,
      storageUrl: documents.storageUrl,
      status: documents.status,
      extractedTxnCount: documents.extractedTxnCount,
      ocrResult: documents.ocrResult,
    })
    .from(documents)
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.source, "codex_upload"),
      ),
    )
    .limit(1);

  const row = rows[0] ?? null;
  if (!row?.companySlug) return null;
  return {
    ...row,
    companySlug: row.companySlug,
  };
}

async function updatePromotionState(
  documentId: string,
  companyId: string,
  currentOcrResult: Record<string, unknown> | null | undefined,
  patch: Partial<CodexPromotionState>,
): Promise<Record<string, unknown>> {
  const nextOcrResult = mergeCodexPromotionState(currentOcrResult, {
    updated_at: nowIso(),
    ...patch,
  });

  await db
    .update(documents)
    .set({ ocrResult: nextOcrResult })
    .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));

  return nextOcrResult;
}

type StagingRowInput = {
  companySlug: string;
  source: string;
  externalId: string;
  payload: Record<string, unknown>;
  status: "pending";
};

type StagingWriter = Pick<typeof db, "insert">;

async function upsertStagingRows(
  rows: StagingRowInput[],
  writer: StagingWriter = db,
): Promise<void> {
  if (rows.length === 0) return;

  await writer
    .insert(stagingRecords)
    .values(rows)
    .onConflictDoUpdate({
      target: [stagingRecords.companySlug, stagingRecords.source, stagingRecords.externalId],
      set: {
        payload: sql`EXCLUDED.payload`,
        status: "pending",
        lockedBy: sql`NULL`,
        lockedUntil: sql`NULL`,
        retries: 0,
        nextRetryAt: sql`NULL`,
        error: sql`NULL`,
        commitSha: sql`NULL`,
        entityIds: sql`NULL`,
        updatedAt: sql`now()`,
      },
    });
}

export function buildReportStagingRows(
  doc: PromoteCodexDocRow,
  parseResult: ParseResult,
): StagingRowInput[] {
  const reports = (parseResult.reports as ExtractedReport[] | undefined) ?? [];
  if (reports.length === 0) return [];

  const rowsByExternalId = new Map<
    string,
    { row: StagingRowInput; score: number }
  >();

  for (const report of reports) {
    const periodKey = normalizeReportingPeriodKey(report.reporting_period);
    const externalId = buildReportExternalId(report);
    const source = `report-import:${report.report_type}`;
    const resolvedEntity = resolveReportEntity(report.entity, report.sheet_name);
    const row: StagingRowInput = {
      companySlug: doc.companySlug,
      source,
      externalId,
      payload: {
        documentId: doc.id,
        document_id: doc.id,
        report_type: report.report_type,
        reporting_period: report.reporting_period,
        reporting_period_key: periodKey,
        currency: report.currency,
        company_currency: doc.reportingCurrency,
        book: report.book,
        entity: resolvedEntity,
        sheet_name: report.sheet_name ?? null,
        department: report.department,
        line_items: report.line_items,
        derived_metrics: report.derived_metrics,
        confidence: report.confidence,
        source_mode: "codex_promotion",
      } as Record<string, unknown>,
      status: "pending" as const,
    };

    const score =
      (resolvedEntity !== "Unknown" ? 1_000_000 : 0) +
      ((report.sheet_name?.trim().length ?? 0) > 0 ? 100_000 : 0) +
      Math.round(report.confidence * 10_000) +
      report.line_items.length;

    const current = rowsByExternalId.get(externalId);
    if (!current || score > current.score) {
      rowsByExternalId.set(externalId, { row, score });
    }
  }

  return Array.from(rowsByExternalId.values(), (entry) => entry.row);
}

function buildTransactionStagingRows(
  doc: PromoteCodexDocRow,
  parseResult: ParseResult,
): StagingRowInput[] {
  if (parseResult.transactions.length === 0) return [];

  const format = (parseResult.metadata as Record<string, unknown> | undefined)?.format ?? doc.fileType;
  const source = `csv-import:${format}`;
  const rows = parseResult.transactions.map((txn, idx) => {
    const resolved = resolveTxnCurrency(txn.currency, {
      reportingCurrency: doc.reportingCurrency,
    });
    return {
      companySlug: doc.companySlug,
      source,
      externalId: `${doc.id}:${idx}`,
      payload: {
        documentId: doc.id,
        date: txn.date,
        amount: txn.amount,
        currency: resolved.currency,
        currencyAssumed: resolved.assumed,
        description: txn.description,
        merchantName: txn.merchantName,
        sourceRef: txn.sourceRef,
        type: "transaction",
        domain: "banking",
        source_mode: "codex_promotion",
      } as Record<string, unknown>,
      status: "pending" as const,
    };
  });
  return rows;
}

function buildDocumentImportRows(
  doc: PromoteCodexDocRow,
  parseResult: ParseResult,
): { rows: StagingRowInput[]; promotedDomain: string } {
  const classification = classifyDocumentForIngestion({
    fileType: doc.fileType,
    fileName: doc.fileName,
    documentType: parseResult.documentType ?? null,
    transactionsCount: parseResult.transactions.length,
    reportsCount: parseResult.reports?.length ?? 0,
  });

  const primaryDomain = normalizeDocImportDomain(
    classification.candidate_domains[0] ?? "documents",
  );
  const hasCanonicalFinance =
    (parseResult.canonicalFinance?.records?.length ?? 0) > 0 ||
    (parseResult.reports?.length ?? 0) > 0;
  const evidenceDomain = hasCanonicalFinance ? "documents" : primaryDomain;
  const source = `doc-import:${evidenceDomain}`;
  const requiresReview = parseResult.needsReview ?? false;
  const payload = {
    documentId: doc.id,
    fileType: doc.fileType,
    fileName: doc.fileName,
    documentType: parseResult.documentType ?? null,
    confidence: parseResult.confidence,
    metadata: parseResult.metadata ?? {},
    needs_review: requiresReview,
    requires_review: requiresReview,
    review_pending: false,
    evidence_status: "captured",
    ingestion_mode: requiresReview ? "needs_review" : "auto_ingest",
    ingestion_reason: requiresReview
      ? "Stored as evidence in Company-DB and promoted from Codex output; review-flagged findings remain non-decision-grade until checked."
      : "Stored as evidence in Company-DB and promoted from Codex output.",
    document_kind: classification.document_kind,
    target_domain: primaryDomain,
    target_entity_type: parseResult.documentType ?? null,
    approved: true,
    storage_key: doc.storageUrl,
    storage_url: doc.storageUrl,
    classification,
    source_mode: "codex_promotion",
  } as Record<string, unknown>;

  return {
    rows: [
      {
        companySlug: doc.companySlug,
        source,
        externalId: buildDocImportExternalId(doc.id, evidenceDomain, parseResult.documentType ?? null),
        payload,
        status: "pending",
      },
    ],
    promotedDomain: evidenceDomain,
  };
}

interface LoadedCodexBundleArtifact {
  rows: StagingRowInput[];
  promotedDomain: string;
  sheetHints: ParseDocumentSheetHint[];
}

interface ResolvedCodexPromotionArtifacts {
  stagingRows: StagingRowInput[];
  reportStagingCount: number;
  canonicalFinanceStagingCount: number;
  transactionStagingCount: number;
  nonFinancialStagingCount: number;
  promotedDomains: string[];
  canonicalFinanceState: Record<string, unknown> | null;
}

async function loadCodexBundleArtifact(
  doc: PromoteCodexDocRow,
): Promise<LoadedCodexBundleArtifact | null> {
  const preprocess = getCodexPreprocessState(doc.ocrResult ?? undefined);
  const bundleStorageKey = preprocess?.bundle_storage_key ?? null;
  if (!bundleStorageKey) return null;

  const rawBundle = await storage.get(bundleStorageKey);
  const bundle = parseCodexPersistedBundle(rawBundle, doc.id);
  const source = `codex-bundle:${bundle.domain}`;

  return {
    rows: bundle.files.map((file) => ({
      companySlug: doc.companySlug,
      source,
      externalId: buildCodexBundleExternalId(doc.id, file.path),
      payload: {
        documentId: doc.id,
        filePath: file.path,
        domain: bundle.domain,
        content: toQmd(file.frontmatter, file.body),
        commitMessage: bundle.commitMessage,
        bundleRootPath: bundle.rootPath,
        indexFilePath: bundle.indexFilePath,
        source_mode: "codex_promotion",
      },
      status: "pending",
    })),
    promotedDomain: bundle.domain,
    sheetHints: extractCodexBundleSheetHints(bundle),
  };
}

export function buildCompletedPromotionState(
  currentOcrResult: Record<string, unknown> | null | undefined,
  patch: {
    reportStagingCount: number;
    canonicalFinanceStagingCount: number;
    transactionStagingCount: number;
    nonFinancialStagingCount: number;
    promotedDomains: string[];
    classification: Record<string, unknown>;
    canonicalFinanceState: Record<string, unknown> | null;
  },
) {
  const normalized = normalizeOcrResult(currentOcrResult) ?? {};
  const nextOcrResult: Record<string, unknown> = {
    ...normalized,
    codex_promotion: {
      ...(getCodexPromotionState(currentOcrResult) ?? { stage: "queued" as const }),
      stage: "completed",
      completed_at: nowIso(),
      updated_at: nowIso(),
      error: null,
      report_staging_count: patch.reportStagingCount,
      canonical_finance_staging_count: patch.canonicalFinanceStagingCount,
      transaction_staging_count: patch.transactionStagingCount,
      non_financial_staging_count: patch.nonFinancialStagingCount,
      promoted_domains: patch.promotedDomains,
      classification: patch.classification,
    },
  };

  if (patch.canonicalFinanceState) {
    nextOcrResult.canonical_finance = patch.canonicalFinanceState;
  } else {
    delete nextOcrResult.canonical_finance;
  }

  return nextOcrResult;
}

async function completePromotionAtomically(input: {
  doc: PromoteCodexDocRow;
  currentOcrResult: Record<string, unknown> | null | undefined;
  stagingRows: StagingRowInput[];
  reportStagingCount: number;
  canonicalFinanceStagingCount: number;
  transactionStagingCount: number;
  nonFinancialStagingCount: number;
  promotedDomains: string[];
  classification: Record<string, unknown>;
  canonicalFinanceState: Record<string, unknown> | null;
}) {
  const nextOcrResult = buildCompletedPromotionState(input.currentOcrResult, {
    reportStagingCount: input.reportStagingCount,
    canonicalFinanceStagingCount: input.canonicalFinanceStagingCount,
    transactionStagingCount: input.transactionStagingCount,
    nonFinancialStagingCount: input.nonFinancialStagingCount,
    promotedDomains: input.promotedDomains,
    classification: input.classification,
    canonicalFinanceState: input.canonicalFinanceState,
  });

  await db.transaction(async (tx) => {
    await upsertStagingRows(input.stagingRows, tx);

    const nextDocumentState: {
      ocrResult: Record<string, unknown>;
      extractedTxnCount?: number;
      status?: string;
    } = {
      ocrResult: nextOcrResult,
    };

    if (shouldMarkDocumentCompletedAfterPromotion(input.doc.status, nextOcrResult)) {
      nextDocumentState.status = "completed";
    }

    if (
      input.transactionStagingCount > 0 &&
      input.doc.extractedTxnCount !== input.transactionStagingCount
    ) {
      nextDocumentState.extractedTxnCount = input.transactionStagingCount;
    }

    await tx
      .update(documents)
      .set(nextDocumentState)
      .where(and(eq(documents.id, input.doc.id), eq(documents.companyId, input.doc.companyId)));
  });

  return nextOcrResult;
}

async function finalizeDocumentStatusAfterPromotion(
  doc: PromoteCodexDocRow,
  ocrResult: Record<string, unknown> | null | undefined,
): Promise<void> {
  if (!shouldMarkDocumentCompletedAfterPromotion(doc.status, ocrResult)) {
    return;
  }

  await db
    .update(documents)
    .set({ status: "completed" })
    .where(and(eq(documents.id, doc.id), eq(documents.companyId, doc.companyId)));
}

async function updatePromotionReconciliationState(
  doc: PromoteCodexDocRow,
  currentOcrResult: Record<string, unknown> | null | undefined,
  reconciliation: Record<string, unknown> | null,
) {
  try {
    return await updatePromotionState(doc.id, doc.companyId, currentOcrResult, {
      reconciliation,
    });
  } catch (error) {
    console.error(
      `[codex-promotion] Failed to persist reconciliation state for ${doc.id}:`,
      error,
    );
    return currentOcrResult ?? {};
  }
}

async function findMissingCanonicalFinancePaths(
  doc: PromoteCodexDocRow,
  parseResult: ParseResult | null,
): Promise<string[]> {
  const expectedPaths = buildExpectedCanonicalFinancePaths(parseResult);
  if (expectedPaths.length === 0) return [];

  const entities = await queryAllEntities(
    {
      documentId: doc.id,
      view: "full",
    },
    {
      companySlug: doc.companySlug,
      callerId: `codex-promotion-${doc.id}`,
      callerRole: "cfo_agent",
      port: doc.companyDbPort,
    },
  );
  const existingPaths = new Set(
    entities.map((entity) => entity.filePath).filter((filePath) => filePath.endsWith(".qmd")),
  );

  return expectedPaths.filter((filePath) => !existingPaths.has(filePath));
}

async function removeStaleCanonicalFinanceArtifacts(
  doc: PromoteCodexDocRow,
  parseResult: ParseResult | null,
): Promise<string[]> {
  if (!parseResult) return [];

  const expectedPaths = new Set(buildExpectedCanonicalFinanceArtifactPaths(parseResult));
  const writeQueuePort = doc.companyDbPort + 1;

  const linkedEntities = await queryAllEntities(
    {
      documentId: doc.id,
      view: "full",
    },
    {
      companySlug: doc.companySlug,
      callerId: `codex-promotion-${doc.id}`,
      callerRole: "cfo_agent",
      port: doc.companyDbPort,
    },
  );
  const technicalSidecars = await queryAllEntities(
    {
      documentId: doc.id,
      type: "statement_lines_technical",
      view: "full",
    },
    {
      companySlug: doc.companySlug,
      callerId: `codex-promotion-${doc.id}`,
      callerRole: "cfo_agent",
      port: doc.companyDbPort,
    },
  );

  const stalePaths = Array.from(
    new Set(
      [...linkedEntities, ...technicalSidecars]
        .map((entity) => entity.filePath)
        .filter((filePath) => filePath.endsWith(".qmd"))
        .filter((filePath) => !filePath.endsWith("/_summary.qmd"))
        .filter(
          (filePath) =>
            (filePath.startsWith("finance/statements/") ||
              filePath.startsWith("finance/projections/") ||
              filePath.startsWith("metrics/daily/")) &&
            !expectedPaths.has(filePath),
        ),
    ),
  );

  if (stalePaths.length === 0) return [];

  const pathsByDomain = new Map<string, string[]>();
  for (const filePath of stalePaths) {
    const domain = filePath.split("/")[0];
    if (!domain) continue;
    const bucket = pathsByDomain.get(domain) ?? [];
    bucket.push(filePath);
    pathsByDomain.set(domain, bucket);
  }

  for (const [domain, filePaths] of pathsByDomain.entries()) {
    await submitCompanyDbDelete(
      doc.companySlug,
      {
        domain,
        filePaths,
        commitMessage: `${domain}: remove stale codex promotion artifacts for ${doc.id}`,
        metadata: {
          source: "codex-promotion-cleanup",
          documentId: doc.id,
        },
      },
      writeQueuePort,
    );
  }

  const affectedDomains = Array.from(pathsByDomain.keys()).filter((domain) => domain !== "people");
  if (affectedDomains.length > 0) {
    await refreshSummaryTargets({
      companySlug: doc.companySlug,
      port: doc.companyDbPort,
      writeQueuePort,
      domains: affectedDomains,
      reason: "codex_promotion_cleanup",
    }).catch((error) => {
      console.warn(`[codex-promotion] summary refresh failed for ${doc.id}`, error);
    });
  }

  return stalePaths;
}

function buildCodexBundleExternalId(documentId: string, filePath: string): string {
  const digest = createHash("sha1").update(filePath).digest("hex").slice(0, 20);
  return `codex-bundle:${documentId}:${digest}`;
}

export function summarizeCodexPromotion(
  ocrResult: unknown,
): Record<string, unknown> | null {
  const state = getCodexPromotionState(ocrResult);
  if (!state) return null;
  return {
    stage: state.stage,
    updatedAt: state.updated_at ?? null,
    completedAt: state.completed_at ?? null,
    error: state.error ?? null,
    reportStagingCount: state.report_staging_count ?? 0,
    canonicalFinanceStagingCount: state.canonical_finance_staging_count ?? 0,
    transactionStagingCount: state.transaction_staging_count ?? 0,
    nonFinancialStagingCount: state.non_financial_staging_count ?? 0,
    promotedDomains: state.promoted_domains ?? [],
    reconciliation: state.reconciliation ?? null,
    classification: state.classification ?? null,
  };
}

export function resolveCodexPromotionArtifacts(
  doc: PromoteCodexDocRow,
  parseResult: ParseResult | null,
  codexBundle: LoadedCodexBundleArtifact | null,
): ResolvedCodexPromotionArtifacts {
  const canonicalFinanceRows = parseResult
    ? buildCanonicalFinanceStagingRows({
        companySlug: doc.companySlug,
        documentId: doc.id,
        companyCurrency: doc.reportingCurrency,
        bundle: parseResult.canonicalFinance,
      })
    : [];
  const canonicalFinanceState = buildCanonicalFinanceOcrState(
    parseResult?.canonicalFinance,
  ) ?? null;
  const transactionRows = parseResult
    ? buildTransactionStagingRows(doc, parseResult)
    : [];

  let nonFinancialRows = codexBundle?.rows ?? [];
  const promotedDomainSet = new Set<string>();

  if (canonicalFinanceRows.length > 0) promotedDomainSet.add("finance");
  if (transactionRows.length > 0) promotedDomainSet.add("banking");
  if (codexBundle && canonicalFinanceRows.length === 0) promotedDomainSet.add(codexBundle.promotedDomain);

  if (canonicalFinanceRows.length > 0) {
    nonFinancialRows = [];
  }

  if (
    canonicalFinanceRows.length === 0 &&
    transactionRows.length === 0 &&
    !codexBundle &&
    parseResult
  ) {
    const docImport = buildDocumentImportRows(doc, parseResult);
    nonFinancialRows = docImport.rows;
    promotedDomainSet.add(docImport.promotedDomain);
  }

  return {
    stagingRows: [...canonicalFinanceRows, ...transactionRows, ...nonFinancialRows],
    reportStagingCount: 0,
    canonicalFinanceStagingCount: canonicalFinanceRows.length,
    transactionStagingCount: transactionRows.length,
    nonFinancialStagingCount: nonFinancialRows.length,
    promotedDomains: Array.from(promotedDomainSet),
    canonicalFinanceState,
  };
}

function normalizePromotionStage(stage: string | null | undefined): string {
  const normalized = typeof stage === "string" ? stage.trim().toLowerCase() : "";
  return normalized || "queued";
}

function promotionCandidatePriority(stage: string): number {
  return stage === "failed" ? 1 : 0;
}

function promotionCandidateTimestamp(candidate: PendingCodexPromotionCandidate): number {
  const stage = normalizePromotionStage(candidate.promotionStage);
  if (stage === "failed" && candidate.promotionUpdatedAt) {
    const parsedUpdatedAt = Date.parse(candidate.promotionUpdatedAt);
    if (Number.isFinite(parsedUpdatedAt)) {
      return parsedUpdatedAt;
    }
  }
  return candidate.createdAt.getTime();
}

export function selectPendingCodexPromotionDocumentIds(
  candidates: PendingCodexPromotionCandidate[],
  limit: number,
): string[] {
  return [...candidates]
    .filter((candidate) => {
      const stage = normalizePromotionStage(candidate.promotionStage);
      return stage !== "completed" && stage !== "running";
    })
    .sort((left, right) => {
      const priorityDiff =
        promotionCandidatePriority(normalizePromotionStage(left.promotionStage)) -
        promotionCandidatePriority(normalizePromotionStage(right.promotionStage));
      if (priorityDiff !== 0) return priorityDiff;
      return promotionCandidateTimestamp(left) - promotionCandidateTimestamp(right);
    })
    .slice(0, Math.max(limit, 0))
    .map((candidate) => candidate.id);
}

export async function promoteCodexDocument(
  documentId: string,
  options?: PromoteCodexDocumentOptions,
): Promise<PromoteCodexDocumentResult> {
  const doc = await loadDocument(documentId);
  if (!doc) {
    return {
      documentId,
      status: "failed",
      reportStagingCount: 0,
      transactionStagingCount: 0,
      nonFinancialStagingCount: 0,
      promotedDomains: [],
      error: "Document not found",
    };
  }

  const currentPromotion = getCodexPromotionState(doc.ocrResult);
  if (!options?.force && currentPromotion?.stage === "completed") {
    return {
      documentId,
      status: "skipped",
      reportStagingCount: currentPromotion.report_staging_count ?? 0,
      canonicalFinanceStagingCount:
        currentPromotion.canonical_finance_staging_count ?? 0,
      transactionStagingCount: currentPromotion.transaction_staging_count ?? 0,
      nonFinancialStagingCount: currentPromotion.non_financial_staging_count ?? 0,
      promotedDomains: currentPromotion.promoted_domains ?? [],
      reason: "already_promoted",
    };
  }

  if (!options?.force && currentPromotion?.stage === "running") {
    return {
      documentId,
      status: "skipped",
      reportStagingCount: 0,
      canonicalFinanceStagingCount: 0,
      transactionStagingCount: 0,
      nonFinancialStagingCount: 0,
      promotedDomains: currentPromotion.promoted_domains ?? [],
      reason: "promotion_in_progress",
    };
  }

  if (!options?.force && !isPromotionDocumentReady(doc)) {
    return {
      documentId,
      status: "skipped",
      reportStagingCount: 0,
      canonicalFinanceStagingCount: 0,
      transactionStagingCount: 0,
      nonFinancialStagingCount: 0,
      promotedDomains: [],
      reason: `document_status=${doc.status}`,
    };
  }

  let ocrResult = await updatePromotionState(doc.id, doc.companyId, doc.ocrResult, {
    stage: "running",
    error: null,
  });

  try {
    const codexBundle = await loadCodexBundleArtifact(doc);
    const sheetHints = codexBundle?.sheetHints ?? [];
    const buffer = await storage.get(doc.storageUrl);
    let parseResult: ParseResult | null = null;
    let parseError: string | null = null;
    try {
      parseResult = await parseDocument(buffer, doc.fileType, doc.fileName, {
        companyId: doc.companyId,
        sourceContext: getCodexSourceContext(doc.ocrResult) ?? undefined,
        sheetHints,
        clarificationAnswers: getDocumentClarificationState(doc.ocrResult).answers,
      });
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }

    const classification = classifyDocumentForIngestion({
      fileType: doc.fileType,
      fileName: doc.fileName,
      documentType: parseResult?.documentType ?? null,
      transactionsCount: parseResult?.transactions.length ?? 0,
      reportsCount: parseResult?.reports?.length ?? 0,
    });

    if (!parseResult && !codexBundle) {
      throw new Error(parseError ?? "Unable to parse document for promotion.");
    }

    const {
      stagingRows,
      reportStagingCount,
      canonicalFinanceStagingCount,
      transactionStagingCount,
      nonFinancialStagingCount,
      promotedDomains,
      canonicalFinanceState,
    } = resolveCodexPromotionArtifacts(doc, parseResult, codexBundle);

    ocrResult = await completePromotionAtomically({
      doc,
      currentOcrResult: ocrResult,
      stagingRows,
      reportStagingCount,
      canonicalFinanceStagingCount,
      transactionStagingCount,
      nonFinancialStagingCount,
      promotedDomains,
      classification: {
        ...(classification as unknown as Record<string, unknown>),
        parse_error: parseError,
      },
      canonicalFinanceState,
    });

    const removedStalePaths = await removeStaleCanonicalFinanceArtifacts(doc, parseResult);
    if (removedStalePaths.length > 0) {
      console.warn(
        `[codex-promotion] removed stale canonical artifacts for ${doc.id}: ${removedStalePaths.join(", ")}`,
      );
    }

    if (stagingRows.length > 0) {
      let reconciliation: Record<string, unknown> | null = null;
      try {
        const reconciliationResult = await triggerReconciliationForCompany(doc.companySlug);
        reconciliation = reconciliationResult as unknown as Record<string, unknown>;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[codex-promotion] Reconciliation failed for ${doc.id}:`, error);
        reconciliation = { status: "failed", error: message };
      }

      ocrResult = await updatePromotionReconciliationState(doc, ocrResult, reconciliation);
    }

    await finalizeDocumentStatusAfterPromotion(doc, ocrResult);

    const missingCanonicalPaths = await findMissingCanonicalFinancePaths(doc, parseResult);
    const verificationRetryCount = options?.verificationRetryCount ?? 0;
    if (missingCanonicalPaths.length > 0 && verificationRetryCount < 1) {
      console.warn(
        `[codex-promotion] retrying document=${doc.id}; missing canonical paths after reconciliation: ${missingCanonicalPaths.join(", ")}`,
      );
      await sleep(1000);
      return promoteCodexDocument(documentId, {
        force: true,
        verificationRetryCount: verificationRetryCount + 1,
      });
    }

    return {
      documentId: doc.id,
      status: "completed",
      reportStagingCount,
      canonicalFinanceStagingCount,
      transactionStagingCount,
      nonFinancialStagingCount,
      promotedDomains,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updatePromotionState(doc.id, doc.companyId, ocrResult, {
      stage: "failed",
      completed_at: nowIso(),
      error: message,
    });

    return {
      documentId: doc.id,
      status: "failed",
      reportStagingCount: 0,
      canonicalFinanceStagingCount: 0,
      transactionStagingCount: 0,
      nonFinancialStagingCount: 0,
      promotedDomains: [],
      error: message,
    };
  }
}

export async function listPendingCodexPromotionDocumentIds(limit = 10): Promise<string[]> {
  const rows = await db
    .select({
      id: documents.id,
      createdAt: documents.createdAt,
      promotionStage: sql<string | null>`NULLIF(${documents.ocrResult} -> 'codex_promotion' ->> 'stage', '')`,
      promotionUpdatedAt: sql<string | null>`NULLIF(${documents.ocrResult} -> 'codex_promotion' ->> 'updated_at', '')`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.source, "codex_upload"),
        eq(documents.status, "completed"),
        sql`COALESCE(${documents.ocrResult} -> 'codex_promotion' ->> 'stage', 'queued') <> 'completed'`,
      ),
    )
    .orderBy(documents.createdAt)
    .limit(Math.max(limit * 10, limit, 25));

  return selectPendingCodexPromotionDocumentIds(rows, limit);
}
