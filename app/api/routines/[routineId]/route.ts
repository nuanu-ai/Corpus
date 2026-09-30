import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import {
  requireRoutineDomainAccess,
  requireRoutinePolicyAdmin,
} from "@/lib/routines/api-access";
import {
  getCompanyRoutine,
  listRoutineSources,
  recordRoutineAuditLog,
  updateCompanyRoutine,
} from "@/lib/routines/store";
import { buildAutomationManifestV1 } from "@/lib/routines/manifest";
import { isReportAutomationTemplateKey } from "@/lib/routines/types";

const VALID_ACTIONS = new Set(["pause", "resume", "archive"]);

const schedulePolicySchema = z.object({
  manualOnly: z.literal(true),
  cadence: z.literal("manual"),
}).strict();

const localTimeSchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
}).strict();

const localAnchorSchema = localTimeSchema.extend({
  dayOfWeek: z.number().int().min(1).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
}).strict();

const reportSchedulePolicySchema = z.object({
  cadence: z.enum(["daily", "weekly", "monthly"]),
  timezone: z.string().trim().min(1).max(80),
  localAnchor: localAnchorSchema,
  dueTime: localTimeSchema,
  dueOffsetDays: z.number().int().min(0).max(31),
  catchUpPolicy: z.enum(["none", "last_due_only", "bounded"]),
  maxBackfillWindowCount: z.number().int().min(1).max(366),
  manualRunEnabled: z.boolean().optional(),
  schedulerEnabled: z.boolean().optional(),
}).strict();

const sourcePolicySchema = z.object({
  allowlistOnly: z.literal(true),
  maxSourcesPerRun: z.number().int().min(1).max(20).optional(),
  collectionInstructions: z.string().trim().max(2000).optional(),
  watchTopics: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  includeKeywords: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  excludeKeywords: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  reviewerChecklist: z.array(z.string().trim().min(1).max(160)).max(20).optional(),
}).strict();

const reportSourcePolicySchema = z.object({
  sourceStatusModel: z.literal("available_partial_unavailable_failed"),
  configuredSourcesRequiredBeforeActivation: z.literal(false).optional(),
  builtInSources: z.array(z.enum(["odoo", "company_db", "documents"])).min(1).max(3),
  collectionInstructions: z.string().trim().max(2000).optional(),
  maxItemsPerSource: z.number().int().min(1).max(200).optional(),
}).strict();

const reviewPolicySchema = z.object({
  reviewRequired: z.literal(true),
  mode: z.enum(["human_only", "human_or_scoped_api_key"]).optional(),
  rejectionRequiresReason: z.boolean().optional(),
}).strict();

const reportReviewPolicySchema = z.object({
  reviewRequired: z.literal(true),
  mode: z.enum(["human_or_scoped_api_key"]),
  publishPolicy: z.enum(["review_required", "preview_only"]),
}).strict();

const digestPolicySchema = z.object({
  previewOnly: z.literal(true),
  delivery: z.literal("disabled"),
}).strict();

