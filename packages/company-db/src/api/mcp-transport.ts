import { createServer, type IncomingMessage, type ServerResponse } from "http";
import YAML from "yaml";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import type { QueryService } from "./query-service.js";
import { evaluateAccess, type Caller, type CallerRole, type PolicyConfig } from "./policy-engine.js";
import type { WriteQueue } from "../queue/write-queue.js";
import type { WriteIntent } from "../queue/types.js";
import {
  getFirstInternalServiceSecret,
  type InternalServiceSecretMap,
  verifySignedInternalRequest,
} from "../internal-auth.js";

const VALID_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "member",
  "viewer",
  "cfo_agent",
  "external_accountant",
  "investor_view",
  "partner_agent",
]);
const DOMAIN_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface StartMcpHttpServerOptions {
  port: number;
  host?: string;
  serviceSecrets?: InternalServiceSecretMap;
  tenantSlug?: string | null;
  queryService: QueryService;
  writeQueue: WriteQueue;
  policy: PolicyConfig;
}

export interface McpHttpServerHandle {
  port: number;
  close: () => Promise<void>;
}

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function extractCaller(
  req: IncomingMessage,
  serviceSecrets: InternalServiceSecretMap,
): Caller | null {
  const signed = verifySignedInternalRequest({
    headers: req.headers,
    serviceSecrets,
    method: req.method ?? "GET",
    path: req.url ?? "/mcp",
  });

  if (signed && signed.callerId && signed.callerRole && VALID_ROLES.has(signed.callerRole)) {
    return {
      id: signed.callerId,
      role: signed.callerRole as CallerRole,
      authenticatedVia: signed.authenticatedVia,
    };
  }

  return null;
}

function sendJsonRpcError(
  res: ServerResponse,
  status: number,
  message: string,
  code = -32000,
): void {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
  );
}

function parseMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata) return null;
  if (typeof metadata === "object") {
    return metadata as Record<string, unknown>;
  }
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function qmd(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = YAML.stringify(frontmatter).trimEnd();
  const clean = body.trimEnd();
  return `---\n${yaml}\n---\n\n${clean}\n`;
}

function toolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function toolError(message: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
}

function clampLimit(value: unknown, fallback = 50): number {
  const numeric = typeof value === "string"
    ? Number.parseInt(value, 10)
    : value;

  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return fallback;
  if (numeric < 1) return 1;
  if (numeric > 200) return 200;
  return Math.floor(numeric);
}

function parseView(value: unknown): "full" | "summary" {
  return value === "full" ? "full" : "summary";
}

function periodFragments(frontmatter: Record<string, unknown>): string[] {
  const fragments = new Set<string>();

  const push = (value: unknown) => {
    const text = String(value ?? "").trim();
    if (text.length > 0) fragments.add(text);
  };

  push(frontmatter.period);
  push(frontmatter.period_key);
  push(frontmatter.period_start);
  push(frontmatter.period_end);
  push(frontmatter.period_label);
  push(frontmatter.date);
  push(frontmatter.event_date);

  const reportingPeriod = frontmatter.reporting_period;
  if (reportingPeriod && typeof reportingPeriod === "object") {
    const rp = reportingPeriod as Record<string, unknown>;
    push(rp.start);
    push(rp.end);
    push(rp.label);
  }

  return Array.from(fragments);
}

function periodComparableValue(frontmatter: Record<string, unknown>): string {
  const candidates = [
    frontmatter.period_key,
    frontmatter.period_start,
    frontmatter.event_date,
    frontmatter.date,
    frontmatter.period,
  ];

  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (text.length > 0) return text;
  }

  const reportingPeriod = frontmatter.reporting_period;
  if (reportingPeriod && typeof reportingPeriod === "object") {
    const start = String((reportingPeriod as Record<string, unknown>).start ?? "").trim();
    if (start.length > 0) return start;
  }

  return "";
}

