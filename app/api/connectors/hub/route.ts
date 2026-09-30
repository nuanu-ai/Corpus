import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  getAuthContext,
  handleApiError,
  requireApiKeyScope,
  requireInheritedConnectorAccess,
  type AuthContext,
} from "@/lib/api-auth";
import { runHubConnectorAction } from "@/lib/agent/connectors";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import {
  getConnectorHubCatalog,
  getConnectorHubStatus,
} from "@/lib/connectors/hub";
import { ConnectorHubError } from "@/lib/connectors/hub-errors";
import {
  filterConnectorProvidersByScopes,
  getConnectorUseScopes,
} from "@/lib/connectors/provider-registry";
import type { ApiKeyScope } from "@/lib/api-key-scopes";

function requireInheritedHubAccess(
  auth: AuthContext,
  acceptedScopes?: readonly ApiKeyScope[],
) {
  requireInheritedConnectorAccess(
    {
      companyId: auth.companyId,
      companyName: "",
      companySlug: null,
      companyDbPort: 0,
      companySettings: null,
      role: auth.role,
      joinedAt: new Date(0),
      accessSource: auth.companyAccessSource,
      allowedConnectorScopes: auth.companyAllowedConnectorScopes ?? null,
    },
    acceptedScopes,
  );
}

function handleConnectorError(err: unknown) {
  if (err instanceof ConnectorHubError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        details: err.details,
      },
      { status: err.status }
    );
  }

  return handleApiError(err);
}

function getInheritedAllowedConnectorScopes(auth: AuthContext) {
  return auth.companyAccessSource === "inherited"
    ? auth.companyAllowedConnectorScopes ?? []
    : null;
}

/**
 * GET /api/connectors/hub
 *
 * Returns connector hub capabilities and connection status for the active company.
 */
export async function GET() {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "connectors.hub");
    requireInheritedHubAccess(auth);
    const { companyId } = auth;
    const allowedConnectorScopes = getInheritedAllowedConnectorScopes(auth);
    const providers = filterConnectorProvidersByScopes(
      await getConnectorHubStatus(companyId),
      allowedConnectorScopes,
    );

    return NextResponse.json({
      providers,
      catalog: filterConnectorProvidersByScopes(
        getConnectorHubCatalog(),
        allowedConnectorScopes,
      ),
    });
  } catch (err) {
    return handleConnectorError(err);
  }
}

/**
 * POST /api/connectors/hub
 *
 * Execute a provider action via the server-side connector hub.
 * Body: { provider: "slack" | "jira", action: string, input?: object }
 */
export async function POST(request: Request) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "connectors.hub");
    const { companyId } = auth;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const providerScopes =
      typeof body.provider === "string" ? getConnectorUseScopes(body.provider) : [];
    requireInheritedHubAccess(
      auth,
      providerScopes.length > 0 ? providerScopes : undefined,
    );

    const companySlug = await getCompanySlug(companyId);
    const [company] = await db
      .select({ companyDbPort: companies.companyDbPort })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    const result = await runHubConnectorAction(companyId, body, {
      companySlug,
      companyDbPort: company?.companyDbPort ?? 3100,
    });
    return NextResponse.json(result);
  } catch (err) {
    return handleConnectorError(err);
  }
}
