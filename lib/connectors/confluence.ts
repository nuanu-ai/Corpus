import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const CONFLUENCE_TIMEOUT_MS = 15_000;
const DEFAULT_CONFLUENCE_LIMIT = 25;
const CONFLUENCE_PAGE_BODY_FORMATS = new Set(["storage", "atlas_doc_format", "view"]);

export type ConfluenceCredentials = {
  siteUrl: string;
  email: string;
  apiToken: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeConfluenceSiteUrl(siteUrl: string) {
  const url = new URL(siteUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Confluence site URL must use http or https");
  }

  const path = url.pathname.replace(/\/+$/, "");
  const normalizedPath = path === "/wiki" ? "" : path;
  return `${url.origin}${normalizedPath}`.replace(/\/+$/, "");
}

function confluenceBaseUrl(siteUrl: string) {
  return `${normalizeConfluenceSiteUrl(siteUrl)}/wiki`;
}

function confluenceAuthHeader(email: string, apiToken: string) {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

function siteNameFromUrl(siteUrl: string) {
  return new URL(siteUrl).hostname;
}

export function getConfluenceCredentials(
  credentials: Record<string, unknown>,
): ConfluenceCredentials | null {
  const siteUrlRaw = normalizeString(credentials.siteUrl);
  const email = normalizeString(credentials.email);
  const apiToken =
    normalizeString(credentials.apiToken) || normalizeString(credentials.token);
  if (!siteUrlRaw || !email || !apiToken) {
    return null;
  }

  return {
    siteUrl: normalizeConfluenceSiteUrl(siteUrlRaw),
    email,
    apiToken,
  };
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_CONFLUENCE_LIMIT, max = 100) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), max);
}

function getCursor(input: Record<string, unknown>) {
  return typeof input.cursor === "string" && input.cursor.trim().length > 0
    ? input.cursor.trim()
    : null;
}

function getPageBodyFormat(input: Record<string, unknown>) {
  const bodyFormat = normalizeString(input.bodyFormat);
  return CONFLUENCE_PAGE_BODY_FORMATS.has(bodyFormat) ? bodyFormat : "storage";
}

function escapeCqlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function extractErrorMessage(payload: unknown, status: number) {
  if (status === 401) {
    return "Confluence API token authentication failed. Reconnect Confluence with a valid API token.";
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim().length > 0) {
      return record.message;
    }
    if (typeof record.reason === "string" && record.reason.trim().length > 0) {
      return record.reason;
    }
    if (Array.isArray(record.errors) && record.errors.length > 0) {
      const first = record.errors[0];
      if (typeof first === "string") {
        return first;
      }
      if (
        first &&
        typeof first === "object" &&
        typeof (first as Record<string, unknown>).message === "string"
      ) {
        return (first as Record<string, unknown>).message as string;
      }
    }
    if (
      record.data &&
      typeof record.data === "object" &&
      typeof (record.data as Record<string, unknown>).message === "string"
    ) {
      return (record.data as Record<string, unknown>).message as string;
    }
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }

  return `Confluence request failed (${status})`;
}

function extractNextLink(
  currentUrl: URL,
  response: Response,
  payload?: Record<string, unknown> | null,
) {
  const linkHeader = response.headers.get("link");
  if (linkHeader) {
    const match = linkHeader.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (match?.[1]) {
      return new URL(match[1], currentUrl).toString();
    }
  }

  const rawNext =
    payload?._links && typeof payload._links === "object"
      ? (payload._links as Record<string, unknown>).next
      : null;
  if (typeof rawNext === "string" && rawNext.length > 0) {
    return new URL(rawNext, currentUrl).toString();
  }

  return null;
}

