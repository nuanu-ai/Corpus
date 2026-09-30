#!/usr/bin/env node

function usage() {
  console.log(`Usage:
  node bin/openclaw-corpus-adapter.mjs session
  node bin/openclaw-corpus-adapter.mjs tools
  node bin/openclaw-corpus-adapter.mjs companies
  node bin/openclaw-corpus-adapter.mjs dashboard [jsonInput]
  node bin/openclaw-corpus-adapter.mjs query [jsonInput]
  node bin/openclaw-corpus-adapter.mjs search [jsonInput]
  node bin/openclaw-corpus-adapter.mjs get-entity [jsonInput]
  node bin/openclaw-corpus-adapter.mjs get-file [jsonInput]
  node bin/openclaw-corpus-adapter.mjs connectors [jsonInput]
  node bin/openclaw-corpus-adapter.mjs connector [jsonInput]
  node bin/openclaw-corpus-adapter.mjs documents [jsonInput]
  node bin/openclaw-corpus-adapter.mjs document-questions [jsonInput]
  node bin/openclaw-corpus-adapter.mjs answer-document-questions [jsonInput]

Named options:
  --url <baseUrl>
  --api-key <token>
  --company-id <companyId>

Env:
  CORPUS_APP_URL      default: http://localhost:3000
  CORPUS_API_KEY      required
  CORPUS_COMPANY_ID   optional default for company-scoped commands
`);
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

function parseJsonObject(raw, label) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    throw new Error(`${label} must be a JSON object`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid json";
    console.error(`Failed to parse ${label}: ${message}`);
    process.exit(1);
  }
}

function toQueryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}

