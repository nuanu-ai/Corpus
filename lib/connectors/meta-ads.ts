import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_META_ADS_BASE_URL = "https://graph.facebook.com/v23.0";
const META_ADS_TIMEOUT_MS = 15_000;
const DEFAULT_META_ADS_LIMIT = 25;
const MAX_META_ADS_LIMIT = 100;

export type MetaAdsCredentials = {
  token: string;
  baseUrl: string;
  defaultAdAccountId?: string;
};

type MetaAdsPagination = {
  before: string | null;
  after: string | null;
  nextUrl: string | null;
  previousUrl: string | null;
};

type MetaAdsGraphResponse<T> = {
  data?: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
    previous?: string;
  };
  error?: {
    message?: string;
  };
  summary?: Record<string, unknown>;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeMetaAdsBaseUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_META_ADS_BASE_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Meta Ads base URL must use http or https");
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function getMetaAdsCredentials(
  credentials: Record<string, unknown>,
): MetaAdsCredentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.access_token) ||
    normalizeString(credentials.accessToken) ||
    normalizeString(credentials.apiKey);
  if (!token) {
    return null;
  }

  const defaultAdAccountId =
    normalizeString(credentials.defaultAdAccountId) ||
    normalizeString(credentials.adAccountId) ||
    normalizeString(credentials.accountId) ||
    "";

  return {
    token,
    baseUrl: normalizeMetaAdsBaseUrl(
      normalizeString(credentials.baseUrl) ||
        normalizeString(credentials.apiBaseUrl) ||
        DEFAULT_META_ADS_BASE_URL,
    ),
    ...(defaultAdAccountId ? { defaultAdAccountId } : {}),
  };
}

function metaAdsHeaders(token: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function buildMetaAdsErrorMessage(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "Meta Ads authentication failed. Reconnect Meta Ads with a valid access token.";
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }

  if (isRecord(payload)) {
    const message = payload.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
    const error = payload.error;
    if (isRecord(error) && typeof error.message === "string" && error.message.trim().length > 0) {
      return error.message.trim();
    }
  }

  return `Meta Ads request failed (${status})`;
}

async function metaAdsRequest<T>(
  credentials: MetaAdsCredentials,
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  },
): Promise<MetaAdsGraphResponse<T>> {
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
      headers: metaAdsHeaders(credentials.token),
      body:
        options?.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      cache: "no-store",
    },
    {
      timeoutMs: META_ADS_TIMEOUT_MS,
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
    throw new Error(buildMetaAdsErrorMessage(response.status, payload));
  }

  return payload as MetaAdsGraphResponse<T>;
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_META_ADS_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_META_ADS_LIMIT);
}

function getDateRange(input: Record<string, unknown>) {
  const startDate = normalizeString(input.startDate) || normalizeString(input.since);
  const endDate = normalizeString(input.endDate) || normalizeString(input.until);
  const datePreset = normalizeString(input.datePreset) || normalizeString(input.date_preset);

  return {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(datePreset ? { datePreset } : {}),
  };
}

function getAdAccountId(input: Record<string, unknown>, fallback?: string) {
  const value =
    normalizeString(input.adAccountId) ||
    normalizeString(input.accountId) ||
    normalizeString(input.defaultAdAccountId) ||
    normalizeString(input.id) ||
    fallback ||
    "";
  return value.replace(/^act_/i, "");
}

function normalizeAdAccountId(value: unknown) {
  const raw = normalizeString(value);
  return raw.replace(/^act_/i, "");
}

function normalizeCampaignId(value: unknown) {
  return normalizeString(value);
}

function parseGraphPagination<T>(
  payload: MetaAdsGraphResponse<T>,
): MetaAdsPagination {
  return {
    before:
      typeof payload.paging?.cursors?.before === "string"
        ? payload.paging.cursors.before
        : null,
    after:
      typeof payload.paging?.cursors?.after === "string"
        ? payload.paging.cursors.after
        : null,
    nextUrl:
      typeof payload.paging?.next === "string" ? payload.paging.next : null,
    previousUrl:
      typeof payload.paging?.previous === "string" ? payload.paging.previous : null,
  };
}

function pickGraphList<T extends Record<string, unknown>>(
  payload: MetaAdsGraphResponse<T>,
) {
  if (!Array.isArray(payload.data)) {
    return [];
  }
  return payload.data.filter(isRecord) as T[];
}

function buildAccountSummary(account: Record<string, unknown>) {
  return {
    id: normalizeAdAccountId(account.id),
    rawId: normalizeString(account.id),
    name: typeof account.name === "string" ? account.name : null,
    currency: typeof account.currency === "string" ? account.currency : null,
    timezoneName:
      typeof account.timezone_name === "string" ? account.timezone_name : null,
    accountStatus:
      typeof account.account_status === "number" ? account.account_status : null,
    businessName:
      typeof account.business_name === "string" ? account.business_name : null,
    amountSpent:
      typeof account.amount_spent === "string" ? account.amount_spent : null,
  };
}

