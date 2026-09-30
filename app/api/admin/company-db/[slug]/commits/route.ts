import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { handleApiError } from "@/lib/api-auth";
import { getCommits } from "@/lib/company-db/client";
import { requireAdminCompanyAccess } from "@/lib/platform-admin";

/**
 * GET /api/admin/company-db/[slug]/commits?limit=20&offset=0
 *
 * Paginated commit log for the Company-DB admin panel.
 * Pass-through to Company-DB REST API.
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

    const { searchParams } = req.nextUrl;
    const rawLimit = parseInt(searchParams.get("limit") ?? "20", 10);
    const rawOffset = parseInt(searchParams.get("offset") ?? "0", 10);
    const limit = isNaN(rawLimit) || rawLimit < 1 ? 20 : Math.min(rawLimit, 100);
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    const result = await getCommits(
      {
        companySlug: slug,
        callerId: session.user.id,
        callerRole: role,
        port: companyDbPort,
      },
      limit,
      offset,
    );

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
