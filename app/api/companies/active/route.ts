import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { getSessionAuthContext, handleApiError } from "@/lib/api-auth";
import {
  ACTIVE_COMPANY_COOKIE,
  ACTIVE_COMPANY_COOKIE_OPTIONS,
  getRequestedCompanyIdFromHeaders,
} from "@/lib/company-context";
import { getDefaultCompanyIdForUser } from "@/lib/default-company-context";
import { listCompanyMemberships, requireCompanyMembership } from "@/lib/db/tenant";

/**
 * GET /api/companies/active
 * Returns current active company for the session.
 */
export async function GET() {
  try {
    const { userId } = await getSessionAuthContext();
    const memberships = await listCompanyMemberships(userId);

    const requestedCompanyId = getRequestedCompanyIdFromHeaders(await headers());
    const activeCompanyId = memberships.some((m) => m.companyId === requestedCompanyId)
      ? requestedCompanyId
      : (await getDefaultCompanyIdForUser(userId)) ?? memberships[0]?.companyId ?? null;

    return NextResponse.json({ activeCompanyId });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * PUT /api/companies/active
 * Sets the active company context for the current session.
 */
export async function PUT(req: Request) {
  try {
    const { userId } = await getSessionAuthContext();

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const companyId = typeof body.companyId === "string" ? body.companyId : "";
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    await requireCompanyMembership(userId, companyId);

    const response = NextResponse.json({ status: "ok", activeCompanyId: companyId });
    response.cookies.set(ACTIVE_COMPANY_COOKIE, companyId, ACTIVE_COMPANY_COOKIE_OPTIONS);
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * DELETE /api/companies/active
 * Clears active company cookie.
 */
export async function DELETE() {
  try {
    await getSessionAuthContext();
    const response = NextResponse.json({ status: "ok" });
    response.cookies.set(ACTIVE_COMPANY_COOKIE, "", {
      ...ACTIVE_COMPANY_COOKIE_OPTIONS,
      maxAge: 0,
    });
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
