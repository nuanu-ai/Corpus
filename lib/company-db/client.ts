import { parseQmd, toQmd } from "@/lib/company-db/summary/qmd";
import {
  buildCanonicalFinanceSeries,
  summarizeCanonicalFinanceCoverage,
  type CanonicalFinancePoint,
} from "@/lib/company-db/financial-canonical";
import { toCompanyDbRole } from "@/lib/company-db/roles";
import {
  buildCompanyDbQueueHeadersForUrl,
  buildCompanyDbRestHeadersForUrl,
  getCompanyDbWriteIntentToken,
} from "@/lib/company-db/internal-service-auth";
import {
  ADVISOR_DOMAIN_ORDER,
  filterDecisionGradeAdvisorEntities,
  getAdvisorDomainLabel,
  selectAdvisorEntities,
} from "@/lib/company-db/advisor-context";
import { DEFAULT_COMPANY_DB_REST_PORT as DEFAULT_PORT } from "@/lib/company-db/port-config";

/**
 * Company-DB REST client.
 *
 * Thin wrapper around fetch() to call the Company-DB REST API
 * running on localhost:3100. Uses signed internal-service auth.
 */
const COMPANY_DB_HOST = process.env.COMPANY_DB_HOST ?? "localhost";
const NARRATIVE_AGENT_ID =
  process.env.NARRATIVE_AGENT_ID ??
  process.env.KNOWLEDGE_AGENT_ID ??
  "knowledge-agent";

export interface CompanyDbRequestOptions {
  /** Company slug (tenant identifier) */
  companySlug: string;
  /** Caller identity for RBAC (defaults to cfo_agent) */
  callerId?: string;
  callerRole?: string;
  /**
   * REST port for this tenant's Company-DB process.
   * Resolution order: opts.port → COMPANY_DB_REST_URL env → default 3100.
   * In production, read from companies.company_db_port.
   */
  port?: number;
}

/**
 * Resolve the Company-DB base URL for a request.
 *
 * Priority:
 *  1. Explicit `port` in request options (from company record)
 *  2. `COMPANY_DB_REST_URL` env var (full URL, used in legacy / single-tenant setups)
 *  3. Default: http://{COMPANY_DB_HOST}:3100
 */
function resolveBaseUrl(opts: CompanyDbRequestOptions): string {
  if (opts.port) {
    return `http://${COMPANY_DB_HOST}:${opts.port}`;
  }
  if (process.env.COMPANY_DB_REST_URL) {
    return process.env.COMPANY_DB_REST_URL;
  }
  return `http://${COMPANY_DB_HOST}:${DEFAULT_PORT}`;
}

export interface EntityResult {
  qualifiedId: string;
  type: string;
  domain: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
  title: string | null;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface QueryFilters {
  domain?: string;
  type?: string;
  status?: string;
  documentId?: string;
  limit?: number;
  offset?: number;
  view?: EntityView;
}

export type EntityView = "full" | "summary";

export interface SearchFilters {
  domain?: string;
  limit?: number;
  view?: EntityView;
}

export interface SemanticSearchFilters {
  domain?: string;
  limit?: number;
}

export interface SemanticSearchHit {
  qualifiedId: string;
  domain: string;
  filePath: string;
  title: string | null;
  entityType: string;
  summaryPath: string | null;
  documentId: string | null;
  chunkId: string;
  chunkIndex: number;
  sectionPath: string;
  language: string | null;
  score: number;
  retrievalMode: "semantic";
  snippet: string;
}

export interface SummaryResult {
  path: string;
  raw: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface NarrativeDocPayload {
  domain: string;
  documentId: string;
  title: string;
  markdown: string;
  wordCount: number;
  sourceLanguage?: string | null;
  fileName?: string | null;
  documentType?: string | null;
  routing?: Record<string, unknown> | null;
}

function buildHeaders(
  url: string | URL,
  method: string,
  opts: CompanyDbRequestOptions,
  body?: unknown,
): HeadersInit {
  return buildCompanyDbRestHeadersForUrl({
    url,
    method,
    body,
    contentType: "application/json",
    companySlug: opts.companySlug,
    callerId: opts.callerId ?? `cfo-agent-${opts.companySlug}`,
    callerRole: toCompanyDbRole(opts.callerRole),
  });
}

/**
 * Query entities from Company-DB with optional filters.
 * Server returns { data: EntityResult[], count: number }.
 */
export async function queryEntities(
  filters: QueryFilters,
  opts: CompanyDbRequestOptions,
): Promise<EntityResult[]> {
  const params = new URLSearchParams();
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.type) params.set("type", filters.type);
  if (filters.status) params.set("status", filters.status);
  if (filters.documentId) params.set("documentId", filters.documentId);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  if (filters.view) params.set("view", filters.view);

