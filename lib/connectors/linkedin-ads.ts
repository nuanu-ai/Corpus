import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_LINKEDIN_ADS_BASE_URL = "https://api.linkedin.com/rest";
const DEFAULT_LINKEDIN_ADS_VERSION =
  process.env.LINKEDIN_ADS_API_VERSION?.trim() || "202603";
const LINKEDIN_ADS_TIMEOUT_MS = 15_000;
const DEFAULT_LINKEDIN_ADS_LIMIT = 25;
const MAX_LINKEDIN_ADS_LIMIT = 100;
const RESTLI_PROTOCOL_VERSION = "2.0.0";
const DEFAULT_ANALYTICS_FIELDS = [
  "costInLocalCurrency",
  "impressions",
  "clicks",
  "externalWebsiteConversions",
  "pivotValues",
  "dateRange",
] as const;

export type LinkedinAdsCredentials = {
  token: string;
  baseUrl: string;
  apiVersion: string;
  defaultAdAccountId?: string;
};

type LinkedinAdsPaging = {
  start: number;
  count: number;
  hasMore: boolean;
  nextStart: number | null;
  totalCount: number | null;
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

export function normalizeLinkedinAdsBaseUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_LINKEDIN_ADS_BASE_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LinkedIn Ads base URL must use http or https");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname || pathname === "/") {
    return DEFAULT_LINKEDIN_ADS_BASE_URL;
  }

  return `${url.origin}${pathname}`;
}

export function normalizeLinkedinAdsVersion(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_LINKEDIN_ADS_VERSION;
  }
  const normalized = trimmed.replace(/^v/i, "");
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error("LinkedIn Ads API version must use YYYYMM format");
  }
  return normalized;
}

export function normalizeLinkedinAdsAccountId(value: unknown) {
  const raw = normalizeString(value);
  if (!raw) return "";
  return raw.replace(/^urn:li:sponsoredAccount:/i, "");
}

export function normalizeLinkedinAdsCampaignId(value: unknown) {
  const raw = normalizeString(value);
  if (!raw) return "";
  return raw.replace(/^urn:li:sponsoredCampaign:/i, "");
}

function buildSponsoredAccountUrn(accountId: string) {
  return `urn:li:sponsoredAccount:${normalizeLinkedinAdsAccountId(accountId)}`;
}

function buildSponsoredCampaignUrn(campaignId: string) {
  return `urn:li:sponsoredCampaign:${normalizeLinkedinAdsCampaignId(campaignId)}`;
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_LINKEDIN_ADS_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_LINKEDIN_ADS_LIMIT);
}

function getStart(input: Record<string, unknown>, limit: number) {
  if (typeof input.start === "number" && Number.isInteger(input.start)) {
    return Math.max(input.start, 0);
  }
  if (typeof input.offset === "number" && Number.isInteger(input.offset)) {
    return Math.max(input.offset, 0);
  }
  if (typeof input.page === "number" && Number.isInteger(input.page)) {
    return Math.max((input.page - 1) * limit, 0);
  }
  return 0;
}