function buildCampaignSummary(campaign: Record<string, unknown>) {
  return {
    id: normalizeCampaignId(campaign.id),
    name: typeof campaign.name === "string" ? campaign.name : null,
    status: typeof campaign.status === "string" ? campaign.status : null,
    effectiveStatus:
      typeof campaign.effective_status === "string"
        ? campaign.effective_status
        : null,
    objective:
      typeof campaign.objective === "string" ? campaign.objective : null,
    buyingType:
      typeof campaign.buying_type === "string" ? campaign.buying_type : null,
    createdTime:
      typeof campaign.created_time === "string" ? campaign.created_time : null,
    updatedTime:
      typeof campaign.updated_time === "string" ? campaign.updated_time : null,
  };
}

function buildInsightSummary(insight: Record<string, unknown>) {
  return {
    dateStart: typeof insight.date_start === "string" ? insight.date_start : null,
    dateStop: typeof insight.date_stop === "string" ? insight.date_stop : null,
    campaignId:
      typeof insight.campaign_id === "string" ? insight.campaign_id : null,
    campaignName:
      typeof insight.campaign_name === "string" ? insight.campaign_name : null,
    spend: typeof insight.spend === "string" ? insight.spend : null,
    impressions:
      typeof insight.impressions === "string" ? insight.impressions : null,
    clicks: typeof insight.clicks === "string" ? insight.clicks : null,
    reach: typeof insight.reach === "string" ? insight.reach : null,
    frequency:
      typeof insight.frequency === "string" ? insight.frequency : null,
    ctr: typeof insight.ctr === "string" ? insight.ctr : null,
    cpm: typeof insight.cpm === "string" ? insight.cpm : null,
    actions: Array.isArray(insight.actions) ? insight.actions : null,
  };
}

function collectionResponse(
  action: string,
  collectionKey: string,
  records: Array<Record<string, unknown>>,
  limit: number,
  pagination: MetaAdsPagination,
  extra?: Record<string, unknown>,
) {
  return {
    status: 200,
    body: {
      provider: "meta_ads",
      action,
      [collectionKey]: records,
      count: records.length,
      returnedCount: records.length,
      limit,
      hasMore: Boolean(pagination.after || pagination.nextUrl),
      nextCursor: pagination.after,
      previousCursor: pagination.before,
      ...(extra ?? {}),
    },
  };
}

export async function validateMetaAdsConnection(credentials: Record<string, unknown>) {
  const normalized = getMetaAdsCredentials(credentials);
  if (!normalized) {
    throw new Error("Meta Ads credentials are incomplete");
  }

  const mePayload = (await metaAdsRequest<Record<string, unknown>>(
    normalized,
    "/me",
    {
      query: {
        fields: "id,name",
      },
    },
  )) as unknown;

  if (!isRecord(mePayload)) {
    throw new Error("Meta Ads validation succeeded but user payload was missing");
  }

  const userId = typeof mePayload.id === "string" ? mePayload.id : null;
  if (!userId) {
    throw new Error("Meta Ads validation succeeded but user id was missing");
  }

  const accountsResponse = await metaAdsRequest<Record<string, unknown>>(
    normalized,
    "/me/adaccounts",
    {
      query: {
        fields: "id,name,account_status,currency,timezone_name,business_name,amount_spent",
        limit: DEFAULT_META_ADS_LIMIT,
      },
    },
  );

  const accounts = pickGraphList(accountsResponse).map(buildAccountSummary);
  const requestedDefaultId =
    normalizeString((credentials as Record<string, unknown>).defaultAdAccountId) ||
    normalizeString((credentials as Record<string, unknown>).adAccountId) ||
    normalizeString((credentials as Record<string, unknown>).accountId);
  const resolvedDefaultAccount =
    (requestedDefaultId
      ? accounts.find((account) => account.id === requestedDefaultId.replace(/^act_/i, ""))
      : null) ||
    accounts[0] ||
    null;

  if (requestedDefaultId && !resolvedDefaultAccount) {
    throw new Error(
      `Meta Ads validation succeeded but account ${requestedDefaultId} was not accessible`,
    );
  }

  return {
    externalAccountId: resolvedDefaultAccount?.id ?? userId,
    metadata: {
      authMode: "access_token",
      baseUrl: normalized.baseUrl,
      userId,
      userName: typeof mePayload.name === "string" ? mePayload.name : null,
      accessibleAdAccountCount: accounts.length,
      defaultAdAccountId: resolvedDefaultAccount?.id ?? null,
      defaultAdAccountName: resolvedDefaultAccount?.name ?? null,
      defaultAdAccountCurrency: resolvedDefaultAccount?.currency ?? null,
    },
  };
}

