/**
 * Onboarding entrypoint logic — resolves which thread a returning or
 * first-time user should land in.
 *
 * The shell company is already created at sign-up by better-auth
 * databaseHooks.user.create.after (see lib/auth.ts). So by the time the
 * user reaches /onboarding they always have:
 *   - a real user row (better-auth)
 *   - a real shell company (auth.ts hook)
 *   - a company membership with role='owner'
 * Per Architect review §1 + §4 — A1 architectural decision is satisfied
 * by existing code; no shell-company-on-signup work needed here.
 *
 * This module just decides: "land in the existing onboarding thread, or
 * spawn a fresh one".
 */

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { chatThreads } from "@/lib/db/schema";

import {
  getCurrentOnboardingThreadId,
  setCurrentOnboardingThreadId,
} from "./state";
import { ONBOARDING_THREAD_KIND } from "./types";

/**
 * Resolves the user's active onboarding thread for a given company.
 *
 * Returns the threadId of:
 *   1. the thread pointed to by users.current_onboarding_thread_id, if it
 *      still exists and matches the company; OR
 *   2. the most-recently-updated onboarding-kind thread for (userId,
 *      companyId) where handoff has NOT yet occurred (i.e. the company
 *      onboardingState.handoffAt is still null on the thread's company —
 *      checked at the caller, this helper just finds the most-recent
 *      non-handoff thread by created_at); OR
 *   3. null — caller should create a fresh thread.
 *
 * The user's resume pointer is updated to the resolved thread (when
 * non-null), so the next visit lands directly without scanning.
 */
export async function resolveActiveOnboardingThread(input: {
  userId: string;
  companyId: string;
}): Promise<string | null> {
  // Path 1: pointer
  const pointed = await getCurrentOnboardingThreadId(input.userId);
  if (pointed) {
    const rows = await db
      .select({ id: chatThreads.id, companyId: chatThreads.companyId, kind: chatThreads.kind })
      .from(chatThreads)
      .where(eq(chatThreads.id, pointed))
      .limit(1);
    const hit = rows[0];
    if (hit && hit.companyId === input.companyId && hit.kind === ONBOARDING_THREAD_KIND) {
      return hit.id;
    }
    // pointer stale → clear it
    await setCurrentOnboardingThreadId(input.userId, null);
  }

  // Path 2: most-recent onboarding thread for this user+company
  const rows = await db
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.userId, input.userId),
        eq(chatThreads.companyId, input.companyId),
        eq(chatThreads.kind, ONBOARDING_THREAD_KIND),
      ),
    )
    .orderBy(desc(chatThreads.updatedAt))
    .limit(1);
  if (rows[0]) {
    await setCurrentOnboardingThreadId(input.userId, rows[0].id);
    return rows[0].id;
  }

  return null;
}

/**
 * After spawning a fresh onboarding thread, point the user there so the
 * next visit (two tabs, mobile, another device) resumes it.
 */
export async function adoptOnboardingThread(input: {
  userId: string;
  threadId: string;
}): Promise<void> {
  await setCurrentOnboardingThreadId(input.userId, input.threadId);
}

/**
 * After onboarding_complete_and_handoff, clear the resume pointer so the
 * next visit goes to the normal CFO chat instead of resuming a done flow.
 */
export async function releaseOnboardingThread(userId: string): Promise<void> {
  await setCurrentOnboardingThreadId(userId, null);
}

/**
 * SQL filter helper: lets callers query "pending onboarding threads for
 * a given company" without parsing jsonb. Useful for admin dashboards
 * showing onboarding progress.
 *
 * Note: `isOnboardingThread(threadId)` lives in `./state` — use that for
 * single-thread checks. This helper is for batch queries.
 */
export function pendingOnboardingThreadsFilter(companyId: string) {
  return and(
    eq(chatThreads.companyId, companyId),
    eq(chatThreads.kind, ONBOARDING_THREAD_KIND),
    isNull(chatThreads.authProfileId),
  );
}
