import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

/**
 * Per-user daily caps for tier='community' (BYOK / open signup).
 * tier='managed' is unlimited — Managed users use shared infra and our budget
 * by design.
 *
 * Defaults are conservative; tune via env.
 */
const DEFAULT_COMMUNITY_CHAT_RUNS_PER_DAY = 30;
const DEFAULT_COMMUNITY_UPLOADS_PER_DAY = 20;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export function getCommunityChatRunsPerDay(): number {
  return readPositiveIntEnv("COMMUNITY_CHAT_RUNS_PER_DAY", DEFAULT_COMMUNITY_CHAT_RUNS_PER_DAY);
}

export function getCommunityUploadsPerDay(): number {
  return readPositiveIntEnv("COMMUNITY_UPLOADS_PER_DAY", DEFAULT_COMMUNITY_UPLOADS_PER_DAY);
}

export interface QuotaOk {
  ok: true;
  used: number;
  limit: number | null;
  resetAt: string | null;
}

export interface QuotaExceeded {
  ok: false;
  reason: "daily_chat_quota" | "daily_upload_quota";
  used: number;
  limit: number;
  resetAt: string;
  message: string;
}

export type QuotaResult = QuotaOk | QuotaExceeded;

interface UserTierRow {
  tier: string;
}

async function getUserTier(userId: string): Promise<string> {
  const rows = (await db.execute(sql`
    SELECT tier FROM users WHERE id = ${userId} LIMIT 1
  `)) as unknown as UserTierRow[];
  return rows[0]?.tier ?? "managed";
}

function nextMidnightUtcIso(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/**
 * Count chat_runs created by this user in the last rolling 24 hours.
 * (Rolling window is fairer than calendar-day for testers across time zones.)
 */
async function countRecentChatRuns(userId: string): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM chat_runs
    WHERE (metadata->>'userId') = ${userId}
      AND created_at >= NOW() - INTERVAL '24 hours'
  `)) as unknown as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/**
 * `documents` has no per-user column — count by user's own companies
 * (their main tenant + personal project) in the last 24h.
 */
async function countRecentDocuments(userId: string): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM documents d
    WHERE d.company_id IN (
      SELECT company_id FROM company_members WHERE user_id = ${userId}
    )
    AND d.created_at >= NOW() - INTERVAL '24 hours'
  `)) as unknown as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Check whether this user can start another chat run right now.
 * tier='managed' is always ok (returns ok with limit=null).
 */
export async function checkChatRunQuota(userId: string): Promise<QuotaResult> {
  const tier = await getUserTier(userId);
  if (tier !== "community") {
    return { ok: true, used: 0, limit: null, resetAt: null };
  }

  const limit = getCommunityChatRunsPerDay();
  const used = await countRecentChatRuns(userId);
  if (used >= limit) {
    return {
      ok: false,
      reason: "daily_chat_quota",
      used,
      limit,
      resetAt: nextMidnightUtcIso(),
      message: `Daily chat limit reached (${used}/${limit}). Free-tier accounts are capped to ${limit} chat runs per 24 hours.`,
    };
  }
  return { ok: true, used, limit, resetAt: nextMidnightUtcIso() };
}

export async function checkUploadQuota(userId: string): Promise<QuotaResult> {
  const tier = await getUserTier(userId);
  if (tier !== "community") {
    return { ok: true, used: 0, limit: null, resetAt: null };
  }

  const limit = getCommunityUploadsPerDay();
  const used = await countRecentDocuments(userId);
  if (used >= limit) {
    return {
      ok: false,
      reason: "daily_upload_quota",
      used,
      limit,
      resetAt: nextMidnightUtcIso(),
      message: `Daily upload limit reached (${used}/${limit}). Free-tier accounts are capped to ${limit} uploads per 24 hours.`,
    };
  }
  return { ok: true, used, limit, resetAt: nextMidnightUtcIso() };
}
