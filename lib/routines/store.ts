import { and, asc, desc, eq, gt, gte, lt, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  auditLog,
  routineDefinitions,
  routineDigestArtifacts,
  routineObservations,
  routineRuns,
  routineSources,
  routineTemplates,
  routineUpdateCandidates,
} from "@/lib/db/schema";
import { BKPM_LEGAL_WATCH_SOURCES } from "@/lib/routines/legal-watch/bkpm-sources";
import {
  DAILY_FINANCE_REPORT_TEMPLATE_KEY,
  LEGAL_WATCH_BKPM_TEMPLATE_KEY,
  MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY,
  REPORT_AUTOMATION_TEMPLATE_KEYS,
  WEEKLY_OPERATING_REPORT_TEMPLATE_KEY,
  isReportAutomationTemplateKey,
  type RoutineCandidateReviewStatus,
  type RoutineLegalStatus,
  type RoutineObservationChangeKind,
  type RoutineObservationStatus,
  type RoutineRunStatus,
  type RoutineRunTrigger,
  type RoutineScopeType,
  type ReportAutomationTemplateKey,
} from "@/lib/routines/types";

export async function recordRoutineAuditLog(input: {
  companyId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
}) {
  await db.insert(auditLog).values({
    companyId: input.companyId,
    userId: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    details: input.details ?? null,
  });
}
import type { RoutineSourceDefinition } from "@/lib/routines/source-registry";
import { isOperatorConfiguredSource } from "@/lib/routines/source-config";

function slugifyRoutineSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function routineSlugExists(companyId: string, slug: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: routineDefinitions.id })
    .from(routineDefinitions)
    .where(
      and(
        eq(routineDefinitions.companyId, companyId),
        eq(routineDefinitions.slug, slug),
      ),
    )
    .limit(1);
  return Boolean(existing);
}

async function chooseUniqueRoutineSlug(companyId: string, baseSlug: string): Promise<string> {
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? baseSlug : `${baseSlug}-${suffix + 1}`;
    if (!(await routineSlugExists(companyId, candidate))) return candidate;
  }
  return `${baseSlug}-${Date.now().toString(36)}`;
}

type BuiltInTemplateSeed = {
  templateKey: string;
  title: string;
  domain: string;
  defaultJurisdiction: string | null;
  defaultTopic: string | null;
  defaultSources: Array<Record<string, unknown>>;
  defaultSchedulePolicy: Record<string, unknown>;
  defaultReviewPolicy: Record<string, unknown>;
  defaultDigestPolicy: Record<string, unknown>;
  requiredPermissions: string[];
  requiredInputs: Array<Record<string, unknown>>;
  riskLevel: "low" | "medium" | "high";
  status: "active";
};

const REPORT_AUTOMATION_TEMPLATE_SEEDS: Record<ReportAutomationTemplateKey, BuiltInTemplateSeed> = {
  [DAILY_FINANCE_REPORT_TEMPLATE_KEY]: {
    templateKey: DAILY_FINANCE_REPORT_TEMPLATE_KEY,
    title: "Daily Finance Report",
    domain: "finance",
    defaultJurisdiction: null,
    defaultTopic: "daily-finance",
    defaultSources: [],
    defaultSchedulePolicy: {
      cadence: "daily",
      timezone: "UTC",
      localAnchor: { hour: 0, minute: 0 },
      window: "previous_day",
      dueTime: { hour: 8, minute: 0 },
      dueOffsetDays: 0,
      catchUpPolicy: "last_due_only",
      maxBackfillWindowCount: 14,
      manualRunEnabled: true,
      schedulerEnabled: false,
    },
    defaultReviewPolicy: {
      reviewRequired: true,
      mode: "human_or_scoped_api_key",
      publishPolicy: "review_required",
    },
    defaultDigestPolicy: {
      previewOnly: true,
      delivery: "disabled",
      artifactFormats: ["markdown"],
    },
    requiredPermissions: ["company:read", "finance:read", "company_db.read"],
    requiredInputs: [],
    riskLevel: "medium",
    status: "active",
  },
  [WEEKLY_OPERATING_REPORT_TEMPLATE_KEY]: {
    templateKey: WEEKLY_OPERATING_REPORT_TEMPLATE_KEY,
    title: "Weekly Operating Report",
    domain: "finance",
    defaultJurisdiction: null,
    defaultTopic: "weekly-operating",
    defaultSources: [],
    defaultSchedulePolicy: {
      cadence: "weekly",
      timezone: "UTC",
      localAnchor: { dayOfWeek: 1, hour: 0, minute: 0 },
      window: "previous_week",
      dueTime: { hour: 9, minute: 0 },
      dueOffsetDays: 0,
      catchUpPolicy: "last_due_only",
      maxBackfillWindowCount: 8,
      manualRunEnabled: true,
      schedulerEnabled: false,
    },
    defaultReviewPolicy: {
      reviewRequired: true,
      mode: "human_or_scoped_api_key",
      publishPolicy: "review_required",
    },
    defaultDigestPolicy: {
      previewOnly: true,
      delivery: "disabled",
      artifactFormats: ["markdown", "xlsx"],
    },
    requiredPermissions: ["company:read", "finance:read", "company_db.read"],
    requiredInputs: [],
    riskLevel: "medium",
    status: "active",
  },
  [MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY]: {
    templateKey: MONTHLY_MANAGEMENT_REPORT_TEMPLATE_KEY,
    title: "Monthly Management Report",
    domain: "finance",
    defaultJurisdiction: null,
    defaultTopic: "monthly-management",
    defaultSources: [],
    defaultSchedulePolicy: {
      cadence: "monthly",
      timezone: "UTC",
      localAnchor: { dayOfMonth: 1, hour: 0, minute: 0 },
      window: "previous_month",
      dueTime: { hour: 9, minute: 0 },
      dueOffsetDays: 4,
      catchUpPolicy: "last_due_only",
      maxBackfillWindowCount: 6,
      manualRunEnabled: true,
      schedulerEnabled: false,
    },
    defaultReviewPolicy: {
      reviewRequired: true,
      mode: "human_or_scoped_api_key",
      publishPolicy: "review_required",
    },
    defaultDigestPolicy: {
      previewOnly: true,
      delivery: "disabled",
      artifactFormats: ["markdown", "xlsx"],
    },
    requiredPermissions: ["company:read", "finance:read", "company_db.read"],
    requiredInputs: [],
    riskLevel: "medium",
    status: "active",
  },
};

