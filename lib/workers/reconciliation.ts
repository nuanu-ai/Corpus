/**
 * Reconciliation Worker
 *
 * Processes staging_records from PostgreSQL:
 * 1. Claims pending records (FOR UPDATE SKIP LOCKED)
 * 2. Transforms payloads to QMD frontmatter
 * 3. Submits to Company-DB Write Queue
 * 4. Updates records with commit_sha and entity_ids
 *
 * Designed to run as a cron job or continuous worker.
 */

import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { extractSnapshotStatementMetrics } from "@/lib/company-db/financial-metrics";
import {
  buildCompanyDbQueueHeadersForUrl,
  getCompanyDbWriteIntentToken,
} from "@/lib/company-db/internal-service-auth";
import { normalizeReportingPeriodKey } from "@/lib/document-parsers/period-utils";
import { resolveReportEntity } from "@/lib/document-parsers/report-identity";
import type {
  CanonicalBalanceSheetMonth,
  CanonicalCashFlowMonth,
  CanonicalDailyMetricValue,
  CanonicalFinanceRecord,
  CanonicalFinanceSourceRef,
  CanonicalFinancialProjectionPlan,
  CanonicalMetricsDaily,
  CanonicalPnlMonth,
  CanonicalStatementLine,
} from "@/lib/document-parsers/canonical-finance-types";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";

const WRITE_QUEUE_URL = process.env.COMPANY_DB_QUEUE_URL ?? "http://localhost:3101";
// agentId must match an existing people/resources/{agentId}.qmd in the company repo
const RECONCILIATION_AGENT_ID = process.env.RECONCILIATION_AGENT_ID ?? "reconciliation-worker";
let fallbackTokenWarned = false;

export function resolveReconciliationAgentToken(
  envToken: string | undefined,
  sharedSecret: string,
): { token: string; usedFallback: boolean } {
  const token = envToken?.trim();
  if (token && token.length > 0) {
    return { token, usedFallback: false };
  }

  const fallback = sharedSecret.trim();
  if (fallback.length > 0) {
    return { token: fallback, usedFallback: true };
  }

  return { token: "", usedFallback: false };
}

const BATCH_SIZE = 50;
const LOCK_DURATION_MINUTES = 5;

function getReconciliationAgentAuth(): { token: string; usedFallback: boolean } {
  return resolveReconciliationAgentToken(
    process.env.RECONCILIATION_AGENT_TOKEN,
    getCompanyDbWriteIntentToken(),
  );
}

interface StagingRecord extends Record<string, unknown> {
  id: string;
  company_slug: string;
  source: string;
  external_id: string;
  payload: Record<string, unknown>;
  retries: number;
  max_retries: number;
}

/**
 * Process a batch of pending staging records for a given company.
 */
export async function processBatch(companySlug: string): Promise<{
  processed: number;
  failed: number;
  skipped: number;
}> {
  let processed = 0;
  let failed = 0;
  const skipped = 0;
  const changedDomains = new Set<string>();

  // 1. Claim pending records with row-level locking
  const claimed = await db.execute<StagingRecord>(sql`
    WITH claimed AS (
      SELECT id FROM staging_records
      WHERE status = 'pending'
        AND company_slug = ${companySlug}
        AND (next_retry_at IS NULL OR next_retry_at <= now())
      ORDER BY created_at
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE staging_records
    SET status = 'processing',
        locked_by = 'reconciliation-worker',
        locked_until = now() + make_interval(mins => ${LOCK_DURATION_MINUTES}),
        updated_at = now()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING id, company_slug, source, external_id, payload, retries, max_retries
  `);

  if (!claimed.length) {
    return { processed: 0, failed: 0, skipped: 0 };
  }

  // Resolve the company's write queue port from DB
  const portRow = await db.execute<{ company_db_port: number }>(sql`
    SELECT company_db_port FROM companies WHERE slug = ${companySlug} LIMIT 1
  `);
  const basePort = portRow[0]?.company_db_port ?? 3100;
  const writeQueuePort = basePort + 1; // Write queue runs on port+1

  // 2. Process each record
  for (const row of claimed) {
    try {
      // Transform payload to QMD data
      const qmdData = transformToQmd(row.source, row.payload, row.external_id);
      if (!qmdData) {
        const error = `No supported QMD transform for source '${row.source}'`;
        await markFailed(row.id, error);
        failed++;
        continue;
      }

      // Submit to Write Queue
      const result = await submitToWriteQueue(row.company_slug, qmdData, writeQueuePort);

      // Mark as committed with traceability
      await markCompleted(row.id, result.commitSha, result.entityIds);
      changedDomains.add(qmdData.domain);
      processed++;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (row.retries + 1 >= row.max_retries) {
        // Exhausted retries — mark as failed
        await markFailed(row.id, error);
      } else {
        // Retry with exponential backoff
        await markRetry(row.id, row.retries + 1, error);
      }
      failed++;
    }
  }

  if (processed > 0 && changedDomains.size > 0) {
    try {
      await refreshSummaryTargets({
        companySlug,
        port: basePort,
        writeQueuePort,
        domains: Array.from(changedDomains),
        reason: "queue_write",
      });
    } catch (error) {
      console.warn("[summary-materializer] reconciliation refresh failed", error);
    }
  }

  return { processed, failed, skipped };
}

/**
 * Recover stale processing records (locked_until expired).
 */
export async function recoverStale(companySlug: string): Promise<number> {
  const result = await db.execute(sql`
    UPDATE staging_records
    SET status = 'pending', locked_until = NULL, locked_by = NULL, updated_at = now()
    WHERE status = 'processing'
      AND locked_until < now()
      AND company_slug = ${companySlug}
  `);
  return (result as unknown as { count: number }).count ?? 0;
}

// --- Internal helpers ---

async function markCompleted(id: string, commitSha: string | null, entityIds: string[] | null) {
  // Format entityIds as a PostgreSQL array literal (Drizzle raw SQL doesn't auto-serialize JS arrays)
  const entityIdsLiteral = entityIds
    ? `{${entityIds.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`
    : null;

  await db.execute(sql`
    UPDATE staging_records
    SET status = 'committed',
        commit_sha = ${commitSha},
        entity_ids = ${entityIdsLiteral}::TEXT[],
        locked_until = NULL,
        locked_by = NULL,
        updated_at = now()
    WHERE id = ${id}::uuid
  `);
}

async function markFailed(id: string, error: string) {
  await db.execute(sql`
    UPDATE staging_records
    SET status = 'failed',
        error = ${error},
        locked_until = NULL,
        locked_by = NULL,
        updated_at = now()
    WHERE id = ${id}::uuid
  `);
}

async function markRetry(id: string, retryCount: number, error: string) {
  const backoffMinutes = Math.pow(2, retryCount); // 2, 4, 8, 16, 32 min
  await db.execute(sql`
    UPDATE staging_records
    SET status = 'pending',
        retries = ${retryCount},
        next_retry_at = now() + make_interval(mins => ${backoffMinutes}),
        error = ${error},
        locked_until = NULL,
        locked_by = NULL,
        updated_at = now()
    WHERE id = ${id}::uuid
  `);
}

interface QmdData {
  domain: string;
  type: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  rawContent?: string;
  additionalFiles?: Array<{
    path: string;
    content: string;
  }>;
  commitMessage?: string;
  metadataSource?: string;
  metadataEntityId?: string;
}

/** @internal Exported for testing */
export function transformToQmd(source: string, payload: Record<string, unknown>, externalId?: string): QmdData | null {
  switch (source) {
    case "stripe":
      return transformStripeEvent(payload);
    case "plaid":
      return transformPlaidEvent();
    default:
      // CSV imports use source like "csv-import:mercury", "csv-import:wise", "csv-import:generic"
      if (source.startsWith("csv-import:")) {
        return transformCsvImportEvent(source, payload, externalId);
      }
      // Report imports use source like "report-import:profit_and_loss", "report-import:balance_sheet"
      if (source.startsWith("report-import:")) {
        return transformReportEvent(source, payload);
      }
      if (source.startsWith("canonical-finance-import:")) {
        return transformCanonicalFinanceEvent(source, payload);
      }
      if (source.startsWith("bank-balance-import:")) {
        return transformBankBalanceEvent(source, payload);
      }
      if (source.startsWith("codex-bundle:")) {
        return transformCodexBundleEvent(source, payload, externalId);
      }
      // Non-financial staging-first flow (Phase 4)
      if (source.startsWith("doc-import:")) {
        return transformDocumentImportEvent(source, payload, externalId);
      }
      return transformGenericEvent(source, payload, externalId);
  }
}

function transformStripeEvent(payload: Record<string, unknown>): QmdData | null {
  const type = payload.type as string;
  if (!type) return null;

  const data = (payload.data as Record<string, unknown>)?.object as Record<string, unknown> | undefined;
  if (!data) return null;

  if (type.startsWith("payment_intent.") || type.startsWith("charge.")) {
    const amount = (data.amount as number) / 100;
    const currency = (data.currency as string)?.toUpperCase() ?? "USD";
    const id = `stripe-${data.id}`;

    return {
      domain: "banking",
      type: "transaction",
      filePath: `banking/transactions/${id}.qmd`,
      frontmatter: {
        id,
        type: "transaction",
        source: "stripe",
        amount,
        currency,
        description: data.description || `Stripe ${type}`,
        status: data.status as string,
        date: new Date((data.created as number) * 1000).toISOString().split("T")[0],
        external_id: data.id,
      },
      body: `Stripe ${type}: ${amount} ${currency}`,
    };
  }

  return null;
}

function transformPlaidEvent(): QmdData | null {
  // Plaid webhooks are notification-only; actual data is fetched via API
  return null;
}

function transformCsvImportEvent(source: string, payload: Record<string, unknown>, externalId?: string): QmdData | null {
  const amount = payload.amount as number | undefined;
  const currency = (payload.currency as string) ?? "USD";
  const date = payload.date as string | undefined;
  const description = payload.description as string | undefined;
  const merchantName = payload.merchantName as string | undefined;
  const documentId = payload.documentId as string | undefined;
  const sourceRef = payload.sourceRef as string | undefined;

  if (amount == null || !date) return null;

  // Extract format from source string "csv-import:mercury" -> "mercury"
  const format = source.split(":")[1] ?? "generic";
  // Use deterministic ID: sourceRef > externalId > documentId (never Date.now())
  const id = sourceRef
    ? `csv-${format}-${sourceRef}`
    : `csv-${format}-${externalId ?? documentId ?? "unknown"}`;

  return {
    domain: "banking",
    type: "transaction",
    filePath: `banking/transactions/${id}.qmd`,
    frontmatter: {
      id,
      type: "transaction",
      source: `csv-import:${format}`,
      amount,
      currency,
      description: description || `CSV import (${format})`,
      merchant_name: merchantName || null,
      date: date.split("T")[0], // Keep just YYYY-MM-DD
      document_id: documentId,
      source_ref: sourceRef || null,
    },
    body: `CSV import (${format}): ${amount} ${currency}${description ? ` — ${description}` : ""}`,
  };
}

const DOC_IMPORT_ALLOWED_DOMAINS = new Set([
  "documents",
  "legal",
  "governance",
  "strategy",
  "tax",
  "operations",
  "assets",
]);

function sanitizePathSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeDocImportDomain(source: string): string {
  const raw = source.split(":")[1] ?? "documents";
  const clean = sanitizePathSegment(raw) || "documents";
  return DOC_IMPORT_ALLOWED_DOMAINS.has(clean) ? clean : "documents";
}

