import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_GOOGLE_ADS_BASE_URL = "https://googleads.googleapis.com/v15";
const GOOGLE_ADS_TIMEOUT_MS = 15_000;
const DEFAULT_GOOGLE_ADS_LIMIT = 25;
const MAX_GOOGLE_ADS_LIMIT = 100;

export type GoogleAdsCredentials = {
  token: string;
  developerToken: string;
  baseUrl: string;
  loginCustomerId?: string;
  defaultCustomerId?: string;
};

type GoogleAdsCustomerSummary = {
  customerId: string;
  resourceName: string;
  descriptiveName: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  manager: boolean | null;
};

type GoogleAdsRow = Record<string, unknown>;

type GoogleAdsStreamChunk = {
  results?: GoogleAdsRow[] | null;
};

type GoogleAdsListResult = {
  count: number;
  returnedCount: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  pageTraversalMode: "exhaustive";
  fetchedPages: number;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toDigits(value: string) {
  return value.replace(/\D+/g, "");
}

function getPathValue(input: unknown, path: string) {
  if (!isRecord(input)) {
    return undefined;
  }

  const segments = path.split(".");
  let current: unknown = input;
  for (const segment of segments) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
    if (current === undefined || current === null) {
      return current;
    }
  }

  return current;
}

export function normalizeGoogleAdsBaseUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_GOOGLE_ADS_BASE_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Google Ads base URL must use http or https");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname || pathname === "/") {
    return DEFAULT_GOOGLE_ADS_BASE_URL;
  }

  if (/\/v\d+$/i.test(pathname)) {
    return `${url.origin}${pathname}`;
  }

  return `${url.origin}${pathname}`;
}

export function normalizeGoogleAdsCustomerId(value: string) {
  const digits = toDigits(value);
  return digits.length > 0 ? digits : "";
}

function pickString(input: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const resolved =
      typeof input[key] === "string"
        ? normalizeString(input[key])
        : normalizeString(getPathValue(input, key));
    if (resolved) {
      return resolved;
    }
  }
  return "";
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_GOOGLE_ADS_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_GOOGLE_ADS_LIMIT);
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

function normalizeCustomerIdFromResourceName(resourceName: string) {
  return normalizeGoogleAdsCustomerId(resourceName);
}