function createMcpServer(
  caller: Caller,
  queryService: QueryService,
  writeQueue: WriteQueue,
  writeIntentToken: string,
  policy: PolicyConfig,
): McpServer {
  const server = new McpServer({
    name: "company-db",
    version: "0.0.1",
  });

  server.registerTool(
    "query_entities",
    {
      description:
        "Query entities from any accessible domain with optional domain/type/status filters.",
      inputSchema: {
        domain: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        limit: z.union([z.number(), z.string()]).optional(),
        view: z.enum(["full", "summary"]).optional(),
      },
    },
    async (args) => {
      const input = (args ?? {}) as Record<string, unknown>;
      const rows = queryService.query(caller, {
        domain: typeof input.domain === "string" ? input.domain : undefined,
        type: typeof input.type === "string" ? input.type : undefined,
        status: typeof input.status === "string" ? input.status : undefined,
        limit: clampLimit(input.limit, 50),
        view: parseView(input.view),
      });

      return toolResult({ count: rows.length, data: rows });
    },
  );

  server.registerTool(
    "search_entities",
    {
      description:
        "Full-text search across accessible entities with optional domain/type filters.",
      inputSchema: {
        query: z.string().min(1),
        domain: z.string().optional(),
        type: z.string().optional(),
        status: z.string().optional(),
        limit: z.union([z.number(), z.string()]).optional(),
        view: z.enum(["full", "summary"]).optional(),
      },
    },
    async (args) => {
      const input = (args ?? {}) as Record<string, unknown>;
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (!query) {
        return toolError("query is required");
      }

      const limit = clampLimit(input.limit, 25);
      const domain = typeof input.domain === "string" ? input.domain : undefined;
      const type = typeof input.type === "string" ? input.type : undefined;
      const status = typeof input.status === "string" ? input.status : undefined;

      let rows = queryService.search(caller, query, {
        view: parseView(input.view),
        limit: Math.min(limit * 4, 200),
      });

      if (domain) {
        rows = rows.filter((row) => row.domain === domain);
      }
      if (type) {
        rows = rows.filter((row) => row.type === type);
      }
      if (status) {
        rows = rows.filter((row) => row.status === status);
      }

      return toolResult({ count: rows.length, data: rows.slice(0, limit) });
    },
  );

  server.registerTool(
    "get_entity",
    {
      description:
        "Fetch a single entity by qualified ID.",
      inputSchema: {
        qualified_id: z.string().min(1).optional(),
        domain: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
        view: z.enum(["full", "summary"]).optional(),
      },
    },
    async (args) => {
      const input = (args ?? {}) as Record<string, unknown>;
      const qualifiedId =
        typeof input.qualified_id === "string" && input.qualified_id.trim().length > 0
          ? input.qualified_id.trim()
          : typeof input.id === "string"
            ? input.id.trim()
            : "";
      const domain = typeof input.domain === "string" ? input.domain.trim() : "";
      if (!qualifiedId) {
        return toolError("qualified_id or id is required");
      }

      const entity = queryService.getEntity(caller, qualifiedId, parseView(input.view));
      if (!entity || (domain && entity.domain !== domain)) {
        return toolError(`Entity not found: ${qualifiedId}`);
      }

      return toolResult({ entity });
    },
  );

  server.registerTool(
    "query_financials",
    {
      description:
        "Query financial entities with optional type/period filters.",
      inputSchema: {
        type: z.string().optional(),
        period: z.string().optional(),
        account: z.string().optional(),
        limit: z.union([z.number(), z.string()]).optional(),
      },
    },
    async (args) => {
      const input = (args ?? {}) as Record<string, unknown>;
      const type = typeof input.type === "string" ? input.type : undefined;
      const period = typeof input.period === "string" ? input.period : undefined;
      const account = typeof input.account === "string" ? input.account : undefined;
      const limit = clampLimit(input.limit, 50);

      let rows = queryService.query(caller, {
        domain: "finance",
        type,
        limit,
      });

      if (period) {
        rows = rows.filter((row) => {
          const fragments = periodFragments(row.frontmatter);
          return fragments.some((fragment) => fragment.includes(period));
        });
      }

      if (account) {
        const needle = account.toLowerCase();
        rows = rows.filter((row) => {
          const fm = row.frontmatter;
          return (
            String(fm.account ?? "").toLowerCase().includes(needle) ||
            String(fm.account_name ?? "").toLowerCase().includes(needle) ||
            String(fm.description ?? "").toLowerCase().includes(needle)
          );
        });
      }

      return toolResult({ count: rows.length, data: rows.slice(0, limit) });
    },
  );

  server.registerTool(
    "query_metrics",
    {
      description:
        "Query metric-like entities from revenue/finance domains with optional range filters.",
      inputSchema: {
        domain: z.string().optional(),
        metric: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.union([z.number(), z.string()]).optional(),
      },
    },
    async (args) => {
      const input = (args ?? {}) as Record<string, unknown>;
      const limit = clampLimit(input.limit, 50);
      const domain = typeof input.domain === "string" && input.domain.length > 0
        ? input.domain
        : "revenue";
      const metric = typeof input.metric === "string" ? input.metric.toLowerCase() : null;
      const from = typeof input.from === "string" ? input.from : null;
      const to = typeof input.to === "string" ? input.to : null;

      let rows = queryService.query(caller, { domain, limit });

      if (metric) {
        rows = rows.filter((row) => {
          const fm = row.frontmatter;
          return (
            row.type.toLowerCase().includes(metric) ||
            String(fm.metric ?? "").toLowerCase().includes(metric) ||
            String(fm.name ?? "").toLowerCase().includes(metric)
          );
        });
      }

      if (from || to) {
        rows = rows.filter((row) => {
          const value = periodComparableValue(row.frontmatter);
          if (!value) return false;
          if (from && value < from) return false;
          if (to && value > to) return false;
          return true;
        });
      }

      return toolResult({ count: rows.length, data: rows.slice(0, limit) });
    },
  );

  server.registerTool(
    "submit_document",
    {
      description:
        "Submit a document payload into a target domain by writing a QMD file through write-queue.",
      inputSchema: {
        domain: z.string().min(1),
        content: z.string().min(1),
        format: z.string().optional(),
        metadata: z.unknown().optional(),
      },
    },
    async (args) => {
      const input = (args ?? {}) as Record<string, unknown>;
      const access = evaluateAccess(caller, { tool: "submit_document" }, policy);
      if (!access.allowed) {
        return toolError(`Forbidden: ${access.reason}`);
      }

      const domain = typeof input.domain === "string" ? input.domain : "";
      const content = typeof input.content === "string" ? input.content : "";
      const format = typeof input.format === "string" ? input.format : "text";

      if (!domain || !content) {
        return toolError("Missing required fields: domain and content");
      }
      if (!DOMAIN_PATTERN.test(domain)) {
        return toolError(`Invalid domain "${domain}". Expected kebab-case domain name.`);
      }

      const timestamp = new Date().toISOString();
      const docId = `mcp-${slugify(`${domain}-${timestamp}`)}`;
      const frontmatter: Record<string, unknown> = {
        id: docId,
        type: "mcp_submitted_document",
        source: "mcp",
        format,
        submitted_by: caller.id,
        created_at: timestamp,
      };

      const metadata = parseMetadata(input.metadata);
      if (metadata) {
        frontmatter.metadata = metadata;
      }

      const filePath = domain === "knowledge"
        ? `knowledge/docs/${docId}.qmd`
        : `${domain}/imports/${docId}.qmd`;

      const intent: WriteIntent = {
        agentId: caller.id,
        agentToken: writeIntentToken,
        domain,
        operation: {
          type: "commit",
          files: [
            {
              path: filePath,
              content: qmd(frontmatter, content),
            },
          ],
          commitMessage: `${domain}: mcp submit ${docId}`,
        },
        metadata: {
          source: "mcp",
          submittedBy: caller.id,
          submittedAt: timestamp,
          ...(metadata ?? {}),
        },
      };

      const result = await writeQueue.submit(intent);
      if (!result.success) {
        return toolError(result.error?.message ?? "Submission failed");
      }

      return toolResult({
        success: true,
        intentId: result.intentId,
        commitSha: result.commitSha,
        filePath,
      });
    },
  );

  server.registerTool(
    "query_customers",
    {
      description:
        "Query customer records from revenue domain, optionally filtered by name.",
      inputSchema: {
        name: z.string().optional(),
        limit: z.union([z.number(), z.string()]).optional(),
      },
    },
    async (args) => {
      const input = (args ?? {}) as Record<string, unknown>;
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const limit = clampLimit(input.limit, 50);

      let rows = name
        ? queryService.search(caller, name)
        : queryService.query(caller, { domain: "revenue", limit });

      rows = rows.filter((row) => {
        const isRevenue = row.domain === "revenue";
        const maybeCustomer =
          row.type.toLowerCase().includes("customer") ||
          String(row.frontmatter.type ?? "").toLowerCase().includes("customer");
        return isRevenue && maybeCustomer;
      });

      return toolResult({ count: rows.length, data: rows.slice(0, limit) });
    },
  );

  server.registerTool(
    "query_inventory",
    {
      description:
        "Query inventory entities with optional product and warehouse filters.",
      inputSchema: {
        product: z.string().optional(),
        warehouse: z.string().optional(),
        limit: z.union([z.number(), z.string()]).optional(),
      },
    },
    async (args) => {
      const input = (args ?? {}) as Record<string, unknown>;
      const product = typeof input.product === "string" ? input.product.toLowerCase() : null;
      const warehouse = typeof input.warehouse === "string" ? input.warehouse.toLowerCase() : null;
      const limit = clampLimit(input.limit, 50);

      let rows = queryService.query(caller, { domain: "inventory", limit });
      if (product) {
        rows = rows.filter((row) => {
          const fm = row.frontmatter;
          return (
            String(fm.product ?? "").toLowerCase().includes(product) ||
            String(fm.sku ?? "").toLowerCase().includes(product) ||
            String(fm.name ?? "").toLowerCase().includes(product)
          );
        });
      }
      if (warehouse) {
        rows = rows.filter((row) =>
          String(row.frontmatter.warehouse ?? "").toLowerCase().includes(warehouse),
        );
      }

      return toolResult({ count: rows.length, data: rows.slice(0, limit) });
    },
  );

  server.registerResource(
    "communications-feed",
    "company://communications",
    { mimeType: "application/json" },
    async () => {
      const data = queryService.query(caller, {
        domain: "communications",
        limit: 100,
        view: "summary",
      });
      return {
        contents: [
          {
            uri: "company://communications",
            mimeType: "application/json",
            text: JSON.stringify({ count: data.length, data }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "document-index",
    "company://documents",
    { mimeType: "application/json" },
    async () => {
      const data = queryService.query(caller, {
        domain: "documents",
        limit: 100,
        view: "summary",
      });
      return {
        contents: [
          {
            uri: "company://documents",
            mimeType: "application/json",
            text: JSON.stringify({ count: data.length, data }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "financial-summary",
    "company://financials",
    { mimeType: "application/json" },
    async () => {
      const data = queryService.query(caller, { domain: "finance", limit: 50 });
      return {
        contents: [
          {
            uri: "company://financials",
            mimeType: "application/json",
            text: JSON.stringify({ count: data.length, data }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "customer-list",
    "company://customers",
    { mimeType: "application/json" },
    async () => {
      const data = queryService.query(caller, { domain: "revenue", limit: 100 });
      return {
        contents: [
          {
            uri: "company://customers",
            mimeType: "application/json",
            text: JSON.stringify({ count: data.length, data }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "inventory-status",
    "company://inventory",
    { mimeType: "application/json" },
    async () => {
      const data = queryService.query(caller, { domain: "inventory", limit: 100 });
      return {
        contents: [
          {
            uri: "company://inventory",
            mimeType: "application/json",
            text: JSON.stringify({ count: data.length, data }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    "business-metrics",
    "company://metrics",
    { mimeType: "application/json" },
    async () => {
      const revenue = queryService.query(caller, { domain: "revenue", limit: 50 });
      const finance = queryService.query(caller, { domain: "finance", limit: 50 });
      return {
        contents: [
          {
            uri: "company://metrics",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                revenue_count: revenue.length,
                finance_count: finance.length,
                revenue,
                finance,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "team-directory",
    "company://team",
    { mimeType: "application/json" },
    async () => {
      const data = queryService.query(caller, { domain: "people", limit: 100 });
      return {
        contents: [
          {
            uri: "company://team",
            mimeType: "application/json",
            text: JSON.stringify({ count: data.length, data }, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

export async function startMcpHttpServer(
  opts: StartMcpHttpServerOptions,
): Promise<McpHttpServerHandle> {
  const host = opts.host ?? "127.0.0.1";
  const serviceSecrets = opts.serviceSecrets ?? {};
  const writeIntentToken = getFirstInternalServiceSecret(serviceSecrets);
  if (!writeIntentToken) {
    throw new Error("Signed internal-service auth is not configured");
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname !== "/mcp") {
        sendJsonRpcError(res, 404, "Not Found", -32004);
        return;
      }

      const requestSlug = readHeaderValue(req.headers["x-company-slug"]);
      if (opts.tenantSlug && requestSlug && requestSlug !== opts.tenantSlug) {
        sendJsonRpcError(res, 403, "Forbidden", -32003);
        return;
      }

      const caller = extractCaller(req, serviceSecrets);
      if (!caller) {
        sendJsonRpcError(res, 401, "Unauthorized", -32001);
        return;
      }

      const mcpServer = createMcpServer(
        caller,
        opts.queryService,
        opts.writeQueue,
        writeIntentToken,
        opts.policy,
      );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await mcpServer.connect(transport);
      res.on("close", () => {
        void transport.close().catch(() => {});
        void mcpServer.close().catch(() => {});
      });
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("[company-db] MCP request failed:", error);
      sendJsonRpcError(res, 500, "Internal server error", -32603);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, () => resolve());
  });

  const address = server.address();
  const resolvedPort =
    typeof address === "object" && address ? address.port : opts.port;

  return {
    port: resolvedPort,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
