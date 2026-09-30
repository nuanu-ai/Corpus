import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, handleApiError, requireApiKeyScope, requireCompanyDbDomainAccess } from "@/lib/api-auth";
import { getEntity, getEntityByQualifiedId } from "@/lib/company-db/client";
import { resolveAgentSafeEntityView } from "@/lib/company-db/agent-safe-defaults";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

function parseEntityLookup(
  params: URLSearchParams,
):
  | { kind: "domain_id"; domain: string; entityId: string }
  | { kind: "qualified_id"; qualifiedId: string; domain: string | null }
  | null {
  const domain = params.get("domain")?.trim() ?? "";
  const entityId = params.get("id")?.trim() ?? "";
  if (domain && entityId) {
    return { kind: "domain_id", domain, entityId };
  }

  const qualifiedId = params.get("qualified_id")?.trim() ?? "";
  if (!qualifiedId) return null;

  return { kind: "qualified_id", qualifiedId, domain: domain || null };
}

/**
 * GET /api/company/entity?domain=finance&id=je-001
 * GET /api/company/entity?domain=finance&qualified_id=entity-slug:je-001
 * GET /api/company/entity?qualified_id=codex-import-legal-123
 *
 * Proxy to Company-DB REST API for getting a single entity.
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
    const lookup = parseEntityLookup(searchParams);
    const requestedView = searchParams.get("view");

    if (!lookup) {
      return NextResponse.json(
        { error: "Missing required params: domain + id or qualified_id" },
        { status: 400 },
      );
    }
    requireCompanyDbDomainAccess(auth, lookup.domain);

    const view = resolveAgentSafeEntityView(auth.authMethod, requestedView);
    const entity =
      lookup.kind === "qualified_id"
        ? await getEntityByQualifiedId(
            lookup.qualifiedId,
            {
              companySlug,
              callerId: auth.userId,
              callerRole: auth.role,
              port,
            },
            view,
          )
        : await getEntity(
            lookup.domain,
            lookup.entityId,
            {
              companySlug,
              callerId: auth.userId,
              callerRole: auth.role,
              port,
            },
            view,
          );

    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    return NextResponse.json(entity);
  } catch (err) {
    return handleApiError(err);
  }
}
