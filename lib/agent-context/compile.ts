import {
  getCompanyDescription,
  getCompanyBusinessProfileAdditions,
} from "@/lib/company-settings";
import {
  getConnectorExpectedSyncIntervalMs,
  getConnectorUseScopes,
} from "@/lib/connectors/provider-registry";
import {
  expandOperatingEntitySearchTerms,
  getOperatingEntityRegistry,
  resolveOperatingEntities,
} from "@/lib/operating-entities/registry";
import type { OperatingEntityRecord } from "@/lib/operating-entities/types";

import {
  AGENT_CONTEXT_PACK_VERSION,
  agentContextIntentSchema,
  agentContextPackSchema,
  type AgentContextIntent,
  type AgentContextOmittedSection,
  type AgentContextPack,
  type AgentContextProvenance,
  type AgentContextSections,
} from "./schema";
import {
  getAgentContextSourceFileUpdatedAt,
  isAgentContextSourceFileForCompany,
  isAgentContextSourceFileStale,
  type AgentContextEntityAliasSpec,
  type AgentContextFreshnessNoteSpec,
  type AgentContextRuleSpec,
  type AgentContextSourceFile,
  type AgentContextSourceMapSpec,
} from "./source-files";

export type AgentContextAuthSurface = "api_key" | "session" | "internal";

export type AgentContextCompanyInput = {
  id: string;
  name: string;
  slug?: string | null;
  jurisdiction?: string | null;
  entityType?: string | null;
  businessType?: string | null;
  website?: string | null;
  aliases?: readonly string[] | null;
  reportingCurrency?: string | null;
  role?: string | null;
  settings?: Record<string, unknown> | null;
  accessSource?: string | null;
  viaCompanyId?: string | null;
  viaCompanyName?: string | null;
  allowedDomains?: readonly string[] | null;
  domainAccessLevels?: Record<string, string> | null;
  allowedConnectorScopes?: readonly string[] | null;
};

export type AgentContextConnectorSnapshot = {
  provider: string;
  label?: string | null;
  status?: string | null;
  lastSyncAt?: string | Date | null;
  lastError?: string | null;
  connectionLabel?: string | null;
  expectedSyncIntervalMs?: number | null;
};

export type AgentContextCompanyDbSnapshot = {
  status: "active" | "stale" | "missing" | "failed" | "unknown";
  summaryFreshnessAt?: string | Date | null;
  domains?: readonly string[] | null;
  detail?: string | null;
};

export type AgentContextDocumentQuestionsSnapshot = {
  openCount: number;
  oldestCreatedAt?: string | Date | null;
};

export type AgentContextReportJobSnapshot = {
  status: "active" | "stale" | "missing" | "failed" | "unknown";
  latestCompletedAt?: string | Date | null;
  pendingCount?: number | null;
  failedCount?: number | null;
};

export type CompileAgentContextPackInput = {
  company: AgentContextCompanyInput;
  intent?: AgentContextIntent | string | null;
  query?: string | null;
  authSurface?: AgentContextAuthSurface;
  scopes?: readonly string[] | null;
  connectorSnapshots?: readonly AgentContextConnectorSnapshot[];
  connectorSnapshotsUnavailable?: string | null;
  companyDbSnapshot?: AgentContextCompanyDbSnapshot | null;
  documentQuestionsSnapshot?: AgentContextDocumentQuestionsSnapshot | null;
  reportJobSnapshot?: AgentContextReportJobSnapshot | null;
  agentContextSourceFiles?: readonly AgentContextSourceFile[] | null;
  agentContextSourceFilesUnavailable?: string | null;
  now?: Date;
  maxItemsPerSection?: number;
  maxOperatingEntities?: number;
};

type MutableSections = {
  [K in keyof AgentContextSections]: AgentContextSections[K];
};

const DEFAULT_MAX_ITEMS_PER_SECTION = 8;
const DEFAULT_MAX_OPERATING_ENTITIES = 8;

const RAW_PAYLOAD_OMISSIONS: AgentContextOmittedSection[] = [
  {
    section: "connectorSamples",
    reason: "raw_payload",
    detail: "Raw connector payloads are excluded from default context packs.",
  },
  {
    section: "documentBodies",
    reason: "raw_payload",
    detail: "Full document bodies are available only through explicit authorized drill-down tools.",
  },
];

function builtInProvenance(sourcePath: string, compiledAt: string): AgentContextProvenance {
  return {
    source: "built_in",
    sourcePath,
    updatedAt: compiledAt,
    confidence: "high",
  };
}

function normalizeIntent(intent: CompileAgentContextPackInput["intent"]): AgentContextIntent {
  const parsed = agentContextIntentSchema.safeParse(intent ?? "general");
  return parsed.success ? parsed.data : "general";
}

function normalizeIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function hasScope(input: CompileAgentContextPackInput, scope: string): boolean {
  if ((input.authSurface ?? "api_key") !== "api_key") return true;
  return new Set(input.scopes ?? []).has(scope);
}

function addOmission(
  omitted: AgentContextOmittedSection[],
  item: AgentContextOmittedSection,
) {
  const exists = omitted.some((existing) =>
    existing.section === item.section &&
    existing.reason === item.reason &&
    existing.requiredScope === item.requiredScope &&
    existing.detail === item.detail
  );
  if (!exists) omitted.push(item);
}

function normalizeList(values: readonly string[] | null | undefined): string[] | null {
  if (!values) return null;
  const normalized = Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
  return normalized.length > 0 ? normalized : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function stringOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeAliases(values: readonly string[] | null | undefined): string[] {
  if (!values) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const alias = value.replace(/\s+/g, " ").trim();
    if (!alias) continue;
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(alias);
    if (normalized.length >= 32) break;
  }
  return normalized;
}

function buildCompanyProfileFields(company: AgentContextCompanyInput) {
  return {
    website: stringOrNull(company.website),
    businessType: stringOrNull(company.businessType),
    jurisdiction: stringOrNull(company.jurisdiction),
    entityType: stringOrNull(company.entityType),
    aliases: normalizeAliases(company.aliases),
    reportingCurrency: stringOrNull(company.reportingCurrency),
  };
}

