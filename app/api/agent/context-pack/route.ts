import { NextRequest, NextResponse } from "next/server";

import {
  getApiKeyAgentContext,
  handleApiError,
  requireGrantedApiKeyScope,
} from "@/lib/api-auth";
import {
  buildAgentContextPackForApiKey,
  parseAgentContextIntent,
} from "@/lib/agent-context";

function parseCompanyId(req: NextRequest): string | null {
  const searchParams = getSearchParams(req);
  return (
    searchParams.get("company_id") ??
    searchParams.get("companyId")
  );
}

function getSearchParams(req: NextRequest): URLSearchParams {
  return req.nextUrl?.searchParams ?? new URL(req.url).searchParams;
}

export async function GET(req: NextRequest) {
  try {
    const { apiKey, companies } = await getApiKeyAgentContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.read");

    const pack = await buildAgentContextPackForApiKey({
      apiKey,
      companies,
      requestedCompanyId: parseCompanyId(req),
      intent: parseAgentContextIntent(getSearchParams(req).get("intent")),
      query: getSearchParams(req).get("query"),
    });

    if (!pack) {
      return NextResponse.json(
        { error: "company_id is required or not accessible" },
        { status: 400 },
      );
    }

    return NextResponse.json(pack);
  } catch (err) {
    return handleApiError(err);
  }
}
