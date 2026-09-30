import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { handleApiError } from "@/lib/api-auth";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import { requireAdminCompanyAccess } from "@/lib/platform-admin";

interface RebuildBody {
  domains?: string[];
  targetIds?: string[];
}

/**
 * POST /api/admin/company-db/[slug]/summaries/rebuild
 *
 * Operator endpoint to rebuild summary targets for a company.
 * Auth: owner only.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const { companyDbPort } = await requireAdminCompanyAccess({
      userId: session.user.id,
      email: session.user.email,
      slug,
      requiredRole: "owner",
    });

    let body: RebuildBody = {};
    try {
      body = (await req.json()) as RebuildBody;
    } catch {
      // Empty body is allowed.
    }

    const result = await refreshSummaryTargets({
      companySlug: slug,
      port: companyDbPort,
      writeQueuePort: companyDbPort + 1,
      domains: Array.isArray(body.domains) ? body.domains : undefined,
      targetIds: Array.isArray(body.targetIds) ? body.targetIds : undefined,
      reason: "operator_rebuild",
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