type CompanyProfileFields = ReturnType<typeof buildCompanyProfileFields>;

function businessProfileAdditionsForPack(settings: Record<string, unknown> | null | undefined) {
  const context = getCompanyBusinessProfileAdditions(settings);
  return {
    ...context,
    status:
      context.marketResearchSummary ||
      context.targetMarkets.length > 0 ||
      context.customerSegments.length > 0 ||
      context.productLines.length > 0 ||
      context.competitorSeeds.length > 0 ||
      Boolean(context.notes)
        ? "populated" as const
        : "missing" as const,
  };
}

function sourceValue(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = stringOrNull(value);
    if (normalized) return normalized;
  }
  return null;
}

function truncateText(value: string | null | undefined, maxLength = 480): string | null {
  const normalized = stringOrNull(value);
  if (!normalized) return null;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}...`
    : normalized;
}

function sourceFileProvenance(
  file: AgentContextSourceFile,
  options?: {
    confidence?: AgentContextProvenance["confidence"] | null;
    updatedAt?: string | null;
    stale?: boolean;
  },
): AgentContextProvenance {
  return {
    source: "company_db",
    sourcePath: file.path,
    sourceId: file.frontmatter.id,
    updatedAt:
      normalizeIso(options?.updatedAt ?? null) ??
      getAgentContextSourceFileUpdatedAt(file),
    confidence: options?.stale ? "low" : options?.confidence ?? file.frontmatter.confidence,
  };
}

function sourceFileTags(
  file: AgentContextSourceFile,
  tags?: readonly string[] | null,
): string[] {
  return uniqueStrings([
    "agent-context-source-file",
    ...file.frontmatter.tags,
    ...(tags ?? []),
  ]).slice(0, 8);
}

function sourceFileItemId(prefix: string, file: AgentContextSourceFile, suffix?: string | null): string {
  const normalized = `${file.frontmatter.id}${suffix ? `-${suffix}` : ""}`
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${prefix}-${normalized || "source-file"}`;
}

function sourceFileMatchesResolvedCompany(
  file: AgentContextSourceFile,
  company: AgentContextCompanyInput,
): boolean {
  return isAgentContextSourceFileForCompany(file, {
    companyId: company.id,
    companySlug: company.slug ?? null,
  });
}

function activeSourceFilesForPack(
  input: CompileAgentContextPackInput,
): AgentContextSourceFile[] {
  if (!hasScope(input, "company_db.read")) return [];
  return (input.agentContextSourceFiles ?? [])
    .filter((file) =>
      file.frontmatter.status === "active" &&
      sourceFileMatchesResolvedCompany(file, input.company)
    )
    .sort((left, right) => left.path.localeCompare(right.path))
    .slice(0, 24);
}

function sourceProfileFieldsForPack(
  file: AgentContextSourceFile,
  runtimeFields: CompanyProfileFields,
): CompanyProfileFields | null {
  const profile = file.frontmatter.profile;
  if (!profile) return null;

  const aliases = normalizeAliases(profile.aliases ?? []);
  const fields = {
    website: runtimeFields.website ?? sourceValue(profile.website),
    businessType:
      runtimeFields.businessType ??
      sourceValue(profile.businessType, profile.business_type),
    jurisdiction: runtimeFields.jurisdiction ?? sourceValue(profile.jurisdiction),
    entityType:
      runtimeFields.entityType ??
      sourceValue(profile.entityType, profile.entity_type),
    aliases: runtimeFields.aliases.length > 0 ? runtimeFields.aliases : aliases,
    reportingCurrency:
      runtimeFields.reportingCurrency ??
      sourceValue(profile.reportingCurrency, profile.reporting_currency),
  };

  return fields.website ||
    fields.businessType ||
    fields.jurisdiction ||
    fields.entityType ||
    fields.aliases.length > 0 ||
    fields.reportingCurrency
    ? fields
    : null;
}

function sourceProfileConflicts(
  file: AgentContextSourceFile,
  runtimeFields: CompanyProfileFields,
): string[] {
  const profile = file.frontmatter.profile;
  if (!profile) return [];
  const checks: Array<[string, string | null, string | null]> = [
    ["website", runtimeFields.website, sourceValue(profile.website)],
    ["businessType", runtimeFields.businessType, sourceValue(profile.businessType, profile.business_type)],
    ["jurisdiction", runtimeFields.jurisdiction, sourceValue(profile.jurisdiction)],
    ["entityType", runtimeFields.entityType, sourceValue(profile.entityType, profile.entity_type)],
    ["reportingCurrency", runtimeFields.reportingCurrency, sourceValue(profile.reportingCurrency, profile.reporting_currency)],
  ];
  return checks
    .filter(([, runtimeValue, sourceFileValue]) => {
      if (!runtimeValue || !sourceFileValue) return false;
      return runtimeValue.toLowerCase() !== sourceFileValue.toLowerCase();
    })
    .map(([field]) => field);
}

function isProviderUseAllowed(
  company: AgentContextCompanyInput,
  provider: string,
): boolean {
  if (!company.allowedConnectorScopes) return true;
  const requiredScopes = getConnectorUseScopes(provider);
  if (requiredScopes.length === 0) return true;
  const allowed = new Set(company.allowedConnectorScopes);
  return requiredScopes.some((scope) => allowed.has(scope));
}

function sanitizeConnectorLastError(value: string | null | undefined): string | null {
  if (!value) return null;
  return "Connector reported an error; inspect the authorized connector surface for details.";
}

