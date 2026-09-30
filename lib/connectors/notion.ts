import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_NOTION_BASE_URL = "https://api.notion.com";
const DEFAULT_NOTION_VERSION = "2025-09-03";
const NOTION_TIMEOUT_MS = 15_000;
const DEFAULT_NOTION_LIMIT = 25;
const MAX_NOTION_LIMIT = 100;

export type NotionCredentials = {
  token: string;
  baseUrl: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeIdentifier(value: string) {
  return value.replace(/-/g, "").trim().toLowerCase();
}

export function normalizeNotionBaseUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_NOTION_BASE_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Notion API base URL must use http or https");
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function getNotionCredentials(
  credentials: Record<string, unknown>,
): NotionCredentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.apiKey) ||
    normalizeString(credentials.integrationToken);
  if (!token) {
    return null;
  }

  return {
    token,
    baseUrl: normalizeNotionBaseUrl(
      normalizeString(credentials.baseUrl) ||
        normalizeString(credentials.apiBaseUrl) ||
        DEFAULT_NOTION_BASE_URL,
    ),
  };
}

function notionHeaders(token: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Notion-Version": DEFAULT_NOTION_VERSION,
  };
}

function buildNotionErrorMessage(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "Notion authentication failed. Reconnect Notion with a valid integration token.";
  }
  if (isRecord(payload) && typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message.trim();
  }
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }
  return `Notion request failed (${status})`;
}

async function notionRequest<T>(
  credentials: NotionCredentials,
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  },
): Promise<T> {
  const url = new URL(
    path.startsWith("/") ? `${credentials.baseUrl}${path}` : `${credentials.baseUrl}/${path}`,
  );
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchWithTimeoutAndRetry(
    url,
    {
      method: options?.method ?? "GET",
      headers: notionHeaders(credentials.token),
      body:
        options?.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      cache: "no-store",
    },
    {
      timeoutMs: NOTION_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(buildNotionErrorMessage(response.status, payload));
  }

  return payload as T;
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_NOTION_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_NOTION_LIMIT);
}

function getCursor(input: Record<string, unknown>) {
  return (
    normalizeString(input.startCursor) ||
    normalizeString(input.start_cursor) ||
    normalizeString(input.cursor) ||
    normalizeString(input.from) ||
    ""
  );
}

function getAllowedSearchObject(input: Record<string, unknown>) {
  const objectType = normalizeString(input.object);
  if (["page", "data_source"].includes(objectType)) {
    return objectType;
  }
  return "";
}

function notionListResponse(
  action: string,
  collectionKey: string,
  records: unknown[],
  limit: number,
  payload: Record<string, unknown>,
  extra?: Record<string, unknown>,
) {
  const nextCursor =
    typeof payload.next_cursor === "string" && payload.next_cursor.trim().length > 0
      ? payload.next_cursor
      : null;
  return {
    status: 200,
    body: {
      provider: "notion",
      action,
      [collectionKey]: records,
      count: records.length,
      returnedCount: records.length,
      limit,
      hasMore: payload.has_more === true,
      nextCursor,
      ...(extra ?? {}),
    },
  };
}

function pickId(input: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = normalizeString(input[key]);
    if (value) return value;
  }
  return "";
}

export async function validateNotionConnection(credentials: Record<string, unknown>) {
  const normalized = getNotionCredentials(credentials);
  if (!normalized) {
    throw new Error("Notion credentials are incomplete");
  }

  const me = await notionRequest<Record<string, unknown>>(
    normalized,
    "/v1/users/me",
  );

  const botId = typeof me.id === "string" ? me.id : null;
  if (!botId) {
    throw new Error("Notion validation succeeded but integration identity was missing");
  }

  const botOwner =
    isRecord(me.bot) && isRecord(me.bot.owner) ? me.bot.owner : null;
  const workspaceName =
    botOwner && typeof botOwner.workspace_name === "string"
      ? botOwner.workspace_name
      : null;

  return {
    externalAccountId: botId,
    metadata: {
      authMode: "integration_token",
      baseUrl: normalized.baseUrl,
      botId,
      botName: typeof me.name === "string" ? me.name : null,
      workspaceName,
      workspaceId:
        botOwner && typeof botOwner.workspace_id === "string"
          ? botOwner.workspace_id
          : null,
    },
  };
}

