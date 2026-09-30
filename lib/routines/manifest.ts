import { z } from "zod";

import {
  DAILY_FINANCE_REPORT_TEMPLATE_KEY,
  LEGAL_WATCH_BKPM_TEMPLATE_KEY,
  MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY,
  WEEKLY_OPERATING_REPORT_TEMPLATE_KEY,
  isReportAutomationTemplateKey,
} from "@/lib/routines/types";
import {
  resolveReportBuiltInSources,
  type ReportBuiltInSourceId,
} from "@/lib/routines/report-sources";

const recordSchema = z.record(z.string(), z.unknown());

export const automationManifestVersionSchema = z.literal("automation_manifest_v1");

export const automationScopeSchema = z
  .object({
    type: z.enum(["company", "project", "operating_object", "personal_project"]),
    id: z.string().min(1).nullable(),
  })
  .strict();

export const automationDefinitionSchema = z
  .object({
    id: z.string().min(1),
    companyId: z.string().min(1),
    slug: z.string().min(1),
    title: z.string().min(1),
    templateKey: z.string().min(1),
    status: z.enum(["draft", "active", "paused", "archived"]),
    domain: z.string().min(1),
    riskLevel: z.enum(["low", "medium", "high"]),
    scope: automationScopeSchema,
  })
  .strict();

export const automationTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }).strict(),
  z
    .object({
      type: z.literal("schedule"),
      cadence: z.enum(["hourly", "daily", "weekly", "monthly"]),
      timezone: z.string().min(1),
      window: z.enum(["previous_day", "previous_week", "previous_month", "month_to_date", "custom"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("webhook"),
      eventKey: z.string().min(1),
    })
    .strict(),
]);

const automationSourceBaseSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      "company_db",
      "connector",
      "communications",
      "web",
      "apify",
      "document_folder",
      "manual_seed",
    ]),
    title: z.string().min(1),
    trustTier: z.enum(["primary", "official", "internal", "secondary"]),
    status: z.enum(["active", "paused", "broken", "retired"]),
    connector: z
      .object({
        provider: z.enum([
          "slack",
          "telegram",
          "odoo",
          "google_drive",
          "google_ads",
          "meta_ads",
          "custom_http",
          "custom_mcp",
        ]),
        connectionId: z.string().min(1).optional(),
        scope: recordSchema,
      })
      .strict()
      .optional(),
    web: z
      .object({
        url: z.string().url(),
        allowedUrlPrefixes: z.array(z.string().url()).min(1),
        fetchMode: z.enum(["http_html", "http_pdf", "rss", "sitemap"]),
      })
      .strict()
      .optional(),
    apify: z
      .object({
        actorId: z.string().min(1),
        input: recordSchema,
        allowedUrlPrefixes: z.array(z.string().url()).min(1),
      })
      .strict()
      .optional(),
    companyDb: z
      .object({
        domains: z.array(z.string().min(1)).min(1),
        query: recordSchema,
      })
      .strict()
      .optional(),
    window: z
      .object({
        mode: z.enum(["since_last_success", "trigger_window", "fixed"]),
        maxLookbackDays: z.number().int().positive(),
      })
      .strict()
      .optional(),
    freshnessPolicy: z
      .object({
        expectedFrequency: z.enum(["hourly", "daily", "weekly", "monthly", "manual"]),
        staleAfterHours: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const automationSourceSchema = automationSourceBaseSchema.superRefine(
  (source, ctx) => {
    const expectedConfigByType: Record<string, "connector" | "web" | "apify" | "companyDb" | null> = {
      company_db: "companyDb",
      connector: "connector",
      communications: "connector",
      web: "web",
      apify: "apify",
      document_folder: "connector",
      manual_seed: null,
    };
    const expected = expectedConfigByType[source.type];
    if (expected && !source[expected]) {
      ctx.addIssue({
        code: "custom",
        path: [expected],
        message: `${source.type} source requires ${expected} config`,
      });
    }
  },
);

export const automationStepSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: z.string().min(1),
      type: z.literal("collect"),
      sourceIds: z.array(z.string().min(1)),
      limits: z
        .object({
          maxItems: z.number().int().positive(),
          maxBytes: z.number().int().positive().optional(),
          timeoutSeconds: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("normalize"),
      mode: z.enum(["legal_update", "messages", "connector_rows", "company_db_records", "documents"]),
      outputSchema: z.string().min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("dedupe"),
      strategy: z.enum(["source_event_id", "content_hash", "semantic_key"]),
      keyTemplate: z.string().min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("llm_extract"),
      provider: z.enum(["openrouter", "openai", "anthropic", "ai_sdk"]),
      model: z.string().min(1),
      promptRef: z.string().min(1),
      outputSchemaRef: z.string().min(1),
      tools: z.array(z.string().min(1)),
      evidenceRequired: z.literal(true),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("aggregate"),
      mode: z.enum(["summary", "metrics", "timeline", "variance", "topic_digest"]),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("render_artifact"),
      format: z.enum(["markdown", "qmd", "xlsx", "docx", "json"]),
      templateRef: z.string().min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("create_report_job"),
      requestTemplate: z.string().min(1),
      outputFormat: z.enum(["markdown", "docx", "xlsx"]),
      strictness: z.enum(["standard", "strict"]),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("create_candidate"),
      targetDomain: z.string().min(1),
      targetPathTemplate: z.string().min(1),
      reviewRequired: z.boolean(),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      type: z.literal("store"),
      destinationId: z.string().min(1),
    })
    .strict(),
]);

