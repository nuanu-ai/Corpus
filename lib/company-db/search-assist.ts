import { createHash } from "node:crypto";

import {
  searchEntities,
  searchEntitiesSemantic,
  type CompanyDbRequestOptions,
  type EntityResult,
  type SearchFilters,
  type SemanticSearchHit,
} from "@/lib/company-db/client";

const FINANCE_HEAVY_TERMS = [
  "revenue",
  "profit",
  "p&l",
  "pnl",
  "expense",
  "expenses",
  "cash flow",
  "balance sheet",
  "trial balance",
  "ledger",
  "journal",
  "bank",
  "banking",
  "invoice",
  "invoices",
  "ar ",
  "ap ",
  "opex",
  "cogs",
  "ebitda",
];

const NARRATIVE_SEMANTIC_TERMS = [
  "clause",
  "termination",
  "renewal",
  "penalty",
  "permit",
  "license",
  "agreement",
  "contract",
  "lease",
  "obligation",
  "notice",
  "governing law",
  "compliance",
  "policy",
  "restriction",
  "deadline",
];

const MAX_EVAL_QUERY_LENGTH = 500;
const MAX_EVAL_ERROR_LENGTH = 300;
const MAX_EVAL_REFS = 5;
const MAX_CHAT_RUN_EVAL_EVENTS = 20;
const DEFAULT_CHAT_SEMANTIC_ALLOWED_DOMAINS = [
  "knowledge",
  "legal",
  "governance",
  "operations",
  "documents",
];
const CHAT_SEMANTIC_FINANCE_DOMAINS = new Set(["finance", "banking", "revenue", "expenses"]);

export interface CompanyDbSearchAssistOptions {
  companyId?: string | null;
  query: string;
  request: CompanyDbRequestOptions;
  searchFilters?: SearchFilters;
  allowSemantic?: boolean;
}

export interface CompanyDbSearchAssistResult {
  lexicalResults: EntityResult[];
  selectedMode: "lexical" | "semantic_fallback";
  selectedResults: EntityResult[] | SemanticSearchHit[];
  semanticShadow:
    | CompanyDbSemanticShadowAttempt
    | null;
  semanticEvalEvent: CompanyDbSemanticEvalEvent;
}

export interface CompanyDbSemanticShadowAttempt {
  attempted: true;
  count: number;
  results: SemanticSearchHit[];
  error?: string;
}

export interface CompanyDbSemanticShadowSummary {
  attempted: true;
  count: number;
  topScore: number | null;
  error?: string;
}

export interface CompanyDbSemanticEvalEvent {
  schemaVersion: 1;
  eventType: "company_db_semantic_eval";
  capturedAt: string;
  companyId: string | null;
  companySlug: string;
  query: string;
  domain: string | null;
  limit: number | null;
  flags: {
    allowSemantic: boolean;
    canaryCompany: boolean;
    financeHeavy: boolean;
    narrativeEligible: boolean;
    domainAllowed: boolean;
    shadowEnabled: boolean;
    fallbackEnabled: boolean;
  };
  selectedMode: "lexical" | "semantic_fallback";
  semanticAttempted: boolean;
  suppressionReason: string | null;
  latencyMs: number;
  lexical: {
    count: number;
    top: Array<{
      refHash: string;
      domain?: string;
    }>;
  };
  semantic: {
    count: number;
    topScore: number | null;
    top: Array<{
      refHash: string;
      domain?: string;
      chunkIndex?: number;
      score?: number;
    }>;
    error: string | null;
  };
}