function addCompanyProfile(
  sections: MutableSections,
  company: AgentContextCompanyInput,
  compiledAt: string,
) {
  const description = getCompanyDescription(company.settings);
  const fields = buildCompanyProfileFields(company);
  const businessProfileAdditions = businessProfileAdditionsForPack(company.settings);
  sections.companyProfile.push({
    id: "company-profile",
    kind: "company_profile",
    title: "Resolved company scope",
    body: [
      `${company.name}${company.slug ? ` (${company.slug})` : ""}`,
      company.role ? `role=${company.role}` : null,
      company.accessSource ? `access=${company.accessSource}` : null,
      `website=${fields.website ?? "not set"}`,
      `businessType=${fields.businessType ?? "not set"}`,
      `jurisdiction=${fields.jurisdiction ?? "not set"}`,
      `entityType=${fields.entityType ?? "not set"}`,
      `aliases=${fields.aliases.length > 0 ? fields.aliases.join(", ") : "none"}`,
      `reportingCurrency=${fields.reportingCurrency ?? "not set"}`,
      description ? `description=${description}` : null,
      `businessProfileAdditions=${businessProfileAdditions.status}`,
      `competitorSeeds=${businessProfileAdditions.competitorSeeds.length}`,
    ].filter((part): part is string => Boolean(part)).join("; "),
    tags: ["company", "scope"],
    fields,
    businessProfileAdditions,
    provenance: {
      source: description || businessProfileAdditions.status === "populated" ? "company_settings" : "runtime_input",
      sourcePath: description
        ? "company.settings.companyDescription"
        : businessProfileAdditions.status === "populated"
          ? "company.settings.businessProfileAdditions"
          : undefined,
      updatedAt: compiledAt,
      confidence: description || businessProfileAdditions.status === "populated" ? "medium" : "high",
    },
  });

  if (company.allowedDomains || company.domainAccessLevels) {
    sections.companyProfile.push({
      id: "domain-access-summary",
      kind: "company_profile",
      title: "Domain access mask",
      body: `allowedDomains=${company.allowedDomains?.join(", ") ?? "all"}; accessLevels=${JSON.stringify(company.domainAccessLevels ?? null)}`,
      tags: ["access", "domains"],
      provenance: {
        source: "runtime_input",
        updatedAt: compiledAt,
        confidence: "high",
      },
    });
  }
}

function addFinanceSourceMap(
  sections: MutableSections,
  input: CompileAgentContextPackInput,
  compiledAt: string,
) {
  const provenance = builtInProvenance("docs/architecture/agent-context-layer.md#source-map", compiledAt);
  const odooAllowed = isProviderUseAllowed(input.company, "odoo");
  const sourceMaps = [
    {
      id: "finance-recognized-revenue",
      claimType: "recognized_revenue",
      title: "Recognized revenue",
      body: odooAllowed
        ? "Use Odoo GL, canonical finance statements, or Company-DB finance evidence before quoting recognized revenue."
        : "Use canonical finance statements or Company-DB finance evidence before quoting recognized revenue; Odoo live use is not allowed in the current connector scope.",
      preferredSource: odooAllowed
        ? "Odoo GL or canonical finance statements"
        : "canonical finance statements or Company-DB finance summaries",
      fallbackSource: "Company-DB finance summaries with source document evidence",
      forbiddenShortcut: "Do not answer recognized revenue from cash, scans, or partial ticketing rows.",
    },
    {
      id: "finance-cash-received",
      claimType: "cash_received",
      title: "Cash received or paid",
      body: "Cash questions require bank, payment, reconciliation, or bank-balance evidence.",
      preferredSource: "bank/payment/reconciliation evidence",
      fallbackSource: "canonical bank balances and cash-flow documents",
      forbiddenShortcut: "Do not answer cash questions from accrual P&L or invoice totals.",
    },
    {
      id: "finance-documents",
      claimType: "finance_documents",
      title: "Historical finance evidence",
      body: "Use Company-DB finance summaries and drill down to source documents when the question is historical or imported.",
      preferredSource: "Company-DB finance summaries",
      fallbackSource: "document source files and report artifacts",
      forbiddenShortcut: "Do not load full document bodies into the default pack.",
    },
  ];

  for (const item of sourceMaps) {
    sections.sourceMap.push({
      ...item,
      kind: "source_map",
      verificationRequired: true,
      tags: ["finance", "general"],
      provenance,
    });
  }
}

function addRules(
  sections: MutableSections,
  compiledAt: string,
  intent: AgentContextIntent,
) {
  const provenance = builtInProvenance("app/api/agent/session/route.ts#guidance", compiledAt);
  const rules = [
    {
      id: "finance-state-basis",
      title: "State finance basis",
      body: "Before quoting finance numbers, state source, period, currency, and basis.",
      tags: ["finance", "basis"],
    },
    {
      id: "odoo-accrual-not-cash",
      title: "Odoo accrual is not cash",
      body: "Odoo GL and P&L evidence are accrual or recognized accounting views unless a verified cash source says otherwise.",
      tags: ["finance", "odoo", "cash"],
    },
    {
      id: "resolve-named-target",
      title: "Resolve named target first",
      body: "If the user names a company, project, venue, partner, or legal entity that differs from the active company, resolve scope before answering.",
      tags: ["scope", "entities"],
    },
  ];

  if (intent === "legal") {
    rules.push(
      {
        id: "legal-watch-approved-company-db-first",
        title: "Use approved legal watch records first",
        body: "For BKPM Legal Watch answers, use approved Company-DB legal/watch content first and state source, jurisdiction, source or retrieved date, review status, and confidence or uncertainty.",
        tags: ["legal", "legal-watch", "company-db"],
      },
      {
        id: "legal-watch-unreviewed-caveat",
        title: "Caveat unreviewed legal observations",
        body: "Pending Legal Watch findings are review candidates, not legal advice; do not present unreviewed observations as approved legal facts.",
        tags: ["legal", "legal-watch", "review"],
      },
    );
  }

  for (const rule of rules) {
    sections.rules.push({
      ...rule,
      kind: "caveat",
      severity: rule.id.includes("counter") || rule.id.includes("cash") ? "critical" : "warning",
      provenance,
    });
  }

  for (const item of [
    "Do not use Obsidian or manual notes as source truth.",
    "Do not answer cash questions from accrual data.",
    "Do not load raw connector payloads, raw sidecars, or full document bodies into default context.",
    "Do not treat connector absence as absence of company knowledge; check Company-DB when allowed.",
  ]) {
    sections.mustNotDo.push({
      id: `must-not-${sections.mustNotDo.length + 1}`,
      kind: "must_not_do",
      title: item,
      body: item,
      tags: ["guardrail"],
      severity: "critical",
      provenance: builtInProvenance("docs/architecture/agent-context-layer.md#must-not-do", compiledAt),
    });
  }
}

