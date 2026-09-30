import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, handleApiError, requireApiKeyScope, requireCompanyDbDomainAccess } from "@/lib/api-auth";
import { queryEntities } from "@/lib/company-db/client";
import { getCompanySlug } from "@/lib/company-db/tenant";
import {
  resolveAgentSafeEntityView,
  resolveAgentSafeQueryLimit,
} from "@/lib/company-db/agent-safe-defaults";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/company/query
 *
 * Proxy to Company-DB REST API for querying entities.
 * Query params: domain, type, status, documentId, limit, offset, view
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "company_db.read");
    const companySlug = await getCompanySlug(auth.companyId);

    // Look up tenant-specific Company-DB port
    const [company] = await db
      .select({ companyDbPort: companies.companyDbPort })
      .from(companies)
      .where(eq(companies.id, auth.companyId));
    const port = company?.companyDbPort ?? 3100;

    const { searchParams } = new URL(req.url);
    const domain = searchParams.get("domain") ?? undefined;
    requireCompanyDbDomainAccess(auth, domain);
    const requestedLimit = searchParams.has("limit") ? Number(searchParams.get("limit")) : undefined;
    const requestedView = searchParams.get("view");
    const results = await queryEntities(
      {
        domain,
        type: searchParams.get("type") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        documentId: searchParams.get("documentId") ?? undefined,
        limit: resolveAgentSafeQueryLimit(auth.authMethod, requestedLimit),
        offset: searchParams.has("offset") ? Number(searchParams.get("offset")) : undefined,
        view: resolveAgentSafeEntityView(auth.authMethod, requestedView),
      },
      { companySlug, callerId: auth.userId, callerRole: auth.role, port },
    );

    return NextResponse.json(results);
  } catch (err) {
    return handleApiError(err);
  }
}