export const automationOutputSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      "review_candidate",
      "company_db_record",
      "report_artifact",
      "digest_artifact",
      "notification",
      "agent_context_signal",
    ]),
    destination: z
      .object({
        kind: z.enum([
          "routine_candidates",
          "company_db",
          "report_jobs",
          "routine_digest_artifacts",
          "telegram",
          "email",
          "chat_thread",
        ]),
        path: z.string().min(1).optional(),
        domain: z.string().min(1).optional(),
      })
      .strict(),
    publishPolicy: z.enum(["review_required", "auto_publish_low_risk", "preview_only"]),
  })
  .strict();

export const automationReviewPolicySchema = z
  .object({
    required: z.boolean(),
    mode: z.enum(["human_only", "human_or_scoped_api_key", "none"]),
    reviewerScopes: z.array(z.string().min(1)),
    checklist: z.array(z.string().min(1)),
    claimTimeoutSeconds: z.number().int().positive(),
    rejectionRequiresReason: z.boolean(),
  })
  .strict();

export const automationRunPolicySchema = z
  .object({
    concurrency: z.enum(["skip_if_active", "coalesce_if_active", "enqueue"]),
    idempotencyKeyTemplate: z.string().min(1),
    retries: z
      .object({
        maxAttempts: z.number().int().nonnegative(),
        backoff: z.enum(["fixed", "exponential"]),
      })
      .strict(),
    timeoutSeconds: z.number().int().positive(),
    budget: z
      .object({
        maxSourcesPerRun: z.number().int().positive().optional(),
        maxItemsPerSource: z.number().int().positive().optional(),
        maxLlmCalls: z.number().int().positive().optional(),
        maxCostUsd: z.number().positive().optional(),
      })
      .strict(),
  })
  .strict();

export const automationPermissionsSchema = z
  .object({
    requiredScopes: z.array(z.string().min(1)).min(1),
    companyDbDomains: z.array(z.string().min(1)),
    connectorScopes: z.array(z.string().min(1)),
    writeRequiresReview: z.boolean(),
  })
  .strict();

export const automationObservabilityPolicySchema = z
  .object({
    runLedger: z.boolean(),
    evidenceRequired: z.boolean(),
    sourceEventIdRequired: z.boolean(),
    alertOnSourceFailure: z.boolean(),
    metrics: z.array(z.string().min(1)),
  })
  .strict();

