import { NextRequest, NextResponse } from "next/server";

import {
  getApiKeyAgentContext,
  handleApiError,
  requireGrantedApiKeyScope,
} from "@/lib/api-auth";
import { resolveCompanyScopeReference } from "@/lib/company-scope-resolution";
import { createCompanyForUser, normalizeReportingCurrency } from "@/lib/companies/create";

function isTruthyParam(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function GET(req?: NextRequest) {
  try {
    const { apiKey, companies: memberships } = await getApiKeyAgentContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
    const searchParams = req ? new URL(req.url).searchParams : new URLSearchParams();
    const query = searchParams.get("query")?.trim() ?? "";
    const targetCompanyName =
      searchParams.get("target_company_name")?.trim() ||
      searchParams.get("targetCompanyName")?.trim() ||
      "";
    const requestedDomain = searchParams.get("requested_domain")?.trim() || null;
    const requestedConnectorScope =
      searchParams.get("requested_connector_scope")?.trim() || null;
    const includeOperatingEntities =
      searchParams.has("include_operating_entities")
        ? isTruthyParam(searchParams.get("include_operating_entities"))
        : undefined;

    const activeCompany =
      memberships.find((membership) => membership.companyId === apiKey.defaultCompanyId) ??
      memberships[0] ??
      null;
    const resolution =
      query || targetCompanyName
        ? resolveCompanyScopeReference({
            query: query || targetCompanyName,
            targetCompanyName: targetCompanyName || null,
            activeCompany: activeCompany
              ? {
                  id: activeCompany.companyId,
                  name: activeCompany.companyName,
                  slug: activeCompany.companySlug,
                  role: activeCompany.role,
                }
              : null,
            activeCompanyId: activeCompany?.companyId ?? null,
            accessibleCompanies: memberships,
            includeOperatingEntities,
            requestedDomain,
            requestedConnectorScope,
          })
        : null;

    return NextResponse.json({
      companies: memberships.map((membership) => ({
        id: membership.companyId,
        name: membership.companyName,
        slug: membership.companySlug,
        role: membership.role,
        companyDbPort: membership.companyDbPort,
        joinedAt: membership.joinedAt,
        accessSource: membership.accessSource ?? "direct",
        viaCompanyId: membership.viaCompanyId ?? null,
        viaCompanyName: membership.viaCompanyName ?? null,
        viaCompanySlug: membership.viaCompanySlug ?? null,
        relationshipId: membership.relationshipId ?? null,
        relationshipType: membership.relationshipType ?? null,
        allowedDomains: membership.allowedDomains ?? null,
        domainAccessLevels: membership.domainAccessLevels ?? null,
        allowedConnectorScopes: membership.allowedConnectorScopes ?? null,
        domainAccessSource: membership.domainAccessSource ?? null,
        pathEdgeIds: membership.pathEdgeIds ?? null,
        inheritedAccessPaths: membership.inheritedAccessPaths ?? null,
      })),
      companyScopeMode: apiKey.companyScopeMode,
      accessPolicyVersion: apiKey.accessPolicyVersion,
      defaultCompanyId: apiKey.defaultCompanyId,
      allowedCompanyIds: apiKey.allowedCompanyIds,
      ...(resolution ? { resolution } : {}),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey } = await getApiKeyAgentContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.create");

    if (apiKey.companyScopeMode !== "all_user_companies") {
      return NextResponse.json(
        {
          error:
            "companies.create is only supported for all_user_companies API keys",
        },
        { status: 403 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }
    if (name.length > 120) {
      return NextResponse.json(
        { error: "Company name must be 120 characters or fewer" },
        { status: 400 },
      );
    }

    const reportingCurrency = normalizeReportingCurrency(body.reportingCurrency);
    if (body.reportingCurrency !== undefined && reportingCurrency === null) {
      return NextResponse.json(
        { error: "reportingCurrency must be a valid currency code (e.g. USD)" },
        { status: 400 },
      );
    }
    const { company, provisioning } = await createCompanyForUser({
      userId: apiKey.userId,
      name,
      jurisdiction: body.jurisdiction,
      entityType: body.entityType,
      businessType: body.businessType,
      website: body.website,
      reportingCurrency: body.reportingCurrency,
      companyDescription: body.companyDescription,
    });

    return NextResponse.json(
      {
        company,
        provisioning,
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