const CODEX_BUNDLE_ALLOWED_DOMAINS = new Set([
  "finance",
  "knowledge",
  "legal",
  "tax",
  "governance",
  "strategy",
  "operations",
  "assets",
  "documents",
]);

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeCodexBundleDomain(source: string, payloadDomain: unknown): string {
  const raw = asNonEmptyString(payloadDomain) ?? source.split(":")[1] ?? "documents";
  const clean = sanitizePathSegment(raw) || "documents";
  return CODEX_BUNDLE_ALLOWED_DOMAINS.has(clean) ? clean : "documents";
}

function transformCodexBundleEvent(
  source: string,
  payload: Record<string, unknown>,
  externalId?: string,
): QmdData | null {
  const filePath = asNonEmptyString(payload.filePath);
  const rawContent = typeof payload.content === "string" ? payload.content : null;
  if (!filePath || !rawContent || rawContent.trim().length === 0) return null;

  const domain = normalizeCodexBundleDomain(source, payload.domain);
  const entityId = asNonEmptyString(externalId) ?? filePath;
  const commitMessage = asNonEmptyString(payload.commitMessage) ?? `import(codex-bundle): ${entityId}`;

  return {
    domain,
    type: "codex_bundle_file",
    filePath,
    frontmatter: {
      id: entityId,
      type: "codex_bundle_file",
      source: "codex-bundle",
      document_id: payload.documentId ?? null,
    },
    body: "Codex bundle file",
    rawContent,
    commitMessage,
    metadataSource: "codex-bundle",
    metadataEntityId: entityId,
  };
}

function transformDocumentImportEvent(
  source: string,
  payload: Record<string, unknown>,
  externalId?: string,
): QmdData {
  const domain = normalizeDocImportDomain(source);
  const documentId = (payload.documentId as string | undefined) ?? "unknown";
  const documentType = (payload.documentType as string | undefined) ?? "unknown";
  const fileName = (payload.fileName as string | undefined) ?? null;
  const fileType = (payload.fileType as string | undefined) ?? null;
  const confidence =
    typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
      ? payload.confidence
      : null;
  const requiresReview =
    payload.requires_review === true || payload.needs_review === true;
  const reviewPending = payload.review_pending === true;
  const evidenceStatus =
    (payload.evidence_status as string | undefined)?.trim() || "captured";
  const ingestionMode =
    (payload.ingestion_mode as string | undefined)?.trim() ||
    (requiresReview ? "needs_review" : "auto_ingest");
  const ingestionReason =
    (payload.ingestion_reason as string | undefined)?.trim() ?? null;
  const documentKind = (payload.document_kind as string | undefined) ?? null;
  const targetDomain = (payload.target_domain as string | undefined) ?? domain;
  const targetEntityType = (payload.target_entity_type as string | undefined) ?? null;
  const safeType = sanitizePathSegment(documentType) || "unknown";
  const rawId = externalId ?? documentId;
  const id = `doc-import-${domain}-${sanitizePathSegment(rawId) || "unknown"}`;
  const filePath = `${domain}/imports/${safeType}/${id}.qmd`;

  const classification = payload.classification as Record<string, unknown> | undefined;
  const candidateDomains = Array.isArray(classification?.candidate_domains)
    ? classification?.candidate_domains ?? null
    : null;
  const routingReason = (classification?.routing_reason as string | undefined) ?? null;
  const bodyLines = [
    `# ${fileName ?? documentType}`,
    "",
    `- Evidence status: ${evidenceStatus}`,
    `- Ingestion mode: ${ingestionMode}`,
    `- Requires review: ${requiresReview ? "yes" : "no"}`,
    `- Review pending: ${reviewPending ? "yes" : "no"}`,
    `- Target domain: ${targetDomain}`,
    ...(documentKind ? [`- Document kind: ${documentKind}`] : []),
    ...(targetEntityType ? [`- Target entity type: ${targetEntityType}`] : []),
    ...(fileType ? [`- File type: ${fileType}`] : []),
    ...(confidence !== null ? [`- Confidence: ${confidence.toFixed(2)}`] : []),
    "",
    "## Processing Status",
    "",
    reviewPending
      ? "This source file is stored in Company-DB as evidence. Review is still required before the system should treat extracted facts as decision-grade."
      : "This source file is stored in Company-DB as evidence and is available for retrieval by agents and chat.",
    ...(ingestionReason
      ? ["", "## Ingestion Note", "", ingestionReason]
      : []),
    ...(candidateDomains && candidateDomains.length > 0
      ? ["", "## Routing Context", "", `- Candidate domains: ${candidateDomains.join(", ")}`]
      : []),
    ...(routingReason ? [`- Routing reason: ${routingReason}`] : []),
  ];

  return {
    domain,
    type: "document_import",
    filePath,
    frontmatter: {
      id,
      type: "document_import",
      domain,
      source,
      document_id: documentId,
      document_type: documentType,
      file_name: fileName,
      source_file_name: fileName,
      file_type: fileType,
      confidence,
      needs_review: payload.needs_review ?? null,
      requires_review: requiresReview,
      review_pending: reviewPending,
      evidence_status: evidenceStatus,
      ingestion_mode: ingestionMode,
      ingestion_reason: ingestionReason,
      document_kind: documentKind,
      target_domain: targetDomain,
      target_entity_type: targetEntityType,
      approved: payload.approved ?? null,
      classification: classification ?? null,
      candidate_domains: candidateDomains,
      routing_reason: routingReason,
      imported_at: new Date().toISOString(),
      source_mode: payload.source_mode ?? null,
      storage_key: payload.storage_key ?? null,
      storage_url: payload.storage_url ?? null,
    },
    body: bodyLines.join("\n"),
  };
}

type BankBalanceAccountPayload = {
  date?: unknown;
  makerBy?: unknown;
  maker_by?: unknown;
  companyName?: unknown;
  company_name?: unknown;
  bankName?: unknown;
  bank_name?: unknown;
  bankAccount?: unknown;
  bank_account?: unknown;
  purpose?: unknown;
  currency?: unknown;
  balance?: unknown;
  fxRate?: unknown;
  fx_rate?: unknown;
  balanceIdr?: unknown;
  balance_idr?: unknown;
  sourceSheet?: unknown;
  source_sheet?: unknown;
  sourceRow?: unknown;
  source_row?: unknown;
};

