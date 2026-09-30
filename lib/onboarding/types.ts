/**
 * Chat-first onboarding types.
 *
 * State is split across three homes (per Architect review §2):
 *   - thread-scoped   → chat_threads.runtime_metadata.onboarding
 *                       (what the bot already asked, ephemeral chat UX state)
 *   - company-scoped  → companies.settings.onboarding
 *                       (company-level decisions: companyType, firstWorkflow,
 *                        connectorsLinked, handoffAt — shared across users
 *                        and tabs of the same company)
 *   - user-scoped     → users.current_onboarding_thread_id
 *                       (resume pointer, lets cross-device deep-link return
 *                        to the in-flight onboarding thread)
 *
 * Content (company-type buckets, first-workflow options, starter questions,
 * trust copy) lives in app/onboarding/_content/ — not here. Per Architect §5.
 */

import { z } from "zod";

import type {
  CompanyProfileFieldId,
  CompanyProfileProgress,
  SetupProgress,
} from "@/app/onboarding/_lib/company-profile-progress";

/** Where thread-scoped onboarding state lives on chat_threads.runtime_metadata. */
export const ONBOARDING_METADATA_KEY = "onboarding" as const;
export const ONBOARDING_THREAD_KIND = "onboarding" as const;

/**
 * Where company-scoped chat-onboarding state lives on companies.settings.
 * NOTE: deliberately NOT "onboarding" — that key is already owned by the
 * legacy onboarding flow (/api/onboarding/complete writes a different
 * shape there: founderRole, primaryQuestion, companyProfile, setupProgress,
 * completedAt). We use a distinct key so the two never collide.
 */
export const ONBOARDING_COMPANY_SETTINGS_KEY = "onboardingChat" as const;

/** Current schema version for both bot-progress and company-onboarding payloads. */
export const ONBOARDING_SCHEMA_VERSION = 1 as const;

/* ─────────────────────────────────────────────────────────────────────── */
/* Thread-scoped: what the bot already prompted for                       */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Per-thread bot progress. ONLY tracks "what did the bot already ask /
 * surface" so we don't repeat prompts across reloads. Source of truth for
 * answers/decisions lives elsewhere (canonical profile on companies.settings
 * for profile fields, OnboardingCompanyState for company-level picks).
 */
export const BotProgressSchema = z.object({
  version: z.literal(ONBOARDING_SCHEMA_VERSION).default(ONBOARDING_SCHEMA_VERSION),
  startedAt: z.string(),
  /** Profile fields the bot has already prompted for (regardless of answer). */
  promptedFields: z.array(z.string()).default([]),
  /** Whether the bot has shown the document dropzone in this thread. */
  documentsRequested: z.boolean().default(false),
  /** Whether the bot has shown any connector card in this thread. */
  connectorsRequested: z.boolean().default(false),
  /** Whether the bot has shown the starter-question chip card. */
  starterQuestionsOffered: z.boolean().default(false),
  /** Whether the bot already prompted founder-vs-assistant question. */
  founderRolePrompted: z.boolean().default(false),
});

export type BotProgress = z.infer<typeof BotProgressSchema>;

export function emptyBotProgress(): BotProgress {
  return BotProgressSchema.parse({
    version: ONBOARDING_SCHEMA_VERSION,
    startedAt: new Date().toISOString(),
  });
}

/**
 * Safe parser — falls back to empty progress on malformed payload. Use
 * everywhere we read jsonb, never raw cast. Per Forge review M1.
 */
