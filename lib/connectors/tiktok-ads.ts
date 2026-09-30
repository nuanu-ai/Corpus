import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_TIKTOK_ADS_BASE_URL =
  "https://business-api.tiktok.com/open_api/v1.3";
const TIKTOK_ADS_TIMEOUT_MS = 15_000;
const DEFAULT_TIKTOK_LIMIT = 25;
const MAX_TIKTOK_LIMIT = 100;

export type TiktokAdsCredentials = {
  token: string;
  advertiserId?: string;
  baseUrl: string;
};

type TiktokApiResponse<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type TiktokPagination = {
  page: number;
  pageSize: number;
  totalPage: number | null;
  hasMore: boolean;
  nextPage: number | null;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeTiktokAdsBaseUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_TIKTOK_ADS_BASE_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("TikTok Ads base URL must use http or https");
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_TIKTOK_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_TIKTOK_LIMIT);
}

function getPage(input: Record<string, unknown>) {
  if (typeof input.page === "number" && Number.isInteger(input.page) && input.page > 0) {
    return input.page;
  }
  return 1;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeAdvertiserId(value: unknown) {
  return normalizeString(value);
}

function tiktokHeaders(token: string) {
  return {
    Accept: "application/json",
    "Access-Token": token,
    "Content-Type": "application/json",
  };
}

function getTiktokErrorMessage(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "TikTok Ads authentication failed. Reconnect TikTok Ads with a valid access token.";
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }

  if (isRecord(payload)) {
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message.trim();
    }
    if (typeof payload.msg === "string" && payload.msg.trim().length > 0) {
      return payload.msg.trim();
    }
  }

  return `TikTok Ads request failed (${status})`;
}

async function tiktokRequest<T>(
  credentials: TiktokAdsCredentials,
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  },
): Promise<TiktokApiResponse<T>> {
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
      headers: tiktokHeaders(credentials.token),
      body:
        options?.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    },
    {
      timeoutMs: TIKTOK_ADS_TIMEOUT_MS,
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
    throw new Error(getTiktokErrorMessage(response.status, payload));
  }

  if (
    isRecord(payload) &&
    typeof payload.code === "number" &&
    payload.code !== 0
  ) {
    throw new Error(getTiktokErrorMessage(response.status, payload));
  }

  return payload as TiktokApiResponse<T>;
}

function pickAdvertiserId(
  input: Record<string, unknown>,
  fallback?: string,
) {
  return (
    normalizeAdvertiserId(input.advertiserId) ||
    normalizeAdvertiserId(input.accountId) ||
    normalizeAdvertiserId(input.id) ||
    (fallback ?? "")
  );
}

function buildAdvertiserSummary(item: Record<string, unknown>) {
  return {
    advertiserId:
      normalizeAdvertiserId(item.advertiser_id) ||
      normalizeAdvertiserId(item.advertiserId) ||
      normalizeAdvertiserId(item.id),
    name:
      normalizeString(item.advertiser_name) ||
      normalizeString(item.name) ||
      null,
    currency:
      normalizeString(item.currency) ||
      normalizeString(item.currency_code) ||
      null,
    status:
      normalizeString(item.status) ||
      normalizeString(item.advertiser_status) ||
      null,
    timezone:
      normalizeString(item.timezone) ||
      normalizeString(item.time_zone) ||
      null,
  };
}

function buildCampaignSummary(item: Record<string, unknown>) {
  return {
    campaignId:
      normalizeString(item.campaign_id) ||
      normalizeString(item.campaignId) ||
      normalizeString(item.id),
    name:
      normalizeString(item.campaign_name) ||
      normalizeString(item.name) ||
      null,
    status: normalizeString(item.status) || null,
    objective:
      normalizeString(item.objective_type) ||
      normalizeString(item.objective) ||
      null,
    budget: normalizeString(item.budget) || null,
    budgetMode:
      normalizeString(item.budget_mode) ||
      normalizeString(item.budgetMode) ||
      null,
  };
}

function buildInsightSummary(item: Record<string, unknown>) {
  const dimensions =
    isRecord(item.dimensions) ? item.dimensions : {};
  const metrics =
    isRecord(item.metrics) ? item.metrics : {};

  return {
    advertiserId:
      normalizeString(dimensions.advertiser_id) ||
      normalizeString(item.advertiser_id) ||
      null,
    campaignId:
      normalizeString(dimensions.campaign_id) ||
      normalizeString(item.campaign_id) ||
      null,
    date:
      normalizeString(dimensions.stat_time_day).split(" ")[0] ||
      null,
    campaignName:
      normalizeString(metrics.campaign_name) ||
      normalizeString(item.campaign_name) ||
      null,
    spend: parseNumber(metrics.spend),
    impressions: parseNumber(metrics.impressions),
    clicks: parseNumber(metrics.clicks),
    conversions:
      parseNumber(metrics.conversion) ||
      parseNumber(metrics.conversions),
    currency:
      normalizeString(metrics.currency) ||
      normalizeString(item.currency) ||
      null,
  };
}

