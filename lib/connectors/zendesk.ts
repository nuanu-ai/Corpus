import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_ZENDESK_PAGE_SIZE = 25;
const ZENDESK_TIMEOUT_MS = 15_000;

export type ZendeskCredentials = {
  subdomain: string;
  email: string;
  apiToken: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeZendeskSubdomain(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error("subdomain must contain only letters, numbers, or hyphens");
  }
  return normalized;
}

export function getZendeskCredentials(
  credentials: Record<string, unknown>,
): ZendeskCredentials | null {
  const subdomainRaw = normalizeString(credentials.subdomain);
  const email = normalizeString(credentials.email);
  const apiToken = normalizeString(credentials.apiToken);
  if (!subdomainRaw || !email || !apiToken) {
    return null;
  }

  return {
    subdomain: normalizeZendeskSubdomain(subdomainRaw),
    email,
    apiToken,
  };
}

function zendeskBaseUrl(subdomain: string) {
  return `https://${subdomain}.zendesk.com/api/v2`;
}

function zendeskAuthHeader(email: string, apiToken: string) {
  return `Basic ${Buffer.from(`${email}/token:${apiToken}`).toString("base64")}`;
}

async function zendeskRequest<T>(
  credentials: ZendeskCredentials,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`${zendeskBaseUrl(credentials.subdomain)}${path}`);
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
        Authorization: zendeskAuthHeader(credentials.email, credentials.apiToken),
      },
      cache: "no-store",
    },
    {
      timeoutMs: ZENDESK_TIMEOUT_MS,
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
    const errorMessage =
      payload &&
      typeof payload === "object" &&
      "error" in (payload as Record<string, unknown>) &&
      typeof (payload as Record<string, unknown>).error === "string"
        ? ((payload as Record<string, unknown>).error as string)
        : `Zendesk request failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_ZENDESK_PAGE_SIZE, max = 100) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), max);
}

function getPage(input: Record<string, unknown>): number {
  if (typeof input.page !== "number" || !Number.isInteger(input.page)) {
    return 1;
  }
  return Math.max(input.page, 1);
}

function getPageAfter(input: Record<string, unknown>): string | null {
  return typeof input.pageAfter === "string" && input.pageAfter.trim().length > 0
    ? input.pageAfter.trim()
    : null;
}

function extractZendeskCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.value === "number" && Number.isFinite(record.value)) {
    return record.value;
  }
  return null;
}

function extractZendeskCursorMeta(result: Record<string, unknown>) {
  const meta = result.meta && typeof result.meta === "object"
    ? (result.meta as Record<string, unknown>)
    : null;
  const links = result.links && typeof result.links === "object"
    ? (result.links as Record<string, unknown>)
    : null;
  const hasMore =
    meta && typeof meta.has_more === "boolean"
      ? meta.has_more
      : links && typeof links.next === "string"
        ? links.next.length > 0
        : false;
  const afterCursor =
    meta && typeof meta.after_cursor === "string"
      ? meta.after_cursor
      : links && typeof links.after === "string"
        ? links.after
        : null;
  const nextPage =
    links && typeof links.next === "string" ? links.next : null;

  return {
    hasMore,
    afterCursor,
    nextPage,
  };
}

function getHelpCenterPath(
  resource: "categories" | "sections" | "articles",
  locale: string,
) {
  return locale
    ? `/help_center/${encodeURIComponent(locale)}/${resource}.json`
    : `/help_center/${resource}.json`;
}

export async function validateZendeskConnection(credentials: Record<string, unknown>) {
  const normalized = getZendeskCredentials(credentials);
  if (!normalized) {
    throw new Error("Zendesk credentials are incomplete");
  }

  const me = await zendeskRequest<{ user?: Record<string, unknown> }>(
    normalized,
    "/users/me.json",
  );

  return {
    externalAccountId:
      me.user && typeof me.user.id !== "undefined" ? String(me.user.id) : normalized.subdomain,
    metadata: {
      subdomain: normalized.subdomain,
      currentUserEmail:
        me.user && typeof me.user.email === "string" ? me.user.email : normalized.email,
      currentUserName:
        me.user && typeof me.user.name === "string" ? me.user.name : null,
    },
  };
}

export async function executeZendeskAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getZendeskCredentials(connection.credentials);
  if (!credentials) {
    return {
      status: 400,
      body: { error: "Zendesk credentials are incomplete" },
    };
  }

  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  if (action === "list_tickets") {
    const query =
      typeof payload.query === "string" && payload.query.trim().length > 0
        ? payload.query.trim()
        : "";
    const status =
      typeof payload.status === "string" && payload.status.trim().length > 0
        ? payload.status.trim()
        : "";
    const limit = getLimit(payload);
    const page = getPage(payload);
    const pageAfter = getPageAfter(payload);

    if (query || status) {
      const searchQuery = [query, status ? `status:${status}` : "", "type:ticket"]
        .filter(Boolean)
        .join(" ");
      const result = await zendeskRequest<{
        results?: Array<Record<string, unknown>>;
        count?: number;
        next_page?: string | null;
        previous_page?: string | null;
      }>(
        credentials,
        "/search.json",
        {
          query: searchQuery,
          per_page: limit,
          page,
        },
      );
      const tickets = Array.isArray(result.results) ? result.results : [];
      const totalCount = extractZendeskCount(result.count);
      return {
        status: 200,
        body: {
          provider: "zendesk",
          action,
          count: tickets.length,
          totalCount,
          returnedCount: tickets.length,
          limit,
          page,
          hasMore: typeof result.next_page === "string" && result.next_page.length > 0,
          nextPage: typeof result.next_page === "string" ? result.next_page : null,
          tickets,
        },
      };
    }

    const result = await zendeskRequest<{
      tickets?: Array<Record<string, unknown>>;
      count?: number | { value?: number };
      meta?: Record<string, unknown>;
      links?: Record<string, unknown>;
    }>(
      credentials,
      "/tickets.json",
      {
        "page[size]": limit,
        "page[after]": pageAfter ?? undefined,
      },
    );
    const tickets = Array.isArray(result.tickets) ? result.tickets : [];
    const cursorMeta = extractZendeskCursorMeta(result);
    const totalCount = extractZendeskCount(result.count);
    return {
      status: 200,
      body: {
        provider: "zendesk",
        action,
        count: tickets.length,
        totalCount,
        returnedCount: tickets.length,
        limit,
        pageAfter,
        hasMore: cursorMeta.hasMore,
        nextPageAfter: cursorMeta.afterCursor,
        nextPage: cursorMeta.nextPage,
        tickets,
      },
    };
  }

  if (action === "get_ticket") {
    const ticketId =
      typeof payload.ticketId === "string" || typeof payload.ticketId === "number"
        ? String(payload.ticketId).trim()
        : "";
    if (!ticketId) {
      return {
        status: 400,
        body: { error: "input.ticketId is required" },
      };
    }
    const result = await zendeskRequest<{ ticket?: Record<string, unknown> }>(
      credentials,
      `/tickets/${encodeURIComponent(ticketId)}.json`,
    );
    return {
      status: 200,
      body: {
        provider: "zendesk",
        action,
        ticketId,
        ticket: result.ticket ?? null,
      },
    };
  }

  if (action === "get_ticket_comments") {
    const ticketId =
      typeof payload.ticketId === "string" || typeof payload.ticketId === "number"
        ? String(payload.ticketId).trim()
        : "";
    if (!ticketId) {
      return {
        status: 400,
        body: { error: "input.ticketId is required" },
      };
    }
    const result = await zendeskRequest<{ comments?: Array<Record<string, unknown>> }>(
      credentials,
      `/tickets/${encodeURIComponent(ticketId)}/comments.json`,
    );
    const comments = Array.isArray(result.comments) ? result.comments : [];
    return {
      status: 200,
      body: {
        provider: "zendesk",
        action,
        ticketId,
        count: comments.length,
        returnedCount: comments.length,
        comments,
      },
    };
  }

  if (action === "get_ticket_audits") {
    const ticketId =
      typeof payload.ticketId === "string" || typeof payload.ticketId === "number"
        ? String(payload.ticketId).trim()
        : "";
    if (!ticketId) {
      return {
        status: 400,
        body: { error: "input.ticketId is required" },
      };
    }
    const result = await zendeskRequest<{ audits?: Array<Record<string, unknown>> }>(
      credentials,
      `/tickets/${encodeURIComponent(ticketId)}/audits.json`,
    );
    const audits = Array.isArray(result.audits) ? result.audits : [];
    return {
      status: 200,
      body: {
        provider: "zendesk",
        action,
        ticketId,
        count: audits.length,
        returnedCount: audits.length,
        audits,
      },
    };
  }

  if (action === "list_users") {
    const query =
      typeof payload.query === "string" && payload.query.trim().length > 0
        ? payload.query.trim()
        : "";
    const limit = getLimit(payload);
    const page = getPage(payload);
    const pageAfter = getPageAfter(payload);
    const result = query
      ? await zendeskRequest<{
          users?: Array<Record<string, unknown>>;
          count?: number;
          next_page?: string | null;
          previous_page?: string | null;
        }>(
          credentials,
          "/users/search.json",
          { query, per_page: limit, page },
        )
      : await zendeskRequest<{
          users?: Array<Record<string, unknown>>;
          count?: number | { value?: number };
          meta?: Record<string, unknown>;
          links?: Record<string, unknown>;
        }>(
          credentials,
          "/users.json",
          { "page[size]": limit, "page[after]": pageAfter ?? undefined },
        );
    const users = Array.isArray(result.users) ? result.users : [];
    const cursorMeta = extractZendeskCursorMeta(
      result as Record<string, unknown>,
    );
    const totalCount = extractZendeskCount(
      (result as Record<string, unknown>).count,
    );
    return {
      status: 200,
      body: {
        provider: "zendesk",
        action,
        count: users.length,
        totalCount,
        returnedCount: users.length,
        limit,
        ...(query
          ? {
              page,
              hasMore:
                typeof (result as { next_page?: string | null }).next_page === "string" &&
                ((result as { next_page?: string | null }).next_page?.length ?? 0) > 0,
              nextPage:
                typeof (result as { next_page?: string | null }).next_page === "string"
                  ? (result as { next_page?: string | null }).next_page ?? null
                  : null,
            }
          : {
              pageAfter,
              hasMore: cursorMeta.hasMore,
              nextPageAfter: cursorMeta.afterCursor,
              nextPage: cursorMeta.nextPage,
            }),
        users,
      },
    };
  }

  if (action === "list_organizations") {
    const query =
      typeof payload.query === "string" && payload.query.trim().length > 0
        ? payload.query.trim()
        : "";
    const limit = getLimit(payload);
    const page = getPage(payload);
    const pageAfter = getPageAfter(payload);
    const result = query
      ? await zendeskRequest<{
          organizations?: Array<Record<string, unknown>>;
          count?: number;
          next_page?: string | null;
        }>(
          credentials,
          "/organizations/search.json",
          { name: query, per_page: limit, page },
        )
      : await zendeskRequest<{
          organizations?: Array<Record<string, unknown>>;
          count?: number | { value?: number };
          meta?: Record<string, unknown>;
          links?: Record<string, unknown>;
        }>(
          credentials,
          "/organizations.json",
          { "page[size]": limit, "page[after]": pageAfter ?? undefined },
        );
    const organizations = Array.isArray(result.organizations) ? result.organizations : [];
    const cursorMeta = extractZendeskCursorMeta(result as Record<string, unknown>);
    const totalCount = extractZendeskCount((result as Record<string, unknown>).count);
    return {
      status: 200,
      body: {
        provider: "zendesk",
        action,
        count: organizations.length,
        totalCount,
        returnedCount: organizations.length,
        limit,
        ...(query
          ? {
              page,
              hasMore:
                typeof (result as { next_page?: string | null }).next_page === "string" &&
                ((result as { next_page?: string | null }).next_page?.length ?? 0) > 0,
              nextPage:
                typeof (result as { next_page?: string | null }).next_page === "string"
                  ? (result as { next_page?: string | null }).next_page ?? null
                  : null,
            }
          : {
              pageAfter,
              hasMore: cursorMeta.hasMore,
              nextPageAfter: cursorMeta.afterCursor,
              nextPage: cursorMeta.nextPage,
            }),
        organizations,
      },
    };
  }

  if (action === "list_views") {
    const limit = getLimit(payload);
    const page = getPage(payload);
    const result = await zendeskRequest<{
      views?: Array<Record<string, unknown>>;
      count?: number;
      next_page?: string | null;
    }>(
      credentials,
      "/views.json",
      { per_page: limit, page },
    );
    const views = Array.isArray(result.views) ? result.views : [];
    const totalCount = extractZendeskCount(result.count);
    return {
      status: 200,
      body: {
        provider: "zendesk",
        action,
        count: views.length,
        totalCount,
        returnedCount: views.length,
        limit,
        page,
        hasMore: typeof result.next_page === "string" && result.next_page.length > 0,
        nextPage: typeof result.next_page === "string" ? result.next_page : null,
        views,
      },
    };
  }

  if (action === "list_macros") {
    const limit = getLimit(payload);
    const page = getPage(payload);
    const result = await zendeskRequest<{
      macros?: Array<Record<string, unknown>>;
      count?: number;
      next_page?: string | null;
    }>(
      credentials,
      "/macros.json",
      { per_page: limit, page },
    );
    const macros = Array.isArray(result.macros) ? result.macros : [];
    const totalCount = extractZendeskCount(result.count);
    return {
      status: 200,
      body: {
        provider: "zendesk",
        action,
        count: macros.length,
        totalCount,
        returnedCount: macros.length,
        limit,
        page,
        hasMore: typeof result.next_page === "string" && result.next_page.length > 0,
        nextPage: typeof result.next_page === "string" ? result.next_page : null,
        macros,
      },
    };
  }

  if (
    action === "list_help_center_categories" ||
    action === "list_help_center_sections" ||
    action === "list_help_center_articles"
  ) {
    const limit = getLimit(payload);
    const page = getPage(payload);
    const locale =
      typeof payload.locale === "string" && payload.locale.trim().length > 0
        ? payload.locale.trim()
        : "";
    const resource =
      action === "list_help_center_categories"
        ? "categories"
        : action === "list_help_center_sections"
          ? "sections"
          : "articles";
    const result = await zendeskRequest<{
      categories?: Array<Record<string, unknown>>;
      sections?: Array<Record<string, unknown>>;
      articles?: Array<Record<string, unknown>>;
      count?: number;
      next_page?: string | null;
    }>(
      credentials,
      getHelpCenterPath(resource, locale),
      { per_page: limit, page },
    );
    const key =
      resource === "categories"
        ? "categories"
        : resource === "sections"
          ? "sections"
          : "articles";
    const records = Array.isArray(result[key]) ? result[key] : [];
    const totalCount = extractZendeskCount(result.count);
    return {
      status: 200,
      body: {
        provider: "zendesk",
        action,
        count: records.length,
        totalCount,
        returnedCount: records.length,
        limit,
        page,
        locale: locale || null,
        hasMore: typeof result.next_page === "string" && result.next_page.length > 0,
        nextPage: typeof result.next_page === "string" ? result.next_page : null,
        [key]: records,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported zendesk action: ${action}` },
  };
}
