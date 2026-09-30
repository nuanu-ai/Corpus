import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_GOOGLE_SEARCH_CONSOLE_BASE_URL =
  "https://searchconsole.googleapis.com/webmasters/v3";
const GOOGLE_SEARCH_CONSOLE_TIMEOUT_MS = 15_000;
const DEFAULT_GOOGLE_SEARCH_CONSOLE_LIMIT = 25;
const MAX_GOOGLE_SEARCH_CONSOLE_LIMIT = 100;

export type GoogleSearchConsoleCredentials = {
  token: string;
  baseUrl: string;
  defaultSiteUrl?: string;
};

type SiteSummary = {
  siteUrl: string;
  permissionLevel: string | null;
};

type SearchAnalyticsRowSummary = {
  keys: string[];
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
};

type SitemapSummary = {
  path: string | null;
  lastSubmitted: string | null;
  isPending: boolean | null;
  isSitemapsIndex: boolean | null;
  lastDownloaded: string | null;
  warnings: number | null;
  errors: number | null;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeGoogleSearchConsoleBaseUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_GOOGLE_SEARCH_CONSOLE_BASE_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Google Search Console base URL must use http or https");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname || pathname === "/") {
    return DEFAULT_GOOGLE_SEARCH_CONSOLE_BASE_URL;
  }

  return `${url.origin}${pathname}`;
}

function normalizeSiteUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("sc-domain:")) {
    return trimmed;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Google Search Console siteUrl must use http or https");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname || pathname === "/") {
    return `${url.origin}/`;
  }

  return `${url.origin}${pathname}/`;
}

function normalizeSiteUrlCandidate(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  try {
    return normalizeSiteUrl(value);
  } catch {
    return normalizeString(value);
  }
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_GOOGLE_SEARCH_CONSOLE_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_GOOGLE_SEARCH_CONSOLE_LIMIT);
}

function getOffset(input: Record<string, unknown>, limit: number) {
  if (typeof input.offset === "number" && Number.isInteger(input.offset)) {
    return Math.max(input.offset, 0);
  }
  if (typeof input.page === "number" && Number.isInteger(input.page)) {
    return Math.max((input.page - 1) * limit, 0);
  }
  return 0;
}

function pickString(input: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function resolveSiteUrlFromPayload(input: Record<string, unknown>) {
  const candidate = [
    input.siteUrl,
    input.propertyUrl,
    input.defaultSiteUrl,
    input.defaultPropertyUrl,
    input.url,
    input.site,
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  return normalizeSiteUrlCandidate(candidate);
}

function parseGoogleSearchConsoleCredentials(
  credentials: Record<string, unknown>,
): GoogleSearchConsoleCredentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.accessToken) ||
    normalizeString(credentials.access_token) ||
    normalizeString(credentials.apiKey);

  if (!token) {
    return null;
  }

  const defaultSiteUrl = resolveSiteUrlFromPayload(credentials);

  return {
    token,
    baseUrl: normalizeGoogleSearchConsoleBaseUrl(
      normalizeString(credentials.baseUrl) ||
        normalizeString(credentials.apiBaseUrl) ||
        normalizeString(credentials.searchConsoleBaseUrl) ||
        DEFAULT_GOOGLE_SEARCH_CONSOLE_BASE_URL,
    ),
    ...(defaultSiteUrl ? { defaultSiteUrl } : {}),
  };
}

function gscHeaders(token: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function getErrorMessage(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "Google Search Console authentication failed. Reconnect with a valid OAuth access token.";
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }

  if (isRecord(payload)) {
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message.trim();
    }
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return payload.error.trim();
    }
    if (isRecord(payload.error) && typeof payload.error.message === "string" && payload.error.message.trim().length > 0) {
      return payload.error.message.trim();
    }
  }

  return `Google Search Console request failed (${status})`;
}

