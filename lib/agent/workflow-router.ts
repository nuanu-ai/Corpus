import type { ApiKeyCompanyScopeMode } from "@/lib/api-key-company-scope";
import { resolveApiKeyCompanyId } from "@/lib/api-key-access-runtime";
import type { AgentContextIntent } from "@/lib/agent-context";
import type { ApiKeyScope } from "@/lib/api-key-scopes";
import type { CompanyMembership } from "@/lib/db/tenant";
import { getConnectorProviderDefinition } from "@/lib/connectors/provider-registry";
import { planReportJob } from "@/lib/report-jobs/planner";

type AgentWorkflowKind =
  | "needs_company_selection"
  | "connectors"
  | "report_job"
  | "company_db"
  | "open_company_app";

type AgentWorkflowStatus = "runnable" | "needs_input" | "blocked";
type AgentWorkflowConfidence = "high" | "medium" | "low";

type WorkflowCompanyResolution =
  | {
      status: "resolved";
      company: {
        id: string;
        name: string;
        slug: string;
        role: string;
        accessSource?: string;
        viaCompanyId?: string | null;
        viaCompanyName?: string | null;
      };
    }
  | {
      status: "needs_selection";
      companies: Array<{
        id: string;
        name: string;
        slug: string;
        role: string;
        accessSource?: string;
        viaCompanyId?: string | null;
        viaCompanyName?: string | null;
      }>;
    }
  | {
      status: "none_available";
      companies: [];
    };

type WorkflowCallHint = {
  method?: "GET" | "POST";
  endpoint?: string;
  tool: string;
  args: Record<string, unknown>;
};

type WorkflowContextPackHint = {
  policy: "required" | "recommended" | "optional" | "not_needed";
  intent: AgentContextIntent;
  reason: string;
  requiredBefore: "answer" | "primary_call" | null;
  call: WorkflowCallHint | null;
};

type WorkflowAccessGuard = {
  status: "allowed" | "blocked";
  reasons: string[];
  requiredDomains: string[];
  requiredConnectorScopes: string[];
  allowedDomains: string[] | null;
  allowedConnectorScopes: string[] | null;
};

export type WorkflowResolution = {
  version: 1;
  status: AgentWorkflowStatus;
  workflow: AgentWorkflowKind;
  reason: string;
  confidence: AgentWorkflowConfidence;
  companyScopeMode: ApiKeyCompanyScopeMode;
  companyResolution: WorkflowCompanyResolution;
  targetProvider: string | null;
  requiredInputs: string[];
  requiredScopes: string[];
  requestProfile: {
    category: "finance_report" | "connector_lookup" | "knowledge_lookup" | "human_handoff";
    reportFamily: string | null;
    periodLabel: string | null;
    dimensions: string[];
    needsClarification: boolean;
  };
  recommendedCall: WorkflowCallHint;
  contextPack: WorkflowContextPackHint;
  accessGuard?: WorkflowAccessGuard | null;
  fallback: {
    workflow: Exclude<AgentWorkflowKind, "needs_company_selection">;
    reason: string;
    call: WorkflowCallHint;
  } | null;
};

type ResolveWorkflowInput = {
  request: string;
  requestedCompanyId?: string | null;
  companyScopeMode: ApiKeyCompanyScopeMode;
  defaultCompanyId: string | null;
  allowedCompanyIds: string[];
  scopes: readonly string[];
  accessibleCompanies: CompanyMembership[];
  baseUrl?: string | null;
};

const CONNECTOR_PROVIDER_KEYWORDS = [
  { provider: "odoo", tokens: ["odoo", "erp"] },
  { provider: "slack", tokens: ["slack", "channel", "thread", "workspace"] },
  { provider: "jira", tokens: ["jira", "issue", "ticket", "atlassian"] },
  { provider: "bamboohr", tokens: ["bamboohr", "employee", "directory", "time off"] },
  { provider: "confluence", tokens: ["confluence", "space", "wiki"] },
  { provider: "ms_graph", tokens: ["microsoft", "graph", "calendar", "meeting", "outlook"] },
  { provider: "dynamics_bc", tokens: ["dynamics", "business central"] },
  { provider: "payhawk", tokens: ["payhawk", "card expense", "fund account"] },
  { provider: "zendesk", tokens: ["zendesk", "support ticket", "help center"] },
  { provider: "google_drive", tokens: ["drive", "google drive", "folder", "file"] },
  { provider: "metabase", tokens: ["metabase", "collection"] },
  { provider: "telegram", tokens: ["telegram", "chat", "bot"] },
  { provider: "ga4", tokens: ["ga4", "google analytics"] },
  { provider: "google_ads", tokens: ["google ads", "campaign", "ad spend"] },
  { provider: "google_search_console", tokens: ["search console", "seo", "search analytics"] },
  { provider: "github", tokens: ["github", "pull request", "repo", "commit"] },
  { provider: "hubspot", tokens: ["hubspot", "deal", "contact", "crm"] },
  { provider: "meta_ads", tokens: ["meta ads", "facebook ads", "instagram ads"] },
  { provider: "tiktok_ads", tokens: ["tiktok ads", "tiktok campaign"] },
  { provider: "vercel", tokens: ["vercel", "deployment", "build logs", "runtime logs"] },
  { provider: "linkedin_mcp", tokens: ["linkedin"] },
];

