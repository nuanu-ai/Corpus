/**
 * Builds an OnboardingSnapshot from canonical storage. Shared by the
 * unified /api/chat route (onboarding mode) so the onboarding guidance
 * fragment + tools see the real per-company / per-thread state.
 *
 * Reads profile fields from the SAME canonical places /api/onboarding/
 * status reads them: jurisdiction/entityType/businessType/website are
 * company columns; founderRole/companyStage/primaryQuestion/
 * operatingContext are nested under settings.onboarding.
 */

import { eq } from "drizzle-orm";

import {
  deriveCompanyProfileProgress,
  deriveSetupProgress,
  type CompanyProfileProgressInput,
} from "@/app/onboarding/_lib/company-profile-progress";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";

import { getBotProgress, getOnboardingCompanyState } from "./state";
import { ONBOARDING_COMPANY_SETTINGS_KEY } from "./types";
import type { OnboardingSnapshot } from "./types";

interface CompanyRowLike {
  name?: string | null;
  jurisdiction?: string | null;
  entityType?: string | null;
  businessType?: string | null;
  website?: string | null;
  settings?: unknown;
}

export async function buildOnboardingSnapshot(input: {
  companyId: string;
  threadId: string;
  /**
   * When provided, the bot-progress read is scoped to (companyId, userId) so a
   * foreign threadId returns the empty default instead of another tenant's
   * progress (AUTH-1 / MISS-1). The live chat path always passes it.
   */
  userId?: string;
  /** Pass the already-fetched company row to avoid a re-query. */
  companyRow?: CompanyRowLike | null;
}): Promise<OnboardingSnapshot> {
  let row: CompanyRowLike | null | undefined = input.companyRow;
  if (!row) {
    const [fetched] = await db
      .select({
        name: companies.name,
        jurisdiction: companies.jurisdiction,
        entityType: companies.entityType,
        businessType: companies.businessType,
        website: companies.website,
        settings: companies.settings,
      })
      .from(companies)
      .where(eq(companies.id, input.companyId))
      .limit(1);
    row = fetched;
  }

  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  const legacyOnboarding =
    settings.onboarding && typeof settings.onboarding === "object"
      ? (settings.onboarding as Record<string, unknown>)
      : {};
  const profileInput: CompanyProfileProgressInput = {
    companyName: row?.name ?? null,
    jurisdiction: row?.jurisdiction,
    entityType: row?.entityType,
    businessType: row?.businessType,
    website: row?.website,
    founderRole: legacyOnboarding.founderRole,
    companyStage: legacyOnboarding.companyStage,
    primaryQuestion: legacyOnboarding.primaryQuestion,
    operatingContext: legacyOnboarding.operatingContext,
  };
  const companyProfile = deriveCompanyProfileProgress(profileInput);
  const setupProgress = deriveSetupProgress(companyProfile);
  const [companyState, botProgress] = await Promise.all([
    getOnboardingCompanyState(input.companyId),
    getBotProgress(
      input.threadId,
      input.userId
        ? { companyId: input.companyId, userId: input.userId }
        : undefined,
    ),
  ]);
  return {
    companyId: input.companyId,
    companyProfile,
    setupProgress,
    companyState,
    botProgress,
  };
}

/**
 * Onboarding mode = the company has NOT finished onboarding. Mirrors the
 * `complete` logic in /api/onboarding/status EXACTLY so the two never
 * disagree: complete when `settings.onboardingCompletedAt` is set OR the
 * company already has a `businessType`.
 *
 * The `businessType` short-circuit is LEGACY-ONLY (ONB-2): it covers
 * companies created before this flow existed and must NOT terminate an
 * in-progress chat onboarding. The bot persists `businessType` mid-flow
 * (inferred from docs); if that flipped this gate to complete, every
 * onboarding tool + fragment would vanish mid-conversation with no handoff.
 * So `businessType` only counts as completion evidence when the company has
 * NEVER entered chat onboarding — i.e. no `settings.onboardingChat` state
 * exists. Once chat onboarding starts, only `onboardingCompletedAt`
 * (written by the handoff) marks it done.
 *
 * Pass `businessType` (the company column) alongside settings.
 */
export function isOnboardingIncomplete(
  settings: unknown,
  businessType?: string | null,
): boolean {
  const s =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>)
      : null;
  const hasEnteredChatOnboarding = Boolean(
    s &&
      s[ONBOARDING_COMPANY_SETTINGS_KEY] &&
      typeof s[ONBOARDING_COMPANY_SETTINGS_KEY] === "object",
  );

  if (
    !hasEnteredChatOnboarding &&
    typeof businessType === "string" &&
    businessType.trim().length > 0
  ) {
    return false; // legacy established company that never entered chat onboarding
  }

  if (!s) return true;
  const completedAt = s.onboardingCompletedAt;
  return !(typeof completedAt === "string" && completedAt.length > 0);
}