  const base = resolveBaseUrl(opts);
  const url = `${base}/api/v1/query?${params}`;
  const res = await fetch(url, { headers: buildHeaders(url, "GET", opts) });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Company-DB query failed (${res.status}): ${error}`);
  }

  const body = await res.json();
  return body.data;
}

/**
 * Get a single entity by qualified ID.
 * Server returns the entity directly (no wrapper).
 */
export async function getEntity(
  domain: string,
  entityId: string,
  opts: CompanyDbRequestOptions,
  view?: EntityView,
): Promise<EntityResult | null> {
  const base = resolveBaseUrl(opts);
  const params = new URLSearchParams();
  if (view) params.set("view", view);
  const url = `${base}/api/v1/${domain}/${entityId}${params.size ? `?${params}` : ""}`;
  const res = await fetch(url, { headers: buildHeaders(url, "GET", opts) });

  if (res.status === 404) return null;
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Company-DB getEntity failed (${res.status}): ${error}`);
  }

  return res.json();
}

export async function getEntityByQualifiedId(
  qualifiedId: string,
  opts: CompanyDbRequestOptions,
  view?: EntityView,
): Promise<EntityResult | null> {
  const base = resolveBaseUrl(opts);
  const params = new URLSearchParams();
  if (view) params.set("view", view);
  const encodedQualifiedId = encodeURIComponent(qualifiedId);
  const url = `${base}/api/v1/entity/${encodedQualifiedId}${params.size ? `?${params}` : ""}`;
  const res = await fetch(url, { headers: buildHeaders(url, "GET", opts) });

  if (res.status === 404) return null;
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Company-DB getEntityByQualifiedId failed (${res.status}): ${error}`);
  }

  return res.json();
}

/**
 * Full-text search across all indexed entities.
 * Server returns { data: EntityResult[], count: number }.
 */
export async function searchEntities(
  query: string,
  opts: CompanyDbRequestOptions,
  filters: SearchFilters = {},
): Promise<EntityResult[]> {
  const base = resolveBaseUrl(opts);
  const params = new URLSearchParams({ q: query });
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.view) params.set("view", filters.view);
  const url = `${base}/api/v1/search?${params}`;
  const res = await fetch(url, { headers: buildHeaders(url, "GET", opts) });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Company-DB search failed (${res.status}): ${error}`);
  }

  const body = await res.json();
  return body.data;
}

export async function searchEntitiesSemantic(
  query: string,
  opts: CompanyDbRequestOptions,
  filters: SemanticSearchFilters = {},
): Promise<SemanticSearchHit[]> {
  const base = resolveBaseUrl(opts);
  const params = new URLSearchParams({ q: query });
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const url = `${base}/api/v1/search/semantic?${params}`;
  const res = await fetch(url, { headers: buildHeaders(url, "GET", opts) });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Company-DB semantic search failed (${res.status}): ${error}`);
  }

  const body = await res.json();
  return body.data;
}

/**
 * Read a raw QMD file from Company-DB by repo-relative path.
 * Returns null when the file does not exist.
 */
export async function readQmdFile(
  filePath: string,
  opts: CompanyDbRequestOptions,
): Promise<string | null> {
  const base = resolveBaseUrl(opts);
  const url = `${base}/api/v1/file?path=${encodeURIComponent(filePath)}`;
  const res = await fetch(url, { headers: buildHeaders(url, "GET", opts) });

  if (res.status === 404) return null;
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Company-DB file read failed (${res.status}): ${error}`);
  }

  return res.text();
}

export async function getSummaryByPath(
  filePath: string,
  opts: CompanyDbRequestOptions,
): Promise<SummaryResult | null> {
  const raw = await readQmdFile(filePath, opts);
  if (raw === null) return null;

  const parsed = parseQmd(raw);
  return {
    path: filePath,
    raw,
    body: parsed.body,
    frontmatter: parsed.frontmatter,
  };
}

export async function getFolderSummary(
  folderPath: string,
  opts: CompanyDbRequestOptions,
): Promise<SummaryResult | null> {
  const normalized = folderPath.replace(/^\/+|\/+$/g, "");
  return getSummaryByPath(`${normalized}/_summary.qmd`, opts);
}

export async function getDomainSummary(
  domain: string,
  opts: CompanyDbRequestOptions,
): Promise<SummaryResult | null> {
  const normalized = domain.replace(/^\/+|\/+$/g, "");
  return getSummaryByPath(`${normalized}/_summary.qmd`, opts);
}

export async function getCompanySummary(
  opts: CompanyDbRequestOptions,
): Promise<SummaryResult | null> {
  return getSummaryByPath("governance/company/_summary.qmd", opts);
}