function linkedinAdsHeaders(credentials: LinkedinAdsCredentials) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${credentials.token}`,
    "Linkedin-Version": credentials.apiVersion,
    "X-Restli-Protocol-Version": RESTLI_PROTOCOL_VERSION,
  };
}

function getLinkedinAdsErrorMessage(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "LinkedIn Ads authentication failed. Reconnect LinkedIn Ads with a valid access token that can read Campaign Manager data.";
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
    if (typeof payload.serviceErrorCode === "number" && typeof payload.message === "string") {
      return payload.message;
    }
  }

  return `LinkedIn Ads request failed (${status})`;
}

async function linkedinAdsRequest<T>(
  credentials: LinkedinAdsCredentials,
  path: string,
  options?: {
    query?: Record<string, string | number | undefined>;
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
      method: "GET",
      headers: linkedinAdsHeaders(credentials),
      cache: "no-store",
    },
    {
      timeoutMs: LINKEDIN_ADS_TIMEOUT_MS,
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
    throw new Error(getLinkedinAdsErrorMessage(response.status, payload));
  }

  return payload as T;
}

function extractElements<T extends Record<string, unknown>>(payload: unknown): T[] {
  if (!isRecord(payload) || !Array.isArray(payload.elements)) {
    return [];
  }
  return payload.elements.filter(isRecord) as T[];
}

function parsePaging(payload: unknown): LinkedinAdsPaging {
  if (!isRecord(payload) || !isRecord(payload.paging)) {
    return { start: 0, count: 0, hasMore: false, nextStart: null, totalCount: null };
  }

  const start = parseNumber(payload.paging.start) ?? 0;
  const count = parseNumber(payload.paging.count) ?? 0;
  const totalCount =
    parseNumber(payload.paging.total) ??
    parseNumber(payload.paging.totalCount) ??
    parseNumber(payload.total) ??
    null;
  const links = Array.isArray(payload.paging.links) ? payload.paging.links : [];
  const nextLink = links.find(
    (entry) => isRecord(entry) && normalizeString(entry.rel).toLowerCase() === "next",
  ) as Record<string, unknown> | undefined;
  const nextHref = nextLink ? normalizeString(nextLink.href) : "";
  let nextStart: number | null = null;

  if (nextHref) {
    try {
      const nextUrl = new URL(nextHref, credentialslessBaseUrl(nextHref));
      const parsed = parseNumber(nextUrl.searchParams.get("start"));
      nextStart = parsed === null ? start + count : parsed;
    } catch {
      nextStart = totalCount !== null && start + count >= totalCount ? null : start + count;
    }
  }

  return {
    start,
    count,
    hasMore:
      nextStart !== null ||
      (totalCount !== null ? start + count < totalCount : false),
    nextStart,
    totalCount,
  };
}

function credentialslessBaseUrl(href: string) {
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }
  return "https://api.linkedin.com";
}

function buildAccountSummary(account: Record<string, unknown>) {
  const rawId =
    normalizeString(account.id) ||
    normalizeString(account.account) ||
    normalizeString(account.accountId);
  const accountId = normalizeLinkedinAdsAccountId(rawId);

  return {
    accountId,
    adAccountId: accountId,
    rawId: rawId || (accountId ? buildSponsoredAccountUrn(accountId) : null),
    name:
      normalizeString(account.name) ||
      normalizeString(account.reference) ||
      null,
    status: normalizeString(account.status) || null,
    type: normalizeString(account.type) || null,
    currency:
      normalizeString(account.currency) ||
      normalizeString(account.currencyCode) ||
      null,
    test: typeof account.test === "boolean" ? account.test : null,
    reference: normalizeString(account.reference) || null,
  };
}

function buildCampaignSummary(campaign: Record<string, unknown>, adAccountId?: string | null) {
  const rawId =
    normalizeString(campaign.id) ||
    normalizeString(campaign.campaign) ||
    normalizeString(campaign.campaignId);
  const campaignId = normalizeLinkedinAdsCampaignId(rawId);

  const resolvedAccountId =
    adAccountId ||
    normalizeLinkedinAdsAccountId(campaign.account) ||
    normalizeLinkedinAdsAccountId(campaign.accountId) ||
    null;
  const runSchedule = isRecord(campaign.runSchedule) ? campaign.runSchedule : null;

  return {
    campaignId,
    rawId: rawId || (campaignId ? buildSponsoredCampaignUrn(campaignId) : null),
    accountId: resolvedAccountId,
    adAccountId: resolvedAccountId,
    name:
      normalizeString(campaign.name) ||
      normalizeString(campaign.reference) ||
      null,
    status: normalizeString(campaign.status) || null,
    type: normalizeString(campaign.type) || null,
    format: normalizeString(campaign.format) || null,
    objectiveType: normalizeString(campaign.objectiveType) || null,
    runScheduleStart:
      normalizeString(runSchedule?.start) ||
      normalizeString(campaign.runScheduleStart) ||
      null,
    runScheduleEnd:
      normalizeString(runSchedule?.end) ||
      normalizeString(campaign.runScheduleEnd) ||
      null,
    locale: normalizeString(campaign.locale) || null,
  };
}

function getDateComponent(date: string, part: "year" | "month" | "day") {
  const [year, month, day] = date.split("-").map((value) => Number(value));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid LinkedIn Ads date: ${date}`);
  }
  if (part === "year") return year;
  if (part === "month") return month;
  return day;
}

