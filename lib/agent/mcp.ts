import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { and, count, eq, sql } from "drizzle-orm";

import {
  getApiKeyAgentContext,
  requireGrantedApiKeyScope,
  requireInheritedConnectorAccess,
  requireOneOfGrantedApiKeyScopes,
  type ApiKeyAuthContext,
} from "@/lib/api-auth";
import { resolveApiKeyCompanyId } from "@/lib/api-key-access-runtime";
import { CONNECTOR_USE_API_KEY_SCOPES, type ApiKeyScope } from "@/lib/api-key-scopes";
import type {
  CompanyDomainAccessLevel,
  CompanyMembership,
} from "@/lib/db/tenant";
import { db } from "@/lib/db";
import { companies, companyMembers, documents, users } from "@/lib/db/schema";
import { createCompanyForUser } from "@/lib/companies/create";
import {
  coerceCompanySettings,
  getCompanyBusinessProfileAdditions,
  getCompanyDescription,
  normalizeCompanyBusinessProfileAdditions,
  normalizeCompanyDescription,
  withCompanyBusinessProfileAdditions,
  withCompanyDescription,
} from "@/lib/company-settings";
import { buildCorpusDestinations } from "@/lib/corpus-navigation";
import { createMcpClient, callMcpTool } from "@/lib/company-db/mcp-client";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { getCompanyManagementSummary, readQmdFile } from "@/lib/company-db/client";
import {
  resolveAgentSafeEntityView,
  resolveAgentSafeQueryLimit,
  resolveAgentSafeSearchLimit,
  truncateAgentFilePreview,
} from "@/lib/company-db/agent-safe-defaults";
import {
  deleteDocumentForCompany,
  getDocumentDownloadDescriptor,
  getDocumentStatusForCompany,
  listDocumentsForCompany,
} from "@/lib/documents/operations";
import {
  buildPeoplePayload,
  createPersonProfile,
  deletePersonProfile,
  resolvePeopleCompanyContext,
  updatePersonProfile,
  PeopleRequestError,
} from "@/lib/people/api";
import {
  buildAgentContextPackForMembership,
  parseAgentContextIntent,
} from "@/lib/agent-context";
import {
  type AgentConnectorCatalogEntry,
  isConnectorHubError,
  listAgentConnectors,
  resolveConnectorAction,
  runAgentConnectorAction,
  runHubConnectorAction,
} from "@/lib/agent/connectors";
import {
  getConnectorExtraActionScopes,
  getConnectorProviderDefinition,
} from "@/lib/connectors/provider-registry";
import { summarizeMcpToolPayloadForContent } from "@/lib/agent/mcp-summary";
import { resolveWorkflow } from "@/lib/agent/workflow-router";
import { waitForReportJobForUser } from "@/lib/report-jobs/poll";
import {
  createPlannedReportJob,
  getReportJobArtifactByIdForUser,
  getReportJobByIdForUser,
  listReportJobArtifactsForUser,
  listReportJobsForUser,
  queueReportJob,
} from "@/lib/report-jobs/store";
import {
  filterReportJobAccessibleCompanies,
  requireReportJobInheritedAccess,
} from "@/lib/report-jobs/access";
import type { ReportJobArtifactRecord, ReportJobRecord } from "@/lib/report-jobs/types";

const MANAGER_ROLES = new Set(["owner", "admin"]);
const DOMAIN_ACCESS_LEVEL_RANK: Record<CompanyDomainAccessLevel, number> = {
  metadata: 0,
  read: 1,
  file: 2,
  write: 3,
  admin: 4,
};
type AgentMcpSurface = "api_key" | "chatgpt_employee";
const CHATGPT_EMPLOYEE_AGENT_MCP_SCOPES: ApiKeyScope[] = [
  "companies.read",
  "profile.read",
  "settings.read",
  "dashboard.read",
  "people.read",
  "documents.read",
  "company_db.read",
  "company_db.file",
  "company_db.mcp",
  "connectors.read",
  ...CONNECTOR_USE_API_KEY_SCOPES,
];
const ASSIGNABLE_ROLES = new Set([
  "owner",
  "admin",
  "member",
  "viewer",
  "cfo_agent",
  "external_accountant",
  "investor_view",
  "partner_agent",
]);
const CHATGPT_EMPLOYEE_TOOL_MODE = "chatgpt_employee" as const satisfies AgentMcpSurface;
const CHATGPT_EMPLOYEE_READ_ONLY_CONNECTOR_ACTIONS = {
  bamboohr: [
    "list_employees",
    "get_employee",
    "list_directory",
    "list_departments",
    "get_org_structure",
    "list_whos_out",
    "list_time_off_requests",
  ],
  confluence: ["list_spaces", "list_pages", "get_page", "search_content"],
  custom_mcp: ["list_tools", "call_tool"],
  dynamics_bc: [
    "list_companies",
    "list_customers",
    "list_bank_accounts",
    "list_vendors",
    "list_sales_invoices",
    "get_sales_invoice",
    "list_sales_invoice_lines",
    "list_purchase_invoices",
    "get_purchase_invoice",
    "list_purchase_invoice_lines",
    "list_vendor_payment_journals",
    "list_vendor_payments",
    "get_vendor_payment",
    "list_customer_payment_journals",
    "list_customer_payments",
    "get_customer_payment",
    "list_journals",
    "list_journal_lines",
    "list_general_ledger_entries",
  ],
  ga4: ["list_properties", "get_property", "run_report", "list_dimensions_metrics"],
  github: [
    "list_repos",
    "get_repo",
    "list_issues",
    "list_pull_requests",
    "list_commits",
    "list_workflow_runs",
  ],
  google_ads: [
    "list_accessible_customers",
    "get_customer",
    "list_campaigns",
    "get_campaign",
    "list_campaign_metrics",
  ],
  google_drive: ["list_files", "get_file_metadata", "download_file"],
  google_search_console: [
    "list_sites",
    "get_site",
    "query_search_analytics",
    "list_sitemaps",
  ],
  hubspot: [
    "list_portals",
    "list_contacts",
    "search_contacts",
    "list_companies",
    "list_deals",
    "get_deal",
  ],
  jira: [
    "list_projects",
    "search_issues",
    "get_issue",
    "list_issue_comments",
    "list_issue_transitions",
  ],
  meta_ads: [
    "list_ad_accounts",
    "list_campaigns",
    "get_campaign",
    "get_account_insights",
    "get_campaign_insights",
  ],
  metabase: [
    "list_collections",
    "get_collection",
    "list_dashboards",
    "get_dashboard",
    "list_cards",
    "get_card",
    "list_databases",
    "search_content",
  ],
  ms_graph: [
    "get_organization",
    "list_users",
    "get_user",
    "list_groups",
    "list_group_members",
    "list_calendar_events",
    "get_online_meeting",
  ],
  odoo: ["search_records", "get_record"],
  payhawk: [
    "list_fund_accounts",
    "list_expenses",
    "get_expense",
    "get_expense_workflow",
    "get_bank_statement",
  ],
  slack: [
    "list_channels",
    "get_channel_info",
    "list_users",
    "search_all",
    "list_files",
    "get_message_reactions",
    "list_channel_members",
    "get_channel_history",
    "get_thread_replies",
  ],
  telegram: ["list_chats", "get_recent_messages"],
  tiktok_ads: [
    "list_advertisers",
    "list_campaigns",
    "get_campaign",
    "get_account_insights",
    "get_campaign_insights",
  ],
  vercel: [
    "list_teams",
    "list_projects",
    "get_project",
    "list_deployments",
    "get_deployment",
    "get_build_logs",
    "get_runtime_logs",
    "list_domains",
  ],
  zendesk: [
    "list_tickets",
    "get_ticket",
    "get_ticket_comments",
    "get_ticket_audits",
    "list_users",
    "list_organizations",
    "list_views",
    "list_macros",
    "list_help_center_categories",
    "list_help_center_sections",
    "list_help_center_articles",
  ],
} as const satisfies Record<string, readonly string[]>;
const CHATGPT_EMPLOYEE_ALLOWED_TOOLS = new Set([
  "get_session",
  "list_companies",
  "resolve_workflow",
  "get_context_pack",
  "direct_odoo_lookup",
  "open_company_app",
  "get_profile",
  "get_company_settings",
  "get_dashboard",
  "list_people",
  "list_documents",
  "get_document_status",
  "get_document_download",
  "create_report_job",
  "wait_for_report_job",
  "list_report_jobs",
  "get_report_job",
  "get_report_job_artifact",
  "list_connectors",
  "call_connector_action",
  "get_company_file",
  "query_company_entities",
  "search_company_entities",
  "get_company_entity",
]);
const CHATGPT_EMPLOYEE_MAX_STRUCTURED_CONTENT_BYTES = 24_000;
const CHATGPT_EMPLOYEE_MAX_RESULT_ITEMS = 12;
const CHATGPT_EMPLOYEE_MAX_ARRAY_ITEMS = 6;
const CHATGPT_EMPLOYEE_MAX_OBJECT_KEYS = 18;
const CHATGPT_EMPLOYEE_MAX_STRING_CHARS = 240;
const REPORT_JOB_DEFAULT_CHATGPT_WAIT_SECONDS = 45;
const REPORT_JOB_MAX_WAIT_SECONDS = 90;
const REPORT_JOB_MIN_POLL_INTERVAL_SECONDS = 2;
const REPORT_JOB_DEFAULT_POLL_INTERVAL_SECONDS = 3;
const REPORT_JOB_MAX_POLL_INTERVAL_SECONDS = 10;
const CHATGPT_DIRECT_ODOO_LOOKUP_MODELS = [
  "account.move",
  "account.move.line",
  "account.payment",
  "pos.order",
  "pos.session",
  "account.account",
  "res.partner",
] as const;
const READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const COMPANY_REF_INPUT_SCHEMA = z
  .string()
  .optional()
  .describe("Company UUID. If the exact UUID is unavailable, pass the company slug or exact company name.");
const MIXED_CONNECTOR_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const NON_DESTRUCTIVE_MUTATION_TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const CHATGPT_EMPLOYEE_PREFERRED_RECORD_KEYS = [
  "id",
  "name",
  "display_name",
  "ref",
  "date",
  "invoice_date",
  "invoice_date_due",
  "state",
  "status",
  "move_type",
  "payment_state",
  "amount_total",
  "amount_untaxed",
  "amount_tax",
  "balance",
  "debit",
  "credit",
  "currency_id",
  "partner_id",
  "company_id",
  "journal_id",
  "account_id",
  "analytic_account_id",
  "team_id",
  "department_id",
  "invoice_user_id",
  "write_date",
  "create_date",
  "fileName",
  "title",
  "filePath",
  "path",
] as const;
const REPORT_ARTIFACT_PREVIEW_MAX_CHARS = 4_000;
const BUSINESS_PROFILE_ADDITIONS_INPUT_SCHEMA = z.object({
  version: z.literal(1).optional(),
  marketResearchSummary: z.string().nullable().optional(),
  targetMarkets: z.array(z.string()).optional(),
  customerSegments: z.array(z.string()).optional(),
  productLines: z.array(z.string()).optional(),
  competitorSeeds: z.array(z.object({
    name: z.string(),
    website: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
  })).optional(),
  notes: z.string().nullable().optional(),
  source: z.enum(["settings_ui", "agent_api", "manual"]).optional(),
  updatedAt: z.string().nullable().optional(),
}).passthrough();

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (!/^[A-Z]{3,5}$/.test(normalized)) return null;
  return normalized;
}