export interface CompanyDbSemanticEvalMetadata {
  schemaVersion: 1;
  eventType: "company_db_semantic_eval_batch";
  eventCount: number;
  truncated: boolean;
  events: CompanyDbSemanticEvalEvent[];
}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function parseCsvSet(value: string | undefined, fallback: string[] = []): Set<string> {
  const source = value === undefined ? fallback.join(",") : value;
  return new Set(
    source
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function isSemanticCanaryCompany(companyId?: string | null): boolean {
  if (!companyId) return false;
  const canaryIds = parseCsvSet(process.env.CHAT_COMPANY_DB_SEMANTIC_CANARY_COMPANY_IDS);
  if (canaryIds.size === 0) {
    return false;
  }
  if (canaryIds.has("*")) {
    return true;
  }
  return canaryIds.has(companyId);
}

export function isSemanticAllowedDomain(domain?: string | null): boolean {
  const normalizedDomain = domain?.trim().toLowerCase();
  if (!normalizedDomain || CHAT_SEMANTIC_FINANCE_DOMAINS.has(normalizedDomain)) {
    return false;
  }
  const allowedDomains = parseCsvSet(
    process.env.CHAT_COMPANY_DB_SEMANTIC_ALLOWED_DOMAINS,
    DEFAULT_CHAT_SEMANTIC_ALLOWED_DOMAINS,
  );
  if (allowedDomains.size === 0) {
    return false;
  }
  if (allowedDomains.has("*")) {
    return true;
  }
  return allowedDomains.has(normalizedDomain);
}

export function isFinanceHeavySearchQuery(query: string): boolean {
  const normalized = ` ${query.trim().toLowerCase()} `;
  return FINANCE_HEAVY_TERMS.some((term) => normalized.includes(term));
}

export function isFinanceSearchDomain(domain?: string | null): boolean {
  const normalizedDomain = domain?.trim().toLowerCase();
  return Boolean(normalizedDomain && CHAT_SEMANTIC_FINANCE_DOMAINS.has(normalizedDomain));
}

export function isNarrativeSemanticQuery(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 12) return false;
  if (isFinanceHeavySearchQuery(normalized)) return false;
  if (NARRATIVE_SEMANTIC_TERMS.some((term) => normalized.includes(term))) {
    return true;
  }
  return normalized.split(/\s+/).filter(Boolean).length >= 4;
}

export function summarizeSemanticShadow(
  shadow: CompanyDbSemanticShadowAttempt | null,
): CompanyDbSemanticShadowSummary | null {
  if (!shadow) {
    return null;
  }

  const topScore = shadow.results.reduce<number | null>((maxScore, result) => {
    if (typeof result.score !== "number" || Number.isNaN(result.score)) {
      return maxScore;
    }
    return maxScore === null ? result.score : Math.max(maxScore, result.score);
  }, null);

  return {
    attempted: true,
    count: shadow.count,
    topScore,
    ...(shadow.error ? { error: shadow.error } : {}),
  };
}

function truncateEvalQuery(query: string): string {
  const normalized = query.trim().replace(/\s+/g, " ");
  return normalized.length <= MAX_EVAL_QUERY_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_EVAL_QUERY_LENGTH - 15)}...[truncated]`;
}

function truncateEvalError(error: string): string {
  const normalized = error.trim().replace(/\s+/g, " ");
  return normalized.length <= MAX_EVAL_ERROR_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_EVAL_ERROR_LENGTH - 15)}...[truncated]`;
}

function evalRefHash(parts: Array<string | number | null | undefined>): string {
  const normalized = parts
    .map((part) => (part === null || part === undefined ? "" : String(part)))
    .join("|");
  return `sha256:${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`;
}

function semanticTopScore(results: SemanticSearchHit[]): number | null {
  return results.reduce<number | null>((maxScore, result) => {
    if (typeof result.score !== "number" || Number.isNaN(result.score)) return maxScore;
    return maxScore === null ? result.score : Math.max(maxScore, result.score);
  }, null);
}

function lexicalEvalRefs(results: EntityResult[]): CompanyDbSemanticEvalEvent["lexical"]["top"] {
  return results.slice(0, MAX_EVAL_REFS).map((result) => ({
    refHash: evalRefHash([result.qualifiedId, result.domain, result.filePath]),
    ...(result.domain ? { domain: result.domain } : {}),
  }));
}