async function gscRequest<T>(
  credentials: GoogleSearchConsoleCredentials,
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  },
): Promise<T> {
  const url = new URL(
    path.startsWith("/")
      ? `${credentials.baseUrl}${path}`
      : `${credentials.baseUrl}/${path}`,
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
      headers: gscHeaders(credentials.token),
      body:
        options?.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      cache: "no-store",
    },
    {
      timeoutMs: GOOGLE_SEARCH_CONSOLE_TIMEOUT_MS,
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
    throw new Error(getErrorMessage(response.status, payload));
  }

  return payload as T;
}

function extractSites(payload: unknown): SiteSummary[] {
  const entries =
    isRecord(payload) && Array.isArray(payload.siteEntry)
      ? payload.siteEntry
      : isRecord(payload) && Array.isArray(payload.siteEntries)
        ? payload.siteEntries
        : Array.isArray(payload)
          ? payload
          : [];

  return entries
    .filter(isRecord)
    .map((entry) => ({
      siteUrl:
        normalizeSiteUrlCandidate(entry.siteUrl) ||
        normalizeSiteUrlCandidate(entry.site_url) ||
        normalizeString(entry.siteUrl) ||
        normalizeString(entry.site_url),
      permissionLevel:
        typeof entry.permissionLevel === "string"
          ? entry.permissionLevel
          : typeof entry.permission_level === "string"
            ? entry.permission_level
            : null,
    }))
    .filter((entry) => Boolean(entry.siteUrl));
}

function extractSitemaps(payload: unknown): SitemapSummary[] {
  const entries =
    isRecord(payload) && Array.isArray(payload.sitemap)
      ? payload.sitemap
      : isRecord(payload) && Array.isArray(payload.sitemaps)
        ? payload.sitemaps
        : Array.isArray(payload)
          ? payload
          : [];

  return entries
    .filter(isRecord)
    .map((entry) => ({
      path:
        typeof entry.path === "string" ? entry.path : typeof entry.siteUrl === "string" ? entry.siteUrl : null,
      lastSubmitted:
        typeof entry.lastSubmitted === "string" ? entry.lastSubmitted : null,
      isPending:
        typeof entry.isPending === "boolean" ? entry.isPending : null,
      isSitemapsIndex:
        typeof entry.isSitemapsIndex === "boolean" ? entry.isSitemapsIndex : null,
      lastDownloaded:
        typeof entry.lastDownloaded === "string" ? entry.lastDownloaded : null,
      warnings:
        typeof entry.warnings === "number" ? entry.warnings : null,
      errors:
        typeof entry.errors === "number" ? entry.errors : null,
    }));
}

function extractRows(payload: unknown) {
  if (isRecord(payload) && Array.isArray(payload.rows)) {
    return payload.rows.filter(isRecord);
  }
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  return [];
}

function buildSiteResponse(site: SiteSummary) {
  return {
    siteUrl: site.siteUrl,
    permissionLevel: site.permissionLevel,
  };
}

function buildSearchAnalyticsRow(row: Record<string, unknown>): SearchAnalyticsRowSummary {
  return {
    keys: Array.isArray(row.keys)
      ? row.keys
          .map((value) => (typeof value === "string" ? value : String(value)))
          .filter((value) => value.length > 0)
      : [],
    clicks: parseNumber(row.clicks),
    impressions: parseNumber(row.impressions),
    ctr: parseNumber(row.ctr),
    position: parseNumber(row.position),
  };
}

function listResponse(
  action: string,
  collectionKey: string,
  items: Array<Record<string, unknown> | SiteSummary | SitemapSummary>,
  totalCount: number,
  limit: number,
  offset: number,
) {
  const returnedCount = items.length;
  const hasMore = offset + returnedCount < totalCount;
  return {
    status: 200,
    body: {
      provider: "google_search_console",
      action,
      [collectionKey]: items,
      count: totalCount,
      returnedCount,
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + returnedCount : null,
    },
  };
}

function sitePath(siteUrl: string) {
  return `/sites/${encodeURIComponent(siteUrl)}`;
}