function resolveCompanyId(input, named) {
  const candidate =
    input.company_id ??
    input.companyId ??
    named["company-id"] ??
    process.env.CORPUS_COMPANY_ID ??
    null;

  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

function resolveSummaryView(input) {
  return input.view === "full" || input.view === "summary" ? input.view : "summary";
}

function resolveQueryLimit(input) {
  return Number.isFinite(input.limit) ? input.limit : 6;
}

function resolveSearchLimit(input) {
  return Number.isFinite(input.limit) ? input.limit : 5;
}

function resolveDocumentsLimit(input) {
  return Number.isFinite(input.limit) ? input.limit : 10;
}

function resolveFilePreviewChars(input) {
  const candidate = input.max_chars ?? input.maxChars;
  return Number.isFinite(candidate) ? candidate : 4000;
}

function truncateText(text, maxChars = 1600) {
  if (typeof text !== "string") return String(text ?? "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function compactEntity(item) {
  if (!item || typeof item !== "object") return item;
  return {
    id: item.id,
    qualifiedId: item.qualifiedId ?? item.qualified_id,
    type: item.type,
    domain: item.domain,
    title: item.title,
    filePath: item.filePath ?? item.file_path,
    periodLabel: item.periodLabel ?? item.period_label,
    managerialSummary:
      typeof item.managerialSummary === "string"
        ? truncateText(item.managerialSummary, 220)
        : undefined,
    requiresReview: item.requiresReview ?? item.requires_review,
    reviewPending: item.reviewPending ?? item.review_pending,
  };
}

function compactDocument(item) {
  if (!item || typeof item !== "object") return item;
  return {
    id: item.id,
    fileName: item.fileName,
    fileType: item.fileType,
    status: item.status,
    documentType: item.documentType,
    reportingPeriod: item.reportingPeriod,
    reviewRequired: item.reviewRequired,
    clarificationPendingCount: item.clarificationPendingCount,
    createdAt: item.createdAt,
  };
}

function compactConnector(item) {
  if (!item || typeof item !== "object") return item;
  return {
    id: item.id,
    provider: item.provider,
    status: item.status,
    lastSyncAt: item.lastSyncAt,
    lastError:
      typeof item.lastError === "string" ? truncateText(item.lastError, 140) : item.lastError,
    capabilities: Array.isArray(item.capabilities) ? item.capabilities : undefined,
  };
}

function compactDashboard(body) {
  if (!body || typeof body !== "object") return body;
  const dashboard = body.dashboard && typeof body.dashboard === "object" ? body.dashboard : null;
  return {
    company: body.company,
    dashboard: dashboard
      ? {
          managementSummary:
            typeof dashboard.managementSummary === "string"
              ? truncateText(dashboard.managementSummary, 700)
              : dashboard.managementSummary,
          documentCount: dashboard.documentCount,
          connectors: Array.isArray(dashboard.connectors)
            ? dashboard.connectors.slice(0, 8).map(compactConnector)
            : [],
        }
      : body.dashboard,
  };
}

function compactConnectors(body, input) {
  if (!body || typeof body !== "object") return body;
  const includeCatalog = input.full === true || input.include_catalog === true;
  return {
    company: body.company,
    connectors: Array.isArray(body.connectors) ? body.connectors.map(compactConnector) : [],
    connectorCount: Array.isArray(body.connectors) ? body.connectors.length : 0,
    catalogCount: Array.isArray(body.catalog) ? body.catalog.length : undefined,
    hubCatalogCount: Array.isArray(body.hubCatalog) ? body.hubCatalog.length : undefined,
    ...(includeCatalog
      ? {
          catalog: body.catalog,
          hubCatalog: body.hubCatalog,
        }
      : {}),
  };
}

function compactQueryLike(body) {
  if (Array.isArray(body)) {
    return {
      count: body.length,
      results: body.slice(0, 5).map(compactEntity),
    };
  }
  if (body && typeof body === "object" && Array.isArray(body.results)) {
    return {
      count: typeof body.count === "number" ? body.count : body.results.length,
      query: body.query,
      domain: body.domain,
      retrievalMode: body.retrievalMode,
      results: body.results.slice(0, 5).map(compactEntity),
    };
  }
  return body;
}

function compactDocuments(body) {
  if (!Array.isArray(body)) return body;
  return {
    count: body.length,
    documents: body.slice(0, 10).map(compactDocument),
  };
}

function compactDocumentQuestions(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.items)) return body;
  return {
    capability: body.capability,
    summary: body.summary,
    endpoints: body.endpoints,
    answerContract: body.answerContract,
    items: body.items.slice(0, 10).map((item) => ({
      documentId: item.documentId,
      fileName: item.fileName,
      status: item.status,
      questionCount: item.questionCount,
      sourceContext: item.sourceContext,
      uploadProvenance: item.uploadProvenance,
      questions: Array.isArray(item.questions)
        ? item.questions.map((question) => ({
            key: question.key,
            label: question.label,
            prompt: question.prompt,
            type: question.type,
            required: question.required,
            options: question.options,
          }))
        : [],
      questionsUrl: item.questionsUrl,
    })),
  };
}

function compactGetEntity(body) {
  return compactEntity(body);
}

function compactGetFile(result) {
  const body = result?.body;
  if (typeof body === "string") {
    return {
      path: result.path,
      contentType: result.contentType,
      contentDisposition: result.contentDisposition,
      body: truncateText(body, 1800),
    };
  }
  if (!body || typeof body !== "object") return result;
  return {
    path: result.path,
    contentType: result.contentType,
    contentDisposition: result.contentDisposition,
    body: {
      ...body,
      content: typeof body.content === "string" ? truncateText(body.content, 1800) : body.content,
    },
  };
}

function compactCommandResult(command, body, input, transportMeta) {
  if (input.raw === true || input.full === true) {
    return body;
  }

  switch (command) {
    case "dashboard":
      return compactDashboard(body);
    case "query":
    case "search":
      return compactQueryLike(body);
    case "get-entity":
      return compactGetEntity(body);
    case "connectors":
      return compactConnectors(body, input);
    case "documents":
      return compactDocuments(body);
    case "document-questions":
      return compactDocumentQuestions(body);
    case "get-file":
      return compactGetFile({
        path: input.path,
        contentType: transportMeta?.contentType,
        contentDisposition: transportMeta?.contentDisposition,
        body,
      });
    default:
      return body;
  }
}