function recordLinkedNames(record: OperatingEntityRecord, ids: readonly string[]): string[] {
  const registry = getOperatingEntityRegistry();
  return ids
    .map((id) => registry.recordsById.get(id)?.canonicalName ?? registry.legalEntityNamesById.get(id))
    .filter((value): value is string => Boolean(value));
}

function sourceMappingsForContext(record: OperatingEntityRecord) {
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
  const mappings = sourceMappingsForContext(record);
  return uniqueStrings([
    mappings.odoo.company ? `odoo.company:${mappings.odoo.company}` : "",
    ...mappings.odoo.analyticAccounts.map((value) => `odoo.analytic:${value}`),
    ...mappings.odoo.posConfigs.map((value) => `odoo.pos:${value}`),
    ...mappings.odoo.accounts.map((value) => `odoo.account:${value}`),
    ...mappings.odoo.partners.map((value) => `odoo.partner:${value}`),
    ...mappings.customMcp.tools.map((value) => `customMcp.tool:${value}`),
  ]).slice(0, 16);
}

function addOperatingEntities(
  sections: MutableSections,
  input: CompileAgentContextPackInput,
  compiledAt: string,
) {
  const maxOperatingEntities = input.maxOperatingEntities ?? DEFAULT_MAX_OPERATING_ENTITIES;
  const records = new Map<string, OperatingEntityRecord>();

  for (const match of resolveOperatingEntities(input.query || input.company.name, { limit: 4 })) {
    records.set(match.record.id, match.record);
  }

  const limited = Array.from(records.values()).slice(0, maxOperatingEntities);
  const provenance: AgentContextProvenance = {
    source: "operating_entity_registry",
    sourcePath: "lib/operating-entities/registry.ts",
    updatedAt: compiledAt,
    confidence: "medium",
  };

  for (const record of limited) {
    const searchTerms = Array.from(
      new Set([
        record.canonicalName,
        ...record.aliases,
        ...(record.sourceMappings.companyDb?.queryAliases ?? []),
        ...expandOperatingEntitySearchTerms(record.canonicalName, { limit: 1 }),
      ].filter(Boolean)),
    ).slice(0, 12);
    const sourceMappings = sourceMappingsForContext(record);
    const connectorHints = connectorSearchHints(record);
    sections.operatingEntities.push({
      id: `operating-entity-${record.id}`,
      kind: "operating_entity",
      title: record.canonicalName,
      body: `${record.objectType}; aliases=${record.aliases.slice(0, 8).join(", ") || "none"}; grants_data_access=false`,
      tags: ["operating-entity", ...record.tags.slice(0, 4)],
      operatingEntityId: record.id,
      canonicalName: record.canonicalName,
      aliases: record.aliases.slice(0, 12),
      objectType: record.objectType,
      status: record.status,
      confidence: record.confidence,
      legalEntities: recordLinkedNames(record, record.legalEntityIds),
      parentEntities: recordLinkedNames(record, record.parentIds),
      partnerEntities: recordLinkedNames(record, record.partnerIds),
      searchTerms,
      companyDbSearchTerms: uniqueStrings([
        ...searchTerms,
        ...(sourceMappings.companyDb.queryAliases ?? []),
      ]).slice(0, 16),
      connectorSearchHints: connectorHints,
      sourceMappings,
      grantsDataAccess: false,
      provenance,
    });
  }
}

function addConnectorFreshness(
  sections: MutableSections,
  omitted: AgentContextOmittedSection[],
  input: CompileAgentContextPackInput,
  compiledAt: string,
) {
  if (!hasScope(input, "connectors.read")) {
    omitted.push({
      section: "freshness",
      reason: "missing_scope",
      requiredScope: "connectors.read",
      detail: "Connector status and freshness require connectors.read.",
    });
    return;
  }

  if (input.connectorSnapshotsUnavailable) {
    omitted.push({
      section: "freshness",
      reason: "unavailable",
      detail: input.connectorSnapshotsUnavailable,
    });
    return;
  }

  const relevantProviders = ["odoo", "google_drive", "email_ingest"];
  const snapshots = new Map(
    (input.connectorSnapshots ?? []).map((snapshot) => [snapshot.provider, snapshot]),
  );
  const nowMs = (input.now ?? new Date()).getTime();

  for (const provider of relevantProviders) {
    const snapshot = snapshots.get(provider);
    const providerAllowed = isProviderUseAllowed(input.company, provider);
    const expectedSyncIntervalMs =
      snapshot?.expectedSyncIntervalMs ?? getConnectorExpectedSyncIntervalMs(provider);
    const lastSyncedAt = providerAllowed ? normalizeIso(snapshot?.lastSyncAt ?? null) : null;
    const lastSyncMs = providerAllowed && lastSyncedAt ? new Date(lastSyncedAt).getTime() : null;
    const stale =
      expectedSyncIntervalMs && lastSyncMs
        ? nowMs - lastSyncMs > expectedSyncIntervalMs * 2
        : false;
    const status = !providerAllowed
      ? "blocked"
      : !snapshot
        ? "missing"
        : snapshot.lastError
        ? "failed"
        : stale
          ? "stale"
          : snapshot.status === "active"
            ? "active"
            : "configured";

    sections.freshness.push({
      id: `connector-${provider}`,
      kind: "freshness",
      title: providerAllowed ? snapshot?.label ?? provider : provider,
      body: !providerAllowed
        ? `${provider} connector use is blocked by allowedConnectorScopes. Runtime connection status, lastSyncAt, and lastError are intentionally not exposed.`
        : snapshot
        ? `${provider} connector status=${snapshot.status ?? "unknown"}${lastSyncedAt ? `; lastSyncAt=${lastSyncedAt}` : ""}`
        : `${provider} connector is not present in the provided connector snapshot.`,
      tags: ["connector", provider],
      sourceKey: `connector:${provider}`,
      provider,
      status,
      lastSyncedAt,
      lastError: providerAllowed
        ? sanitizeConnectorLastError(snapshot?.lastError)
        : null,
      expectedSyncIntervalMs,
      provenance: {
        source: snapshot && providerAllowed ? "runtime_input" : "connector_registry",
        sourcePath: snapshot && providerAllowed ? undefined : "lib/connectors/provider-registry.ts",
        updatedAt: compiledAt,
        confidence: snapshot && providerAllowed ? "high" : "medium",
      },
    });
  }
}