function resolveSiteUrl(
  connection: { credentials: Record<string, unknown>; metadata: Record<string, unknown> | null },
  input: Record<string, unknown>,
) {
  return (
    resolveSiteUrlFromPayload(input) ||
    normalizeSiteUrlCandidate(connection.credentials.defaultSiteUrl) ||
    normalizeSiteUrlCandidate(connection.credentials.defaultPropertyUrl) ||
    normalizeSiteUrlCandidate(connection.metadata?.defaultSiteUrl) ||
    normalizeSiteUrlCandidate(connection.metadata?.defaultPropertyUrl) ||
    ""
  );
}

export function getGoogleSearchConsoleCredentials(
  credentials: Record<string, unknown>,
): GoogleSearchConsoleCredentials | null {
  return parseGoogleSearchConsoleCredentials(credentials);
}

export async function validateGoogleSearchConsoleConnection(
  credentials: Record<string, unknown>,
) {
  const normalized = getGoogleSearchConsoleCredentials(credentials);
  if (!normalized) {
    throw new Error("Google Search Console credentials are incomplete");
  }

  const sitesResponse = await gscRequest<unknown>(normalized, "/sites");
  const sites = extractSites(sitesResponse);
  if (sites.length === 0) {
    throw new Error("Google Search Console returned no accessible sites");
  }

  const requestedDefaultSiteUrl = resolveSiteUrlFromPayload(credentials);
  const defaultSite =
    (requestedDefaultSiteUrl
      ? sites.find((site) => site.siteUrl === requestedDefaultSiteUrl)
      : null) ||
    sites[0] ||
    null;

  if (requestedDefaultSiteUrl && !defaultSite) {
    throw new Error(
      `Google Search Console validation succeeded but site ${requestedDefaultSiteUrl} was not accessible`,
    );
  }

  return {
    externalAccountId: defaultSite?.siteUrl ?? null,
    metadata: {
      authMode: "access_token",
      baseUrl: normalized.baseUrl,
      accessibleSiteCount: sites.length,
      defaultSiteUrl: defaultSite?.siteUrl ?? null,
      defaultSitePermissionLevel: defaultSite?.permissionLevel ?? null,
      sites,
    },
  };
}

async function listSites(
  credentials: GoogleSearchConsoleCredentials,
  input: Record<string, unknown>,
) {
  const limit = getLimit(input);
  const offset = getOffset(input, limit);

  const payload = await gscRequest<unknown>(credentials, "/sites");
  const sites = extractSites(payload);
  const sliced = sites.slice(offset, offset + limit).map(buildSiteResponse);

  return listResponse("list_sites", "sites", sliced, sites.length, limit, offset);
}

async function getSite(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  input: Record<string, unknown>,
) {
  const credentials = getGoogleSearchConsoleCredentials(connection.credentials);
  if (!credentials) {
    throw new Error("Google Search Console credentials are incomplete");
  }

  const siteUrl = resolveSiteUrl(connection, input) ||
    normalizeSiteUrlCandidate(input.siteUrl) ||
    normalizeSiteUrlCandidate(input.propertyUrl) ||
    normalizeSiteUrlCandidate(input.defaultSiteUrl) ||
    normalizeSiteUrlCandidate(input.defaultPropertyUrl);

  if (!siteUrl) {
    throw new Error("siteUrl is required");
  }

  const payload = await gscRequest<Record<string, unknown>>(
    credentials,
    sitePath(siteUrl),
    { method: "GET" },
  );

  const resolvedSiteUrl =
    normalizeSiteUrlCandidate(payload.siteUrl) ||
    normalizeSiteUrlCandidate(payload.site_url) ||
    siteUrl;

  return {
    status: 200,
    body: {
      provider: "google_search_console",
      action: "get_site",
      siteUrl: resolvedSiteUrl,
      site: {
        siteUrl: resolvedSiteUrl,
        permissionLevel:
          typeof payload.permissionLevel === "string"
            ? payload.permissionLevel
            : typeof payload.permission_level === "string"
              ? payload.permission_level
              : null,
      },
    },
  };
}