function parsePagination(input: Record<string, unknown>): TiktokPagination {
  const page = typeof input.page === "number" ? input.page : 1;
  const pageSize =
    typeof input.page_size === "number"
      ? input.page_size
      : typeof input.pageSize === "number"
        ? input.pageSize
        : DEFAULT_TIKTOK_LIMIT;
  const totalPage =
    typeof input.total_page === "number"
      ? input.total_page
      : typeof input.totalPage === "number"
        ? input.totalPage
        : null;

  return {
    page,
    pageSize,
    totalPage,
    hasMore: totalPage !== null ? page < totalPage : false,
    nextPage: totalPage !== null && page < totalPage ? page + 1 : null,
  };
}

export function getTiktokAdsCredentials(
  credentials: Record<string, unknown>,
): TiktokAdsCredentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.accessToken) ||
    normalizeString(credentials.apiKey);

  if (!token) {
    return null;
  }

  const advertiserId = normalizeAdvertiserId(
    credentials.advertiserId ?? credentials.accountId ?? credentials.id,
  );

  return {
    token,
    baseUrl: normalizeTiktokAdsBaseUrl(
      normalizeString(credentials.baseUrl) ||
        normalizeString(credentials.apiBaseUrl) ||
        DEFAULT_TIKTOK_ADS_BASE_URL,
    ),
    ...(advertiserId ? { advertiserId } : {}),
  };
}

export async function validateTiktokAdsConnection(credentials: Record<string, unknown>) {
  const normalized = getTiktokAdsCredentials(credentials);
  if (!normalized) {
    throw new Error("TikTok Ads credentials are incomplete");
  }

  const advertiserPayload = await tiktokRequest<{
    list?: Array<Record<string, unknown>>;
  }>(normalized, "/oauth2/advertiser/get/", {
    method: "GET",
  });

  const advertisers = Array.isArray(advertiserPayload.data?.list)
    ? advertiserPayload.data!.list.filter(isRecord).map(buildAdvertiserSummary)
    : [];

  const requestedAdvertiserId = normalizeAdvertiserId(credentials.advertiserId);
  const defaultAdvertiser =
    (requestedAdvertiserId
      ? advertisers.find((item) => item.advertiserId === requestedAdvertiserId)
      : null) ||
    (normalized.advertiserId
      ? advertisers.find((item) => item.advertiserId === normalized.advertiserId)
      : null) ||
    advertisers[0] ||
    null;

  if (requestedAdvertiserId && !defaultAdvertiser) {
    throw new Error(
      `TikTok Ads validation succeeded but advertiser ${requestedAdvertiserId} was not accessible`,
    );
  }

  return {
    externalAccountId:
      defaultAdvertiser?.advertiserId ??
      normalized.advertiserId ??
      null,
    metadata: {
      authMode: "access_token",
      baseUrl: normalized.baseUrl,
      accessibleAdvertiserCount: advertisers.length,
      defaultAdvertiserId: defaultAdvertiser?.advertiserId ?? normalized.advertiserId ?? null,
      defaultAdvertiserName: defaultAdvertiser?.name ?? null,
      defaultAdvertiserCurrency: defaultAdvertiser?.currency ?? null,
      advertisers,
    },
  };
}

async function listTiktokAdvertisers(
  credentials: TiktokAdsCredentials,
) {
  const payload = await tiktokRequest<{
    list?: Array<Record<string, unknown>>;
  }>(credentials, "/oauth2/advertiser/get/", {
    method: "GET",
  });

  const advertisers = Array.isArray(payload.data?.list)
    ? payload.data!.list.filter(isRecord).map(buildAdvertiserSummary)
    : [];

  return {
    status: 200,
    body: {
      provider: "tiktok_ads",
      action: "list_advertisers",
      advertisers,
      count: advertisers.length,
      returnedCount: advertisers.length,
      hasMore: false,
      nextPage: null,
    },
  };
}

async function listTiktokCampaigns(
  credentials: TiktokAdsCredentials,
  input: Record<string, unknown>,
) {
  const advertiserId = pickAdvertiserId(input, credentials.advertiserId);
  if (!advertiserId) {
    throw new Error("advertiserId is required for TikTok campaign reads");
  }

  const page = getPage(input);
  const pageSize = getLimit(input);
  const payload = await tiktokRequest<{
    list?: Array<Record<string, unknown>>;
    page_info?: Record<string, unknown>;
    pageInfo?: Record<string, unknown>;
  }>(credentials, "/campaign/get/", {
    method: "GET",
    query: {
      advertiser_id: advertiserId,
      page,
      page_size: pageSize,
    },
  });

  const campaigns = Array.isArray(payload.data?.list)
    ? payload.data!.list.filter(isRecord).map(buildCampaignSummary)
    : [];
  const pagination = parsePagination(
    (payload.data?.page_info as Record<string, unknown>) ??
      (payload.data?.pageInfo as Record<string, unknown>) ??
      { page, page_size: pageSize, total_page: 1 },
  );

  return {
    status: 200,
    body: {
      provider: "tiktok_ads",
      action: "list_campaigns",
      advertiserId,
      campaigns,
      count: campaigns.length,
      returnedCount: campaigns.length,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore: pagination.hasMore,
      nextPage: pagination.nextPage,
      totalPage: pagination.totalPage,
    },
  };
}