// ── Stats ────────────────────────────────────────────────────────────────

export interface StatsResponse {
  totalEntities: number;
  totalCommits: number;
  domains: Record<string, number>;
  heatmap: Array<{ date: string; count: number }>;
  lastCommit: { sha: string; message: string; date: string } | null;
}

/**
 * Get repository + entity statistics from Company-DB.
 * Requires owner or cfo_agent role.
 */
export async function getStats(
  opts: CompanyDbRequestOptions,
): Promise<StatsResponse> {
  const base = resolveBaseUrl(opts);
  const url = `${base}/api/v1/stats`;
  const res = await fetch(url, { headers: buildHeaders(url, "GET", opts) });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Company-DB stats failed (${res.status}): ${error}`);
  }

  return res.json();
}

// ── Commits ──────────────────────────────────────────────────────────────

export interface CommitLogEntry {
  sha: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
}

export interface CommitLogResponse {
  data: CommitLogEntry[];
  count: number;
}

/**
 * Get paginated commit log from Company-DB.
 * Requires owner or cfo_agent role.
 */
export async function getCommits(
  opts: CompanyDbRequestOptions,
  limit = 20,
  offset = 0,
): Promise<CommitLogResponse> {
  const base = resolveBaseUrl(opts);
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const url = `${base}/api/v1/commits?${params}`;
  const res = await fetch(url, { headers: buildHeaders(url, "GET", opts) });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Company-DB commits failed (${res.status}): ${error}`);
  }

  return res.json();
}

// ── Entities (with count) ────────────────────────────────────────────────

export interface QueryResultWithCount {
  data: EntityResult[];
  count: number;
}

export async function queryAllEntities(
  filters: Omit<QueryFilters, "limit" | "offset">,
  opts: CompanyDbRequestOptions,
): Promise<EntityResult[]> {
  const pageSize = 250;
  const all: EntityResult[] = [];
  let offset = 0;
  let count = 0;

  do {
    const page = await queryEntitiesWithCount(
      {
        ...filters,
        limit: pageSize,
        offset,
      },
      opts,
    );

    all.push(...page.data);
    count = page.count;
    offset += page.data.length;

    if (page.data.length === 0) break;
  } while (offset < count);

  return all;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value !== null) {
    const amount = (value as { amount?: unknown }).amount;
    if (amount !== undefined) return toNumber(amount);
  }
  return null;
}

function hasMeaningfulMetric(value: unknown): boolean {
  const numeric = toNumber(value);
  return numeric !== null && numeric !== 0;
}

function hasSuspiciousSignedExpenseMetrics(summary: SummaryResult): boolean {
  const keyMetrics =
    typeof summary.frontmatter.key_metrics === "object" && summary.frontmatter.key_metrics !== null
      ? (summary.frontmatter.key_metrics as Record<string, unknown>)
      : {};

  return ["expenses", "operating_expenses", "cost_of_sales"].some((key) => {
    const value = toNumber(keyMetrics[key]);
    return value !== null && value < 0;
  });
}

function isLowSignalFinanceSummary(summary: SummaryResult): boolean {
  const frontmatter = summary.frontmatter ?? {};
  const sourceEntityCount = toNumber(frontmatter.source_entity_count) ?? 0;
  if (sourceEntityCount <= 0) return false;

  const keyMetrics =
    typeof frontmatter.key_metrics === "object" && frontmatter.key_metrics !== null
      ? (frontmatter.key_metrics as Record<string, unknown>)
      : {};

  const hasUsefulMetric = [
    keyMetrics.revenue,
    keyMetrics.expenses,
    keyMetrics.net_income,
    keyMetrics.cash_position,
    keyMetrics.runway_months,
  ].some((value) => hasMeaningfulMetric(value));

  return !hasUsefulMetric;
}

function metricToText(value: number | null): string {
  return value === null ? "N/A" : String(value);
}

function compactPromptText(value: string, maxChars = 650): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function normalizePeriodKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;

  const monthKey = text.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (monthKey) return `${monthKey[1]}-${monthKey[2]}`;

  const monthName = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b\s+(\d{4})/i);
  if (monthName) {
    const monthIndex = [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ].indexOf(monthName[1]!.toLowerCase());
    if (monthIndex >= 0) return `${monthName[2]}-${String(monthIndex + 1).padStart(2, "0")}`;
  }

  return null;
}