function semanticEvalRefs(results: SemanticSearchHit[]): CompanyDbSemanticEvalEvent["semantic"]["top"] {
  return results.slice(0, MAX_EVAL_REFS).map((result) => ({
    refHash: evalRefHash([result.qualifiedId, result.domain, result.chunkId, result.chunkIndex]),
    ...(result.domain ? { domain: result.domain } : {}),
    ...(typeof result.chunkIndex === "number" ? { chunkIndex: result.chunkIndex } : {}),
    ...(typeof result.score === "number" && !Number.isNaN(result.score) ? { score: result.score } : {}),
  }));
}

function semanticSuppressionReason(input: {
  allowSemantic: boolean;
  canaryCompany: boolean;
  financeHeavy: boolean;
  narrativeEligible: boolean;
  domainAllowed: boolean;
  shadowEnabled: boolean;
  fallbackEnabled: boolean;
  shouldAttemptSemantic: boolean;
}): string | null {
  if (input.shouldAttemptSemantic) return null;
  if (!input.allowSemantic) return "semantic_disabled_by_call";
  if (!input.canaryCompany) return "company_not_in_canary";
  if (input.financeHeavy) return "finance_structured_first";
  if (!input.narrativeEligible) return "query_not_narrative";
  if (!input.domainAllowed) return "domain_not_allowed";
  if (!input.shadowEnabled && !input.fallbackEnabled) return "semantic_runtime_flags_disabled";
  return "semantic_not_attempted";
}

function buildSemanticEvalEvent(input: {
  options: CompanyDbSearchAssistOptions;
  lexicalResults: EntityResult[];
  semanticResults?: SemanticSearchHit[];
  semanticError?: string | null;
  selectedMode: "lexical" | "semantic_fallback";
  semanticAttempted: boolean;
  startedAtMs: number;
  capturedAt: string;
  allowSemantic: boolean;
  canaryCompany: boolean;
  financeHeavy: boolean;
  narrativeEligible: boolean;
  domainAllowed: boolean;
  shadowEnabled: boolean;
  fallbackEnabled: boolean;
  shouldAttemptSemantic: boolean;
}): CompanyDbSemanticEvalEvent {
  const semanticResults = input.semanticResults ?? [];
  return {
    schemaVersion: 1,
    eventType: "company_db_semantic_eval",
    capturedAt: input.capturedAt,
    companyId: input.options.companyId ?? null,
    companySlug: input.options.request.companySlug,
    query: truncateEvalQuery(input.options.query),
    domain: input.options.searchFilters?.domain ?? null,
    limit: typeof input.options.searchFilters?.limit === "number"
      ? input.options.searchFilters.limit
      : null,
    flags: {
      allowSemantic: input.allowSemantic,
      canaryCompany: input.canaryCompany,
      financeHeavy: input.financeHeavy,
      narrativeEligible: input.narrativeEligible,
      domainAllowed: input.domainAllowed,
      shadowEnabled: input.shadowEnabled,
      fallbackEnabled: input.fallbackEnabled,
    },
    selectedMode: input.selectedMode,
    semanticAttempted: input.semanticAttempted,
    suppressionReason: semanticSuppressionReason(input),
    latencyMs: Math.max(0, Date.now() - input.startedAtMs),
    lexical: {
      count: input.lexicalResults.length,
      top: lexicalEvalRefs(input.lexicalResults),
    },
    semantic: {
      count: semanticResults.length,
      topScore: semanticTopScore(semanticResults),
      top: semanticEvalRefs(semanticResults),
      error: input.semanticError ? truncateEvalError(input.semanticError) : null,
    },
  };
}

export function buildCompanyDbSemanticEvalMetadata(
  events: CompanyDbSemanticEvalEvent[],
): CompanyDbSemanticEvalMetadata | null {
  if (events.length === 0) return null;
  const cappedEvents = events.slice(-MAX_CHAT_RUN_EVAL_EVENTS);
  return {
    schemaVersion: 1,
    eventType: "company_db_semantic_eval_batch",
    eventCount: events.length,
    truncated: events.length > cappedEvents.length,
    events: cappedEvents,
  };
}