function normalizeAliases(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const alias = item.replace(/\s+/g, " ").trim();
    if (!alias) continue;
    if (alias.length > 80) return null;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(alias);
  }
  return normalized.length <= 32 ? normalized : null;
}

function normalizeBusinessProfileAdditionsForAgentWrite(value: unknown) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return normalizeCompanyBusinessProfileAdditions({
    ...raw,
    source: raw.source ?? "agent_api",
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  });
}

function emailEquals(column: typeof users.email, value: string) {
  return sql<boolean>`lower(${column}) = ${value.toLowerCase()}`;
}

function resolveAppBaseUrl(): string | null {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.BETTER_AUTH_URL,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.replace(/\/$/, "");
    }
  }

  return null;
}

function resolveAbsoluteAppUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const baseUrl = resolveAppBaseUrl();
  return baseUrl ? `${baseUrl}${path.startsWith("/") ? path : `/${path}`}` : path;
}

function truncateChatgptStructuredString(value: string): string {
  if (value.length <= CHATGPT_EMPLOYEE_MAX_STRING_CHARS) return value;
  return `${value.slice(0, CHATGPT_EMPLOYEE_MAX_STRING_CHARS - 1)}…`;
}

function isOdooRelationalTuple(value: unknown): value is [number | string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    (typeof value[0] === "number" || typeof value[0] === "string") &&
    typeof value[1] === "string"
  );
}

function compactChatgptStructuredValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncateChatgptStructuredString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (isOdooRelationalTuple(value)) {
    return [value[0], truncateChatgptStructuredString(value[1])];
  }

  if (Array.isArray(value)) {
    const limit = depth === 0 ? CHATGPT_EMPLOYEE_MAX_RESULT_ITEMS : CHATGPT_EMPLOYEE_MAX_ARRAY_ITEMS;
    const items = value
      .slice(0, limit)
      .map((item) => compactChatgptStructuredValue(item, depth + 1));
    if (value.length > limit) {
      items.push(`… ${value.length - limit} more item(s) omitted`);
    }
    return items;
  }

  if (typeof value !== "object") return String(value);

  const record = value as Record<string, unknown>;
  const prioritizedKeys = CHATGPT_EMPLOYEE_PREFERRED_RECORD_KEYS.filter((key) => key in record);
  const remainingKeys = Object.keys(record).filter((key) => !prioritizedKeys.includes(key as never));
  const selectedKeys = [...prioritizedKeys, ...remainingKeys].slice(0, CHATGPT_EMPLOYEE_MAX_OBJECT_KEYS);

  const compacted: Record<string, unknown> = {};
  for (const key of selectedKeys) {
    compacted[key] = compactChatgptStructuredValue(record[key], depth + 1);
  }
  if (Object.keys(record).length > selectedKeys.length) {
    compacted._truncatedKeys = Object.keys(record).length - selectedKeys.length;
  }
  return compacted;
}

export function compactChatgptConnectorPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const compacted = compactChatgptStructuredValue(payload, 0);
  if (!compacted || typeof compacted !== "object" || Array.isArray(compacted)) {
    return payload;
  }

  const result = compacted as Record<string, unknown>;
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") <= CHATGPT_EMPLOYEE_MAX_STRUCTURED_CONTENT_BYTES) {
    return result;
  }

  const trimmed: Record<string, unknown> = { ...result, _truncatedForChatgpt: true };
  if (Array.isArray(trimmed.results)) {
    trimmed.results = trimmed.results.slice(0, 5);
    const originalCount =
      typeof payload.count === "number"
        ? payload.count
        : Array.isArray(payload.results)
          ? payload.results.length
          : null;
    if (typeof originalCount === "number" && originalCount > 5) {
      trimmed._omittedResults = originalCount - 5;
    }
  }
  if (trimmed.record && typeof trimmed.record === "object" && !Array.isArray(trimmed.record)) {
    trimmed.record = compactChatgptStructuredValue(trimmed.record, 1);
  }

  return trimmed;
}

export function getCallConnectorActionAnnotations(surface: AgentMcpSurface) {
  return surface === CHATGPT_EMPLOYEE_TOOL_MODE
    ? READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS
    : MIXED_CONNECTOR_TOOL_ANNOTATIONS;
}

export function getCallConnectorActionDescription(surface: AgentMcpSurface) {
  if (surface === CHATGPT_EMPLOYEE_TOOL_MODE) {
    return "Run a live connector action for a resolved company. Use this only for narrow live lookups after list_connectors, such as fetching one Slack thread or one specific external record. On the ChatGPT employee surface, do not use generic call_connector_action for Odoo. For explicit live Odoo lookups use direct_odoo_lookup. For monthly, weekly, segmented, or report-scale finance work call resolve_workflow and then create_report_job instead.";
  }

  return "Run a live connector action for a resolved company. For connected systems like Odoo, Slack, Jira, Payhawk, BambooHR, Confluence, Microsoft, Dynamics, Zendesk, Telegram, Google Drive, LinkedIn MCP, Custom MCP, or Metabase, use list_connectors first, then call the exact action from the catalog. Do not browse vendor websites when the needed action exists here. For Odoo lookups, prefer provider=odoo with actions like search_records or get_record.";
}

const CHATGPT_REPORT_SCALE_ODOO_MODELS = new Set([
  "account.move",
  "account.move.line",
  "account.account",
  "account.analytic.line",
  "pos.order",
  "pos.session",
]);

const CHATGPT_NARROW_ODOO_IDENTIFIER_FIELDS = new Set([
  "id",
  "ids",
  "name",
  "ref",
  "move_name",
  "payment_reference",
  "display_name",
  "pos_reference",
]);