function getSummaryLatestFinancePeriod(summary: SummaryResult): string | null {
  const metrics =
    typeof summary.frontmatter.key_metrics === "object" && summary.frontmatter.key_metrics !== null
      ? (summary.frontmatter.key_metrics as Record<string, unknown>)
      : {};

  return (
    normalizePeriodKey(metrics.latest_period) ??
    normalizePeriodKey(metrics.latest_performance_period) ??
    normalizePeriodKey(metrics.latest_observed_period)
  );
}

function getFinanceRecordPeriod(record: EntityResult): string | null {
  const fm = record.frontmatter ?? {};
  return (
    normalizePeriodKey(fm.period_key) ??
    normalizePeriodKey(fm.reporting_period_key) ??
    normalizePeriodKey(fm.period_end) ??
    normalizePeriodKey(fm.period_label) ??
    normalizePeriodKey(fm.period_start)
  );
}

function isActualFinanceImport(record: EntityResult): boolean {
  if (record.domain !== "finance" || record.type !== "document_import") return false;
  const fm = record.frontmatter ?? {};
  const book = String(fm.book ?? "actual").toLowerCase();
  if (["budget", "forecast", "projection", "plan"].includes(book)) return false;

  const text = [
    fm.source_file_name,
    fm.title,
    fm.report_type,
    fm.document_kind,
    fm.target_domain,
    fm.target_entity_type,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return (
    text.includes("financial statement") ||
    text.includes("profit") ||
    text.includes("balance sheet") ||
    text.includes("trial balance") ||
    text.includes("general ledger") ||
    fm.target_domain === "finance"
  );
}

interface NewerFinanceImport {
  record: EntityResult;
  period: string;
}

function getLatestNewerFinanceImport(
  records: EntityResult[],
  canonicalPeriod: string | null,
): NewerFinanceImport | null {
  if (!canonicalPeriod) return null;

  const candidates = records
    .filter(isActualFinanceImport)
    .map((record) => ({
      record,
      period: getFinanceRecordPeriod(record),
    }))
    .filter((entry): entry is { record: EntityResult; period: string } =>
      Boolean(entry.period && entry.period > canonicalPeriod),
    )
    .sort((left, right) => right.period.localeCompare(left.period));

  const latest = candidates[0];
  if (!latest) return null;
  return latest;
}

function buildFinanceImportSummaryLine(summary: SummaryResult | null): string | null {
  if (!summary) return null;

  const executiveLine = getSummaryExecutiveLine(summary);
  if (executiveLine) {
    return `Review-pending import executive summary: ${compactPromptText(executiveLine)}`;
  }

  const toplineFindings = summary.frontmatter.topline_findings;
  if (!Array.isArray(toplineFindings)) return null;

  const findings = toplineFindings
    .map((entry) => {
      if (typeof entry === "string") return compactPromptText(entry, 160);
      if (typeof entry !== "object" || entry === null) return null;

      const row = entry as Record<string, unknown>;
      const label = typeof row.label === "string" ? row.label.trim() : "";
      const value = typeof row.value === "string" ? row.value.trim() : "";
      if (!label && !value) return null;
      return compactPromptText([label, value].filter(Boolean).join(": "), 160);
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 4);

  if (findings.length === 0) return null;
  return `Review-pending import toplines: ${findings.join("; ")}.`;
}

function buildNewerFinanceImportNotice(
  latest: NewerFinanceImport,
  canonicalPeriod: string,
  importSummaryLine?: string | null,
): string {
  const fm = latest.record.frontmatter;
  const fileName =
    typeof fm.source_file_name === "string" && fm.source_file_name.trim()
      ? fm.source_file_name.trim()
      : latest.record.title ?? latest.record.filePath;
  const documentId = typeof fm.document_id === "string" ? fm.document_id : null;
  const reviewState = fm.requires_review === true || fm.review_pending === true
    ? "review pending"
    : "not promoted";

  const lines = [
    `Newer unpromoted finance import detected: ${fileName} covers ${latest.period} (${reviewState}).`,
    `Canonical finance summary is still at ${canonicalPeriod}; do not claim ${latest.period} is not uploaded.`,
  ];

  if (importSummaryLine) lines.push(importSummaryLine);

  lines.push(
    `For questions about ${latest.period}, use read_company_db_file(filePath="${latest.record.filePath}")${documentId ? ` or get_document_download(document_id="${documentId}")` : ""} and answer with a review-pending caveat until canonical promotion is complete.`,
  );

  return lines.join(" ");
}

async function getNewerFinanceImportNotice(
  summary: SummaryResult,
  opts: CompanyDbRequestOptions,
): Promise<string | null> {
  const canonicalPeriod = getSummaryLatestFinancePeriod(summary);
  if (!canonicalPeriod) return null;

  try {
    const records = await queryEntities({ domain: "finance", limit: 200, view: "summary" }, opts);
    const latest = getLatestNewerFinanceImport(records, canonicalPeriod);
    if (!latest) return null;

    let importSummaryLine: string | null = null;
    try {
      const importSummary = await getSummaryByPath(latest.record.filePath, opts);
      importSummaryLine = buildFinanceImportSummaryLine(importSummary);
    } catch {
      // The pointer is still useful even if the raw QMD read is unavailable.
    }

    return buildNewerFinanceImportNotice(latest, canonicalPeriod, importSummaryLine);
  } catch {
    return null;
  }
}

function getLatestCanonicalFinancePoint(points: CanonicalFinancePoint[]): CanonicalFinancePoint | null {
  return points.length > 0 ? points[points.length - 1]! : null;
}

function formatSummaryForPrompt(summary: SummaryResult): string {
  const lines: string[] = [];
  const title = String(summary.frontmatter.title ?? "Summary").trim();
  if (title) lines.push(title);

  const metrics = summary.frontmatter.key_metrics;
  if (metrics && typeof metrics === "object") {
    const entries = Object.entries(metrics as Record<string, unknown>)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .slice(0, 8)
      .map(([key, value]) => `${key}: ${String(value)}`);
    if (entries.length > 0) {
      lines.push(entries.join(", "));
    }
  }

  if (summary.body) {
    lines.push(summary.body);
  }

  return lines.join("\n\n").trim();
}

function getSummaryExecutiveLine(summary: SummaryResult): string | null {
  const bodyLines = summary.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const executiveIndex = bodyLines.findIndex((line) =>
    line.toLowerCase() === "## executive summary",
  );
  if (executiveIndex >= 0) {
    const line = bodyLines.slice(executiveIndex + 1).find((candidate) => !candidate.startsWith("#"));
    if (line) return line;
  }

  const firstBodyLine = bodyLines.find((line) => !line.startsWith("#"));
  return firstBodyLine ?? null;
}

function getSummarySourceCount(summary: SummaryResult | null): number | null {
  if (!summary) return null;
  const raw = summary.frontmatter.source_entity_count;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Query entities returning both data and count (for truncation detection).
 * Server returns { data: EntityResult[], count: number }.
 */
export async function queryEntitiesWithCount(
  filters: QueryFilters,
  opts: CompanyDbRequestOptions,
): Promise<QueryResultWithCount> {
  const params = new URLSearchParams();
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.type) params.set("type", filters.type);
  if (filters.status) params.set("status", filters.status);
  if (filters.documentId) params.set("documentId", filters.documentId);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  if (filters.view) params.set("view", filters.view);

  const base = resolveBaseUrl(opts);
  const url = `${base}/api/v1/query?${params}`;
  const res = await fetch(url, { headers: buildHeaders(url, "GET", opts) });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Company-DB query failed (${res.status}): ${error}`);
  }

  return res.json();
}

/**
 * Get a summary of financial data for system prompt context.
 * Returns a pre-formatted text summary.
 */
export async function getFinancialSummary(
  opts: CompanyDbRequestOptions,
): Promise<string> {
  let financeSummaryText: string | null = null;
  try {
    const financeSummary = await getDomainSummary("finance", opts);
    if (financeSummary?.body) {
      financeSummaryText = formatSummaryForPrompt(financeSummary);
      if (
        !isLowSignalFinanceSummary(financeSummary) &&
        !hasSuspiciousSignedExpenseMetrics(financeSummary)
      ) {
        const newerImportNotice = await getNewerFinanceImportNotice(financeSummary, opts);
        return newerImportNotice ? `${financeSummaryText}\n\n${newerImportNotice}` : financeSummaryText;
      }
    }
  } catch {
    // Summary layer is optional — fall back to raw-entity aggregation.
  }

  const [financeEntities, expenses] = await Promise.all([
    queryEntities({ domain: "finance", limit: 200, view: "summary" }, opts),
    queryEntitiesWithCount({ domain: "expenses", limit: 0, view: "summary" }, opts),
  ]);

  const lines: string[] = [];
  const canonicalPoints = buildCanonicalFinanceSeries(financeEntities);
  const latestPoint = getLatestCanonicalFinancePoint(canonicalPoints);

  lines.push(...summarizeCanonicalFinanceCoverage(financeEntities, canonicalPoints));

  if (latestPoint) {
    if (latestPoint.revenue !== null || latestPoint.expenses !== null || latestPoint.netIncome !== null) {
      lines.push(
        `Revenue: ${metricToText(latestPoint.revenue)}, Expenses: ${metricToText(latestPoint.expenses)}, Net: ${metricToText(latestPoint.netIncome)}`,
      );
    }

    if (latestPoint.cashPosition !== null || latestPoint.runwayMonths !== null) {
      lines.push(
        `Cash position: ${metricToText(latestPoint.cashPosition)}, Runway: ${metricToText(latestPoint.runwayMonths)} months`,
      );
    }

    if (latestPoint.importedOnly) {
      lines.push("Source basis: imported finance statements only");
    }

    if (
      latestPoint.sourceKinds.length > 0 &&
      latestPoint.sourceKinds.every((sourceKind) => sourceKind === "snapshot")
    ) {
      lines.push("Source basis: legacy finance snapshots fallback");
    } else if (latestPoint.sourceKinds.includes("snapshot")) {
      lines.push("Source warning: legacy finance snapshots were used only where canonical statement coverage was missing");
    }

    if (latestPoint.hasConflict) {
      lines.push(`Quality warning: conflicting finance statements for ${latestPoint.period}`);
    }
  }

  if (expenses.count > 0) {
    lines.push(`Recent expenses: ${expenses.count} items`);
  }

  return lines.join("\n") || financeSummaryText || "No financial data available yet.";
}

const EXECUTIVE_NON_FINANCIAL_DOMAINS = ADVISOR_DOMAIN_ORDER.filter(
  (domain) => !["finance", "banking", "revenue", "expenses"].includes(domain),
);

export async function getCompanyManagementSummary(
  opts: CompanyDbRequestOptions,
): Promise<string> {
  const financeSummary = await getFinancialSummary(opts);

  const nonFinancialCounts = await Promise.all(
    EXECUTIVE_NON_FINANCIAL_DOMAINS.map(async (domain) => {
      try {
        const result = await queryEntitiesWithCount(
          { domain, limit: 0, view: "summary" },
          opts,
        );
        return {
          domain,
          count: result.count,
        };
      } catch {
        return {
          domain,
          count: 0,
        };
      }
    }),
  );

  const activeDomains = nonFinancialCounts.filter((entry) => entry.count > 0);
  if (activeDomains.length === 0) {
    return financeSummary;
  }

  const domainSamples = await Promise.all(
    activeDomains.map(async ({ domain, count }) => {
      let summaryText: string | null = null;
      let summaryHeadline: string | null = null;
      let summaryCount: number | null = null;
      try {
        const domainSummary = await getDomainSummary(domain, opts);
        if (domainSummary?.body) {
          summaryText = formatSummaryForPrompt(domainSummary);
          summaryHeadline = getSummaryExecutiveLine(domainSummary);
          summaryCount = getSummarySourceCount(domainSummary);
        }
      } catch {
        // Domain summary is optional.
      }

      let records: EntityResult[] = [];
      try {
        records = await queryEntities(
          {
            domain,
            limit: Math.min(Math.max(count, 3), 12),
            view: "summary",
          },
          opts,
        );
      } catch {
        records = [];
      }
      const decisionGradeRecords = filterDecisionGradeAdvisorEntities(records);

      return {
        domain,
        count: summaryCount ?? count,
        summaryHeadline,
        summaryText,
        highlights: selectAdvisorEntities(decisionGradeRecords, 2),
      };
    }),
  );

  const domainLines = domainSamples
    .filter(({ count, summaryHeadline, highlights }) => {
      if (count > 0) return true;
      return Boolean(summaryHeadline) && highlights.length > 0;
    })
    .map(({ domain, count, summaryHeadline, summaryText, highlights }) => {
      const label = getAdvisorDomainLabel(domain);
      const parts = [`${label}: ${count} record${count === 1 ? "" : "s"}`];

      if (summaryHeadline) {
        parts.push(summaryHeadline);
      } else if (highlights[0]?.managerialSummary) {
        parts.push(`key doc ${highlights[0].title ?? highlights[0].type}: ${highlights[0].managerialSummary}`);
      } else if (summaryText) {
        parts.push(summaryText.split("\n")[0] ?? summaryText);
      }

      return `- ${parts.join(" | ")}`;
    });

  return [
    financeSummary,
    "",
    domainLines.length > 0 ? "Non-financial decision context:" : "",
    ...domainLines,
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

// ── Knowledge document submission ────────────────────────────────────────

// Must match an existing people/resources/{agentId}.qmd in the company repo
const KNOWLEDGE_AGENT_ID = process.env.KNOWLEDGE_AGENT_ID ?? "knowledge-agent";
const SUMMARY_AGENT_ID = process.env.SUMMARY_MATERIALIZER_AGENT_ID ?? "summary-materializer";
const CONSULTANT_AGENT_ID = process.env.CONSULTANT_AGENT_ID ?? "consultant-agent";
const COMMUNICATIONS_AGENT_ID = process.env.COMMUNICATIONS_AGENT_ID ?? "communications-agent";

export interface KnowledgeDocPayload {
  documentId: string;
  title: string;
  text: string;
  wordCount: number;
}

export interface SummaryDocPayload {
  targetId: string;
  domain: string;
  filePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  commitMessage?: string;
  metadata?: Record<string, unknown>;
}

export interface CompanyDbCommitPayload {
  domain: string;
  filePath: string;
  content: string;
  commitMessage: string;
  metadata?: Record<string, unknown>;
}

export interface CompanyDbDeletePayload {
  domain: string;
  filePaths: string[];
  commitMessage: string;
  metadata?: Record<string, unknown>;
}

export interface AgentCommitFile {
  path: string;
  content: string;
}

export interface AgentCommitPayload {
  agentId: string;
  domain: string;
  files: AgentCommitFile[];
  commitMessage: string;
  metadata?: Record<string, unknown>;
}

async function submitWriteIntent(
  writeQueuePort: number,
  intent: Record<string, unknown>,
): Promise<{ commitSha: string | null }> {
  const url = `http://${COMPANY_DB_HOST}:${writeQueuePort}/write`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildCompanyDbQueueHeadersForUrl({
      url,
      method: "POST",
      body: intent,
      contentType: "application/json",
    }),
    body: JSON.stringify(intent),
  });

  if (!res.ok) {
    const error = await res.text().catch(() => "unknown");
    throw new Error(`Write Queue error (${res.status}): ${error}`);
  }

  const result = await res.json();
  if (!result.success) {
    const code = result.error?.code ?? "unknown";
    const msg = result.error?.message ?? "Write Queue returned success: false";
    throw new Error(`Write Queue rejected (${code}): ${msg}`);
  }

  return { commitSha: result.commitSha ?? null };
}

