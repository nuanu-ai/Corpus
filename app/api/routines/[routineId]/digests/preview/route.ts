import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { buildAndPersistLegalWatchDigestPreview } from "@/lib/routines/legal-watch/digest-preview";
import { requireRoutineDomainAccess } from "@/lib/routines/api-access";
import { getCompanyRoutine } from "@/lib/routines/store";
import { LEGAL_WATCH_BKPM_TEMPLATE_KEY } from "@/lib/routines/types";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const STRICT_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_DIGEST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function parseStrictWindowDate(
  value: unknown,
  field: string,
  options?: { dateOnlyEndExclusive?: boolean },
): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a YYYY-MM-DD or UTC ISO date string`);
  }
  const dateOnly = value.match(DATE_ONLY_PATTERN);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new Error(`${field} is not a valid calendar date`);
    }
    if (options?.dateOnlyEndExclusive) {
      return new Date(date.getTime() + 24 * 60 * 60 * 1000);
    }
    return date;
  }
  if (!STRICT_ISO_PATTERN.test(value)) {
    throw new Error(`${field} must be a YYYY-MM-DD or UTC ISO date string`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} is not a valid date`);
  }
  return date;
}

function defaultWindow() {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ routineId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "write");
    if (routine.templateKey !== LEGAL_WATCH_BKPM_TEMPLATE_KEY) {
      return NextResponse.json(
        { error: "Digest preview is enabled for Legal Watch routines only" },
        { status: 400 },
      );
    }
    const body = await req.json().catch(() => ({}));
    const fallback = defaultWindow();
    let windowStart: Date;
    let windowEnd: Date;
    try {
      windowStart = parseStrictWindowDate(body.windowStart, "windowStart") ?? fallback.start;
      windowEnd =
        parseStrictWindowDate(body.windowEnd, "windowEnd", { dateOnlyEndExclusive: true }) ??
        fallback.end;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid digest window" },
        { status: 400 },
      );
    }
    if (windowEnd <= windowStart) {
      return NextResponse.json({ error: "windowEnd must be after windowStart" }, { status: 400 });
    }
    if (windowEnd.getTime() - windowStart.getTime() > MAX_DIGEST_WINDOW_MS) {
      return NextResponse.json({ error: "Digest preview window cannot exceed 90 days" }, { status: 400 });
    }
    const [company] = await db
      .select({ companyDbPort: companies.companyDbPort })
      .from(companies)
      .where(eq(companies.id, auth.companyId))
      .limit(1);
    const result = await buildAndPersistLegalWatchDigestPreview({
      companyId: auth.companyId,
      routineId,
      companyDbPort: company?.companyDbPort ?? 3100,
      windowStart,
      windowEnd,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