async function querySearchAnalytics(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  input: Record<string, unknown>,
) {
  const credentials = getGoogleSearchConsoleCredentials(connection.credentials);
  if (!credentials) {
    throw new Error("Google Search Console credentials are incomplete");
  }

  const siteUrl = resolveSiteUrl(connection, input);
  if (!siteUrl) {
    throw new Error("siteUrl is required for search analytics reads");
  }

  const startDate =
    normalizeString(input.startDate) || normalizeString(input.start_date);
  const endDate =
    normalizeString(input.endDate) || normalizeString(input.end_date);
  if (!startDate || !endDate) {
    throw new Error("startDate and endDate are required");
  }

  const rowLimit = getLimit(input);
  const startRow =
    typeof input.startRow === "number" && Number.isInteger(input.startRow)
      ? Math.max(input.startRow, 0)
      : typeof input.offset === "number" && Number.isInteger(input.offset)
        ? Math.max(input.offset, 0)
        : 0;
  const dimensions = Array.isArray(input.dimensions)
    ? input.dimensions
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0)
    : [];
  const searchType = normalizeString(input.searchType) || normalizeString(input.search_type);
  const aggregationType = normalizeString(input.aggregationType) || normalizeString(input.aggregation_type);

  const payload = await gscRequest<Record<string, unknown>>(
    credentials,
    `${sitePath(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      body: {
        startDate,
        endDate,
        rowLimit,
        startRow,
        ...(dimensions.length > 0 ? { dimensions } : {}),
        ...(searchType ? { searchType } : {}),
        ...(aggregationType ? { aggregationType } : {}),
        ...(Array.isArray(input.dimensionFilterGroups)
          ? { dimensionFilterGroups: input.dimensionFilterGroups }
          : {}),
      },
    },
  );

  const rows = extractRows(payload).map(buildSearchAnalyticsRow);
  const hasMore = rows.length === rowLimit;

  return {
    status: 200,
    body: {
      provider: "google_search_console",
      action: "query_search_analytics",
      siteUrl,
      startDate,
      endDate,
      dimensions,
      rowLimit,
      startRow,
      rows,
      count: rows.length,
      returnedCount: rows.length,
      hasMore,
      nextStartRow: hasMore ? startRow + rows.length : null,
    },
  };
}

async function listSitemaps(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  input: Record<string, unknown>,
) {
  const credentials = getGoogleSearchConsoleCredentials(connection.credentials);
  if (!credentials) {
    throw new Error("Google Search Console credentials are incomplete");
  }

  const siteUrl = resolveSiteUrl(connection, input);
  if (!siteUrl) {
    throw new Error("siteUrl is required for sitemap reads");
  }

  const limit = getLimit(input);
  const offset = getOffset(input, limit);

  const payload = await gscRequest<Record<string, unknown>>(
    credentials,
    `${sitePath(siteUrl)}/sitemaps`,
    { method: "GET" },
  );

  const sitemaps = extractSitemaps(payload);
  const sliced = sitemaps.slice(offset, offset + limit);

  return listResponse("list_sitemaps", "sitemaps", sliced as SitemapSummary[], sitemaps.length, limit, offset);
}

export async function executeGoogleSearchConsoleAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getGoogleSearchConsoleCredentials(connection.credentials);
  if (!credentials) {
    throw new Error("Google Search Console credentials are incomplete");
  }

  const params = isRecord(input) ? input : {};

  switch (action) {
    case "list_sites":
      return listSites(credentials, params);
    case "get_site":
      return getSite(connection, params);
    case "query_search_analytics":
      return querySearchAnalytics(connection, params);
    case "list_sitemaps":
      return listSitemaps(connection, params);
    default:
      throw new Error(`Unsupported Google Search Console action: ${action}`);
  }
}

export const normalize = normalizeGoogleSearchConsoleBaseUrl;
export const getCredentials = getGoogleSearchConsoleCredentials;
export const validate = validateGoogleSearchConsoleConnection;
export const execute = executeGoogleSearchConsoleAction;