export const automationManifestV1Schema = z
  .object({
    version: automationManifestVersionSchema,
    automation: automationDefinitionSchema,
    trigger: automationTriggerSchema,
    sources: z.array(automationSourceSchema),
    steps: z.array(automationStepSchema).min(1),
    outputs: z.array(automationOutputSchema).min(1),
    reviewPolicy: automationReviewPolicySchema,
    runPolicy: automationRunPolicySchema,
    permissions: automationPermissionsSchema,
    observability: automationObservabilityPolicySchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const sourceIds = new Set(manifest.sources.map((source) => source.id));
    manifest.steps.forEach((step, stepIndex) => {
      if (step.type !== "collect") return;
      step.sourceIds.forEach((sourceId, sourceIndex) => {
        if (!sourceIds.has(sourceId)) {
          ctx.addIssue({
            code: "custom",
            path: ["steps", stepIndex, "sourceIds", sourceIndex],
            message: `Unknown source id: ${sourceId}`,
          });
        }
      });
    });
  });

export type AutomationManifestV1 = z.infer<typeof automationManifestV1Schema>;
export type AutomationSource = z.infer<typeof automationSourceSchema>;
export type AutomationStep = z.infer<typeof automationStepSchema>;
export type AutomationOutput = z.infer<typeof automationOutputSchema>;
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;
export type AutomationReviewPolicy = z.infer<typeof automationReviewPolicySchema>;
export type AutomationRunPolicy = z.infer<typeof automationRunPolicySchema>;
export type AutomationPermissions = z.infer<typeof automationPermissionsSchema>;
export type AutomationObservabilityPolicy = z.infer<typeof automationObservabilityPolicySchema>;

export interface LegalWatchRoutineRecord {
  id: string;
  companyId: string;
  slug: string;
  title: string;
  templateKey: string;
  status: string;
  domain: string;
  scopeType: string;
  scopeId?: string | null;
  schedulePolicy?: Record<string, unknown>;
  sourcePolicy?: Record<string, unknown>;
  reviewPolicy?: Record<string, unknown>;
  digestPolicy?: Record<string, unknown>;
}

export interface LegalWatchRoutineSourceRecord {
  id?: string;
  sourceKey: string;
  title: string;
  url: string;
  sourceType: string;
  fetchMode: string;
  checkFrequency: string;
  trustTier: string;
  status: string;
  allowedUrlPrefixes?: readonly string[];
  metadata?: Record<string, unknown> | null;
}

export interface LegalWatchManifestInput {
  routine: LegalWatchRoutineRecord;
  sources: readonly LegalWatchRoutineSourceRecord[];
}