function addCoverageFreshness(
  sections: MutableSections,
  omitted: AgentContextOmittedSection[],
  input: CompileAgentContextPackInput,
  compiledAt: string,
) {
  if (hasScope(input, "company_db.read")) {
    if (input.companyDbSnapshot) {
      sections.freshness.push({
        id: "company-db-coverage",
        kind: "freshness",
        title: "Company-DB coverage",
        body: [
          `Company-DB status=${input.companyDbSnapshot.status}`,
          input.companyDbSnapshot.domains?.length
            ? `domains=${input.companyDbSnapshot.domains.join(", ")}`
            : null,
          input.companyDbSnapshot.detail ?? null,
        ].filter((part): part is string => Boolean(part)).join("; "),
        tags: ["company-db", "coverage"],
        sourceKey: "company_db",
        provider: null,
        status: input.companyDbSnapshot.status,
        lastSyncedAt: normalizeIso(input.companyDbSnapshot.summaryFreshnessAt ?? null),
        lastError: input.companyDbSnapshot.status === "failed"
          ? input.companyDbSnapshot.detail ?? "Company-DB coverage failed"
          : null,
        expectedSyncIntervalMs: null,
        provenance: {
          source: "runtime_input",
          updatedAt: compiledAt,
          confidence: "high",
        },
      });
    } else {
      omitted.push({
        section: "companyDbEvidence",
        reason: "unavailable",
        detail: "No Company-DB summary freshness snapshot was provided to the local compiler.",
      });
    }
  }

  if (hasScope(input, "documents.read")) {
    if (input.documentQuestionsSnapshot) {
      const openCount = input.documentQuestionsSnapshot.openCount;
      if (openCount > 0) {
        sections.dataGaps.push({
          id: "open-document-questions",
          kind: "data_gap",
          title: "Open Document Questions",
          body: `${openCount} document question${openCount === 1 ? "" : "s"} still need answers before related evidence is decision-grade.`,
          tags: ["documents", "coverage"],
          severity: "warning",
          provenance: {
            source: "runtime_input",
            updatedAt: normalizeIso(input.documentQuestionsSnapshot.oldestCreatedAt ?? null) ?? compiledAt,
            confidence: "high",
          },
        });
      } else {
        sections.freshness.push({
          id: "document-question-coverage",
          kind: "freshness",
          title: "Document Questions",
          body: "No open Document Questions were provided in the compiler snapshot.",
          tags: ["documents", "coverage"],
          sourceKey: "document_questions",
          provider: null,
          status: "active",
          lastSyncedAt: null,
          lastError: null,
          expectedSyncIntervalMs: null,
          provenance: {
            source: "runtime_input",
            updatedAt: compiledAt,
            confidence: "medium",
          },
        });
      }
    } else {
      omitted.push({
        section: "dataGaps",
        reason: "unavailable",
        detail: "No Document Questions snapshot was provided to the local compiler.",
      });
    }
  }

  if (input.reportJobSnapshot) {
    sections.freshness.push({
      id: "report-job-coverage",
      kind: "freshness",
      title: "Report-job coverage",
      body: [
        `reportJobs=${input.reportJobSnapshot.status}`,
        typeof input.reportJobSnapshot.pendingCount === "number"
          ? `pending=${input.reportJobSnapshot.pendingCount}`
          : null,
        typeof input.reportJobSnapshot.failedCount === "number"
          ? `failed=${input.reportJobSnapshot.failedCount}`
          : null,
      ].filter((part): part is string => Boolean(part)).join("; "),
      tags: ["report-jobs", "coverage"],
      sourceKey: "report_jobs",
      provider: null,
      status: input.reportJobSnapshot.status,
      lastSyncedAt: normalizeIso(input.reportJobSnapshot.latestCompletedAt ?? null),
      lastError: input.reportJobSnapshot.status === "failed"
        ? "Recent report-job failures were reported in the compiler snapshot."
        : null,
      expectedSyncIntervalMs: null,
      provenance: {
        source: "runtime_input",
        updatedAt: compiledAt,
        confidence: "medium",
      },
    });
  }
}

function addAgentContextSourceFiles(
  sections: MutableSections,
  omitted: AgentContextOmittedSection[],
  warnings: string[],
  input: CompileAgentContextPackInput,
  compiledAt: string,
  runtimeProfileFields: CompanyProfileFields,
) {
  if (input.agentContextSourceFilesUnavailable) {
    addOmission(omitted, {
      section: "companyDbEvidence",
      reason: "unavailable",
      detail: input.agentContextSourceFilesUnavailable,
    });
    return;
  }

  if (!input.agentContextSourceFiles?.length) return;

  if (!hasScope(input, "company_db.read")) {
    addOmission(omitted, {
      section: "companyDbEvidence",
      reason: "missing_scope",
      requiredScope: "company_db.read",
      detail: "Agent Context source files require company_db.read.",
    });
    return;
  }

  for (const file of input.agentContextSourceFiles) {
    if (!sourceFileMatchesResolvedCompany(file, input.company)) {
      warnings.push(`Ignored Agent Context source file outside resolved company scope: ${file.path}.`);
      continue;
    }
    if (file.frontmatter.status !== "active") {
      warnings.push(`Ignored inactive Agent Context source file: ${file.path}.`);
      continue;
    }

    const stale = isAgentContextSourceFileStale(file, input.now ?? new Date());
    if (stale) addSourceFileStalenessGap(sections, file, compiledAt);

    addSourceFileProfile(sections, file, runtimeProfileFields, stale);
    addSourceFileSourceMaps(sections, warnings, file, stale);
    addSourceFileRules(sections, warnings, file, stale);
    addSourceFileFreshness(sections, warnings, file, stale);
    addSourceFileEntityAliases(sections, warnings, file, stale);
  }
}

