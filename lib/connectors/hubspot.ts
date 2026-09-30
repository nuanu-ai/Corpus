import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_HUBSPOT_BASE_URL = "https://api.hubapi.com";
const HUBSPOT_TIMEOUT_MS = 15_000;
const DEFAULT_HUBSPOT_LIMIT = 25;
const MAX_HUBSPOT_LIMIT = 100;

export type HubspotCredentials = {
  token: string;
  baseUrl: string;
  portalId?: string;
};

type HubspotPaging = {
  nextAfter: string | null;
  hasMore: boolean;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_HUBSPOT_BASE_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HubSpot base URL must use http or https");
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function normalizeHubspotBaseUrl(input: string) {
  return normalizeUrl(input);
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

function pickIdentifier(input: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_HUBSPOT_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_HUBSPOT_LIMIT);
}

function getAfter(input: Record<string, unknown>) {
  return (
    normalizeString(input.after) ||
    normalizeString(input.cursor) ||
    normalizeString(input.from) ||
    ""
  );
}

function hubspotHeaders(token: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function buildHubspotErrorMessage(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "HubSpot authentication failed. Reconnect HubSpot with a valid private app token.";
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
    if (isRecord(payload.errors) && typeof payload.errors.message === "string") {
      return payload.errors.message.trim();
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const first = payload.errors[0];
      if (typeof first === "string" && first.trim().length > 0) {
        return first.trim();
      }
      if (isRecord(first) && typeof first.message === "string" && first.message.trim().length > 0) {
        return first.message.trim();
      }
    }
  }

  return `HubSpot request failed (${status})`;
}

async function hubspotRequest<T>(
  credentials: HubspotCredentials,
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
      headers: hubspotHeaders(credentials.token),
      body:
        options?.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      cache: "no-store",
    },
    {
      timeoutMs: HUBSPOT_TIMEOUT_MS,
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
    throw new Error(buildHubspotErrorMessage(response.status, payload));
  }

  return payload as T;
}

function pickCollection(payload: unknown, keys: readonly string[]) {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }
  for (const key of keys) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      return candidate.filter(isRecord);
    }
  }
  return [];
}

function parsePaging(payload: unknown): HubspotPaging {
  if (!isRecord(payload) || !isRecord(payload.paging) || !isRecord(payload.paging.next)) {
    return { nextAfter: null, hasMore: false };
  }

  const after =
    typeof payload.paging.next.after === "string" && payload.paging.next.after.trim().length > 0
      ? payload.paging.next.after
      : null;

  return {
    nextAfter: after,
    hasMore: after !== null,
  };
}

function getProperties(input: Record<string, unknown>, fallback: readonly string[]) {
  const selected = Array.isArray(input.properties)
    ? input.properties
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    : [];
  return selected.length > 0 ? selected : [...fallback];
}

function pickPropertyValue(item: Record<string, unknown>, key: string) {
  if (isRecord(item.properties) && typeof item.properties[key] === "string") {
    return item.properties[key].trim();
  }
  if (typeof item[key] === "string") {
    return item[key].trim();
  }
  return "";
}

function buildPortalSummary(payload: Record<string, unknown>) {
  return {
    portalId:
      pickIdentifier(payload, ["portalId", "portal_id", "hubId", "hub_id", "id"]) || null,
    companyName:
      pickString(payload, ["companyName", "company_name", "name", "portalName"]) || null,
    timeZone:
      pickString(payload, ["timeZone", "time_zone"]) || null,
    utcOffset:
      typeof payload.utc_offset === "number"
        ? payload.utc_offset
        : typeof payload.utcOffset === "number"
          ? payload.utcOffset
          : null,
    domain:
      pickString(payload, ["domain", "hubDomain", "hub_domain"]) || null,
  };
}

function buildContactSummary(item: Record<string, unknown>) {
  return {
    id: pickString(item, ["id"]),
    email: pickPropertyValue(item, "email") || null,
    firstname: pickPropertyValue(item, "firstname") || null,
    lastname: pickPropertyValue(item, "lastname") || null,
    phone: pickPropertyValue(item, "phone") || null,
    company: pickPropertyValue(item, "company") || null,
    createdAt: pickPropertyValue(item, "createdate") || null,
    updatedAt: pickPropertyValue(item, "lastmodifieddate") || null,
    archived:
      typeof item.archived === "boolean"
        ? item.archived
        : null,
  };
}