function googleAdsHeaders(credentials: GoogleAdsCredentials, loginCustomerId?: string) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${credentials.token}`,
    "developer-token": credentials.developerToken,
  };

  const normalizedLoginCustomerId =
    normalizeGoogleAdsCustomerId(loginCustomerId ?? credentials.loginCustomerId ?? "");
  if (normalizedLoginCustomerId) {
    headers["login-customer-id"] = normalizedLoginCustomerId;
  }

  return headers;
}

function getGoogleAdsErrorMessage(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "Google Ads authentication failed. Reconnect Google Ads with a valid OAuth access token and developer token.";
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }

  if (isRecord(payload)) {
    const error = payload.error;
    if (isRecord(error)) {
      if (typeof error.message === "string" && error.message.trim().length > 0) {
        return error.message.trim();
      }
      if (Array.isArray(error.details) && error.details.length > 0) {
        const first = error.details[0];
        if (isRecord(first) && typeof first.message === "string" && first.message.trim().length > 0) {
          return first.message.trim();
        }
      }
    }

    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message.trim();
    }
  }

  return `Google Ads request failed (${status})`;
}

async function googleAdsRequest<T>(
  credentials: GoogleAdsCredentials,
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: unknown;
    loginCustomerId?: string;
  },
): Promise<T> {
  const url = new URL(
    path.startsWith("/")
      ? `${credentials.baseUrl}${path}`
      : `${credentials.baseUrl}/${path}`,
  );

  const response = await fetchWithTimeoutAndRetry(
    url,
    {
      method: options?.method ?? "GET",
      headers: googleAdsHeaders(credentials, options?.loginCustomerId),
      cache: "no-store",
      body:
        options?.body === undefined
          ? undefined
          : JSON.stringify(options.body),
    },
    {
      timeoutMs: GOOGLE_ADS_TIMEOUT_MS,
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
    throw new Error(getGoogleAdsErrorMessage(response.status, payload));
  }

  return payload as T;
}

function parseStreamChunks(payload: unknown): GoogleAdsRow[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((chunk) => parseStreamChunks(chunk));
  }

  if (!isRecord(payload)) {
    return [];
  }

  if (Array.isArray(payload.results)) {
    return payload.results.filter(isRecord);
  }

  if (Array.isArray(payload.data)) {
    return payload.data.filter(isRecord);
  }

  if (Array.isArray(payload.rows)) {
    return payload.rows.filter(isRecord);
  }

  return [];
}

function extractAccessibleCustomers(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .map((resourceName) => ({
        resourceName,
        customerId: normalizeCustomerIdFromResourceName(resourceName),
      }));
  }

  if (!isRecord(payload)) {
    return [];
  }

  const resourceNames = Array.isArray(payload.resourceNames)
    ? payload.resourceNames
    : Array.isArray(payload.resource_names)
      ? payload.resource_names
      : [];

  return resourceNames
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .map((resourceName) => ({
      resourceName,
      customerId: normalizeCustomerIdFromResourceName(resourceName),
    }));
}

function normalizeCustomerSummary(row: GoogleAdsRow): GoogleAdsCustomerSummary {
  const customerId = pickString(row, ["customer.id", "customerId", "customer_id", "id"]);
  const resourceName = pickString(row, ["customer.resourceName", "customer.resource_name", "resourceName", "resource_name"]);
  const descriptiveName =
    pickString(row, ["customer.descriptiveName", "customer.descriptive_name", "descriptiveName", "name"]) || null;
  const currencyCode =
    pickString(row, ["customer.currencyCode", "customer.currency_code", "currencyCode"]) || null;
  const timeZone =
    pickString(row, ["customer.timeZone", "customer.time_zone", "timeZone"]) || null;

  return {
    customerId: customerId || normalizeCustomerIdFromResourceName(resourceName || ""),
    resourceName: resourceName || (customerId ? `customers/${customerId}` : ""),
    descriptiveName,
    currencyCode,
    timeZone,
    manager:
      typeof getPathValue(row, "customer.manager") === "boolean"
        ? (getPathValue(row, "customer.manager") as boolean)
        : typeof getPathValue(row, "customer.manager") === "string"
          ? String(getPathValue(row, "customer.manager")) === "true"
          : null,
  };
}

function normalizeCampaignRow(row: GoogleAdsRow, customerCurrency?: string | null) {
  const campaignId = pickString(row, ["campaign.id", "campaignId", "campaign_id", "id"]);
  const campaignName =
    pickString(row, ["campaign.name", "campaignName", "campaign_name", "name"]) ||
    (campaignId ? `Campaign ${campaignId}` : "Campaign");
  return {
    campaignId,
    campaignName,
    status:
      pickString(row, ["campaign.status", "status"]) || null,
    advertisingChannelType:
      pickString(row, ["campaign.advertisingChannelType", "campaign.advertising_channel_type", "advertisingChannelType"]) || null,
    primaryStatus:
      pickString(row, ["campaign.primaryStatus", "campaign.primary_status", "primaryStatus"]) || null,
    startDate:
      pickString(row, ["campaign.startDate", "campaign.start_date", "startDate"]) || null,
    endDate:
      pickString(row, ["campaign.endDate", "campaign.end_date", "endDate"]) || null,
    currencyCode: customerCurrency ?? null,
  };
}

function normalizeCampaignMetricRow(row: GoogleAdsRow, customerCurrency?: string | null) {
  const campaignId = pickString(row, ["campaign.id", "campaignId", "campaign_id", "id"]);
  const campaignName =
    pickString(row, ["campaign.name", "campaignName", "campaign_name", "name"]) ||
    (campaignId ? `Campaign ${campaignId}` : "Campaign");
  const date =
    pickString(row, ["segments.date", "date", "segmentsDate"]) || null;
  const costMicros =
    pickString(row, ["metrics.costMicros", "metrics.cost_micros", "costMicros"]) || "0";

  return {
    campaignId,
    campaignName,
    date,
    status:
      pickString(row, ["campaign.status", "status"]) || null,
    advertisingChannelType:
      pickString(row, ["campaign.advertisingChannelType", "campaign.advertising_channel_type", "advertisingChannelType"]) || null,
    currencyCode: customerCurrency ?? null,
    spend: Number(costMicros) / 1_000_000,
    impressions: Number(pickString(row, ["metrics.impressions", "impressions"]) || 0),
    clicks: Number(pickString(row, ["metrics.clicks", "clicks"]) || 0),
    conversions: Number(
      pickString(row, ["metrics.conversions", "conversions", "metrics.allConversions"]) || 0,
    ),
  };
}

function buildListResponse(
  action: string,
  collectionKey: string,
  items: Array<Record<string, unknown>>,
  totalCount: number,
  limit: number,
  offset: number,
  extra?: Record<string, unknown>,
) {
  const returnedCount = items.length;
  const hasMore = offset + returnedCount < totalCount;
  return {
    status: 200,
    body: {
      provider: "google_ads",
      action,
      [collectionKey]: items,
      count: totalCount,
      returnedCount,
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + returnedCount : null,
      pageTraversalMode: "exhaustive" as const,
      fetchedPages: 1,
      ...(extra ?? {}),
    },
  };
}

function resolveCustomerId(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  input: Record<string, unknown>,
) {
  const credentials = getGoogleAdsCredentials(connection.credentials);
  if (!credentials) {
    return null;
  }

  const metadata = connection.metadata ?? {};
  const customerId =
    normalizeGoogleAdsCustomerId(
      pickString(input, ["customerId", "customer_id", "accountId", "account_id"]),
    ) ||
    credentials.defaultCustomerId ||
    normalizeGoogleAdsCustomerId(
      pickString(metadata, ["defaultCustomerId", "customerId", "accountId"]),
    );

  if (!customerId) {
    return null;
  }

  return {
    credentials,
    customerId,
    loginCustomerId:
      normalizeGoogleAdsCustomerId(
        pickString(input, ["loginCustomerId", "login_customer_id"]),
      ) ||
      credentials.loginCustomerId ||
      normalizeGoogleAdsCustomerId(pickString(metadata, ["loginCustomerId"])),
  };
}

async function fetchAccessibleCustomers(credentials: GoogleAdsCredentials) {
  const payload = await googleAdsRequest<unknown>(
    credentials,
    "/customers:listAccessibleCustomers",
    {
      method: "GET",
    },
  );
  return extractAccessibleCustomers(payload);
}

async function fetchCustomerSummary(
  credentials: GoogleAdsCredentials,
  customerId: string,
  loginCustomerId?: string,
) {
  const payload = await googleAdsRequest<unknown>(
    credentials,
    `/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      loginCustomerId,
      body: {
        query: `
          SELECT
            customer.id,
            customer.resource_name,
            customer.descriptive_name,
            customer.currency_code,
            customer.time_zone,
            customer.manager
          FROM customer
          LIMIT 1
        `,
      },
    },
  );

  const rows = parseStreamChunks(payload);
  return rows[0] ? normalizeCustomerSummary(rows[0]) : null;
}

