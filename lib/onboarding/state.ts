/**
 * Onboarding state persistence.
 *
 * Three homes (per Architect review §2):
 *
 *   1. Thread-scoped bot progress  → chat_threads.runtime_metadata.onboarding
 *      What the bot already asked. Race-safe via key-scoped jsonb_set
 *      updates so sibling keys (e.g. lastRequestedModel written by codex
 *      chat route) survive. Mutations are field-scoped: clients/server
 *      both write to disjoint sub-paths so they never stomp each other.
 *      Per Forge review H1.
 *
 *   2. Company-scoped onboarding state → companies.settings.onboarding
 *      Decisions that survive thread / user (companyType, firstWorkflow,
 *      connectorsLinked, handoffAt). Second user opening onboarding sees
 *      decisions already made.
 *
 *   3. User-scoped resume pointer  → users.current_onboarding_thread_id
 *      Lets cross-device deep-link return to in-flight onboarding thread.
 *      Resolves two-tabs-same-user case.
 *
 * The thread `kind` is a first-class column (`chat_threads.kind`) — not
 * jsonb-buried — so we can filter from SQL. Per Architect §10, Forge H3.
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chatThreads, companies, users } from "@/lib/db/schema";

import {
  BotProgressSchema,
  ONBOARDING_COMPANY_SETTINGS_KEY,
  ONBOARDING_METADATA_KEY,
  ONBOARDING_THREAD_KIND,
  OnboardingCompanyStateSchema,
  emptyBotProgress,
  parseBotProgress,
  parseOnboardingCompanyState,
  type BotProgress,
  type OnboardingCompanyState,
} from "./types";

/* ─────────────────────────────────────────────────────────────────────── */
/* Thread-scoped: bot progress                                            */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Tenant scope for onboarding thread access. When supplied, every read/write
 * additionally filters by (companyId, userId) so a foreign `threadId`
 * affects/returns zero rows (closes the AUTH-1 / MISS-1 cross-tenant IDOR —
 * see master fix plan). The live chat path always passes it.
 */
export interface OnboardingThreadScope {
  companyId: string;
  userId: string;
}

function threadScopeFilter(threadId: string, scope?: OnboardingThreadScope) {
  if (!scope) return eq(chatThreads.id, threadId);
  return and(
    eq(chatThreads.id, threadId),
    eq(chatThreads.companyId, scope.companyId),
    eq(chatThreads.userId, scope.userId),
  );
}

/**
 * Loads the bot-progress attached to a chat thread. Always returns a valid
 * object. When `scope` is supplied it is filtered by (companyId, userId): a
 * foreign threadId returns the empty default rather than another tenant's
 * progress.
 */
export async function getBotProgress(
  threadId: string,
  scope?: OnboardingThreadScope,
): Promise<BotProgress> {
  const rows = await db
    .select({ metadata: chatThreads.runtimeMetadata })
    .from(chatThreads)
    .where(threadScopeFilter(threadId, scope))
    .limit(1);
  const metadata = rows[0]?.metadata as Record<string, unknown> | null;
  const raw = metadata?.[ONBOARDING_METADATA_KEY];
  return parseBotProgress(raw);
}

/**
 * Functional update: read current progress, apply transform, write back
 * with a key-scoped jsonb_set so sibling top-level keys (kind, codex
 * fields, etc.) survive. Two concurrent calls on disjoint fields both
 * survive because each writes only its sub-path. Two concurrent calls on
 * the SAME field still have last-write-wins semantics — acceptable for
 * the kinds of fields this stores (set-once-true booleans).
 *
 * Per Forge review H1.
 */
export async function updateBotProgress(
  threadId: string,
  transform: (current: BotProgress) => BotProgress,
  scope?: OnboardingThreadScope,
): Promise<BotProgress> {
  const current = await getBotProgress(threadId, scope);
  const next = BotProgressSchema.parse(transform(current));
  await db
    .update(chatThreads)
    .set({
      runtimeMetadata: sql`
        jsonb_set(
          COALESCE(${chatThreads.runtimeMetadata}, '{}'::jsonb),
          ARRAY[${ONBOARDING_METADATA_KEY}]::text[],
          ${JSON.stringify(next)}::jsonb,
          true
        )
      `,
    })
    .where(threadScopeFilter(threadId, scope));
  return next;
}

