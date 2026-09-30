import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq, sql, type SQL } from "drizzle-orm";
import { headers } from "next/headers";
import { NoCompanyError, UnauthorizedError } from "@/lib/errors";
import { getRequestedCompanyIdFromHeaders } from "@/lib/company-context";
import { requireCompanyWithRole } from "@/lib/db/tenant";
import { normalizeCompanyDescription } from "@/lib/company-settings";
import {
  deriveCompanyProfileProgress,
  deriveSetupProgress,
} from "@/app/onboarding/_lib/company-profile-progress";

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringList(value: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
  return normalized.length > 0 ? normalized : undefined;
}

const ONBOARDING_PATHS = new Set(["demo", "file", "bank", "manual"]);
const HANDOFF_TARGETS = new Set([
  "/assistant",
  "/documents",
  "/integrations",
  "/dashboard",
  "/settings/companies",
]);

function readOnboardingPath(value: unknown): string | undefined {
  const normalized = readOptionalString(value);
  if (!normalized) return undefined;
  return ONBOARDING_PATHS.has(normalized) ? normalized : undefined;
}

function readHandoffTarget(value: unknown): string {
  const normalized = readOptionalString(value);
  if (!normalized) return "/assistant";
  return HANDOFF_TARGETS.has(normalized) ? normalized : "/assistant";
}

export async function POST(req: Request) {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestedCompanyId = getRequestedCompanyIdFromHeaders(hdrs);
  let companyId: string;
  try {
    const membership = requestedCompanyId
      ? await requireCompanyWithRole(session.user.id, requestedCompanyId)
      : await requireCompanyWithRole(session.user.id);
    companyId = membership.companyId;
  } catch (err) {
    if (err instanceof NoCompanyError) {
      return NextResponse.json({ error: "No company found" }, { status: 404 });
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const companyName = readOptionalString(body.companyName);
  if (!companyName) {
    return NextResponse.json({ error: "Company name is required" }, { status: 400 });
  }
  if (companyName.length > 120) {
    return NextResponse.json(
      { error: "Company name must be 120 characters or fewer" },
      { status: 400 },
    );
  }

  const jurisdiction = readOptionalString(body.jurisdiction);
  const entityType = readOptionalString(body.entityType);
  const businessType = readOptionalString(body.businessType);
  const website = readOptionalString(body.website);
  const livingCountry = readOptionalString(body.livingCountry);
  const revenueRange = readOptionalString(body.revenueRange);
  const isDigitalNomad =
    typeof body.isDigitalNomad === "boolean" ? body.isDigitalNomad : undefined;
  const tools = isRecord(body.tools) ? body.tools : undefined;
  const companyDescription = normalizeCompanyDescription(body.companyDescription);
  const onboardingPath = readOnboardingPath(body.onboardingPath);
  const founderRole = readOptionalString(body.founderRole);
  const companyStage = readOptionalString(body.companyStage);
  const primaryQuestion = readOptionalString(body.primaryQuestion);
  const operatingContext = readOptionalString(body.operatingContext);
  const goals = readStringList(body.goals, 5);
  const connectorNextSteps = readStringList(body.connectorNextSteps, 8);
  const handoffTarget = readHandoffTarget(body.handoffTarget);
  const companyProfile = deriveCompanyProfileProgress({
    companyName,
    jurisdiction,
    entityType,
    businessType,
    website,
    founderRole,
    companyStage,
    primaryQuestion,
    operatingContext: operatingContext ?? companyDescription,
  });
  const setupProgress = deriveSetupProgress(companyProfile, {
    onboardingPath,
    handoffTarget,
    complete: true,
  });

  const completedAt = new Date().toISOString();

  // DATA-3: path-scoped settings writes. Build a chain of jsonb_set / #- calls
  // so concurrent writers to other sub-paths (onboardingChat, codexWorkerPool,
  // ingestToken, etc.) are never clobbered.
  //
  // settings.onboarding is merged with the existing sub-object so any keys
  // written by other agents (e.g. documentsUploaded) are preserved.
  const onboardingPatch = {
    completedAt,
    path: onboardingPath,
    founderRole,
    companyStage,
    primaryQuestion,
    operatingContext,
    goals,
    connectorNextSteps,
    handoffTarget,
    companyProfile,
    setupProgress,
  };

  let settingsSql = sql`COALESCE(${companies.settings}, '{}'::jsonb)`;

  // settings.onboardingCompletedAt
  settingsSql = sql`jsonb_set(${settingsSql}, '{onboardingCompletedAt}', ${JSON.stringify(completedAt)}::jsonb, true)`;

  // settings.onboarding — merge with existing sub-object to preserve sibling keys
  settingsSql = sql`
    jsonb_set(
      ${settingsSql},
      '{onboarding}',
      COALESCE(${companies.settings} -> 'onboarding', '{}'::jsonb)
        || ${JSON.stringify(onboardingPatch)}::jsonb,
      true
    )
  `;

  // settings.companyDescription (optional)
  if (companyDescription) {
    settingsSql = sql`jsonb_set(${settingsSql}, '{companyDescription}', ${JSON.stringify(companyDescription)}::jsonb, true)`;
  }

  // settings.livingCountry (optional)
  if (livingCountry) {
    settingsSql = sql`jsonb_set(${settingsSql}, '{livingCountry}', ${JSON.stringify(livingCountry)}::jsonb, true)`;
  }

  // settings.isDigitalNomad (optional boolean)
  if (typeof isDigitalNomad === "boolean") {
    settingsSql = sql`jsonb_set(${settingsSql}, '{isDigitalNomad}', ${JSON.stringify(isDigitalNomad)}::jsonb, true)`;
  }

  // settings.revenueRange (optional)
  if (revenueRange) {
    settingsSql = sql`jsonb_set(${settingsSql}, '{revenueRange}', ${JSON.stringify(revenueRange)}::jsonb, true)`;
  }

  // settings.tools (optional)
  if (tools) {
    settingsSql = sql`jsonb_set(${settingsSql}, '{tools}', ${JSON.stringify(tools)}::jsonb, true)`;
  }

  const updateValues: {
    name: string;
    jurisdiction?: string;
    entityType?: string;
    businessType?: string;
    website?: string;
    settings: SQL;
    updatedAt: Date;
  } = {
    name: companyName,
    settings: settingsSql,
    updatedAt: new Date(),
  };
  if (jurisdiction) updateValues.jurisdiction = jurisdiction;
  if (entityType) updateValues.entityType = entityType;
  if (businessType) updateValues.businessType = businessType;
  if (website) updateValues.website = website;

  await db.update(companies).set(updateValues).where(eq(companies.id, companyId));

  return NextResponse.json({ status: "ok", handoffTarget, companyProfile, setupProgress });
}