async function fetchCampaignRows(
  credentials: GoogleAdsCredentials,
  customerId: string,
  loginCustomerId: string | undefined,
  query: string,
) {
  const payload = await googleAdsRequest<unknown>(
    credentials,
    `/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      loginCustomerId,
      body: { query },
    },
  );
  return parseStreamChunks(payload);
}

function compactGoogleAdsCampaignList(rows: GoogleAdsRow[], customerCurrency?: string | null) {
  return rows.map((row) => normalizeCampaignRow(row, customerCurrency));
}

function compactGoogleAdsMetricList(rows: GoogleAdsRow[], customerCurrency?: string | null) {
  return rows.map((row) => normalizeCampaignMetricRow(row, customerCurrency));
}

export function getGoogleAdsCredentials(
  credentials: Record<string, unknown>,
): GoogleAdsCredentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.access_token) ||
    normalizeString(credentials.accessToken) ||
    normalizeString(credentials.apiKey);

  const developerToken =
    normalizeString(credentials.developerToken) ||
    normalizeString(credentials.developer_token) ||
    normalizeString(process.env.GOOGLE_ADS_DEVELOPER_TOKEN);

  if (!token || !developerToken) {
    return null;
  }

  const baseUrl = normalizeGoogleAdsBaseUrl(
    normalizeString(credentials.baseUrl) ||
      normalizeString(credentials.apiBaseUrl) ||
      normalizeString(credentials.googleAdsBaseUrl) ||
      DEFAULT_GOOGLE_ADS_BASE_URL,
  );

  const loginCustomerId = normalizeGoogleAdsCustomerId(
    pickString(credentials, ["loginCustomerId", "login_customer_id"]),
  );
  const defaultCustomerId = normalizeGoogleAdsCustomerId(
    pickString(credentials, ["defaultCustomerId", "customerId", "customer_id"]),
  );

  return {
    token,
    developerToken,
    baseUrl,
    ...(loginCustomerId ? { loginCustomerId } : {}),
    ...(defaultCustomerId ? { defaultCustomerId } : {}),
  };
}

export async function validateGoogleAdsConnection(credentials: Record<string, unknown>) {
  const normalized = getGoogleAdsCredentials(credentials);
  if (!normalized) {
    throw new Error("Google Ads credentials are incomplete");
  }

  const accessibleCustomers = await fetchAccessibleCustomers(normalized);
  if (accessibleCustomers.length === 0) {
    throw new Error("Google Ads returned no accessible customers");
  }

  const defaultCustomer = accessibleCustomers[0];
  let defaultCustomerSummary: GoogleAdsCustomerSummary | null = null;
  try {
    defaultCustomerSummary = await fetchCustomerSummary(
      normalized,
      defaultCustomer.customerId,
      normalized.loginCustomerId,
    );
  } catch {
    defaultCustomerSummary = null;
  }

  return {
    externalAccountId: defaultCustomer.customerId,
    metadata: {
      authMode: "oauth_access_token",
      baseUrl: normalized.baseUrl,
      accessibleCustomerCount: accessibleCustomers.length,
      accessibleCustomers,
      defaultCustomerId: defaultCustomer.customerId,
      defaultCustomerResourceName: defaultCustomer.resourceName,
      defaultCustomerName: defaultCustomerSummary?.descriptiveName ?? null,
      defaultCustomerCurrencyCode: defaultCustomerSummary?.currencyCode ?? null,
      defaultCustomerTimeZone: defaultCustomerSummary?.timeZone ?? null,
      loginCustomerId: normalized.loginCustomerId ?? null,
    },
  };
}

export async function executeGoogleAdsAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const payload = isRecord(input) ? input : {};
  const normalized = getGoogleAdsCredentials(connection.credentials);

  if (!normalized) {
    return {
      status: 400,
      body: { error: "Google Ads credentials are incomplete" },
    };
  }

  if (action === "list_accessible_customers") {
    const limit = getLimit(payload);
    const offset = getOffset(payload, limit);
    const accessibleCustomers = await fetchAccessibleCustomers(normalized);
    const sliced = accessibleCustomers.slice(offset, offset + limit);

    return buildListResponse(
      action,
      "customers",
      sliced.map((customer) => ({
        customerId: customer.customerId,
        resourceName: customer.resourceName,
      })),
      accessibleCustomers.length,
      limit,
      offset,
      {
        loginCustomerId: normalized.loginCustomerId ?? null,
      },
    );
  }

  const scoped = resolveCustomerId(connection, payload);
  if (!scoped) {
    return {
      status: 400,
      body: { error: "customerId is required for Google Ads reporting actions" },
    };
  }

  if (action === "get_customer") {
    const customer = await fetchCustomerSummary(
      scoped.credentials,
      scoped.customerId,
      scoped.loginCustomerId,
    );

    if (!customer) {
      return {
        status: 404,
        body: { error: `Google Ads customer ${scoped.customerId} returned no summary data` },
      };
    }

    return {
      status: 200,
      body: {
        provider: "google_ads",
        action,
        customerId: scoped.customerId,
        customer,
      },
    };
  }

  if (action === "list_campaigns") {
    const limit = getLimit(payload);
    const offset = getOffset(payload, limit);
    const statusFilter = pickString(payload, ["status"]);
    const includeRemoved = payload.includeRemoved === true;
    const rows = await fetchCampaignRows(
      scoped.credentials,
      scoped.customerId,
      scoped.loginCustomerId,
      `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign.primary_status,
          campaign.start_date,
          campaign.end_date
        FROM campaign
        ${
          !includeRemoved
            ? statusFilter
              ? `WHERE campaign.status = '${statusFilter.toUpperCase()}'`
              : "WHERE campaign.status != 'REMOVED'"
            : statusFilter
              ? `WHERE campaign.status = '${statusFilter.toUpperCase()}'`
              : ""
        }
        ORDER BY campaign.name
      `,
    );
    const campaigns = compactGoogleAdsCampaignList(rows);
    const sliced = campaigns.slice(offset, offset + limit);

    return buildListResponse(
      action,
      "campaigns",
      sliced,
      campaigns.length,
      limit,
      offset,
      {
        customerId: scoped.customerId,
      },
    );
  }

  if (action === "get_campaign") {
    const campaignId = normalizeGoogleAdsCustomerId(
      pickString(payload, ["campaignId", "campaign_id"]),
    );
    if (!campaignId) {
      return {
        status: 400,
        body: { error: "campaignId is required" },
      };
    }

    const rows = await fetchCampaignRows(
      scoped.credentials,
      scoped.customerId,
      scoped.loginCustomerId,
      `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          campaign.primary_status,
          campaign.start_date,
          campaign.end_date
        FROM campaign
        WHERE campaign.id = ${campaignId}
        LIMIT 1
      `,
    );

    const campaign = compactGoogleAdsCampaignList(rows)[0] ?? null;
    if (!campaign) {
      return {
        status: 404,
        body: { error: `Google Ads campaign ${campaignId} was not found` },
      };
    }

    return {
      status: 200,
      body: {
        provider: "google_ads",
        action,
        customerId: scoped.customerId,
        campaign,
      },
    };
  }

  if (action === "list_campaign_metrics") {
    const limit = getLimit(payload);
    const offset = getOffset(payload, limit);
    const startDate = pickString(payload, ["startDate", "start_date"]);
    const endDate = pickString(payload, ["endDate", "end_date"]);
    if (!startDate || !endDate) {
      return {
        status: 400,
        body: { error: "startDate and endDate are required" },
      };
    }

    const campaignId = normalizeGoogleAdsCustomerId(
      pickString(payload, ["campaignId", "campaign_id"]),
    );

    const customerSummary = await fetchCustomerSummary(
      scoped.credentials,
      scoped.customerId,
      scoped.loginCustomerId,
    );
    const rows = await fetchCampaignRows(
      scoped.credentials,
      scoped.customerId,
      scoped.loginCustomerId,
      `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.advertising_channel_type,
          segments.date,
          metrics.impressions,
          metrics.clicks,
          metrics.cost_micros,
          metrics.conversions
        FROM campaign
        WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        ${
          campaignId
            ? `AND campaign.id = ${campaignId}`
            : ""
        }
        ORDER BY segments.date, campaign.name
      `,
    );
    const metrics = compactGoogleAdsMetricList(rows, customerSummary?.currencyCode ?? null);
    const sliced = metrics.slice(offset, offset + limit);

    return buildListResponse(
      action,
      "metrics",
      sliced,
      metrics.length,
      limit,
      offset,
      {
        customerId: scoped.customerId,
        customerCurrencyCode: customerSummary?.currencyCode ?? null,
        dateRange: { startDate, endDate },
      },
    );
  }

  return {
    status: 400,
    body: { error: `Unsupported google_ads action: ${action}` },
  };
}