function metadataOf(source: LegalWatchRoutineSourceRecord): Record<string, unknown> {
  return source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
    ? source.metadata
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function allowedUrlPrefixes(source: LegalWatchRoutineSourceRecord): string[] {
  const metadata = metadataOf(source);
  const configured = [
    ...(source.allowedUrlPrefixes ?? []),
    ...stringArray(metadata.allowedUrlPrefixes),
  ].filter((value) => value.trim().length > 0);
  return Array.from(new Set(configured.length > 0 ? configured : [source.url]));
}

function mapFetchMode(fetchMode: string): "http_html" | "http_pdf" | "rss" | "sitemap" {
  if (fetchMode === "http_pdf" || fetchMode === "rss" || fetchMode === "sitemap") {
    return fetchMode;
  }
  return "http_html";
}

function mapFreshnessPolicy(checkFrequency: string): AutomationSource["freshnessPolicy"] {
  switch (checkFrequency) {
    case "daily":
      return { expectedFrequency: "daily", staleAfterHours: 36 };
    case "weekly":
      return { expectedFrequency: "weekly", staleAfterHours: 192 };
    case "monthly":
      return { expectedFrequency: "monthly", staleAfterHours: 840 };
    case "manual":
    default:
      return { expectedFrequency: "manual", staleAfterHours: 2160 };
  }
}

function maxLookbackDays(checkFrequency: string): number {
  switch (checkFrequency) {
    case "daily":
      return 2;
    case "weekly":
      return 14;
    case "monthly":
      return 45;
    case "manual":
    default:
      return 90;
  }
}

function mapTrustTier(value: string): "primary" | "official" | "secondary" {
  return value === "primary" || value === "official" || value === "secondary"
    ? value
    : "secondary";
}

function mapSourceStatus(value: string): "active" | "paused" | "broken" | "retired" {
  return value === "active" || value === "paused" || value === "broken" || value === "retired"
    ? value
    : "broken";
}

function mapRoutineStatus(value: string): "draft" | "active" | "paused" | "archived" {
  return value === "draft" || value === "active" || value === "paused" || value === "archived"
    ? value
    : "draft";
}

function mapScopeType(value: string): "company" | "project" | "operating_object" | "personal_project" {
  return value === "project" || value === "operating_object" || value === "personal_project"
    ? value
    : "company";
}

function mapLegalWatchSource(source: LegalWatchRoutineSourceRecord): AutomationSource {
  const metadata = metadataOf(source);
  const prefixes = allowedUrlPrefixes(source);
  const apifyActorId = stringValue(metadata.apifyActorId);
  const useApify = stringValue(metadata.collectorProvider) === "apify" && apifyActorId;
  const sourceId = source.id ?? source.sourceKey;
  const base = {
    id: sourceId,
    title: source.title,
    trustTier: mapTrustTier(source.trustTier),
    status: mapSourceStatus(source.status),
    window: {
      mode: "since_last_success" as const,
      maxLookbackDays: maxLookbackDays(source.checkFrequency),
    },
    freshnessPolicy: mapFreshnessPolicy(source.checkFrequency),
  };

  if (useApify) {
    const input: Record<string, unknown> = {
      startUrls: [{ url: source.url }],
      maxCrawlPages: numberValue(metadata.apifyMaxPagesPerRun) ?? 1,
      crawlerType: stringValue(metadata.apifyCrawlerType) ?? "playwright:adaptive",
      useProxy: booleanValue(metadata.apifyUseProxy),
      includeUrlGlobs: stringArray(metadata.apifyIncludeUrlGlobs),
    };
    return {
      ...base,
      type: "apify",
      apify: {
        actorId: apifyActorId,
        input,
        allowedUrlPrefixes: prefixes,
      },
    };
  }

  return {
    ...base,
    type: source.fetchMode === "manual" ? "manual_seed" : "web",
    ...(source.fetchMode === "manual"
      ? {}
      : {
          web: {
            url: source.url,
            allowedUrlPrefixes: prefixes,
            fetchMode: mapFetchMode(source.fetchMode),
          },
        }),
  };
}

function maxSourcesPerRun(policy: Record<string, unknown> | undefined, sourceCount: number): number {
  const configured = numberValue(policy?.maxSourcesPerRun);
  return configured && configured > 0 ? Math.floor(configured) : sourceCount;
}

function reportTrigger(
  schedulePolicy: Record<string, unknown> | undefined,
): AutomationTrigger {
  const cadence = stringValue(schedulePolicy?.cadence);
  if (cadence !== "daily" && cadence !== "weekly" && cadence !== "monthly") {
    return { type: "manual" };
  }
  const configuredWindow = stringValue(schedulePolicy?.window);
  const window =
    configuredWindow === "previous_day" ||
    configuredWindow === "previous_week" ||
    configuredWindow === "previous_month" ||
    configuredWindow === "month_to_date" ||
    configuredWindow === "custom"
      ? configuredWindow
      : cadence === "daily"
        ? "previous_day"
        : cadence === "weekly"
          ? "previous_week"
          : "previous_month";
  return {
    type: "schedule",
    cadence,
    timezone: stringValue(schedulePolicy?.timezone) ?? "UTC",
    window,
  };
}

function reportSourcePhrase(sourceIds: readonly ReportBuiltInSourceId[]): string {
  const labels: Record<ReportBuiltInSourceId, string> = {
    company_db: "Company-DB",
    odoo: "Odoo",
    documents: "processed document",
  };
  return sourceIds.map((sourceId) => labels[sourceId]).join(", ");
}

function reportRequestTemplate(
  templateKey: string,
  sourceIds: readonly ReportBuiltInSourceId[],
): string {
  const sources = reportSourcePhrase(sourceIds);
  switch (templateKey) {
    case DAILY_FINANCE_REPORT_TEMPLATE_KEY:
      return `Prepare a source-backed daily finance report for {window.label}. Use ${sources} evidence. Include source availability and unavailable/partial data caveats.`;
    case WEEKLY_OPERATING_REPORT_TEMPLATE_KEY:
      return `Prepare a source-backed weekly operating report for {window.label}. Use ${sources} evidence. Include week-over-week movement, entity breakdowns, source availability, and unavailable/partial data caveats.`;
    case MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY:
      return `Prepare a source-backed monthly management report for {window.label}. Use ${sources} evidence. Include management summary, source availability, and unavailable/partial data caveats.`;
    default:
      return "Prepare a source-backed report for {window.label}. Include evidence and source availability.";
  }
}

function reportOutputFormat(templateKey: string): "markdown" | "xlsx" {
  return templateKey === DAILY_FINANCE_REPORT_TEMPLATE_KEY ? "markdown" : "xlsx";
}

function reportMaxItemsPerSource(sourcePolicy: unknown): number {
  if (!sourcePolicy || typeof sourcePolicy !== "object" || Array.isArray(sourcePolicy)) return 50;
  const value = (sourcePolicy as Record<string, unknown>).maxItemsPerSource;
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(1, Math.min(200, value))
    : 50;
}

function reportSourceDefinitions(
  sourceIds: readonly ReportBuiltInSourceId[],
  templateKey: string,
): AutomationSource[] {
  const definitions: Record<ReportBuiltInSourceId, AutomationSource> = {
    company_db: {
      id: "company_db",
      type: "company_db",
      title: "Company-DB finance evidence",
      trustTier: "internal",
      status: "active",
      companyDb: {
        domains: ["finance"],
        query: {
          mode: "bounded_report_evidence",
          templateKey,
        },
      },
      window: {
        mode: "trigger_window",
        maxLookbackDays: 45,
      },
      freshnessPolicy: {
        expectedFrequency: "daily",
        staleAfterHours: 48,
      },
    },
    odoo: {
      id: "odoo",
      type: "connector",
      title: "Odoo finance connector",
      trustTier: "internal",
      status: "active",
      connector: {
        provider: "odoo",
        scope: {
          mode: "finance_report_snapshot",
          templateKey,
          requiredScope: "connectors.use.odoo",
        },
      },
      window: {
        mode: "trigger_window",
        maxLookbackDays: 45,
      },
      freshnessPolicy: {
        expectedFrequency: "daily",
        staleAfterHours: 48,
      },
    },
    documents: {
      id: "documents",
      type: "document_folder",
      title: "Processed company documents",
      trustTier: "internal",
      status: "active",
      connector: {
        provider: "google_drive",
        scope: {
          mode: "company_documents_index",
          requiredScope: "documents.read",
        },
      },
      window: {
        mode: "trigger_window",
        maxLookbackDays: 45,
      },
      freshnessPolicy: {
        expectedFrequency: "daily",
        staleAfterHours: 48,
      },
    },
  };
  return sourceIds.map((sourceId) => definitions[sourceId]);
}

export function mapReportRoutineToAutomationManifestV1(
  input: LegalWatchManifestInput,
): AutomationManifestV1 {
  if (!isReportAutomationTemplateKey(input.routine.templateKey)) {
    throw new Error(`Unsupported report automation template: ${input.routine.templateKey}`);
  }

  const enabledSourceIds = resolveReportBuiltInSources(input.routine.sourcePolicy);
  const maxItemsPerSource = reportMaxItemsPerSource(input.routine.sourcePolicy);
  const manifest = {
    version: "automation_manifest_v1",
    automation: {
      id: input.routine.id,
      companyId: input.routine.companyId,
      slug: input.routine.slug,
      title: input.routine.title,
      templateKey: input.routine.templateKey,
      status: mapRoutineStatus(input.routine.status),
      domain: input.routine.domain,
      riskLevel: "medium",
      scope: {
        type: mapScopeType(input.routine.scopeType),
        id: mapScopeType(input.routine.scopeType) === "company" ? null : input.routine.scopeId ?? null,
      },
    },
    trigger: reportTrigger(input.routine.schedulePolicy),
    sources: reportSourceDefinitions(enabledSourceIds, input.routine.templateKey),
    steps: [
      {
        id: "collect-built-in-report-sources",
        type: "collect",
        sourceIds: enabledSourceIds,
        limits: {
          maxItems: maxItemsPerSource,
          timeoutSeconds: 60,
        },
      },
      {
        id: "create-source-backed-report-job",
        type: "create_report_job",
        requestTemplate: reportRequestTemplate(input.routine.templateKey, enabledSourceIds),
        outputFormat: reportOutputFormat(input.routine.templateKey),
        strictness: "standard",
      },
    ],
    outputs: [
      {
        id: "report-artifact",
        type: "report_artifact",
        destination: {
          kind: "report_jobs",
          domain: input.routine.domain,
        },
        publishPolicy: "review_required",
      },
    ],
    reviewPolicy: {
      required: true,
      mode: "human_or_scoped_api_key",
      reviewerScopes: ["routines.review"],
      checklist: [
        "source_availability_section_present",
        "unavailable_sources_not_rendered_as_zero",
        "artifact_links_to_routine_run_and_report_job",
      ],
      claimTimeoutSeconds: 1800,
      rejectionRequiresReason: true,
    },
    runPolicy: {
      concurrency: "coalesce_if_active",
      idempotencyKeyTemplate: "routine:{automation.id}:window:{window.start}:{window.end}:report",
      retries: {
        maxAttempts: 2,
        backoff: "exponential",
      },
      timeoutSeconds: 900,
      budget: {
        maxSourcesPerRun: 10,
        maxItemsPerSource: 50,
        maxLlmCalls: 2,
        maxCostUsd: 5,
      },
    },
    permissions: {
      requiredScopes: ["routines.read", "routines.write", "company_db.read"],
      companyDbDomains: [input.routine.domain],
      connectorScopes: ["connectors.use.odoo"],
      writeRequiresReview: true,
    },
    observability: {
      runLedger: true,
      evidenceRequired: true,
      sourceEventIdRequired: true,
      alertOnSourceFailure: true,
      metrics: [
        "sources_collected",
        "source_unavailable",
        "source_partial",
        "report_jobs_created",
        "artifacts_created",
      ],
    },
  } satisfies AutomationManifestV1;

  return automationManifestV1Schema.parse(manifest);
}

export function mapLegalWatchRoutineToAutomationManifestV1(
  input: LegalWatchManifestInput,
): AutomationManifestV1 {
  if (input.routine.templateKey !== LEGAL_WATCH_BKPM_TEMPLATE_KEY) {
    throw new Error(`Unsupported Legal Watch routine template: ${input.routine.templateKey}`);
  }
  if (input.routine.domain !== "legal") {
    throw new Error(`Legal Watch manifest requires legal domain, got ${input.routine.domain}`);
  }

  const sources = input.sources.map(mapLegalWatchSource);
  const manifest = {
    version: "automation_manifest_v1",
    automation: {
      id: input.routine.id,
      companyId: input.routine.companyId,
      slug: input.routine.slug,
      title: input.routine.title,
      templateKey: input.routine.templateKey,
      status: mapRoutineStatus(input.routine.status),
      domain: "legal",
      riskLevel: "high",
      scope: {
        type: mapScopeType(input.routine.scopeType),
        id: mapScopeType(input.routine.scopeType) === "company" ? null : input.routine.scopeId ?? null,
      },
    },
    trigger: { type: "manual" },
    sources,
    steps: [
      {
        id: "collect-legal-watch-sources",
        type: "collect",
        sourceIds: sources.map((source) => source.id),
        limits: {
          maxItems: Math.max(sources.length, 1),
          maxBytes: 5_000_000,
          timeoutSeconds: 180,
        },
      },
      {
        id: "normalize-legal-updates",
        type: "normalize",
        mode: "legal_update",
        outputSchema: "routine_legal_update_v1",
      },
      {
        id: "dedupe-legal-updates",
        type: "dedupe",
        strategy: "content_hash",
        keyTemplate: "routine:{automation.slug}:candidate:{source.id}:{contentHash}",
      },
      {
        id: "extract-reviewed-legal-candidate",
        type: "llm_extract",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        promptRef: "legal_watch_candidate_extraction_v1",
        outputSchemaRef: "routine_legal_update_v1",
        tools: ["source_evidence_refs"],
        evidenceRequired: true,
      },
      {
        id: "create-review-candidate",
        type: "create_candidate",
        targetDomain: "legal",
        targetPathTemplate: "legal/watch/bkpm/updates/{yyyy}-{mm}-{dd}-{source.id}-{slug}.qmd",
        reviewRequired: true,
      },
      {
        id: "render-digest-preview",
        type: "render_artifact",
        format: "qmd",
        templateRef: "legal_watch_digest_preview_v1",
      },
    ],
    outputs: [
      {
        id: "legal-watch-review-candidate",
        type: "review_candidate",
        destination: {
          kind: "routine_candidates",
          domain: "legal",
          path: "legal/watch/bkpm/updates",
        },
        publishPolicy: "review_required",
      },
      {
        id: "legal-watch-digest-preview",
        type: "digest_artifact",
        destination: {
          kind: "routine_digest_artifacts",
          path: "legal/watch/bkpm/digests",
        },
        publishPolicy: "preview_only",
      },
    ],
    reviewPolicy: {
      required: true,
      mode: "human_only",
      reviewerScopes: ["routines.review", "legal:write"],
      checklist: [
        "source_url_present",
        "source_date_or_retrieved_date_present",
        "official_or_primary_source_checked",
        "company_specific_legal_advice_not_claimed",
        "target_path_within_legal_watch_bkpm_updates",
      ],
      claimTimeoutSeconds: 1800,
      rejectionRequiresReason: true,
    },
    runPolicy: {
      concurrency: "skip_if_active",
      idempotencyKeyTemplate: "routine:{automation.id}:source:{source.id}:hash:{contentHash}",
      retries: {
        maxAttempts: 2,
        backoff: "exponential",
      },
      timeoutSeconds: 600,
      budget: {
        maxSourcesPerRun: maxSourcesPerRun(input.routine.sourcePolicy, sources.length),
        maxItemsPerSource: 1,
        maxLlmCalls: sources.length,
        maxCostUsd: 3,
      },
    },
    permissions: {
      requiredScopes: ["routines.read", "routines.write", "routines.review", "company:read", "legal:write"],
      companyDbDomains: ["legal"],
      connectorScopes: [],
      writeRequiresReview: true,
    },
    observability: {
      runLedger: true,
      evidenceRequired: true,
      sourceEventIdRequired: true,
      alertOnSourceFailure: true,
      metrics: [
        "sources_collected",
        "source_errors",
        "content_hash_changes",
        "candidates_created",
        "digest_previews_created",
      ],
    },
  } satisfies AutomationManifestV1;

  return automationManifestV1Schema.parse(manifest);
}

export function buildAutomationManifestV1(
  input: LegalWatchManifestInput,
): AutomationManifestV1 {
  if (isReportAutomationTemplateKey(input.routine.templateKey)) {
    return mapReportRoutineToAutomationManifestV1(input);
  }
  return mapLegalWatchRoutineToAutomationManifestV1(input);
}
