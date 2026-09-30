import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MIN_CUSTOM_MCP_TIMEOUT_MS = 5_000;
const MAX_CUSTOM_MCP_TIMEOUT_MS = 120_000;

function resolveTimeoutMs(raw: unknown, fallback: number): number {
  const value = typeof raw === "number"
    ? raw
    : typeof raw === "string" && raw.trim().length > 0
      ? Number(raw)
      : NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(
    MAX_CUSTOM_MCP_TIMEOUT_MS,
    Math.max(MIN_CUSTOM_MCP_TIMEOUT_MS, Math.round(value)),
  );
}

const DEFAULT_CUSTOM_MCP_TIMEOUT_MS = resolveTimeoutMs(
  process.env.CUSTOM_MCP_TIMEOUT_MS,
  15_000,
);
type CustomMcpToolConfig = {
  name: string;
  mode: "read" | "write";
  allow: boolean;
  approvalRequired: boolean;
  notes?: string | null;
};

type CustomMcpCredentials = {
  connectionLabel?: string;
  serverUrl: string;
  bearerToken?: string;
  allowedTools: CustomMcpToolConfig[];
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(label));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function parseAllowedTools(value: unknown): CustomMcpToolConfig[] {
  const parsed =
    typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("allowedTools must be a non-empty JSON array");
  }

  const seen = new Set<string>();
  return parsed.map((entry, index) => {
    if (typeof entry === "string") {
      const name = normalizeString(entry);
      if (!name) {
        throw new Error(`allowedTools[${index}] must not be empty`);
      }
      if (seen.has(name)) {
        throw new Error(`Duplicate custom MCP tool name: ${name}`);
      }
      seen.add(name);
      return {
        name,
        mode: "read",
        allow: true,
        approvalRequired: false,
      };
    }

    if (!isRecord(entry)) {
      throw new Error(`allowedTools[${index}] must be a string or object`);
    }

    const name = normalizeString(entry.name);
    if (!name) {
      throw new Error(`allowedTools[${index}].name is required`);
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate custom MCP tool name: ${name}`);
    }
    seen.add(name);

    const rawMode = normalizeString(entry.mode).toLowerCase();
    const mode = rawMode === "write" ? "write" : "read";

    return {
      name,
      mode,
      allow: entry.allow !== false,
      approvalRequired: entry.approvalRequired === true,
      notes: normalizeString(entry.notes) || null,
    };
  });
}

export function getCustomMcpCredentials(
  credentials: Record<string, unknown>,
): CustomMcpCredentials | null {
  const serverUrlRaw =
    normalizeString(credentials.serverUrl) ||
    normalizeString(credentials.url);
  if (!serverUrlRaw) {
    return null;
  }

  const url = new URL(serverUrlRaw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Custom MCP serverUrl must use http or https");
  }

  return {
    connectionLabel: normalizeString(credentials.connectionLabel) || undefined,
    serverUrl: url.toString(),
    bearerToken:
      normalizeString(credentials.bearerToken) ||
      normalizeString(credentials.token) ||
      undefined,
    allowedTools: parseAllowedTools(credentials.allowedTools),
  };
}

async function withCustomMcpClient<T>(
  credentials: CustomMcpCredentials,
  fn: (client: Client) => Promise<T>,
  options?: { timeoutMs?: number },
) {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_CUSTOM_MCP_TIMEOUT_MS;
  const transport = new StreamableHTTPClientTransport(
    new URL(credentials.serverUrl),
    {
      requestInit: {
        headers: credentials.bearerToken
          ? { Authorization: `Bearer ${credentials.bearerToken}` }
          : undefined,
      },
    },
  );

  const client = new Client({
    name: "corpus-custom-mcp",
    version: "1.0.0",
  });
  await withTimeout(
    client.connect(transport),
    timeoutMs,
    "Custom MCP connection timed out",
  );

  try {
    return await withTimeout(
      fn(client),
      timeoutMs,
      "Custom MCP request timed out",
    );
  } finally {
    await client.close();
  }
}

function extractToolText(result: unknown) {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return "";
  }

  return result.content
    .filter((entry) => isRecord(entry) && entry.type === "text" && typeof entry.text === "string")
    .map((entry) => String(entry.text))
    .join("");
}

function isToolErrorResult(result: unknown): boolean {
  return Boolean(
    isRecord(result) &&
      result.isError === true,
  );
}

function firstStringValue(
  record: Record<string, unknown>,
  keys: readonly string[],
) {
  for (const key of keys) {
    const value = normalizeString(record[key]);
    if (value) return value;
  }
  return "";
}

function getCustomMcpToolName(payload: Record<string, unknown>) {
  return firstStringValue(payload, ["toolName", "tool_name", "name", "tool"]);
}

function getCustomMcpToolArguments(payload: Record<string, unknown>) {
  const nested =
    payload.arguments ??
    payload.args ??
    payload.parameters ??
    payload.params ??
    payload.input;
  if (isRecord(nested)) return nested;

  const direct = { ...payload };
  for (const key of [
    "connectionId",
    "toolName",
    "tool_name",
    "name",
    "tool",
    "arguments",
    "args",
    "parameters",
    "params",
    "input",
    "timeoutMs",
    "timeout_ms",
  ]) {
    delete direct[key];
  }
  return direct;
}

function decorateCustomMcpToolForAgent(
  tool: { name: string; description?: string; inputSchema?: unknown },
  configuredTool?: CustomMcpToolConfig,
) {
  return {
    name: tool.name,
    description: tool.description ?? null,
    inputSchema: tool.inputSchema ?? null,
    ...(configuredTool?.notes ? { notes: configuredTool.notes } : {}),
  };
}
export async function validateCustomMcpConnection(
  credentialsRecord: Record<string, unknown>,
) {
  const credentials = getCustomMcpCredentials(credentialsRecord);
  if (!credentials) {
    throw new Error("serverUrl is required for custom_mcp");
  }

  const tools = await withCustomMcpClient(credentials, async (client) => {
    const result = await client.listTools();
    return result.tools;
  });

  const availableNames = new Set(tools.map((tool) => tool.name));
  const missingTool = credentials.allowedTools.find(
    (tool) => tool.allow && !availableNames.has(tool.name),
  );
  if (missingTool) {
    throw new Error(`Configured MCP tool not found on server: ${missingTool.name}`);
  }

  return {
    externalAccountId: credentials.serverUrl,
    metadata: {
      connectionLabel: credentials.connectionLabel ?? null,
      serverUrl: credentials.serverUrl,
      discoveredToolCount: tools.length,
      discoveredToolNames: tools.map((tool) => tool.name),
      allowedToolCount: credentials.allowedTools.filter((tool) => tool.allow).length,
      allowedToolNames: credentials.allowedTools
        .filter((tool) => tool.allow)
        .map((tool) => tool.name),
    },
  };
}

export async function executeCustomMcpAction(
  connection: {
    id: string;
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const credentials = getCustomMcpCredentials(connection.credentials);
  if (!credentials) {
    return {
      status: 400,
      body: { error: "custom_mcp credentials are incomplete" },
    };
  }

  const allowedReadTools = credentials.allowedTools.filter(
    (tool) => tool.allow && tool.mode === "read",
  );

  if (action === "list_tools") {
    const tools = await withCustomMcpClient(credentials, async (client) => {
      const result = await client.listTools();
      const allowedNames = new Set(allowedReadTools.map((tool) => tool.name));
      const allowedByName = new Map(allowedReadTools.map((tool) => [tool.name, tool]));
      return result.tools
        .filter((tool) => allowedNames.has(tool.name))
        .map((tool) => decorateCustomMcpToolForAgent(tool, allowedByName.get(tool.name)));
    });

    return {
      status: 200,
      body: {
        provider: "custom_mcp",
        action,
        connectionId: connection.id,
        connectionLabel:
          (credentials.connectionLabel ??
            normalizeString(connection.metadata?.connectionLabel)) ||
          null,
        count: tools.length,
        returnedCount: tools.length,
        hasMore: false,
        tools,
      },
    };
  }

  if (action !== "call_tool") {
    return {
      status: 400,
      body: { error: `Unsupported custom_mcp action: ${action}` },
    };
  }

  const toolName = getCustomMcpToolName(payload);
  if (!toolName) {
    return {
      status: 400,
      body: { error: "input.toolName is required" },
    };
  }

  const configuredTool = credentials.allowedTools.find(
    (tool) => tool.name === toolName,
  );
  if (!configuredTool || !configuredTool.allow) {
    return {
      status: 400,
      body: { error: "This MCP tool is not allowlisted for the connector" },
    };
  }
  if (configuredTool.mode !== "read") {
    return {
      status: 400,
      body: { error: "Only read-classified custom MCP tools are allowed" },
    };
  }
  if (configuredTool.approvalRequired) {
    return {
      status: 400,
      body: { error: "This MCP tool requires approval and is not available through bearer-safe connector access" },
    };
  }

  try {
    const toolArguments = getCustomMcpToolArguments(payload);
    const timeoutMs = resolveTimeoutMs(
      payload.timeoutMs ?? payload.timeout_ms,
      DEFAULT_CUSTOM_MCP_TIMEOUT_MS,
    );
    const result = await withCustomMcpClient(credentials, async (client) =>
      client.callTool({
        name: toolName,
        arguments: toolArguments,
      }),
      { timeoutMs },
    );
    if (isToolErrorResult(result)) {
      const errorText =
        extractToolText(result) || "Custom MCP tool returned an error";

      return {
        status: 502,
        body: {
          error: errorText,
          provider: "custom_mcp",
          action,
          toolName,
          connectionId: connection.id,
          connectionLabel:
            (credentials.connectionLabel ??
              normalizeString(connection.metadata?.connectionLabel)) ||
            null,
          result,
        },
      };
    }

    return {
      status: 200,
      body: {
        provider: "custom_mcp",
        action,
        toolName,
        connectionId: connection.id,
        connectionLabel:
          (credentials.connectionLabel ??
            normalizeString(connection.metadata?.connectionLabel)) ||
          null,
        text: extractToolText(result),
        result,
        ...(isRecord(result) && Array.isArray(result.content)
          ? {
              contentCount: result.content.length,
              returnedContentCount: result.content.length,
              contentTruncated: false,
            }
          : {}),
      },
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        error:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Custom MCP request failed",
      },
    };
  }
}
