import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAuthContext, handleApiError, requireApiKeyScope, requireCompanyDbMcpAccess } from "@/lib/api-auth";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { toCompanyDbRole } from "@/lib/company-db/roles";
import { buildCompanyDbRestHeadersForUrl, isCompanyDbInternalAuthConfigured } from "@/lib/company-db/internal-service-auth";
import { DEFAULT_COMPANY_DB_REST_PORT as DEFAULT_REST_PORT } from "@/lib/company-db/port-config";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
const COMPANY_DB_HOST = process.env.COMPANY_DB_HOST ?? "localhost";

function pickHeader(req: NextRequest, name: string): string | null {
  const value = req.headers.get(name);
  if (!value || value.trim().length === 0) return null;
  return value;
}

function buildProxyHeaders(
  req: NextRequest,
  upstreamUrl: URL,
  body: string | undefined,
  opts: {
    companySlug: string;
    userId: string;
    role: string;
  },
): Headers {
  const headers = new Headers();

  // MCP transport requires this combined Accept for streamable responses.
  headers.set(
    "accept",
    pickHeader(req, "accept") ?? "application/json, text/event-stream",
  );

  const contentType = pickHeader(req, "content-type");
  if (contentType) headers.set("content-type", contentType);

  // Forward MCP session/stream related headers when present.
  const mcpSessionId = pickHeader(req, "mcp-session-id");
  if (mcpSessionId) headers.set("mcp-session-id", mcpSessionId);

  const lastEventId = pickHeader(req, "last-event-id");
  if (lastEventId) headers.set("last-event-id", lastEventId);

  const mcpProtocolVersion = pickHeader(req, "mcp-protocol-version");
  if (mcpProtocolVersion) headers.set("mcp-protocol-version", mcpProtocolVersion);

  const internalHeaders = buildCompanyDbRestHeadersForUrl({
    url: upstreamUrl,
    method: req.method,
    body,
    contentType,
    companySlug: opts.companySlug,
    callerId: opts.userId,
    callerRole: toCompanyDbRole(opts.role),
  });
  for (const [key, value] of Object.entries(internalHeaders)) {
    headers.set(key, value);
  }

  return headers;
}

function buildResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();

  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const mcpSessionId = upstream.headers.get("mcp-session-id");
  if (mcpSessionId) headers.set("mcp-session-id", mcpSessionId);

  const mcpProtocolVersion = upstream.headers.get("mcp-protocol-version");
  if (mcpProtocolVersion) headers.set("mcp-protocol-version", mcpProtocolVersion);

  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("cache-control", cacheControl);

  return headers;
}

async function proxyMcpRequest(req: NextRequest): Promise<Response> {
  if (!isCompanyDbInternalAuthConfigured()) {
    return NextResponse.json(
      { error: "Company-DB internal auth is not configured" },
      { status: 503 },
    );
  }

  const auth = await getAuthContext();
  requireApiKeyScope(auth, "company_db.mcp");
  requireCompanyDbMcpAccess(auth);
  const companySlug = await getCompanySlug(auth.companyId);

  const [company] = await db
    .select({ companyDbPort: companies.companyDbPort })
    .from(companies)
    .where(eq(companies.id, auth.companyId));

  const restPort = company?.companyDbPort ?? DEFAULT_REST_PORT;
  const mcpUrl = new URL(`http://${COMPANY_DB_HOST}:${restPort + 2}/mcp`);
  const incomingUrl = new URL(req.url);
  mcpUrl.search = incomingUrl.search;

  const body = req.method === "POST" ? await req.text() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(mcpUrl, {
      method: req.method,
      headers: buildProxyHeaders(req, mcpUrl, body, {
        companySlug,
        userId: auth.userId,
        role: auth.role,
      }),
      body,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Company-DB MCP is unavailable" },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: buildResponseHeaders(upstream),
  });
}

/**
 * MCP proxy for external agents.
 *
 * Auth: session cookie or API key bearer (`Authorization: Bearer corpus_sk_...`)
 * Company selection for API-key auth: `x-company-id` header.
 *
 * This endpoint translates app auth to internal Company-DB MCP auth.
 */
export async function GET(req: NextRequest) {
  try {
    return await proxyMcpRequest(req);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    return await proxyMcpRequest(req);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    return await proxyMcpRequest(req);
  } catch (err) {
    return handleApiError(err);
  }
}
