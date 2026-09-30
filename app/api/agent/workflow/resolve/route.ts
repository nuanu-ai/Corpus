import { NextRequest, NextResponse } from "next/server";

import {
  getApiKeyAgentContext,
  handleApiError,
  requireGrantedApiKeyScope,
} from "@/lib/api-auth";
import { resolveWorkflow } from "@/lib/agent/workflow-router";

function parseRequestedCompanyId(body: Record<string, unknown>): string | null {
  if (typeof body.company_id === "string" && body.company_id.length > 0) return body.company_id;
  if (typeof body.companyId === "string" && body.companyId.length > 0) return body.companyId;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, companies } = await getApiKeyAgentContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.read");

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof body.request !== "string" || body.request.trim().length === 0) {
      return NextResponse.json({ error: "request is required" }, { status: 400 });
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (req.nextUrl ? req.nextUrl.origin : new URL(req.url).origin);

    const resolution = resolveWorkflow({
      request: body.request,
      requestedCompanyId: parseRequestedCompanyId(body),
      companyScopeMode: apiKey.companyScopeMode,
      defaultCompanyId: apiKey.defaultCompanyId,
      allowedCompanyIds: apiKey.allowedCompanyIds,
      scopes: apiKey.scopes,
      accessibleCompanies: companies,
      baseUrl,
    });

    return NextResponse.json(resolution);
  } catch (err) {
    return handleApiError(err);
  }
}