type BankBalanceCompanyPayload = {
  companyName?: unknown;
  company_name?: unknown;
  accountCount?: unknown;
  account_count?: unknown;
  currencies?: unknown;
  totalIdr?: unknown;
  total_idr?: unknown;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBankBalanceAccount(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const account = value as BankBalanceAccountPayload;
  const companyName = asNonEmptyString(account.companyName) ?? asNonEmptyString(account.company_name);
  const bankName = asNonEmptyString(account.bankName) ?? asNonEmptyString(account.bank_name);
  const bankAccount = asNonEmptyString(account.bankAccount) ?? asNonEmptyString(account.bank_account);
  const currency = normalizeCurrencyCode(account.currency);
  const balance = toFiniteNumber(account.balance);
  const balanceIdr = toFiniteNumber(account.balanceIdr ?? account.balance_idr);
  const date = asNonEmptyString(account.date);

  if (!date || !companyName || !bankName || !bankAccount || !currency || balance === null || balanceIdr === null) {
    return null;
  }

  return {
    date,
    maker_by: asNonEmptyString(account.makerBy) ?? asNonEmptyString(account.maker_by),
    company_name: companyName,
    bank_name: bankName,
    bank_account: bankAccount,
    purpose: asNonEmptyString(account.purpose),
    currency,
    balance,
    fx_rate: toFiniteNumber(account.fxRate ?? account.fx_rate) ?? (currency === "IDR" ? 1 : null),
    balance_idr: balanceIdr,
    source_sheet: asNonEmptyString(account.sourceSheet) ?? asNonEmptyString(account.source_sheet),
    source_row: toFiniteNumber(account.sourceRow ?? account.source_row),
  };
}

function normalizeBankBalanceCompany(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const company = value as BankBalanceCompanyPayload;
  const companyName = asNonEmptyString(company.companyName) ?? asNonEmptyString(company.company_name);
  const totalIdr = toFiniteNumber(company.totalIdr ?? company.total_idr);
  if (!companyName || totalIdr === null) return null;
  const rawCurrencies = Array.isArray(company.currencies) ? company.currencies : [];

  return {
    company_name: companyName,
    account_count: Math.trunc(toFiniteNumber(company.accountCount ?? company.account_count) ?? 0),
    currencies: rawCurrencies
      .map((currency) => normalizeCurrencyCode(currency))
      .filter((currency): currency is string => Boolean(currency)),
    total_idr: totalIdr,
  };
}

function buildBankBalanceBody(input: {
  asOfDate: string;
  sourceDocumentName: string | null;
  totalIdr: number;
  companies: Record<string, unknown>[];
  accounts: Record<string, unknown>[];
}): string {
  const lines = [
    `# Bank Balance Snapshot - ${input.asOfDate}`,
    "",
    `Source document: ${input.sourceDocumentName ?? "unknown"}`,
    `Reporting currency: IDR`,
    `Total balance: IDR ${formatNumber(input.totalIdr)}`,
    "",
    "## Company Totals",
    "",
    "| Company | Accounts | Currencies | Total IDR |",
    "|---------|----------|------------|-----------|",
  ];

  for (const company of input.companies) {
    const currencies = Array.isArray(company.currencies) ? company.currencies.join(", ") : "";
    lines.push(
      `| ${escapeTableCell(company.company_name)} | ${company.account_count ?? 0} | ${escapeTableCell(currencies)} | ${formatNumber(Number(company.total_idr ?? 0))} |`,
    );
  }

  lines.push("", "## Account Drilldown");

  const byCompany = new Map<string, Record<string, unknown>[]>();
  for (const account of input.accounts) {
    const companyName = String(account.company_name ?? "Unknown");
    const bucket = byCompany.get(companyName) ?? [];
    bucket.push(account);
    byCompany.set(companyName, bucket);
  }

  for (const [companyName, companyAccounts] of byCompany.entries()) {
    lines.push(
      "",
      `### ${companyName}`,
      "",
      "| Bank | Account | Purpose | Currency | Balance | FX | IDR Equivalent | Source |",
      "|------|---------|---------|----------|---------|----|----------------|--------|",
    );
    for (const account of companyAccounts) {
      const sourceRef = [
        account.source_sheet,
        account.source_row ? `row ${account.source_row}` : null,
      ].filter(Boolean).join(" ");
      lines.push(
        `| ${escapeTableCell(account.bank_name)} | ${escapeTableCell(account.bank_account)} | ${escapeTableCell(account.purpose)} | ${account.currency} | ${formatNumber(Number(account.balance ?? 0))} | ${account.fx_rate ?? ""} | ${formatNumber(Number(account.balance_idr ?? 0))} | ${escapeTableCell(sourceRef)} |`,
      );
    }
  }

  lines.push(
    "",
    "## Drill-Down Rule",
    "",
    "This Company-DB record is the latest imported bank-balance snapshot. Account-level drill-down should use the original workbook row reference or the bank portal source; this record is a dashboard-ready summary, not a bank statement ledger.",
  );

  return lines.join("\n");
}

function transformBankBalanceEvent(
  source: string,
  payload: Record<string, unknown>,
): QmdData | null {
  const snapshot =
    typeof payload.snapshot === "object" && payload.snapshot !== null
      ? payload.snapshot as Record<string, unknown>
      : null;
  if (!snapshot) return null;

  const asOfDate = asNonEmptyString(snapshot.asOfDate) ?? asNonEmptyString(snapshot.as_of_date);
  if (!asOfDate) return null;

  const accounts = (Array.isArray(snapshot.accounts) ? snapshot.accounts : [])
    .map(normalizeBankBalanceAccount)
    .filter((account): account is Record<string, unknown> => account !== null)
    .sort((left, right) => Math.abs(Number(right.balance_idr ?? 0)) - Math.abs(Number(left.balance_idr ?? 0)));
  if (accounts.length === 0) return null;

  const companies = (Array.isArray(snapshot.companies) ? snapshot.companies : [])
    .map(normalizeBankBalanceCompany)
    .filter((company): company is Record<string, unknown> => company !== null)
    .sort((left, right) => Math.abs(Number(right.total_idr ?? 0)) - Math.abs(Number(left.total_idr ?? 0)));
  const sourceSheets = Array.isArray(snapshot.sourceSheets)
    ? snapshot.sourceSheets
    : Array.isArray(snapshot.source_sheets)
      ? snapshot.source_sheets
      : [];
  const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
  const totalIdr =
    toFiniteNumber(snapshot.totalIdr ?? snapshot.total_idr) ??
    accounts.reduce((sum, account) => sum + Number(account.balance_idr ?? 0), 0);
  const id = `bank-balance-snapshot-${slugify(asOfDate)}`;
  const sourceDocumentName = asNonEmptyString(payload.source_document_name);
  const filePath = `finance/bank-balances/${slugify(asOfDate)}/snapshot.qmd`;

  return {
    domain: "finance",
    type: "bank_balance_snapshot",
    filePath,
    frontmatter: {
      id,
      type: "bank_balance_snapshot",
      report_type: "bank_balance_snapshot",
      source,
      document_id: payload.document_id ?? payload.documentId ?? null,
      source_document_name: sourceDocumentName,
      as_of_date: asOfDate,
      period: asOfDate,
      period_key: asOfDate,
      reporting_currency: "IDR",
      currency: "IDR",
      total_balance: { amount: Number(totalIdr.toFixed(2)), currency: "IDR" },
      total_balance_idr: Number(totalIdr.toFixed(2)),
      company_count: companies.length,
      account_count: accounts.length,
      company_totals: companies,
      accounts,
      source_sheets: sourceSheets,
      warnings,
      imported_at: new Date().toISOString(),
    },
    body: buildBankBalanceBody({
      asOfDate,
      sourceDocumentName,
      totalIdr,
      companies,
      accounts,
    }),
    metadataSource: source,
    metadataEntityId: id,
  };
}

function transformGenericEvent(source: string, payload: Record<string, unknown>, externalId?: string): QmdData | null {
  const id = `${source}-${externalId ?? payload.id ?? "unknown"}`;
  return {
    domain: "integrations",
    type: "raw_event",
    filePath: `integrations/imports/${source}/${id}.qmd`,
    frontmatter: {
      id,
      type: "raw_event",
      source,
      ...payload,
    },
    body: `Imported from ${source}`,
  };
}

// --- Report import transformer ---

interface ReportLineItemPayload {
  account_name: string;
  account_number?: string;
  section: string;
  subsection?: string;
  values: Record<string, number | null>;
  depth: number;
  is_total: boolean;
  source: {
    sheet: string;
    row: number;
    columns: Record<string, string>;
  };
}

interface ReportingPeriodPayload {
  start: string;
  end: string;
  label?: string;
}

interface SnapshotSummaryMetrics {
  revenue?: number;
  expenses?: number;
  operating_expenses?: number;
  cost_of_sales?: number;
  gross_profit?: number;
  net_income?: number;
  cash_position?: number;
  inventory?: number;
  total_current_assets?: number;
  fixed_assets?: number;
  total_assets?: number;
  total_liabilities?: number;
  equity?: number;
  retained_earnings?: number;
  inflows?: number;
  outflows?: number;
  net_cash_flow?: number;
  runway_months?: number;
}

type CanonicalFinancePayload = {
  document_id?: string;
  documentId?: string;
  company_currency?: string | null;
  record?: CanonicalFinanceRecord;
};

function resolveCanonicalDocumentId(payload: CanonicalFinancePayload): string | null {
  return payload.document_id ?? payload.documentId ?? null;
}

function resolveCanonicalCurrency(
  recordCurrency: string | null,
  companyCurrency: string | null | undefined,
): string {
  return normalizeCurrencyCode(recordCurrency) ?? normalizeCurrencyCode(companyCurrency) ?? "USD";
}

function toMoneyAmount(value: number | null, currency: string): { amount: number; currency: string } | null {
  return value === null ? null : { amount: value, currency };
}

function canonicalStatementFileName(record: CanonicalFinanceRecord): string {
  if (record.family === "financial_projection_plan" || record.family === "metrics_daily") {
    return `${record.period_key}.qmd`;
  }
  return record.book === "actual" ? `${record.period_key}.qmd` : `${record.period_key}-${slugify(record.book)}.qmd`;
}

function canonicalRecordId(record: CanonicalFinanceRecord): string {
  switch (record.family) {
    case "pnl_month":
      return `income-statement-${slugify(record.book)}-${slugify(record.period_key)}-${slugify(record.scope_key)}`;
    case "balance_sheet_month":
      return `balance-sheet-${slugify(record.book)}-${slugify(record.period_key)}-${slugify(record.scope_key)}`;
    case "cash_flow_month":
      return `cash-flow-${slugify(record.book)}-${slugify(record.period_key)}-${slugify(record.scope_key)}`;
    case "financial_projection_plan":
      return `forecast-${slugify(record.plan_key)}-${slugify(record.scenario_key)}-${slugify(record.period_key)}-${slugify(record.scope_key)}`;
    case "metrics_daily":
      return `metrics-daily-${slugify(record.template_key)}-${slugify(record.period_key)}-${slugify(record.scope_key)}`;
  }
}

function canonicalRecordPath(record: CanonicalFinanceRecord): { domain: string; type: string; filePath: string } {
  const fileName = canonicalStatementFileName(record);
  switch (record.family) {
    case "pnl_month":
      return {
        domain: "finance",
        type: "income_statement",
        filePath: `finance/statements/pnl/${slugify(record.scope_key)}/${fileName}`,
      };
    case "balance_sheet_month":
      return {
        domain: "finance",
        type: "balance_sheet",
        filePath: `finance/statements/balance-sheet/${slugify(record.scope_key)}/${fileName}`,
      };
    case "cash_flow_month":
      return {
        domain: "finance",
        type: "cash_flow_statement",
        filePath: `finance/statements/cash-flow/${slugify(record.scope_key)}/${fileName}`,
      };
    case "financial_projection_plan":
      return {
        domain: "finance",
        type: "forecast",
        filePath:
          `finance/projections/${slugify(record.plan_key)}/${slugify(record.scenario_key)}/${slugify(record.scope_key)}/${fileName}`,
      };
    case "metrics_daily":
      return {
        domain: "metrics",
        type: "metrics_daily",
        filePath: `metrics/daily/${slugify(record.scope_key)}/${slugify(record.template_key)}/${fileName}`,
      };
  }
}

function canonicalSourceRefsSummary(sourceRefs: CanonicalFinanceSourceRef[]): {
  source_sheet: string | null;
  source_range: string | null;
  source_count: number;
} {
  if (sourceRefs.length === 0) {
    return { source_sheet: null, source_range: null, source_count: 0 };
  }

  const sheets = Array.from(
    new Set(
      sourceRefs
        .map((sourceRef) => sourceRef.sheet_name)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const ranges = Array.from(
    new Set(
      sourceRefs
        .map((sourceRef) => sourceRef.cell_range)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return {
    source_sheet: sheets.length > 0 ? sheets.join(",") : null,
    source_range: ranges.length > 0 ? ranges.join(",") : null,
    source_count: sourceRefs.length,
  };
}

function computeCanonicalProjectionExpenses(record: CanonicalFinancialProjectionPlan): number | null {
  const operatingExpenses = record.values.operating_expenses;
  const costOfSales = record.values.cost_of_sales;
  if (operatingExpenses === null && costOfSales === null) return null;
  return (operatingExpenses ?? 0) + (costOfSales ?? 0);
}

function buildStatementLinesSidecar(
  record: CanonicalPnlMonth | CanonicalBalanceSheetMonth | CanonicalCashFlowMonth | CanonicalFinancialProjectionPlan,
  typedPayload: CanonicalFinancePayload,
  filePath: string,
): string {
  const frontmatter = {
    schema: "canonical-finance-statement-lines/v1",
    type: "statement_lines_technical",
    canonical_file_path: filePath,
    family: record.family,
    period_key: record.period_key,
    period: record.period,
    book: record.book,
    currency: resolveCanonicalCurrency(record.currency, typedPayload.company_currency),
    scope_key: record.scope_key,
    scope_label: record.scope_label,
    company_wide: record.company_wide,
    document_id: resolveCanonicalDocumentId(typedPayload),
    source_document_name: record.source_document_name,
    source_refs: record.source_refs,
    statement_line_count: record.statement_lines.length,
    statement_sections: Array.from(
      new Set(
        record.statement_lines
          .filter((line) => line.line_kind === "section" && line.section_label)
          .map((line) => line.section_label),
      ),
    ),
  } satisfies Record<string, unknown>;

  const body = [
    "# Statement Lines Technical Dump",
    "",
    "```json",
    JSON.stringify(
      {
        statement_lines: record.statement_lines,
      },
      null,
      2,
    ),
    "```",
  ].join("\n");

  return formatQmd(frontmatter, body);
}

function stripUndefinedFields<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as T;
}

function normalizeStatementLabel(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMeaningfulNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) > 0.000001;
}

function roundFinancialMetric(value: number | null): number | null {
  if (!isMeaningfulNumber(value)) return value === 0 ? 0 : null;
  return Number(value.toFixed(2));
}

function chooseMeaningfulMetric(primary: number | null, fallback: number | null): number | null {
  if (isMeaningfulNumber(primary)) return primary;
  if (isMeaningfulNumber(fallback)) return fallback;
  return primary ?? fallback;
}

function sumPositive(values: Array<number | null>): number {
  const total = values.reduce<number>(
    (sum, value) => sum + (isMeaningfulNumber(value) && value > 0 ? value : 0),
    0,
  );
  return Number(total.toFixed(2));
}

function sumNegativeMagnitude(values: Array<number | null>): number {
  const total = values.reduce<number>(
    (sum, value) => sum + (isMeaningfulNumber(value) && value < 0 ? Math.abs(value) : 0),
    0,
  );
  return Number(total.toFixed(2));
}

function lineMatchesAny(
  value: string | null | undefined,
  keywords: readonly string[],
): boolean {
  const normalized = normalizeStatementLabel(value);
  if (!normalized) return false;
  return keywords.some((keyword) => normalized.includes(keyword));
}

function lineEqualsAny(
  value: string | null | undefined,
  keywords: readonly string[],
): boolean {
  const normalized = normalizeStatementLabel(value);
  if (!normalized) return false;
  return keywords.some((keyword) => normalized === keyword);
}

function statementLineRank(line: CanonicalStatementLine): number {
  switch (line.line_kind) {
    case "total":
      return 0;
    case "group":
      return 1;
    case "line_item":
      return 2;
    case "section":
      return 3;
    default:
      return 4;
  }
}

function compareStatementLineCandidates(
  left: CanonicalStatementLine,
  right: CanonicalStatementLine,
): number {
  const rankDelta = statementLineRank(left) - statementLineRank(right);
  if (rankDelta !== 0) return rankDelta;

  const magnitudeDelta = Math.abs((right.value ?? 0)) - Math.abs((left.value ?? 0));
  if (magnitudeDelta !== 0) return magnitudeDelta;

  return right.row_order - left.row_order;
}

function findStatementLineValue(
  lines: CanonicalStatementLine[],
  keywords: readonly string[],
): number | null {
  const candidates = lines.filter((line) => lineMatchesAny(line.label, keywords));
  const nonZero = [...candidates]
    .filter((line) => isMeaningfulNumber(line.value))
    .sort(compareStatementLineCandidates)[0];
  if (nonZero) return roundFinancialMetric(nonZero.value);

  const fallback = [...candidates]
    .filter((line) => line.value !== null)
    .sort(compareStatementLineCandidates)[0];
  return roundFinancialMetric(fallback?.value ?? null);
}

function findExactStatementLineValue(
  lines: CanonicalStatementLine[],
  keywords: readonly string[],
): number | null {
  const candidates = lines.filter((line) => lineEqualsAny(line.label, keywords));
  const nonZero = [...candidates]
    .filter((line) => isMeaningfulNumber(line.value))
    .sort(compareStatementLineCandidates)[0];
  if (nonZero) return roundFinancialMetric(nonZero.value);

  const fallback = [...candidates]
    .filter((line) => line.value !== null)
    .sort(compareStatementLineCandidates)[0];
  return roundFinancialMetric(fallback?.value ?? null);
}

function sumStatementLines(
  lines: CanonicalStatementLine[],
  predicate: (line: CanonicalStatementLine) => boolean,
): number | null {
  const values = lines
    .filter(
      (line): line is CanonicalStatementLine & { value: number } =>
        line.line_kind === "line_item" && isMeaningfulNumber(line.value),
    )
    .filter(predicate)
    .map((line) => line.value);
  if (values.length === 0) return null;
  const total = values.reduce<number>((sum, value) => sum + value, 0);
  return Number(total.toFixed(2));
}

function extractStatementAccountCode(line: CanonicalStatementLine): string | null {
  const explicitCode = String(line.account_code ?? "").trim();
  if (explicitCode) {
    const normalized = explicitCode.replace(/[^0-9]/g, "");
    if (normalized.length > 0) return normalized;
  }

  const label = String(line.label ?? "").trim();
  const match = label.match(/[A-Za-z]*?(\d{4,})/);
  if (!match?.[1]) return null;
  return match[1];
}

function lineHasAccountPrefix(
  line: CanonicalStatementLine,
  prefixes: readonly string[],
): boolean {
  const accountCode = extractStatementAccountCode(line);
  if (!accountCode) return false;
  return prefixes.some((prefix) => accountCode.startsWith(prefix));
}

function preferDerivedMetric(current: number | null, derived: number | null): number | null {
  if (derived === null) return current;
  if (current === null) return derived;
  if (!isMeaningfulNumber(current) && isMeaningfulNumber(derived)) return derived;
  return current;
}

const PNL_FALLBACK_LABELS = {
  revenue: ["total trading income", "total revenue", "trading income", "revenue"],
  revenueExact: ["total trading income", "total revenue"],
  revenueAccountPrefixes: ["4"],
  costOfSales: ["total cost of sales", "cost of sales"],
  costOfSalesExact: ["total cost of sales", "cost of sales", "cost of revenue"],
  costOfSalesAccountPrefixes: ["5"],
  grossProfit: ["gross profit"],
  netIncome: ["net profit", "net income"],
  otherIncome: ["total other income", "other income"],
  otherExpenses: ["total other expense", "total other expenses", "other expense", "other expenses"],
  operatingExpenses: ["total operating expenses", "total operating expense", "operating expenses"],
  operatingExpensesExact: ["total operating expenses", "total operating expense", "operating expenses", "expenses"],
  operatingExpensesAccountPrefixes: ["6"],
  interestExpense: ["interest expense", "finance cost", "financial charges", "interest charges"],
  taxExpense: ["tax expense", "tax expenses", "income tax", "corporate income tax"],
  depreciation: ["depreciation", "amortization"],
  tradingIncomeSection: ["trading income", "income", "revenue"],
  costOfSalesSection: ["cost of sales", "cogs"],
  operatingExpensesSection: ["operating expenses", "operating expense"],
} as const;

const BALANCE_SHEET_FALLBACK_LABELS = {
  cash: ["total cash and bank", "cash and bank", "cash and cash equivalents", "total bank"],
  totalCurrentAssets: ["total current assets", "current assets"],
  otherNonCurrentAssets: [
    "other non current assets",
    "other non-current assets",
    "plus non current assets",
    "plus non-current assets",
    "total non current assets",
    "total non-current assets",
  ],
  fixedAssets: ["total fixed assets", "fixed assets", "plus fixed assets"],
  totalAssets: ["total assets", "assets"],
  totalCurrentLiabilities: ["total current liabilities", "current liabilities"],
  totalLiabilities: ["total liabilities", "liabilities"],
  equity: ["total equity", "net assets", "shareholders funds", "equity"],
  retainedEarnings: ["retained earnings"],
  bankGroup: ["bank"],
  fixedAssetsGroup: ["fixed assets"],
  assetsAccountPrefixes: ["1"],
  liabilitiesAccountPrefixes: ["2"],
  equityAccountPrefixes: ["3"],
  nonCurrentLiabilities: [
    "long term liabilities",
    "long-term liabilities",
    "non current liabilities",
    "non-current liabilities",
    "long term debt",
    "long-term debt",
  ],
  liabilitiesSection: ["liabilities"],
  equitySection: ["equity"],
} as const;

function resolveCanonicalPnlRecord(record: CanonicalPnlMonth): CanonicalPnlMonth {
  const revenueSectionSum = sumStatementLines(record.statement_lines, (line) => {
    const sectionLabel = line.section_label ?? "";
    return (
      lineMatchesAny(sectionLabel, PNL_FALLBACK_LABELS.tradingIncomeSection) &&
      !lineMatchesAny(sectionLabel, PNL_FALLBACK_LABELS.costOfSalesSection) &&
      !lineMatchesAny(sectionLabel, ["cost of revenue"])
    );
  });
  const revenueFromLines = chooseMeaningfulMetric(
    findExactStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.revenueExact),
    chooseMeaningfulMetric(
      revenueSectionSum,
      chooseMeaningfulMetric(
        sumStatementLines(record.statement_lines, (line) =>
          lineHasAccountPrefix(line, PNL_FALLBACK_LABELS.revenueAccountPrefixes),
        ),
        findStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.revenue),
      ),
    ),
  );
  const costOfSalesFromLines = chooseMeaningfulMetric(
    findExactStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.costOfSalesExact),
    chooseMeaningfulMetric(
      sumStatementLines(record.statement_lines, (line) =>
        lineMatchesAny(line.section_label, PNL_FALLBACK_LABELS.costOfSalesSection),
      ),
      chooseMeaningfulMetric(
        sumStatementLines(record.statement_lines, (line) =>
          lineHasAccountPrefix(line, PNL_FALLBACK_LABELS.costOfSalesAccountPrefixes),
        ),
        findStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.costOfSales),
      ),
    ),
  );
  const grossProfitFromLines = chooseMeaningfulMetric(
    findStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.grossProfit),
    (revenueFromLines !== null && costOfSalesFromLines !== null
      ? roundFinancialMetric(revenueFromLines - costOfSalesFromLines)
      : null),
  );
  const otherIncomeFromLines = findStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.otherIncome);
  const otherExpensesFromLines = findStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.otherExpenses);
  const operatingExpensesFromLines = chooseMeaningfulMetric(
    findExactStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.operatingExpensesExact),
    chooseMeaningfulMetric(
      sumStatementLines(record.statement_lines, (line) =>
        lineMatchesAny(line.section_label, PNL_FALLBACK_LABELS.operatingExpensesSection),
      ),
      chooseMeaningfulMetric(
        sumStatementLines(record.statement_lines, (line) =>
          lineHasAccountPrefix(line, PNL_FALLBACK_LABELS.operatingExpensesAccountPrefixes),
        ),
        findStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.operatingExpenses),
      ),
    ),
  );
  const depreciationFromLines = chooseMeaningfulMetric(
    findStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.depreciation),
    sumStatementLines(record.statement_lines, (line) =>
      lineMatchesAny(line.label, PNL_FALLBACK_LABELS.depreciation),
    ),
  );
  const interestExpenseFromLines = findStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.interestExpense);
  const taxExpenseFromLines = findStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.taxExpense);

  const resolvedRevenue = preferDerivedMetric(record.values.revenue, revenueFromLines);
  const resolvedCostOfSales = preferDerivedMetric(record.values.cost_of_sales, costOfSalesFromLines);
  const resolvedGrossProfit = preferDerivedMetric(record.values.gross_profit, grossProfitFromLines);
  const resolvedOtherIncome = preferDerivedMetric(record.values.other_income, otherIncomeFromLines);
  const resolvedOtherExpenses = preferDerivedMetric(record.values.other_expenses, otherExpensesFromLines);
  const resolvedOperatingExpenses = preferDerivedMetric(
    record.values.operating_expenses,
    operatingExpensesFromLines,
  );
  const resolvedDepreciation = preferDerivedMetric(
    record.values.depreciation_amortization,
    depreciationFromLines,
  );
  const resolvedInterestExpense = preferDerivedMetric(
    record.values.interest_expense,
    interestExpenseFromLines,
  );
  const resolvedTaxExpense = preferDerivedMetric(record.values.tax_expense, taxExpenseFromLines);
  const netIncomeFromLines = chooseMeaningfulMetric(
    findStatementLineValue(record.statement_lines, PNL_FALLBACK_LABELS.netIncome),
    (() => {
      if (resolvedGrossProfit === null || resolvedOperatingExpenses === null) return null;
      const candidate =
        resolvedGrossProfit +
        (resolvedOtherIncome ?? 0) -
        (resolvedOtherExpenses ?? 0) -
        resolvedOperatingExpenses -
        (resolvedDepreciation ?? 0) -
        (resolvedInterestExpense ?? 0) -
        (resolvedTaxExpense ?? 0);
      return roundFinancialMetric(candidate);
    })(),
  );
  const resolvedNetIncome = preferDerivedMetric(record.values.net_income, netIncomeFromLines);

  return {
    ...record,
    values: {
      ...record.values,
      revenue: resolvedRevenue,
      cost_of_sales: resolvedCostOfSales,
      gross_profit: resolvedGrossProfit,
      other_income: resolvedOtherIncome,
      other_expenses: resolvedOtherExpenses,
      operating_expenses: resolvedOperatingExpenses,
      depreciation_amortization: resolvedDepreciation,
      interest_expense: resolvedInterestExpense,
      tax_expense: resolvedTaxExpense,
      net_income: resolvedNetIncome,
    },
  };
}