function buildDateRangeParam(startDate: string, endDate?: string) {
  const start = `(year:${getDateComponent(startDate, "year")},month:${getDateComponent(startDate, "month")},day:${getDateComponent(startDate, "day")})`;
  const end = endDate
    ? `,end:(year:${getDateComponent(endDate, "year")},month:${getDateComponent(endDate, "month")},day:${getDateComponent(endDate, "day")})`
    : "";
  return `(start:${start}${end})`;
}

function buildAnalyticsSummary(row: Record<string, unknown>) {
  const pivotValues = Array.isArray(row.pivotValues)
    ? row.pivotValues.filter((value) => typeof value === "string")
    : [];
  const accountPivot =
    pivotValues.find((value) => value.includes("sponsoredAccount")) ?? null;
  const campaignPivot =
    pivotValues.find((value) => value.includes("sponsoredCampaign")) ?? null;
  const cost =
    isRecord(row.costInLocalCurrency)
      ? parseNumber(
          row.costInLocalCurrency.value ??
            row.costInLocalCurrency.amount ??
            row.costInLocalCurrency.raw,
        )
      : parseNumber(row.costInLocalCurrency);

  return {
    pivotValues,
    campaignId:
      normalizeLinkedinAdsCampaignId(campaignPivot ?? row.campaign) || null,
    accountId:
      normalizeLinkedinAdsAccountId(accountPivot ?? row.account) || null,
    dateRange: isRecord(row.dateRange) ? row.dateRange : null,
    spend: cost,
    impressions: parseNumber(row.impressions),
    clicks: parseNumber(row.clicks),
    conversions: parseNumber(row.externalWebsiteConversions),
    likes: parseNumber(row.likes),
    shares: parseNumber(row.shares),
    landingPageClicks: parseNumber(row.landingPageClicks),
  };
}

function buildCollectionResponse(
  action: string,
  collectionKey: string,
  items: Array<Record<string, unknown>>,
  limit: number,
  paging: LinkedinAdsPaging,
  extra?: Record<string, unknown>,
) {
  return {
    status: 200,
    body: {
      provider: "linkedin_ads",
      action,
      [collectionKey]: items,
      count: paging.totalCount ?? items.length,
      returnedCount: items.length,
      limit,
      start: paging.start,
      hasMore: paging.hasMore,
      nextStart: paging.nextStart,
      totalCount: paging.totalCount,
      ...(extra ?? {}),
    },
  };
}

export function getLinkedinAdsCredentials(
  credentials: Record<string, unknown>,
): LinkedinAdsCredentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.access_token) ||
    normalizeString(credentials.accessToken) ||
    normalizeString(credentials.apiKey);

  if (!token) {
    return null;
  }

  const baseUrl = normalizeLinkedinAdsBaseUrl(
    normalizeString(credentials.baseUrl) ||
      normalizeString(credentials.apiBaseUrl) ||
      DEFAULT_LINKEDIN_ADS_BASE_URL,
  );

  const apiVersion = normalizeLinkedinAdsVersion(
    normalizeString(credentials.apiVersion) ||
      normalizeString(credentials.linkedinVersion) ||
      DEFAULT_LINKEDIN_ADS_VERSION,
  );

  const defaultAdAccountId = normalizeLinkedinAdsAccountId(
    credentials.defaultAdAccountId ??
      credentials.defaultAccountId ??
      credentials.adAccountId ??
      credentials.accountId,
  );

  return {
    token,
    baseUrl,
    apiVersion,
    ...(defaultAdAccountId ? { defaultAdAccountId } : {}),
  };
}