function addSourceFileStalenessGap(
  sections: MutableSections,
  file: AgentContextSourceFile,
  compiledAt: string,
) {
  const id = sourceFileItemId("stale-agent-context-source", file);
  if (sections.dataGaps.some((item) => item.id === id)) return;

  sections.dataGaps.push({
    id,
    kind: "data_gap",
    title: `Stale Agent Context source: ${file.frontmatter.title}`,
    body: `Manual context source ${file.path} is stale_after=${file.frontmatter.stale_after}; treat it as a hint and re-check source systems or Company-DB evidence before using it.`,
    tags: sourceFileTags(file, ["stale"]),
    severity: "warning",
    provenance: sourceFileProvenance(file, {
      updatedAt: compiledAt,
      stale: true,
    }),
  });
}

function addSourceFileProfile(
  sections: MutableSections,
  file: AgentContextSourceFile,
  runtimeProfileFields: CompanyProfileFields,
  stale: boolean,
) {
  if (file.frontmatter.kind !== "profile" || !file.frontmatter.profile) return;
  const fields = sourceProfileFieldsForPack(file, runtimeProfileFields);
  const conflicts = sourceProfileConflicts(file, runtimeProfileFields);

  if (conflicts.length > 0) {
    const id = sourceFileItemId("agent-context-profile-conflict", file);
    if (!sections.dataGaps.some((item) => item.id === id)) {
      sections.dataGaps.push({
        id,
        kind: "data_gap",
        title: `Profile source conflicts: ${file.frontmatter.title}`,
        body: `Agent Context source file ${file.path} differs from runtime company profile for ${conflicts.join(", ")}. Runtime company profile remains authoritative.`,
        tags: sourceFileTags(file, ["company-profile", "conflict"]),
        severity: "warning",
        provenance: sourceFileProvenance(file, { stale }),
      });
    }
  }

  sections.companyProfile.push({
    id: sourceFileItemId("agent-context-profile-source", file),
    kind: "company_profile",
    title: file.frontmatter.title,
    body: [
      "Company-DB Agent Context profile source.",
      "Runtime company profile storage remains authoritative.",
      truncateText(file.body),
    ].filter((part): part is string => Boolean(part)).join(" "),
    tags: sourceFileTags(file, ["company-profile"]),
    ...(fields ? { fields } : {}),
    provenance: sourceFileProvenance(file, { stale }),
  });
}

function addSourceFileSourceMaps(
  sections: MutableSections,
  warnings: string[],
  file: AgentContextSourceFile,
  stale: boolean,
) {
  file.frontmatter.source_maps.forEach((item, index) => {
    const normalized = normalizeSourceMapSpec(item, index);
    if (!normalized) return;

    if (sections.sourceMap.some((existing) => existing.claimType === normalized.claimType)) {
      warnings.push(
        `Ignored Agent Context source-map override for ${normalized.claimType} from ${file.path}; existing verified/built-in mapping remains authoritative.`,
      );
      return;
    }

    sections.sourceMap.push({
      id: sourceFileItemId("agent-context-source-map", file, normalized.id),
      kind: "source_map",
      title: normalized.title,
      body: normalized.body,
      tags: sourceFileTags(file, normalized.tags),
      claimType: normalized.claimType,
      preferredSource: normalized.preferredSource,
      fallbackSource: normalized.fallbackSource,
      verificationRequired: normalized.verificationRequired,
      forbiddenShortcut: normalized.forbiddenShortcut,
      provenance: sourceFileProvenance(file, {
        confidence: normalized.confidence,
        updatedAt: normalized.updatedAt,
        stale,
      }),
    });
  });
}

function addSourceFileRules(
  sections: MutableSections,
  warnings: string[],
  file: AgentContextSourceFile,
  stale: boolean,
) {
  const specs: Array<{ item: AgentContextRuleSpec; fallbackKind: "rule" | "caveat" }> = [
    ...file.frontmatter.rules.map((item) => ({ item, fallbackKind: "rule" as const })),
    ...file.frontmatter.caveats.map((item) => ({ item, fallbackKind: "caveat" as const })),
  ];

  specs.forEach(({ item, fallbackKind }, index) => {
    const normalized = normalizeRuleSpec(item, fallbackKind, index);
    if (!normalized) return;

    const target = normalized.kind === "must_not_do" ? sections.mustNotDo : sections.rules;
    if (target.some((existing) => existing.id === normalized.id)) {
      warnings.push(`Ignored duplicate Agent Context rule ${normalized.id} from ${file.path}.`);
      return;
    }

    target.push({
      id: normalized.id,
      kind: normalized.kind,
      title: normalized.title,
      body: normalized.body,
      tags: sourceFileTags(file, normalized.tags),
      severity: normalized.severity,
      provenance: sourceFileProvenance(file, {
        confidence: normalized.confidence,
        updatedAt: normalized.updatedAt,
        stale,
      }),
    });
  });
}

function addSourceFileFreshness(
  sections: MutableSections,
  warnings: string[],
  file: AgentContextSourceFile,
  stale: boolean,
) {
  file.frontmatter.freshness_notes.forEach((item, index) => {
    const normalized = normalizeFreshnessNoteSpec(item, index);
    if (!normalized) return;

    if (sections.freshness.some((existing) => existing.sourceKey === normalized.sourceKey)) {
      warnings.push(
        `Ignored Agent Context freshness override for ${normalized.sourceKey} from ${file.path}; runtime freshness remains authoritative.`,
      );
      return;
    }

    sections.freshness.push({
      id: sourceFileItemId("agent-context-freshness", file, normalized.id),
      kind: "freshness",
      title: normalized.title,
      body: normalized.body,
      tags: sourceFileTags(file, normalized.tags),
      sourceKey: normalized.sourceKey,
      provider: normalized.provider,
      status: stale ? "stale" : normalized.status,
      lastSyncedAt: normalizeIso(normalized.lastSyncedAt),
      lastError: normalized.lastError
        ? "Manual context source reported an issue; inspect the source file for details."
        : null,
      expectedSyncIntervalMs: normalized.expectedSyncIntervalMs,
      provenance: sourceFileProvenance(file, {
        confidence: normalized.confidence,
        updatedAt: normalized.updatedAt,
        stale,
      }),
    });
  });
}