function resolveCanonicalBalanceSheetRecord(
  record: CanonicalBalanceSheetMonth,
): CanonicalBalanceSheetMonth {
  const cashFromLines = chooseMeaningfulMetric(
    findStatementLineValue(record.statement_lines, BALANCE_SHEET_FALLBACK_LABELS.cash),
    sumStatementLines(record.statement_lines, (line) =>
      lineMatchesAny(line.group_label, BALANCE_SHEET_FALLBACK_LABELS.bankGroup),
    ),
  );
  const totalCurrentAssetsFromLines = chooseMeaningfulMetric(
    findExactStatementLineValue(record.statement_lines, BALANCE_SHEET_FALLBACK_LABELS.totalCurrentAssets),
    chooseMeaningfulMetric(
      sumStatementLines(record.statement_lines, (line) => {
        const inAssets = lineMatchesAny(line.section_label, ["assets"]);
        const inFixedAssets = lineMatchesAny(line.group_label, BALANCE_SHEET_FALLBACK_LABELS.fixedAssetsGroup);
        return inAssets && !inFixedAssets;
      }),
      sumStatementLines(record.statement_lines, (line) =>
        lineHasAccountPrefix(line, BALANCE_SHEET_FALLBACK_LABELS.assetsAccountPrefixes),
      ),
    ),
  );
  const fixedAssetsFromLines = chooseMeaningfulMetric(
    findExactStatementLineValue(record.statement_lines, BALANCE_SHEET_FALLBACK_LABELS.fixedAssets),
    sumStatementLines(record.statement_lines, (line) =>
      lineMatchesAny(line.group_label, BALANCE_SHEET_FALLBACK_LABELS.fixedAssetsGroup),
    ),
  );
  const otherNonCurrentAssetsFromLines = chooseMeaningfulMetric(
    findExactStatementLineValue(record.statement_lines, BALANCE_SHEET_FALLBACK_LABELS.otherNonCurrentAssets),
    null,
  );
  const totalAssetsFromLines = chooseMeaningfulMetric(
    findExactStatementLineValue(record.statement_lines, BALANCE_SHEET_FALLBACK_LABELS.totalAssets),
    (() => {
      if (
        totalCurrentAssetsFromLines === null &&
        fixedAssetsFromLines === null &&
        otherNonCurrentAssetsFromLines === null
      ) {
        return sumStatementLines(record.statement_lines, (line) =>
          lineHasAccountPrefix(line, BALANCE_SHEET_FALLBACK_LABELS.assetsAccountPrefixes),
        );
      }
      return roundFinancialMetric(
        (totalCurrentAssetsFromLines ?? 0) +
        (fixedAssetsFromLines ?? 0) +
        (otherNonCurrentAssetsFromLines ?? 0),
      );
    })(),
  );
  const totalLiabilitiesFromLines = chooseMeaningfulMetric(
    findExactStatementLineValue(record.statement_lines, BALANCE_SHEET_FALLBACK_LABELS.totalLiabilities),
    chooseMeaningfulMetric(
      sumStatementLines(record.statement_lines, (line) =>
        lineMatchesAny(line.section_label, BALANCE_SHEET_FALLBACK_LABELS.liabilitiesSection),
      ),
      sumStatementLines(record.statement_lines, (line) =>
        lineHasAccountPrefix(line, BALANCE_SHEET_FALLBACK_LABELS.liabilitiesAccountPrefixes),
      ),
    ),
  );
  const totalCurrentLiabilitiesFromLines = findExactStatementLineValue(
    record.statement_lines,
    BALANCE_SHEET_FALLBACK_LABELS.totalCurrentLiabilities,
  ) ??
    sumStatementLines(record.statement_lines, (line) =>
      lineMatchesAny(line.section_label, BALANCE_SHEET_FALLBACK_LABELS.liabilitiesSection) &&
        !lineMatchesAny(line.group_label, BALANCE_SHEET_FALLBACK_LABELS.nonCurrentLiabilities) &&
        !lineMatchesAny(line.label, BALANCE_SHEET_FALLBACK_LABELS.nonCurrentLiabilities),
    );
  const equityFromLines = chooseMeaningfulMetric(
    findExactStatementLineValue(record.statement_lines, BALANCE_SHEET_FALLBACK_LABELS.equity),
    chooseMeaningfulMetric(
      sumStatementLines(record.statement_lines, (line) =>
        lineMatchesAny(line.section_label, BALANCE_SHEET_FALLBACK_LABELS.equitySection),
      ) ??
        sumStatementLines(record.statement_lines, (line) =>
          lineHasAccountPrefix(line, BALANCE_SHEET_FALLBACK_LABELS.equityAccountPrefixes),
        ),
      (() => {
        if (totalAssetsFromLines === null || totalLiabilitiesFromLines === null) return null;
        return roundFinancialMetric(totalAssetsFromLines - totalLiabilitiesFromLines);
      })(),
    ),
  );
  const retainedEarningsFromLines = findStatementLineValue(
    record.statement_lines,
    BALANCE_SHEET_FALLBACK_LABELS.retainedEarnings,
  );

  return {
    ...record,
    values: {
      ...record.values,
      cash_and_equivalents: preferDerivedMetric(record.values.cash_and_equivalents, cashFromLines),
      total_current_assets: preferDerivedMetric(
        record.values.total_current_assets,
        totalCurrentAssetsFromLines,
      ),
      fixed_assets: preferDerivedMetric(record.values.fixed_assets, fixedAssetsFromLines),
      total_assets: preferDerivedMetric(record.values.total_assets, totalAssetsFromLines),
      total_liabilities: preferDerivedMetric(
        record.values.total_liabilities,
        totalLiabilitiesFromLines,
      ),
      total_current_liabilities: preferDerivedMetric(
        record.values.total_current_liabilities,
        totalCurrentLiabilitiesFromLines,
      ),
      equity: preferDerivedMetric(record.values.equity, equityFromLines),
      retained_earnings: preferDerivedMetric(
        record.values.retained_earnings,
        retainedEarningsFromLines,
      ),
    },
  };
}