async function confluenceRequest<T>(
  credentials: ConfluenceCredentials,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
) {
  const sanitizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${confluenceBaseUrl(credentials.siteUrl)}${sanitizedPath}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchWithTimeoutAndRetry(
    url,
    {
      headers: {
        Accept: "application/json",
        Authorization: confluenceAuthHeader(credentials.email, credentials.apiToken),
      },
      cache: "no-store",
    },
    {
      timeoutMs: CONFLUENCE_TIMEOUT_MS,
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
    throw new Error(extractErrorMessage(payload, response.status));
  }

  return {
    payload: payload as T,
    nextLink:
      payload && typeof payload === "object"
        ? extractNextLink(url, response, payload as Record<string, unknown>)
        : extractNextLink(url, response, null),
  };
}

export async function validateConfluenceConnection(credentials: Record<string, unknown>) {
  const normalized = getConfluenceCredentials(credentials);
  if (!normalized) {
    throw new Error("Confluence credentials are incomplete");
  }

  const result = await confluenceRequest<{
    results?: Array<Record<string, unknown>>;
  }>(normalized, "/api/v2/spaces", { limit: 1 });

  return {
    externalAccountId: normalized.siteUrl,
    metadata: {
      authMode: "api_token",
      siteUrl: normalized.siteUrl,
      siteName: siteNameFromUrl(normalized.siteUrl),
      currentUserEmail: normalized.email,
      accessibleSpaceCount: Array.isArray(result.payload.results)
        ? result.payload.results.length
        : 0,
    },
  };
}

function buildConfluenceSearchCql(payload: Record<string, unknown>) {
  const cql = normalizeString(payload.cql);
  if (cql) {
    throw new Error(
      "Raw Confluence CQL passthrough is not supported. Use query and optional spaceKey instead.",
    );
  }

  const query = normalizeString(payload.query);
  if (!query) {
    return "";
  }

  const clauses = [`type = page`, `title ~ "${escapeCqlString(query)}"`];
  const spaceKey = normalizeString(payload.spaceKey);
  if (spaceKey) {
    clauses.unshift(`space = "${escapeCqlString(spaceKey)}"`);
  }

  return clauses.join(" AND ");
}

export async function executeConfluenceAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getConfluenceCredentials(connection.credentials);
  if (!credentials) {
    return {
      status: 400,
      body: { error: "Confluence credentials are incomplete" },
    };
  }

  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  if (action === "list_spaces") {
    const limit = getLimit(payload);
    const cursor = getCursor(payload);
    const type = normalizeString(payload.type);
    const status = normalizeString(payload.status);
    const keys = Array.isArray(payload.keys)
      ? (payload.keys as unknown[])
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .map((value) => value.trim())
      : [];

    const result = await confluenceRequest<{
      results?: Array<Record<string, unknown>>;
    }>(credentials, "/api/v2/spaces", {
      limit,
      cursor: cursor ?? undefined,
      type: type || undefined,
      status: status || undefined,
      keys: keys.length > 0 ? keys.join(",") : undefined,
    });

    const spaces = Array.isArray(result.payload.results) ? result.payload.results : [];
    return {
      status: 200,
      body: {
        provider: "confluence",
        action,
        count: spaces.length,
        returnedCount: spaces.length,
        limit,
        cursor,
        hasMore: result.nextLink !== null,
        nextCursor: result.nextLink ? new URL(result.nextLink).searchParams.get("cursor") : null,
        nextLink: result.nextLink,
        spaces,
      },
    };
  }

  if (action === "list_pages") {
    const limit = getLimit(payload);
    const cursor = getCursor(payload);
    const bodyFormat = getPageBodyFormat(payload);
    const spaceId = normalizeString(payload.spaceId);
    const status = normalizeString(payload.status);
    const title = normalizeString(payload.title);
    const path = spaceId
      ? `/api/v2/spaces/${encodeURIComponent(spaceId)}/pages`
      : "/api/v2/pages";

    const result = await confluenceRequest<{
      results?: Array<Record<string, unknown>>;
    }>(credentials, path, {
      limit,
      cursor: cursor ?? undefined,
      status: status || undefined,
      title: title || undefined,
      "body-format": bodyFormat,
    });

    const pages = Array.isArray(result.payload.results) ? result.payload.results : [];
    return {
      status: 200,
      body: {
        provider: "confluence",
        action,
        count: pages.length,
        returnedCount: pages.length,
        limit,
        cursor,
        spaceId: spaceId || null,
        hasMore: result.nextLink !== null,
        nextCursor: result.nextLink ? new URL(result.nextLink).searchParams.get("cursor") : null,
        nextLink: result.nextLink,
        pages,
      },
    };
  }

  if (action === "get_page") {
    const pageId =
      typeof payload.pageId === "string" || typeof payload.pageId === "number"
        ? String(payload.pageId).trim()
        : "";
    if (!pageId) {
      return {
        status: 400,
        body: { error: "input.pageId is required" },
      };
    }

    const bodyFormat = getPageBodyFormat(payload);
    const result = await confluenceRequest<Record<string, unknown>>(
      credentials,
      `/api/v2/pages/${encodeURIComponent(pageId)}`,
      {
        "body-format": bodyFormat,
      },
    );

    return {
      status: 200,
      body: {
        provider: "confluence",
        action,
        pageId,
        page: result.payload,
      },
    };
  }

  if (action === "search_content") {
    let cql: string;
    try {
      cql = buildConfluenceSearchCql(payload);
    } catch (error) {
      return {
        status: 400,
        body: {
          error: error instanceof Error ? error.message : "Invalid Confluence query",
        },
      };
    }
    if (!cql) {
      return {
        status: 400,
        body: { error: "input.cql or input.query is required" },
      };
    }

    const limit = getLimit(payload);
    const cursor = getCursor(payload);
    const result = await confluenceRequest<{
      results?: Array<Record<string, unknown>>;
      _links?: Record<string, unknown>;
    }>(credentials, "/rest/api/search", {
      cql,
      limit,
      cursor: cursor ?? undefined,
    });

    const results = Array.isArray(result.payload.results) ? result.payload.results : [];
    return {
      status: 200,
      body: {
        provider: "confluence",
        action,
        cql,
        count: results.length,
        returnedCount: results.length,
        limit,
        cursor,
        hasMore: result.nextLink !== null,
        nextCursor: result.nextLink ? new URL(result.nextLink).searchParams.get("cursor") : null,
        nextLink: result.nextLink,
        results,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported confluence action: ${action}` },
  };
}