const HUMAN_HANDOFF_PATTERNS = [
  /\bopen\b.*\b(ai ceo|dashboard|settings|app|browser|ui|page)\b/i,
  /\b(return|navigate|go)\b.*\b(ai ceo|dashboard|settings|app|page)\b/i,
  /\bneed\b.*\b(url|login path|browser path|app link)\b/i,
  /\blog ?in\b/i,
];

const FINANCE_HINT_PATTERN =
  /\b(revenue|sales|income|expense|expenses|cost|p&l|pnl|profit|cash|ledger|invoice|balance|f&b|fnb|multimedia|department|venue)\b/i;

const COMPLEX_REPORT_PATTERN =
  /\b(report|summary|analy[sz]e|analysis|breakdown|compare|variance|month|quarter|weekly|last week|last month|this month|q[1-4]\s+20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december|docx|xlsx|pdf|board pack|prepare|compile)\b/i;
const REPORT_EXECUTION_PATTERN =
  /\b(report|prepare|breakdown|analy[sz]e|analysis|compare|variance|docx|xlsx|pdf|board pack|compile)\b/i;

const KNOWLEDGE_LOOKUP_PATTERN =
  /\b(document|contract|agreement|legal|tax|compliance|owner|director|contact|summary|evidence|who is|what do we know|history|entity)\b/i;

const LIVE_SOURCE_PATTERN =
  /\b(live|current|right now|real[- ]time|direct|directly|source system|system of record|exact current)\b/i;

const EXPLICIT_SOURCE_SYSTEM_PATTERN =
  /\b(from|in|via)\s+(odoo|erp|business central|dynamics|metabase|payhawk|google drive|slack|jira|zendesk|confluence|bamboohr|telegram)\b/i;

function trimBaseUrl(baseUrl?: string | null): string | null {
  if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) return null;
  return baseUrl.replace(/\/$/, "");
}

function buildEndpoint(baseUrl: string | null, path: string): string {
  return baseUrl ? `${baseUrl}${path}` : path;
}

function resolveCompanyResolution(input: ResolveWorkflowInput): WorkflowCompanyResolution {
  if (input.accessibleCompanies.length === 0) {
    return { status: "none_available", companies: [] };
  }

  const resolvedCompanyId = resolveApiKeyCompanyId(
    input.requestedCompanyId ?? null,
    input.accessibleCompanies,
    {
      companyScopeMode: input.companyScopeMode,
      defaultCompanyId: input.defaultCompanyId,
      allowedCompanyIds: input.allowedCompanyIds,
    },
  );

  if (resolvedCompanyId) {
    const membership = input.accessibleCompanies.find(
      (company) => company.companyId === resolvedCompanyId,
    );
    if (membership) {
      return {
        status: "resolved",
        company: {
          id: membership.companyId,
          name: membership.companyName,
          slug: membership.companySlug ?? membership.companyId,
          role: membership.role,
          accessSource: membership.accessSource ?? "direct",
          viaCompanyId: membership.viaCompanyId ?? null,
          viaCompanyName: membership.viaCompanyName ?? null,
        },
      };
    }
  }

  return {
    status: "needs_selection",
      companies: input.accessibleCompanies.map((company) => ({
        id: company.companyId,
        name: company.companyName,
        slug: company.companySlug ?? company.companyId,
        role: company.role,
        accessSource: company.accessSource ?? "direct",
        viaCompanyId: company.viaCompanyId ?? null,
        viaCompanyName: company.viaCompanyName ?? null,
      })),
  };
}

function detectTargetProvider(request: string): string | null {
  const lower = request.toLowerCase();
  for (const candidate of CONNECTOR_PROVIDER_KEYWORDS) {
    if (candidate.tokens.some((token) => matchesKeyword(lower, token))) {
      return candidate.provider;
    }
  }
  return null;
}

function matchesKeyword(input: string, keyword: string): boolean {
  const normalizedKeyword = keyword
    .trim()
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  const pattern = new RegExp(`(^|[^a-z0-9])${normalizedKeyword}([^a-z0-9]|$)`, "i");
  return pattern.test(input);
}