const CHATGPT_ODOO_PERIOD_FIELDS = new Set([
  "date",
  "invoice_date",
  "invoice_date_due",
  "create_date",
  "write_date",
  "order_date",
  "date_order",
  "start_date",
  "end_date",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extractOdooDomainPredicates(domain: unknown): Array<{
  field: string;
  operator: string;
  value: unknown;
}> {
  if (!Array.isArray(domain)) return [];

  const predicates: Array<{
    field: string;
    operator: string;
    value: unknown;
  }> = [];

  for (const clause of domain) {
    if (
      Array.isArray(clause) &&
      clause.length >= 3 &&
      typeof clause[0] === "string" &&
      typeof clause[1] === "string"
    ) {
      predicates.push({
        field: clause[0],
        operator: clause[1],
        value: clause[2],
      });
      continue;
    }

    if (Array.isArray(clause)) {
      predicates.push(...extractOdooDomainPredicates(clause));
    }
  }

  return predicates;
}

function isNarrowOdooIdentifierLookup(input: Record<string, unknown>): boolean {
  if (typeof input.id === "number" || typeof input.id === "string") return true;

  if (Array.isArray(input.ids) && input.ids.length > 0 && input.ids.length <= 20) {
    return true;
  }

  const predicates = extractOdooDomainPredicates(input.domain);
  return predicates.some((predicate) => {
    if (!CHATGPT_NARROW_ODOO_IDENTIFIER_FIELDS.has(predicate.field)) {
      return false;
    }
    return ["=", "ilike", "like", "in"].includes(predicate.operator);
  });
}

function hasOdooPeriodFilter(input: Record<string, unknown>): boolean {
  const predicates = extractOdooDomainPredicates(input.domain);
  return predicates.some((predicate) => CHATGPT_ODOO_PERIOD_FIELDS.has(predicate.field));
}

export function getChatgptEmployeeConnectorActionGuardrail(
  provider: string,
  action: string,
  input: unknown,
): Record<string, unknown> | null {
  const normalizedProvider = provider.trim();
  const { resolvedAction } = resolveConnectorAction(provider, action);
  if (normalizedProvider !== "odoo" || resolvedAction !== "search_records") {
    return null;
  }

  if (!isPlainRecord(input)) {
    return null;
  }

  const model = typeof input.model === "string" ? input.model : "";
  if (!CHATGPT_REPORT_SCALE_ODOO_MODELS.has(model)) {
    return null;
  }

  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : null;
  const offset =
    typeof input.offset === "number" && Number.isFinite(input.offset) ? input.offset : 0;
  const fields = Array.isArray(input.fields)
    ? input.fields.filter((field): field is string => typeof field === "string")
    : [];
  const periodFiltered = hasOdooPeriodFilter(input);
  const narrowLookup = isNarrowOdooIdentifierLookup(input);
  const oversizedProjection = fields.length === 0 || fields.length > 12;
  const wideWindow = limit === null || limit > 50 || offset > 0;

  if (narrowLookup && !periodFiltered && !wideWindow) {
    return null;
  }

  if (!periodFiltered && !wideWindow && !oversizedProjection) {
    return null;
  }

  return {
    status: 409,
    error:
      "This Odoo connector call looks like report-scale finance work. Do not run raw search_records for month, week, venue, department, or whole-period reporting in the ChatGPT employee surface.",
    reason:
      "Route the request through the report worker so the result is stable, auditable, and artifact-backed instead of being truncated or estimated from partial ERP pages.",
    primaryWorkflow: "report_job",
    recommendedTool: "create_report_job",
    followUpTools: ["resolve_workflow", "create_report_job"],
    nextAction:
      "Call resolve_workflow with the original user request, then create_report_job for the same company instead of continuing inline Odoo pagination.",
    blockedProvider: normalizedProvider,
    blockedAction: resolvedAction,
    blockedModel: model,
  };
}

function buildChatgptEmployeeGenericOdooRedirect(
  company: { id: string; name: string; slug: string | null | undefined },
): Record<string, unknown> {
  return {
    company,
    status: 409,
    error:
      "Generic call_connector_action cannot run Odoo on the ChatGPT employee surface.",
    reason:
      "This keeps ChatGPT from drifting into raw Odoo loops. Use direct_odoo_lookup only for explicit narrow live Odoo requests, or create_report_job for report-scale finance work.",
    primaryWorkflow: "direct_odoo_lookup",
    recommendedTool: "direct_odoo_lookup",
    followUpTools: ["direct_odoo_lookup", "resolve_workflow", "create_report_job"],
    nextAction:
      "If the user explicitly asked for a direct live Odoo lookup or exact current number from Odoo, call direct_odoo_lookup. Otherwise call resolve_workflow and then create_report_job.",
  };
}

export function serializeReportJobArtifactForSurface(
  artifact: ReportJobArtifactRecord,
  surface: AgentMcpSurface,
  options?: { includePreview?: boolean },
): Record<string, unknown> {
  const metadata = artifact.metadata ?? {};
  const previewable = metadata.previewable === true;
  const includePreview = options?.includePreview === true;
  const payload: Record<string, unknown> = {
    id: artifact.id,
    reportJobId: artifact.reportJobId,
    companyId: artifact.companyId,
    kind: artifact.kind,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    previewable,
    viewPath: artifact.viewPath,
    viewUrl: resolveAbsoluteAppUrl(artifact.viewPath),
    downloadPath: artifact.downloadPath,
    downloadUrl: resolveAbsoluteAppUrl(artifact.downloadPath),
    createdAt: artifact.createdAt,
  };

  if (includePreview && previewable && typeof metadata.textContent === "string") {
    const maxChars =
      surface === CHATGPT_EMPLOYEE_TOOL_MODE
        ? REPORT_ARTIFACT_PREVIEW_MAX_CHARS
        : metadata.textContent.length;
    payload.previewText =
      metadata.textContent.length <= maxChars
        ? metadata.textContent
        : `${metadata.textContent.slice(0, maxChars - 1)}…`;
    payload.previewTruncated = metadata.textContent.length > maxChars;
  }

  return payload;
}

function serializeReportJobForSurface(
  job: ReportJobRecord,
  accessibleCompanies: CompanyMembership[],
): Record<string, unknown> {
  const membership =
    accessibleCompanies.find((company) => company.companyId === job.companyId) ?? null;
  return {
    ...job,
    company: membership
      ? {
          id: membership.companyId,
          name: membership.companyName,
          slug: membership.companySlug,
          role: membership.role,
        }
      : { id: job.companyId },
  };
}

function reportJobCompanies(companies: CompanyMembership[]): CompanyMembership[] {
  return filterReportJobAccessibleCompanies(companies);
}

function resolveReportJobWaitSeconds(
  surface: AgentMcpSurface,
  requestedSeconds: number | undefined,
): number {
  if (typeof requestedSeconds === "number" && Number.isFinite(requestedSeconds)) {
    return Math.max(0, Math.min(Math.trunc(requestedSeconds), REPORT_JOB_MAX_WAIT_SECONDS));
  }

  return surface === CHATGPT_EMPLOYEE_TOOL_MODE ? REPORT_JOB_DEFAULT_CHATGPT_WAIT_SECONDS : 0;
}

function resolveReportJobPollIntervalSeconds(requestedSeconds: number | undefined): number {
  if (typeof requestedSeconds === "number" && Number.isFinite(requestedSeconds)) {
    return Math.max(
      REPORT_JOB_MIN_POLL_INTERVAL_SECONDS,
      Math.min(Math.trunc(requestedSeconds), REPORT_JOB_MAX_POLL_INTERVAL_SECONDS),
    );
  }

  return REPORT_JOB_DEFAULT_POLL_INTERVAL_SECONDS;
}

async function buildReportJobToolPayload(input: {
  jobId: string;
  userId: string;
  accessibleCompanies: CompanyMembership[];
  surface: AgentMcpSurface;
  waitSeconds: number;
  pollIntervalSeconds: number;
  includePreview?: boolean;
}) {
  const accessibleCompanyIds = input.accessibleCompanies.map((membership) => membership.companyId);
  const waited =
    input.waitSeconds > 0
      ? await waitForReportJobForUser({
          jobId: input.jobId,
          userId: input.userId,
          accessibleCompanyIds,
          maxWaitMs: input.waitSeconds * 1000,
          pollIntervalMs: input.pollIntervalSeconds * 1000,
        })
      : await waitForReportJobForUser({
          jobId: input.jobId,
          userId: input.userId,
          accessibleCompanyIds,
          maxWaitMs: 0,
          pollIntervalMs: input.pollIntervalSeconds * 1000,
        });

  return {
    job: waited.job
      ? serializeReportJobForSurface(waited.job, input.accessibleCompanies)
      : null,
    artifacts: waited.artifacts.map((artifact) =>
      serializeReportJobArtifactForSurface(artifact, input.surface, {
        includePreview: input.includePreview ?? false,
      }),
    ),
    polling: {
      attempted: input.waitSeconds > 0,
      timedOut: waited.timedOut,
      polls: waited.polls,
      waitedSeconds: Math.round(waited.waitedMs / 100) / 10,
      pollIntervalSeconds: input.pollIntervalSeconds,
      maxWaitSeconds: input.waitSeconds,
      nextRecommendedTool:
        waited.timedOut && waited.job && !["completed", "failed", "cancelled", "awaiting_clarification"].includes(waited.job.status)
          ? "wait_for_report_job"
          : null,
    },
  };
}

function toolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: summarizeMcpToolPayloadForContent(payload),
      },
    ],
    structuredContent:
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : undefined,
  };
}

function toolError(payload: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: summarizeMcpToolPayloadForContent(payload),
      },
    ],
    structuredContent:
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : undefined,
  };
}

function requireConnectorActionApiKeyScopes(
  scopes: readonly string[],
  provider: string,
  action: string,
) {
  const definition = getConnectorProviderDefinition(provider);
  if (!definition) {
    throw new Error(`Unsupported connector provider: ${provider}`);
  }

  if (definition.useScopesAnyOf.length > 0) {
    requireOneOfGrantedApiKeyScopes(apiKeyScopesToGranted(scopes), [
      ...definition.useScopesAnyOf,
    ]);
  }

  for (const extraScope of getConnectorExtraActionScopes(provider, action)) {
    requireGrantedApiKeyScope(apiKeyScopesToGranted(scopes), extraScope);
  }

  return definition;
}

function apiKeyScopesToGranted(scopes: readonly string[]) {
  return scopes as ApiKeyAuthContext["scopes"];
}

function parseMcpContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const text = content
    .map((entry) =>
      entry && typeof entry === "object" && "text" in entry
        ? String((entry as { text?: unknown }).text ?? "")
        : "",
    )
    .join("")
    .trim();

  if (!text) return content;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function canManageMembers(role: string): boolean {
  return MANAGER_ROLES.has(role);
}

function isManager(role: string): boolean {
  return MANAGER_ROLES.has(role);
}

function resolveMembership(
  apiKey: ApiKeyAuthContext,
  companies: CompanyMembership[],
  requestedCompanyId: string | null | undefined,
): CompanyMembership | null {
  const companyId = resolveApiKeyCompanyId(requestedCompanyId ?? null, companies, {
    companyScopeMode: apiKey.companyScopeMode,
    defaultCompanyId: apiKey.defaultCompanyId,
    allowedCompanyIds: apiKey.allowedCompanyIds,
  });

  if (!companyId) return null;
  return companies.find((company) => company.companyId === companyId) ?? null;
}

function normalizeCompanyDbDomain(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function companyDbDomainFromPath(path: unknown): string {
  if (typeof path !== "string") return "";
  const segments = path.trim().replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean);
  if (segments[0] === "entities" && segments.length >= 3) {
    return segments[2].toLowerCase();
  }
  return segments[0]?.toLowerCase() ?? "";
}

function companyDbDomainFromQualifiedId(value: unknown): string {
  void value;
  return "";
}

function hasCompanyDbAccessLevel(
  grantedLevel: CompanyDomainAccessLevel | null,
  requiredAccessLevel: CompanyDomainAccessLevel,
): boolean {
  return Boolean(
    grantedLevel &&
      DOMAIN_ACCESS_LEVEL_RANK[grantedLevel] >=
        DOMAIN_ACCESS_LEVEL_RANK[requiredAccessLevel],
  );
}

function requireCompanyDbDomainForMembership(
  membership: CompanyMembership,
  requestedDomain: string,
  requiredAccessLevel: CompanyDomainAccessLevel = "read",
): void {
  if (!Array.isArray(membership.allowedDomains) && !membership.domainAccessLevels) return;

  if (!requestedDomain) {
    const wildcardLevel = membership.domainAccessLevels?.["*"] ?? null;
    if (
      !Array.isArray(membership.allowedDomains) &&
      hasCompanyDbAccessLevel(wildcardLevel, requiredAccessLevel)
    ) {
      return;
    }
    throw new Error(
      membership.accessSource === "inherited"
        ? "Inherited Company-DB access requires an explicit Company-DB domain"
        : "Restricted Company-DB access requires an explicit Company-DB domain",
    );
  }

  if (Array.isArray(membership.allowedDomains)) {
    const allowedDomains = new Set(
      membership.allowedDomains.map((domain) => domain.trim().toLowerCase()),
    );
    if (!allowedDomains.has(requestedDomain)) {
      if (membership.accessSource === "inherited") {
        throw new Error(
          `Inherited access to this company does not include ${requestedDomain} domain`,
        );
      }
      throw new Error(
        `Company access to this company does not include ${requestedDomain} domain`,
      );
    }
  }

  const grantedLevel =
    membership.domainAccessLevels?.[requestedDomain] ??
    membership.domainAccessLevels?.["*"] ??
    null;
  if (membership.domainAccessLevels && !grantedLevel) {
    throw new Error(
      membership.accessSource === "inherited"
        ? `Inherited access to this company does not include ${requestedDomain} domain`
        : `Company access to this company does not include ${requestedDomain} domain`,
    );
  }
  if (
    grantedLevel &&
    !hasCompanyDbAccessLevel(grantedLevel, requiredAccessLevel)
  ) {
    throw new Error(
      membership.accessSource === "inherited"
        ? `Inherited access to ${requestedDomain} domain does not include ${requiredAccessLevel} level`
        : `Company access to ${requestedDomain} domain does not include ${requiredAccessLevel} level`,
    );
  }
}

export function requireAgentMcpCompanyDbInheritedAccess(input: {
  membership: CompanyMembership;
  toolName: string;
  args: Record<string, unknown>;
}): void {
  if (!Array.isArray(input.membership.allowedDomains) && !input.membership.domainAccessLevels) return;

  switch (input.toolName) {
    case "get_company_file":
      requireCompanyDbDomainForMembership(
        input.membership,
        companyDbDomainFromPath(input.args.path),
        "file",
      );
      return;
    case "query_entities":
    case "search_entities":
      requireCompanyDbDomainForMembership(
        input.membership,
        normalizeCompanyDbDomain(input.args.domain),
      );
      return;
    case "get_entity": {
      const requestedDomain =
        normalizeCompanyDbDomain(input.args.domain) ||
        companyDbDomainFromQualifiedId(input.args.qualified_id) ||
        companyDbDomainFromQualifiedId(input.args.id);
      requireCompanyDbDomainForMembership(input.membership, requestedDomain);
      return;
    }
    default:
      return;
  }
}

