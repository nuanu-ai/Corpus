import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_GA4_ADMIN_BASE_URL = "https://analyticsadmin.googleapis.com/v1beta";
const DEFAULT_GA4_DATA_BASE_URL = "https://analyticsdata.googleapis.com/v1beta";
const GA4_TIMEOUT_MS = 15_000;
const DEFAULT_GA4_LIMIT = 25;
const MAX_GA4_LIMIT = 100;

export type Ga4Credentials = {
  token: string;
  adminBaseUrl: string;
  dataBaseUrl: string;
  propertyId?: string;
  accountId?: string;
};

type Ga4ApiResponse<T> = {
  nextPageToken?: string | null;
  properties?: T[];
  accountSummaries?: Array<Record<string, unknown>>;
  dimensions?: Array<Record<string, unknown>>;
  metrics?: Array<Record<string, unknown>>;
  dimensionHeaders?: Array<Record<string, unknown>>;
  metricHeaders?: Array<Record<string, unknown>>;
  rows?: Array<Record<string, unknown>>;
  rowCount?: number;
};

type Ga4PropertySummary = {
  propertyId: string;
  accountId: string | null;
  displayName: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  industryCategory: string | null;
  createTime: string | null;
  updateTime: string | null;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getDigits(value: string) {
  return value.replace(/\D+/g, "");
}

export function normalizeGa4BaseUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_GA4_ADMIN_BASE_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("GA4 base URL must use http or https");
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function normalizeDataBaseUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_GA4_DATA_BASE_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("GA4 data base URL must use http or https");
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_GA4_LIMIT) {
  const value =
    typeof input.limit === "number" && Number.isInteger(input.limit)
      ? input.limit
      : typeof input.pageSize === "number" && Number.isInteger(input.pageSize)
        ? input.pageSize
        : null;
  if (value === null) {
    return fallback;
  }
  return Math.min(Math.max(value, 1), MAX_GA4_LIMIT);
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
    const resolved = normalizeString(input[key]);
    if (resolved) {
      return resolved;
    }
  }
  return "";
}