export function parseBotProgress(raw: unknown): BotProgress {
  const result = BotProgressSchema.safeParse(raw);
  return result.success ? result.data : emptyBotProgress();
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Company-scoped: decisions that survive thread / user                   */
/* ─────────────────────────────────────────────────────────────────────── */

export const OnboardingCompanyStateSchema = z.object({
  version: z.literal(ONBOARDING_SCHEMA_VERSION).default(ONBOARDING_SCHEMA_VERSION),
  /** Inferred or chosen company-type bucket. See onboarding-content. */
  companyType: z.string().nullable().default(null),
  /** Chosen first workflow. See onboarding-content. */
  firstWorkflow: z.string().nullable().default(null),
  /** Connector providers that have been linked during onboarding. */
  connectorsLinked: z.array(z.string()).default([]),
  /** Counted documents the user dropped during onboarding. */
  documentsUploaded: z.number().int().nonnegative().default(0),
  /** Whether the user is the founder ("self") or someone acting on their behalf ("assistant"). */
  actingAs: z.enum(["self", "assistant"]).nullable().default(null),
  /** Timestamp when the bot performed the "minimally complete" handoff. */
  handoffAt: z.string().nullable().default(null),
});

export type OnboardingCompanyState = z.infer<typeof OnboardingCompanyStateSchema>;

export function emptyOnboardingCompanyState(): OnboardingCompanyState {
  return OnboardingCompanyStateSchema.parse({
    version: ONBOARDING_SCHEMA_VERSION,
  });
}

export function parseOnboardingCompanyState(raw: unknown): OnboardingCompanyState {
  const result = OnboardingCompanyStateSchema.safeParse(raw);
  return result.success ? result.data : emptyOnboardingCompanyState();
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Snapshot composition + readiness predicates                            */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Composite snapshot the model reads at the start of each onboarding turn
 * (via the onboarding_get_snapshot tool). Per Designer review §11.5:
 * only invoke at handoff-check, NOT every turn — keep priority in the
 * system prompt.
 */
export interface OnboardingSnapshot {
  companyId: string | null;
  companyProfile: CompanyProfileProgress;
  setupProgress: SetupProgress;
  companyState: OnboardingCompanyState;
  botProgress: BotProgress;
}

/**
 * The thin "minimum to allow handoff" floor — used as the absolute lower
 * bound the model is permitted to call onboarding_complete_and_handoff at,
 * if the user has explicitly insisted ("just let me ask my question").
 *
 * Mirrors the V1 shell scope per
 * docs/architecture/chat-first-onboarding-agent.md: companyName +
 * primaryQuestion answered.
 */
export function isMinimallyReadyForHandoff(snapshot: OnboardingSnapshot): boolean {
  if (!snapshot.companyId) return false;
  if (!snapshot.companyProfile.requiredComplete) return false;
  const primary = snapshot.companyProfile.fields.find(
    (field) => field.id === "primaryQuestion",
  );
  return primary?.status === "complete";
}

/**
 * The stronger "ready for the CFO chat to give useful answers" predicate
 * — per Forge M3 + Architect §6. This is what the bot's decision rule
 * uses to choose between "keep gathering" and "offer handoff". If false
 * but isMinimallyReadyForHandoff true, the bot OFFERS handoff but does
 * NOT auto-trigger; user must opt in.
 */
export function isReadyForUsefulAnswers(snapshot: OnboardingSnapshot): boolean {
  if (!isMinimallyReadyForHandoff(snapshot)) return false;
  // Need jurisdiction inferred or asked — without it CFO can't scope queries.
  const jurisdiction = snapshot.companyProfile.fields.find(
    (field) => field.id === "jurisdiction",
  );
  if (jurisdiction?.status !== "complete") return false;
  // Need some grounding signal: at least one connector OR one doc OR
  // explicit "I'll skip data for now" flag captured on companyState.
  const hasData =
    snapshot.companyState.connectorsLinked.length > 0 ||
    snapshot.companyState.documentsUploaded > 0;
  return hasData;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Tool name constants                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Tool names the onboarding system prompt grants to the model. Each name
 * has a matching ToolUI registration on the frontend and a server-side
 * handler that mutates state.
 *
 * Per Forge M4: the choice card is split into two type-narrow variants —
 * company_type vs first_workflow — so the post-click write path can
 * statically pick the right field.
 */
export const ONBOARDING_TOOLS = {
  /** Persists a single profile field the user answered in free text. */
  SaveProfileField: "onboarding_save_profile_field",
  /** Renders a small inline form for 1-3 profile fields. */
  RenderProfileForm: "onboarding_render_profile_form",
  /** Renders a multi-file dropzone scoped to onboarding purpose. */
  RenderDocumentDropzone: "onboarding_render_document_dropzone",
  /** Renders a single connector card with provider-specific OAuth flow. */
  RenderConnectorCard: "onboarding_render_connector_card",
  /** Renders the value-first starter-question chip card (cash runway / P&L / leaks / open). */
  RenderStarterQuestions: "onboarding_render_starter_questions",
  /** Renders a company-type choice card (single / multi / holding / fractional). */
  RenderCompanyTypeChoice: "onboarding_render_company_type_choice",
  /** Renders a first-workflow choice card (morning brief / board pack / data room / customMcp). */
  RenderFirstWorkflowChoice: "onboarding_render_first_workflow_choice",
  /** Returns the current snapshot. Called only at handoff check time. */
  GetSnapshot: "onboarding_get_snapshot",
  /** Marks a field as "user wants to skip" so the bot doesn't loop. Per Forge M5. */
  RecordSkip: "onboarding_record_skip",
  /** Performs the final handoff — marks complete + posts goodbye + clears resume pointer. */
  CompleteAndHandoff: "onboarding_complete_and_handoff",
} as const;

export type OnboardingToolName =
  (typeof ONBOARDING_TOOLS)[keyof typeof ONBOARDING_TOOLS];

/** Profile fields the bot will ASK in chat (per Designer §3). */
export const PROFILE_FIELDS_ASKED: CompanyProfileFieldId[] = [
  "companyName",
  "founderRole",
  "primaryQuestion",
];

/** Profile fields the bot will try to INFER from docs/website (per Designer §3). */
export const PROFILE_FIELDS_INFERRED: CompanyProfileFieldId[] = [
  "jurisdiction",
  "entityType",
  "businessType",
  "website",
  "companyStage",
];

/** Profile fields cut from chat onboarding entirely (per Designer §3). */
export const PROFILE_FIELDS_CUT: CompanyProfileFieldId[] = ["operatingContext"];