export function requireAgentMcpConnectorInheritedAccess(input: {
  membership: CompanyMembership;
  provider: string;
  action: string;
}): void {
  if (input.membership.accessSource !== "inherited") return;

  const definition = getConnectorProviderDefinition(input.provider);
  if (!definition) {
    throw new Error(`Unsupported connector provider: ${input.provider}`);
  }

  if (definition.useScopesAnyOf.length > 0) {
    requireInheritedConnectorAccess(input.membership, [...definition.useScopesAnyOf]);
  }

  for (const extraScope of getConnectorExtraActionScopes(input.provider, input.action)) {
    requireInheritedConnectorAccess(input.membership, [extraScope]);
  }
}

function isToolAvailableForSurface(toolName: string, surface: AgentMcpSurface): boolean {
  if (surface !== CHATGPT_EMPLOYEE_TOOL_MODE) {
    return true;
  }
  return CHATGPT_EMPLOYEE_ALLOWED_TOOLS.has(toolName);
}

export function isChatgptEmployeeToolAvailable(toolName: string): boolean {
  return isToolAvailableForSurface(toolName, CHATGPT_EMPLOYEE_TOOL_MODE);
}

export function isChatgptEmployeeConnectorActionAllowed(
  provider: string,
  action: string,
): boolean {
  const allowedActions =
    CHATGPT_EMPLOYEE_READ_ONLY_CONNECTOR_ACTIONS[provider as keyof typeof CHATGPT_EMPLOYEE_READ_ONLY_CONNECTOR_ACTIONS];
  if (!allowedActions) {
    return false;
  }

  const { resolvedAction } = resolveConnectorAction(provider, action);
  return allowedActions.includes(resolvedAction as never);
}

export function filterChatgptEmployeeConnectorCatalogEntry<T extends {
  provider: string;
  actions: readonly { name: string; description: string }[];
}>(entry: T): T | null {
  const actions = entry.actions.filter((action) =>
    isChatgptEmployeeConnectorActionAllowed(entry.provider, action.name),
  );
  if (actions.length === 0) {
    return null;
  }

  return {
    ...entry,
    actions,
  };
}

function buildSessionScopedAgentContext(
  userId: string,
  membership: CompanyMembership,
): {
  apiKey: ApiKeyAuthContext;
  companies: CompanyMembership[];
} {
  return {
    apiKey: {
      keyId: `chatgpt-session:${userId}:${membership.companyId}`,
      userId,
      scopes: [...CHATGPT_EMPLOYEE_AGENT_MCP_SCOPES],
      companyScopeMode: "single_company",
      accessPolicyVersion: "direct_only",
      defaultCompanyId: membership.companyId,
      allowedCompanyIds: [membership.companyId],
    },
    companies: [membership],
  };
}

function buildMultiCompanySessionScopedAgentContext(
  userId: string,
  memberships: CompanyMembership[],
): {
  apiKey: ApiKeyAuthContext;
  companies: CompanyMembership[];
} {
  return {
    apiKey: {
      keyId: `chatgpt-session:${userId}:all-companies`,
      userId,
      scopes: [...CHATGPT_EMPLOYEE_AGENT_MCP_SCOPES],
      companyScopeMode: "all_user_companies",
      accessPolicyVersion: "direct_only",
      defaultCompanyId: null,
      allowedCompanyIds: memberships.map((membership) => membership.companyId),
    },
    companies: memberships,
  };
}

async function withCompanyDbTool(input: {
  membership: CompanyMembership;
  apiKey: ApiKeyAuthContext;
  toolName: string;
  args: Record<string, unknown>;
}) {
  requireAgentMcpCompanyDbInheritedAccess(input);
  const companySlug =
    input.membership.companySlug ?? (await getCompanySlug(input.membership.companyId));
  const client = await createMcpClient({
    companySlug,
    port: input.membership.companyDbPort,
    callerId: input.apiKey.userId,
    callerRole: input.membership.role,
  });

  try {
    const result = await callMcpTool(client, input.toolName, input.args);
    return parseMcpContent(result);
  } finally {
    await client.close().catch(() => {});
  }
}

