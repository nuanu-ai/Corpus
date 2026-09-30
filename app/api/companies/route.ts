import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

import { getSessionAuthContext, handleApiError } from "@/lib/api-auth";
import { ACTIVE_COMPANY_COOKIE, ACTIVE_COMPANY_COOKIE_OPTIONS } from "@/lib/company-context";
import { getRequestedCompanyIdFromHeaders } from "@/lib/company-context";
import { createCompanyForUser, normalizeReportingCurrency } from "@/lib/companies/create";
import { getCompanyDescription } from "@/lib/company-settings";
import { getDefaultCompanyIdForUser } from "@/lib/default-company-context";
import { listCompanyMemberships } from "@/lib/db/tenant";

/**
 * GET /api/companies
 * Lists all companies the current user can access.
 */
export async function GET() {
  try {
    const { userId } = await getSessionAuthContext();
    const memberships = await listCompanyMemberships(userId);

    const preferredCompanyId = getRequestedCompanyIdFromHeaders(await headers());

    const activeCompanyId = memberships.some((m) => m.companyId === preferredCompanyId)
      ? preferredCompanyId
      : (await getDefaultCompanyIdForUser(userId)) ?? memberships[0]?.companyId ?? null;

    return NextResponse.json({
      companies: memberships.map((m) => ({
        id: m.companyId,
        name: m.companyName,
        slug: m.companySlug,
        role: m.role,
        companyDbPort: m.companyDbPort,
        joinedAt: m.joinedAt,
        companyDescription: getCompanyDescription(m.companySettings),
      })),
      activeCompanyId,
    }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/companies
 * Creates a new company owned by the current user.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await getSessionAuthContext();

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
      return NextResponse.json({ error: "Company name must be 120 characters or fewer" }, { status: 400 });
    }

    const reportingCurrency = normalizeReportingCurrency(body.reportingCurrency);
    if (body.reportingCurrency !== undefined && reportingCurrency === null) {
      return NextResponse.json({ error: "reportingCurrency must be a valid currency code (e.g. USD)" }, { status: 400 });
    }

    const { company, provisioning } = await createCompanyForUser({
      userId,
      name,
      jurisdiction: body.jurisdiction,
      entityType: body.entityType,
      businessType: body.businessType,
      website: body.website,
      reportingCurrency: body.reportingCurrency,
      companyDescription: body.companyDescription,
    });

    const response = NextResponse.json(
      {
        company,
        provisioning,
      },
      { status: 201 },
    );

    response.cookies.set(ACTIVE_COMPANY_COOKIE, company.id, ACTIVE_COMPANY_COOKIE_OPTIONS);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
