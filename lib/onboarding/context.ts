/**
 * Per-request implementation of `OnboardingExecutionContext`.
 *
 * The chat route builds one of these per onboarding turn and feeds it to
 * `buildOnboardingToolset(ctx)`. Each context method maps to a state
 * mutation in `./state` so the tool execute closures stay tiny and
 * testable.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";

import {
  deriveCompanyProfileProgress,
  type CompanyProfileProgressInput,
} from "@/app/onboarding/_lib/company-profile-progress";

import { releaseOnboardingThread } from "./bootstrap";
import { writeOnboardingProfileFields } from "./profile-write";
import {
  getOnboardingCompanyState,
  incrementDocumentsUploaded,
  recordConnectorLinked,
  recordHandoff,
  updateBotProgress,
  updateOnboardingCompanyState,
} from "./state";
import type { OnboardingExecutionContext } from "./tool-specs";

interface BuildContextInput {
  threadId: string;
  companyId: string;
  userId: string;
}

/**
 * Builds the execution context for an onboarding turn. The chat route
 * resolves threadId/companyId/userId from the session + thread row, then
 * passes them here.
 */
export function buildOnboardingExecutionContext(
  input: BuildContextInput,
): OnboardingExecutionContext {
  const { threadId, companyId, userId } = input;
  return {
    threadId,
    companyId,
    userId,

    async markFieldPrompted(field: string) {
      return updateBotProgress(threadId, (current) => ({
        ...current,
        promptedFields: Array.from(
          new Set([...current.promptedFields, field]),
        ),
      }));
    },

    async setStarterQuestionsOffered() {
      return updateBotProgress(threadId, (current) => ({
        ...current,
        starterQuestionsOffered: true,
      }));
    },

    async setDocumentsRequested() {
      return updateBotProgress(threadId, (current) => ({
        ...current,
        documentsRequested: true,
      }));
    },

    async setConnectorsRequested() {
      return updateBotProgress(threadId, (current) => ({
        ...current,
        connectorsRequested: true,
      }));
    },

    async setFounderRolePrompted() {
      return updateBotProgress(threadId, (current) => ({
        ...current,
        founderRolePrompted: true,
      }));
    },

    async setCompanyType(companyType: string) {
      return updateOnboardingCompanyState(companyId, (current) => ({
        ...current,
        companyType,
      }));
    },

    async setFirstWorkflow(firstWorkflow: string) {
      return updateOnboardingCompanyState(companyId, (current) => ({
        ...current,
        firstWorkflow,
      }));
    },

    async setActingAs(actingAs: "self" | "assistant") {
      return updateOnboardingCompanyState(companyId, (current) => ({
        ...current,
        actingAs,
      }));
    },

    async recordHandoff() {
      return recordHandoff(companyId);
    },

    async releaseResumePointer() {
      await releaseOnboardingThread(userId);
    },

    async saveProfileField(field, value) {
      await writeOnboardingProfileFields(companyId, { [field]: value });
    },

    async getSnapshotSummary() {
      const [companyRow] = await db
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
      const companyState = await getOnboardingCompanyState(companyId);
      const settings = (companyRow?.settings ?? {}) as Record<string, unknown>;
      const legacyOnboarding =
        settings.onboarding && typeof settings.onboarding === "object"
          ? (settings.onboarding as Record<string, unknown>)
          : {};
      const profileInput: CompanyProfileProgressInput = {
        companyName: companyRow?.name ?? null,
        jurisdiction: companyRow?.jurisdiction,
        entityType: companyRow?.entityType,
        businessType: companyRow?.businessType,
        website: companyRow?.website,
        founderRole: legacyOnboarding.founderRole,
        companyStage: legacyOnboarding.companyStage,
        primaryQuestion: legacyOnboarding.primaryQuestion,
        operatingContext: legacyOnboarding.operatingContext,
      };
      const profile = deriveCompanyProfileProgress(profileInput);
      return {
        companyName: companyRow?.name ?? null,
        completedFields: profile.completedFields,
        totalFields: profile.totalFields,
        requiredComplete: profile.requiredComplete,
        documentsUploaded: companyState.documentsUploaded,
        connectorsLinked: companyState.connectorsLinked,
      };
    },
  };
}

/**
 * Side-effect: every document upload that lands in an onboarding thread
 * should bump the company-level counter. Called by the upload route when
 * the linked thread is kind='onboarding'.
 */
export async function handleOnboardingDocumentUpload(input: {
  companyId: string;
}): Promise<void> {
  await incrementDocumentsUploaded(input.companyId, 1);
}

/**
 * Side-effect: every successful OAuth callback in an onboarding context
 * should record the connector against the company onboarding state.
 * Called by the OAuth callback bridge when state has onboarding_thread_id.
 */
export async function handleOnboardingConnectorLinked(input: {
  companyId: string;
  provider: string;
}): Promise<void> {
  await recordConnectorLinked(input.companyId, input.provider);
}
