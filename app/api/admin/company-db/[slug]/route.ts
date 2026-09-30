import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { handleApiError } from "@/lib/api-auth";
import { getStats, queryEntitiesWithCount } from "@/lib/company-db/client";
import { loadSummaryTargets } from "@/lib/company-db/summary/registry";
import { requireAdminCompanyAccess } from "@/lib/platform-admin";

const DEFAULT_ENTITY_PAGE_SIZE = 200;
const MAX_ENTITY_PAGE_SIZE = 5000;

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

/**
 * GET /api/admin/company-db/[slug]
 *
 * Initial load for the Company-DB admin panel.
 * Fetches stats + all entities in parallel from the Company-DB REST API.
 * Auth: session + membership on the company identified by slug.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const { companyDbPort, role } = await requireAdminCompanyAccess({
      userId: session.user.id,
      email: session.user.email,
      slug,
    });

    const requestOpts = {
      companySlug: slug,
      callerId: session.user.id,
      callerRole: role,
      port: companyDbPort,
    };

    const limit = Math.min(
      parsePositiveInt(req.nextUrl.searchParams.get("limit"), DEFAULT_ENTITY_PAGE_SIZE),
      MAX_ENTITY_PAGE_SIZE,
    );
    const offset = parsePositiveInt(req.nextUrl.searchParams.get("offset"), 0);

    const [stats, entitiesResult, summaryTargets] = await Promise.all([
      getStats(requestOpts),
      queryEntitiesWithCount({ limit, offset }, requestOpts),
      loadSummaryTargets(slug),
    ]);

    const loadedCount = offset + entitiesResult.data.length;

    return NextResponse.json({
      stats,
      summaryTargets,
      entities: {
        data: entitiesResult.data,
        count: entitiesResult.count,
        limit,
        offset,
        hasMore: loadedCount < entitiesResult.count,
        truncated: loadedCount < entitiesResult.count,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