function resolveCanonicalRecordMetrics(record: CanonicalFinanceRecord): CanonicalFinanceRecord {
  switch (record.family) {
    case "pnl_month":
      return resolveCanonicalPnlRecord(record);
    case "balance_sheet_month":
      return resolveCanonicalBalanceSheetRecord(record);
    default:
      return record;
  }
}

function buildCanonicalSummaryMetrics(record: CanonicalFinanceRecord): SnapshotSummaryMetrics | undefined {
  switch (record.family) {
    case "pnl_month": {
      const expenses =
        record.values.operating_expenses === null && record.values.cost_of_sales === null
          ? undefined
          : (record.values.operating_expenses ?? 0) + (record.values.cost_of_sales ?? 0);
      return stripUndefinedFields({
        revenue: record.values.revenue ?? undefined,
        expenses,
        operating_expenses: record.values.operating_expenses ?? undefined,
        cost_of_sales: record.values.cost_of_sales ?? undefined,
        gross_profit: record.values.gross_profit ?? undefined,
        net_income: record.values.net_income ?? undefined,
      });
    }
    case "balance_sheet_month":
      return stripUndefinedFields({
        cash_position: record.values.cash_and_equivalents ?? undefined,
        inventory: record.values.inventory ?? undefined,
        total_current_assets: record.values.total_current_assets ?? undefined,
        fixed_assets: record.values.fixed_assets ?? undefined,
        total_assets: record.values.total_assets ?? undefined,
        total_liabilities: record.values.total_liabilities ?? undefined,
        equity: record.values.equity ?? undefined,
        retained_earnings: record.values.retained_earnings ?? undefined,
      });
    case "cash_flow_month":
      return stripUndefinedFields({
        cash_position: record.values.closing_cash ?? undefined,
        inflows:
          record.values.cash_from_operations === null &&
          record.values.cash_from_investing === null &&
          record.values.cash_from_financing === null
            ? undefined
            : sumPositive([
                record.values.cash_from_operations,
                record.values.cash_from_investing,
                record.values.cash_from_financing,
              ]),
        outflows:
          record.values.cash_from_operations === null &&
          record.values.cash_from_investing === null &&
          record.values.cash_from_financing === null
            ? undefined
            : sumNegativeMagnitude([
                record.values.cash_from_operations,
                record.values.cash_from_investing,
                record.values.cash_from_financing,
              ]),
        net_cash_flow: record.values.net_cash_flow ?? undefined,
      });
    case "financial_projection_plan":
      return stripUndefinedFields({
        revenue: record.values.revenue ?? undefined,
        expenses: computeCanonicalProjectionExpenses(record) ?? undefined,
        operating_expenses: record.values.operating_expenses ?? undefined,
        cost_of_sales: record.values.cost_of_sales ?? undefined,
        gross_profit: record.values.gross_profit ?? undefined,
        net_income: record.values.net_income ?? undefined,
      });
    case "metrics_daily":
      return undefined;
  }
}

function isCanonicalStatementRecord(
  record: CanonicalFinanceRecord,
): record is
  | CanonicalPnlMonth
  | CanonicalBalanceSheetMonth
  | CanonicalCashFlowMonth
  | CanonicalFinancialProjectionPlan {
  return record.family !== "metrics_daily";
}

function escapeTableCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function buildCanonicalFinanceBody(record: CanonicalFinanceRecord): string {
  const sections: string[] = [];
  sections.push(`# ${titleCase(record.family)} — ${record.period.label ?? record.period_key}`);
  sections.push("");
  sections.push(`- Scope: ${record.scope_label}`);
  sections.push(`- Book: ${record.book}`);
  sections.push(`- Review status: ${record.review_status}`);
  if (record.warnings.length > 0) {
    sections.push(`- Warnings: ${record.warnings.join(", ")}`);
  }

  if (record.family === "metrics_daily") {
    sections.push("");
    sections.push("## Metrics");
    sections.push("");
    sections.push("| Metric | Value | Unit |");
    sections.push("|--------|-------|------|");
    for (const metric of record.metric_values) {
      sections.push(`| ${metric.label} | ${metric.value ?? ""} | ${metric.unit} |`);
    }
    return sections.join("\n");
  }

  const rows: Array<[string, number | null]> =
    record.family === "pnl_month"
      ? [
          ["Revenue", record.values.revenue],
          ["Cost of Sales", record.values.cost_of_sales],
          ["Gross Profit", record.values.gross_profit],
          ["Other Income", record.values.other_income],
          ["Other Expenses", record.values.other_expenses],
          ["Operating Expenses", record.values.operating_expenses],
          ["Depreciation & Amortization", record.values.depreciation_amortization],
          ["EBITDA", record.values.ebitda],
          ["EBIT", record.values.ebit],
          ["Interest Expense", record.values.interest_expense],
          ["Tax Expense", record.values.tax_expense],
          ["Net Income", record.values.net_income],
        ]
      : record.family === "balance_sheet_month"
        ? [
            ["Cash and Equivalents", record.values.cash_and_equivalents],
            ["Inventory", record.values.inventory],
            ["Total Current Assets", record.values.total_current_assets],
            ["Fixed Assets", record.values.fixed_assets],
            ["Total Assets", record.values.total_assets],
            ["Total Liabilities", record.values.total_liabilities],
            ["Equity", record.values.equity],
            ["Retained Earnings", record.values.retained_earnings],
          ]
        : record.family === "cash_flow_month"
          ? [
              ["Cash From Operations", record.values.cash_from_operations],
              ["Cash From Investing", record.values.cash_from_investing],
              ["Cash From Financing", record.values.cash_from_financing],
              ["Net Cash Flow", record.values.net_cash_flow],
              ["Opening Cash", record.values.opening_cash],
              ["Closing Cash", record.values.closing_cash],
            ]
          : [
              ["Revenue", record.values.revenue],
              ["Cost of Sales", record.values.cost_of_sales],
              ["Gross Profit", record.values.gross_profit],
              ["Operating Expenses", record.values.operating_expenses],
              ["Net Income", record.values.net_income],
            ];

  sections.push("");
  sections.push("## Summary Metrics");
  sections.push("");
  sections.push("| Metric | Value |");
  sections.push("|--------|-------|");
  for (const [label, value] of rows) {
    sections.push(`| ${label} | ${value === null ? "" : formatNumber(value)} |`);
  }

  return sections.join("\n");
}