function legalWatchTemplateSeed(): BuiltInTemplateSeed {
  const defaultSources = BKPM_LEGAL_WATCH_SOURCES.map((source) => ({
    sourceKey: source.sourceKey,
    title: source.title,
    url: source.url,
    trustTier: source.trustTier,
    authority: source.authority,
    status: source.status,
  }));
  return {
    templateKey: LEGAL_WATCH_BKPM_TEMPLATE_KEY,
    title: "BKPM Legal Watch",
    domain: "legal",
    defaultJurisdiction: "ID",
    defaultTopic: "bkpm",
    defaultSources,
    defaultSchedulePolicy: { manualOnly: true, cadence: "manual" },
    defaultReviewPolicy: { reviewRequired: true },
    defaultDigestPolicy: { previewOnly: true, delivery: "disabled" },
    requiredPermissions: ["company:read", "legal:write"],
    requiredInputs: [],
    riskLevel: "high",
    status: "active",
  };
}

function builtInTemplateSeed(templateKey: string): BuiltInTemplateSeed | null {
  if (templateKey === LEGAL_WATCH_BKPM_TEMPLATE_KEY) return legalWatchTemplateSeed();
  if (isReportAutomationTemplateKey(templateKey)) {
    return REPORT_AUTOMATION_TEMPLATE_SEEDS[templateKey];
  }
  return null;
}

async function upsertBuiltInRoutineTemplate(seed: BuiltInTemplateSeed): Promise<void> {
  const [existing] = await db
    .select({
      id: routineTemplates.id,
      title: routineTemplates.title,
      domain: routineTemplates.domain,
      defaultJurisdiction: routineTemplates.defaultJurisdiction,
      defaultTopic: routineTemplates.defaultTopic,
      defaultSources: routineTemplates.defaultSources,
      defaultSchedulePolicy: routineTemplates.defaultSchedulePolicy,
      defaultReviewPolicy: routineTemplates.defaultReviewPolicy,
      defaultDigestPolicy: routineTemplates.defaultDigestPolicy,
      requiredPermissions: routineTemplates.requiredPermissions,
      requiredInputs: routineTemplates.requiredInputs,
      riskLevel: routineTemplates.riskLevel,
      status: routineTemplates.status,
    })
    .from(routineTemplates)
    .where(eq(routineTemplates.templateKey, seed.templateKey))
    .limit(1);

  if (existing) {
    const needsUpdate =
      existing.title !== seed.title ||
      existing.domain !== seed.domain ||
      existing.defaultJurisdiction !== seed.defaultJurisdiction ||
      existing.defaultTopic !== seed.defaultTopic ||
      JSON.stringify(existing.defaultSources) !== JSON.stringify(seed.defaultSources) ||
      JSON.stringify(existing.defaultSchedulePolicy) !== JSON.stringify(seed.defaultSchedulePolicy) ||
      JSON.stringify(existing.defaultReviewPolicy) !== JSON.stringify(seed.defaultReviewPolicy) ||
      JSON.stringify(existing.defaultDigestPolicy) !== JSON.stringify(seed.defaultDigestPolicy) ||
      JSON.stringify(existing.requiredPermissions) !== JSON.stringify(seed.requiredPermissions) ||
      JSON.stringify(existing.requiredInputs) !== JSON.stringify(seed.requiredInputs) ||
      existing.riskLevel !== seed.riskLevel ||
      existing.status !== seed.status;
    if (needsUpdate) {
      await db
        .update(routineTemplates)
        .set({
          title: seed.title,
          domain: seed.domain,
          defaultJurisdiction: seed.defaultJurisdiction,
          defaultTopic: seed.defaultTopic,
          defaultSources: seed.defaultSources,
          defaultSchedulePolicy: seed.defaultSchedulePolicy,
          defaultReviewPolicy: seed.defaultReviewPolicy,
          defaultDigestPolicy: seed.defaultDigestPolicy,
          requiredPermissions: seed.requiredPermissions,
          requiredInputs: seed.requiredInputs,
          riskLevel: seed.riskLevel,
          status: seed.status,
          updatedAt: new Date(),
        })
        .where(eq(routineTemplates.id, existing.id));
    }
    return;
  }

  await db.insert(routineTemplates).values(seed);
}

export async function ensureBuiltInRoutineTemplates(): Promise<void> {
  await upsertBuiltInRoutineTemplate(legalWatchTemplateSeed());
  for (const templateKey of REPORT_AUTOMATION_TEMPLATE_KEYS) {
    await upsertBuiltInRoutineTemplate(REPORT_AUTOMATION_TEMPLATE_SEEDS[templateKey]);
  }
}

export async function listRoutineTemplates() {
  await ensureBuiltInRoutineTemplates();
  return db
    .select()
    .from(routineTemplates)
    .where(eq(routineTemplates.status, "active"))
    .orderBy(routineTemplates.title);
}

export async function listCompanyRoutines(companyId: string) {
  return db
    .select()
    .from(routineDefinitions)
    .where(eq(routineDefinitions.companyId, companyId))
    .orderBy(desc(routineDefinitions.updatedAt));
}

export async function listActiveRoutineScheduleCandidates(limit = 100) {
  return db
    .select()
    .from(routineDefinitions)
    .where(
      and(
        eq(routineDefinitions.status, "active"),
        sql`${routineDefinitions.schedulePolicy}->>'schedulerEnabled' = 'true'`,
        sql`${routineDefinitions.schedulePolicy}->>'cadence' in ('daily','weekly','monthly')`,
      ),
    )
    .orderBy(asc(routineDefinitions.updatedAt))
    .limit(Math.max(1, Math.min(500, limit)));
}

export async function getCompanyRoutine(companyId: string, routineId: string) {
  const [routine] = await db
    .select()
    .from(routineDefinitions)
    .where(
      and(
        eq(routineDefinitions.companyId, companyId),
        eq(routineDefinitions.id, routineId),
      ),
    )
    .limit(1);
  return routine ?? null;
}