async function fetchLinkedinAdsAccounts(
  credentials: LinkedinAdsCredentials,
  input: Record<string, unknown>,
) {
  const limit = getLimit(input);
  const start = getStart(input, limit);
  const payload = await linkedinAdsRequest<Record<string, unknown>>(
    credentials,
    "/adAccounts",
    {
      query: {
        q: "search",
        start,
        count: limit,
      },
    },
  );

  const accounts = extractElements<Record<string, unknown>>(payload).map(buildAccountSummary);
  const paging = parsePaging(payload);

  return buildCollectionResponse(
    "list_ad_accounts",
    "adAccounts",
    accounts,
    limit,
    paging,
    {
      totalCount: accounts.length,
    },
  );
}

async function fetchLinkedinAdsAccount(
  credentials: LinkedinAdsCredentials,
  adAccountId: string,
) {
  const payload = await linkedinAdsRequest<Record<string, unknown>>(
    credentials,
    `/adAccounts/${normalizeLinkedinAdsAccountId(adAccountId)}`,
  );

  return buildAccountSummary(payload);
}

function resolveLinkedinAdsAccountId(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  input: Record<string, unknown>,
) {
  const credentials = getLinkedinAdsCredentials(connection.credentials);
  if (!credentials) {
    return null;
  }

  const metadata = connection.metadata ?? {};
  const adAccountId =
    normalizeLinkedinAdsAccountId(
      input.adAccountId ?? input.accountId ?? input.defaultAdAccountId ?? input.id,
    ) ||
    credentials.defaultAdAccountId ||
    normalizeLinkedinAdsAccountId(
      (metadata as Record<string, unknown>).defaultAdAccountId,
    );

  return adAccountId ? { credentials, adAccountId } : null;
}

async function listLinkedinAdsCampaigns(
  credentials: LinkedinAdsCredentials,
  adAccountId: string,
  input: Record<string, unknown>,
) {
  const limit = getLimit(input);
  const start = getStart(input, limit);
  const payload = await linkedinAdsRequest<Record<string, unknown>>(
    credentials,
    `/adAccounts/${adAccountId}/adCampaigns`,
    {
      query: {
        q: "search",
        start,
        count: limit,
      },
    },
  );

  const requestedStatus = normalizeString(input.status).toLowerCase();
  const campaigns = extractElements<Record<string, unknown>>(payload)
    .map((campaign) => buildCampaignSummary(campaign, adAccountId))
    .filter((campaign) => {
      if (!requestedStatus) return true;
      return normalizeString(campaign.status).toLowerCase() === requestedStatus;
    });
  const paging = parsePaging(payload);

  return buildCollectionResponse(
    "list_campaigns",
    "campaigns",
    campaigns,
    limit,
    paging,
    {
      adAccountId,
    },
  );
}

async function getLinkedinAdsCampaign(
  credentials: LinkedinAdsCredentials,
  adAccountId: string,
  campaignId: string,
) {
  const payload = await linkedinAdsRequest<Record<string, unknown>>(
    credentials,
    `/adAccounts/${adAccountId}/adCampaigns/${normalizeLinkedinAdsCampaignId(campaignId)}`,
  );

  return buildCampaignSummary(payload, adAccountId);
}

function normalizeLinkedinAdsFieldList(input: Record<string, unknown>) {
  if (!Array.isArray(input.fields)) {
    return DEFAULT_ANALYTICS_FIELDS.join(",");
  }

  const fields = input.fields
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .slice(0, 20);
  return fields.length > 0 ? fields.join(",") : DEFAULT_ANALYTICS_FIELDS.join(",");
}