function createAgentMcpServer(context: {
  apiKey: ApiKeyAuthContext;
  companies: CompanyMembership[];
  surface?: AgentMcpSurface;
}): McpServer {
  const { apiKey, companies: accessibleCompanies, surface = "api_key" } = context;

  const server = new McpServer({
    name: "corpus-agent",
    version: "0.1.0",
  });

  server.registerTool(
    "get_session",
    {
      description: "Inspect the current agent API key session, scopes, and accessible companies.",
      inputSchema: {},
    },
    async () =>
      toolResult({
        authMethod: surface === CHATGPT_EMPLOYEE_TOOL_MODE ? "session_oauth" : "api_key",
        surface,
        apiKey: {
          id: apiKey.keyId,
          scopes: apiKey.scopes,
          companyScopeMode: apiKey.companyScopeMode,
          accessPolicyVersion: apiKey.accessPolicyVersion,
          defaultCompanyId: apiKey.defaultCompanyId,
          allowedCompanyIds: apiKey.allowedCompanyIds,
        },
        companies: accessibleCompanies.map((membership) => ({
          id: membership.companyId,
          name: membership.companyName,
          slug: membership.companySlug,
          role: membership.role,
          companyDbPort: membership.companyDbPort,
          joinedAt: membership.joinedAt,
          accessSource: membership.accessSource ?? "direct",
          viaCompanyId: membership.viaCompanyId ?? null,
          viaCompanyName: membership.viaCompanyName ?? null,
          viaCompanySlug: membership.viaCompanySlug ?? null,
          relationshipId: membership.relationshipId ?? null,
          relationshipType: membership.relationshipType ?? null,
          allowedDomains: membership.allowedDomains ?? null,
          allowedConnectorScopes: membership.allowedConnectorScopes ?? null,
          pathEdgeIds: membership.pathEdgeIds ?? null,
        })),
        guidance: {
          nextStep:
            "For non-trivial tasks, call resolve_workflow next so the platform chooses the primary path, then call get_context_pack for high-stakes finance/legal/tax/governance or source-system work before you answer or act.",
          navigationOrder: [
            "get_session",
            "resolve_workflow",
            "get_context_pack for source-map caveats and company-specific rules; it is guidance, not a substitute for Company-DB, report-job, or connector checks",
            "search_company_entities first for historical/document-backed work; create_report_job only for explicit live finance reports; wait_for_report_job or get_report_job with bounded waiting until the artifact is ready; list_connectors only for explicit live/source-system requests",
            "open_company_app only for human handoff",
          ],
        },
      }),
  );

  server.registerTool(
    "list_companies",
    {
      description: "List companies accessible to the current API key.",
      inputSchema: {},
    },
    async () => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
        return toolResult({
          companies: accessibleCompanies.map((membership) => ({
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
            role: membership.role,
            companyDbPort: membership.companyDbPort,
            joinedAt: membership.joinedAt,
            accessSource: membership.accessSource ?? "direct",
            viaCompanyId: membership.viaCompanyId ?? null,
            viaCompanyName: membership.viaCompanyName ?? null,
            viaCompanySlug: membership.viaCompanySlug ?? null,
            relationshipId: membership.relationshipId ?? null,
            relationshipType: membership.relationshipType ?? null,
            allowedDomains: membership.allowedDomains ?? null,
            allowedConnectorScopes: membership.allowedConnectorScopes ?? null,
            pathEdgeIds: membership.pathEdgeIds ?? null,
          })),
          companyScopeMode: apiKey.companyScopeMode,
          accessPolicyVersion: apiKey.accessPolicyVersion,
          defaultCompanyId: apiKey.defaultCompanyId,
        });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  if (isToolAvailableForSurface("get_context_pack", surface)) {
    server.registerTool(
      "get_context_pack",
      {
        description:
          "Return the compact Agent Context Pack for a resolved company. Use after resolve_workflow and before high-stakes finance, legal, tax, governance, operating-entity, or source-system work. The pack contains source-map rules and caveats, not raw files or credentials.",
        annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
        inputSchema: {
          company_id: COMPANY_REF_INPUT_SCHEMA,
          intent: z
            .enum([
              "general",
              "finance",
              "operations",
              "documents",
              "legal",
              "people",
              "connector_live_lookup",
              "reporting",
            ])
            .optional(),
          query: z.string().optional(),
        },
      },
      async (args) => {
        try {
          requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
          const membership = resolveMembership(
            apiKey,
            accessibleCompanies,
            args.company_id ?? null,
          );
          if (!membership) {
            return toolError({
              error: "company_id is required or not accessible",
              status: 400,
            });
          }

          const pack = await buildAgentContextPackForMembership({
            membership,
            scopes: apiKey.scopes,
            authSurface: "api_key",
            intent: parseAgentContextIntent(args.intent),
            query: args.query ?? null,
          });

          return toolResult(pack);
        } catch (err) {
          return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
        }
      },
    );
  }

  if (isToolAvailableForSurface("resolve_workflow", surface)) {
    server.registerTool(
      "resolve_workflow",
      {
        description:
          "Resolve the primary execution path for a task. This router decides whether to use connectors, report jobs, Company-DB, or company selection next. Use it after get_session for non-trivial requests instead of guessing the path.",
        annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
        inputSchema: {
          request: z.string().min(1),
          company_id: z.string().optional(),
        },
      },
      async (args) => {
        const resolution = resolveWorkflow({
          request: args.request,
          requestedCompanyId: args.company_id ?? null,
          companyScopeMode: apiKey.companyScopeMode,
          defaultCompanyId: apiKey.defaultCompanyId,
          allowedCompanyIds: apiKey.allowedCompanyIds,
          scopes: apiKey.scopes,
          accessibleCompanies,
          baseUrl: resolveAppBaseUrl(),
        });

        return toolResult(resolution);
      },
    );
  }

  server.registerTool(
    "open_company_app",
    {
      description:
        "Return the exact Corpus browser URLs for the resolved company. Use this instead of guessing site paths, extensions, or login routes when a browser page is actually needed.",
      annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
      inputSchema: {
        company_id: COMPANY_REF_INPUT_SCHEMA,
      },
    },
    async (args) => {
      const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
      if (!membership) {
        return toolError({ error: "company_id is required or not accessible", status: 400 });
      }

      const baseUrl = resolveAppBaseUrl();
      if (!baseUrl) {
        return toolError({ error: "Public Corpus base URL is not configured", status: 500 });
      }

      return toolResult({
        company: {
          id: membership.companyId,
          name: membership.companyName,
          slug: membership.companySlug,
        },
        ...buildCorpusDestinations(baseUrl, membership.companySlug),
      });
    },
  );

  if (isToolAvailableForSurface("create_company", surface)) {
    server.registerTool(
      "create_company",
      {
        description: "Create a new company owned by the API key owner.",
        inputSchema: {
          name: z.string().min(1),
          jurisdiction: z.string().optional(),
          entityType: z.string().optional(),
          businessType: z.string().optional(),
          website: z.string().optional(),
          reportingCurrency: z.string().optional(),
          companyDescription: z.string().optional(),
        },
      },
      async (args) => {
        try {
          requireGrantedApiKeyScope(apiKey.scopes, "companies.create");
          if (apiKey.companyScopeMode !== "all_user_companies") {
            return toolError({
              error: "companies.create is only supported for all_user_companies API keys",
              status: 403,
            });
          }

          const name = args.name.trim();
          if (name.length > 120) {
            return toolError({ error: "Company name must be 120 characters or fewer", status: 400 });
          }

          const reportingCurrency = normalizeCurrency(args.reportingCurrency);
          const companyDescription = normalizeCompanyDescription(args.companyDescription);
          if (args.reportingCurrency !== undefined && reportingCurrency === null) {
            return toolError({
              error: "reportingCurrency must be a valid currency code (e.g. USD)",
              status: 400,
            });
          }

          const { company, provisioning } = await createCompanyForUser({
            userId: apiKey.userId,
            name,
            jurisdiction: args.jurisdiction,
            entityType: args.entityType,
            businessType: args.businessType,
            website: args.website,
            reportingCurrency: args.reportingCurrency,
            companyDescription,
          });

          return toolResult({
            company,
            provisioning,
          });
        } catch (err) {
          return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
        }
      },
    );
  }

  server.registerTool(
    "get_profile",
    {
      description: "Read the current API key owner's profile.",
      inputSchema: {},
    },
    async () => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "profile.read");
        const [user] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            image: users.image,
            emailVerified: users.emailVerified,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          })
          .from(users)
          .where(eq(users.id, apiKey.userId))
          .limit(1);

        if (!user) {
          return toolError({ error: "User not found", status: 404 });
        }

        return toolResult({ profile: user });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  if (isToolAvailableForSurface("update_profile", surface)) {
    server.registerTool(
      "update_profile",
      {
        description: "Update the current API key owner's profile fields.",
        inputSchema: {
          name: z.string().optional(),
          image: z.string().nullable().optional(),
        },
      },
      async (args) => {
        try {
          requireGrantedApiKeyScope(apiKey.scopes, "profile.write");
          const name = stringOrNull(args.name);
          const image = args.image === null ? null : stringOrNull(args.image);

          if (name === null && image === null && args.image !== null && args.image !== undefined) {
            return toolError({ error: "At least one of name or image is required", status: 400 });
          }
          if (name !== null && name.length > 120) {
            return toolError({ error: "name must be 120 characters or fewer", status: 400 });
          }
          if (image !== null && image.length > 2048) {
            return toolError({ error: "image must be 2048 characters or fewer", status: 400 });
          }

          const values: { updatedAt: Date; name?: string; image?: string | null } = {
            updatedAt: new Date(),
          };
          if (name !== null) values.name = name;
          if (args.image === null) {
            values.image = null;
          } else if (image !== null) {
            values.image = image;
          }

          const [updated] = await db
            .update(users)
            .set(values)
            .where(eq(users.id, apiKey.userId))
            .returning({
              id: users.id,
              email: users.email,
              name: users.name,
              image: users.image,
              emailVerified: users.emailVerified,
              createdAt: users.createdAt,
              updatedAt: users.updatedAt,
            });

          if (!updated) {
            return toolError({ error: "User not found", status: 404 });
          }

          return toolResult({ profile: updated });
        } catch (err) {
          return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
        }
      },
    );
  }

  if (isToolAvailableForSurface("get_company_members", surface)) {
    server.registerTool(
      "get_company_members",
    {
      description: "List company members for a resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "companies.members.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }

        const members = await db
          .select({
            userId: companyMembers.userId,
            role: companyMembers.role,
            joinedAt: companyMembers.createdAt,
            name: users.name,
            email: users.email,
          })
          .from(companyMembers)
          .innerJoin(users, eq(users.id, companyMembers.userId))
          .where(eq(companyMembers.companyId, membership.companyId));

        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
            role: membership.role,
          },
          members,
        });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
    );
  }

  if (isToolAvailableForSurface("add_company_member", surface)) {
    server.registerTool(
      "add_company_member",
    {
      description: "Add or update a company member by email for the resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
        email: z.string().email(),
        role: z.string().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "companies.members.manage");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        if (!canManageMembers(membership.role)) {
          return toolError({ error: "Forbidden", status: 403 });
        }

        const email = args.email.trim().toLowerCase();
        const role = typeof args.role === "string" ? args.role.trim() : "member";
        if (!ASSIGNABLE_ROLES.has(role)) {
          return toolError({ error: "Invalid role", status: 400 });
        }
        if (role === "owner" && membership.role !== "owner") {
          return toolError({ error: "Only owners can assign owner role", status: 403 });
        }

        const [targetUser] = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(emailEquals(users.email, email))
          .limit(1);

        if (!targetUser) {
          return toolError({
            error: "Target user not found. The user must register first.",
            status: 404,
          });
        }

        const [existing] = await db
          .select({ id: companyMembers.id })
          .from(companyMembers)
          .where(
            and(
              eq(companyMembers.companyId, membership.companyId),
              eq(companyMembers.userId, targetUser.id),
            ),
          )
          .limit(1);

        if (existing) {
          await db.update(companyMembers).set({ role }).where(eq(companyMembers.id, existing.id));
        } else {
          await db.insert(companyMembers).values({
            companyId: membership.companyId,
            userId: targetUser.id,
            role,
          });
        }

        return toolResult({
          status: "ok",
          member: {
            userId: targetUser.id,
            name: targetUser.name,
            email: targetUser.email,
            role,
          },
        });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
    );
  }

  if (isToolAvailableForSurface("remove_company_member", surface)) {
    server.registerTool(
      "remove_company_member",
    {
      description: "Remove a company member by userId or email for the resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
        user_id: z.string().optional(),
        email: z.string().email().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "companies.members.manage");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        if (!canManageMembers(membership.role)) {
          return toolError({ error: "Forbidden", status: 403 });
        }

        let targetUserId = typeof args.user_id === "string" ? args.user_id.trim() : "";
        const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";

        if (!targetUserId && email) {
          const [targetUser] = await db
            .select({ id: users.id })
            .from(users)
            .where(emailEquals(users.email, email))
            .limit(1);
          targetUserId = targetUser?.id ?? "";
        }

        if (!targetUserId) {
          return toolError({ error: "user_id or email is required", status: 400 });
        }

        const [targetMembership] = await db
          .select({ id: companyMembers.id, role: companyMembers.role })
          .from(companyMembers)
          .where(
            and(
              eq(companyMembers.companyId, membership.companyId),
              eq(companyMembers.userId, targetUserId),
            ),
          )
          .limit(1);

        if (!targetMembership) {
          return toolError({ error: "Member not found", status: 404 });
        }

        if (targetMembership.role === "owner") {
          if (membership.role !== "owner") {
            return toolError({ error: "Only owners can remove owners", status: 403 });
          }

          const owners = await db
            .select({ id: companyMembers.id })
            .from(companyMembers)
            .where(
              and(
                eq(companyMembers.companyId, membership.companyId),
                eq(companyMembers.role, "owner"),
              ),
            );

          if (owners.length <= 1) {
            return toolError({ error: "Cannot remove the last owner from a company", status: 400 });
          }
        }

        await db.delete(companyMembers).where(eq(companyMembers.id, targetMembership.id));
        return toolResult({ status: "ok" });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
    );
  }

  server.registerTool(
    "get_company_settings",
    {
      description: "Read company settings for a resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "settings.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }

        const [company] = await db
          .select({
            id: companies.id,
            name: companies.name,
            slug: companies.slug,
            jurisdiction: companies.jurisdiction,
            entityType: companies.entityType,
            businessType: companies.businessType,
            website: companies.website,
            aliases: companies.aliases,
            reportingCurrency: companies.reportingCurrency,
            companyDbPort: companies.companyDbPort,
            settings: companies.settings,
            createdAt: companies.createdAt,
            updatedAt: companies.updatedAt,
          })
          .from(companies)
          .where(eq(companies.id, membership.companyId))
          .limit(1);

        if (!company) {
          return toolError({ error: "Company not found", status: 404 });
        }

        return toolResult({
          company,
          companyProfile: {
            website: company.website,
            businessType: company.businessType,
            jurisdiction: company.jurisdiction,
            entityType: company.entityType,
            aliases: company.aliases ?? [],
            reportingCurrency: company.reportingCurrency,
            companyDescription: getCompanyDescription(company.settings),
            businessProfileAdditions: getCompanyBusinessProfileAdditions(company.settings),
          },
          access: {
            role: membership.role,
            companyScopeMode: apiKey.companyScopeMode,
            defaultCompanyId: apiKey.defaultCompanyId,
          },
        });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  if (isToolAvailableForSurface("update_company_settings", surface)) {
    server.registerTool(
      "update_company_settings",
    {
      description: "Update editable company settings for a resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
        name: z.string().optional(),
        jurisdiction: z.string().nullable().optional(),
        entityType: z.string().nullable().optional(),
        businessType: z.string().nullable().optional(),
        website: z.string().nullable().optional(),
        aliases: z.array(z.string()).optional(),
        reportingCurrency: z.string().optional(),
        companyDescription: z.string().nullable().optional(),
        businessProfileAdditions: BUSINESS_PROFILE_ADDITIONS_INPUT_SCHEMA.nullable().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "settings.write");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        if (!isManager(membership.role)) {
          return toolError({ error: "Forbidden", status: 403 });
        }

        const name = stringOrNull(args.name);
        const jurisdiction = args.jurisdiction === null ? null : stringOrNull(args.jurisdiction);
        const entityType = args.entityType === null ? null : stringOrNull(args.entityType);
        const businessType = args.businessType === null ? null : stringOrNull(args.businessType);
        const website = args.website === null ? null : stringOrNull(args.website);
        const reportingCurrency = args.reportingCurrency === undefined
          ? undefined
          : normalizeCurrency(args.reportingCurrency);
        const companyDescription =
          args.companyDescription === undefined
            ? undefined
            : normalizeCompanyDescription(args.companyDescription);
        const aliases = args.aliases === undefined ? undefined : normalizeAliases(args.aliases);
        const businessProfileAdditions =
          args.businessProfileAdditions === undefined
            ? undefined
            : normalizeBusinessProfileAdditionsForAgentWrite(args.businessProfileAdditions);

        if (name !== null && name.length > 120) {
          return toolError({ error: "Company name must be 120 characters or fewer", status: 400 });
        }
        if (args.reportingCurrency !== undefined && reportingCurrency === null) {
          return toolError({ error: "reportingCurrency must be a valid currency code (e.g. USD)", status: 400 });
        }
        if (args.aliases !== undefined && aliases === null) {
          return toolError({ error: "aliases must be an array of up to 32 strings, 80 characters each", status: 400 });
        }

        const values: {
          updatedAt: Date;
          name?: string;
          jurisdiction?: string | null;
          entityType?: string | null;
          businessType?: string | null;
          website?: string | null;
          aliases?: string[];
          reportingCurrency?: string;
          settings?: Record<string, unknown>;
        } = { updatedAt: new Date() };

        if (name !== null) values.name = name;
        if (args.jurisdiction !== undefined) values.jurisdiction = jurisdiction;
        if (args.entityType !== undefined) values.entityType = entityType;
        if (args.businessType !== undefined) values.businessType = businessType;
        if (args.website !== undefined) values.website = website;
        if (aliases !== undefined && aliases !== null) values.aliases = aliases;
        if (reportingCurrency !== undefined && reportingCurrency !== null) {
          values.reportingCurrency = reportingCurrency;
        }
        if (args.companyDescription !== undefined || businessProfileAdditions !== undefined) {
          const [existing] = await db
            .select({ settings: companies.settings })
            .from(companies)
            .where(eq(companies.id, membership.companyId))
            .limit(1);
          if (!existing) {
            return toolError({ error: "Company not found", status: 404 });
          }
          let nextSettings = coerceCompanySettings(existing.settings);
          if (args.companyDescription !== undefined) {
            nextSettings = withCompanyDescription(nextSettings, companyDescription);
          }
          if (businessProfileAdditions !== undefined) {
            nextSettings = withCompanyBusinessProfileAdditions(nextSettings, businessProfileAdditions);
          }
          values.settings = nextSettings;
        }

        const [updated] = await db
          .update(companies)
          .set(values)
          .where(eq(companies.id, membership.companyId))
          .returning({
            id: companies.id,
            name: companies.name,
            slug: companies.slug,
            jurisdiction: companies.jurisdiction,
            entityType: companies.entityType,
            businessType: companies.businessType,
            website: companies.website,
            aliases: companies.aliases,
            reportingCurrency: companies.reportingCurrency,
            companyDbPort: companies.companyDbPort,
            settings: companies.settings,
            createdAt: companies.createdAt,
            updatedAt: companies.updatedAt,
          });

        if (!updated) {
          return toolError({ error: "Company not found", status: 404 });
        }

        return toolResult({
          company: updated,
          companyProfile: {
            website: updated.website,
            businessType: updated.businessType,
            jurisdiction: updated.jurisdiction,
            entityType: updated.entityType,
            aliases: updated.aliases ?? [],
            reportingCurrency: updated.reportingCurrency,
            companyDescription: getCompanyDescription(updated.settings),
            businessProfileAdditions: getCompanyBusinessProfileAdditions(updated.settings),
          },
        });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
    );
  }

  server.registerTool(
    "get_dashboard",
    {
      description: "Get a compact dashboard summary for a resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "dashboard.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        const companySlug =
          membership.companySlug ?? (await getCompanySlug(membership.companyId));

        const [documentCountRow, managementSummary, connectors] = await Promise.all([
          db
            .select({ total: count() })
            .from(documents)
            .where(eq(documents.companyId, membership.companyId)),
          getCompanyManagementSummary({
            companySlug,
            port: membership.companyDbPort,
            callerId: apiKey.userId,
            callerRole: membership.role,
          }),
          listAgentConnectors({
            companyId: membership.companyId,
            companySlug: membership.companySlug,
            companyDbPort: membership.companyDbPort,
          }),
        ]);

        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: companySlug,
            role: membership.role,
            companyDbPort: membership.companyDbPort,
          },
          dashboard: {
            managementSummary,
            documentCount: documentCountRow[0]?.total ?? 0,
            connectors: connectors.connectors.map((connection) => ({
              provider: connection.provider,
              status: connection.status,
              lastSyncAt: connection.lastSyncAt,
              lastError: connection.lastError,
            })),
          },
        });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  server.registerTool(
    "list_people",
    {
      description: "List CRM people profiles for a resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "people.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        const context = await resolvePeopleCompanyContext({
          companyId: membership.companyId,
          callerId: apiKey.userId,
          callerRole: membership.role,
        });
        const payload = await buildPeoplePayload(context);
        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
          },
          ...payload,
        });
      } catch (err) {
        if (err instanceof PeopleRequestError) {
          return toolError({ error: err.message, status: err.status });
        }
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  if (isToolAvailableForSurface("create_person", surface)) {
    server.registerTool(
      "create_person",
    {
      description: "Create a CRM contact or organization profile in a resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
        profile_kind: z.enum(["contact", "organization"]).optional(),
        name: z.string().min(1),
        display_name: z.string().optional(),
        role: z.string().optional(),
        organization: z.string().optional(),
        description: z.string().optional(),
        crm_channels: z.record(z.string(), z.string()).optional(),
        next_action: z.string().optional(),
        owner: z.string().optional(),
        action_required: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "people.write");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        const context = await resolvePeopleCompanyContext({
          companyId: membership.companyId,
          callerId: apiKey.userId,
          callerRole: membership.role,
        });
        const payload = await createPersonProfile(context, {
          profileKind: args.profile_kind,
          name: args.name,
          displayName: args.display_name,
          role: args.role,
          organization: args.organization,
          description: args.description,
          crmChannels: args.crm_channels,
          nextAction: args.next_action,
          owner: args.owner,
          actionRequired: args.action_required,
        });
        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
          },
          ...payload,
        });
      } catch (err) {
        if (err instanceof PeopleRequestError) {
          return toolError({ error: err.message, status: err.status });
        }
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
    );
  }

  if (isToolAvailableForSurface("update_person", surface)) {
    server.registerTool(
      "update_person",
    {
      description: "Update, archive, or merge a CRM profile in a resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
        file_path: z.string().min(1),
        action: z.enum(["update", "archive", "merge"]).optional(),
        target_file_path: z.string().optional(),
        description: z.string().optional(),
        display_name: z.string().optional(),
        role: z.string().optional(),
        organization: z.string().optional(),
        crm_channels: z.record(z.string(), z.string()).optional(),
        next_action: z.string().optional(),
        owner: z.string().optional(),
        action_required: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "people.write");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        const context = await resolvePeopleCompanyContext({
          companyId: membership.companyId,
          callerId: apiKey.userId,
          callerRole: membership.role,
        });
        const payload = await updatePersonProfile(context, {
          filePath: args.file_path,
          action: args.action,
          targetFilePath: args.target_file_path,
          description: args.description,
          displayName: args.display_name,
          role: args.role,
          organization: args.organization,
          crmChannels: args.crm_channels,
          nextAction: args.next_action,
          owner: args.owner,
          actionRequired: args.action_required,
        });
        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
          },
          ...payload,
        });
      } catch (err) {
        if (err instanceof PeopleRequestError) {
          return toolError({ error: err.message, status: err.status });
        }
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
    );
  }

  if (isToolAvailableForSurface("delete_person", surface)) {
    server.registerTool(
      "delete_person",
    {
      description: "Delete a CRM profile from a resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
        file_path: z.string().min(1),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "people.write");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        const context = await resolvePeopleCompanyContext({
          companyId: membership.companyId,
          callerId: apiKey.userId,
          callerRole: membership.role,
        });
        const payload = await deletePersonProfile(context, {
          filePath: args.file_path,
        });
        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
          },
          ...payload,
        });
      } catch (err) {
        if (err instanceof PeopleRequestError) {
          return toolError({ error: err.message, status: err.status });
        }
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
    );
  }

  server.registerTool(
    "list_documents",
    {
      description: "List documents for a resolved company with pagination and optional status/source filters.",
      inputSchema: {
        company_id: z.string().optional(),
        status: z.string().optional(),
        source: z.string().optional(),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().min(0).optional(),
        include_deleted: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "documents.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }

        const payload = await listDocumentsForCompany({
          companyId: membership.companyId,
          status: args.status ?? null,
          source: args.source ?? null,
          limit: args.limit,
          offset: args.offset,
          includeDeleted: args.include_deleted ?? false,
          baseUrl: resolveAppBaseUrl(),
        });

        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
          },
          ...payload,
        });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  server.registerTool(
    "get_document_status",
    {
      description: "Read processing status and metadata for one document in a resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
        document_id: z.string().min(1),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "documents.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }

        const document = await getDocumentStatusForCompany({
          companyId: membership.companyId,
          documentId: args.document_id,
          baseUrl: resolveAppBaseUrl(),
        });

        if (!document) {
          return toolError({ error: "Document not found", status: 404 });
        }

        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
          },
          document,
        });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  server.registerTool(
    "get_document_download",
    {
      description: "Resolve a download descriptor for one document in a resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
        document_id: z.string().min(1),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "documents.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }

        const descriptor = await getDocumentDownloadDescriptor({
          companyId: membership.companyId,
          documentId: args.document_id,
          baseUrl: resolveAppBaseUrl(),
        });

        if (!descriptor) {
          return toolError({ error: "Document not found", status: 404 });
        }

        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
          },
          ...descriptor,
        });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  if (isToolAvailableForSurface("delete_document", surface)) {
    server.registerTool(
      "delete_document",
    {
      description: "Delete one document and its linked Company-DB artifacts for a resolved company.",
      inputSchema: {
        company_id: z.string().optional(),
        document_id: z.string().min(1),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "documents.write");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }

        const result = await deleteDocumentForCompany({
          companyId: membership.companyId,
          userId: apiKey.userId,
          role: membership.role,
          documentId: args.document_id,
        });

        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
          },
          ...result,
        });
      } catch (err) {
        if (err instanceof Error && err.message === "Document not found") {
          return toolError({ error: "Document not found", status: 404 });
        }
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
    );
  }

  if (isToolAvailableForSurface("create_report_job", surface)) {
    server.registerTool(
      "create_report_job",
      {
        description:
          "Create an async report job for a resolved company. Use this for complex monthly or multi-step finance questions instead of making many raw Odoo connector calls inline. The worker will produce an artifact and evidence trail. On the ChatGPT employee surface this tool will wait briefly for completion by default before returning.",
        annotations: NON_DESTRUCTIVE_MUTATION_TOOL_ANNOTATIONS,
        inputSchema: {
          company_id: z.string().optional(),
          request: z.string().min(1),
          output_format: z.enum(["markdown", "docx", "xlsx"]).optional(),
          strictness: z.enum(["standard", "strict"]).optional(),
          wait_for_completion_seconds: z.number().int().min(0).max(REPORT_JOB_MAX_WAIT_SECONDS).optional(),
          poll_interval_seconds: z.number().int().min(REPORT_JOB_MIN_POLL_INTERVAL_SECONDS).max(REPORT_JOB_MAX_POLL_INTERVAL_SECONDS).optional(),
        },
      },
      async (args) => {
        try {
          requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
          requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");
          const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
          if (!membership) {
            return toolError({ error: "company_id is required or not accessible", status: 400 });
          }
          requireReportJobInheritedAccess(membership);

          const created = await createPlannedReportJob({
            companyId: membership.companyId,
            requestedByUserId: apiKey.userId,
            request: args.request,
            outputFormat: args.output_format,
            strictness: args.strictness,
            executionContext: {
              surface,
              requestedTool: "create_report_job",
              companyScopeMode: apiKey.companyScopeMode,
              allowedCompanyIds: apiKey.allowedCompanyIds,
              companySlug: membership.companySlug,
              companyAccessSource: membership.accessSource ?? "direct",
              viaCompanyId: membership.viaCompanyId ?? null,
              allowedDomains: membership.allowedDomains ?? null,
              domainAccessLevels: membership.domainAccessLevels ?? null,
              domainAccessSource: membership.domainAccessSource ?? null,
              allowedConnectorScopes: membership.allowedConnectorScopes ?? null,
            },
          });

          let job = created.job;
          if (job.status === "planned") {
            const queued = await queueReportJob(job.id);
            if (queued) {
              job = queued;
            }
          }
          const waitSeconds = resolveReportJobWaitSeconds(
            surface,
            args.wait_for_completion_seconds,
          );
          const pollIntervalSeconds = resolveReportJobPollIntervalSeconds(
            args.poll_interval_seconds,
          );
          const payload = await buildReportJobToolPayload({
            jobId: job.id,
            userId: apiKey.userId,
            accessibleCompanies: reportJobCompanies(accessibleCompanies),
            surface,
            waitSeconds,
            pollIntervalSeconds,
            includePreview: false,
          });

          return toolResult({
            ...payload,
            reusedExistingJob: created.reusedExistingJob,
          });
        } catch (err) {
          return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
        }
      },
    );
  }

  if (isToolAvailableForSurface("wait_for_report_job", surface)) {
    server.registerTool(
      "wait_for_report_job",
      {
        description:
          "Poll one report job for a bounded amount of time and return as soon as it reaches a terminal state or produces artifacts. Use this after create_report_job when the first wait window timed out.",
        annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
        inputSchema: {
          job_id: z.string().min(1),
          wait_for_completion_seconds: z.number().int().min(0).max(REPORT_JOB_MAX_WAIT_SECONDS).optional(),
          poll_interval_seconds: z.number().int().min(REPORT_JOB_MIN_POLL_INTERVAL_SECONDS).max(REPORT_JOB_MAX_POLL_INTERVAL_SECONDS).optional(),
          include_preview: z.boolean().optional(),
        },
      },
      async (args) => {
        try {
          requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
          requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");
          const waitSeconds = resolveReportJobWaitSeconds(
            surface,
            args.wait_for_completion_seconds,
          );
          const pollIntervalSeconds = resolveReportJobPollIntervalSeconds(
            args.poll_interval_seconds,
          );
          const payload = await buildReportJobToolPayload({
            jobId: args.job_id,
            userId: apiKey.userId,
            accessibleCompanies: reportJobCompanies(accessibleCompanies),
            surface,
            waitSeconds,
            pollIntervalSeconds,
            includePreview: args.include_preview ?? false,
          });

          if (!payload.job) {
            return toolError({ error: "Report job not found", status: 404 });
          }

          return toolResult(payload);
        } catch (err) {
          return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
        }
      },
    );
  }

  if (isToolAvailableForSurface("list_report_jobs", surface)) {
    server.registerTool(
      "list_report_jobs",
      {
        description:
          "List async report jobs created by the current user across accessible companies or for one resolved company.",
        annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
        inputSchema: {
          company_id: z.string().optional(),
          limit: z.number().optional(),
        },
      },
      async (args) => {
        try {
          requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
          requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");
          let companyId: string | null = null;
          if (typeof args.company_id === "string" && args.company_id.length > 0) {
            const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id);
            if (!membership) {
              return toolError({ error: "company_id is required or not accessible", status: 400 });
            }
            requireReportJobInheritedAccess(membership);
            companyId = membership.companyId;
          }

          const jobs = await listReportJobsForUser({
            userId: apiKey.userId,
            accessibleCompanyIds: reportJobCompanies(accessibleCompanies).map(
              (membership) => membership.companyId,
            ),
            companyId,
            limit: args.limit,
          });

          return toolResult({
            jobs: jobs.map((job) => serializeReportJobForSurface(job, accessibleCompanies)),
          });
        } catch (err) {
          return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
        }
      },
    );
  }

  if (isToolAvailableForSurface("get_report_job", surface)) {
    server.registerTool(
      "get_report_job",
      {
        description:
          "Fetch one async report job by id, including artifact descriptors and current execution summary. Optionally wait for completion for a bounded window before returning.",
        annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
        inputSchema: {
          job_id: z.string().min(1),
          wait_for_completion_seconds: z.number().int().min(0).max(REPORT_JOB_MAX_WAIT_SECONDS).optional(),
          poll_interval_seconds: z.number().int().min(REPORT_JOB_MIN_POLL_INTERVAL_SECONDS).max(REPORT_JOB_MAX_POLL_INTERVAL_SECONDS).optional(),
        },
      },
      async (args) => {
        try {
          requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
          requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");
          const waitSeconds = resolveReportJobWaitSeconds(
            surface,
            args.wait_for_completion_seconds,
          );
          const pollIntervalSeconds = resolveReportJobPollIntervalSeconds(
            args.poll_interval_seconds,
          );
          const payload = await buildReportJobToolPayload({
            jobId: args.job_id,
            userId: apiKey.userId,
            accessibleCompanies: reportJobCompanies(accessibleCompanies),
            surface,
            waitSeconds,
            pollIntervalSeconds,
            includePreview: false,
          });

          if (!payload.job) {
            return toolError({ error: "Report job not found", status: 404 });
          }

          return toolResult(payload);
        } catch (err) {
          return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
        }
      },
    );
  }

  if (isToolAvailableForSurface("get_report_job_artifact", surface)) {
    server.registerTool(
      "get_report_job_artifact",
      {
        description:
          "Fetch one async report-job artifact by id. Returns stable view/download links and an optional compact text preview for markdown artifacts.",
        annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
        inputSchema: {
          job_id: z.string().min(1),
          artifact_id: z.string().min(1),
          include_preview: z.boolean().optional(),
        },
      },
      async (args) => {
        try {
          requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
          requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");
          const artifact = await getReportJobArtifactByIdForUser({
            artifactId: args.artifact_id,
            jobId: args.job_id,
            userId: apiKey.userId,
            accessibleCompanyIds: reportJobCompanies(accessibleCompanies).map(
              (membership) => membership.companyId,
            ),
          });

          if (!artifact) {
            return toolError({ error: "Report job artifact not found", status: 404 });
          }

          return toolResult({
            artifact: serializeReportJobArtifactForSurface(artifact, surface, {
              includePreview: args.include_preview ?? true,
            }),
          });
        } catch (err) {
          return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
        }
      },
    );
  }

  server.registerTool(
    "list_connectors",
    {
      description:
        "List live connector status, capabilities, and action catalogs for a resolved company. Use this for explicit live or source-system requests before claiming Slack, Jira, Odoo, BambooHR, Confluence, Microsoft, Dynamics, Payhawk, Zendesk, Telegram, Google Drive, LinkedIn MCP, Custom MCP, or Metabase are unavailable. Do not use this to decide whether historical company knowledge exists; Company-DB is the primary indexed source for historical and document-backed answers.",
      annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
      inputSchema: {
        company_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "connectors.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        requireInheritedConnectorAccess(membership);
        const result = await listAgentConnectors({
          companyId: membership.companyId,
          companySlug: membership.companySlug,
          companyDbPort: membership.companyDbPort,
          allowedConnectorScopes:
            membership.accessSource === "inherited"
              ? membership.allowedConnectorScopes ?? []
              : null,
        });
        const filteredCatalog =
          surface === CHATGPT_EMPLOYEE_TOOL_MODE
            ? result.catalog.flatMap((entry) => {
                const filtered = filterChatgptEmployeeConnectorCatalogEntry(entry);
                return filtered ? [filtered] : [];
              })
            : result.catalog;
        const filteredHubCatalog =
          surface === CHATGPT_EMPLOYEE_TOOL_MODE
            ? result.hubCatalog.flatMap((entry) => {
                const filtered = filterChatgptEmployeeConnectorCatalogEntry(entry);
                return filtered ? [filtered] : [];
              })
            : result.hubCatalog;
        const allowedProviders =
          surface === CHATGPT_EMPLOYEE_TOOL_MODE
            ? new Set(filteredCatalog.map((entry) => entry.provider))
            : null;
        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
          },
          connectors:
            allowedProviders === null
              ? result.connectors
              : result.connectors.filter((connection) => allowedProviders.has(connection.provider)),
          catalog: filteredCatalog,
          hubCatalog: filteredHubCatalog,
        });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  server.registerTool(
    "call_connector_action",
    {
      description: getCallConnectorActionDescription(surface),
      annotations: getCallConnectorActionAnnotations(surface),
      inputSchema: {
        company_id: z.string().optional(),
        provider: z.string().min(1),
        action: z.string().min(1),
        input: z.unknown().optional(),
      },
    },
    async (args) => {
      try {
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }

        const normalizedProvider = args.provider.trim();

        if (
          surface === CHATGPT_EMPLOYEE_TOOL_MODE &&
          !isChatgptEmployeeConnectorActionAllowed(args.provider, args.action)
        ) {
          return toolError({
            status: 403,
            error: `Connector action ${args.provider}.${args.action} is not available in the ChatGPT employee surface`,
          });
        }

        if (surface === CHATGPT_EMPLOYEE_TOOL_MODE) {
          if (normalizedProvider === "odoo") {
            return toolError(
              buildChatgptEmployeeGenericOdooRedirect({
                id: membership.companyId,
                name: membership.companyName,
                slug: membership.companySlug,
              }),
            );
          }

          const guardrail = getChatgptEmployeeConnectorActionGuardrail(
            args.provider,
            args.action,
            args.input,
          );
          if (guardrail) {
            return toolError({
              company: {
                id: membership.companyId,
                name: membership.companyName,
                slug: membership.companySlug,
              },
              ...guardrail,
            });
          }
        }

        const providerDefinition = requireConnectorActionApiKeyScopes(
          apiKey.scopes,
          args.provider,
          args.action,
        );
        requireAgentMcpConnectorInheritedAccess({
          membership,
          provider: args.provider,
          action: args.action,
        });

        if (providerDefinition.surface === "hub_legacy") {
          const result = await runHubConnectorAction(
            membership.companyId,
            {
              provider: args.provider,
              action: args.action,
              input: args.input,
            },
            {
              companySlug: membership.companySlug,
              companyDbPort: membership.companyDbPort,
            },
          );
          return toolResult(result);
        }

        if (providerDefinition.surface !== "agent_connectors") {
          return toolError({
            error: `Connector provider ${args.provider} is not available through call_connector_action`,
            status: 400,
          });
        }

        const result = await runAgentConnectorAction({
          companyId: membership.companyId,
          companySlug: membership.companySlug,
          companyDbPort: membership.companyDbPort,
          provider: args.provider,
          action: args.action,
          payload: args.input,
        });

        if (result.status >= 400) {
          return toolError({ status: result.status, ...result.body });
        }

        return toolResult(
          surface === CHATGPT_EMPLOYEE_TOOL_MODE
            ? compactChatgptConnectorPayload(result.body)
            : result.body,
        );
      } catch (err) {
        if (isConnectorHubError(err)) {
          return toolError({
            status: err.status,
            error: err.message,
            code: err.code,
            details: err.details,
          });
        }
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  if (isToolAvailableForSurface("direct_odoo_lookup", surface)) {
    server.registerTool(
      "direct_odoo_lookup",
      {
        description:
          "Run one explicit narrow live Odoo lookup for a resolved company. Use this only when the user explicitly asks for a direct Odoo lookup or an exact current number directly from Odoo. Do not use it for monthly reports, segmented finance analysis, or document drafting; those must go through resolve_workflow and create_report_job.",
        annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
        inputSchema: {
          company_id: z.string().optional(),
          confirmation: z.literal("direct_odoo_lookup"),
          lookup_kind: z.enum(["search_records", "get_record"]),
          model: z.enum(CHATGPT_DIRECT_ODOO_LOOKUP_MODELS),
          id: z.union([z.string(), z.number()]).optional(),
          domain: z.unknown().optional(),
          fields: z.array(z.string()).optional(),
          limit: z.number().int().positive().max(50).optional(),
        },
      },
      async (args) => {
        try {
          const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
          if (!membership) {
            return toolError({ error: "company_id is required or not accessible", status: 400 });
          }

          const action = args.lookup_kind;
          requireConnectorActionApiKeyScopes(apiKey.scopes, "odoo", action);
          requireAgentMcpConnectorInheritedAccess({
            membership,
            provider: "odoo",
            action,
          });

          if (action === "get_record" && args.id === undefined) {
            return toolError({ error: "id is required for get_record", status: 400 });
          }

          if (action === "search_records") {
            const guardrail = getChatgptEmployeeConnectorActionGuardrail("odoo", action, {
              model: args.model,
              domain: args.domain,
              fields: args.fields,
              limit: args.limit,
            });
            if (guardrail) {
              return toolError({
                company: {
                  id: membership.companyId,
                  name: membership.companyName,
                  slug: membership.companySlug,
                },
                ...guardrail,
              });
            }
          }

          const payload =
            action === "get_record"
              ? {
                  model: args.model,
                  id: args.id,
                }
              : {
                  model: args.model,
                  domain: args.domain,
                  fields: args.fields,
                  limit: args.limit,
                };

          const result = await runAgentConnectorAction({
            companyId: membership.companyId,
            companySlug: membership.companySlug,
            companyDbPort: membership.companyDbPort,
            provider: "odoo",
            action,
            payload,
          });

          if (result.status >= 400) {
            return toolError({ status: result.status, ...result.body });
          }

          return toolResult(compactChatgptConnectorPayload(result.body));
        } catch (err) {
          if (isConnectorHubError(err)) {
            return toolError({
              status: err.status,
              error: err.message,
              code: err.code,
              details: err.details,
            });
          }
          return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
        }
      },
    );
  }

  server.registerTool(
    "get_company_file",
    {
      description: "Read a raw Company-DB file by repo-relative path for a resolved company.",
      annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
      inputSchema: {
        company_id: z.string().optional(),
        path: z.string().min(1),
        full: z.boolean().optional(),
        max_chars: z.number().optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "company_db.file");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        requireAgentMcpCompanyDbInheritedAccess({
          membership,
          toolName: "get_company_file",
          args: { path: args.path },
        });

        const companySlug =
          membership.companySlug ?? (await getCompanySlug(membership.companyId));
        const content = await readQmdFile(args.path, {
          companySlug,
          port: membership.companyDbPort,
          callerId: apiKey.userId,
          callerRole: membership.role,
        });

        if (content === null) {
          return toolError({ error: "Company-DB file not found", status: 404, path: args.path });
        }

        const preview = truncateAgentFilePreview(content, "api_key", {
          full: args.full,
          maxChars: args.max_chars,
        });

        return toolResult({
          company: {
            id: membership.companyId,
            name: membership.companyName,
            slug: membership.companySlug,
          },
          path: args.path,
          content: preview.content,
          truncated: preview.truncated,
          original_length: preview.originalLength,
          returned_length: preview.returnedLength,
        });
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  server.registerTool(
    "query_company_entities",
    {
      description:
        "Query Company-DB entities for a resolved company. This is the primary tool for historical, document-backed, and imported company knowledge, including finance evidence when live connectors are absent or not explicitly required.",
      annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
      inputSchema: {
        company_id: z.string().optional(),
        domain: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().optional(),
        view: z.enum(["full", "summary"]).optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        const payload = await withCompanyDbTool({
          membership,
          apiKey,
          toolName: "query_entities",
          args: {
            domain: args.domain,
            type: args.type,
            status: args.status,
            limit: resolveAgentSafeQueryLimit("api_key", args.limit),
            view: resolveAgentSafeEntityView("api_key", args.view),
          },
        });
        return toolResult(payload);
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  server.registerTool(
    "query_entities",
    {
      description:
        "Backward-compatible alias for query_company_entities on the Corpus ChatGPT/agent MCP surface.",
      annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
      inputSchema: {
        company_id: z.string().optional(),
        domain: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().optional(),
        view: z.enum(["full", "summary"]).optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        const payload = await withCompanyDbTool({
          membership,
          apiKey,
          toolName: "query_entities",
          args: {
            domain: args.domain,
            type: args.type,
            status: args.status,
            limit: resolveAgentSafeQueryLimit("api_key", args.limit),
            view: resolveAgentSafeEntityView("api_key", args.view),
          },
        });
        return toolResult(payload);
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  server.registerTool(
    "search_company_entities",
    {
      description:
        "Search Company-DB entities for a resolved company. Use this first for historical revenue, finance evidence, imported documents, summaries, and other indexed company knowledge unless the user explicitly requests live source-system data.",
      annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
      inputSchema: {
        company_id: COMPANY_REF_INPUT_SCHEMA,
        query: z.string().min(1),
        domain: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().optional(),
        view: z.enum(["full", "summary"]).optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        const payload = await withCompanyDbTool({
          membership,
          apiKey,
          toolName: "search_entities",
          args: {
            query: args.query,
            domain: args.domain,
            type: args.type,
            status: args.status,
            limit: resolveAgentSafeSearchLimit("api_key", args.limit),
            view: resolveAgentSafeEntityView("api_key", args.view),
          },
        });
        return toolResult(payload);
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  server.registerTool(
    "search_entities",
    {
      description:
        "Backward-compatible alias for search_company_entities on the Corpus ChatGPT/agent MCP surface.",
      annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
      inputSchema: {
        company_id: z.string().optional(),
        query: z.string().min(1),
        domain: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().optional(),
        view: z.enum(["full", "summary"]).optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        const payload = await withCompanyDbTool({
          membership,
          apiKey,
          toolName: "search_entities",
          args: {
            query: args.query,
            domain: args.domain,
            type: args.type,
            status: args.status,
            limit: resolveAgentSafeSearchLimit("api_key", args.limit),
            view: resolveAgentSafeEntityView("api_key", args.view),
          },
        });
        return toolResult(payload);
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  server.registerTool(
    "get_company_entity",
    {
      description:
        "Fetch one Company-DB entity by qualified ID for a resolved company. Use this to drill into a specific historical or document-backed entity after search/query returns a candidate.",
      annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
      inputSchema: {
        company_id: z.string().optional(),
        qualified_id: z.string().min(1).optional(),
        domain: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
        view: z.enum(["full", "summary"]).optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        const entityId =
          typeof args.qualified_id === "string" && args.qualified_id.trim().length > 0
            ? args.qualified_id.trim()
            : typeof args.id === "string"
              ? args.id.trim()
              : "";
        if (!entityId) {
          return toolError({ error: "qualified_id or id is required", status: 400 });
        }
        const payload = await withCompanyDbTool({
          membership,
          apiKey,
          toolName: "get_entity",
          args: {
            qualified_id: entityId,
            domain: args.domain,
            view: resolveAgentSafeEntityView("api_key", args.view),
          },
        });
        return toolResult(payload);
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  server.registerTool(
    "get_entity",
    {
      description:
        "Backward-compatible alias for get_company_entity on the Corpus ChatGPT/agent MCP surface.",
      annotations: READ_ONLY_CLOSED_WORLD_TOOL_ANNOTATIONS,
      inputSchema: {
        company_id: z.string().optional(),
        qualified_id: z.string().min(1).optional(),
        domain: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
        view: z.enum(["full", "summary"]).optional(),
      },
    },
    async (args) => {
      try {
        requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");
        const membership = resolveMembership(apiKey, accessibleCompanies, args.company_id ?? null);
        if (!membership) {
          return toolError({ error: "company_id is required or not accessible", status: 400 });
        }
        const entityId =
          typeof args.qualified_id === "string" && args.qualified_id.trim().length > 0
            ? args.qualified_id.trim()
            : typeof args.id === "string"
              ? args.id.trim()
              : "";
        if (!entityId) {
          return toolError({ error: "qualified_id or id is required", status: 400 });
        }
        const payload = await withCompanyDbTool({
          membership,
          apiKey,
          toolName: "get_entity",
          args: {
            qualified_id: entityId,
            domain: args.domain,
            view: resolveAgentSafeEntityView("api_key", args.view),
          },
        });
        return toolResult(payload);
      } catch (err) {
        return toolError({ error: err instanceof Error ? err.message : "Forbidden" });
      }
    },
  );

  return server;
}

export async function handleAgentMcpRequest(request: Request): Promise<Response> {
  const { apiKey, companies } = await getApiKeyAgentContext();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createAgentMcpServer({ apiKey, companies });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function handleSessionScopedAgentMcpRequest(
  request: Request,
  context: {
    userId: string;
    membership: CompanyMembership;
  },
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createAgentMcpServer(
    {
      ...buildSessionScopedAgentContext(context.userId, context.membership),
      surface: CHATGPT_EMPLOYEE_TOOL_MODE,
    },
  );
  await server.connect(transport);
  return transport.handleRequest(request);
}

export async function handleMultiCompanySessionScopedAgentMcpRequest(
  request: Request,
  context: {
    userId: string;
    memberships: CompanyMembership[];
  },
): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createAgentMcpServer({
    ...buildMultiCompanySessionScopedAgentContext(context.userId, context.memberships),
    surface: CHATGPT_EMPLOYEE_TOOL_MODE,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
