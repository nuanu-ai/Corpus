import { NextRequest, NextResponse } from "next/server";
import { processBatch, recoverStale } from "@/lib/workers/reconciliation";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { timingSafeEqual } from "crypto";

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function getCronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value ? value : null;
}

/**
 * POST /api/cron/reconcile
 *
 * Triggers reconciliation worker for all companies with pending records.
 * Protected by CRON_SECRET header to prevent unauthorized invocation.
 *
 * Can be called by:
 * - Server-side cron (every 5 min)
 * - Webhook handler (immediate trigger after staging insert)
 */
export async function POST(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    const cronHeader = req.headers.get("x-cron-secret");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const isAuthorized =
      (bearerToken !== null && safeCompare(bearerToken, cronSecret)) ||
      (cronHeader !== null && safeCompare(cronHeader, cronSecret));
    if (!isAuthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  // Find companies with pending records
  const companiesWithPending = await db.execute<{ company_slug: string }>(sql`
    SELECT DISTINCT company_slug FROM staging_records
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    LIMIT 10
  `);

  const results: Record<string, { processed: number; failed: number; skipped: number; recovered: number }> = {};

  for (const row of companiesWithPending) {
    const slug = row.company_slug;

    // Recover stale first
    const recovered = await recoverStale(slug);

    // Process batch
    const batch = await processBatch(slug);

    results[slug] = { ...batch, recovered };
  }

  return NextResponse.json({
    status: "ok",
    companiesProcessed: Object.keys(results).length,
    results,
  });
}