function buildHeaders({ apiKey, companyId, contentType } = {}) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  if (companyId) {
    headers["x-company-id"] = companyId;
  }

  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  return headers;
}

async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const contentDisposition = response.headers.get("content-disposition");
  const text = await response.text();

  let parsed = text;
  if (contentType.includes("application/json")) {
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    contentType,
    contentDisposition,
    body: parsed,
  };
}

async function request({ appUrl, apiKey, companyId, path, method = "GET", query, jsonBody }) {
  const url = `${appUrl}${path}${toQueryString(query ?? {})}`;
  const response = await fetch(url, {
    method,
    headers: buildHeaders({
      apiKey,
      companyId,
      contentType: jsonBody ? "application/json" : undefined,
    }),
    body: jsonBody ? JSON.stringify(jsonBody) : undefined,
  });

  const parsed = await parseResponseBody(response);
  if (!parsed.ok) {
    const error =
      typeof parsed.body === "object" && parsed.body && "error" in parsed.body
        ? parsed.body.error
        : parsed.body;
    console.error(typeof error === "string" ? error : JSON.stringify(error, null, 2));
    process.exit(1);
  }

  return parsed;
}

const TOOL_SPECS = [
  {
    name: "session",
    surface: "REST",
    description: "Inspect API key scopes, company access, and endpoint map.",
  },
  {
    name: "tools",
    surface: "local",
    description: "List the adapter operations exposed to OpenClaw.",
  },
  {
    name: "companies",
    surface: "REST",
    description: "List companies available to the API key.",
  },
  {
    name: "dashboard",
    surface: "REST",
    description: "Read the company dashboard summary for the active company.",
  },
  {
    name: "query",
    surface: "REST",
    description: "Query Company-DB entities by domain/type/status/documentId.",
  },
  {
    name: "search",
    surface: "REST",
    description: "Full-text search Company-DB entities.",
  },
  {
    name: "get-entity",
    surface: "REST",
    description: "Read one Company-DB entity by qualified_id or domain + id.",
  },
  {
    name: "get-file",
    surface: "REST",
    description: "Read one raw Company-DB file by repo-relative path.",
  },
  {
    name: "connectors",
    surface: "REST",
    description: "List live connector connections and the machine catalog.",
  },
  {
    name: "connector",
    surface: "REST",
    description: "Run one connector action through the unified agent connector surface.",
  },
  {
    name: "documents",
    surface: "REST",
    description: "List company documents with limit and offset.",
  },
  {
    name: "document-questions",
    surface: "REST",
    description: "List pending Document Questions for uploaded documents and the answer contract.",
  },
  {
    name: "answer-document-questions",
    surface: "REST",
    description: "Answer Document Questions for one document. Input: { documentId, answers, reprocess?, saveTemplate?, applyToSimilar? }.",
  },
];

const { positional, named } = parseArgs(process.argv.slice(2));
const command = positional[0];

if (!command || command === "help" || command === "--help" || command === "-h") {
  usage();
  process.exit(0);
}

const appUrl = (named.url || process.env.CORPUS_APP_URL || "http://localhost:3000").replace(/\/$/, "");
const apiKey = named["api-key"] || process.env.CORPUS_API_KEY;

const input = parseJsonObject(positional[1], "jsonInput");
const companyId = resolveCompanyId(input, named);

let result;

switch (command) {
  case "tools":
    console.log(JSON.stringify(TOOL_SPECS, null, 2));
    process.exit(0);
}

if (!apiKey) {
  console.error("Missing API key. Set --api-key or CORPUS_API_KEY");
  process.exit(1);
}

