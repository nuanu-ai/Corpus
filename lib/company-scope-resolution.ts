import { rankCompanyScopeMatches, type CompanyScopeMatch } from "@/lib/consultant/company-scope";
import type { CompanyMembership } from "@/lib/db/tenant";
import {
  expandOperatingEntitySearchTerms,
  getOperatingEntityRegistry,
  resolveOperatingEntities,
} from "@/lib/operating-entities/registry";
import { normalizeOperatingSearchKey } from "@/lib/operating-entities/normalization";
import type { OperatingEntityRecord } from "@/lib/operating-entities/types";

export interface ResolvedCompanyRef {
  id: string;
  name: string;
  slug: string | null;
  role: string;
}

export type ResolvedCompanyScopeMatch = ResolvedCompanyRef & {
  score: number;
  matchedLabel: string;
  matchReason: CompanyScopeMatch["matchReason"];
  isActiveCompany: boolean;
  accessSource: "direct" | "api_key_parent" | "inherited";
  viaCompanyId: string | null;
  viaCompanySlug: string | null;
  relationshipId: string | null;
  relationshipType: string | null;
  allowedDomains: string[] | null;
  domainAccessLevels: CompanyMembership["domainAccessLevels"];
  allowedConnectorScopes: string[] | null;
  pathEdgeIds: string[] | null;
  requestedDomainAllowed: boolean | null;
  requestedConnectorScopeAllowed: boolean | null;
};

export interface ResolvedOperatingEntityMatch {
  id: string;
  canonicalName: string;
  objectType: string;
  status: string;
  confidence: string;
  score: number;
  matchedTerm: string;
  matchKind: string;
  aliases: string[];
  parentIds: string[];
  legalEntityIds: string[];
  partnerIds: string[];
  legalEntities: string[];
  parentEntities: string[];
  partnerEntities: string[];
  searchTerms: string[];
  companyDbSearchTerms: string[];
  connectorSearchHints: string[];
  sourceMappings: {
    companyDb: {
      folders: string[];
      queryAliases: string[];
    };
    odoo: {
      company: string | null;
      analyticAccounts: string[];
      posConfigs: string[];
      accounts: string[];
      partners: string[];
    };
    customMcp: {
      tools: string[];
    };
  };
  grantsDataAccess: false;
  linkedAccessibleCompanyIds: string[];
}

function requestedMaskAllowed(input: {
  accessSource: string | undefined;
  requestedValue?: string | null;
  allowedValues?: string[] | null;
}): boolean | null {
  if (!input.requestedValue) return null;
  if (!Array.isArray(input.allowedValues)) return true;
  return input.allowedValues.includes(input.requestedValue);
}