function addSourceFileEntityAliases(
  sections: MutableSections,
  warnings: string[],
  file: AgentContextSourceFile,
  stale: boolean,
) {
  file.frontmatter.entity_aliases.forEach((item, index) => {
    const normalized = normalizeEntityAliasSpec(item, index);
    if (!normalized) return;
    const id = sourceFileItemId("agent-context-entity-alias", file, normalized.id);

    if (sections.operatingEntities.some((existing) => existing.id === id)) {
      warnings.push(`Ignored duplicate Agent Context entity alias ${id} from ${file.path}.`);
      return;
    }

    const searchTerms = uniqueStrings([normalized.canonicalName, ...normalized.aliases]).slice(0, 12);
    sections.operatingEntities.push({
      id,
      kind: "operating_entity",
      title: normalized.canonicalName,
      body: `${normalized.objectType}; aliases=${normalized.aliases.join(", ") || "none"}; grants_data_access=false; source_file_context_only=true`,
      tags: sourceFileTags(file, normalized.tags),
      operatingEntityId: normalized.operatingEntityId,
      canonicalName: normalized.canonicalName,
      aliases: normalized.aliases,
      objectType: normalized.objectType,
      status: normalized.status,
      confidence: stale ? "low" : normalized.confidence,
      legalEntities: [],
      parentEntities: [],
      partnerEntities: [],
      searchTerms,
      companyDbSearchTerms: searchTerms,
      connectorSearchHints: [],
      sourceMappings: {
        companyDb: { folders: [], queryAliases: [] },
        odoo: { company: null, analyticAccounts: [], posConfigs: [], accounts: [], partners: [] },
        customMcp: { tools: [] },
      },
      grantsDataAccess: false,
      provenance: sourceFileProvenance(file, {
        confidence: normalized.confidence,
        updatedAt: normalized.updatedAt,
        stale,
      }),
    });
  });
}

function normalizeSourceMapSpec(item: AgentContextSourceMapSpec, index: number) {
  const claimType = sourceValue(item.claimType, item.claim_type);
  const preferredSource = sourceValue(item.preferredSource, item.preferred_source);
  if (!claimType || !preferredSource) return null;

  return {
    id: sourceValue(item.id) ?? `${index + 1}`,
    claimType,
    title: sourceValue(item.title) ?? claimType,
    body: truncateText(item.body, 720) ?? `Use ${preferredSource} for ${claimType}.`,
    preferredSource,
    fallbackSource: sourceValue(item.fallbackSource, item.fallback_source),
    verificationRequired: item.verificationRequired ?? item.verification_required ?? true,
    forbiddenShortcut: sourceValue(item.forbiddenShortcut, item.forbidden_shortcut),
    tags: item.tags ?? [],
    confidence: item.confidence,
    updatedAt: sourceValue(item.updatedAt, item.updated_at),
  };
}

function normalizeRuleSpec(
  item: AgentContextRuleSpec,
  fallbackKind: "rule" | "caveat",
  index: number,
) {
  const body = truncateText(item.body, 720);
  if (!body) return null;
  const kind = item.kind ?? fallbackKind;
  const id = sourceValue(item.id) ?? `source-file-${kind}-${index + 1}`;

  return {
    id,
    kind,
    title: sourceValue(item.title) ?? id,
    body,
    severity: item.severity ?? "warning",
    tags: item.tags ?? [],
    confidence: item.confidence,
    updatedAt: sourceValue(item.updatedAt, item.updated_at),
  };
}

function normalizeFreshnessNoteSpec(item: AgentContextFreshnessNoteSpec, index: number) {
  const sourceKey = sourceValue(item.sourceKey, item.source_key);
  if (!sourceKey) return null;

  return {
    id: sourceValue(item.id) ?? `${index + 1}`,
    sourceKey,
    provider: sourceValue(item.provider),
    title: sourceValue(item.title) ?? sourceKey,
    body: truncateText(item.body, 720) ?? `Manual context freshness note for ${sourceKey}.`,
    status: item.status ?? "unknown" as const,
    lastSyncedAt: sourceValue(item.lastSyncedAt, item.last_synced_at),
    lastError: sourceValue(item.lastError, item.last_error),
    expectedSyncIntervalMs: item.expectedSyncIntervalMs ?? item.expected_sync_interval_ms ?? null,
    tags: item.tags ?? [],
    confidence: item.confidence,
    updatedAt: sourceValue(item.updatedAt, item.updated_at),
  };
}

function normalizeEntityAliasSpec(item: AgentContextEntityAliasSpec, index: number) {
  const canonicalName = sourceValue(item.canonicalName, item.canonical_name);
  if (!canonicalName) return null;

  const aliases = normalizeAliases(item.aliases ?? []).slice(0, 12);
  const id = sourceValue(item.id) ?? `${index + 1}`;
  return {
    id,
    operatingEntityId:
      sourceValue(item.operatingEntityId, item.operating_entity_id) ??
      `source-file:${id}`,
    canonicalName,
    aliases,
    objectType: sourceValue(item.objectType, item.object_type) ?? "operating_object",
    status: sourceValue(item.status) ?? "manual_context",
    tags: item.tags ?? [],
    confidence: item.confidence ?? "medium" as const,
    updatedAt: sourceValue(item.updatedAt, item.updated_at),
  };
}