/**
 * Submit a knowledge document to Company-DB via the Write Queue.
 *
 * Uses the real WriteIntent contract: POST /write with agentId, agentToken,
 * domain, and operation. See packages/company-db/src/queue/types.ts.
 */
export async function submitKnowledgeDoc(
  companySlug: string,
  payload: KnowledgeDocPayload,
  writeQueuePort: number,
): Promise<{ commitSha: string | null }> {
  const writeIntentToken = getCompanyDbWriteIntentToken();
  const docId = `kdoc-${payload.documentId}`;

  // Build QMD content using the yaml library for safe serialization.
  const YAML = await import("yaml");
  const frontmatter: Record<string, unknown> = {
    id: docId,
    type: "knowledge-doc",
    title: payload.title,
    source: "upload",
    document_id: payload.documentId,
    word_count: payload.wordCount,
    created_at: new Date().toISOString(),
  };
  const yamlStr = YAML.default.stringify(frontmatter).trimEnd();
  const qmdContent = `---\n${yamlStr}\n---\n\n${payload.text}\n`;

  // WriteIntent per packages/company-db/src/queue/types.ts
  const writeIntent = {
    agentId: KNOWLEDGE_AGENT_ID,
    agentToken: writeIntentToken,
    domain: "knowledge",
    operation: {
      type: "commit",
      files: [
        {
          path: `knowledge/docs/${docId}.qmd`,
          content: qmdContent,
        },
      ],
      commitMessage: `knowledge(upload): ${payload.title}`,
    },
    metadata: {
      source: "knowledge-upload",
      entityId: docId,
      companySlug,
    },
  };

  return submitWriteIntent(writeQueuePort, writeIntent);
}

