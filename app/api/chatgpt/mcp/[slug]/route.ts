import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { handleApiError } from "@/lib/api-auth";
import { handleSessionScopedAgentMcpRequest } from "@/lib/agent/mcp";
import { buildChatgptMcpProtectedResourceMetadataUrl } from "@/lib/chatgpt-mcp-oauth";
import { listCompanyMemberships } from "@/lib/db/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildUnauthorizedMcpResponse(req: NextRequest, companySlug: string): NextResponse {
  const wwwAuthenticateValue = `Bearer resource_metadata="${buildChatgptMcpProtectedResourceMetadataUrl(
    new URL(req.url).origin,
    companySlug,
  )}"`;

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

async function proxyChatgptMcpRequest(
  req: NextRequest,
  slug: string,
): Promise<Response> {
  let mcpSession: Awaited<ReturnType<typeof auth.api.getMcpSession>> | null = null;
  try {
    mcpSession = await auth.api.getMcpSession({ headers: req.headers });
  } catch {
    return buildUnauthorizedMcpResponse(req, slug);
  }
  if (!mcpSession?.userId) {
    return buildUnauthorizedMcpResponse(req, slug);
  }

  const memberships = await listCompanyMemberships(mcpSession.userId);
  const membership = memberships.find((entry) => entry.companySlug === slug);
  if (!membership) {
    return NextResponse.json(
      { error: "Company not found or not accessible" },
      { status: 404 },
    );
  }

  return handleSessionScopedAgentMcpRequest(req, {
    userId: mcpSession.userId,
    membership,
  });
}

async function handleRequest(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    return await proxyChatgptMcpRequest(req, slug);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  return handleRequest(req, context);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  return handleRequest(req, context);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  return handleRequest(req, context);
}