function appendCanonicalStatementTemplate(
  body: string,
  record: CanonicalFinanceRecord,
): string {
  if (!isCanonicalStatementRecord(record) || record.statement_lines.length === 0) {
    return body;
  }
  if (body.includes("## Statement Template")) {
    return body;
  }

  const sections = [
    body,
    "",
    "## Statement Template",
    "",
    "| Section | Group | Line | Kind | Value |",
    "|---------|-------|------|------|-------|",
  ];

  for (const line of record.statement_lines) {
    sections.push(
      `| ${escapeTableCell(line.section_label)} | ${escapeTableCell(line.group_label)} | ${escapeTableCell(line.label)} | ${line.line_kind} | ${line.value === null ? "" : formatNumber(line.value)} |`,
    );
  }

  return sections.join("\n");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function replaceQmdSuffix(filePath: string, suffix: string): string {
  return filePath.endsWith(".qmd")
    ? `${filePath.slice(0, -4)}${suffix}`
    : `${filePath}${suffix}`;
}

function statementLinesSidecarPath(filePath: string): string {
  return replaceQmdSuffix(filePath, ".statement-lines.qmd");
}

function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return null;
  return normalized;
}

function resolveSnapshotCurrency(
  reportCurrency: unknown,
  companyCurrency: unknown,
  lineItems: ReportLineItemPayload[],
): string {
  const parsedReportCurrency = normalizeCurrencyCode(reportCurrency);
  const parsedCompanyCurrency = normalizeCurrencyCode(companyCurrency);

  if (!parsedReportCurrency && parsedCompanyCurrency) {
    return parsedCompanyCurrency;
  }
  if (!parsedReportCurrency) {
    return "USD";
  }
  if (!parsedCompanyCurrency || parsedReportCurrency === parsedCompanyCurrency) {
    if (parsedReportCurrency === "USD") {
      const indonesiaHintText = lineItems
        .slice(0, 200)
        .map((item) =>
          `${item.account_name} ${item.section} ${item.subsection ?? ""}`.toLowerCase(),
        )
        .join(" ");
      if (/(jamsostek|rupiah|\bidr\b|\bthr\b|\bppn\b)/i.test(indonesiaHintText)) {
        return "IDR";
      }
    }
    return parsedReportCurrency;
  }

  // If extractor guessed USD but values look like high-nominal local currency
  // (large integer magnitudes with no minor-unit fractions), prefer company currency.
  if (parsedReportCurrency === "USD") {
    return parsedCompanyCurrency;
  }

  return parsedReportCurrency;
}

function shouldEmbedSnapshotLineItems(reportType: string): boolean {
  return normalizeReportType(reportType) !== "general_ledger";
}

function normalizeReportType(reportType: string): string {
  return reportType.trim().toLowerCase().replace(/-/g, "_");
}