export async function submitNarrativeDoc(
  companySlug: string,
  payload: NarrativeDocPayload,
  writeQueuePort: number,
): Promise<{ commitSha: string | null }> {
  const writeIntentToken = getCompanyDbWriteIntentToken();
  const docId = `ndoc-${payload.documentId}`;
  const filePath = `${payload.domain}/imports/${docId}.qmd`;

  const YAML = await import("yaml");
  const frontmatter: Record<string, unknown> = {
    id: docId,
    type: "document",
    title: payload.title,
    filename: payload.fileName ?? null,
    document_type: payload.documentType ?? "narrative",
    storage_path: `document:${payload.documentId}`,
    extraction_status: "completed",
    confidence: null,
    source: "simplified-narrative",
    document_id: payload.documentId,
    word_count: payload.wordCount,
    source_language: payload.sourceLanguage ?? null,
    routing: payload.routing ?? null,
    created_at: new Date().toISOString(),
  };
  const yamlStr = YAML.default.stringify(frontmatter).trimEnd();
  const qmdContent = `---\n${yamlStr}\n---\n\n${payload.markdown.trim()}\n`;

  const writeIntent = {
    agentId: NARRATIVE_AGENT_ID,
    agentToken: writeIntentToken,
    domain: payload.domain,
    operation: {
      type: "commit",
      files: [
        {
          path: filePath,
          content: qmdContent,
        },
      ],
      commitMessage: `${payload.domain}(narrative): ${payload.title}`,
    },
    metadata: {
      source: "simplified-narrative-upload",
      entityId: docId,
      documentId: payload.documentId,
      companySlug,
      domain: payload.domain,
    },
  };

  return submitWriteIntent(writeQueuePort, writeIntent);
}

