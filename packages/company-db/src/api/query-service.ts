import type Database from "better-sqlite3";

import type { Caller, PolicyConfig } from "./policy-engine.js";
import { evaluateAccess } from "./policy-engine.js";
import type { QueryFilters, EntityResult, EntityView } from "../index/query.js";
import { queryEntities, getEntity, searchFullText } from "../index/query.js";
import { searchSemanticChunks } from "../semantic/search.js";
import type { SemanticSearchRuntime } from "../semantic/runtime.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface QueryService {
  query(caller: Caller, filters: QueryFilters): EntityResult[];
  getEntity(caller: Caller, qualifiedId: string, view?: EntityView): EntityResult | null;
  search(caller: Caller, query: string, options?: { domain?: string; view?: EntityView; limit?: number }): EntityResult[];
  semanticSearchAvailable(): boolean;
  searchSemantic(
    caller: Caller,
    query: string,
    options?: {
      domain?: string;
      limit?: number;
    },
  ): Promise<SemanticSearchHit[]>;
}

export interface QueryServiceError {
  code: "ACCESS_DENIED" | "UNKNOWN_DOMAIN";
  message: string;
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

// ── Field-level metadata ─────────────────────────────────────────────────

/**
 * Default field-level classification for frontmatter keys.
 * Fields not listed here are treated as "internal" (deny-by-default).
 */
const DEFAULT_FIELD_LEVELS: Record<string, string> = {
  // Public — safe for all authenticated callers
  id: "public",
  type: "public",
  name: "public",
  title: "public",
  status: "public",
  domain: "public",
  description: "public",
  amount: "public",
  currency: "public",
  date: "public",
  period: "public",
  period_key: "public",
  period_start: "public",
  period_end: "public",
  period_label: "public",
  reporting_period: "public",
  category: "public",
  created_at: "public",
  updated_at: "public",
  report_type: "public",
  book: "public",
  entity: "public",
  department: "public",
  source: "public",
  source_sheet: "public",
  source_range: "public",
  source_ref_count: "public",
  source_file_name: "public",
  source_document_name: "public",
  document_id: "public",
  confidence: "public",
  line_item_count: "public",
  statement_line_count: "public",
  statement_section_count: "public",
  statement_sections: "public",
  statement_lines_location: "public",
  statement_lines_path: "public",
  canonical_family: "public",
  review_status: "public",
  company_wide: "public",
  scope_key: "public",
  scope_label: "public",
  reporting_currency: "public",
  plan_key: "public",
  scenario: "public",
  scenario_key: "public",
  plan_status: "public",
  document_kind: "public",
  target_domain: "public",
  target_entity_type: "public",
  requires_review: "public",
  review_pending: "public",
  evidence_status: "public",
  routing_confidence: "public",
  ingestion_mode: "public",

  // Restricted — PII, vault-backed, only owner/cfo_agent
  ssn: "restricted",
  tax_id: "restricted",
  bank_account: "restricted",
  routing_number: "restricted",
  personal_email: "restricted",
  personal_phone: "restricted",
  home_address: "restricted",
  date_of_birth: "restricted",
  passport: "restricted",
  national_id: "restricted",

  // Confidential — business-sensitive, owner/cfo_agent/external_accountant
  salary: "confidential",
  compensation: "confidential",
  margin: "confidential",
  unit_cost: "confidential",
  negotiated_rate: "confidential",

  // Internal — require internal-level access
  cost_center: "internal",
  internal_notes: "internal",
  internal_rating: "internal",
  performance_score: "internal",
  hr_notes: "internal",
  line_items: "internal",
  derived_metrics: "internal",
  cell_lineage: "internal",
  classification: "internal",
  candidate_domains: "internal",
  routing_reason: "internal",
  routing_reasons: "internal",
  review_flags: "internal",
  ingestion_reason: "internal",
  topline_findings: "internal",
  anomalies: "internal",
};

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Filter an entity's frontmatter fields based on the access decision.
 */
function filterEntityFields(
  entity: EntityResult,
  filteredFields: string[] | undefined,
): EntityResult {
  if (!filteredFields) return entity;

  const allowed = new Set(filteredFields);
  const filtered: Record<string, unknown> = {};

  for (const key of Object.keys(entity.frontmatter)) {
    if (allowed.has(key)) {
      filtered[key] = entity.frontmatter[key];
    }
  }

  return { ...entity, frontmatter: filtered };
}

/**
 * Build field names and their levels from an entity's frontmatter.
 */
function extractFieldMeta(entity: EntityResult): {
  fields: string[];
  fieldLevels: Record<string, string>;
} {
  const fields = Object.keys(entity.frontmatter);
  const fieldLevels: Record<string, string> = {};

  for (const f of fields) {
    // Deny-by-default: unknown fields are treated as "internal" (not public)
    // to prevent accidental exposure of new/unclassified fields
    fieldLevels[f] = DEFAULT_FIELD_LEVELS[f] ?? "internal";
  }

  return { fields, fieldLevels };
}

function toTopLevelDomain(domain: string | undefined): string | undefined {
  if (!domain) return domain;
  const normalized = domain.trim().toLowerCase();
  if (!normalized) return undefined;
  return normalized.split("/")[0] || undefined;
}

function normalizeDomainForQuery(domain: string | undefined): string | undefined {
  const topLevel = toTopLevelDomain(domain);
  if (!topLevel) return topLevel;
  if (topLevel === "imports") return "integrations";
  if (topLevel === "misc") return "documents";
  return topLevel;
}

function normalizeDomainForPolicy(domain: string | undefined): string | undefined {
  return normalizeDomainForQuery(domain);
}

function expandDomainAliases(domain: string | undefined): string[] {
  const normalized = normalizeDomainForQuery(domain);
  if (!normalized) return [];
  if (normalized === "integrations") return ["integrations", "imports"];
  if (normalized === "documents") return ["documents", "misc"];
  return [normalized];
}

/**
 * Apply field filtering to an array of entities.
 * Re-evaluates access per entity since each may have different fields.
 */
function filterResults(
  entities: EntityResult[],
  caller: Caller,
  policy: PolicyConfig,
): EntityResult[] {
  return entities.map((entity) => {
    const { fields, fieldLevels } = extractFieldMeta(entity);
    const decision = evaluateAccess(
      caller,
      { domain: normalizeDomainForPolicy(entity.domain), fields, fieldLevels },
      policy,
    );

    if (!decision.allowed) return null;
    return filterEntityFields(entity, decision.filteredFields);
  }).filter((e): e is EntityResult => e !== null);
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Create a QueryService that wraps the raw query interface with RBAC checks.
 *
 * Each method:
 * 1. Evaluates access via the policy engine
 * 2. Queries the underlying database
 * 3. Filters fields based on the caller's allowed field levels
 * 4. Returns the sanitized results
 */
export function createQueryService(
  db: Database.Database,
  policy: PolicyConfig,
  options?: {
    semanticSearch?: SemanticSearchRuntime | null;
  },
): QueryService {
  const semanticSearch = options?.semanticSearch ?? null;

  function filterSemanticResults(
    hits: SemanticSearchHit[],
    caller: Caller,
  ): SemanticSearchHit[] {
    return hits.filter((hit) => {
      const decision = evaluateAccess(
        caller,
        { domain: normalizeDomainForPolicy(hit.domain) },
        policy,
      );
      return decision.allowed;
    });
  }

  return {
    query(caller: Caller, filters: QueryFilters): EntityResult[] {
      const requestedDomain = normalizeDomainForQuery(filters.domain);

      // Check domain-level access first
      const domainCheck = evaluateAccess(
        caller,
        { domain: requestedDomain },
        policy,
      );

      if (!domainCheck.allowed) {
        return [];
      }

      let results: EntityResult[] = [];
      const aliasDomains = expandDomainAliases(requestedDomain);

      if (!requestedDomain || aliasDomains.length <= 1) {
        results = queryEntities(db, { ...filters, domain: requestedDomain });
      } else {
        const merged = new Map<string, EntityResult>();
        for (const domain of aliasDomains) {
          const rows = queryEntities(db, { ...filters, domain });
          for (const row of rows) {
            merged.set(row.qualifiedId, row);
          }
        }
        results = Array.from(merged.values());
      }

      return filterResults(results, caller, policy);
    },

    getEntity(caller: Caller, qualifiedId: string, view?: EntityView): EntityResult | null {
      const entity = getEntity(db, qualifiedId, view);
      if (!entity) return null;

      // Check domain-level access
      const { fields, fieldLevels } = extractFieldMeta(entity);
      const decision = evaluateAccess(
        caller,
        { domain: normalizeDomainForPolicy(entity.domain), fields, fieldLevels },
        policy,
      );

      if (!decision.allowed) return null;

      return filterEntityFields(entity, decision.filteredFields);
    },

    search(caller: Caller, query: string, options?: { domain?: string; view?: EntityView; limit?: number }): EntityResult[] {
      const results = searchFullText(db, query, options?.limit, options?.view, options?.domain);

      // Filter out entities from domains the caller cannot access,
      // then apply field-level filtering
      return filterResults(results, caller, policy);
    },

    semanticSearchAvailable(): boolean {
      return semanticSearch !== null;
    },

    async searchSemantic(
      caller: Caller,
      query: string,
      options?: {
        domain?: string;
        limit?: number;
      },
    ): Promise<SemanticSearchHit[]> {
      if (!semanticSearch) {
        return [];
      }

      const requestedDomain = normalizeDomainForQuery(options?.domain);
      if (requestedDomain) {
        const decision = evaluateAccess(
          caller,
          { domain: requestedDomain },
          policy,
        );
        if (!decision.allowed) {
          return [];
        }
      }

      const results = await searchSemanticChunks(
        query,
        {
          companySlug: semanticSearch.companySlug,
          domain: requestedDomain,
          limit: options?.limit,
          retrievalMode: "semantic",
        },
        {
          embedder: semanticSearch.embedder,
          vectorStore: semanticSearch.vectorStore,
        },
      );

      const hits = results.map((result) => ({
        qualifiedId: result.payload.qualified_id,
        domain: result.payload.domain,
        filePath: result.payload.file_path,
        title: result.payload.title,
        entityType: result.payload.entity_type,
        summaryPath: result.payload.summary_path,
        documentId: result.payload.document_id,
        chunkId: result.payload.chunk_id,
        chunkIndex: result.payload.chunk_index,
        sectionPath: result.payload.section_path,
        language: result.payload.language,
        score: result.score,
        retrievalMode: "semantic" as const,
        snippet: result.payload.snippet,
      }));

      return filterSemanticResults(hits, caller);
    },
  };
}
