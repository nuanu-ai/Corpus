import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type LinkedInMcpCredentials = {
  serverUrl: string;
  bearerToken?: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getLinkedInMcpCredentials(
  credentials: Record<string, unknown>,
): LinkedInMcpCredentials | null {
  const serverUrl = normalizeString(credentials.serverUrl);
  if (!serverUrl) {
    return null;
  }

  const url = new URL(serverUrl);
  const bearerToken = normalizeString(credentials.bearerToken);

  return {
    serverUrl: url.toString(),
    ...(bearerToken ? { bearerToken } : {}),
  };
}

async function withLinkedInMcpClient<T>(
  credentialsRecord: Record<string, unknown>,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const credentials = getLinkedInMcpCredentials(credentialsRecord);
  if (!credentials) {
    throw new Error("LinkedIn MCP credentials are incomplete");
  }

  const transport = new StreamableHTTPClientTransport(new URL(credentials.serverUrl), {
    requestInit: {
      headers: credentials.bearerToken
        ? {
            Authorization: `Bearer ${credentials.bearerToken}`,
          }
        : undefined,
    },
  });
  const client = new Client({ name: "corpus-linkedin-mcp", version: "1.0.0" });
  await client.connect(transport);

  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function validateLinkedInMcpConnection(credentials: Record<string, unknown>) {
  const tools = await withLinkedInMcpClient(credentials, async (client) => {
    const result = await client.listTools();
    return result.tools;
  });

  const normalized = getLinkedInMcpCredentials(credentials);
  return {
    externalAccountId: normalized?.serverUrl ?? null,
    metadata: {
      serverUrl: normalized?.serverUrl ?? null,
      toolNames: tools.slice(0, 10).map((tool) => tool.name),
      toolCount: tools.length,
    },
  };
}

function extractToolText(result: unknown) {
  if (!result || typeof result !== "object") {
    return "";
  }

  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");
}

function isReadOnlyLinkedInToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (!/^[a-z0-9:_-]+$/.test(normalized)) {
    return false;
  }

  const [actionVerb] = normalized.split(/[:_-]+/, 1);
  if (!actionVerb) {
    return false;
  }

  if (["get", "list", "read", "search", "find", "fetch"].includes(actionVerb)) {
    return true;
  }

  if (
    [
      "create",
      "update",
      "delete",
      "post",
      "publish",
      "comment",
      "reply",
      "like",
      "send",
      "invite",
      "message",
      "write",
    ].includes(actionVerb)
  ) {
    return false;
  }

  return false;
}

export async function executeLinkedInMcpAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  if (action === "list_tools") {
    const tools = await withLinkedInMcpClient(connection.credentials, async (client) => {
      const result = await client.listTools();
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? null,
        inputSchema: tool.inputSchema ?? null,
      }));
    });

    return {
      status: 200,
      body: {
        provider: "linkedin_mcp",
        action,
        count: tools.length,
        tools,
      },
    };
  }

  if (action === "call_tool") {
    const toolName =
      typeof payload.toolName === "string" && payload.toolName.trim().length > 0
        ? payload.toolName.trim()
        : "";
    if (!toolName) {
      return {
        status: 400,
        body: { error: "input.toolName is required" },
      };
    }
    if (!isReadOnlyLinkedInToolName(toolName)) {
      return {
        status: 400,
        body: { error: "Only read-only LinkedIn MCP tools are allowed" },
      };
    }

    const result = await withLinkedInMcpClient(connection.credentials, async (client) =>
      client.callTool({
        name: toolName,
        arguments:
          payload.arguments && typeof payload.arguments === "object"
            ? (payload.arguments as Record<string, unknown>)
            : {},
      }),
    );

    return {
      status: 200,
      body: {
        provider: "linkedin_mcp",
        action,
        toolName,
        text: extractToolText(result),
        result,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported linkedin_mcp action: ${action}` },
  };
}