async function getLinkedinAdsAnalytics(
  credentials: LinkedinAdsCredentials,
  adAccountId: string,
  input: Record<string, unknown>,
  mode: "account" | "campaign",
) {
  const limit = getLimit(input);
  const start = getStart(input, limit);
  const startDate = normalizeString(input.startDate);
  const endDate = normalizeString(input.endDate);
  if (!startDate) {
    throw new Error("startDate is required");
  }

  const timeGranularity = normalizeString(input.timeGranularity) || "DAILY";
  const query: Record<string, string | number | undefined> = {
    q: "analytics",
    timeGranularity,
    dateRange: buildDateRangeParam(startDate, endDate),
    start,
    count: limit,
    fields: normalizeLinkedinAdsFieldList(input),
  };

  if (mode === "campaign") {
    const campaignIds = Array.isArray(input.campaignIds)
      ? input.campaignIds
          .map((value) => normalizeLinkedinAdsCampaignId(value))
          .filter(Boolean)
      : [
          normalizeLinkedinAdsCampaignId(input.campaignId),
        ].filter(Boolean);

    if (campaignIds.length > 0) {
      query.campaigns = `List(${campaignIds.map(buildSponsoredCampaignUrn).join(",")})`;
      query.pivot = "CAMPAIGN";
    } else {
      query.accounts = `List(${buildSponsoredAccountUrn(adAccountId)})`;
      query.pivot = "CAMPAIGN";
    }
  } else {
    query.accounts = `List(${buildSponsoredAccountUrn(adAccountId)})`;
    query.pivot = "ACCOUNT";
  }

  const payload = await linkedinAdsRequest<Record<string, unknown>>(
    credentials,
    "/adAnalytics",
    { query },
  );

  const analytics = extractElements<Record<string, unknown>>(payload).map(buildAnalyticsSummary);
  const paging = parsePaging(payload);

  return buildCollectionResponse(
    mode === "campaign" ? "get_campaign_analytics" : "get_account_analytics",
    "analytics",
    analytics,
    limit,
    paging,
    {
      adAccountId,
      ...(mode === "campaign" && Array.isArray(input.campaignIds)
        ? { campaignIds: input.campaignIds }
        : {}),
      ...(mode === "campaign" && normalizeLinkedinAdsCampaignId(input.campaignId)
        ? { campaignId: normalizeLinkedinAdsCampaignId(input.campaignId) }
        : {}),
      dateRange: {
        startDate,
        endDate: endDate || null,
      },
      timeGranularity,
    },
  );
}

export async function validateLinkedinAdsConnection(credentials: Record<string, unknown>) {
  const normalized = getLinkedinAdsCredentials(credentials);
  if (!normalized) {
    throw new Error("LinkedIn Ads credentials are incomplete");
  }

  const accountsResponse = await fetchLinkedinAdsAccounts(normalized, {
    limit: DEFAULT_LINKEDIN_ADS_LIMIT,
    start: 0,
  });
  const accounts = Array.isArray(accountsResponse.body.adAccounts)
    ? accountsResponse.body.adAccounts
    : [];

  if (accounts.length === 0) {
    throw new Error("LinkedIn Ads returned no accessible ad accounts");
  }

  const requestedDefault =
    normalizeLinkedinAdsAccountId(credentials.defaultAdAccountId ?? credentials.adAccountId ?? credentials.accountId) ||
    "";
  const defaultAccount =
    (requestedDefault
      ? accounts.find((account) => normalizeLinkedinAdsAccountId(account.adAccountId) === requestedDefault)
      : null) ||
    accounts[0] ||
    null;

  if (requestedDefault && !defaultAccount) {
    throw new Error(
      `LinkedIn Ads validation succeeded but account ${requestedDefault} was not accessible`,
    );
  }

  return {
    externalAccountId:
      typeof defaultAccount?.adAccountId === "string" ? defaultAccount.adAccountId : null,
    metadata: {
      authMode: "access_token",
      baseUrl: normalized.baseUrl,
      apiVersion: normalized.apiVersion,
      accessibleAccountCount: accounts.length,
      defaultAccountId:
        typeof defaultAccount?.accountId === "string" ? defaultAccount.accountId : null,
      defaultAccountName:
        typeof defaultAccount?.name === "string" ? defaultAccount.name : null,
      defaultAccountCurrency:
        typeof defaultAccount?.currency === "string" ? defaultAccount.currency : null,
    },
  };
}