function addRecommendedWorkflow(
  sections: MutableSections,
  intent: AgentContextIntent,
  compiledAt: string,
) {
  const finance = intent === "finance" || intent === "reporting";
  const steps = finance
    ? [
        ["Resolve scope", "Resolve named company, operating entity, project, partner, or legal entity before retrieving data.", "resolve_workflow"],
        ["Check Company-DB", "Use Company-DB summaries and evidence pointers for historical or imported finance knowledge.", "company_db"],
        ["Use report jobs", "For report-scale finance work, create a report job instead of looping raw Odoo calls inline.", "create_report_job"],
        ["Use narrow connector calls", "Use direct connector actions only for explicit narrow live lookups.", "agent_connectors"],
        ["State basis", "State source, period, currency, and basis before the number.", null],
      ]
    : [
        ["Resolve scope", "Resolve named company or operating object before answering.", "resolve_workflow"],
        ["Check compact knowledge", "Use Company-DB summaries before live connectors unless the user asked for live data.", "company_db"],
        ["Drill down explicitly", "Use connector or file drill-down only when the compact pack is insufficient.", null],
      ];

  steps.forEach(([title, body, toolHint], index) => {
    sections.recommendedWorkflow.push({
      id: `workflow-${index + 1}`,
      kind: "workflow_step",
      order: index + 1,
      title: title ?? `Step ${index + 1}`,
      body: body ?? "",
      toolHint,
      tags: [finance ? "finance" : "general"],
      provenance: {
        source: "workflow_policy",
        sourcePath: "docs/architecture/agent-context-layer.md#recommended-workflow",
        updatedAt: compiledAt,
        confidence: "high",
      },
    });
  });
}

function addScopeOmissions(
  omitted: AgentContextOmittedSection[],
  input: CompileAgentContextPackInput,
) {
  if (!hasScope(input, "company_db.read")) {
    addOmission(omitted, {
      section: "companyDbEvidence",
      reason: "missing_scope",
      requiredScope: "company_db.read",
      detail: "Company-DB summaries and evidence pointers require company_db.read.",
    });
  }
  if (!hasScope(input, "documents.read")) {
    addOmission(omitted, {
      section: "dataGaps",
      reason: "missing_scope",
      requiredScope: "documents.read",
      detail: "Open Document Questions and document coverage require documents.read.",
    });
  }
}

function capSections(
  sections: MutableSections,
  maxItems: number,
  omitted: AgentContextOmittedSection[],
) {
  for (const key of Object.keys(sections) as Array<keyof MutableSections>) {
    if (sections[key].length <= maxItems) continue;
    sections[key] = sections[key].slice(0, maxItems) as never;
    omitted.push({
      section: key,
      reason: "budget",
      detail: `Section capped at ${maxItems} items.`,
    });
  }
}

export function compileAgentContextPack(input: CompileAgentContextPackInput): AgentContextPack {
  const intent = normalizeIntent(input.intent);
  const compiledAt = (input.now ?? new Date()).toISOString();
  const maxItemsPerSection = input.maxItemsPerSection ?? DEFAULT_MAX_ITEMS_PER_SECTION;
  const company = input.company;
  const companyProfileFields = buildCompanyProfileFields(company);
  const businessProfileAdditions = businessProfileAdditionsForPack(company.settings);
  const sections: MutableSections = {
    companyProfile: [],
    sourceMap: [],
    operatingEntities: [],
    rules: [],
    freshness: [],
    recommendedWorkflow: [],
    dataGaps: [],
    mustNotDo: [],
  };
  const omitted: AgentContextOmittedSection[] = [...RAW_PAYLOAD_OMISSIONS];
  const warnings: string[] = [];

  addCompanyProfile(sections, company, compiledAt);
  addFinanceSourceMap(sections, input, compiledAt);
  addRules(sections, compiledAt, intent);
  addOperatingEntities(sections, input, compiledAt);
  addConnectorFreshness(sections, omitted, input, compiledAt);
  addCoverageFreshness(sections, omitted, input, compiledAt);
  addAgentContextSourceFiles(
    sections,
    omitted,
    warnings,
    input,
    compiledAt,
    companyProfileFields,
  );
  addRecommendedWorkflow(sections, intent, compiledAt);
  addScopeOmissions(omitted, input);

  if (intent === "finance") {
    warnings.push("No company-specific finance context pack rules exist yet; using generic finance rules.");
  }
  if (sections.operatingEntities.length === 0) {
    warnings.push("No operating entity hints matched the company or query.");
  }

  capSections(sections, maxItemsPerSection, omitted);

  return agentContextPackSchema.parse({
    version: AGENT_CONTEXT_PACK_VERSION,
    company: {
      id: company.id,
      slug: company.slug ?? null,
      name: company.name,
      profile: companyProfileFields,
      role: company.role ?? null,
      accessSource: company.accessSource ?? null,
      viaCompanyId: company.viaCompanyId ?? null,
      viaCompanyName: company.viaCompanyName ?? null,
      allowedDomains: normalizeList(company.allowedDomains),
      domainAccessLevels: company.domainAccessLevels ?? null,
      allowedConnectorScopes: normalizeList(company.allowedConnectorScopes),
    },
    intent,
    query: input.query?.trim() || null,
    compiledAt,
    budget: {
      maxItemsPerSection,
      maxOperatingEntities: input.maxOperatingEntities ?? DEFAULT_MAX_OPERATING_ENTITIES,
    },
    sections,
    omitted,
    warnings,
    sourceFingerprints: [
      `company:${company.id}:${company.slug ?? ""}`,
      `companyProfile:${JSON.stringify(companyProfileFields)}`,
      `businessProfileAdditions:${JSON.stringify(businessProfileAdditions)}`,
      `intent:${intent}`,
      `connectors:${(input.connectorSnapshots ?? []).map((snapshot) => `${snapshot.provider}:${snapshot.status ?? "unknown"}:${normalizeIso(snapshot.lastSyncAt) ?? ""}`).sort().join("|")}`,
      `agentContextSourceFiles:${activeSourceFilesForPack(input).map((file) => `${file.path}:${file.contentHash}`).join("|")}`,
    ],
  });
}
