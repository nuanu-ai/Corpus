/**
 * POST /api/onboarding/chat
 *
 * Slim chat streaming endpoint for the onboarding surface. Parallel to
 * /api/chat (which serves company CFO chat) — does NOT mutate or share
 * code with the company route, so changes here cannot affect production
 * CFO chat behavior.
 *
 * Body: { messages: UIMessage[], id?: string, threadId?: string }
 *
 * Flow per turn:
 *   1. Resolve session → companyId + userId (better-auth shell company)
 *   2. Resolve threadId from body
 *   3. Ensure thread is tagged kind='onboarding' (idempotent)
 *   4. Adopt as user's resume pointer (idempotent)
 *   5. Build OnboardingSnapshot (canonical profile + companyState + botProgress)
 *   6. Build onboarding system prompt (carries next-step priority list)
 *   7. Build onboarding tool catalog wired to a per-request execution context
 *   8. streamText with anthropic model + onboarding tools
 *   9. Return UIMessageStreamResponse
 */

import { anthropic } from "@ai-sdk/anthropic";
import { streamText, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";

import {
  deriveCompanyProfileProgress,
  deriveSetupProgress,
  type CompanyProfileProgressInput,
} from "@/app/onboarding/_lib/company-profile-progress";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  convertConsultantMessagesForModel,
  uiMessageSchema,
} from "@/lib/consultant/messages";
import { db } from "@/lib/db";
import { companies, users } from "@/lib/db/schema";
import {
  adoptOnboardingThread,
} from "@/lib/onboarding/bootstrap";
import { buildOnboardingExecutionContext } from "@/lib/onboarding/context";
import {
  ensureOnboardingThread,
  getBotProgress,
  getOnboardingCompanyState,
} from "@/lib/onboarding/state";
import { buildOnboardingSystemPrompt } from "@/lib/onboarding/system-prompt";
import { buildOnboardingToolset } from "@/lib/onboarding/tool-specs";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";
import { eq } from "drizzle-orm";

const requestSchema = z.object({
  messages: z.array(uiMessageSchema).min(1).max(500),
  id: z.string().optional(),
  threadId: z.string().optional(),
});

// Sonnet (not Haiku): the onboarding flow leans on reliable tool-use
// orchestration (calling save_profile_field / render_* in the right order
// off the priority list). Haiku is too weak at that. Override via
// ONBOARDING_CHAT_MODEL if needed.
const ONBOARDING_MODEL = process.env.ONBOARDING_CHAT_MODEL ?? "claude-sonnet-4-6";
const ONBOARDING_MAX_OUTPUT_TOKENS = Number(
  process.env.ONBOARDING_CHAT_MAX_OUTPUT_TOKENS ?? "2048",
);

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = requestSchema.safeParse(json);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Resolve session. Shell company was created at signup by better-auth
    // databaseHooks.user.create.after — every authenticated user has one.
    const session = await getSessionCompanyContext();
    const { companyId, userId } = session;

    const threadId =
      parsed.data.threadId?.trim() || parsed.data.id?.trim() || "";
    if (!threadId) {
      return new Response(
        JSON.stringify({ error: "threadId required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Idempotently tag the thread as onboarding-kind + seed bot progress.
    // Scope every thread mutation/read by {companyId, userId} so a foreign
    // threadId matches zero rows (AUTH-1: closes the cross-tenant IDOR where
    // any authed user could flip another tenant's thread to kind='onboarding'
    // or overwrite its runtimeMetadata.onboarding).
    await ensureOnboardingThread(threadId, { companyId, userId });
    await adoptOnboardingThread({ userId, threadId });

    // Build snapshot for the system prompt — reads the REAL per-thread bot
    // progress so the priority list knows what was already offered (e.g.
    // starter questions) and the bot doesn't re-ask every turn.
    const snapshot = await buildSnapshot({ companyId, userId, threadId });

    // Load user display name + locale.
    const [userRow] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const userDisplayName = userRow?.name ?? null;
    const acceptLanguage = req.headers.get("accept-language") ?? "";
    const locale: "en" | "ru" = acceptLanguage
      .toLowerCase()
      .startsWith("ru")
      ? "ru"
      : "en";

    const systemPrompt = buildOnboardingSystemPrompt({
      snapshot,
      locale,
      userDisplayName,
    });

    const ctx = buildOnboardingExecutionContext({
      threadId,
      companyId,
      userId,
    });
    const toolset = buildOnboardingToolset(ctx);

    const result = streamText({
      model: anthropic(ONBOARDING_MODEL),
      maxOutputTokens: ONBOARDING_MAX_OUTPUT_TOKENS,
      // Cache the system prompt: snapshot-derived but mostly stable across
      // a 5-minute window of conversation turns.
      system: {
        role: "system",
        content: systemPrompt,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
      messages: await convertConsultantMessagesForModel(
        parsed.data.messages as UIMessage[],
      ),
      tools: toolset,
      // 8 gives headroom for a turn that calls get_snapshot, then a
      // render_* tool, then emits a closing text message without
      // truncating mid-turn (which would look like a hang). Per Forge #4.
      stopWhen: stepCountIs(8),
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    return handleApiError(error);
  }
}

async function buildSnapshot(input: {
  companyId: string;
  userId: string;
  threadId: string;
}): Promise<OnboardingSnapshot> {
  // Read profile fields from their CANONICAL locations — the same places
  // /api/onboarding/status reads them: jurisdiction/entityType/businessType/
  // website are columns; founderRole/companyStage/primaryQuestion/
  // operatingContext are nested under settings.onboarding.
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
    .where(eq(companies.id, input.companyId))
    .limit(1);
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
  const companyProfile = deriveCompanyProfileProgress(profileInput);
  const setupProgress = deriveSetupProgress(companyProfile);
  // Read company-scoped decisions and the REAL per-thread bot progress in
  // parallel. The bot progress carries the "already offered / already asked"
  // flags the priority list depends on to avoid re-prompting every turn.
  const [companyState, botProgress] = await Promise.all([
    getOnboardingCompanyState(input.companyId),
    getBotProgress(input.threadId, {
      companyId: input.companyId,
      userId: input.userId,
    }),
  ]);
  return {
    companyId: input.companyId,
    companyProfile,
    setupProgress,
    companyState,
    botProgress,
  };
}

// Re-exported so unit tests can target the same model/limits.
export const ONBOARDING_CHAT_DEFAULTS = {
  model: ONBOARDING_MODEL,
  maxOutputTokens: ONBOARDING_MAX_OUTPUT_TOKENS,
} as const;