export async function updateCompanyRoutine(input: {
  companyId: string;
  routineId: string;
  title?: string;
  status?: "active" | "paused" | "archived";
  schedulePolicy?: Record<string, unknown>;
  sourcePolicy?: Record<string, unknown>;
  reviewPolicy?: Record<string, unknown>;
  digestPolicy?: Record<string, unknown>;
}) {
  const update: Partial<typeof routineDefinitions.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.title !== undefined) update.title = input.title;
  if (input.status !== undefined) update.status = input.status;
  if (input.schedulePolicy !== undefined) update.schedulePolicy = input.schedulePolicy;
  if (input.sourcePolicy !== undefined) update.sourcePolicy = input.sourcePolicy;
  if (input.reviewPolicy !== undefined) update.reviewPolicy = input.reviewPolicy;
  if (input.digestPolicy !== undefined) update.digestPolicy = input.digestPolicy;

  const [routine] = await db
    .update(routineDefinitions)
    .set(update)
    .where(
      and(
        eq(routineDefinitions.companyId, input.companyId),
        eq(routineDefinitions.id, input.routineId),
      ),
    )
    .returning();
  return routine ?? null;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function sourceValues(
  companyId: string,
  routineId: string,
  source: RoutineSourceDefinition,
) {
  return {
    routineId,
    companyId,
    sourceKey: source.sourceKey,
    title: source.title,
    url: source.url,
    sourceType: source.sourceType,
    authority: source.authority,
    jurisdiction: source.jurisdiction,
    topicTags: source.topicTags,
    fetchMode: source.fetchMode,
    checkFrequency: source.checkFrequency,
    stalenessRisk: source.stalenessRisk,
    trustTier: source.trustTier,
    status: source.status ?? "active",
    metadata: {
      useFor: source.useFor,
      provenanceRequirements: source.provenanceRequirements,
      allowedContentTypes: source.allowedContentTypes,
      allowedUrlPrefixes: source.allowedUrlPrefixes ?? [],
      verifiedAsOf: source.verifiedAsOf,
      instrumentNumber: source.instrumentNumber ?? null,
      sourceDate: source.sourceDate ?? null,
      discoveryOnly: source.discoveryOnly === true,
      primarySourceRequired: source.primarySourceRequired === true,
      secondaryCommentaryOnly: source.secondaryCommentaryOnly === true,
      notes: source.notes ?? [],
      ...source.metadata,
    },
  };
}