function ga4Headers(token: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function buildGa4ErrorMessage(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "GA4 authentication failed. Reconnect Google Analytics with a valid OAuth access token.";
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

  return `GA4 request failed (${status})`;
}

async function ga4Request<T>(
  credentials: Ga4Credentials,
  baseUrl: string,
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  },
): Promise<Ga4ApiResponse<T>> {
  const url = new URL(path.startsWith("/") ? `${baseUrl}${path}` : `${baseUrl}/${path}`);
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchWithTimeoutAndRetry(
    url,
    {
      method: options?.method ?? "GET",
      headers: ga4Headers(credentials.token),
      body:
        options?.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    },
    {
      timeoutMs: GA4_TIMEOUT_MS,
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
    throw new Error(buildGa4ErrorMessage(response.status, payload));
  }

  return payload as Ga4ApiResponse<T>;
}

function parsePropertyName(value: unknown) {
  const raw = normalizeString(value);
  if (!raw) return "";
  const match = raw.match(/properties\/(.+)$/i);
  return match ? match[1] : raw;
}

function parseAccountName(value: unknown) {
  const raw = normalizeString(value);
  if (!raw) return "";
  const match = raw.match(/accounts\/(.+)$/i);
  return match ? match[1] : raw;
}

function buildPropertySummary(property: Record<string, unknown>): Ga4PropertySummary {
  return {
    propertyId:
      parsePropertyName(property.name) ||
      parsePropertyName(property.property) ||
      normalizeString(property.propertyId),
    accountId:
      parseAccountName(property.parent) ||
      parseAccountName(property.account) ||
      parseAccountName(property.accountName) ||
      null,
    displayName:
      typeof property.displayName === "string" ? property.displayName : null,
    currencyCode:
      typeof property.currencyCode === "string" ? property.currencyCode : null,
    timeZone:
      typeof property.timeZone === "string" ? property.timeZone : null,
    industryCategory:
      typeof property.industryCategory === "string" ? property.industryCategory : null,
    createTime:
      typeof property.createTime === "string" ? property.createTime : null,
    updateTime:
      typeof property.updateTime === "string" ? property.updateTime : null,
  };
}

function buildDimensionMetricEntry(item: Record<string, unknown>) {
  return {
    apiName: typeof item.apiName === "string" ? item.apiName : null,
    uiName: typeof item.uiName === "string" ? item.uiName : null,
    description: typeof item.description === "string" ? item.description : null,
    deprecatedApiNames: Array.isArray(item.deprecatedApiNames)
      ? item.deprecatedApiNames.filter((value): value is string => typeof value === "string")
      : [],
    customDefinition: item.customDefinition === true,
  };
}

function buildReportRows(
  dimensionHeaders: Array<Record<string, unknown>>,
  metricHeaders: Array<Record<string, unknown>>,
  rows: Array<Record<string, unknown>>,
) {
  return rows.map((row) => {
    const dimensionValues = Array.isArray(row.dimensionValues) ? row.dimensionValues : [];
    const metricValues = Array.isArray(row.metricValues) ? row.metricValues : [];

    const dimensions: Record<string, string | null> = {};
    dimensionHeaders.forEach((header, index) => {
      const key = typeof header.name === "string" ? header.name : `dimension_${index + 1}`;
      const value = dimensionValues[index];
      dimensions[key] =
        isRecord(value) && typeof value.value === "string"
          ? value.value
          : typeof value === "string"
            ? value
            : null;
    });

    const metrics: Record<string, number | string | null> = {};
    metricHeaders.forEach((header, index) => {
      const key = typeof header.name === "string" ? header.name : `metric_${index + 1}`;
      const value = metricValues[index];
      const resolved =
        isRecord(value) && typeof value.value === "string"
          ? value.value
          : typeof value === "string"
            ? value
            : null;
      if (typeof resolved === "string" && resolved.trim().length > 0) {
        const numeric = Number(resolved);
        metrics[key] = Number.isFinite(numeric) ? numeric : resolved;
      } else {
        metrics[key] = resolved;
      }
    });

    return {
      dimensions,
      metrics,
    };
  });
}

function getPropertyIdFromInput(input: Record<string, unknown>) {
  const value = pickString(input, [
    "propertyId",
    "property_id",
    "defaultPropertyId",
    "id",
  ]);
  return value ? value.replace(/^properties\//i, "") : "";
}

function getAccountIdFromInput(input: Record<string, unknown>) {
  const value = pickString(input, ["accountId", "account_id", "defaultAccountId"]);
  return value ? value.replace(/^accounts\//i, "") : "";
}

export function getGa4Credentials(
  credentials: Record<string, unknown>,
): Ga4Credentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.accessToken) ||
    normalizeString(credentials.access_token) ||
    normalizeString(credentials.apiKey);
  if (!token) {
    return null;
  }

  const adminBaseUrl = normalizeGa4BaseUrl(
    normalizeString(credentials.adminBaseUrl) ||
      normalizeString(credentials.baseUrl) ||
      DEFAULT_GA4_ADMIN_BASE_URL,
  );
  const dataBaseUrl = normalizeDataBaseUrl(
    normalizeString(credentials.dataBaseUrl) ||
      normalizeString(credentials.reportBaseUrl) ||
      DEFAULT_GA4_DATA_BASE_URL,
  );

  const propertyId = getPropertyIdFromInput(credentials);
  const accountId = getAccountIdFromInput(credentials);

  return {
    token,
    adminBaseUrl,
    dataBaseUrl,
    ...(propertyId ? { propertyId } : {}),
    ...(accountId ? { accountId } : {}),
  };
}

async function listGa4Properties(
  credentials: Ga4Credentials,
  input: Record<string, unknown>,
) {
  const limit = getLimit(input);
  const offset = getOffset(input, limit);
  const accountId = getAccountIdFromInput(input) || credentials.accountId || "";
  const pageToken = normalizeString(input.pageToken) || normalizeString(input.nextPageToken);

  const payload = await ga4Request<Record<string, unknown>>(
    credentials,
    credentials.adminBaseUrl,
    "/properties",
    {
      query: {
        pageSize: limit,
        ...(pageToken ? { pageToken } : {}),
        ...(accountId ? { filter: `parent:accounts/${accountId}` } : {}),
      },
    },
  );

  const allProperties = Array.isArray(payload.properties)
    ? payload.properties.filter(isRecord).map(buildPropertySummary)
    : [];
  const properties = allProperties.slice(offset, offset + limit);
  const hasMore = offset + properties.length < allProperties.length || Boolean(payload.nextPageToken);

  return {
    status: 200,
    body: {
      provider: "ga4",
      action: "list_properties",
      properties,
      count: allProperties.length,
      returnedCount: properties.length,
      limit,
      offset,
      accountId: accountId || null,
      hasMore,
      nextPageToken: payload.nextPageToken ?? null,
    },
  };
}

async function getGa4Property(
  credentials: Ga4Credentials,
  input: Record<string, unknown>,
) {
  const propertyId = getPropertyIdFromInput(input) || credentials.propertyId || "";
  if (!propertyId) {
    throw new Error("propertyId is required");
  }

  const payload = await ga4Request<Record<string, unknown>>(
    credentials,
    credentials.adminBaseUrl,
    `/properties/${encodeURIComponent(propertyId)}`,
    {
      method: "GET",
    },
  );

  return {
    status: 200,
    body: {
      provider: "ga4",
      action: "get_property",
      propertyId,
      property: buildPropertySummary(payload),
    },
  };
}

async function listGa4DimensionsMetrics(
  credentials: Ga4Credentials,
  input: Record<string, unknown>,
) {
  const propertyId = getPropertyIdFromInput(input) || credentials.propertyId || "";
  if (!propertyId) {
    throw new Error("propertyId is required");
  }

  const payload = await ga4Request<Record<string, unknown>>(
    credentials,
    credentials.dataBaseUrl,
    `/properties/${encodeURIComponent(propertyId)}/metadata`,
    {
      method: "GET",
    },
  );

  const dimensions = Array.isArray(payload.dimensions)
    ? payload.dimensions.filter(isRecord).map(buildDimensionMetricEntry)
    : [];
  const metrics = Array.isArray(payload.metrics)
    ? payload.metrics.filter(isRecord).map(buildDimensionMetricEntry)
    : [];

  return {
    status: 200,
    body: {
      provider: "ga4",
      action: "list_dimensions_metrics",
      propertyId,
      dimensions,
      metrics,
      count: dimensions.length + metrics.length,
    },
  };
}

async function runGa4Report(
  credentials: Ga4Credentials,
  input: Record<string, unknown>,
) {
  const propertyId = getPropertyIdFromInput(input) || credentials.propertyId || "";
  if (!propertyId) {
    throw new Error("propertyId is required");
  }

  const dimensions = Array.isArray(input.dimensions)
    ? input.dimensions.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const metrics = Array.isArray(input.metrics)
    ? input.metrics.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (dimensions.length === 0) {
    throw new Error("At least one dimension is required");
  }
  if (metrics.length === 0) {
    throw new Error("At least one metric is required");
  }

  const startDate = normalizeString(input.startDate) || normalizeString(input.dateFrom);
  const endDate = normalizeString(input.endDate) || normalizeString(input.dateTo);
  if (!startDate || !endDate) {
    throw new Error("startDate and endDate are required");
  }

  const limit = getLimit(input);
  const offset = getOffset(input, limit);
  const payload = await ga4Request<Record<string, unknown>>(
    credentials,
    credentials.dataBaseUrl,
    `/properties/${encodeURIComponent(propertyId)}:runReport`,
    {
      method: "POST",
      body: {
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
        dateRanges: [{ startDate, endDate }],
        limit,
        offset,
      },
    },
  );

  const dimensionHeaders = Array.isArray(payload.dimensionHeaders)
    ? payload.dimensionHeaders.filter(isRecord)
    : [];
  const metricHeaders = Array.isArray(payload.metricHeaders)
    ? payload.metricHeaders.filter(isRecord)
    : [];
  const rows = Array.isArray(payload.rows) ? payload.rows.filter(isRecord) : [];
  const compactRows = buildReportRows(dimensionHeaders, metricHeaders, rows);

  return {
    status: 200,
    body: {
      provider: "ga4",
      action: "run_report",
      propertyId,
      dimensions,
      metrics,
      startDate,
      endDate,
      rowCount: typeof payload.rowCount === "number" ? payload.rowCount : compactRows.length,
      count: compactRows.length,
      returnedCount: compactRows.length,
      rows: compactRows,
      hasMore:
        typeof payload.rowCount === "number"
          ? offset + compactRows.length < payload.rowCount
          : compactRows.length === limit,
      nextOffset:
        typeof payload.rowCount === "number" && offset + compactRows.length < payload.rowCount
          ? offset + compactRows.length
          : null,
      dimensionHeaders: dimensionHeaders.map((header) => ({
        name: typeof header.name === "string" ? header.name : null,
      })),
      metricHeaders: metricHeaders.map((header) => ({
        name: typeof header.name === "string" ? header.name : null,
      })),
    },
  };
}

export async function validateGa4Connection(credentials: Record<string, unknown>) {
  const normalized = getGa4Credentials(credentials);
  if (!normalized) {
    throw new Error("GA4 credentials are incomplete");
  }

  const requestedPropertyId = getPropertyIdFromInput(credentials) || normalized.propertyId || "";
  if (requestedPropertyId) {
    const property = await ga4Request<Record<string, unknown>>(
      normalized,
      normalized.adminBaseUrl,
      `/properties/${encodeURIComponent(requestedPropertyId)}`,
      {
        method: "GET",
      },
    );

    const summary = buildPropertySummary(property);
    return {
      externalAccountId: summary.propertyId,
      metadata: {
        authMode: "oauth_access_token",
        adminBaseUrl: normalized.adminBaseUrl,
        dataBaseUrl: normalized.dataBaseUrl,
        accessiblePropertyCount: 1,
        defaultPropertyId: summary.propertyId,
        defaultPropertyDisplayName: summary.displayName,
        defaultPropertyCurrencyCode: summary.currencyCode,
        defaultPropertyTimeZone: summary.timeZone,
      },
    };
  }

  const propertiesResponse = await ga4Request<Record<string, unknown>>(
    normalized,
    normalized.adminBaseUrl,
    "/properties",
    {
      query: {
        pageSize: 25,
      },
    },
  );

  const properties = Array.isArray(propertiesResponse.properties)
    ? propertiesResponse.properties.filter(isRecord).map(buildPropertySummary)
    : [];

  if (properties.length === 0) {
    throw new Error("GA4 returned no accessible properties");
  }

  const defaultProperty = properties[0];
  return {
    externalAccountId: defaultProperty.propertyId,
    metadata: {
      authMode: "oauth_access_token",
      adminBaseUrl: normalized.adminBaseUrl,
      dataBaseUrl: normalized.dataBaseUrl,
      accessiblePropertyCount: properties.length,
      defaultPropertyId: defaultProperty.propertyId,
      defaultPropertyDisplayName: defaultProperty.displayName,
      defaultPropertyCurrencyCode: defaultProperty.currencyCode,
      defaultPropertyTimeZone: defaultProperty.timeZone,
    },
  };
}

export async function executeGa4Action(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getGa4Credentials(connection.credentials);
  if (!credentials) {
    throw new Error("GA4 credentials are incomplete");
  }

  const payload = isRecord(input) ? input : {};

  switch (action) {
    case "list_properties":
      return listGa4Properties(credentials, payload);
    case "get_property":
      return getGa4Property(credentials, payload);
    case "run_report":
      return runGa4Report(credentials, payload);
    case "list_dimensions_metrics":
      return listGa4DimensionsMetrics(credentials, payload);
    default:
      throw new Error(`Unsupported GA4 action: ${action}`);
  }
}

export const normalize = normalizeGa4BaseUrl;
export const getCredentials = getGa4Credentials;
export const validate = validateGa4Connection;
export const execute = executeGa4Action;