function buildCompanySummary(item: Record<string, unknown>) {
  return {
    id: pickString(item, ["id"]),
    name: pickPropertyValue(item, "name") || null,
    domain: pickPropertyValue(item, "domain") || null,
    industry: pickPropertyValue(item, "industry") || null,
    phone: pickPropertyValue(item, "phone") || null,
    city: pickPropertyValue(item, "city") || null,
    state: pickPropertyValue(item, "state") || null,
    country: pickPropertyValue(item, "country") || null,
    createdAt: pickPropertyValue(item, "createdate") || null,
    updatedAt: pickPropertyValue(item, "hs_lastmodifieddate") || null,
  };
}

function buildDealSummary(item: Record<string, unknown>) {
  return {
    id: pickString(item, ["id"]),
    dealName: pickPropertyValue(item, "dealname") || null,
    dealStage: pickPropertyValue(item, "dealstage") || null,
    pipeline: pickPropertyValue(item, "pipeline") || null,
    amount: pickPropertyValue(item, "amount") || null,
    closeDate: pickPropertyValue(item, "closedate") || null,
    createdAt: pickPropertyValue(item, "createdate") || null,
    updatedAt: pickPropertyValue(item, "hs_lastmodifieddate") || null,
  };
}

export function getHubspotCredentials(
  credentials: Record<string, unknown>,
): HubspotCredentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.accessToken) ||
    normalizeString(credentials.access_token) ||
    normalizeString(credentials.apiKey);
  if (!token) {
    return null;
  }

  const portalId = pickIdentifier(
    credentials,
    ["portalId", "hubId", "accountId", "tenantId"],
  );

  return {
    token,
    baseUrl: normalizeHubspotBaseUrl(
      normalizeString(credentials.baseUrl) ||
        normalizeString(credentials.apiBaseUrl) ||
        DEFAULT_HUBSPOT_BASE_URL,
    ),
    ...(portalId ? { portalId } : {}),
  };
}

export async function validateHubspotConnection(credentials: Record<string, unknown>) {
  const normalized = getHubspotCredentials(credentials);
  if (!normalized) {
    throw new Error("HubSpot credentials are incomplete");
  }

  const portalInfo = await hubspotRequest<Record<string, unknown>>(
    normalized,
    "/account-info/v3/details",
  );

  const portal = buildPortalSummary(portalInfo);
  if (!portal.portalId) {
    throw new Error("HubSpot validation succeeded but portal id was missing");
  }

  return {
    externalAccountId: portal.portalId,
    metadata: {
      authMode: "private_app_token",
      baseUrl: normalized.baseUrl,
      portalId: portal.portalId,
      portalName: portal.companyName,
      portalTimeZone: portal.timeZone,
      portalUtcOffset: portal.utcOffset,
      portalDomain: portal.domain,
    },
  };
}

async function listPortals(credentials: HubspotCredentials) {
  const portalInfo = await hubspotRequest<Record<string, unknown>>(
    credentials,
    "/account-info/v3/details",
  );

  const portal = buildPortalSummary(portalInfo);
  return {
    status: 200,
    body: {
      provider: "hubspot",
      action: "list_portals",
      portals: portal.portalId ? [portal] : [],
      count: portal.portalId ? 1 : 0,
      returnedCount: portal.portalId ? 1 : 0,
      hasMore: false,
      nextAfter: null,
    },
  };
}

async function listContacts(credentials: HubspotCredentials, input: Record<string, unknown>) {
  const limit = getLimit(input);
  const after = getAfter(input);
  const archived = input.includeArchived === true;
  const properties = getProperties(input, [
    "email",
    "firstname",
    "lastname",
    "phone",
    "company",
    "createdate",
    "lastmodifieddate",
  ]);

  const payload = await hubspotRequest<Record<string, unknown>>(
    credentials,
    "/crm/v3/objects/contacts",
    {
      query: {
        limit,
        ...(after ? { after } : {}),
        archived: archived ? "true" : "false",
        properties: properties.join(","),
      },
    },
  );

  const contacts = pickCollection(payload, ["results"]).map(buildContactSummary);
  const paging = parsePaging(payload);

  return {
    status: 200,
    body: {
      provider: "hubspot",
      action: "list_contacts",
      contacts,
      count: contacts.length,
      returnedCount: contacts.length,
      limit,
      hasMore: paging.hasMore,
      nextAfter: paging.nextAfter,
    },
  };
}

