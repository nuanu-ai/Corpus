import { z } from "zod";

export const AGENT_CONTEXT_PACK_VERSION = "2026-05-26";

export const agentContextIntentSchema = z.enum([
  "general",
  "finance",
  "operations",
  "documents",
  "legal",
  "people",
  "connector_live_lookup",
  "reporting",
]);

export type AgentContextIntent = z.infer<typeof agentContextIntentSchema>;

export const agentContextSectionSchema = z.enum([
  "companyProfile",
  "sourceMap",
  "operatingEntities",
  "rules",
  "freshness",
  "recommendedWorkflow",
  "dataGaps",
  "mustNotDo",
  "connectorSamples",
  "companyDbEvidence",
  "documentBodies",
]);

export type AgentContextSection = z.infer<typeof agentContextSectionSchema>;

export const agentContextOmissionReasonSchema = z.enum([
  "missing_scope",
  "not_applicable",
  "raw_payload",
  "budget",
  "unavailable",
  "out_of_scope",
]);

export const agentContextConfidenceSchema = z.enum(["low", "medium", "high"]);

export const agentContextProvenanceSchema = z.object({
  source: z.enum([
    "built_in",
    "company_settings",
    "company_db",
    "connector_registry",
    "runtime_input",
    "operating_entity_registry",
    "docs_contract",
    "workflow_policy",
  ]),
  sourcePath: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  updatedAt: z.string().min(1).nullable().optional(),
  confidence: agentContextConfidenceSchema,
});

export type AgentContextProvenance = z.infer<typeof agentContextProvenanceSchema>;

const baseItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  provenance: agentContextProvenanceSchema,
});

export const agentContextCompanyProfileFieldsSchema = z.object({
  website: z.string().min(1).nullable(),
  businessType: z.string().min(1).nullable(),
  jurisdiction: z.string().min(1).nullable(),
  entityType: z.string().min(1).nullable(),
  aliases: z.array(z.string().min(1)),
  reportingCurrency: z.string().min(1).nullable(),
});

export const agentContextManualCompetitorSchema = z.object({
  name: z.string().min(1),
  website: z.string().min(1).nullable(),
  note: z.string().min(1).nullable(),
});

export const agentContextBusinessProfileAdditionsSchema = z.object({
  version: z.literal(1),
  marketResearchSummary: z.string().min(1).nullable(),
  targetMarkets: z.array(z.string().min(1)),
  customerSegments: z.array(z.string().min(1)),
  productLines: z.array(z.string().min(1)),
  competitorSeeds: z.array(agentContextManualCompetitorSchema),
  notes: z.string().min(1).nullable(),
  source: z.enum(["settings_ui", "agent_api", "manual"]),
  updatedAt: z.string().min(1).nullable(),
  status: z.enum(["missing", "populated"]),
});

export const agentContextCompanyProfileItemSchema = baseItemSchema.extend({
  kind: z.literal("company_profile"),
  fields: agentContextCompanyProfileFieldsSchema.optional(),
  businessProfileAdditions: agentContextBusinessProfileAdditionsSchema.optional(),
});

export const agentContextSourceMapItemSchema = baseItemSchema.extend({
  kind: z.literal("source_map"),
  claimType: z.string().min(1),
  preferredSource: z.string().min(1),
  fallbackSource: z.string().min(1).nullable().default(null),
  verificationRequired: z.boolean(),
  forbiddenShortcut: z.string().min(1).nullable().default(null),
});

const agentContextOperatingSourceMappingsSchema = z.object({
  companyDb: z.object({
    folders: z.array(z.string().min(1)).default([]),
    queryAliases: z.array(z.string().min(1)).default([]),
  }).default({ folders: [], queryAliases: [] }),
  odoo: z.object({
    company: z.string().min(1).nullable().default(null),
    analyticAccounts: z.array(z.string().min(1)).default([]),
    posConfigs: z.array(z.string().min(1)).default([]),
    accounts: z.array(z.string().min(1)).default([]),
    partners: z.array(z.string().min(1)).default([]),
  }).default({
    company: null,
    analyticAccounts: [],
    posConfigs: [],
    accounts: [],
    partners: [],
  }),
  customMcp: z.object({
    tools: z.array(z.string().min(1)).default([]),
  }).default({ tools: [] }),
});