const reportDigestPolicySchema = z.object({
  previewOnly: z.literal(true),
  delivery: z.literal("disabled"),
  artifactFormats: z.array(z.enum(["markdown", "xlsx", "docx"])).min(1).max(3).optional(),
}).strict();

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validatePolicy<T>(
  schema: z.ZodType<T>,
  value: Record<string, unknown> | undefined,
  label: string,
): { policy?: T; error?: string } {
  if (!value) return {};
  const result = schema.safeParse(value);
  if (!result.success) {
    return {
      error: `${label} violates first-release invariants: ${result.error.issues[0]?.message ?? "invalid policy"}`,
    };
  }
  return { policy: result.data };
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ routineId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine);
    const sources = await listRoutineSources(auth.companyId, routineId);
    const manifest = buildAutomationManifestV1({ routine, sources });
    return NextResponse.json({ routine, sources, manifest });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ routineId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "write");

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : undefined;
    if (action && !VALID_ACTIONS.has(action)) {
      return NextResponse.json({ error: "action must be pause, resume, or archive" }, { status: 400 });
    }
    if (
      action === "resume" &&
      routine.createdFrom === "chat_draft" &&
      routine.status === "draft" &&
      body.confirmActivation !== true
    ) {
      return NextResponse.json(
        { error: "confirmActivation=true is required to activate an agent-created draft routine" },
        { status: 409 },
      );
    }
    if (
      action === "resume" &&
      isReportAutomationTemplateKey(routine.templateKey) &&
      metadataRecord(routine.metadata).sourcesConfigured !== true
    ) {
      return NextResponse.json(
        { error: "Report automation sources must be configured before activation" },
        { status: 409 },
      );
    }

    const policy = objectValue(body.policy);
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : undefined;
    const rawSchedulePolicy = objectValue(body.schedulePolicy) ?? objectValue(policy?.schedulePolicy);
    const rawSourcePolicy = objectValue(body.sourcePolicy) ?? objectValue(policy?.sourcePolicy);
    const rawReviewPolicy = objectValue(body.reviewPolicy) ?? objectValue(policy?.reviewPolicy);
    const rawDigestPolicy = objectValue(body.digestPolicy) ?? objectValue(policy?.digestPolicy);
    const hasPolicyUpdate = Boolean(rawSchedulePolicy || rawSourcePolicy || rawReviewPolicy || rawDigestPolicy);
    if (hasPolicyUpdate) {
      requireRoutinePolicyAdmin(auth);
    }
    const isReportRoutine = isReportAutomationTemplateKey(routine.templateKey);
    const schedulePolicy = isReportRoutine
      ? validatePolicy(reportSchedulePolicySchema, rawSchedulePolicy, "schedulePolicy")
      : validatePolicy(schedulePolicySchema, rawSchedulePolicy, "schedulePolicy");
    const sourcePolicy = isReportRoutine
      ? validatePolicy(reportSourcePolicySchema, rawSourcePolicy, "sourcePolicy")
      : validatePolicy(sourcePolicySchema, rawSourcePolicy, "sourcePolicy");
    const reviewPolicy = isReportRoutine
      ? validatePolicy(reportReviewPolicySchema, rawReviewPolicy, "reviewPolicy")
      : validatePolicy(reviewPolicySchema, rawReviewPolicy, "reviewPolicy");
    const digestPolicy = isReportRoutine
      ? validatePolicy(reportDigestPolicySchema, rawDigestPolicy, "digestPolicy")
      : validatePolicy(digestPolicySchema, rawDigestPolicy, "digestPolicy");
    const policyError =
      schedulePolicy.error ?? sourcePolicy.error ?? reviewPolicy.error ?? digestPolicy.error;
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }
    const update = {
      companyId: auth.companyId,
      routineId,
      title,
      status: action === "pause"
        ? "paused" as const
        : action === "resume"
          ? "active" as const
          : action === "archive"
            ? "archived" as const
            : undefined,
      schedulePolicy: schedulePolicy.policy,
      sourcePolicy: sourcePolicy.policy,
      reviewPolicy: reviewPolicy.policy,
      digestPolicy: digestPolicy.policy,
    };

    if (
      !update.title &&
      !update.status &&
      !update.schedulePolicy &&
      !update.sourcePolicy &&
      !update.reviewPolicy &&
      !update.digestPolicy
    ) {
      return NextResponse.json(
        { error: "Provide action, title, or policy update" },
        { status: 400 },
      );
    }

    const updated = await updateCompanyRoutine(update);
    if (!updated) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    await recordRoutineAuditLog({
      companyId: auth.companyId,
      userId: auth.userId,
      action: "routine_definition_updated",
      entityType: "routine_definition",
      entityId: routineId,
      oldValue: {
        title: routine.title,
        status: routine.status,
        schedulePolicy: routine.schedulePolicy,
        sourcePolicy: routine.sourcePolicy,
        reviewPolicy: routine.reviewPolicy,
        digestPolicy: routine.digestPolicy,
      },
      newValue: {
        title: updated.title,
        status: updated.status,
        schedulePolicy: updated.schedulePolicy,
        sourcePolicy: updated.sourcePolicy,
        reviewPolicy: updated.reviewPolicy,
        digestPolicy: updated.digestPolicy,
      },
      details: {
        action: action ?? null,
        hasPolicyUpdate,
      },
    });
    return NextResponse.json({ routine: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
