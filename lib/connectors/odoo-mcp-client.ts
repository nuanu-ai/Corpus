import { Client } from "@modelcontextprotocol/sdk/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse";
import { assertUrlNotSsrf } from "@/lib/connectors/ssrf-guard";

const ODOO_SSE_CONNECT_TIMEOUT_MS = 15_000;
const ODOO_TOOL_TIMEOUT_MS = (() => {
  const raw = Number(process.env.ODOO_MCP_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 30_000 && raw <= 300_000) return raw;
  return 180_000;
})();
const ODOO_DISCONNECT_TIMEOUT_MS = 2_000;

// ── Types ──────────────────────────────────────────────────────

export interface ExecuteMethodParams {
  model: string;
  method: string;
  domain: unknown[];
  fields?: string[];
  limit?: number;
  offset?: number;
  order?: string;
}

export interface ValidationResult {
  valid: boolean;
  tools: string[];
  error?: string;
}

/** Shape returned by client.callTool() — use structural typing instead of cast. */
interface CallToolContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface CallToolResult {
  content?: CallToolContent[];
  isError?: boolean;
  [key: string]: unknown;
}

export function normalizeOdooPortalUrl(portalUrl: string): string {
  const url = new URL(portalUrl);
  assertUrlNotSsrf(url, "Odoo portal URL");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Odoo portal URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Odoo portal URL must not include credentials");
  }
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`.replace(/\/+$/, "");
}

async function fetchSseWithTimeout(
  input: string | URL | Request,
  init: RequestInit | undefined,
  token: string,
): Promise<Response> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    ODOO_SSE_CONNECT_TIMEOUT_MS,
  );
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutController.signal])
    : timeoutController.signal;
  try {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return await fetch(input, {
      ...init,
      headers,
      signal,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError" &&
      timeoutController.signal.aborted &&
      !init?.signal?.aborted
    ) {
      throw new Error(
        `Odoo MCP SSE connection timed out after ${ODOO_SSE_CONNECT_TIMEOUT_MS / 1000}s`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Client ─────────────────────────────────────────────────────

export class OdooMcpClient {
  private client: Client;
  private portalUrl: string;
  private token: string;
  private transport: SSEClientTransport | null = null;

  constructor(portalUrl: string, token: string) {
    this.portalUrl = normalizeOdooPortalUrl(portalUrl);
    this.token = token;
    this.client = new Client({ name: "corpus-odoo", version: "1.0.0" });
  }

  /** Connect to the ODOO Portal via SSE transport with Bearer auth. */
  async connect(): Promise<void> {
    const sseUrl = new URL(`${this.portalUrl}/mcp/sse`);
    const token = this.token;

    const transport = new SSEClientTransport(sseUrl, {
      eventSourceInit: {
        fetch: (url: string | URL | Request, init?: RequestInit) => {
          return fetchSseWithTimeout(url, init, token);
        },
      },
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });

    this.transport = transport;
    await this.client.connect(transport);
  }

  /** Call execute_method on the portal's MCP server with a timeout. */
  async executeMethod(params: ExecuteMethodParams): Promise<unknown> {
    const args: Record<string, unknown> = {
      model: params.model,
      method: params.method,
      domain: params.domain,
    };
    if (params.fields !== undefined) args.fields = params.fields;
    if (params.limit !== undefined) args.limit = params.limit;
    if (params.offset !== undefined) args.offset = params.offset;
    if (params.order !== undefined) args.order = params.order;

    // The MCP SDK's default request timeout is 60s; without explicit options
    // it would fire before our outer Promise.race and surface as
    // "MCP error -32001: Request timed out". Pass the timeout into callTool
    // so the SDK respects ODOO_TOOL_TIMEOUT_MS. The outer race remains as a
    // belt-and-braces upper bound.
    const timeoutMs = ODOO_TOOL_TIMEOUT_MS;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      this.client.callTool(
        {
          name: "execute_method",
          arguments: args,
        },
        undefined,
        {
          timeout: timeoutMs,
          resetTimeoutOnProgress: true,
          maxTotalTimeout: timeoutMs,
        },
      ),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(
          `Odoo query timed out after ${timeoutMs / 1000}s for ${params.model}. ` +
          `The Odoo server may be slow or the data volume too large.`
        )), timeoutMs);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

    return this.parseToolResult(result as CallToolResult);
  }

  /** Validate that the portal exposes the execute_method tool. */
  async validateConnection(): Promise<ValidationResult> {
    const { tools } = await this.client.listTools();
    const toolNames = tools.map((t) => t.name);
    const hasExecuteMethod = toolNames.includes("execute_method");

    return {
      valid: hasExecuteMethod,
      tools: toolNames,
      ...(hasExecuteMethod
        ? {}
        : { error: "execute_method tool not found on portal" }),
    };
  }

  /** Close the MCP client connection. */
  async disconnect(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => resolve("timeout"), ODOO_DISCONNECT_TIMEOUT_MS);
    });
    const closeTransport =
      transport && typeof transport.close === "function"
        ? transport.close()
        : Promise.resolve();
    const close = Promise.allSettled([
      closeTransport,
      this.client.close(),
    ]).then(() => "closed" as const);
    const result = await Promise.race([close, timeout]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
    if (result === "timeout") {
      console.warn(
        `[odoo-mcp-client] disconnect timed out after ${ODOO_DISCONNECT_TIMEOUT_MS}ms`,
      );
    }
  }

  /** Parse an MCP tool result, handling text content and errors. */
  private parseToolResult(result: CallToolResult): unknown {
    const text =
      (result.content ?? [])
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("") || "";

    if (result.isError) {
      throw new Error(`Odoo MCP tool error: ${text}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return text;
    }

    // Odoo Portal MCP wraps responses in { success, result, error }
    if (
      parsed &&
      typeof parsed === "object" &&
      "success" in (parsed as Record<string, unknown>)
    ) {
      const wrapped = parsed as { success: boolean; result?: unknown; error?: string };
      if (!wrapped.success) {
        throw new Error(`Odoo error: ${wrapped.error || "Unknown error"}`);
      }
      return wrapped.result !== undefined ? wrapped.result : parsed;
    }

    return parsed;
  }
}

// ── Helper ─────────────────────────────────────────────────────

/**
 * Create an OdooMcpClient, run a callback, then disconnect.
 * Guarantees disconnect even if the callback throws.
 */
export async function withOdooClient<T>(
  portalUrl: string,
  token: string,
  fn: (client: OdooMcpClient) => Promise<T>
): Promise<T> {
  const client = new OdooMcpClient(portalUrl, token);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.disconnect();
  }
}
