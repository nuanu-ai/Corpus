#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { writeFile } from "fs/promises";
import { basename } from "path";

function usage() {
  console.log(`Usage:
  node scripts/agent-mcp-cli.mjs list-tools [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs session [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs companies [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs profile [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs dashboard [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs members [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs settings [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs connectors [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs connector-action <provider> <action> [jsonInput] [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs documents [jsonArgs] [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs document-status <documentId> [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs document-download <documentId> [--output <path>] [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs document-delete <documentId> [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs get-file <repoPath> [--output <path>] [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs query [jsonArgs] [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs search <query> [jsonArgs] [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs get-entity <entityId> [--domain <domain>] [--view full|summary] [--company-id <id>] [--url <appUrl>] [--api-key <key>]
  node scripts/agent-mcp-cli.mjs call-tool <toolName> [jsonArgs] [--url <appUrl>] [--api-key <key>]

Defaults can come from env:
  CORPUS_APP_URL (default: http://localhost:3000)
  CORPUS_API_KEY
  CORPUS_COMPANY_ID
`);
}

function parseJsonObject(raw, label) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    throw new Error(`${label} must be a JSON object`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid json";
    console.error(`Failed to parse ${label}: ${msg}`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const positional = [];
  const named = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      named[key] = "true";
      continue;
    }
    named[key] = value;
    i += 1;
  }
  return { positional, named };
}

