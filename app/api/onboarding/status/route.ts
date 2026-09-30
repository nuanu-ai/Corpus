import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NoCompanyError, UnauthorizedError } from "@/lib/errors";
import { getRequestedCompanyIdFromHeaders } from "@/lib/company-context";
import { requireCompanyWithRole } from "@/lib/db/tenant";
import {
  deriveCompanyProfileProgress,
  deriveSetupProgress,
  readProfileString,
} from "@/app/onboarding/_lib/company-profile-progress";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildEmptyStatus() {
  const companyProfile = deriveCompanyProfileProgress({});
  return {
    complete: false,
    companyId: null,
    companyProfile,
    setupProgress: deriveSetupProgress(companyProfile),
  };
}

export async function GET() {
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
      return NextResponse.json(buildEmptyStatus());
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }

  if (!companyId) {
    return NextResponse.json(buildEmptyStatus());
  }

  const company = await db
    .select({
      name: companies.name,
      jurisdiction: companies.jurisdiction,
      entityType: companies.entityType,
      businessType: companies.businessType,
      website: companies.website,
      settings: companies.settings,
    })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const settings = (company[0]?.settings ?? {}) as Record<string, unknown>;
  const onboarding = isRecord(settings.onboarding) ? settings.onboarding : {};
  const onboardingCompletedAt = settings.onboardingCompletedAt;
  const complete =
    (typeof onboardingCompletedAt === "string" && onboardingCompletedAt.length > 0) ||
    !!company[0]?.businessType;
  const companyProfile = deriveCompanyProfileProgress({
    companyName: company[0]?.name,
    jurisdiction: company[0]?.jurisdiction,
    entityType: company[0]?.entityType,
    businessType: company[0]?.businessType,
    website: company[0]?.website,
    founderRole: onboarding.founderRole,
    companyStage: onboarding.companyStage,
    primaryQuestion: onboarding.primaryQuestion,
    operatingContext: readProfileString(onboarding.operatingContext) ?? settings.companyDescription,
  });

  return NextResponse.json({
    complete,
    companyId,
    companyProfile,
    setupProgress: deriveSetupProgress(companyProfile, {
      onboardingPath: onboarding.path,
      handoffTarget: onboarding.handoffTarget,
      complete,
    }),
  });
}