async function searchNotionContent(
  credentials: NotionCredentials,
  input: Record<string, unknown>,
  action: "search_content" | "list_pages" | "list_data_sources",
) {
  const limit = getLimit(input);
  const startCursor = getCursor(input);
  const query = normalizeString(input.query);
  const objectFilter =
    action === "list_pages"
      ? "page"
      : action === "list_data_sources"
        ? "data_source"
        : getAllowedSearchObject(input);

  const payload = await notionRequest<Record<string, unknown>>(
    credentials,
    "/v1/search",
    {
      method: "POST",
      body: {
        ...(query ? { query } : {}),
        ...(objectFilter
          ? { filter: { property: "object", value: objectFilter } }
          : {}),
        page_size: limit,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      },
    },
  );

  const results = Array.isArray(payload.results) ? payload.results : [];
  const collectionKey =
    action === "list_pages"
      ? "pages"
      : action === "list_data_sources"
        ? "dataSources"
        : "results";

  return notionListResponse(action, collectionKey, results, limit, payload, {
    objectFilter: objectFilter || null,
  });
}

async function getPage(
  credentials: NotionCredentials,
  input: Record<string, unknown>,
) {
  const pageId = pickId(input, ["pageId", "page_id", "id"]);
  if (!pageId) {
    return {
      status: 400,
      body: { error: "pageId is required for get_page" },
    };
  }

  const page = await notionRequest<Record<string, unknown>>(
    credentials,
    `/v1/pages/${encodeURIComponent(pageId)}`,
  );

  return {
    status: 200,
    body: {
      provider: "notion",
      action: "get_page",
      pageId,
      normalizedPageId: normalizeIdentifier(pageId),
      page,
    },
  };
}

async function getDataSource(
  credentials: NotionCredentials,
  input: Record<string, unknown>,
) {
  const dataSourceId = pickId(input, ["dataSourceId", "data_source_id", "id"]);
  if (!dataSourceId) {
    return {
      status: 400,
      body: { error: "dataSourceId is required for get_data_source" },
    };
  }

  const dataSource = await notionRequest<Record<string, unknown>>(
    credentials,
    `/v1/data_sources/${encodeURIComponent(dataSourceId)}`,
  );

  return {
    status: 200,
    body: {
      provider: "notion",
      action: "get_data_source",
      dataSourceId,
      normalizedDataSourceId: normalizeIdentifier(dataSourceId),
      dataSource,
    },
  };
}

async function queryDataSource(
  credentials: NotionCredentials,
  input: Record<string, unknown>,
) {
  const dataSourceId = pickId(input, ["dataSourceId", "data_source_id", "id"]);
  if (!dataSourceId) {
    return {
      status: 400,
      body: { error: "dataSourceId is required for query_data_source" },
    };
  }

  const limit = getLimit(input);
  const startCursor = getCursor(input);
  const filter = isRecord(input.filter) ? input.filter : undefined;
  const sorts = Array.isArray(input.sorts) ? input.sorts : undefined;

  const payload = await notionRequest<Record<string, unknown>>(
    credentials,
    `/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`,
    {
      method: "POST",
      body: {
        page_size: limit,
        ...(startCursor ? { start_cursor: startCursor } : {}),
        ...(filter ? { filter } : {}),
        ...(sorts ? { sorts } : {}),
      },
    },
  );

  const results = Array.isArray(payload.results) ? payload.results : [];
  return notionListResponse("query_data_source", "results", results, limit, payload, {
    dataSourceId,
    normalizedDataSourceId: normalizeIdentifier(dataSourceId),
  });
}

export async function executeNotionAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getNotionCredentials(connection.credentials);
  if (!credentials) {
    return {
      status: 400,
      body: { error: "Notion credentials are incomplete" },
    };
  }

  const payload = isRecord(input) ? input : {};

  if (action === "search_content") {
    return searchNotionContent(credentials, payload, "search_content");
  }

  if (action === "list_pages") {
    return searchNotionContent(credentials, payload, "list_pages");
  }

  if (action === "list_data_sources") {
    return searchNotionContent(credentials, payload, "list_data_sources");
  }

  if (action === "get_page") {
    return getPage(credentials, payload);
  }

  if (action === "get_data_source") {
    return getDataSource(credentials, payload);
  }

  if (action === "query_data_source") {
    return queryDataSource(credentials, payload);
  }

  return {
    status: 400,
    body: {
      error: `Unsupported Notion action: ${action}`,
      provider: "notion",
      supportedActions: [
        "search_content",
        "list_pages",
        "get_page",
        "list_data_sources",
        "get_data_source",
        "query_data_source",
      ],
    },
  };
}
