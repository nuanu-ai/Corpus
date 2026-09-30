import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  listPendingCodexPromotionDocumentIds,
  promoteCodexDocument,
} from "@/lib/codex-worker/promotion";
const FALLBACK_DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

function resolveDefaultLimit(): number {
  const raw = Number(process.env.CODEX_PROMOTION_BATCH_LIMIT);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.trunc(raw), MAX_LIMIT);
  }
  return FALLBACK_DEFAULT_LIMIT;
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function getCronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value ? value : null;
}

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

  const body = await req.json().catch(() => ({}));
  const limitRaw =
    typeof body?.limit === "number" ? body.limit : Number(req.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.trunc(limitRaw), MAX_LIMIT)
      : resolveDefaultLimit();
  const force = body?.force === true || req.nextUrl.searchParams.get("force") === "1";
  const explicitDocumentId =
    typeof body?.documentId === "string" && body.documentId.trim().length > 0
      ? body.documentId.trim()
      : null;

  const documentIds = explicitDocumentId
    ? [explicitDocumentId]
    : await listPendingCodexPromotionDocumentIds(limit);

  const results = [];
  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (const documentId of documentIds) {
    const result = await promoteCodexDocument(documentId, { force });
    results.push(result);
    if (result.status === "completed") completed++;
    else if (result.status === "skipped") skipped++;
    else failed++;
  }

  return NextResponse.json({
    status: "ok",
    scanned: documentIds.length,
    completed,
    skipped,
    failed,
    results,
  });
}
