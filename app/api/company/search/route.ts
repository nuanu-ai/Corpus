import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, handleApiError, requireApiKeyScope, requireCompanyDbDomainAccess } from "@/lib/api-auth";
import { searchEntities } from "@/lib/company-db/client";
import { getCompanySlug } from "@/lib/company-db/tenant";
import {
  resolveAgentSafeEntityView,
  resolveAgentSafeSearchLimit,
} from "@/lib/company-db/agent-safe-defaults";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/company/search?q=invoice
 *
 * Proxy to Company-DB REST API for full-text search.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "company_db.read");
    const companySlug = await getCompanySlug(auth.companyId);
    const [company] = await db
      .select({ companyDbPort: companies.companyDbPort })
      .from(companies)
      .where(eq(companies.id, auth.companyId));
    const port = company?.companyDbPort ?? 3100;

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");
    const domain = searchParams.get("domain")?.trim().toLowerCase() || null;
    requireCompanyDbDomainAccess(auth, domain);
    const requestedLimit = searchParams.has("limit") ? Number(searchParams.get("limit")) : undefined;

    if (!query) {
      return NextResponse.json(
        { error: "Missing required param: q" },
        { status: 400 },
      );
    }

    const view = searchParams.get("view");
    const results = await searchEntities(
      query,
      { companySlug, callerId: auth.userId, callerRole: auth.role, port },
      {
        domain: domain ?? undefined,
        limit: resolveAgentSafeSearchLimit(auth.authMethod, requestedLimit),
        view: resolveAgentSafeEntityView(auth.authMethod, view),
      },
    );
    return NextResponse.json(results);
  } catch (err) {
    return handleApiError(err);
  }
}