function normalizeSectionText(value: string | undefined): string {
  return value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function inferCanonicalSection(item: ReportLineItemPayload): string | null {
  const section = normalizeSectionText(item.section);
  const subsection = normalizeSectionText(item.subsection);
  const account = normalizeSectionText(item.account_name);
  const combined = `${section} ${subsection} ${account}`.trim();
  const sectionNeedsRepair =
    section.length === 0 ||
    /^(other income|other expense|other income expense|other income and expense|default|unknown)$/.test(
      section,
    );

  if (!sectionNeedsRepair) {
    return null;
  }

  if (/\bgross profit\b/.test(combined)) return "Gross Profit";
  if (/\b(net income|net profit|profit and loss|profit loss)\b/.test(combined)) return "Net Income";
  if (/\b(cost of sales|cost of revenue|cost of goods sold|cogs)\b/.test(combined)) {
    return "Cost of Sales";
  }
  if (/\b(operating expenses?|total expenses?|payroll)\b/.test(combined)) {
    return "Operating Expenses";
  }
  if (
    /\b(revenue|sales|income)\b/.test(combined) &&
    !/\b(cost|expense|profit|loss)\b/.test(combined)
  ) {
    return "Revenue";
  }
  return null;
}

function normalizeSnapshotLineItem(
  item: ReportLineItemPayload,
  reportType: string,
): ReportLineItemPayload {
  const normalizedReportType = normalizeReportType(reportType);
  const incomeLike =
    normalizedReportType === "profit_and_loss" ||
    normalizedReportType === "financial_statement";
  const canonicalSection = incomeLike ? inferCanonicalSection(item) : null;
  const normalizedSubsection =
    canonicalSection &&
    item.subsection &&
    normalizeSectionText(item.subsection) !== normalizeSectionText(canonicalSection)
      ? item.subsection
      : undefined;

  return {
    ...item,
    ...(canonicalSection ? { section: canonicalSection } : {}),
    ...(canonicalSection
      ? normalizedSubsection
        ? { subsection: normalizedSubsection }
        : { subsection: undefined }
      : {}),
    values: Object.fromEntries(
      Object.entries(item.values).map(([periodKey, value]) => [
        periodKey,
        typeof value === "number" && Number.isFinite(value) ? value : null,
      ]),
    ),
  };
}

function normalizeSnapshotBodyLineItems(
  lineItems: ReportLineItemPayload[],
  reportType: string,
): ReportLineItemPayload[] {
  return lineItems.map((item) => normalizeSnapshotLineItem(item, reportType));
}

function normalizeSnapshotLineItems(
  lineItems: ReportLineItemPayload[],
  reportType: string,
) {
  return normalizeSnapshotBodyLineItems(lineItems, reportType).map((item) => ({
    account_name: item.account_name,
    ...(item.account_number ? { account_number: item.account_number } : {}),
    section: item.section,
    ...(item.subsection ? { subsection: item.subsection } : {}),
    values: item.values,
    depth: item.depth,
    is_total: item.is_total,
  }));
}

type ParsedCellReference = {
  column: string | null;
  row: number | null;
  ref: string | null;
};

function parseCellReference(value: string): ParsedCellReference {
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return { column: null, row: null, ref: null };

  if (/^[A-Z]+[1-9]\d*$/.test(trimmed)) {
    try {
      const decoded = XLSX.utils.decode_cell(trimmed);
      return {
        column: XLSX.utils.encode_col(decoded.c),
        row: decoded.r + 1,
        ref: trimmed,
      };
    } catch {
      return { column: null, row: null, ref: null };
    }
  }

  if (/^[A-Z]+$/.test(trimmed)) {
    return { column: trimmed, row: null, ref: null };
  }

  return { column: null, row: null, ref: null };
}

function displayLineItemRow(lineItem: ReportLineItemPayload): number {
  const firstResolvedRef = Object.values(lineItem.source.columns)
    .map((value) => parseCellReference(value))
    .find((parsed) => parsed.row !== null);
  return firstResolvedRef?.row ?? lineItem.source.row;
}

function displayCellRefs(lineItem: ReportLineItemPayload): string {
  return Object.values(lineItem.source.columns)
    .map((value) => {
      const parsed = parseCellReference(value);
      if (parsed.ref) return parsed.ref;
      if (parsed.column) return `${parsed.column}${displayLineItemRow(lineItem)}`;
      return value;
    })
    .join(", ");
}

function pickSnapshotMetric(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((best, current) =>
    Math.abs(current) > Math.abs(best) ? current : best
  );
}

function getSnapshotLineItemValue(values: Record<string, number | null>): number | null {
  const orderedKeys = [
    "actual",
    "current_period",
    "amount",
    "mtd_actual",
    "ending_balance",
    "cash_balance",
    "cash_position",
    "ending_cash",
    "balance",
    "ytd_actual",
  ];

  const normalizedEntries = Object.entries(values)
    .map(([key, value]) => ({
      key: key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
      value,
    }))
    .filter((entry): entry is { key: string; value: number } => typeof entry.value === "number" && Number.isFinite(entry.value));

  if (normalizedEntries.length === 0) return null;

  const amountEntries = normalizedEntries.filter((entry) =>
    !(
      entry.key.includes("percent") ||
      entry.key.includes("pct") ||
      entry.key.includes("margin") ||
      entry.key.includes("ratio") ||
      entry.key.includes("rate")
    ),
  );
  const prioritizedPool = amountEntries.length > 0 ? amountEntries : normalizedEntries;

  const prioritized = orderedKeys
    .map((candidateKey) => prioritizedPool.find((entry) => entry.key.includes(candidateKey)))
    .find((entry): entry is { key: string; value: number } => Boolean(entry));

  if (prioritized) return prioritized.value;
  if (prioritizedPool.length === 1) return prioritizedPool[0]?.value ?? null;
  return null;
}

function readSnapshotLineItemMetric(
  lineItems: ReportLineItemPayload[],
  keywords: string[],
): number | null {
  const totals: number[] = [];
  const fallbacks: number[] = [];

  for (const item of lineItems) {
    const section = item.section.toLowerCase();
    const account = item.account_name.toLowerCase();
    const haystack = `${section} ${account}`;
    if (!keywords.some((keyword) => haystack.includes(keyword))) continue;

    const value = getSnapshotLineItemValue(item.values);
    if (value === null) continue;

    const isTotal = item.is_total || /\btotal\b|\bnet\b/.test(account);
    if (isTotal) {
      totals.push(value);
    } else {
      fallbacks.push(value);
    }
  }

  return pickSnapshotMetric(totals) ?? pickSnapshotMetric(fallbacks);
}

function buildSnapshotSummaryMetrics(
  reportType: string,
  lineItems: ReportLineItemPayload[],
  derivedMetrics?: Record<string, number>,
): SnapshotSummaryMetrics | null {
  const summary: SnapshotSummaryMetrics = {};
  const normalizedLineItems = normalizeSnapshotLineItems(lineItems, reportType);
  const metrics = extractSnapshotStatementMetrics(
    {
      report_type: reportType,
      line_items: normalizedLineItems,
      ...(derivedMetrics ? { derived_metrics: derivedMetrics } : {}),
    },
    reportType,
  );

  if (metrics.revenue !== null) summary.revenue = metrics.revenue;
  if (metrics.expenses !== null) summary.expenses = metrics.expenses;
  if (metrics.operating_expenses !== null) summary.operating_expenses = metrics.operating_expenses;
  if (metrics.cost_of_sales !== null) summary.cost_of_sales = metrics.cost_of_sales;
  if (metrics.gross_profit !== null) summary.gross_profit = metrics.gross_profit;
  if (metrics.net_income !== null) summary.net_income = metrics.net_income;
  if (metrics.cash_position !== null) summary.cash_position = metrics.cash_position;
  if (metrics.runway_months !== null) summary.runway_months = metrics.runway_months;

  return Object.keys(summary).length > 0 ? summary : null;
}

function monthLastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function extractSheetYearHint(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fourDigit = trimmed.match(/(?:^|[\s._-])(20\d{2})(?:[\s._-]|$)/);
  if (fourDigit?.[1]) {
    const year = Number(fourDigit[1]);
    return Number.isFinite(year) ? year : null;
  }

  const twoDigit = trimmed.match(/^\s*(\d{2})(?:[\s._-]|$)/);
  if (!twoDigit?.[1]) return null;
  const year = Number(twoDigit[1]);
  if (!Number.isFinite(year)) return null;
  return year <= 79 ? 2000 + year : 1900 + year;
}

function collectActivePeriodIndexes(lineItems: ReportLineItemPayload[]): number[] {
  const active = new Set<number>();

  for (const lineItem of lineItems) {
    for (const [key, rawValue] of Object.entries(lineItem.values ?? {})) {
      const match = key.match(/^period_(\d+)$/);
      if (!match) continue;
      const value = typeof rawValue === "number" ? rawValue : null;
      if (value === null || value === 0) continue;
      active.add(Number(match[1]));
    }
  }

  return Array.from(active).sort((left, right) => left - right);
}

function resolveReportingPeriod(
  reportType: string,
  period: ReportingPeriodPayload,
  entity: string | undefined,
  sheetName: string | undefined,
  lineItems: ReportLineItemPayload[],
): ReportingPeriodPayload {
  if (!/profit_and_loss|income_statement|pnl|profit/i.test(reportType)) {
    return period;
  }

  const yearHint = extractSheetYearHint(entity) ?? extractSheetYearHint(sheetName);
  if (!yearHint) return period;

  const startYear = Number(period.start.slice(0, 4));
  const endYear = Number(period.end.slice(0, 4));
  if (startYear === yearHint && endYear === yearHint) {
    return period;
  }

  const activePeriods = collectActivePeriodIndexes(lineItems);
  if (activePeriods.length === 1 && activePeriods[0] === 1) {
    return {
      start: `${yearHint}-01-01`,
      end: `${yearHint}-01-${String(monthLastDay(yearHint, 1)).padStart(2, "0")}`,
      label: `Jan ${yearHint}`,
    };
  }

  return {
    start: `${yearHint}-01-01`,
    end: `${yearHint}-12-31`,
    label: String(yearHint),
  };
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function computeCellLineageSummary(lineItems: ReportLineItemPayload[]): {
  source_sheet: string | null;
  source_row_range: string | null;
  line_count: number;
} {
  if (lineItems.length === 0) {
    return { source_sheet: null, source_row_range: null, line_count: 0 };
  }

  // Collect unique sheets
  const sheets = new Set<string>();
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol: string | null = null;
  let maxCol: string | null = null;

  for (const li of lineItems) {
    sheets.add(li.source.sheet);
    const displayRow = displayLineItemRow(li);
    if (displayRow < minRow) minRow = displayRow;
    if (displayRow > maxRow) maxRow = displayRow;
    for (const rawRef of Object.values(li.source.columns)) {
      const parsed = parseCellReference(rawRef);
      const colLetter = parsed.column;
      if (!colLetter) continue;
      const decodedCol = XLSX.utils.decode_col(colLetter);
      if (!minCol || decodedCol < XLSX.utils.decode_col(minCol)) minCol = colLetter;
      if (!maxCol || decodedCol > XLSX.utils.decode_col(maxCol)) maxCol = colLetter;
    }
  }

  const sheetStr = sheets.size === 1 ? [...sheets][0] : [...sheets].join(",");
  const rangeStr = minCol && maxCol
    ? `${minCol}${minRow}:${maxCol}${maxRow}`
    : `${minRow}:${maxRow}`;

  return {
    source_sheet: sheetStr,
    source_row_range: rangeStr,
    line_count: lineItems.length,
  };
}

function buildReportBody(
  reportType: string,
  periodLabel: string,
  lineItems: ReportLineItemPayload[],
  derivedMetrics?: Record<string, number>,
): string {
  const sections: string[] = [];
  const normalizedLineItems = normalizeSnapshotBodyLineItems(lineItems, reportType);

  // Title
  sections.push(`# ${titleCase(reportType)} — ${periodLabel}`);

  // Summary section with derived metrics
  if (derivedMetrics && Object.keys(derivedMetrics).length > 0) {
    sections.push("## Summary");
    sections.push("");
    sections.push("| Metric | Value |");
    sections.push("|--------|-------|");
    for (const [key, value] of Object.entries(derivedMetrics)) {
      const label = titleCase(key);
      // If value is between -1 and 1 (exclusive of zero-range), treat as percentage
      const formatted = Math.abs(value) <= 1 && value !== 0
        ? formatPercent(value)
        : formatNumber(value);
      sections.push(`| ${label} | ${formatted} |`);
    }
  }

  // Line items section
  if (normalizedLineItems.length > 0) {
    sections.push("");
    sections.push("## Line Items");
    sections.push("");

    // Determine value columns from all line items
    const valueColumns = new Set<string>();
    for (const li of normalizedLineItems) {
      for (const key of Object.keys(li.values)) {
        valueColumns.add(key);
      }
    }
    const sortedColumns = [...valueColumns].sort();

    // Build header
    const headerCols = ["Account", "Section", "Depth", ...sortedColumns];
    sections.push(`| ${headerCols.join(" | ")} |`);
    sections.push(`|${headerCols.map(() => "------").join("|")}|`);

    // Build rows
    for (const li of normalizedLineItems) {
      const indent = "  ".repeat(li.depth);
      const name = li.is_total ? `**${indent}${li.account_name}**` : `${indent}${li.account_name}`;
      const valueCells = sortedColumns.map((col) => {
        const v = li.values[col];
        return v !== null && v !== undefined ? formatNumber(v) : "";
      });
      sections.push(`| ${name} | ${li.section} | ${li.depth} | ${valueCells.join(" | ")} |`);
    }
  }

  // Cell lineage section
  const lineItemsWithSource = normalizedLineItems.filter((li) => li.source?.sheet && li.source?.row !== undefined);
  if (lineItemsWithSource.length > 0) {
    sections.push("");
    sections.push("## Cell Lineage");
    sections.push("");
    sections.push("| Account | Sheet | Row | Cell Refs |");
    sections.push("|---------|-------|-----|-----------|");
    for (const li of lineItemsWithSource) {
      sections.push(
        `| ${li.account_name} | ${li.source.sheet} | ${displayLineItemRow(li)} | ${displayCellRefs(li)} |`,
      );
    }
  }

  return sections.join("\n");
}

/** @internal Exported for testing */
export function transformReportEvent(source: string, payload: Record<string, unknown>): QmdData | null {
  const reportType = payload.report_type as string | undefined;
  const inputPeriod = payload.reporting_period as ReportingPeriodPayload | undefined;
  const currency = payload.currency as string | undefined;
  const companyCurrency = payload.company_currency as string | undefined;
  const book = payload.book as string | undefined;
  const entity = payload.entity as string | undefined;
  const sheetName = payload.sheet_name as string | undefined;
  const department = payload.department as string | undefined;
  const lineItems = (payload.line_items as ReportLineItemPayload[] | undefined) ?? [];
  const derivedMetrics = payload.derived_metrics as Record<string, number> | undefined;
  const documentId =
    (payload.document_id as string | undefined) ??
    (payload.documentId as string | undefined);
  const confidence = payload.confidence as number | undefined;

  if (!reportType || !inputPeriod || !book) {
    return null;
  }

  const period = resolveReportingPeriod(reportType, inputPeriod, entity, sheetName, lineItems);

  const resolvedEntity = resolveReportEntity(entity, sheetName);
  const resolvedCurrency = resolveSnapshotCurrency(
    currency,
    companyCurrency,
    lineItems,
  );

  // Build deterministic path
  const periodKey = normalizeReportingPeriodKey(period);
  const periodSlug = slugify(periodKey);
  const entitySlug = slugify(resolvedEntity);
  const bookSlug = slugify(book);
  const typeSlug = slugify(reportType);
  const deptSlug = department ? slugify(department) : null;

  const fileName = deptSlug
    ? `${typeSlug}-${periodSlug}-${bookSlug}-${entitySlug}-${deptSlug}.qmd`
    : `${typeSlug}-${periodSlug}-${bookSlug}-${entitySlug}.qmd`;
  const filePath = `finance/snapshots/${fileName}`;

  // Build ID (deterministic, same as path sans extension)
  const id = `snapshot-${typeSlug}-${periodSlug}-${bookSlug}-${entitySlug}${deptSlug ? `-${deptSlug}` : ""}`;

  // Compute cell lineage summary for frontmatter
  const cellLineage = computeCellLineageSummary(lineItems);
  const snapshotLineItems = normalizeSnapshotLineItems(lineItems, reportType);
  const embedLineItems = shouldEmbedSnapshotLineItems(reportType);
  const summaryMetrics = buildSnapshotSummaryMetrics(reportType, lineItems, derivedMetrics);

  // Period label for display
  const periodLabel = period.label ?? `${period.start} to ${period.end}`;

  // Build body
  const body = buildReportBody(reportType, periodLabel, lineItems, derivedMetrics);

  return {
    domain: "finance",
    type: "financial_snapshot",
    filePath,
    frontmatter: {
      id,
      type: "financial_snapshot",
      report_type: reportType,
      // Legacy key remains as a string for compatibility with existing consumers.
      period: periodKey,
      period_key: periodKey,
      period_start: period.start,
      period_end: period.end,
      period_label: period.label ?? null,
      reporting_period: {
        start: period.start,
        end: period.end,
        label: period.label ?? null,
      },
      book,
      currency: resolvedCurrency,
      entity: resolvedEntity,
      ...(sheetName ? { sheet_name: sheetName } : {}),
      ...(department ? { department } : {}),
      ...(derivedMetrics && Object.keys(derivedMetrics).length > 0
        ? { derived_metrics: derivedMetrics }
        : {}),
      ...(summaryMetrics ? { summary_metrics: summaryMetrics } : {}),
      ...(summaryMetrics?.revenue !== undefined ? { revenue: summaryMetrics.revenue } : {}),
      ...(summaryMetrics?.expenses !== undefined ? { expenses: summaryMetrics.expenses } : {}),
      ...(summaryMetrics?.operating_expenses !== undefined
        ? { operating_expenses: summaryMetrics.operating_expenses }
        : {}),
      ...(summaryMetrics?.cost_of_sales !== undefined
        ? { cost_of_sales: summaryMetrics.cost_of_sales }
        : {}),
      ...(summaryMetrics?.gross_profit !== undefined
        ? { gross_profit: summaryMetrics.gross_profit }
        : {}),
      ...(summaryMetrics?.net_income !== undefined ? { net_income: summaryMetrics.net_income } : {}),
      ...(summaryMetrics?.cash_position !== undefined ? { cash_position: summaryMetrics.cash_position } : {}),
      ...(summaryMetrics?.runway_months !== undefined ? { runway_months: summaryMetrics.runway_months } : {}),
      ...(embedLineItems ? { line_items: snapshotLineItems } : {}),
      line_item_count: snapshotLineItems.length,
      line_items_embedded: embedLineItems,
      line_items_location: embedLineItems ? "frontmatter" : "body",
      source,
      document_id: documentId ?? null,
      confidence: confidence ?? null,
      cell_lineage: cellLineage,
    },
    body,
  };
}

function deriveOperatingIncome(record: CanonicalPnlMonth): number | null {
  if (record.values.ebit !== null) return record.values.ebit;
  if (record.values.gross_profit !== null && record.values.operating_expenses !== null) {
    return record.values.gross_profit - record.values.operating_expenses;
  }
  return null;
}

function deriveBalanceSheetEquity(record: CanonicalBalanceSheetMonth): number | null {
  if (record.values.equity !== null) return record.values.equity;
  if (record.values.total_assets !== null && record.values.total_liabilities !== null) {
    return record.values.total_assets - record.values.total_liabilities;
  }
  return null;
}

function mapProjectionScenario(
  scenarioKey: string,
): "base" | "bull" | "bear" {
  const normalized = slugify(scenarioKey);
  if (normalized.includes("bull")) return "bull";
  if (normalized.includes("bear")) return "bear";
  return "base";
}

export function transformCanonicalFinanceEvent(
  source: string,
  payload: Record<string, unknown>,
): QmdData | null {
  const typedPayload = payload as CanonicalFinancePayload;
  const record = typedPayload.record;
  if (!record) return null;
  const resolvedRecord = resolveCanonicalRecordMetrics(record);

  const { domain, type, filePath } = canonicalRecordPath(resolvedRecord);
  const id = canonicalRecordId(resolvedRecord);
  const currency = resolveCanonicalCurrency(resolvedRecord.currency, typedPayload.company_currency);
  const documentId = resolveCanonicalDocumentId(typedPayload);
  const sourceLineage = canonicalSourceRefsSummary(resolvedRecord.source_refs);
  const summaryMetrics = buildCanonicalSummaryMetrics(resolvedRecord);
  const technicalStatementLinesPath =
    isCanonicalStatementRecord(resolvedRecord) && resolvedRecord.statement_lines.length > 0
      ? statementLinesSidecarPath(filePath)
      : null;
  const baseFrontmatter: Record<string, unknown> = {
    id,
    type,
    report_type: type,
    source,
    document_id: documentId,
    period: resolvedRecord.period_key,
    period_key: resolvedRecord.period_key,
    period_start: resolvedRecord.period.start,
    period_end: resolvedRecord.period.end,
    period_label: resolvedRecord.period.label ?? null,
    reporting_period: {
      start: resolvedRecord.period.start,
      end: resolvedRecord.period.end,
      label: resolvedRecord.period.label ?? null,
    },
    book: resolvedRecord.book,
    currency,
    reporting_currency: currency,
    company_currency: normalizeCurrencyCode(typedPayload.company_currency) ?? null,
    entity: resolvedRecord.scope_label,
    scope_key: resolvedRecord.scope_key,
    scope_label: resolvedRecord.scope_label,
    company_wide: resolvedRecord.company_wide,
    canonical_family: resolvedRecord.family,
    review_status: resolvedRecord.review_status,
    confidence: resolvedRecord.confidence,
    warnings: resolvedRecord.warnings,
    source_document_name: resolvedRecord.source_document_name,
    source_sheet: sourceLineage.source_sheet,
    source_range: sourceLineage.source_range,
    source_ref_count: sourceLineage.source_count,
  };
  if (summaryMetrics) {
    baseFrontmatter.summary_metrics = summaryMetrics;
  }
  if (isCanonicalStatementRecord(resolvedRecord)) {
    baseFrontmatter.statement_line_count = resolvedRecord.statement_lines.length;
    baseFrontmatter.statement_lines_embedded = false;
    baseFrontmatter.statement_lines_location = technicalStatementLinesPath ? "sidecar" : "none";
    baseFrontmatter.statement_lines_path = technicalStatementLinesPath;
    baseFrontmatter.statement_sections = Array.from(
      new Set(
        resolvedRecord.statement_lines
          .filter((line) => line.line_kind === "section" && line.section_label)
          .map((line) => line.section_label),
      ),
    );
    baseFrontmatter.statement_section_count = (baseFrontmatter.statement_sections as string[]).length;
  }

  const additionalFiles =
    isCanonicalStatementRecord(resolvedRecord) && technicalStatementLinesPath
      ? [{
          path: technicalStatementLinesPath,
          content: buildStatementLinesSidecar(resolvedRecord, typedPayload, filePath),
        }]
      : undefined;

  switch (resolvedRecord.family) {
    case "pnl_month": {
      const operatingIncome = deriveOperatingIncome(resolvedRecord);
      return {
        domain,
        type,
        filePath,
        frontmatter: {
          ...baseFrontmatter,
          revenue: toMoneyAmount(resolvedRecord.values.revenue, currency),
          cost_of_revenue: toMoneyAmount(resolvedRecord.values.cost_of_sales, currency),
          cost_of_sales: resolvedRecord.values.cost_of_sales,
          gross_profit: toMoneyAmount(resolvedRecord.values.gross_profit, currency),
          other_income: toMoneyAmount(resolvedRecord.values.other_income, currency),
          other_expenses: toMoneyAmount(resolvedRecord.values.other_expenses, currency),
          operating_expenses: toMoneyAmount(resolvedRecord.values.operating_expenses, currency),
          depreciation_amortization: toMoneyAmount(resolvedRecord.values.depreciation_amortization, currency),
          operating_income: toMoneyAmount(operatingIncome, currency),
          ebitda: resolvedRecord.values.ebitda,
          ebit: resolvedRecord.values.ebit,
          interest_expense: toMoneyAmount(resolvedRecord.values.interest_expense, currency),
          tax_expense: toMoneyAmount(resolvedRecord.values.tax_expense, currency),
          net_income: toMoneyAmount(resolvedRecord.values.net_income, currency),
        },
        body: appendCanonicalStatementTemplate(buildCanonicalFinanceBody(resolvedRecord), resolvedRecord),
        additionalFiles,
      };
    }
    case "balance_sheet_month": {
      const totalEquity = deriveBalanceSheetEquity(resolvedRecord);
      return {
        domain,
        type,
        filePath,
        frontmatter: {
          ...baseFrontmatter,
          total_assets: toMoneyAmount(resolvedRecord.values.total_assets, currency),
          total_liabilities: toMoneyAmount(resolvedRecord.values.total_liabilities, currency),
          total_current_liabilities: toMoneyAmount(
            resolvedRecord.values.total_current_liabilities,
            currency,
          ),
          total_equity: toMoneyAmount(totalEquity, currency),
          cash_and_equivalents: resolvedRecord.values.cash_and_equivalents,
          cash_position: resolvedRecord.values.cash_and_equivalents,
          accounts_receivable: resolvedRecord.values.accounts_receivable,
          inventory: resolvedRecord.values.inventory,
          total_current_assets: resolvedRecord.values.total_current_assets,
          fixed_assets: resolvedRecord.values.fixed_assets,
          retained_earnings: resolvedRecord.values.retained_earnings,
        },
        body: appendCanonicalStatementTemplate(buildCanonicalFinanceBody(resolvedRecord), resolvedRecord),
        additionalFiles,
      };
    }
    case "cash_flow_month":
      return {
        domain,
        type,
        filePath,
        frontmatter: {
          ...baseFrontmatter,
          operating: toMoneyAmount(resolvedRecord.values.cash_from_operations, currency),
          investing: toMoneyAmount(resolvedRecord.values.cash_from_investing, currency),
          financing: toMoneyAmount(resolvedRecord.values.cash_from_financing, currency),
          net_change: toMoneyAmount(resolvedRecord.values.net_cash_flow, currency),
          opening_cash: resolvedRecord.values.opening_cash,
          closing_cash: resolvedRecord.values.closing_cash,
          ending_cash: resolvedRecord.values.closing_cash,
          cash_position: resolvedRecord.values.closing_cash,
        },
        body: appendCanonicalStatementTemplate(buildCanonicalFinanceBody(resolvedRecord), resolvedRecord),
        additionalFiles,
      };
    case "financial_projection_plan": {
      const projectedExpenses = computeCanonicalProjectionExpenses(resolvedRecord);
      return {
        domain,
        type,
        filePath,
        frontmatter: {
          ...baseFrontmatter,
          year: resolvedRecord.period_key.slice(0, 4),
          scenario: mapProjectionScenario(resolvedRecord.scenario_key),
          scenario_key: resolvedRecord.scenario_key,
          plan_key: resolvedRecord.plan_key,
          plan_status: resolvedRecord.plan_status,
          revenue_projection: toMoneyAmount(resolvedRecord.values.revenue, currency),
          expense_projection: toMoneyAmount(projectedExpenses, currency),
          revenue: resolvedRecord.values.revenue,
          operating_expenses: resolvedRecord.values.operating_expenses,
          cost_of_sales: resolvedRecord.values.cost_of_sales,
          gross_profit: resolvedRecord.values.gross_profit,
          net_income: resolvedRecord.values.net_income,
        },
        body: appendCanonicalStatementTemplate(buildCanonicalFinanceBody(resolvedRecord), resolvedRecord),
        additionalFiles,
      };
    }
    case "metrics_daily":
      return {
        domain,
        type,
        filePath,
        frontmatter: {
          ...baseFrontmatter,
          template_key: resolvedRecord.template_key,
          metric_basis: resolvedRecord.metric_basis,
          metric_values: resolvedRecord.metric_values,
        },
        body: appendCanonicalStatementTemplate(buildCanonicalFinanceBody(resolvedRecord), resolvedRecord),
      };
  }
}

interface WriteQueueResult {
  commitSha: string | null;
  entityIds: string[];
}

async function submitToWriteQueue(
  companySlug: string,
  qmdData: QmdData,
  port?: number,
): Promise<WriteQueueResult> {
  const reconciliationAuth = getReconciliationAgentAuth();
  const reconciliationAgentToken = reconciliationAuth.token;

  if (!reconciliationAgentToken) {
    throw new Error("RECONCILIATION_AGENT_TOKEN not set and no internal write-intent token is available");
  }

  if (reconciliationAuth.usedFallback && !fallbackTokenWarned) {
    console.warn(
      "[reconciliation] RECONCILIATION_AGENT_TOKEN is not set; using the current internal write-intent token as fallback.",
    );
    fallbackTokenWarned = true;
  }

  const metadataSource =
    qmdData.metadataSource ??
    (typeof qmdData.frontmatter.source === "string"
      ? qmdData.frontmatter.source
      : qmdData.type);
  const metadataEntityId =
    qmdData.metadataEntityId ??
    (typeof qmdData.frontmatter.id === "string"
      ? qmdData.frontmatter.id
      : qmdData.filePath);

  // WriteIntent format expected by Company-DB write queue
  const writeIntent = {
    agentId: RECONCILIATION_AGENT_ID,
    agentToken: reconciliationAgentToken,
    domain: qmdData.domain,
    operation: {
      type: "commit",
      files: [
        {
          path: qmdData.filePath,
          content: qmdData.rawContent ?? formatQmd(qmdData.frontmatter, qmdData.body),
        },
        ...(qmdData.additionalFiles ?? []),
      ],
      commitMessage: qmdData.commitMessage ?? `import(${metadataSource}): ${metadataEntityId}`,
    },
    metadata: {
      source: metadataSource,
      entityId: metadataEntityId,
    },
  };

  const baseUrl = port ? `http://localhost:${port}` : WRITE_QUEUE_URL;
  const writeUrl = `${baseUrl}/write`;
  const res = await fetch(writeUrl, {
    method: "POST",
    headers: buildCompanyDbQueueHeadersForUrl({
      url: writeUrl,
      method: "POST",
      body: writeIntent,
      contentType: "application/json",
    }),
    body: JSON.stringify(writeIntent),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Write Queue error (${res.status}): ${error}`);
  }

  const result = await res.json();

  if (!result.success) {
    const code = result.error?.code ?? "unknown";
    const msg = result.error?.message ?? "Write Queue returned success: false";
    throw new Error(`Write Queue rejected (${code}): ${msg}`);
  }

  return {
    commitSha: result.commitSha ?? null,
    entityIds: [metadataEntityId],
  };
}

function formatQmd(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  return `---\n${yaml}\n---\n\n${body}\n`;
}