export async function runCompanyDbSearchAssist(
  options: CompanyDbSearchAssistOptions,
): Promise<CompanyDbSearchAssistResult> {
  const startedAtMs = Date.now();
  const capturedAt = new Date().toISOString();
  const lexicalResults = await searchEntities(
    options.query,
    options.request,
    options.searchFilters ?? {},
  );

  const allowSemantic = options.allowSemantic !== false;
  const canaryCompany = isSemanticCanaryCompany(options.companyId);
  const financeHeavy =
    isFinanceHeavySearchQuery(options.query) ||
    isFinanceSearchDomain(options.searchFilters?.domain);
  const narrativeEligible = isNarrativeSemanticQuery(options.query);
  const domainAllowed = isSemanticAllowedDomain(options.searchFilters?.domain);
  const shadowEnabled = isEnabled(process.env.CHAT_COMPANY_DB_SEMANTIC_SHADOW_V1);
  const fallbackEnabled = isEnabled(process.env.CHAT_COMPANY_DB_SEMANTIC_FALLBACK_V1);
  const semanticEligible =
    allowSemantic &&
    canaryCompany &&
    narrativeEligible &&
    domainAllowed;
  const shouldAttemptSemantic = semanticEligible &&
    (shadowEnabled || (fallbackEnabled && lexicalResults.length === 0));

  if (!shouldAttemptSemantic) {
    return {
      lexicalResults,
      selectedMode: "lexical",
      selectedResults: lexicalResults,
      semanticShadow: null,
      semanticEvalEvent: buildSemanticEvalEvent({
        options,
        lexicalResults,
        selectedMode: "lexical",
        semanticAttempted: false,
        startedAtMs,
        capturedAt,
        allowSemantic,
        canaryCompany,
        financeHeavy,
        narrativeEligible,
        domainAllowed,
        shadowEnabled,
        fallbackEnabled,
        shouldAttemptSemantic,
      }),
    };
  }

  try {
    const semanticResults = await searchEntitiesSemantic(
      options.query,
      options.request,
      {
        domain: options.searchFilters?.domain,
        limit: Math.min(options.searchFilters?.limit ?? 12, 6),
      },
    );

    const useFallback = fallbackEnabled && lexicalResults.length === 0 && semanticResults.length > 0;
    return {
      lexicalResults,
      selectedMode: useFallback ? "semantic_fallback" : "lexical",
      selectedResults: useFallback ? semanticResults : lexicalResults,
      semanticShadow: shadowEnabled
        ? {
            attempted: true,
            count: semanticResults.length,
            results: semanticResults,
          }
        : null,
      semanticEvalEvent: buildSemanticEvalEvent({
        options,
        lexicalResults,
        semanticResults,
        selectedMode: useFallback ? "semantic_fallback" : "lexical",
        semanticAttempted: true,
        startedAtMs,
        capturedAt,
        allowSemantic,
        canaryCompany,
        financeHeavy,
        narrativeEligible,
        domainAllowed,
        shadowEnabled,
        fallbackEnabled,
        shouldAttemptSemantic,
      }),
    };
  } catch (error) {
    const semanticError = truncateEvalError(
      error instanceof Error ? error.message : "Semantic search failed",
    );
    return {
      lexicalResults,
      selectedMode: "lexical",
      selectedResults: lexicalResults,
      semanticShadow: shadowEnabled
        ? {
            attempted: true,
            count: 0,
            results: [],
            error: semanticError,
          }
        : null,
      semanticEvalEvent: buildSemanticEvalEvent({
        options,
        lexicalResults,
        semanticError,
        selectedMode: "lexical",
        semanticAttempted: true,
        startedAtMs,
        capturedAt,
        allowSemantic,
        canaryCompany,
        financeHeavy,
        narrativeEligible,
        domainAllowed,
        shadowEnabled,
        fallbackEnabled,
        shouldAttemptSemantic,
      }),
    };
  }
}