function deriveRequiredConnectorScopes(
  scopes: readonly string[],
  provider: string | null,
): { missingScopes: string[]; requiredScopes: string[] } {
  const requiredScopes = ["connectors.read"];
  if (provider) {
    const definition = getConnectorProviderDefinition(provider);
    for (const scope of definition?.useScopesAnyOf ?? []) {
      if (!requiredScopes.includes(scope)) requiredScopes.push(scope);
    }
  }
  return {
    requiredScopes,
    missingScopes: requiredScopes.filter((scope) => !scopes.includes(scope as ApiKeyScope)),
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function normalizeMask(values: readonly string[] | null | undefined): string[] {
  return unique((values ?? []).map((value) => value.trim().toLowerCase())).sort();
}

function resolveResolvedMembership(
  companyResolution: WorkflowCompanyResolution,
  companies: CompanyMembership[],
): CompanyMembership | null {
  if (companyResolution.status !== "resolved") return null;
  return (
    companies.find((company) => company.companyId === companyResolution.company.id) ??
    null
  );
}

function resolvedCompanyIdFromResolution(
  companyResolution: WorkflowCompanyResolution,
): string | null {
  return companyResolution.status === "resolved" ? companyResolution.company.id : null;
}

function buildContextPackHint(input: {
  policy: WorkflowContextPackHint["policy"];
  intent: AgentContextIntent;
  reason: string;
  requiredBefore: WorkflowContextPackHint["requiredBefore"];
  companyResolution: WorkflowCompanyResolution;
  request: string;
  baseUrl: string | null;
}): WorkflowContextPackHint {
  const companyId = resolvedCompanyIdFromResolution(input.companyResolution);
  return {
    policy: input.policy,
    intent: input.intent,
    reason: input.reason,
    requiredBefore: input.requiredBefore,
    call:
      companyId && input.policy !== "not_needed"
        ? {
            method: "GET",
            endpoint: buildEndpoint(input.baseUrl, "/api/agent/context-pack"),
            tool: "get_context_pack",
            args: {
              company_id: companyId,
              intent: input.intent,
              query: input.request,
            },
          }
        : null,
  };
}

function contextPackNotNeeded(reason: string): WorkflowContextPackHint {
  return {
    policy: "not_needed",
    intent: "general",
    reason,
    requiredBefore: null,
    call: null,
  };
}

function contextPackIntentForCompanyDbDomain(input: {
  domain: string | null;
  isFinanceIntent: boolean;
}): AgentContextIntent {
  if (input.isFinanceIntent || input.domain === "finance") return "finance";
  if (input.domain === "legal" || input.domain === "tax" || input.domain === "governance") {
    return "legal";
  }
  if (input.domain === "documents") return "documents";
  return "general";
}

function inferCompanyDbDomain(input: {
  request: string;
  isFinanceIntent: boolean;
}): string | null {
  if (input.isFinanceIntent) return "finance";
  const lower = input.request.toLowerCase();
  if (/\b(tax|vat|withholding|filing|taxes)\b/.test(lower)) {
    return "tax";
  }
  if (
    /\b(governance|owner|owners|ownership|beneficial owner|beneficial owners|beneficial ownership|ubo|ultimate beneficial owner|ultimate beneficial owners|director|directors|shareholder|shareholders|shareholding|shareholdings|board|resolution|resolutions|cap table)\b/.test(
      lower,
    )
  ) {
    return "governance";
  }
  if (
    /\b(legal|law|lawyer|lawyers|compliance|contract|contracts|agreement|agreements|counsel|litigation|permit|permits|license|licenses)\b/.test(
      lower,
    )
  ) {
    return "legal";
  }
  if (/\b(document|file|evidence|attachment|pdf|invoice)\b/.test(lower)) {
    return "documents";
  }
  return null;
}

function resolveInheritedAccessGuard(input: {
  membership: CompanyMembership | null;
  requiredDomains?: readonly string[];
  requiredConnectorScopes?: readonly string[];
  requireAnyConnectorScope?: boolean;
}): WorkflowAccessGuard | null {
  const membership = input.membership;
  if (!membership || membership.accessSource !== "inherited") return null;

  const allowedDomains = normalizeMask(membership.allowedDomains);
  const allowedConnectorScopes = normalizeMask(membership.allowedConnectorScopes);
  const requiredDomains = normalizeMask(input.requiredDomains);
  const requiredConnectorScopes = normalizeMask(input.requiredConnectorScopes);
  const reasons: string[] = [];

  for (const domain of requiredDomains) {
    if (!allowedDomains.includes(domain)) {
      reasons.push(`missing inherited Company-DB domain: ${domain}`);
    }
  }

  if (input.requireAnyConnectorScope && allowedConnectorScopes.length === 0) {
    reasons.push("missing inherited connector access");
  }

  for (const scope of requiredConnectorScopes) {
    if (!allowedConnectorScopes.includes(scope)) {
      reasons.push(`missing inherited connector scope: ${scope}`);
    }
  }

  return {
    status: reasons.length > 0 ? "blocked" : "allowed",
    reasons,
    requiredDomains,
    requiredConnectorScopes,
    allowedDomains,
    allowedConnectorScopes,
  };
}

function buildBlockedByAccessGuard(input: {
  workflow: Exclude<AgentWorkflowKind, "needs_company_selection">;
  reason: string;
  confidence: AgentWorkflowConfidence;
  companyScopeMode: ApiKeyCompanyScopeMode;
  companyResolution: WorkflowCompanyResolution;
  targetProvider: string | null;
  requiredScopes: string[];
  requestProfile: WorkflowResolution["requestProfile"];
  accessGuard: WorkflowAccessGuard;
  baseUrl: string | null;
  contextPack?: WorkflowContextPackHint;
}): WorkflowResolution {
  return {
    version: 1,
    status: "blocked",
    workflow: input.workflow,
    reason: `${input.reason} ${input.accessGuard.reasons.join("; ")}.`,
    confidence: input.confidence,
    companyScopeMode: input.companyScopeMode,
    companyResolution: input.companyResolution,
    targetProvider: input.targetProvider,
    requiredInputs: [],
    requiredScopes: input.requiredScopes,
    requestProfile: input.requestProfile,
    recommendedCall: {
      method: "GET",
      endpoint: buildEndpoint(input.baseUrl, "/api/agent/session"),
      tool: "get_session",
      args: {},
    },
    contextPack:
      input.contextPack ??
      contextPackNotNeeded("The workflow is blocked before source-map context can be used."),
    accessGuard: input.accessGuard,
    fallback: null,
  };
}

export function resolveWorkflow(input: ResolveWorkflowInput): WorkflowResolution {
  const request = input.request.trim();
  const baseUrl = trimBaseUrl(input.baseUrl);
  const companyResolution = resolveCompanyResolution(input);
  const resolvedMembership = resolveResolvedMembership(
    companyResolution,
    input.accessibleCompanies,
  );
  const requestedCompanyId =
    companyResolution.status === "resolved" ? companyResolution.company.id : null;
  const requestedCompanySlug =
    companyResolution.status === "resolved" ? companyResolution.company.slug : null;

  if (companyResolution.status === "none_available") {
    return {
      version: 1,
      status: "blocked",
      workflow: "needs_company_selection",
      reason: "This session does not have access to any companies.",
      confidence: "high",
      companyScopeMode: input.companyScopeMode,
      companyResolution,
      targetProvider: null,
      requiredInputs: [],
      requiredScopes: ["companies.read"],
      requestProfile: {
        category: "knowledge_lookup",
        reportFamily: null,
        periodLabel: null,
        dimensions: [],
        needsClarification: false,
      },
      recommendedCall: {
        method: "GET",
        endpoint: buildEndpoint(baseUrl, "/api/agent/session"),
        tool: "get_session",
        args: {},
      },
      contextPack: contextPackNotNeeded(
        "No company is accessible for this session.",
      ),
      fallback: null,
    };
  }

  if (companyResolution.status === "needs_selection") {
    return {
      version: 1,
      status: "needs_input",
      workflow: "needs_company_selection",
      reason:
        "This session can access multiple companies, so the target company must be resolved before any connector, document, or Company-DB call.",
      confidence: "high",
      companyScopeMode: input.companyScopeMode,
      companyResolution,
      targetProvider: null,
      requiredInputs: ["company_id"],
      requiredScopes: [],
      requestProfile: {
        category: "knowledge_lookup",
        reportFamily: null,
        periodLabel: null,
        dimensions: [],
        needsClarification: false,
      },
      recommendedCall: {
        method: "GET",
        endpoint: buildEndpoint(baseUrl, "/api/agent/companies"),
        tool: "list_companies",
        args: {},
      },
      contextPack: contextPackNotNeeded(
        "The target company must be selected before a company-specific context pack can be compiled.",
      ),
      fallback: null,
    };
  }

  const lower = request.toLowerCase();
  const targetProvider = detectTargetProvider(request);
  const planner = planReportJob({
    companyId: requestedCompanyId ?? "__unresolved__",
    request,
  });
  const hasExplicitSourceSystemSignal =
    targetProvider !== null ||
    LIVE_SOURCE_PATTERN.test(request) ||
    EXPLICIT_SOURCE_SYSTEM_PATTERN.test(request);
  const isFinanceIntent =
    planner.intent.reportFamily !== "custom_operational_report" || FINANCE_HINT_PATTERN.test(request);
  const isComplexReport =
    isFinanceIntent &&
    (planner.intent.period.kind !== "unknown" ||
      planner.intent.dimensions.length > 0 ||
      COMPLEX_REPORT_PATTERN.test(request));
  const shouldUseReportJob =
    isFinanceIntent &&
    isComplexReport &&
    (hasExplicitSourceSystemSignal ||
      planner.intent.dimensions.length > 0 ||
      REPORT_EXECUTION_PATTERN.test(request));
  const isHumanHandoff =
    HUMAN_HANDOFF_PATTERNS.some((pattern) => pattern.test(request)) &&
    !isFinanceIntent &&
    !targetProvider;
  const isKnowledgeLookup =
    !isFinanceIntent && !targetProvider && KNOWLEDGE_LOOKUP_PATTERN.test(request);

  if (isHumanHandoff) {
    return {
      version: 1,
      status: "runnable",
      workflow: "open_company_app",
      reason:
        "The request is asking for the exact Corpus browser destination, so the safest path is to return the canonical app URLs instead of guessing navigation.",
      confidence: "high",
      companyScopeMode: input.companyScopeMode,
      companyResolution,
      targetProvider: null,
      requiredInputs: [],
      requiredScopes: [],
      requestProfile: {
        category: "human_handoff",
        reportFamily: null,
        periodLabel: null,
        dimensions: [],
        needsClarification: false,
      },
      recommendedCall: {
        method: "POST",
        endpoint: buildEndpoint(baseUrl, "/api/agent/mcp"),
        tool: "open_company_app",
        args: { company_id: requestedCompanyId },
      },
      contextPack: contextPackNotNeeded(
        "Browser handoff requests do not require source-map context before returning app URLs.",
      ),
      fallback: {
        workflow: "company_db",
        reason:
          "If a browser handoff is not actually needed, use Company-DB first for compact evidence and summaries.",
        call: {
          method: "POST",
          endpoint: buildEndpoint(baseUrl, "/api/agent/mcp"),
          tool: "search_company_entities",
          args: { company_id: requestedCompanyId, query: request },
        },
      },
    };
  }

  if (shouldUseReportJob) {
    const requiredScopes = ["companies.read", "company_db.read"];
    const missingScopes = requiredScopes.filter((scope) => !input.scopes.includes(scope as ApiKeyScope));
    const accessGuard = resolveInheritedAccessGuard({
      membership: resolvedMembership,
      requiredDomains: ["finance"],
      requiredConnectorScopes: ["connectors.use.odoo"],
    });
    const reportProfile = {
      category: "finance_report" as const,
      reportFamily: planner.intent.reportFamily,
      periodLabel: planner.intent.period.label,
      dimensions: planner.intent.dimensions,
      needsClarification: planner.intent.needsClarification,
    };
    if (accessGuard?.status === "blocked") {
      return buildBlockedByAccessGuard({
        workflow: "report_job",
        reason:
          "This finance report would require inherited live Odoo and finance Company-DB access, but the resolved company's access graph masks do not allow that path.",
        confidence:
          planner.intent.period.kind !== "unknown" || planner.intent.dimensions.length > 0
            ? "high"
            : "medium",
        companyScopeMode: input.companyScopeMode,
        companyResolution,
        targetProvider: targetProvider ?? "odoo",
        requiredScopes,
        requestProfile: reportProfile,
        accessGuard,
        baseUrl,
        contextPack: buildContextPackHint({
          policy: "recommended",
          intent: "reporting",
          reason:
            "Finance report jobs should read the context pack first for Odoo basis language and source-map rules.",
          requiredBefore: "primary_call",
          companyResolution,
          request,
          baseUrl,
        }),
      });
    }
    return {
      version: 1,
      status:
        missingScopes.length > 0
          ? "blocked"
          : planner.intent.needsClarification
            ? "needs_input"
            : "runnable",
      workflow: "report_job",
      reason:
        "This looks like a time-bounded or segmented finance request. Route it through the async report worker instead of long inline ERP loops so the result stays stable, auditable, and artifact-backed.",
      confidence:
        planner.intent.period.kind !== "unknown" || planner.intent.dimensions.length > 0
          ? "high"
          : "medium",
      companyScopeMode: input.companyScopeMode,
      companyResolution,
      targetProvider: targetProvider ?? "odoo",
      requiredInputs: unique([
        ...planner.intent.clarificationQuestions,
      ]),
      requiredScopes,
      requestProfile: {
        ...reportProfile,
      },
      recommendedCall: {
        method: "POST",
        endpoint: buildEndpoint(baseUrl, "/api/agent/report-jobs"),
        tool: "create_report_job",
        args: { company_id: requestedCompanyId, request },
      },
      contextPack: buildContextPackHint({
        policy: "recommended",
        intent: "reporting",
        reason:
          "Finance report jobs should read the context pack first for Odoo basis language and source-map rules.",
        requiredBefore: "primary_call",
        companyResolution,
        request,
        baseUrl,
      }),
      accessGuard,
      fallback: {
        workflow: "company_db",
        reason:
          "If the report worker is blocked, fall back to compact Company-DB evidence while asking for the missing clarification instead of starting a raw ERP loop.",
        call: {
          method: "POST",
          endpoint: buildEndpoint(baseUrl, "/api/company/search"),
          tool: "search_company_entities",
          args: { company_id: requestedCompanyId, query: request },
        },
      },
    };
  }

  if (isFinanceIntent && !hasExplicitSourceSystemSignal) {
    const requiredScopes = ["company_db.read"];
    const missingScopes = requiredScopes.filter((scope) => !input.scopes.includes(scope as ApiKeyScope));
    const companyDbDomain = inferCompanyDbDomain({ request, isFinanceIntent });
    const accessGuard = resolveInheritedAccessGuard({
      membership: resolvedMembership,
      requiredDomains: companyDbDomain ? [companyDbDomain] : [],
    });
    const companyDbProfile = {
      category: "knowledge_lookup" as const,
      reportFamily: planner.intent.reportFamily,
      periodLabel: planner.intent.period.kind === "unknown" ? null : planner.intent.period.label,
      dimensions: planner.intent.dimensions,
      needsClarification: planner.intent.needsClarification,
    };
    if (resolvedMembership?.accessSource === "inherited" && !companyDbDomain) {
      const guard = accessGuard ?? {
        status: "blocked" as const,
        reasons: ["inherited Company-DB search requires an explicit domain"],
        requiredDomains: [],
        requiredConnectorScopes: [],
        allowedDomains: normalizeMask(resolvedMembership.allowedDomains),
        allowedConnectorScopes: normalizeMask(resolvedMembership.allowedConnectorScopes),
      };
      guard.status = "blocked";
      guard.reasons = unique([
        ...guard.reasons,
        "inherited Company-DB search requires an explicit domain",
      ]);
      return buildBlockedByAccessGuard({
        workflow: "company_db",
        reason:
          "This Company-DB workflow cannot run against inherited access until the request resolves to an explicit allowed domain.",
        confidence: "medium",
        companyScopeMode: input.companyScopeMode,
        companyResolution,
        targetProvider: null,
        requiredScopes,
        requestProfile: companyDbProfile,
        accessGuard: guard,
        baseUrl,
        contextPack: buildContextPackHint({
          policy: "required",
          intent: "finance",
          reason:
            "Historical finance answers need the context pack before Company-DB retrieval so source-map, Odoo cash/accrual language, and partial-coverage caveats are applied.",
          requiredBefore: "primary_call",
          companyResolution,
          request,
          baseUrl,
        }),
      });
    }
    if (accessGuard?.status === "blocked") {
      return buildBlockedByAccessGuard({
        workflow: "company_db",
        reason:
          "This Company-DB workflow is blocked by the resolved company's inherited domain mask.",
        confidence:
          planner.intent.period.kind !== "unknown" || planner.intent.reportFamily !== "custom_operational_report"
            ? "high"
            : "medium",
        companyScopeMode: input.companyScopeMode,
        companyResolution,
        targetProvider: null,
        requiredScopes,
        requestProfile: companyDbProfile,
        accessGuard,
        baseUrl,
        contextPack: buildContextPackHint({
          policy: "required",
          intent: "finance",
          reason:
            "Historical finance answers need the context pack before Company-DB retrieval so source-map, Odoo cash/accrual language, and partial-coverage caveats are applied.",
          requiredBefore: "primary_call",
          companyResolution,
          request,
          baseUrl,
        }),
      });
    }
    const searchArgs: Record<string, unknown> = {
      company_id: requestedCompanyId,
      query: request,
    };
    if (companyDbDomain) searchArgs.domain = companyDbDomain;
    return {
      version: 1,
      status:
        missingScopes.length > 0
          ? "blocked"
          : planner.intent.needsClarification
            ? "needs_input"
            : "runnable",
      workflow: "company_db",
      reason:
        "This looks like historical or document-backed finance work without an explicit live source-system request. Start with Company-DB, which is the primary indexed evidence base, before inspecting live connectors.",
      confidence:
        planner.intent.period.kind !== "unknown" || planner.intent.reportFamily !== "custom_operational_report"
          ? "high"
          : "medium",
      companyScopeMode: input.companyScopeMode,
      companyResolution,
      targetProvider: null,
      requiredInputs: unique([
        ...planner.intent.clarificationQuestions,
      ]),
      requiredScopes,
      requestProfile: {
        ...companyDbProfile,
      },
      recommendedCall: {
        method: "POST",
        endpoint: buildEndpoint(baseUrl, "/api/agent/mcp"),
        tool: "search_company_entities",
        args: searchArgs,
      },
      contextPack: buildContextPackHint({
        policy: "required",
        intent: "finance",
        reason:
          "Historical finance answers need the context pack before Company-DB retrieval so source-map, Odoo cash/accrual language, and partial-coverage caveats are applied.",
        requiredBefore: "primary_call",
        companyResolution,
        request,
        baseUrl,
      }),
      accessGuard,
      fallback: {
        workflow: "connectors",
        reason:
          "If Company-DB does not contain enough finance evidence, inspect live connectors next instead of claiming there is no data.",
        call: {
          method: "POST",
          endpoint: buildEndpoint(baseUrl, "/api/agent/mcp"),
          tool: "list_connectors",
          args: { company_id: requestedCompanyId },
        },
      },
    };
  }

  if (targetProvider || lower.includes("connector") || lower.includes("integration") || lower.includes("live data")) {
    const { requiredScopes, missingScopes } = deriveRequiredConnectorScopes(input.scopes, targetProvider);
    const providerDefinition = targetProvider
      ? getConnectorProviderDefinition(targetProvider)
      : null;
    const accessGuard = resolveInheritedAccessGuard({
      membership: resolvedMembership,
      requiredConnectorScopes: providerDefinition?.useScopesAnyOf ?? [],
      requireAnyConnectorScope: !targetProvider,
    });
    const connectorContextPackPolicy: WorkflowContextPackHint["policy"] =
      targetProvider &&
      ["odoo", "dynamics_bc", "payhawk", "metabase", "custom_mcp"].includes(targetProvider)
        ? "recommended"
        : "optional";
    const connectorProfile = {
      category: "connector_lookup" as const,
      reportFamily: planner.intent.reportFamily === "custom_operational_report"
        ? null
        : planner.intent.reportFamily,
      periodLabel: planner.intent.period.kind === "unknown" ? null : planner.intent.period.label,
      dimensions: planner.intent.dimensions,
      needsClarification: false,
    };
    if (accessGuard?.status === "blocked") {
      return buildBlockedByAccessGuard({
        workflow: "connectors",
        reason:
          "This live connector workflow is blocked by the resolved company's inherited connector mask.",
        confidence: targetProvider ? "high" : "medium",
        companyScopeMode: input.companyScopeMode,
        companyResolution,
        targetProvider,
        requiredScopes,
        requestProfile: connectorProfile,
        accessGuard,
        baseUrl,
        contextPack: buildContextPackHint({
          policy: connectorContextPackPolicy,
          intent: "connector_live_lookup",
          reason:
            "Live connector work benefits from context-pack source-map rules, especially for finance systems and partial source coverage.",
          requiredBefore:
            connectorContextPackPolicy === "recommended" ? "primary_call" : null,
          companyResolution,
          request,
          baseUrl,
        }),
      });
    }
    return {
      version: 1,
      status: missingScopes.length > 0 ? "blocked" : "runnable",
      workflow: "connectors",
      reason:
        targetProvider === "odoo"
          ? "This request points at a live Odoo lookup, so the connector path should be used before Company-DB summaries."
          : "This request points at a live integrated system, so the connector catalog and connector actions are the primary path.",
      confidence: targetProvider ? "high" : "medium",
      companyScopeMode: input.companyScopeMode,
      companyResolution,
      targetProvider,
      requiredInputs: [],
      requiredScopes,
      requestProfile: {
        ...connectorProfile,
      },
      recommendedCall: {
        method: "POST",
        endpoint: buildEndpoint(baseUrl, "/api/agent/mcp"),
        tool: "list_connectors",
        args: { company_id: requestedCompanyId },
      },
      contextPack: buildContextPackHint({
        policy: connectorContextPackPolicy,
        intent: "connector_live_lookup",
        reason:
          "Live connector work benefits from context-pack source-map rules, especially for finance systems and partial source coverage.",
        requiredBefore:
          connectorContextPackPolicy === "recommended" ? "primary_call" : null,
        companyResolution,
        request,
        baseUrl,
      }),
      accessGuard,
      fallback: {
        workflow: "company_db",
        reason:
          "If the live connector path is unavailable, fall back to compact Company-DB evidence instead of claiming there is no data.",
        call: {
          method: "POST",
          endpoint: buildEndpoint(baseUrl, "/api/agent/mcp"),
          tool: "search_company_entities",
          args: { company_id: requestedCompanyId, query: request },
        },
      },
    };
  }

  const requiredScopes = ["company_db.read"];
  const missingScopes = requiredScopes.filter((scope) => !input.scopes.includes(scope as ApiKeyScope));
  const companyDbDomain = inferCompanyDbDomain({ request, isFinanceIntent });
  const accessGuard = resolveInheritedAccessGuard({
    membership: resolvedMembership,
    requiredDomains: companyDbDomain ? [companyDbDomain] : [],
  });
  const knowledgeProfile = {
    category: "knowledge_lookup" as const,
    reportFamily: planner.intent.reportFamily === "custom_operational_report"
      ? null
      : planner.intent.reportFamily,
    periodLabel: planner.intent.period.kind === "unknown" ? null : planner.intent.period.label,
    dimensions: planner.intent.dimensions,
    needsClarification: false,
  };
  const knowledgeContextPackIntent = contextPackIntentForCompanyDbDomain({
    domain: companyDbDomain,
    isFinanceIntent,
  });
  const knowledgeContextPackPolicy: WorkflowContextPackHint["policy"] =
    companyDbDomain && ["legal", "tax", "governance", "documents", "finance"].includes(companyDbDomain)
      ? "required"
      : "optional";
  if (resolvedMembership?.accessSource === "inherited" && !companyDbDomain) {
    const guard = accessGuard ?? {
      status: "blocked" as const,
      reasons: ["inherited Company-DB search requires an explicit domain"],
      requiredDomains: [],
      requiredConnectorScopes: [],
      allowedDomains: normalizeMask(resolvedMembership.allowedDomains),
      allowedConnectorScopes: normalizeMask(resolvedMembership.allowedConnectorScopes),
    };
    guard.status = "blocked";
    guard.reasons = unique([
      ...guard.reasons,
      "inherited Company-DB search requires an explicit domain",
    ]);
    return buildBlockedByAccessGuard({
      workflow: "company_db",
      reason:
        "This Company-DB workflow cannot run against inherited access until the request resolves to an explicit allowed domain.",
      confidence: isKnowledgeLookup ? "high" : "medium",
      companyScopeMode: input.companyScopeMode,
      companyResolution,
      targetProvider: null,
      requiredScopes,
      requestProfile: knowledgeProfile,
      accessGuard: guard,
      baseUrl,
      contextPack: buildContextPackHint({
        policy: knowledgeContextPackPolicy,
        intent: knowledgeContextPackIntent,
        reason:
          "Company-DB knowledge answers should use the context pack when domain routing, operating entities, or legal/document caveats matter.",
        requiredBefore:
          knowledgeContextPackPolicy === "required" ? "primary_call" : null,
        companyResolution,
        request,
        baseUrl,
      }),
    });
  }
  if (accessGuard?.status === "blocked") {
    return buildBlockedByAccessGuard({
      workflow: "company_db",
      reason:
        "This Company-DB workflow is blocked by the resolved company's inherited domain mask.",
      confidence: isKnowledgeLookup ? "high" : "medium",
      companyScopeMode: input.companyScopeMode,
      companyResolution,
      targetProvider: null,
      requiredScopes,
      requestProfile: knowledgeProfile,
      accessGuard,
      baseUrl,
      contextPack: buildContextPackHint({
        policy: knowledgeContextPackPolicy,
        intent: knowledgeContextPackIntent,
        reason:
          "Company-DB knowledge answers should use the context pack when domain routing, operating entities, or legal/document caveats matter.",
        requiredBefore:
          knowledgeContextPackPolicy === "required" ? "primary_call" : null,
        companyResolution,
        request,
        baseUrl,
      }),
    });
  }
  const searchArgs: Record<string, unknown> = {
    company_id: requestedCompanyId,
    query: request,
  };
  if (companyDbDomain) searchArgs.domain = companyDbDomain;
  return {
    version: 1,
    status: missingScopes.length > 0 ? "blocked" : "runnable",
    workflow: "company_db",
    reason: isKnowledgeLookup
      ? "This request is asking for compact company knowledge, documents, or evidence, so Company-DB is the primary path."
      : "No stronger live-system or finance-report signal was detected, so start with the compact Company-DB surface.",
    confidence: isKnowledgeLookup ? "high" : "medium",
    companyScopeMode: input.companyScopeMode,
    companyResolution,
    targetProvider: null,
    requiredInputs: [],
    requiredScopes,
    requestProfile: {
      ...knowledgeProfile,
    },
    recommendedCall: {
      method: "POST",
      endpoint: buildEndpoint(baseUrl, "/api/agent/mcp"),
      tool: "search_company_entities",
      args: searchArgs,
    },
    contextPack: buildContextPackHint({
      policy: knowledgeContextPackPolicy,
      intent: knowledgeContextPackIntent,
      reason:
        "Company-DB knowledge answers should use the context pack when domain routing, operating entities, or legal/document caveats matter.",
      requiredBefore:
        knowledgeContextPackPolicy === "required" ? "primary_call" : null,
      companyResolution,
      request,
      baseUrl,
    }),
    accessGuard,
    fallback: {
      workflow: "connectors",
      reason:
        "If the answer must come from a live operational system instead of indexed company knowledge, inspect connectors next.",
      call: {
        method: "POST",
        endpoint: buildEndpoint(baseUrl, "/api/agent/mcp"),
        tool: "list_connectors",
        args: { company_id: requestedCompanyId },
      },
    },
  };
}