/** Mark a profile field as already prompted (prevents re-asking). */
export async function markFieldPrompted(
  threadId: string,
  field: string,
  scope?: OnboardingThreadScope,
): Promise<BotProgress> {
  return updateBotProgress(
    threadId,
    (current) => ({
      ...current,
      promptedFields: Array.from(new Set([...current.promptedFields, field])),
    }),
    scope,
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Thread kind: first-class column                                        */
/* ─────────────────────────────────────────────────────────────────────── */

/**
 * Marks a chat thread as an onboarding thread. Idempotent. Initialises
 * bot progress in the same UPDATE.
 */
export async function ensureOnboardingThread(
  threadId: string,
  scope?: OnboardingThreadScope,
): Promise<BotProgress> {
  // Detect first-call vs already-initialized by checking whether the raw
  // jsonb key exists at all (parseBotProgress always returns a hydrated
  // value, so we can't use it to distinguish). Read directly. When `scope`
  // is supplied (the live chat path always does), a foreign threadId neither
  // reads nor writes another tenant's row (AUTH-1 / MISS-1).
  const rows = await db
    .select({ metadata: chatThreads.runtimeMetadata })
    .from(chatThreads)
    .where(threadScopeFilter(threadId, scope))
    .limit(1);
  const metadata = rows[0]?.metadata as Record<string, unknown> | null;
  const rawOnboarding = metadata?.[ONBOARDING_METADATA_KEY];
  const alreadyInitialized =
    typeof rawOnboarding === "object" && rawOnboarding !== null;
  const seedProgress = alreadyInitialized
    ? parseBotProgress(rawOnboarding)
    : emptyBotProgress();

  await db
    .update(chatThreads)
    .set({
      kind: ONBOARDING_THREAD_KIND,
      runtimeMetadata: sql`
        jsonb_set(
          COALESCE(${chatThreads.runtimeMetadata}, '{}'::jsonb),
          ARRAY[${ONBOARDING_METADATA_KEY}]::text[],
          ${JSON.stringify(seedProgress)}::jsonb,
          true
        )
      `,
    })
    .where(threadScopeFilter(threadId, scope));
  return seedProgress;
}

/**
 * True iff chat_threads.kind == 'onboarding'. SQL-filterable. When `scope`
 * is supplied it is restricted to a thread owned by (companyId, userId), so a
 * foreign threadId returns false (zero rows) rather than leaking another
 * tenant's thread kind.
 */
export async function isOnboardingThread(
  threadId: string,
  scope?: OnboardingThreadScope,
): Promise<boolean> {
  const rows = await db
    .select({ kind: chatThreads.kind })
    .from(chatThreads)
    .where(threadScopeFilter(threadId, scope))
    .limit(1);
  return rows[0]?.kind === ONBOARDING_THREAD_KIND;
}

/* ─────────────────────────────────────────────────────────────────────── */
/* Company-scoped: decisions that survive thread/user                     */
/* ─────────────────────────────────────────────────────────────────────── */

export async function getOnboardingCompanyState(
  companyId: string,
): Promise<OnboardingCompanyState> {
  const rows = await db
    .select({ settings: companies.settings })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  const settings = rows[0]?.settings as Record<string, unknown> | null;
  const raw = settings?.[ONBOARDING_COMPANY_SETTINGS_KEY];
  return parseOnboardingCompanyState(raw);
}

export async function updateOnboardingCompanyState(
  companyId: string,
  transform: (current: OnboardingCompanyState) => OnboardingCompanyState,
): Promise<OnboardingCompanyState> {
  const current = await getOnboardingCompanyState(companyId);
  const next = OnboardingCompanyStateSchema.parse(transform(current));
  await db
    .update(companies)
    .set({
      settings: sql`
        jsonb_set(
          COALESCE(${companies.settings}, '{}'::jsonb),
          ARRAY[${ONBOARDING_COMPANY_SETTINGS_KEY}]::text[],
          ${JSON.stringify(next)}::jsonb,
          true
        )
      `,
    })
    .where(eq(companies.id, companyId));
  return next;
}

/** Convenience: bump documents-uploaded count atomically. */
export async function incrementDocumentsUploaded(
  companyId: string,
  delta: number = 1,
): Promise<OnboardingCompanyState> {
  return updateOnboardingCompanyState(companyId, (current) => ({
    ...current,
    documentsUploaded: Math.max(0, current.documentsUploaded + delta),
  }));
}

/** Convenience: record a linked connector (idempotent — set semantics). */
export async function recordConnectorLinked(
  companyId: string,
  provider: string,
): Promise<OnboardingCompanyState> {
  return updateOnboardingCompanyState(companyId, (current) => ({
    ...current,
    connectorsLinked: Array.from(new Set([...current.connectorsLinked, provider])),
  }));
}

/**
 * Convenience: stamp the handoff moment on the chat-onboarding state AND
 * set the canonical `settings.onboardingCompletedAt` flag the rest of the
 * app reads to know onboarding is done (e.g. /onboarding → /dashboard
 * redirect, /api/onboarding/status `complete`). Both writes preserve
 * sibling keys.
 */
export async function recordHandoff(
  companyId: string,
): Promise<OnboardingCompanyState> {
  const completedAt = new Date().toISOString();
  await db
    .update(companies)
    .set({
      settings: sql`
        jsonb_set(
          COALESCE(${companies.settings}, '{}'::jsonb),
          '{onboardingCompletedAt}',
          to_jsonb(${completedAt}::text),
          true
        )
      `,
    })
    .where(eq(companies.id, companyId));
  return updateOnboardingCompanyState(companyId, (current) => ({
    ...current,
    handoffAt: current.handoffAt ?? completedAt,
  }));
}

/* ─────────────────────────────────────────────────────────────────────── */
/* User-scoped: resume pointer                                            */
/* ─────────────────────────────────────────────────────────────────────── */

/** Returns the user's in-flight onboarding thread id, or null. */
export async function getCurrentOnboardingThreadId(
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ threadId: users.currentOnboardingThreadId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.threadId ?? null;
}

/** Sets the resume pointer. Pass null to clear (e.g. after handoff). */
export async function setCurrentOnboardingThreadId(
  userId: string,
  threadId: string | null,
): Promise<void> {
  await db
    .update(users)
    .set({ currentOnboardingThreadId: threadId })
    .where(eq(users.id, userId));
}