async function searchContacts(credentials: HubspotCredentials, input: Record<string, unknown>) {
  const limit = getLimit(input);
  const after = getAfter(input);
  const query = normalizeString(input.query);
  const properties = getProperties(input, [
    "email",
    "firstname",
    "lastname",
    "phone",
    "company",
    "createdate",
    "lastmodifieddate",
  ]);

  const payload = await hubspotRequest<Record<string, unknown>>(
    credentials,
    "/crm/v3/objects/contacts/search",
    {
      method: "POST",
      body: {
        ...(query ? { query } : {}),
        limit,
        ...(after ? { after } : {}),
        properties,
      },
    },
  );

  const contacts = pickCollection(payload, ["results"]).map(buildContactSummary);
  const paging = parsePaging(payload);

  return {
    status: 200,
    body: {
      provider: "hubspot",
      action: "search_contacts",
      contacts,
      count: contacts.length,
      returnedCount: contacts.length,
      limit,
      hasMore: paging.hasMore,
      nextAfter: paging.nextAfter,
      query: query || null,
    },
  };
}

async function listCompanies(credentials: HubspotCredentials, input: Record<string, unknown>) {
  const limit = getLimit(input);
  const after = getAfter(input);
  const archived = input.includeArchived === true;
  const properties = getProperties(input, [
    "name",
    "domain",
    "industry",
    "phone",
    "city",
    "state",
    "country",
    "createdate",
    "hs_lastmodifieddate",
  ]);

  const payload = await hubspotRequest<Record<string, unknown>>(
    credentials,
    "/crm/v3/objects/companies",
    {
      query: {
        limit,
        ...(after ? { after } : {}),
        archived: archived ? "true" : "false",
        properties: properties.join(","),
      },
    },
  );

  const companies = pickCollection(payload, ["results"]).map(buildCompanySummary);
  const paging = parsePaging(payload);

  return {
    status: 200,
    body: {
      provider: "hubspot",
      action: "list_companies",
      companies,
      count: companies.length,
      returnedCount: companies.length,
      limit,
      hasMore: paging.hasMore,
      nextAfter: paging.nextAfter,
    },
  };
}

async function listDeals(credentials: HubspotCredentials, input: Record<string, unknown>) {
  const limit = getLimit(input);
  const after = getAfter(input);
  const archived = input.includeArchived === true;
  const properties = getProperties(input, [
    "dealname",
    "dealstage",
    "pipeline",
    "amount",
    "closedate",
    "createdate",
    "hs_lastmodifieddate",
  ]);

  const payload = await hubspotRequest<Record<string, unknown>>(
    credentials,
    "/crm/v3/objects/deals",
    {
      query: {
        limit,
        ...(after ? { after } : {}),
        archived: archived ? "true" : "false",
        properties: properties.join(","),
      },
    },
  );

  const deals = pickCollection(payload, ["results"]).map(buildDealSummary);
  const paging = parsePaging(payload);

  return {
    status: 200,
    body: {
      provider: "hubspot",
      action: "list_deals",
      deals,
      count: deals.length,
      returnedCount: deals.length,
      limit,
      hasMore: paging.hasMore,
      nextAfter: paging.nextAfter,
    },
  };
}

async function getDeal(credentials: HubspotCredentials, input: Record<string, unknown>) {
  const dealId = pickString(input, ["dealId", "id", "itemId"]);
  if (!dealId) {
    throw new Error("dealId is required");
  }

  const properties = getProperties(input, [
    "dealname",
    "dealstage",
    "pipeline",
    "amount",
    "closedate",
    "createdate",
    "hs_lastmodifieddate",
  ]);

  const payload = await hubspotRequest<Record<string, unknown>>(
    credentials,
    `/crm/v3/objects/deals/${encodeURIComponent(dealId)}`,
    {
      query: {
        properties: properties.join(","),
      },
    },
  );

  return {
    status: 200,
    body: {
      provider: "hubspot",
      action: "get_deal",
      dealId,
      deal: buildDealSummary(payload),
    },
  };
}

export async function executeHubspotAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getHubspotCredentials(connection.credentials);
  if (!credentials) {
    throw new Error("HubSpot credentials are incomplete");
  }

  const payload = isRecord(input) ? input : {};

  switch (action) {
    case "list_portals":
      return listPortals(credentials);
    case "list_contacts":
      return listContacts(credentials, payload);
    case "search_contacts":
      return searchContacts(credentials, payload);
    case "list_companies":
      return listCompanies(credentials, payload);
    case "list_deals":
      return listDeals(credentials, payload);
    case "get_deal":
      return getDeal(credentials, payload);
    default:
      throw new Error(`Unsupported HubSpot action: ${action}`);
  }
}

export const normalize = normalizeHubspotBaseUrl;
export const getCredentials = getHubspotCredentials;
export const validate = validateHubspotConnection;
export const execute = executeHubspotAction;