export async function submitSummaryDoc(
  companySlug: string,
  payload: SummaryDocPayload,
  writeQueuePort: number,
): Promise<{ commitSha: string | null }> {
  const writeIntentToken = getCompanyDbWriteIntentToken();
  const qmdContent = toQmd(payload.frontmatter, payload.body);

  const writeIntent = {
    agentId: SUMMARY_AGENT_ID,
    agentToken: writeIntentToken,
    domain: payload.domain,
    operation: {
      type: "commit" as const,
      files: [
        {
          path: payload.filePath,
          content: qmdContent,
        },
      ],
      commitMessage: payload.commitMessage ?? `summary(refresh): ${payload.targetId}`,
    },
    metadata: {
      source: "summary-materializer",
      targetId: payload.targetId,
      companySlug,
      ...payload.metadata,
    },
  };

  return submitWriteIntent(writeQueuePort, writeIntent);
}

export async function submitSummaryDelete(
  companySlug: string,
  payload: {
    targetId: string;
    domain: string;
    filePath: string;
    commitMessage?: string;
    metadata?: Record<string, unknown>;
  },
  writeQueuePort: number,
): Promise<{ commitSha: string | null }> {
  const writeIntentToken = getCompanyDbWriteIntentToken();
  const writeIntent = {
    agentId: SUMMARY_AGENT_ID,
    agentToken: writeIntentToken,
    domain: payload.domain,
    operation: {
      type: "delete_files" as const,
      files: [{ path: payload.filePath }],
      commitMessage: payload.commitMessage ?? `summary(delete): ${payload.targetId}`,
    },
    metadata: {
      source: "summary-materializer",
      targetId: payload.targetId,
      companySlug,
      ...payload.metadata,
    },
  };

  return submitWriteIntent(writeQueuePort, writeIntent);
}