switch (command) {
  case "session":
    result = await request({
      appUrl,
      apiKey,
      path: "/api/agent/session",
    });
    console.log(JSON.stringify(result.body, null, 2));
    process.exit(0);

  case "companies":
    result = await request({
      appUrl,
      apiKey,
      path: "/api/agent/companies",
    });
    console.log(JSON.stringify(result.body, null, 2));
    process.exit(0);

  case "dashboard":
    result = await request({
      appUrl,
      apiKey,
      companyId,
      path: "/api/agent/dashboard",
    });
    console.log(JSON.stringify(compactCommandResult(command, result.body, input), null, 2));
    process.exit(0);

  case "query":
    result = await request({
      appUrl,
      apiKey,
      companyId,
      path: "/api/company/query",
      query: {
        domain: input.domain,
        type: input.type,
        status: input.status,
        documentId: input.documentId,
        limit: resolveQueryLimit(input),
        offset: input.offset,
        view: resolveSummaryView(input),
      },
    });
    console.log(JSON.stringify(compactCommandResult(command, result.body, input), null, 2));
    process.exit(0);

  case "search":
    result = await request({
      appUrl,
      apiKey,
      companyId,
      path: "/api/company/search",
      query: {
        q: input.query,
        limit: resolveSearchLimit(input),
        view: resolveSummaryView(input),
      },
    });
    console.log(JSON.stringify(compactCommandResult(command, result.body, input), null, 2));
    process.exit(0);

  case "get-entity":
    result = await request({
      appUrl,
      apiKey,
      companyId,
      path: "/api/company/entity",
      query: {
        qualified_id: input.qualified_id ?? input.qualifiedId,
        domain: input.domain,
        id: input.id,
        view: resolveSummaryView(input),
      },
    });
    console.log(JSON.stringify(compactCommandResult(command, result.body, input), null, 2));
    process.exit(0);

  case "get-file":
    result = await request({
      appUrl,
      apiKey,
      companyId,
      path: "/api/company/file",
      query: {
        path: input.path,
        download: input.download ? "1" : undefined,
        full: input.full ? "1" : undefined,
        maxChars: input.full ? undefined : resolveFilePreviewChars(input),
      },
    });
    console.log(
      JSON.stringify(
        compactCommandResult(command, result.body, input, {
          contentType: result.contentType,
          contentDisposition: result.contentDisposition,
        }),
        null,
        2,
      ),
    );
    process.exit(0);

  case "connectors":
    result = await request({
      appUrl,
      apiKey,
      companyId,
      path: "/api/agent/connectors",
    });
    console.log(JSON.stringify(compactCommandResult(command, result.body, input), null, 2));
    process.exit(0);

  case "connector":
    result = await request({
      appUrl,
      apiKey,
      companyId,
      path: "/api/agent/connectors",
      method: "POST",
      jsonBody: {
        provider: input.provider,
        action: input.action,
        input: input.input ?? {},
      },
    });
    console.log(JSON.stringify(result.body, null, 2));
    process.exit(0);

  case "documents":
    result = await request({
      appUrl,
      apiKey,
      companyId,
      path: "/api/documents",
      query: {
        limit: resolveDocumentsLimit(input),
        offset: input.offset,
      },
    });
    console.log(JSON.stringify(compactCommandResult(command, result.body, input), null, 2));
    process.exit(0);

  case "document-questions":
    result = await request({
      appUrl,
      apiKey,
      companyId,
      path: "/api/documents/questions",
      query: {
        limit: resolveDocumentsLimit(input),
      },
    });
    console.log(JSON.stringify(compactCommandResult(command, result.body, input), null, 2));
    process.exit(0);

  case "answer-document-questions": {
    const documentId = input.documentId ?? input.document_id;
    if (typeof documentId !== "string" || documentId.trim().length === 0) {
      console.error("Missing documentId");
      process.exit(1);
    }
    result = await request({
      appUrl,
      apiKey,
      companyId,
      path: `/api/documents/${encodeURIComponent(documentId.trim())}/clarifications`,
      method: "POST",
      jsonBody: {
        answers: input.answers ?? {},
        reprocess: input.reprocess,
        saveTemplate: input.saveTemplate ?? input.save_template,
        applyToSimilar: input.applyToSimilar ?? input.apply_to_similar,
      },
    });
    console.log(JSON.stringify(result.body, null, 2));
    process.exit(0);
  }

  default:
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
}