export const agentContextOperatingEntityItemSchema = baseItemSchema.extend({
  kind: z.literal("operating_entity"),
  operatingEntityId: z.string().min(1),
  canonicalName: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  objectType: z.string().min(1),
  status: z.string().min(1),
  confidence: agentContextConfidenceSchema,
  legalEntities: z.array(z.string().min(1)),
  parentEntities: z.array(z.string().min(1)),
  partnerEntities: z.array(z.string().min(1)),
  searchTerms: z.array(z.string().min(1)),
  companyDbSearchTerms: z.array(z.string().min(1)).default([]),
  connectorSearchHints: z.array(z.string().min(1)).default([]),
  sourceMappings: agentContextOperatingSourceMappingsSchema.default({
    companyDb: { folders: [], queryAliases: [] },
    odoo: {
      company: null,
      analyticAccounts: [],
      posConfigs: [],
      accounts: [],
      partners: [],
    },
    customMcp: { tools: [] },
  }),
  grantsDataAccess: z.literal(false).default(false),
});

export const agentContextRuleItemSchema = baseItemSchema.extend({
  kind: z.enum(["rule", "caveat", "must_not_do"]),
  severity: z.enum(["info", "warning", "critical"]).default("warning"),
});

export const agentContextFreshnessItemSchema = baseItemSchema.extend({
  kind: z.literal("freshness"),
  sourceKey: z.string().min(1),
  provider: z.string().min(1).nullable().default(null),
  status: z.enum(["active", "configured", "stale", "missing", "failed", "blocked", "unknown"]),
  lastSyncedAt: z.string().min(1).nullable().default(null),
  lastError: z.string().min(1).nullable().default(null),
  expectedSyncIntervalMs: z.number().int().positive().nullable().default(null),
});

export const agentContextWorkflowStepItemSchema = baseItemSchema.extend({
  kind: z.literal("workflow_step"),
  order: z.number().int().positive(),
  toolHint: z.string().min(1).nullable().default(null),
});

export const agentContextDataGapItemSchema = baseItemSchema.extend({
  kind: z.literal("data_gap"),
  severity: z.enum(["info", "warning", "critical"]).default("warning"),
});

export const agentContextSectionsSchema = z.object({
  companyProfile: z.array(agentContextCompanyProfileItemSchema),
  sourceMap: z.array(agentContextSourceMapItemSchema),
  operatingEntities: z.array(agentContextOperatingEntityItemSchema),
  rules: z.array(agentContextRuleItemSchema),
  freshness: z.array(agentContextFreshnessItemSchema),
  recommendedWorkflow: z.array(agentContextWorkflowStepItemSchema),
  dataGaps: z.array(agentContextDataGapItemSchema),
  mustNotDo: z.array(agentContextRuleItemSchema),
});

export type AgentContextSections = z.infer<typeof agentContextSectionsSchema>;

export const agentContextOmittedSectionSchema = z.object({
  section: agentContextSectionSchema,
  reason: agentContextOmissionReasonSchema,
  requiredScope: z.string().min(1).nullable().optional(),
  detail: z.string().min(1).nullable().optional(),
});

export type AgentContextOmittedSection = z.infer<typeof agentContextOmittedSectionSchema>;

export const agentContextCompanySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1).nullable(),
  name: z.string().min(1),
  profile: agentContextCompanyProfileFieldsSchema,
  role: z.string().min(1).nullable().default(null),
  accessSource: z.string().min(1).nullable().default(null),
  viaCompanyId: z.string().min(1).nullable().default(null),
  viaCompanyName: z.string().min(1).nullable().default(null),
  allowedDomains: z.array(z.string().min(1)).nullable().default(null),
  domainAccessLevels: z.record(z.string(), z.string()).nullable().default(null),
  allowedConnectorScopes: z.array(z.string().min(1)).nullable().default(null),
});

export const agentContextPackSchema = z.object({
  version: z.literal(AGENT_CONTEXT_PACK_VERSION),
  company: agentContextCompanySchema,
  intent: agentContextIntentSchema,
  query: z.string().min(1).nullable().default(null),
  compiledAt: z.string().min(1),
  budget: z.object({
    maxItemsPerSection: z.number().int().positive(),
    maxOperatingEntities: z.number().int().positive(),
  }),
  sections: agentContextSectionsSchema,
  omitted: z.array(agentContextOmittedSectionSchema),
  warnings: z.array(z.string().min(1)),
  sourceFingerprints: z.array(z.string().min(1)),
});

export type AgentContextPack = z.infer<typeof agentContextPackSchema>;
