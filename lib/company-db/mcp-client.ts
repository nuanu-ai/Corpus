/**
 * MCP Client for Company-DB.
 *
 * Connects to the Company-DB MCP Server via Streamable HTTP transport.
 * Each client instance is scoped to a specific company (tenant)
 * and inherits the authenticated user's role (delegated access).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { toCompanyDbRole } from "@/lib/company-db/roles";
import { buildCompanyDbRestHeadersForUrl } from "@/lib/company-db/internal-service-auth";
import { DEFAULT_COMPANY_DB_REST_PORT as DEFAULT_REST_PORT } from "@/lib/company-db/port-config";
const COMPANY_DB_HOST = process.env.COMPANY_DB_HOST ?? "localhost";
const MCP_SERVER_URL = process.env.COMPANY_DB_MCP_URL;

export interface McpClientOptions {
  companySlug: string;
  sessionToken?: string;
  callerId?: string;
  callerRole?: string;
  /** Base REST port for the tenant. MCP listens on port + 2 by default. */
  port?: number;
}

function resolveMcpUrl(opts: McpClientOptions): string {
  if (typeof opts.port === "number") {
    return `http://${COMPANY_DB_HOST}:${opts.port + 2}/mcp`;
  }
  if (MCP_SERVER_URL) {
    return MCP_SERVER_URL.endsWith("/mcp")
      ? MCP_SERVER_URL
      : `${MCP_SERVER_URL.replace(/\/$/, "")}/mcp`;
  }
  return `http://${COMPANY_DB_HOST}:${DEFAULT_REST_PORT + 2}/mcp`;
}

/**
 * Create and connect an MCP client for a specific company.
 *
 * The client is short-lived — created per request, used for tool calls
 * during a single chat turn, then closed.
 */
export async function createMcpClient(opts: McpClientOptions): Promise<Client> {
  const client = new Client({
    name: "corpus-chat",
    version: "0.1.0",
  });

  const callerId = opts.callerId ?? `cfo-agent-${opts.companySlug}`;
  const callerRole = toCompanyDbRole(opts.callerRole);
  const signedFetch: typeof fetch = async (input, init) => {
    const requestUrl = input instanceof Request ? input.url : input instanceof URL ? input.toString() : String(input);
    const requestMethod = init?.method ?? (input instanceof Request ? input.method : "GET");
    const requestBody = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    const requestHeaders = new Headers(
      buildCompanyDbRestHeadersForUrl({
        url: requestUrl,
        method: requestMethod,
        body: requestBody,
        contentType: init?.headers instanceof Headers
          ? init.headers.get("content-type")
          : input instanceof Request
            ? input.headers.get("content-type")
            : null,
        companySlug: opts.companySlug,
        callerId,
        callerRole,
      }),
    );

    const forwardedHeaders = new Headers(input instanceof Request ? input.headers : init?.headers);
    for (const [key, value] of forwardedHeaders.entries()) {
      if (!requestHeaders.has(key)) {
        requestHeaders.set(key, value);
      }
    }
    if (opts.sessionToken) {
      requestHeaders.set("Authorization", `Bearer ${opts.sessionToken}`);
    }

    return fetch(requestUrl, {
      ...init,
      headers: requestHeaders,
    });
  };

  const transport = new StreamableHTTPClientTransport(
    new URL(resolveMcpUrl(opts)),
    { fetch: signedFetch },
  );

  await client.connect(transport);
  return client;
}

/**
 * Read a resource from the MCP server.
 */
export async function readMcpResource(
  client: Client,
  uri: string,
): Promise<string> {
  const result = await client.readResource({ uri });

  // Combine all text content from the resource
  return result.contents
    .map((c) => ("text" in c ? c.text : ""))
    .join("\n");
}

/**
 * Call an MCP tool and return the result.
 */
export async function callMcpTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  return result.content;
}

/**
 * List available MCP tools (for building Vercel AI SDK tool definitions).
 */
export async function listMcpTools(client: Client) {
  const result = await client.listTools();
  return result.tools;
}