export async function executeLinkedinAdsAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const payload = isRecord(input) ? input : {};
  const normalized = getLinkedinAdsCredentials(connection.credentials);

  if (!normalized) {
    return {
      status: 400,
      body: { error: "LinkedIn Ads credentials are incomplete" },
    };
  }

  if (action === "list_accounts" || action === "list_ad_accounts") {
    const result = await fetchLinkedinAdsAccounts(normalized, payload);
    return {
      ...result,
      body: {
        ...result.body,
        action,
        accounts: result.body.adAccounts,
        count: result.body.count,
        returnedCount: result.body.returnedCount,
      },
    };
  }

  const scoped = resolveLinkedinAdsAccountId(connection, payload);
  if (!scoped) {
    return {
      status: 400,
      body: { error: "adAccountId is required for LinkedIn Ads reporting actions" },
    };
  }

  if (action === "get_account" || action === "get_ad_account") {
    const account = await fetchLinkedinAdsAccount(
      scoped.credentials,
      scoped.adAccountId,
    );
    return {
      status: 200,
      body: {
        provider: "linkedin_ads",
        action,
        accountId: scoped.adAccountId,
        adAccountId: scoped.adAccountId,
        account,
      },
    };
  }

  if (action === "list_campaigns") {
    return listLinkedinAdsCampaigns(scoped.credentials, scoped.adAccountId, payload);
  }

  if (action === "get_campaign") {
    const campaignId = normalizeLinkedinAdsCampaignId(
      payload.campaignId ?? payload.id ?? payload.itemId,
    );
    if (!campaignId) {
      return {
        status: 400,
        body: { error: "campaignId is required" },
      };
    }

    const campaign = await getLinkedinAdsCampaign(
      scoped.credentials,
      scoped.adAccountId,
      campaignId,
    );

    return {
      status: 200,
      body: {
        provider: "linkedin_ads",
        action,
        adAccountId: scoped.adAccountId,
        campaignId,
        campaign,
      },
    };
  }

  if (
    action === "query_analytics" ||
    action === "get_account_analytics" ||
    action === "get_campaign_analytics"
  ) {
    const mode =
      action === "get_account_analytics"
        ? "account"
        : action === "get_campaign_analytics"
          ? "campaign"
          : Array.isArray(payload.campaignIds) ||
              normalizeLinkedinAdsCampaignId(payload.campaignId).length > 0
            ? "campaign"
            : "account";
    return getLinkedinAdsAnalytics(scoped.credentials, scoped.adAccountId, payload, mode);
  }

  return {
    status: 400,
    body: { error: `Unsupported linkedin_ads action: ${action}` },
  };
}

export const normalizeLinkedInAdsBaseUrl = normalizeLinkedinAdsBaseUrl;
export const normalizeLinkedInAdsVersion = normalizeLinkedinAdsVersion;
export const normalizeLinkedInAdsAccountId = normalizeLinkedinAdsAccountId;
export const normalizeLinkedInAdsCampaignId = normalizeLinkedinAdsCampaignId;
export const getLinkedInAdsCredentials = getLinkedinAdsCredentials;
export const validateLinkedInAdsConnection = validateLinkedinAdsConnection;
export const executeLinkedInAdsAction = executeLinkedinAdsAction;
