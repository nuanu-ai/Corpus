import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import {
  canReadRoutine,
  requireRoutineDomainAccess,
  requireRoutinePolicyAdmin,
} from "@/lib/routines/api-access";
import {
  createBkpmLegalWatchRoutine,
  createReportAutomationRoutine,
  listCompanyRoutines,
} from "@/lib/routines/store";
import {
  LEGAL_WATCH_BKPM_TEMPLATE_KEY,
  isReportAutomationTemplateKey,
  type RoutineScopeType,
} from "@/lib/routines/types";

const ROUTINE_SCOPE_TYPES = new Set<RoutineScopeType>(["company"]);

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

const reportSourcePolicySchema = z.object({
  sourceStatusModel: z.literal("available_partial_unavailable_failed"),
  configuredSourcesRequiredBeforeActivation: z.literal(false).optional(),
  builtInSources: z.array(z.enum(["odoo", "company_db", "documents"])).min(1).max(3),
  collectionInstructions: z.string().trim().max(2000).optional(),
  maxItemsPerSource: z.number().int().min(1).max(200).optional(),
}).strict();

const reportReviewPolicySchema = z.object({
  reviewRequired: z.literal(true),
  mode: z.enum(["human_or_scoped_api_key"]),
  publishPolicy: z.enum(["review_required", "preview_only"]),
}).strict();

const reportDigestPolicySchema = z.object({
  previewOnly: z.literal(true),
  delivery: z.literal("disabled"),
  artifactFormats: z.array(z.enum(["markdown", "xlsx", "docx"])).min(1).max(3).optional(),
}).strict();

function parseScopeType(value: unknown): RoutineScopeType | null {
  const candidate = typeof value === "string" ? value : "company";
  return ROUTINE_SCOPE_TYPES.has(candidate as RoutineScopeType)
    ? candidate as RoutineScopeType
    : null;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function validateOptionalPolicy<T>(
  schema: z.ZodType<T>,
  value: Record<string, unknown> | undefined,
  label: string,
): { policy?: T; error?: string } {
  if (!value) return {};
  const result = schema.safeParse(value);
  if (!result.success) {
    return {
      error: `${label} violates report automation invariants: ${result.error.issues[0]?.message ?? "invalid policy"}`,
    };
  }
  return { policy: result.data };
}

export async function GET() {
  try {
    const auth = await getAuthContext();
    const routines = (await listCompanyRoutines(auth.companyId)).filter((routine) =>
      canReadRoutine(auth, routine),
    );
    return NextResponse.json({ routines });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext();
    const body = await req.json().catch(() => ({}));
    const templateKey = typeof body.templateKey === "string"
      ? body.templateKey
      : LEGAL_WATCH_BKPM_TEMPLATE_KEY;
    const isReportTemplate = isReportAutomationTemplateKey(templateKey);
    if (templateKey !== LEGAL_WATCH_BKPM_TEMPLATE_KEY && !isReportTemplate) {
      return NextResponse.json({ error: "Unsupported routine template" }, { status: 400 });
    }
    const domain = isReportTemplate ? "finance" : "legal";
    requireRoutineDomainAccess(auth, { domain, templateKey }, "write");
    const title: string | undefined = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : undefined;
    const scopeType = parseScopeType(body.scopeType);
    if (!scopeType) {
      return NextResponse.json(
        { error: "Only company-scoped routines are enabled in the first production release" },
        { status: 400 },
      );
    }
    const scopeId: string | null = typeof body.scopeId === "string" && body.scopeId.trim()
      ? body.scopeId.trim()
      : null;
    const createdFrom: "template" | "chat_draft" | "api" | "import" =
      body.createdFrom === "chat_draft" ||
      body.createdFrom === "api" ||
      body.createdFrom === "import"
        ? body.createdFrom
        : "template";
    const createMode: "ensure" | "new" = body.createMode === "new" ? "new" : "ensure";
    const routineStatus: "draft" | "paused" = createdFrom === "chat_draft" ? "draft" : "paused";
    const rawSchedulePolicy = objectValue(body.schedulePolicy);
    const rawSourcePolicy = objectValue(body.sourcePolicy);
    const rawReviewPolicy = objectValue(body.reviewPolicy);
    const rawDigestPolicy = objectValue(body.digestPolicy);
    const hasPolicyUpdate = Boolean(rawSchedulePolicy || rawSourcePolicy || rawReviewPolicy || rawDigestPolicy);
    if (hasPolicyUpdate) {
      requireRoutinePolicyAdmin(auth);
    }
    const reportSchedulePolicy = isReportTemplate
      ? validateOptionalPolicy(reportSchedulePolicySchema, rawSchedulePolicy, "schedulePolicy")
      : {};
    const reportSourcePolicy = isReportTemplate
      ? validateOptionalPolicy(reportSourcePolicySchema, rawSourcePolicy, "sourcePolicy")
      : {};
    const reportReviewPolicy = isReportTemplate
      ? validateOptionalPolicy(reportReviewPolicySchema, rawReviewPolicy, "reviewPolicy")
      : {};
    const reportDigestPolicy = isReportTemplate
      ? validateOptionalPolicy(reportDigestPolicySchema, rawDigestPolicy, "digestPolicy")
      : {};
    const policyError =
      reportSchedulePolicy.error ??
      reportSourcePolicy.error ??
      reportReviewPolicy.error ??
      reportDigestPolicy.error;
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
    }
    const baseInput = {
      companyId: auth.companyId,
      userId: auth.userId,
      title,
      scopeType,
      scopeId,
      status: routineStatus,
      createdFrom,
      createMode,
    };
    const routine = isReportTemplate
      ? await createReportAutomationRoutine({
          ...baseInput,
          templateKey,
          schedulePolicy: reportSchedulePolicy.policy,
          sourcePolicy: reportSourcePolicy.policy,
          reviewPolicy: reportReviewPolicy.policy,
          digestPolicy: reportDigestPolicy.policy,
        })
      : await createBkpmLegalWatchRoutine(baseInput);
    return NextResponse.json({ routine }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