function parseToolResult(result) {
  const text = (result.content ?? [])
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("")
    .trim();

  if (!text) {
    return result;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function withCompanyId(args, companyId) {
  if (!companyId || args.company_id) return args;
  return { ...args, company_id: companyId };
}

const { positional, named } = parseArgs(process.argv.slice(2));
const command = positional[0];

if (!command || command === "-h" || command === "--help" || command === "help") {
  usage();
  process.exit(0);
}

const appUrl = (named.url || process.env.CORPUS_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const apiKey = named["api-key"] || process.env.CORPUS_API_KEY;
const companyId = named["company-id"] || process.env.CORPUS_COMPANY_ID;

if (!apiKey) {
  console.error("Missing API key. Set --api-key or CORPUS_API_KEY");
  process.exit(1);
}

const endpoint = `${appUrl}/api/agent/mcp`;
const client = new Client({ name: "corpus-agent-mcp-cli", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json, text/event-stream",
    },
  },
});

try {
  await client.connect(transport);

  if (command === "list-tools") {
    const tools = await client.listTools();
    console.log(JSON.stringify(tools.tools, null, 2));
    process.exit(0);
  }

  const simpleToolMap = {
    session: ["get_session", {}],
    companies: ["list_companies", {}],
    profile: ["get_profile", {}],
    dashboard: ["get_dashboard", withCompanyId({}, companyId)],
    members: ["get_company_members", withCompanyId({}, companyId)],
    settings: ["get_company_settings", withCompanyId({}, companyId)],
    connectors: ["list_connectors", withCompanyId({}, companyId)],
  };

  if (command in simpleToolMap) {
    const [toolName, args] = simpleToolMap[command];
    const result = await client.callTool({ name: toolName, arguments: args });
    console.log(JSON.stringify(parseToolResult(result), null, 2));
    process.exit(0);
  }

  if (command === "connector-action") {
    const provider = positional[1];
    const action = positional[2];
    if (!provider || !action) {
      console.error("connector-action requires <provider> <action>");
      usage();
      process.exit(1);
    }
    const input = parseJsonObject(positional[3], "jsonInput");
    const result = await client.callTool({
      name: "call_connector_action",
      arguments: withCompanyId({ provider, action, input }, companyId),
    });
    console.log(JSON.stringify(parseToolResult(result), null, 2));
    process.exit(0);
  }

  if (command === "documents") {
    const args = withCompanyId(parseJsonObject(positional[1], "jsonArgs"), companyId);
    const result = await client.callTool({ name: "list_documents", arguments: args });
    console.log(JSON.stringify(parseToolResult(result), null, 2));
    process.exit(0);
  }

  if (command === "document-status") {
    const documentId = positional[1];
    if (!documentId) {
      console.error("Missing documentId");
      usage();
      process.exit(1);
    }
    const result = await client.callTool({
      name: "get_document_status",
      arguments: withCompanyId({ document_id: documentId }, companyId),
    });
    console.log(JSON.stringify(parseToolResult(result), null, 2));
    process.exit(0);
  }

  if (command === "document-delete") {
    const documentId = positional[1];
    if (!documentId) {
      console.error("Missing documentId");
      usage();
      process.exit(1);
    }
    const result = await client.callTool({
      name: "delete_document",
      arguments: withCompanyId({ document_id: documentId }, companyId),
    });
    console.log(JSON.stringify(parseToolResult(result), null, 2));
    process.exit(0);
  }

  if (command === "get-file") {
    const filePath = positional[1];
    if (!filePath) {
      console.error("Missing repo-relative file path");
      usage();
      process.exit(1);
    }

    const result = await client.callTool({
      name: "get_company_file",
      arguments: withCompanyId({ path: filePath }, companyId),
    });
    const payload = parseToolResult(result);
    if (!payload || typeof payload !== "object" || !("content" in payload)) {
      console.log(JSON.stringify(payload, null, 2));
      process.exit(0);
    }

    const outputPath = named.output;
    if (outputPath) {
      await writeFile(outputPath, String(payload.content ?? ""));
      console.log(JSON.stringify({ savedTo: outputPath, path: payload.path ?? filePath }, null, 2));
      process.exit(0);
    }

    console.log(String(payload.content ?? ""));
    process.exit(0);
  }

  if (command === "document-download") {
    const documentId = positional[1];
    if (!documentId) {
      console.error("Missing documentId");
      usage();
      process.exit(1);
    }

    const descriptorResult = await client.callTool({
      name: "get_document_download",
      arguments: withCompanyId({ document_id: documentId }, companyId),
    });
    const descriptor = parseToolResult(descriptorResult);
    if (!descriptor || typeof descriptor !== "object" || !("downloadPath" in descriptor)) {
      console.error(JSON.stringify(descriptor, null, 2));
      process.exit(1);
    }

    const document = descriptor.document ?? {};
    const downloadPath =
      typeof descriptor.downloadUrl === "string" && descriptor.downloadUrl
        ? descriptor.downloadUrl
        : `${appUrl}${descriptor.downloadPath}`;
    const outputPath =
      named.output ||
      (typeof document.fileName === "string" && document.fileName.trim().length > 0
        ? basename(document.fileName)
        : `${documentId}.bin`);

    const response = await fetch(downloadPath, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(body || `Download failed: ${response.status}`);
      process.exit(1);
    }

    const arrayBuffer = await response.arrayBuffer();
    await writeFile(outputPath, Buffer.from(arrayBuffer));
    console.log(JSON.stringify({
      savedTo: outputPath,
      bytes: arrayBuffer.byteLength,
      fileName: document.fileName ?? outputPath,
      contentType: document.contentType ?? response.headers.get("content-type"),
    }, null, 2));
    process.exit(0);
  }

  if (command === "query") {
    const args = withCompanyId(parseJsonObject(positional[1], "jsonArgs"), companyId);
    const result = await client.callTool({ name: "query_company_entities", arguments: args });
    console.log(JSON.stringify(parseToolResult(result), null, 2));
    process.exit(0);
  }

  if (command === "search") {
    const query = positional[1];
    if (!query) {
      console.error("Missing search query");
      usage();
      process.exit(1);
    }
    const args = withCompanyId(parseJsonObject(positional[2], "jsonArgs"), companyId);
    const result = await client.callTool({
      name: "search_company_entities",
      arguments: { query, ...args },
    });
    console.log(JSON.stringify(parseToolResult(result), null, 2));
    process.exit(0);
  }

  if (command === "get-entity") {
    const entityId = positional[1];
    if (!entityId) {
      console.error("Missing entityId");
      usage();
      process.exit(1);
    }
    const identityArgs = named.domain
      ? { domain: named.domain, id: entityId }
      : { qualified_id: entityId };
    const result = await client.callTool({
      name: "get_company_entity",
      arguments: withCompanyId(
        { ...identityArgs, ...(named.view ? { view: named.view } : {}) },
        companyId,
      ),
    });
    console.log(JSON.stringify(parseToolResult(result), null, 2));
    process.exit(0);
  }

  if (command === "call-tool") {
    const toolName = positional[1];
    if (!toolName) {
      console.error("Missing tool name for call-tool");
      usage();
      process.exit(1);
    }
    const args = parseJsonObject(positional[2], "jsonArgs");
    const result = await client.callTool({ name: toolName, arguments: args });
    console.log(JSON.stringify(parseToolResult(result), null, 2));
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(1);
} finally {
  await transport.close().catch(() => {});
  await client.close().catch(() => {});
}