export async function reconcileBkpmLegalWatchRoutineSources(input: {
  companyId: string;
  routineId: string;
}) {
  const existingSources = await listRoutineSources(input.companyId, input.routineId);
  const existingByKey = new Map(existingSources.map((source) => [source.sourceKey, source]));

  for (const source of BKPM_LEGAL_WATCH_SOURCES) {
    const nextValues = sourceValues(input.companyId, input.routineId, source);
    const existing = existingByKey.get(source.sourceKey);
    if (!existing) {
      await db.insert(routineSources).values(nextValues);
      continue;
    }
    if (isOperatorConfiguredSource(existing)) {
      await db
        .update(routineSources)
        .set({
          metadata: {
            ...metadataRecord(existing.metadata),
            seedRegistry: {
              sourceKey: nextValues.sourceKey,
              title: nextValues.title,
              url: nextValues.url,
              status: nextValues.status,
              verifiedAsOf: metadataRecord(nextValues.metadata).verifiedAsOf,
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(routineSources.id, existing.id));
      continue;
    }

    const sourceChanged =
      existing.url !== nextValues.url ||
      existing.fetchMode !== nextValues.fetchMode ||
      existing.sourceType !== nextValues.sourceType;
    await db
      .update(routineSources)
      .set({
        title: nextValues.title,
        url: nextValues.url,
        sourceType: nextValues.sourceType,
        authority: nextValues.authority,
        jurisdiction: nextValues.jurisdiction,
        topicTags: nextValues.topicTags,
        fetchMode: nextValues.fetchMode,
        checkFrequency: nextValues.checkFrequency,
        stalenessRisk: nextValues.stalenessRisk,
        trustTier: nextValues.trustTier,
        status: nextValues.status,
        lastContentHash: sourceChanged ? null : existing.lastContentHash,
        lastError: sourceChanged || nextValues.status !== "active" ? null : existing.lastError,
        metadata: nextValues.metadata,
        updatedAt: new Date(),
      })
      .where(eq(routineSources.id, existing.id));
  }
}

export async function createBkpmLegalWatchRoutine(input: {
  companyId: string;
  userId: string;
  title?: string;
  scopeType?: RoutineScopeType;
  scopeId?: string | null;
  status?: "draft" | "paused" | "active";
  createdFrom?: "template" | "chat_draft" | "api" | "import";
  createMode?: "ensure" | "new";
}) {
  await ensureBuiltInRoutineTemplates();
  const scopeType = input.scopeType ?? "company";
  const scopeId = scopeType === "company" ? null : input.scopeId?.trim() || null;
  if (scopeType !== "company" && !scopeId) {
    throw new Error("scopeId is required for non-company routines");
  }
  const scopeSlug = scopeType === "company"
    ? "company"
    : `${scopeType}-${slugifyRoutineSegment(scopeId!)}`;
  const createMode = input.createMode ?? "ensure";
  let slug = scopeType === "company" ? "legal-watch-bkpm" : `legal-watch-bkpm-${scopeSlug}`;
  if (createMode === "new") {
    const titleSlug = slugifyRoutineSegment(input.title ?? "");
    const baseSlug = titleSlug
      ? `legal-watch-bkpm-${titleSlug}`
      : scopeType === "company"
        ? "legal-watch-bkpm-custom"
        : `legal-watch-bkpm-${scopeSlug}-custom`;
    slug = await chooseUniqueRoutineSlug(input.companyId, baseSlug);
  } else {
    const [existing] = await db
      .select()
      .from(routineDefinitions)
      .where(
        and(
          eq(routineDefinitions.companyId, input.companyId),
          eq(routineDefinitions.slug, slug),
        ),
      )
      .limit(1);
    if (existing) {
      await reconcileBkpmLegalWatchRoutineSources({
        companyId: input.companyId,
        routineId: existing.id,
      });
      return existing;
    }
  }

  const createdFrom = input.createdFrom ?? "template";
  const [routine] = await db
    .insert(routineDefinitions)
    .values({
      companyId: input.companyId,
      scopeType,
      scopeId,
      slug,
      title: input.title ?? "BKPM Legal Watch",
      templateKey: LEGAL_WATCH_BKPM_TEMPLATE_KEY,
      domain: "legal",
      jurisdiction: "ID",
      topic: "bkpm",
      status: input.status ?? (createdFrom === "chat_draft" ? "draft" : "paused"),
      createdByUserId: input.userId,
      ownerUserId: input.userId,
      createdFrom,
      schedulePolicy: { manualOnly: true, cadence: "manual" },
      sourcePolicy: { allowlistOnly: true, maxSourcesPerRun: 20 },
      reviewPolicy: { reviewRequired: true },
      digestPolicy: { previewOnly: true, delivery: "disabled" },
      metadata: {
        seededSourceCount: BKPM_LEGAL_WATCH_SOURCES.length,
        activationRequiresConfirmation: createdFrom === "chat_draft",
      },
    })
    .returning();
  if (!routine) throw new Error("Failed to create routine");

  await db
    .insert(routineSources)
    .values(BKPM_LEGAL_WATCH_SOURCES.map((source) => sourceValues(input.companyId, routine.id, source)));

  return routine;
}

export async function createReportAutomationRoutine(input: {
  companyId: string;
  userId: string;
  templateKey: ReportAutomationTemplateKey;
  title?: string;
  scopeType?: RoutineScopeType;
  scopeId?: string | null;
  status?: "draft" | "paused" | "active";
  createdFrom?: "template" | "chat_draft" | "api" | "import";
  createMode?: "ensure" | "new";
  schedulePolicy?: Record<string, unknown>;
  sourcePolicy?: Record<string, unknown>;
  reviewPolicy?: Record<string, unknown>;
  digestPolicy?: Record<string, unknown>;
}) {
  await ensureBuiltInRoutineTemplates();
  const seed = builtInTemplateSeed(input.templateKey);
  if (!seed || !isReportAutomationTemplateKey(seed.templateKey)) {
    throw new Error(`Unsupported report automation template: ${input.templateKey}`);
  }

  const scopeType = input.scopeType ?? "company";
  const scopeId = scopeType === "company" ? null : input.scopeId?.trim() || null;
  if (scopeType !== "company" && !scopeId) {
    throw new Error("scopeId is required for non-company routines");
  }

  const createMode = input.createMode ?? "ensure";
  const baseSlug = slugifyRoutineSegment(seed.templateKey);
  let slug = baseSlug;
  if (createMode === "new") {
    const titleSlug = slugifyRoutineSegment(input.title ?? "");
    slug = await chooseUniqueRoutineSlug(
      input.companyId,
      titleSlug ? `${baseSlug}-${titleSlug}` : `${baseSlug}-custom`,
    );
  } else {
    const [existing] = await db
      .select()
      .from(routineDefinitions)
      .where(
        and(
          eq(routineDefinitions.companyId, input.companyId),
          eq(routineDefinitions.slug, slug),
        ),
      )
      .limit(1);
    if (existing) return existing;
  }

  const createdFrom = input.createdFrom ?? "template";
  const [routine] = await db
    .insert(routineDefinitions)
    .values({
      companyId: input.companyId,
      scopeType,
      scopeId,
      slug,
      title: input.title ?? seed.title,
      templateKey: seed.templateKey,
      domain: seed.domain,
      jurisdiction: seed.defaultJurisdiction,
      topic: seed.defaultTopic,
      status: input.status ?? (createdFrom === "chat_draft" ? "draft" : "paused"),
      createdByUserId: input.userId,
      ownerUserId: input.userId,
      createdFrom,
      schedulePolicy: input.schedulePolicy ?? seed.defaultSchedulePolicy,
      sourcePolicy: {
        sourceStatusModel: "available_partial_unavailable_failed",
        configuredSourcesRequiredBeforeActivation: false,
        builtInSources: ["odoo", "company_db", "documents"],
        ...(input.sourcePolicy ?? {}),
      },
      reviewPolicy: input.reviewPolicy ?? seed.defaultReviewPolicy,
      digestPolicy: input.digestPolicy ?? seed.defaultDigestPolicy,
      metadata: {
        reportAutomation: true,
        templateKey: seed.templateKey,
        sourcesConfigured: true,
        sourceConfigurationMode: "built_in_report_sources",
        activationRequiresConfiguredSources: false,
        activationRequiresConfirmation: createdFrom === "chat_draft",
      },
    })
    .returning();
  if (!routine) throw new Error("Failed to create report automation routine");

  return routine;
}

export async function listRoutineSources(companyId: string, routineId: string) {
  return db
    .select()
    .from(routineSources)
    .where(and(eq(routineSources.companyId, companyId), eq(routineSources.routineId, routineId)))
    .orderBy(routineSources.sourceKey);
}

export async function getRoutineSource(input: {
  companyId: string;
  routineId: string;
  sourceId: string;
}) {
  const [source] = await db
    .select()
    .from(routineSources)
    .where(
      and(
        eq(routineSources.companyId, input.companyId),
        eq(routineSources.routineId, input.routineId),
        eq(routineSources.id, input.sourceId),
      ),
    )
    .limit(1);
  return source ?? null;
}

export async function createRoutineSourceConfig(input: {
  companyId: string;
  routineId: string;
  source: RoutineSourceDefinition;
}) {
  const values = sourceValues(input.companyId, input.routineId, input.source);
  const [created] = await db
    .insert(routineSources)
    .values(values)
    .onConflictDoUpdate({
      target: [routineSources.routineId, routineSources.sourceKey],
      set: {
        title: values.title,
        url: values.url,
        sourceType: values.sourceType,
        authority: values.authority,
        jurisdiction: values.jurisdiction,
        topicTags: values.topicTags,
        fetchMode: values.fetchMode,
        checkFrequency: values.checkFrequency,
        stalenessRisk: values.stalenessRisk,
        trustTier: values.trustTier,
        status: values.status,
        metadata: values.metadata,
        lastContentHash: null,
        lastError: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!created) throw new Error("Failed to create routine source");
  return created;
}

export async function updateRoutineSourceConfig(input: {
  companyId: string;
  routineId: string;
  sourceId: string;
  fields: Partial<{
    title: string;
    url: string;
    sourceType: string;
    authority: string;
    jurisdiction: string;
    topicTags: string[];
    fetchMode: string;
    checkFrequency: string;
    stalenessRisk: string;
    trustTier: string;
    status: string;
  }>;
  metadata: Record<string, unknown>;
  resetObservationState?: boolean;
}) {
  const update: Partial<typeof routineSources.$inferInsert> = {
    ...input.fields,
    metadata: input.metadata,
    updatedAt: new Date(),
  };
  if (input.resetObservationState) {
    update.lastContentHash = null;
    update.lastError = null;
  }
  if (input.fields.status && input.fields.status !== "active") {
    update.lastError = null;
  }

  const [updated] = await db
    .update(routineSources)
    .set(update)
    .where(
      and(
        eq(routineSources.companyId, input.companyId),
        eq(routineSources.routineId, input.routineId),
        eq(routineSources.id, input.sourceId),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function listActiveRoutineSources(companyId: string, routineId: string) {
  return db
    .select()
    .from(routineSources)
    .where(
      and(
        eq(routineSources.companyId, companyId),
        eq(routineSources.routineId, routineId),
        eq(routineSources.status, "active"),
      ),
    )
    .orderBy(routineSources.sourceKey);
}

export async function createRoutineRun(input: {
  companyId: string;
  routineId: string;
  trigger: RoutineRunTrigger;
  windowStart?: Date | null;
  windowEnd?: Date | null;
}) {
  const [run] = await db
    .insert(routineRuns)
    .values({
      companyId: input.companyId,
      routineId: input.routineId,
      trigger: input.trigger,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
      status: "queued",
      stats: {},
    })
    .returning();
  if (!run) throw new Error("Failed to create routine run");
  return run;
}

export async function createOrGetOpenRoutineRun(input: {
  companyId: string;
  routineId: string;
  trigger: RoutineRunTrigger;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  afterCreate?: (tx: Pick<typeof db, "insert">, run: typeof routineRuns.$inferSelect) => Promise<void>;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`routine-run:${input.companyId}:${input.routineId}`}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(routineRuns)
      .where(
        and(
          eq(routineRuns.companyId, input.companyId),
          eq(routineRuns.routineId, input.routineId),
          or(eq(routineRuns.status, "queued"), eq(routineRuns.status, "running")),
        ),
      )
      .orderBy(desc(routineRuns.createdAt))
      .limit(1);
    if (existing) return { run: existing, created: false };

    const [run] = await tx
      .insert(routineRuns)
      .values({
        companyId: input.companyId,
        routineId: input.routineId,
        trigger: input.trigger,
        windowStart: input.windowStart ?? null,
        windowEnd: input.windowEnd ?? null,
        status: "queued",
        stats: {},
      })
      .returning();
    if (!run) throw new Error("Failed to create routine run");
    await input.afterCreate?.(tx, run);
    return { run, created: true };
  });
}

export class RoutineScheduledWindowConflictError extends Error {
  readonly conflictingRun: typeof routineRuns.$inferSelect;

  constructor(conflictingRun: typeof routineRuns.$inferSelect) {
    super("Active scheduled routine run overlaps the requested window");
    this.name = "RoutineScheduledWindowConflictError";
    this.conflictingRun = conflictingRun;
  }
}

export async function createOrGetScheduledWindowRoutineRun(input: {
  companyId: string;
  routineId: string;
  trigger: Extract<RoutineRunTrigger, "scheduled" | "backfill">;
  windowStart: Date;
  windowEnd: Date;
  afterCreate?: (tx: Pick<typeof db, "insert">, run: typeof routineRuns.$inferSelect) => Promise<void>;
}) {
  if (input.trigger !== "scheduled" && input.trigger !== "backfill") {
    throw new Error("Scheduled window routine runs require scheduled or backfill trigger");
  }
  if (input.windowEnd.getTime() <= input.windowStart.getTime()) {
    throw new Error("windowEnd must be after windowStart");
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`routine-scheduled-window:${input.companyId}:${input.routineId}`}, 0))`,
    );

    const scheduledOrBackfillTrigger = or(
      eq(routineRuns.trigger, "scheduled"),
      eq(routineRuns.trigger, "backfill"),
    );

    const [existingExactWindowRun] = await tx
      .select()
      .from(routineRuns)
      .where(
        and(
          eq(routineRuns.companyId, input.companyId),
          eq(routineRuns.routineId, input.routineId),
          scheduledOrBackfillTrigger,
          eq(routineRuns.windowStart, input.windowStart),
          eq(routineRuns.windowEnd, input.windowEnd),
        ),
      )
      .orderBy(desc(routineRuns.createdAt))
      .limit(1);
    if (existingExactWindowRun) {
      return { run: existingExactWindowRun, created: false };
    }

    const [activeOverlappingRun] = await tx
      .select()
      .from(routineRuns)
      .where(
        and(
          eq(routineRuns.companyId, input.companyId),
          eq(routineRuns.routineId, input.routineId),
          scheduledOrBackfillTrigger,
          or(eq(routineRuns.status, "queued"), eq(routineRuns.status, "running")),
          lt(routineRuns.windowStart, input.windowEnd),
          gt(routineRuns.windowEnd, input.windowStart),
        ),
      )
      .orderBy(desc(routineRuns.createdAt))
      .limit(1);
    if (activeOverlappingRun) {
      throw new RoutineScheduledWindowConflictError(activeOverlappingRun);
    }

    const [run] = await tx
      .insert(routineRuns)
      .values({
        companyId: input.companyId,
        routineId: input.routineId,
        trigger: input.trigger,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        status: "queued",
        stats: {},
      })
      .returning();
    if (!run) throw new Error("Failed to create routine run");
    await input.afterCreate?.(tx, run);
    return { run, created: true };
  });
}

export async function getOpenRoutineRun(input: {
  companyId: string;
  routineId: string;
}) {
  const [run] = await db
    .select()
    .from(routineRuns)
    .where(
      and(
        eq(routineRuns.companyId, input.companyId),
        eq(routineRuns.routineId, input.routineId),
        or(eq(routineRuns.status, "queued"), eq(routineRuns.status, "running")),
      ),
    )
    .orderBy(desc(routineRuns.createdAt))
    .limit(1);
  return run ?? null;
}

export async function getActiveScheduledRoutineRun(input: {
  companyId: string;
  routineId: string;
}) {
  const [run] = await db
    .select()
    .from(routineRuns)
    .where(
      and(
        eq(routineRuns.companyId, input.companyId),
        eq(routineRuns.routineId, input.routineId),
        or(eq(routineRuns.trigger, "scheduled"), eq(routineRuns.trigger, "backfill")),
        or(eq(routineRuns.status, "queued"), eq(routineRuns.status, "running")),
      ),
    )
    .orderBy(desc(routineRuns.createdAt))
    .limit(1);
  return run ?? null;
}

export async function getRoutineRun(input: {
  companyId: string;
  routineId: string;
  runId: string;
}) {
  const [run] = await db
    .select()
    .from(routineRuns)
    .where(
      and(
        eq(routineRuns.companyId, input.companyId),
        eq(routineRuns.routineId, input.routineId),
        eq(routineRuns.id, input.runId),
      ),
    )
    .limit(1);
  return run ?? null;
}

function boundedSchedulerEvents(
  stats: Record<string, unknown>,
  event: Record<string, unknown>,
): Record<string, unknown>[] {
  const existing = Array.isArray(stats.schedulerEvents)
    ? stats.schedulerEvents.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];
  return [...existing, event].slice(-20);
}

export async function appendRoutineRunSchedulerEvent(input: {
  companyId: string;
  runId: string;
  currentStats?: Record<string, unknown> | null;
  event: {
    kind: "scheduler_existing_window" | "scheduler_blocked_overlap";
    observedAt: string;
    periodKey?: string;
    windowStart?: string;
    windowEnd?: string;
    message: string;
  };
}) {
  const stats = metadataRecord(input.currentStats);
  const nextStats = {
    ...stats,
    lastSchedulerEvent: input.event,
    schedulerEvents: boundedSchedulerEvents(stats, input.event),
  };
  const [run] = await db
    .update(routineRuns)
    .set({
      stats: nextStats,
      updatedAt: new Date(),
    })
    .where(and(eq(routineRuns.companyId, input.companyId), eq(routineRuns.id, input.runId)))
    .returning();
  return run ?? null;
}

export async function updateRoutineRun(input: {
  companyId: string;
  routineId?: string;
  runId: string;
  status: RoutineRunStatus;
  stats?: Record<string, unknown>;
  mergeStats?: boolean;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  activeOnly?: boolean;
}) {
  const where = and(
    eq(routineRuns.companyId, input.companyId),
    eq(routineRuns.id, input.runId),
    ...(input.routineId ? [eq(routineRuns.routineId, input.routineId)] : []),
    ...(input.activeOnly ? [or(eq(routineRuns.status, "queued"), eq(routineRuns.status, "running"))] : []),
  );
  let stats = input.stats;
  if (input.mergeStats && input.stats) {
    const [current] = await db
      .select({ stats: routineRuns.stats })
      .from(routineRuns)
      .where(where)
      .limit(1);
    stats = {
      ...metadataRecord(current?.stats),
      ...input.stats,
    };
  }
  const [run] = await db
    .update(routineRuns)
    .set({
      status: input.status,
      stats,
      error: input.error,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      updatedAt: new Date(),
    })
    .where(where)
    .returning();
  return run ?? null;
}

export async function cancelRoutineRun(input: {
  companyId: string;
  routineId: string;
  runId: string;
  reason?: string;
  cancelledByUserId?: string | null;
}) {
  const now = new Date();
  const [current] = await db
    .select()
    .from(routineRuns)
    .where(
      and(
        eq(routineRuns.companyId, input.companyId),
        eq(routineRuns.routineId, input.routineId),
        eq(routineRuns.id, input.runId),
      ),
    )
    .limit(1);
  if (!current) return null;
  if (current.status !== "queued" && current.status !== "running") {
    return current;
  }
  const stats = metadataRecord(current.stats);
  const cancellation = {
    cancelledAt: now.toISOString(),
    cancelledByUserId: input.cancelledByUserId ?? null,
    previousStatus: current.status,
    reason: input.reason ?? "Routine run cancelled by operator",
  };
  const [run] = await db
    .update(routineRuns)
    .set({
      status: "cancelled",
      error: cancellation.reason,
      finishedAt: now,
      stats: {
        ...stats,
        cancellation,
      },
      updatedAt: now,
    })
    .where(
      and(
        eq(routineRuns.companyId, input.companyId),
        eq(routineRuns.routineId, input.routineId),
        eq(routineRuns.id, input.runId),
        or(eq(routineRuns.status, "queued"), eq(routineRuns.status, "running")),
      ),
    )
    .returning();
  return run ?? current;
}

export async function failStaleRoutineRuns(input: {
  now?: Date;
  staleAfterMs?: number;
  limit?: number;
  reason?: string;
} = {}) {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? 6 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - staleAfterMs);
  const limit = Math.max(1, Math.min(200, input.limit ?? 50));
  const reason = input.reason ?? "Routine run exceeded stale recovery threshold";
  const staleRuns = await db
    .select()
    .from(routineRuns)
    .where(
      and(
        or(eq(routineRuns.status, "queued"), eq(routineRuns.status, "running")),
        lt(routineRuns.updatedAt, cutoff),
      ),
    )
    .orderBy(asc(routineRuns.updatedAt))
    .limit(limit);

  const recovered = [];
  for (const run of staleRuns) {
    const stats = metadataRecord(run.stats);
    const staleRecovery = {
      recoveredAt: now.toISOString(),
      cutoff: cutoff.toISOString(),
      previousStatus: run.status,
      reason,
    };
    const [updated] = await db
      .update(routineRuns)
      .set({
        status: "failed",
        error: reason,
        finishedAt: now,
        stats: {
          ...stats,
          staleRecovery,
        },
        updatedAt: now,
      })
      .where(
        and(
          eq(routineRuns.companyId, run.companyId),
          eq(routineRuns.id, run.id),
          or(eq(routineRuns.status, "queued"), eq(routineRuns.status, "running")),
        ),
      )
      .returning();
    if (updated) recovered.push(updated);
  }

  return {
    scanned: staleRuns.length,
    recovered: recovered.length,
    cutoff,
    runs: recovered,
  };
}

export async function listRoutineRuns(companyId: string, routineId: string) {
  return db
    .select()
    .from(routineRuns)
    .where(and(eq(routineRuns.companyId, companyId), eq(routineRuns.routineId, routineId)))
    .orderBy(desc(routineRuns.createdAt))
    .limit(50);
}

export async function listRoutineObservations(input: {
  companyId: string;
  routineId: string;
  routineRunId?: string | null;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const filters = [
    eq(routineObservations.companyId, input.companyId),
    eq(routineRuns.companyId, input.companyId),
    eq(routineRuns.routineId, input.routineId),
  ];
  if (input.routineRunId) filters.push(eq(routineObservations.routineRunId, input.routineRunId));

  return db
    .select({
      id: routineObservations.id,
      routineRunId: routineObservations.routineRunId,
      routineSourceId: routineObservations.routineSourceId,
      companyId: routineObservations.companyId,
      sourceEventId: routineObservations.sourceEventId,
      contentHash: routineObservations.contentHash,
      canonicalUrl: routineObservations.canonicalUrl,
      sourceTitle: routineObservations.sourceTitle,
      sourceDate: routineObservations.sourceDate,
      fetchedAt: routineObservations.fetchedAt,
      rawEventId: routineObservations.rawEventId,
      documentId: routineObservations.documentId,
      snapshotRef: routineObservations.snapshotRef,
      changeKind: routineObservations.changeKind,
      status: routineObservations.status,
      metadata: routineObservations.metadata,
      createdAt: routineObservations.createdAt,
      updatedAt: routineObservations.updatedAt,
      sourceKey: routineSources.sourceKey,
      sourceConfigTitle: routineSources.title,
      sourceType: routineSources.sourceType,
      trustTier: routineSources.trustTier,
      runTrigger: routineRuns.trigger,
      runStatus: routineRuns.status,
    })
    .from(routineObservations)
    .innerJoin(routineRuns, eq(routineObservations.routineRunId, routineRuns.id))
    .innerJoin(routineSources, eq(routineObservations.routineSourceId, routineSources.id))
    .where(and(...filters))
    .orderBy(desc(routineObservations.createdAt))
    .limit(limit);
}

export async function createRoutineObservation(input: {
  routineRunId: string;
  routineSourceId: string;
  companyId: string;
  sourceEventId: string;
  idempotencyKey: string;
  contentHash: string | null;
  canonicalUrl: string;
  sourceTitle: string | null;
  sourceDate: Date | null;
  fetchedAt: Date;
  rawEventId: string | null;
  snapshotRef?: string | null;
  changeKind: RoutineObservationChangeKind;
  status?: RoutineObservationStatus;
  metadata?: Record<string, unknown>;
}) {
  const [existing] = await db
    .select()
    .from(routineObservations)
    .where(
      and(
        eq(routineObservations.companyId, input.companyId),
        eq(routineObservations.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [observation] = await db
    .insert(routineObservations)
    .values({
      routineRunId: input.routineRunId,
      routineSourceId: input.routineSourceId,
      companyId: input.companyId,
      sourceEventId: input.sourceEventId,
      idempotencyKey: input.idempotencyKey,
      contentHash: input.contentHash,
      canonicalUrl: input.canonicalUrl,
      sourceTitle: input.sourceTitle,
      sourceDate: input.sourceDate,
      fetchedAt: input.fetchedAt,
      rawEventId: input.rawEventId,
      snapshotRef: input.snapshotRef ?? null,
      changeKind: input.changeKind,
      status: input.status ?? "observed",
      metadata: input.metadata ?? {},
    })
    .returning();
  if (!observation) throw new Error("Failed to create routine observation");
  return observation;
}

export async function updateRoutineSourceAfterObservation(input: {
  companyId: string;
  sourceId: string;
  contentHash: string | null;
  changed: boolean;
  error?: string | null;
}) {
  await db
    .update(routineSources)
    .set({
      lastSeenAt: new Date(),
      lastChangedAt: input.changed ? new Date() : undefined,
      lastContentHash: input.contentHash ?? undefined,
      lastError: input.error ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(routineSources.companyId, input.companyId), eq(routineSources.id, input.sourceId)));
}

export async function createRoutineUpdateCandidate(input: {
  routineId: string;
  companyId: string;
  dedupKey: string;
  targetPath: string;
  title: string;
  summary: string;
  jurisdiction: string;
  sourceDate: Date | null;
  confidenceScore: string | null;
  legalStatus: RoutineLegalStatus;
  sourceUrls: string[];
  observationIds: string[];
  proposedFrontmatter: Record<string, unknown>;
  proposedBody: string;
}): Promise<{
  candidate: typeof routineUpdateCandidates.$inferSelect;
  created: boolean;
}> {
  const [existing] = await db
    .select()
    .from(routineUpdateCandidates)
    .where(
      and(
        eq(routineUpdateCandidates.companyId, input.companyId),
        eq(routineUpdateCandidates.dedupKey, input.dedupKey),
      ),
    )
    .limit(1);
  if (existing) return { candidate: existing, created: false };

  const [candidate] = await db
    .insert(routineUpdateCandidates)
    .values({
      routineId: input.routineId,
      companyId: input.companyId,
      dedupKey: input.dedupKey,
      targetDomain: "legal",
      targetPath: input.targetPath,
      title: input.title,
      summary: input.summary,
      jurisdiction: input.jurisdiction,
      sourceDate: input.sourceDate,
      confidenceScore: input.confidenceScore,
      reviewStatus: "pending",
      legalStatus: input.legalStatus,
      sourceUrls: input.sourceUrls,
      observationIds: input.observationIds,
      proposedFrontmatter: input.proposedFrontmatter,
      proposedBody: input.proposedBody,
    })
    .returning();
  if (!candidate) throw new Error("Failed to create routine update candidate");
  return { candidate, created: true };
}

export async function listRoutineCandidates(input: {
  companyId: string;
  routineId: string;
  status?: RoutineCandidateReviewStatus;
}) {
  const filters = [
    eq(routineUpdateCandidates.companyId, input.companyId),
    eq(routineUpdateCandidates.routineId, input.routineId),
  ];
  if (input.status) filters.push(eq(routineUpdateCandidates.reviewStatus, input.status));
  return db
    .select()
    .from(routineUpdateCandidates)
    .where(and(...filters))
    .orderBy(desc(routineUpdateCandidates.createdAt))
    .limit(100);
}

export async function getRoutineCandidate(input: {
  companyId: string;
  routineId: string;
  candidateId: string;
}) {
  const [candidate] = await db
    .select()
    .from(routineUpdateCandidates)
    .where(
      and(
        eq(routineUpdateCandidates.companyId, input.companyId),
        eq(routineUpdateCandidates.routineId, input.routineId),
        eq(routineUpdateCandidates.id, input.candidateId),
      ),
    )
    .limit(1);
  return candidate ?? null;
}

export async function getRoutineCandidateByDedupKey(input: {
  companyId: string;
  dedupKey: string;
}) {
  const [candidate] = await db
    .select()
    .from(routineUpdateCandidates)
    .where(
      and(
        eq(routineUpdateCandidates.companyId, input.companyId),
        eq(routineUpdateCandidates.dedupKey, input.dedupKey),
      ),
    )
    .limit(1);
  return candidate ?? null;
}

export async function resolveRoutineCandidate(input: {
  companyId: string;
  routineId: string;
  candidateId: string;
  status: "approved" | "rejected";
  reviewedBy: string;
  reviewReason?: string | null;
  commitSha?: string | null;
  expectedStatus?: RoutineCandidateReviewStatus;
}) {
  const filters = [
    eq(routineUpdateCandidates.companyId, input.companyId),
    eq(routineUpdateCandidates.routineId, input.routineId),
    eq(routineUpdateCandidates.id, input.candidateId),
  ];
  if (input.expectedStatus) {
    filters.push(eq(routineUpdateCandidates.reviewStatus, input.expectedStatus));
  }
  const [candidate] = await db
    .update(routineUpdateCandidates)
    .set({
      reviewStatus: input.status,
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
      reviewReason: input.reviewReason ?? null,
      commitSha: input.commitSha ?? null,
      updatedAt: new Date(),
    })
    .where(and(...filters))
    .returning();
  return candidate ?? null;
}

export async function claimRoutineCandidateForApproval(input: {
  companyId: string;
  routineId: string;
  candidateId: string;
  reviewedBy: string;
}) {
  const [candidate] = await db
    .update(routineUpdateCandidates)
    .set({
      reviewStatus: "approving",
      reviewedBy: input.reviewedBy,
      reviewedAt: new Date(),
      reviewReason: null,
      commitSha: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(routineUpdateCandidates.companyId, input.companyId),
        eq(routineUpdateCandidates.routineId, input.routineId),
        eq(routineUpdateCandidates.id, input.candidateId),
        eq(routineUpdateCandidates.reviewStatus, "pending"),
      ),
    )
    .returning();
  return candidate ?? null;
}

export async function releaseRoutineCandidateApprovalClaim(input: {
  companyId: string;
  routineId: string;
  candidateId: string;
  reviewedBy: string;
  error: string;
}) {
  const [candidate] = await db
    .update(routineUpdateCandidates)
    .set({
      reviewStatus: "pending",
      reviewedBy: null,
      reviewedAt: null,
      reviewReason: `Approval failed before commit: ${input.error}`.slice(0, 500),
      commitSha: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(routineUpdateCandidates.companyId, input.companyId),
        eq(routineUpdateCandidates.routineId, input.routineId),
        eq(routineUpdateCandidates.id, input.candidateId),
        eq(routineUpdateCandidates.reviewStatus, "approving"),
        eq(routineUpdateCandidates.reviewedBy, input.reviewedBy),
      ),
    )
    .returning();
  return candidate ?? null;
}

export async function countRoutineCandidatesByWindow(input: {
  companyId: string;
  routineId: string;
  windowStart: Date;
  windowEnd: Date;
}) {
  const rows = await db
    .select({
      reviewStatus: routineUpdateCandidates.reviewStatus,
      legalStatus: routineUpdateCandidates.legalStatus,
      count: sql<number>`count(*)::int`,
    })
    .from(routineUpdateCandidates)
    .where(
      and(
        eq(routineUpdateCandidates.companyId, input.companyId),
        eq(routineUpdateCandidates.routineId, input.routineId),
        gte(routineUpdateCandidates.createdAt, input.windowStart),
        lt(routineUpdateCandidates.createdAt, input.windowEnd),
      ),
    )
    .groupBy(routineUpdateCandidates.reviewStatus, routineUpdateCandidates.legalStatus);
  return rows;
}

export async function countRoutineObservationsByWindow(input: {
  companyId: string;
  routineId: string;
  windowStart: Date;
  windowEnd: Date;
}) {
  return db
    .select({
      changeKind: routineObservations.changeKind,
      status: routineObservations.status,
      count: sql<number>`count(*)::int`,
    })
    .from(routineObservations)
    .innerJoin(routineRuns, eq(routineObservations.routineRunId, routineRuns.id))
    .where(
      and(
        eq(routineObservations.companyId, input.companyId),
        eq(routineRuns.routineId, input.routineId),
        gte(routineObservations.createdAt, input.windowStart),
        lt(routineObservations.createdAt, input.windowEnd),
      ),
    )
    .groupBy(routineObservations.changeKind, routineObservations.status);
}

export async function createRoutineDigestArtifact(input: {
  routineId: string;
  companyId: string;
  windowStart: Date;
  windowEnd: Date;
  candidateCount: number;
  approvedCount: number;
  rejectedCount: number;
  changedSourceCount: number;
  previousWindowStats: Record<string, unknown>;
  artifactPath?: string | null;
  commitSha?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const [existing] = await db
    .select()
    .from(routineDigestArtifacts)
    .where(
      and(
        eq(routineDigestArtifacts.routineId, input.routineId),
        eq(routineDigestArtifacts.windowStart, input.windowStart),
        eq(routineDigestArtifacts.windowEnd, input.windowEnd),
      ),
    )
    .limit(1);
  if (existing) {
    const [updated] = await db
      .update(routineDigestArtifacts)
      .set({
        status: input.commitSha ? "committed" : "preview",
        candidateCount: input.candidateCount,
        approvedCount: input.approvedCount,
        rejectedCount: input.rejectedCount,
        changedSourceCount: input.changedSourceCount,
        previousWindowStats: input.previousWindowStats,
        artifactPath: input.artifactPath ?? null,
        commitSha: input.commitSha ?? null,
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      })
      .where(eq(routineDigestArtifacts.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [artifact] = await db
    .insert(routineDigestArtifacts)
    .values({
      routineId: input.routineId,
      companyId: input.companyId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      status: input.commitSha ? "committed" : "preview",
      candidateCount: input.candidateCount,
      approvedCount: input.approvedCount,
      rejectedCount: input.rejectedCount,
      changedSourceCount: input.changedSourceCount,
      previousWindowStats: input.previousWindowStats,
      artifactPath: input.artifactPath ?? null,
      commitSha: input.commitSha ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();
  if (!artifact) throw new Error("Failed to create routine digest artifact");
  return artifact;
}

export async function listRoutineDigestArtifacts(companyId: string, routineId: string) {
  return db
    .select()
    .from(routineDigestArtifacts)
    .where(
      and(
        eq(routineDigestArtifacts.companyId, companyId),
        eq(routineDigestArtifacts.routineId, routineId),
      ),
    )
    .orderBy(desc(routineDigestArtifacts.createdAt))
    .limit(50);
}