export async function submitAgentCommit(
  companySlug: string,
  payload: AgentCommitPayload,
  writeQueuePort: number,
): Promise<{ commitSha: string | null }> {
  const writeIntentToken = getCompanyDbWriteIntentToken();
  const writeIntent = {
    agentId: payload.agentId,
    agentToken: writeIntentToken,
    domain: payload.domain,
    operation: {
      type: "commit" as const,
      files: payload.files,
      commitMessage: payload.commitMessage,
    },
    metadata: {
      companySlug,
      ...payload.metadata,
    },
  };

  return submitWriteIntent(writeQueuePort, writeIntent);
}

export async function submitCommunicationsCommit(
  companySlug: string,
  payload: Omit<AgentCommitPayload, "agentId">,
  writeQueuePort: number,
): Promise<{ commitSha: string | null }> {
  return submitAgentCommit(
    companySlug,
    {
      ...payload,
      agentId: COMMUNICATIONS_AGENT_ID,
      metadata: {
        source: "communications-agent",
        ...payload.metadata,
      },
    },
    writeQueuePort,
  );
}

export async function submitCompanyDbCommit(
  companySlug: string,
  payload: CompanyDbCommitPayload,
  writeQueuePort: number,
): Promise<{ commitSha: string | null }> {
  return submitAgentCommit(
    companySlug,
    {
      agentId: CONSULTANT_AGENT_ID,
      domain: payload.domain,
      files: [
        {
          path: payload.filePath,
          content: payload.content,
        },
      ],
      commitMessage: payload.commitMessage,
      metadata: {
        source: "consultant-agent",
        ...payload.metadata,
      },
    },
    writeQueuePort,
  );
}

export async function submitCompanyDbDelete(
  companySlug: string,
  payload: CompanyDbDeletePayload,
  writeQueuePort: number,
): Promise<{ commitSha: string | null }> {
  const writeIntentToken = getCompanyDbWriteIntentToken();
  const writeIntent = {
    agentId: CONSULTANT_AGENT_ID,
    agentToken: writeIntentToken,
    domain: payload.domain,
    operation: {
      type: "delete_files" as const,
      files: payload.filePaths.map((path) => ({ path })),
      commitMessage: payload.commitMessage,
    },
    metadata: {
      source: "consultant-agent",
      ...payload.metadata,
      companySlug,
    },
  };

  return submitWriteIntent(writeQueuePort, writeIntent);
}