async function listMetaAdsAccounts(
  credentials: MetaAdsCredentials,
  input: Record<string, unknown>,
) {
  const limit = getLimit(input);
  const after =
    normalizeString(input.after) ||
    normalizeString(input.cursor) ||
    normalizeString(input.from);

  const payload = await metaAdsRequest<Record<string, unknown>>(
    credentials,
    "/me/adaccounts",
    {
      query: {
        fields: "id,name,account_status,currency,timezone_name,business_name,amount_spent",
        limit,
        ...(after ? { after } : {}),
      },
    },
  );

  const accounts = pickGraphList(payload).map(buildAccountSummary);
  const pagination = parseGraphPagination(payload);

  return collectionResponse(
    "list_ad_accounts",
    "adAccounts",
    accounts,
    limit,
    pagination,
    {
      totalCount: accounts.length,
    },
  );
}

async function listMetaAdsCampaigns(
  credentials: MetaAdsCredentials,
  input: Record<string, unknown>,
) {
  const limit = getLimit(input);
  const after =
    normalizeString(input.after) ||
    normalizeString(input.cursor) ||
    normalizeString(input.from);
  const adAccountId = getAdAccountId(
    input,
    credentials.defaultAdAccountId,
  );
  if (!adAccountId) {
    throw new Error("Meta Ads campaign reads require an adAccountId");
  }

  const payload = await metaAdsRequest<Record<string, unknown>>(
    credentials,
    `/act_${adAccountId}/campaigns`,
    {
      query: {
        fields: "id,name,status,effective_status,objective,buying_type,created_time,updated_time",
        limit,
        ...(after ? { after } : {}),
      },
    },
  );

  const campaigns = pickGraphList(payload).map(buildCampaignSummary);
  const pagination = parseGraphPagination(payload);

  return collectionResponse(
    "list_campaigns",
    "campaigns",
    campaigns,
    limit,
    pagination,
    {
      adAccountId,
      totalCount: campaigns.length,
    },
  );
}

async function getMetaAdsCampaign(
  credentials: MetaAdsCredentials,
  input: Record<string, unknown>,
) {
  const campaignId = normalizeCampaignId(
    input.campaignId ?? input.id ?? input.itemId,
  );
  if (!campaignId) {
    throw new Error("campaignId is required");
  }

  const payload = await metaAdsRequest<Record<string, unknown>>(
    credentials,
    `/${campaignId}`,
    {
      query: {
        fields: "id,name,status,effective_status,objective,buying_type,created_time,updated_time",
      },
    },
  );

  return {
    status: 200,
    body: {
      provider: "meta_ads",
      action: "get_campaign",
      campaignId,
      campaign: buildCampaignSummary(payload),
    },
  };
}

async function getMetaAdsInsights(
  credentials: MetaAdsCredentials,
  input: Record<string, unknown>,
  level: "account" | "campaign",
) {
  const limit = getLimit(input);
  const after =
    normalizeString(input.after) ||
    normalizeString(input.cursor) ||
    normalizeString(input.from);
  const adAccountId = getAdAccountId(
    input,
    credentials.defaultAdAccountId,
  );
  if (!adAccountId) {
    throw new Error("Meta Ads insight reads require an adAccountId");
  }

  const dateRange = getDateRange(input);
  const payload = await metaAdsRequest<Record<string, unknown>>(
    credentials,
    `/act_${adAccountId}/insights`,
    {
      query: {
        fields:
          "campaign_id,campaign_name,date_start,date_stop,spend,impressions,clicks,actions,reach,frequency,ctr,cpm",
        level,
        limit,
        ...(after ? { after } : {}),
        ...(dateRange.datePreset ? { date_preset: dateRange.datePreset } : {}),
        ...(dateRange.startDate && dateRange.endDate
          ? {
              time_range: JSON.stringify({
                since: dateRange.startDate,
                until: dateRange.endDate,
              }),
            }
          : {}),
      },
    },
  );

  const insights = pickGraphList(payload).map(buildInsightSummary);
  const pagination = parseGraphPagination(payload);

  return collectionResponse(
    level === "campaign" ? "get_campaign_insights" : "get_account_insights",
    "insights",
    insights,
    limit,
    pagination,
    {
      adAccountId,
      level,
      totalCount: insights.length,
      dateRange: dateRange.datePreset || (dateRange.startDate && dateRange.endDate)
        ? dateRange
        : null,
    },
  );
}

export async function executeMetaAdsAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getMetaAdsCredentials(connection.credentials);
  if (!credentials) {
    throw new Error("Meta Ads credentials are incomplete");
  }

  const params = isRecord(input) ? input : {};

  switch (action) {
    case "list_ad_accounts":
    case "list_accounts":
      return listMetaAdsAccounts(credentials, params);
    case "list_campaigns":
      return listMetaAdsCampaigns(credentials, params);
    case "get_campaign":
      return getMetaAdsCampaign(credentials, params);
    case "get_account_insights":
      return getMetaAdsInsights(credentials, params, "account");
    case "get_campaign_insights":
      return getMetaAdsInsights(credentials, params, "campaign");
    case "list_campaign_insights":
      return getMetaAdsInsights(credentials, params, "campaign");
    default:
      throw new Error(`Unknown Meta Ads action: ${action}`);
  }
}
