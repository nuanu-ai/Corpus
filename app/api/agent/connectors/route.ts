import { NextRequest, NextResponse } from "next/server";

import {
  getApiKeyCompanyContext,
  handleApiError,
  requireGrantedApiKeyScope,
  requireInheritedConnectorAccess,
  requireOneOfGrantedApiKeyScopes,
} from "@/lib/api-auth";
import {
  isConnectorHubError,
  listAgentConnectors,
  runAgentConnectorAction,
  runHubConnectorAction,
} from "@/lib/agent/connectors";
import {
  getConnectorExtraActionScopes,
  getConnectorProviderDefinition,
  getConnectorUseScopes,
} from "@/lib/connectors/provider-registry";

function handleConnectorError(err: unknown) {
  if (isConnectorHubError(err)) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        details: err.details,
      },
      { status: err.status },
    );
  }

  return handleApiError(err);
}

export async function GET() {
  try {
    const { apiKey, membership } = await getApiKeyCompanyContext();
    requireGrantedApiKeyScope(apiKey.scopes, "connectors.read");
    requireInheritedConnectorAccess(membership);

    const result = await listAgentConnectors({
      companyId: membership.companyId,
      companySlug: membership.companySlug,
      companyDbPort: membership.companyDbPort,
      allowedConnectorScopes:
        membership.accessSource === "inherited"
          ? membership.allowedConnectorScopes ?? []
          : null,
    });

    return NextResponse.json({
      company: {
        id: membership.companyId,
        name: membership.companyName,
        slug: membership.companySlug,
      },
      ...result,
    });
  } catch (err) {
    return handleConnectorError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, membership } = await getApiKeyCompanyContext();

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof body.provider !== "string" || body.provider.length === 0) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }
    if (typeof body.action !== "string" || body.action.length === 0) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    const provider = body.provider;
    const definition = getConnectorProviderDefinition(provider);
    if (!definition) {
      return NextResponse.json({ error: `Unsupported connector provider: ${provider}` }, { status: 400 });
    }

    const useScopes = getConnectorUseScopes(provider);
    if (useScopes.length === 1) {
      requireGrantedApiKeyScope(apiKey.scopes, useScopes[0]);
      requireInheritedConnectorAccess(membership, useScopes);
    } else if (useScopes.length > 1) {
      requireOneOfGrantedApiKeyScopes(apiKey.scopes, [...useScopes]);
      requireInheritedConnectorAccess(membership, [...useScopes]);
    }

    for (const scope of getConnectorExtraActionScopes(provider, body.action)) {
      requireGrantedApiKeyScope(apiKey.scopes, scope);
      requireInheritedConnectorAccess(membership, [scope]);
    }

    if (definition.surface === "hub_legacy") {
      const result = await runHubConnectorAction(membership.companyId, body, {
        companySlug: membership.companySlug,
        companyDbPort: membership.companyDbPort,
      });
      return NextResponse.json(result);
    }

    const result = await runAgentConnectorAction({
      companyId: membership.companyId,
      companySlug: membership.companySlug,
      companyDbPort: membership.companyDbPort,
      provider,
      action: body.action,
      payload: body.input,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return handleConnectorError(err);
  }
}