async function getTiktokCampaign(
  credentials: TiktokAdsCredentials,
  input: Record<string, unknown>,
) {
  const advertiserId = pickAdvertiserId(input, credentials.advertiserId);
  if (!advertiserId) {
    throw new Error("advertiserId is required for TikTok campaign reads");
  }

  const campaignId =
    normalizeString(input.campaignId) ||
    normalizeString(input.id);
  if (!campaignId) {
    throw new Error("campaignId is required");
  }

  const payload = await tiktokRequest<{
    list?: Array<Record<string, unknown>>;
  }>(credentials, "/campaign/get/", {
    method: "GET",
    query: {
      advertiser_id: advertiserId,
      filtering: JSON.stringify({ campaign_ids: [campaignId] }),
      page: 1,
      page_size: 1,
    },
  });

  const campaign =
    Array.isArray(payload.data?.list) && payload.data!.list.length > 0 && isRecord(payload.data!.list[0])
      ? buildCampaignSummary(payload.data!.list[0] as Record<string, unknown>)
      : null;

  return {
    status: 200,
    body: {
      provider: "tiktok_ads",
      action: "get_campaign",
      advertiserId,
      campaignId,
      campaign,
    },
  };
}

async function getTiktokInsights(
  credentials: TiktokAdsCredentials,
  input: Record<string, unknown>,
  level: "AUCTION_ADVERTISER" | "AUCTION_CAMPAIGN",
) {
  const advertiserId = pickAdvertiserId(input, credentials.advertiserId);
  if (!advertiserId) {
    throw new Error("advertiserId is required for TikTok insights reads");
  }

  const startDate = normalizeString(input.startDate) || normalizeString(input.since);
  const endDate = normalizeString(input.endDate) || normalizeString(input.until);
  if (!startDate || !endDate) {
    throw new Error("startDate and endDate are required");
  }

  const page = getPage(input);
  const pageSize = getLimit(input);
  const dimensions =
    level === "AUCTION_CAMPAIGN"
      ? ["campaign_id", "stat_time_day"]
      : ["advertiser_id", "stat_time_day"];

  const payload = await tiktokRequest<{
    list?: Array<Record<string, unknown>>;
    page_info?: Record<string, unknown>;
    pageInfo?: Record<string, unknown>;
  }>(credentials, "/report/integrated/get/", {
    method: "POST",
    body: {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      dimensions,
      metrics: [
        "campaign_name",
        "spend",
        "impressions",
        "clicks",
        "conversion",
        "currency",
      ],
      data_level: level,
      start_date: startDate,
      end_date: endDate,
      page,
      page_size: pageSize,
    },
  });

  const insights = Array.isArray(payload.data?.list)
    ? payload.data!.list.filter(isRecord).map(buildInsightSummary)
    : [];
  const pagination = parsePagination(
    (payload.data?.page_info as Record<string, unknown>) ??
      (payload.data?.pageInfo as Record<string, unknown>) ??
      { page, page_size: pageSize, total_page: 1 },
  );

  return {
    status: 200,
    body: {
      provider: "tiktok_ads",
      action:
        level === "AUCTION_CAMPAIGN"
          ? "get_campaign_insights"
          : "get_account_insights",
      advertiserId,
      insights,
      count: insights.length,
      returnedCount: insights.length,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore: pagination.hasMore,
      nextPage: pagination.nextPage,
      totalPage: pagination.totalPage,
      startDate,
      endDate,
    },
  };
}

export async function executeTiktokAdsAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  payload: unknown,
) {
  const credentials = getTiktokAdsCredentials(connection.credentials);
  if (!credentials) {
    throw new Error("TikTok Ads credentials are incomplete");
  }
  const input = isRecord(payload) ? payload : {};

  switch (action) {
    case "list_advertisers":
      return listTiktokAdvertisers(credentials);
    case "list_campaigns":
      return listTiktokCampaigns(credentials, input);
    case "get_campaign":
      return getTiktokCampaign(credentials, input);
    case "get_account_insights":
      return getTiktokInsights(credentials, input, "AUCTION_ADVERTISER");
    case "get_campaign_insights":
      return getTiktokInsights(credentials, input, "AUCTION_CAMPAIGN");
    default:
      throw new Error(`Unsupported TikTok Ads action: ${action}`);
  }
}