function linkedAccessibleCompanyIds(
  searchTerms: string[],
  accessibleCompanies: CompanyMembership[],
): string[] {
  const normalizedTerms = new Set(
    searchTerms
      .map(normalizeOperatingSearchKey)
      .filter(Boolean),
  );
  return accessibleCompanies
    .filter((company) => {
      const labels = [
        company.companyName,
        company.companySlug ?? "",
        (company.companySlug ?? "").replace(/-/g, " "),
      ].map(normalizeOperatingSearchKey);
      return labels.some((label) => normalizedTerms.has(label));
    })
    .map((company) => company.companyId);
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function linkedNames(record: OperatingEntityRecord, ids: readonly string[]): string[] {
  const registry = getOperatingEntityRegistry();
  return ids
    .map((id) => registry.recordsById.get(id)?.canonicalName ?? registry.legalEntityNamesById.get(id))
    .filter((value): value is string => Boolean(value));
}

function sourceMappingsForScope(record: OperatingEntityRecord): ResolvedOperatingEntityMatch["sourceMappings"] {
  return {
    companyDb: {
      folders: record.sourceMappings.companyDb?.folders?.slice(0, 8) ?? [],
      queryAliases: record.sourceMappings.companyDb?.queryAliases?.slice(0, 12) ?? [],
    },
    odoo: {
      company: record.sourceMappings.odoo?.company ?? null,
      analyticAccounts: record.sourceMappings.odoo?.analyticAccounts?.slice(0, 8) ?? [],
      posConfigs: record.sourceMappings.odoo?.posConfigs?.slice(0, 8) ?? [],
      accounts: record.sourceMappings.odoo?.accounts?.slice(0, 8) ?? [],
      partners: record.sourceMappings.odoo?.partners?.slice(0, 8) ?? [],
    },
    customMcp: {
      tools: record.sourceMappings.customMcp?.tools?.slice(0, 8) ?? [],
    },
  };
}

function connectorSearchHints(record: OperatingEntityRecord): string[] {
  const mappings = sourceMappingsForScope(record);
  return uniqueStrings([
    mappings.odoo.company ? `odoo.company:${mappings.odoo.company}` : "",
    ...mappings.odoo.analyticAccounts.map((value) => `odoo.analytic:${value}`),
    ...mappings.odoo.posConfigs.map((value) => `odoo.pos:${value}`),
    ...mappings.odoo.accounts.map((value) => `odoo.account:${value}`),
    ...mappings.odoo.partners.map((value) => `odoo.partner:${value}`),
    ...mappings.customMcp.tools.map((value) => `customMcp.tool:${value}`),
  ]).slice(0, 16);
}

export function resolveCompanyScopeReference(input: {
  query: string;
  targetCompanyName?: string | null;
  activeCompany?: ResolvedCompanyRef | null;
  activeCompanyId?: string | null;
  accessibleCompanies: CompanyMembership[];
  includeOperatingEntities?: boolean;
  requestedDomain?: string | null;
  requestedConnectorScope?: string | null;
  limit?: number;
}) {
  const ranked = rankCompanyScopeMatches({
    query: input.query,
    targetCompanyName: input.targetCompanyName,
    memberships: input.accessibleCompanies,
    activeCompanyId: input.activeCompanyId ?? input.activeCompany?.id ?? null,
    limit: input.limit ?? 5,
  });

  const matches: ResolvedCompanyScopeMatch[] = ranked.matches.map((match) => ({
    id: match.companyId,
    name: match.companyName,
    slug: match.companySlug,
    role: match.role,
    score: match.score,
    matchedLabel: match.matchedLabel,
    matchReason: match.matchReason,
    isActiveCompany: match.isActiveCompany,
    accessSource: match.accessSource ?? "direct",
    viaCompanyId: match.viaCompanyId ?? null,
    viaCompanySlug: match.viaCompanySlug ?? null,
    relationshipId: match.relationshipId ?? null,
    relationshipType: match.relationshipType ?? null,
    allowedDomains: match.allowedDomains ?? null,
    domainAccessLevels: match.domainAccessLevels ?? null,
    allowedConnectorScopes: match.allowedConnectorScopes ?? null,
    pathEdgeIds: match.pathEdgeIds ?? null,
    requestedDomainAllowed: requestedMaskAllowed({
      accessSource: match.accessSource,
      requestedValue: input.requestedDomain,
      allowedValues: match.allowedDomains,
    }),
    requestedConnectorScopeAllowed: requestedMaskAllowed({
      accessSource: match.accessSource,
      requestedValue: input.requestedConnectorScope,
      allowedValues: match.allowedConnectorScopes,
    }),
  }));

  const operatingEntityMatches: ResolvedOperatingEntityMatch[] =
    input.includeOperatingEntities === false
      ? []
      : resolveOperatingEntities(input.targetCompanyName ?? input.query, { limit: 5 })
        .map((match) => {
          const searchTerms = expandOperatingEntitySearchTerms(
            match.record.canonicalName,
            { limit: 1 },
          ).slice(0, 16);
          const legalEntities = linkedNames(match.record, match.record.legalEntityIds);
          const parentEntities = linkedNames(match.record, match.record.parentIds);
          const partnerEntities = linkedNames(match.record, match.record.partnerIds);
          const sourceMappings = sourceMappingsForScope(match.record);
          const companyDbSearchTerms = uniqueStrings([
            ...searchTerms,
            ...sourceMappings.companyDb.queryAliases,
          ]).slice(0, 16);
          return {
            id: match.record.id,
            canonicalName: match.record.canonicalName,
            objectType: match.record.objectType,
            status: match.record.status,
            confidence: match.record.confidence,
            score: match.score,
            matchedTerm: match.matchedTerm,
            matchKind: match.matchKind,
            aliases: match.record.aliases.slice(0, 12),
            parentIds: match.record.parentIds,
            legalEntityIds: match.record.legalEntityIds,
            partnerIds: match.record.partnerIds,
            legalEntities,
            parentEntities,
            partnerEntities,
            searchTerms,
            companyDbSearchTerms,
            connectorSearchHints: connectorSearchHints(match.record),
            sourceMappings,
            grantsDataAccess: false as const,
            linkedAccessibleCompanyIds: linkedAccessibleCompanyIds(
              [
                ...searchTerms,
                ...legalEntities,
                ...parentEntities,
                ...partnerEntities,
                ...companyDbSearchTerms,
              ],
              input.accessibleCompanies,
            ),
          };
        });

  for (const operatingMatch of operatingEntityMatches) {
    if (!["legal_entity", "operating_domain"].includes(operatingMatch.objectType)) continue;
    for (const companyId of operatingMatch.linkedAccessibleCompanyIds) {
      if (matches.some((match) => match.id === companyId)) continue;
      const company = input.accessibleCompanies.find((membership) => membership.companyId === companyId);
      if (!company) continue;
      matches.push({
        id: company.companyId,
        name: company.companyName,
        slug: company.companySlug,
        role: company.role,
        score: Math.max(45, operatingMatch.score - 5),
        matchedLabel: operatingMatch.matchedTerm,
        matchReason: "phrase",
        isActiveCompany: company.companyId === (input.activeCompanyId ?? input.activeCompany?.id ?? null),
        accessSource: company.accessSource ?? "direct",
        viaCompanyId: company.viaCompanyId ?? null,
        viaCompanySlug: company.viaCompanySlug ?? null,
        relationshipId: company.relationshipId ?? null,
        relationshipType: company.relationshipType ?? null,
        allowedDomains: company.allowedDomains ?? null,
        domainAccessLevels: company.domainAccessLevels ?? null,
        allowedConnectorScopes: company.allowedConnectorScopes ?? null,
        pathEdgeIds: company.pathEdgeIds ?? null,
        requestedDomainAllowed: requestedMaskAllowed({
          accessSource: company.accessSource,
          requestedValue: input.requestedDomain,
          allowedValues: company.allowedDomains,
        }),
        requestedConnectorScopeAllowed: requestedMaskAllowed({
          accessSource: company.accessSource,
          requestedValue: input.requestedConnectorScope,
          allowedValues: company.allowedConnectorScopes,
        }),
      });
    }
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.name.localeCompare(right.name);
  });

  const topMatch = matches[0] ?? null;
  const targetDiffersFromActive = Boolean(topMatch && !topMatch.isActiveCompany);
  const noAccessibleMatch = matches.length === 0;

  return {
    action: "company_scope_resolution" as const,
    query: input.query,
    targetCompanyName: input.targetCompanyName ?? null,
    activeCompany: input.activeCompany ?? null,
    matches,
    ambiguous: ranked.ambiguous,
    operatingEntityMatches,
    targetDiffersFromActive,
    noAccessibleMatch,
    safeAnsweringGuidance: targetDiffersFromActive
      ? "The best accessible match is not the active company. Do not present active-company records as this target company's complete data. Ask the user to switch active company or explicitly state that only active-company related evidence can be checked in this thread."
      : noAccessibleMatch
        ? operatingEntityMatches.length > 0
          ? "No accessible app company matched the named target, but the organization registry has a related operating object. Use the operating aliases and linked legal entities as search context inside the active/access-controlled company scope; do not treat this as cross-tenant authorization."
          : "No accessible company matched the named target. Treat any active-company search results as related evidence only, not complete target-company coverage."
        : ranked.ambiguous
          ? "Multiple accessible companies are plausible. State the ambiguity and do not choose silently for high-stakes finance/legal answers."
          : "The named target appears to match the active company or a single accessible company. Continue with source-specific checks before answering.",
  };
}
