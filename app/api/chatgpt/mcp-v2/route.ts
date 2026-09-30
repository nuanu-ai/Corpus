import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { handleApiError } from "@/lib/api-auth";
import { handleMultiCompanySessionScopedAgentMcpRequest } from "@/lib/agent/mcp";
import { resolveChatgptMcpPublicOrigin } from "@/lib/chatgpt-mcp-oauth";
import { listCompanyMemberships } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildUnauthorizedMcpResponse(req: NextRequest): NextResponse {
  const origin = resolveChatgptMcpPublicOrigin(new URL(req.url).origin);
  const resourceMetadata = `${origin}/api/chatgpt/mcp-v2/.well-known/oauth-protected-resource`;
  const wwwAuthenticateValue = `Bearer resource_metadata="${resourceMetadata}"`;

  return NextResponse.json(
    {
      jsonrpc: "2.0",
      error: {
        code: -32003,
        message: "Unauthorized: Authentication required",
        "www-authenticate": wwwAuthenticateValue,
      },
      id: null,
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": wwwAuthenticateValue,
        "Access-Control-Expose-Headers": "WWW-Authenticate",
      },
    },
  );
}

async function handleRequest(req: NextRequest): Promise<Response> {
  let mcpSession: Awaited<ReturnType<typeof auth.api.getMcpSession>> | null = null;
  try {
    mcpSession = await auth.api.getMcpSession({ headers: req.headers });
  } catch {
    return buildUnauthorizedMcpResponse(req);
  }
  if (!mcpSession?.userId) {
    return buildUnauthorizedMcpResponse(req);
  }

  const memberships = await listCompanyMemberships(mcpSession.userId);
  if (memberships.length === 0) {
    return NextResponse.json(
      { error: "No accessible companies found for this user" },
      { status: 404 },
    );
  }

  return handleMultiCompanySessionScopedAgentMcpRequest(req, {
    userId: mcpSession.userId,
    memberships,
  });
}

export async function GET(req: NextRequest) {
  try {
    return await handleRequest(req);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    return await handleRequest(req);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    return await handleRequest(req);
  } catch (err) {
    return handleApiError(err);
  }
}
