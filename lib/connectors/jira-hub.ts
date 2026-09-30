import { z } from "zod";
import {
  getLatestConnectionCredentialsByProvider,
  updateConnectionCredentials,
} from "@/lib/connections";
import { ConnectorHubError } from "@/lib/connectors/hub-errors";
import { tokenExpiresAtFromExpiresIn } from "@/lib/connectors/oauth-token-metadata";
import { oauthProviders } from "@/lib/oauth-providers";

const ATLASSIAN_AUTH_BASE = "https://auth.atlassian.com";
const ATLASSIAN_API_BASE = "https://api.atlassian.com";
const JIRA_HTTP_TIMEOUT_MS = 15_000;
const JIRA_HTTP_MAX_RETRIES = 1;

type JiraConnection = NonNullable<
  Awaited<ReturnType<typeof getLatestConnectionCredentialsByProvider>>
>;

type JiraActionName =
  | "list_projects"
  | "search_issues"
  | "get_issue"
  | "list_issue_comments"
  | "create_issue"
  | "list_issue_transitions"
  | "transition_issue"
  | "add_comment";

type JiraAccessibleResource = {
  id: string;
  url: string;
  name: string;
  scopes?: string[];
  avatarUrl?: string;
};

type JiraApiTokenCredentials = {
  siteUrl: string;
  email: string;
  apiToken: string;
};

type JiraOAuthContext = {
  mode: "oauth";
  accessToken: string;
  cloudId: string;
  siteName: string;
  siteUrl: string;
};

type JiraApiTokenContext = {
  mode: "api_token";
  authHeader: string;
  siteName: string;
  siteUrl: string;
};

type JiraContext = JiraOAuthContext | JiraApiTokenContext;

const jiraActionSchemas = {
  list_projects: z.object({
    maxResults: z.number().int().min(1).optional(),
    startAt: z.number().int().min(0).optional(),
    query: z.string().min(1).optional(),
    cloudId: z.string().min(1).optional(),
  }),
  search_issues: z.object({
    jql: z.string().min(1),
    maxResults: z.number().int().min(1).optional(),
    startAt: z.number().int().min(0).optional(),
    nextPageToken: z.string().min(1).optional(),
    fields: z.array(z.string().min(1)).min(1).max(50).optional(),
    cloudId: z.string().min(1).optional(),
  }),
  get_issue: z.object({
    issueIdOrKey: z.string().min(1),
    fields: z.array(z.string().min(1)).min(1).max(50).optional(),
    cloudId: z.string().min(1).optional(),
  }),
  list_issue_comments: z.object({
    issueIdOrKey: z.string().min(1),
    maxResults: z.number().int().min(1).max(100).optional(),
    startAt: z.number().int().min(0).optional(),
    cloudId: z.string().min(1).optional(),
  }),
  create_issue: z.object({
    projectKey: z.string().min(1),
    issueType: z.string().min(1),
    summary: z.string().min(1).max(255),
    description: z.string().min(1).max(20000).optional(),
    labels: z.array(z.string().min(1)).max(50).optional(),
    assigneeAccountId: z.string().min(1).optional(),
    additionalFields: z.record(z.string(), z.unknown()).optional(),
    cloudId: z.string().min(1).optional(),
  }),
  list_issue_transitions: z.object({
    issueIdOrKey: z.string().min(1),
    cloudId: z.string().min(1).optional(),
  }),
  transition_issue: z.object({
    issueIdOrKey: z.string().min(1),
    transitionId: z.string().min(1),
    comment: z.string().min(1).max(20000).optional(),
    cloudId: z.string().min(1).optional(),
  }),
  add_comment: z.object({
    issueIdOrKey: z.string().min(1),
    body: z.string().min(1).max(20000),
    cloudId: z.string().min(1).optional(),
  }),
} satisfies Record<JiraActionName, z.ZodTypeAny>;

export const jiraHubDefinition = {
  provider: "jira" as const,
  label: "Jira",
  description: "Browse projects, search issues, inspect tickets, and add comments through Jira OAuth or API token credentials.",
  actions: [
    {
      name: "list_projects",
      description: "List Jira projects available in the connected Atlassian site.",
    },
    {
      name: "search_issues",
      description: "Run JQL against the connected Jira site and return matching issues.",
    },
    {
      name: "get_issue",
      description: "Fetch a specific Jira issue by key or numeric id.",
    },
    {
      name: "list_issue_comments",
      description: "List comments for a Jira issue with pagination metadata.",
    },
    {
      name: "create_issue",
      description: "Create a Jira issue with plain-text summary and description.",
    },
    {
      name: "list_issue_transitions",
      description: "List allowed workflow transitions for a Jira issue.",
    },
    {
      name: "transition_issue",
      description: "Move a Jira issue to another workflow state and optionally add a comment.",
    },
    {
      name: "add_comment",
      description: "Post a plain-text comment into a Jira issue.",
    },
  ] as const,
};

function plainTextToAdf(text: string) {
  return {
    type: "doc",
    version: 1,
    content: text.split(/\n+/).map((paragraph) => ({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: paragraph,
        },
      ],
    })),
  };
}

function siteSummary(context: {
  cloudId?: string;
  siteName: string;
  siteUrl: string;
}) {
  return {
    cloudId: context.cloudId ?? null,
    siteName: context.siteName,
    siteUrl: context.siteUrl,
  };
}

function siteNameFromUrl(siteUrl: string) {
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return siteUrl;
  }
}

function isJiraHttpError(error: unknown): error is ConnectorHubError {
  return error instanceof ConnectorHubError && error.code === "jira_http_error";
}

function shouldFallbackToLegacyIssueSearch(error: unknown) {
  if (!isJiraHttpError(error)) return false;
  if (error.status === 404 || error.status === 405) return true;

  const payloadText = JSON.stringify(error.details ?? "").toLowerCase();
  return (
    payloadText.includes("/rest/api/3/search/jql") ||
    payloadText.includes("enhanced search") ||
    payloadText.includes("not found")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response: Response): number {
  const value = response.headers.get("retry-after");
  if (!value) return 250;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.min(parsed * 1000, 2_000);
  }
  return 250;
}

async function jiraFetch(input: URL | string, init: RequestInit, attempt = 0): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JIRA_HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal,
    });

    if (response.status === 429 && attempt < JIRA_HTTP_MAX_RETRIES) {
      const delayMs = retryAfterMs(response);
      await sleep(delayMs);
      return jiraFetch(input, init, attempt + 1);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeJiraSiteUrl(siteUrl: string) {
  const url = new URL(siteUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Jira site URL must use http or https");
  }
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`.replace(/\/+$/, "");
}

function isJiraApiTokenCredentials(
  credentials: Record<string, unknown>
): credentials is Record<string, unknown> & JiraApiTokenCredentials {
  return (
    typeof credentials.siteUrl === "string" &&
    credentials.siteUrl.length > 0 &&
    typeof credentials.email === "string" &&
    credentials.email.length > 0 &&
    typeof credentials.apiToken === "string" &&
    credentials.apiToken.length > 0
  );
}

function buildBasicAuthHeader(email: string, apiToken: string) {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

function getJiraOAuthConfig() {
  const config = oauthProviders.jira;
  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];

  if (!clientId || !clientSecret) {
    throw new ConnectorHubError("Jira OAuth is not configured on the server", {
      status: 503,
      code: "jira_oauth_not_configured",
    });
  }

  return { clientId, clientSecret };
}

function parseJiraResources(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return [] as JiraAccessibleResource[];
  const raw = metadata.accessibleResources;
  if (!Array.isArray(raw)) return [] as JiraAccessibleResource[];

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (
        typeof record.id !== "string" ||
        typeof record.url !== "string" ||
        typeof record.name !== "string"
      ) {
        return null;
      }
      return {
        id: record.id,
        url: record.url,
        name: record.name,
        scopes: Array.isArray(record.scopes)
          ? record.scopes.filter((scope): scope is string => typeof scope === "string")
          : undefined,
        avatarUrl: typeof record.avatarUrl === "string" ? record.avatarUrl : undefined,
      } satisfies JiraAccessibleResource;
    })
    .filter((item) => item !== null) as JiraAccessibleResource[];
}

function pickJiraResource(
  resources: JiraAccessibleResource[],
  metadata: Record<string, unknown> | null | undefined,
  overrideCloudId?: string
) {
  if (overrideCloudId) {
    return resources.find((resource) => resource.id === overrideCloudId) ?? null;
  }

  const defaultCloudId =
    metadata && typeof metadata.cloudId === "string" ? metadata.cloudId : null;
  if (defaultCloudId) {
    return resources.find((resource) => resource.id === defaultCloudId) ?? null;
  }

  return resources[0] ?? null;
}

async function fetchJiraAccessibleResources(
  accessToken: string
): Promise<JiraAccessibleResource[]> {
  const res = await jiraFetch(`${ATLASSIAN_AUTH_BASE}/oauth/token/accessible-resources`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text.length > 0 ? JSON.parse(text) : [];
  } catch {
    payload = null;
  }

  if (!res.ok || !Array.isArray(payload)) {
    throw new ConnectorHubError(`Jira resource discovery failed (${res.status})`, {
      status: res.status >= 400 && res.status < 500 ? res.status : 502,
      code: "jira_resource_discovery_failed",
      details: payload ?? text,
    });
  }

  return payload
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (
        typeof record.id !== "string" ||
        typeof record.url !== "string" ||
        typeof record.name !== "string"
      ) {
        return null;
      }
      return {
        id: record.id,
        url: record.url,
        name: record.name,
        scopes: Array.isArray(record.scopes)
          ? record.scopes.filter((scope): scope is string => typeof scope === "string")
          : undefined,
        avatarUrl: typeof record.avatarUrl === "string" ? record.avatarUrl : undefined,
      } satisfies JiraAccessibleResource;
    })
    .filter((item) => item !== null) as JiraAccessibleResource[];
}

function jiraErrorMessageFromPayload(payload: unknown, status: number) {
  if (typeof payload === "object" && payload) {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.errorMessages)) {
      const messages = record.errorMessages.filter(
        (item): item is string => typeof item === "string"
      );
      if (messages.length > 0) {
        return `Jira API error: ${messages.join(", ")}`;
      }
    }
    if (typeof record.message === "string" && record.message.length > 0) {
      return record.message;
    }
    if (typeof record.error === "string" && record.error.length > 0) {
      return record.error;
    }
  }

  return `Jira API request failed (${status})`;
}

async function refreshJiraAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getJiraOAuthConfig();
  const res = await jiraFetch(`${ATLASSIAN_AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = null;
  }

  if (!res.ok || !payload || typeof payload.access_token !== "string") {
    throw new ConnectorHubError(`Jira token refresh failed (${res.status})`, {
      status: res.status >= 400 && res.status < 500 ? res.status : 502,
      code: "jira_refresh_failed",
      details: payload ?? text,
    });
  }

  return payload;
}

function getJiraAccessToken(credentials: Record<string, unknown>): string | null {
  const token = credentials.access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function isTokenFresh(tokenExpiresAt: unknown) {
  if (typeof tokenExpiresAt !== "string" || tokenExpiresAt.length === 0) return true;
  const expiresAtMs = Date.parse(tokenExpiresAt);
  if (Number.isNaN(expiresAtMs)) return true;
  return expiresAtMs - Date.now() > 60_000;
}

async function ensureJiraAccessToken(connection: JiraConnection): Promise<{
  accessToken: string;
  credentials: Record<string, unknown>;
}> {
  const metadata = (connection.metadata ?? {}) as Record<string, unknown>;
  const currentAccessToken = getJiraAccessToken(connection.credentials);
  if (currentAccessToken && isTokenFresh(metadata.tokenExpiresAt)) {
    return { accessToken: currentAccessToken, credentials: connection.credentials };
  }

  const refreshToken = connection.credentials.refresh_token;
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    if (currentAccessToken) {
      return { accessToken: currentAccessToken, credentials: connection.credentials };
    }
    throw new ConnectorHubError("Jira connection is missing refresh credentials", {
      status: 401,
      code: "jira_missing_refresh_token",
    });
  }

  const refreshed = await refreshJiraAccessToken(refreshToken);
  const nextCredentials: Record<string, unknown> = {
    ...connection.credentials,
    ...refreshed,
    refresh_token:
      typeof refreshed.refresh_token === "string"
        ? refreshed.refresh_token
        : refreshToken,
  };
  const nextMetadata = {
    ...metadata,
    tokenExpiresAt: tokenExpiresAtFromExpiresIn(refreshed.expires_in) ?? metadata.tokenExpiresAt ?? null,
  };

  await updateConnectionCredentials(connection.id, connection.companyId, nextCredentials, {
    metadata: nextMetadata,
    status: "active",
    lastError: null,
  });

  if (typeof nextCredentials.access_token !== "string" || nextCredentials.access_token.length === 0) {
    throw new ConnectorHubError("Jira refresh returned no access token", {
      status: 502,
      code: "jira_refresh_missing_access_token",
    });
  }

  return { accessToken: nextCredentials.access_token, credentials: nextCredentials };
}

async function resolveJiraContext(
  connection: JiraConnection,
  overrideCloudId?: string
): Promise<JiraContext> {
  if (isJiraApiTokenCredentials(connection.credentials)) {
    const siteUrl = normalizeJiraSiteUrl(connection.credentials.siteUrl);
    const metadata = (connection.metadata ?? {}) as Record<string, unknown>;
    const authHeader = buildBasicAuthHeader(
      connection.credentials.email,
      connection.credentials.apiToken
    );

    try {
      await callJiraSiteApi<Record<string, unknown>>(
        siteUrl,
        authHeader,
        "/rest/api/3/myself"
      );
    } catch (error) {
      if (isJiraHttpError(error) && error.status === 401) {
        throw new ConnectorHubError(
          "Jira API token authentication failed. Reconnect Jira with a valid API token.",
          {
            status: 401,
            code: "jira_auth_invalid",
            details: error.details,
          }
        );
      }
      throw error;
    }

    return {
      mode: "api_token",
      authHeader,
      siteName:
        typeof metadata.siteName === "string" && metadata.siteName.length > 0
          ? metadata.siteName
          : siteNameFromUrl(siteUrl),
      siteUrl,
    };
  }

  const metadata = (connection.metadata ?? {}) as Record<string, unknown>;
  const tokenState = await ensureJiraAccessToken(connection);
  const accessToken = tokenState.accessToken;
  let resources = parseJiraResources(metadata);
  let selected = pickJiraResource(resources, metadata, overrideCloudId);

  if (resources.length === 0 || !selected) {
    resources = await fetchJiraAccessibleResources(accessToken);
    selected = pickJiraResource(resources, metadata, overrideCloudId);
    if (!selected) {
      throw new ConnectorHubError("No Jira site available for this connection", {
        status: 400,
        code: "jira_site_not_available",
      });
    }

    await updateConnectionCredentials(connection.id, connection.companyId, tokenState.credentials, {
      metadata: {
        ...metadata,
        cloudId: selected.id,
        siteName: selected.name,
        siteUrl: selected.url,
        accessibleResources: resources,
      },
    });
  }

  if (!selected) {
    throw new ConnectorHubError("No Jira site available for this connection", {
      status: 400,
      code: "jira_site_not_available",
    });
  }

  return {
    mode: "oauth",
    accessToken,
    cloudId: selected.id,
    siteName: selected.name,
    siteUrl: selected.url,
  };
}

async function callJiraOAuthApi<T>(
  accessToken: string,
  cloudId: string,
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | undefined>;
    body?: Record<string, unknown>;
  }
): Promise<T> {
  const url = new URL(`${ATLASSIAN_API_BASE}/ex/jira/${cloudId}${path}`);
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await jiraFetch(url, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!res.ok) {
    throw new ConnectorHubError(jiraErrorMessageFromPayload(payload, res.status), {
      status:
        res.status === 400 ||
        res.status === 401 ||
        res.status === 403 ||
        res.status === 404 ||
        res.status === 409 ||
        res.status === 429
          ? res.status
          : 502,
      code: "jira_http_error",
      details: payload,
    });
  }

  return payload as T;
}

async function callJiraSiteApi<T>(
  siteUrl: string,
  authHeader: string,
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | undefined>;
    body?: Record<string, unknown>;
  }
): Promise<T> {
  const url = new URL(`${siteUrl}${path}`);
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await jiraFetch(url, {
    method: options?.method ?? "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!res.ok) {
    throw new ConnectorHubError(jiraErrorMessageFromPayload(payload, res.status), {
      status:
        res.status === 400 ||
        res.status === 401 ||
        res.status === 403 ||
        res.status === 404 ||
        res.status === 409 ||
        res.status === 429
          ? res.status
          : 502,
      code: "jira_http_error",
      details: payload,
    });
  }

  return payload as T;
}

async function callJiraApi<T>(
  context: JiraContext,
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | undefined>;
    body?: Record<string, unknown>;
  }
): Promise<T> {
  if (context.mode === "oauth") {
    return callJiraOAuthApi<T>(context.accessToken, context.cloudId, path, options);
  }

  return callJiraSiteApi<T>(context.siteUrl, context.authHeader, path, options);
}

export async function resolveJiraConnectionMetadata(
  tokenResponse: Record<string, unknown>
): Promise<{ externalAccountId?: string; metadata: Record<string, unknown> }> {
  const metadata: Record<string, unknown> = {};
  const tokenExpiresAt = tokenExpiresAtFromExpiresIn(tokenResponse.expires_in);
  if (tokenExpiresAt) {
    metadata.tokenExpiresAt = tokenExpiresAt;
  }

  const accessToken =
    typeof tokenResponse.access_token === "string" ? tokenResponse.access_token : null;
  if (!accessToken) {
    return { metadata };
  }

  try {
    const resources = await fetchJiraAccessibleResources(accessToken);
    const selected = resources[0] ?? null;
    return {
      externalAccountId: selected?.id,
      metadata: {
        ...metadata,
        cloudId: selected?.id ?? null,
        siteName: selected?.name ?? null,
        siteUrl: selected?.url ?? null,
        accessibleResources: resources,
      },
    };
  } catch {
    return { metadata };
  }
}

export async function resolveJiraApiTokenConnectionMetadata(credentials: JiraApiTokenCredentials) {
  const siteUrl = normalizeJiraSiteUrl(credentials.siteUrl);
  const myself = await callJiraSiteApi<Record<string, unknown>>(
    siteUrl,
    buildBasicAuthHeader(credentials.email, credentials.apiToken),
    "/rest/api/3/myself"
  );

  return {
    externalAccountId: siteUrl,
    metadata: {
      authMode: "api_token",
      cloudId: null,
      siteUrl,
      siteName: siteNameFromUrl(siteUrl),
      userAccountId:
        typeof myself.accountId === "string" ? myself.accountId : null,
      userDisplayName:
        typeof myself.displayName === "string" ? myself.displayName : null,
      userEmail:
        typeof myself.emailAddress === "string" ? myself.emailAddress : credentials.email,
    },
  };
}

export async function executeJiraHubAction(
  connection: JiraConnection,
  action: string,
  input: unknown
) {
  const schema = jiraActionSchemas[action as JiraActionName];
  if (!schema) {
    throw new ConnectorHubError(`Unsupported Jira action: ${action}`, {
      status: 400,
      code: "unsupported_jira_action",
    });
  }

  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new ConnectorHubError("Invalid Jira action payload", {
      status: 400,
      code: "invalid_jira_payload",
      details: parsed.error.flatten(),
    });
  }

  const cloudId =
    "cloudId" in parsed.data && typeof parsed.data.cloudId === "string"
      ? parsed.data.cloudId
      : undefined;
  const context = await resolveJiraContext(connection, cloudId);

  switch (action as JiraActionName) {
    case "list_projects": {
      const data = parsed.data as z.infer<typeof jiraActionSchemas.list_projects>;
      const response = await callJiraApi<{
        values?: Array<{
          id: string;
          key: string;
          name: string;
          projectTypeKey?: string;
          simplified?: boolean;
          isPrivate?: boolean;
        }>;
        startAt?: number;
        total?: number;
        maxResults?: number;
        isLast?: boolean;
      }>(context, "/rest/api/3/project/search", {
        query: {
          maxResults: data.maxResults ?? 50,
          startAt: data.startAt ?? 0,
          query: data.query,
        },
      });

      const projects = (response.values ?? []).map((project) => ({
        id: project.id,
        key: project.key,
        name: project.name,
        projectTypeKey: project.projectTypeKey ?? null,
        simplified: project.simplified ?? false,
        isPrivate: project.isPrivate ?? false,
      }));
      const startAt = response.startAt ?? data.startAt ?? 0;
      const maxResults = response.maxResults ?? data.maxResults ?? 50;
      const total = response.total ?? null;
      const isLast =
        typeof response.isLast === "boolean"
          ? response.isLast
          : total === null
            ? null
            : startAt + projects.length >= total;
      const nextStartAt =
        isLast === true
          ? null
          : projects.length > 0
            ? startAt + projects.length
            : null;

      return {
        site: siteSummary(context),
        projects,
        total,
        returnedCount: projects.length,
        maxResults,
        startAt,
        nextStartAt,
        hasMore: nextStartAt !== null,
        isLast,
      };
    }

    case "search_issues": {
      const data = parsed.data as z.infer<typeof jiraActionSchemas.search_issues>;
      const defaultFields = data.fields ?? [
        "summary",
        "status",
        "assignee",
        "issuetype",
        "project",
      ];
      let response: {
        issues?: Array<Record<string, unknown>>;
        startAt?: number;
        total?: number;
        maxResults?: number;
        isLast?: boolean;
        nextPageToken?: string;
      };

      try {
        response = await callJiraApi<{
          issues?: Array<Record<string, unknown>>;
          startAt?: number;
          total?: number;
          maxResults?: number;
          isLast?: boolean;
          nextPageToken?: string;
        }>(context, "/rest/api/3/search/jql", {
          method: "POST",
          body: {
            jql: data.jql,
            maxResults: data.maxResults ?? 50,
            nextPageToken: data.nextPageToken,
            fields: defaultFields,
            fieldsByKeys: true,
          },
        });
      } catch (error) {
        if (!shouldFallbackToLegacyIssueSearch(error)) {
          throw error;
        }

        response = await callJiraApi<{
          issues?: Array<Record<string, unknown>>;
          startAt?: number;
          total?: number;
          maxResults?: number;
          isLast?: boolean;
          nextPageToken?: string;
        }>(context, "/rest/api/3/search", {
          method: "POST",
          body: {
            jql: data.jql,
            startAt: data.startAt ?? 0,
            maxResults: data.maxResults ?? 50,
            fields: defaultFields,
          },
        });
      }

      const issues = response.issues ?? [];
      const startAt = response.startAt ?? data.startAt ?? 0;
      const maxResults = response.maxResults ?? data.maxResults ?? 50;
      const total = response.total ?? null;
      const nextStartAt =
        typeof response.nextPageToken === "string" && response.nextPageToken.length > 0
          ? null
          : total !== null && startAt + issues.length < total
            ? startAt + issues.length
            : null;
      const hasMore =
        (typeof response.nextPageToken === "string" && response.nextPageToken.length > 0) ||
        nextStartAt !== null;
      const isLast =
        typeof response.isLast === "boolean"
          ? response.isLast
          : total === null
            ? null
            : startAt + issues.length >= total;

      return {
        site: siteSummary(context),
        issues,
        total,
        returnedCount: issues.length,
        maxResults,
        startAt,
        nextStartAt,
        hasMore,
        isLast,
        nextPageToken:
          typeof response.nextPageToken === "string" ? response.nextPageToken : null,
      };
    }

    case "get_issue": {
      const data = parsed.data as z.infer<typeof jiraActionSchemas.get_issue>;
      const response = await callJiraApi<Record<string, unknown>>(
        context,
        `/rest/api/3/issue/${encodeURIComponent(data.issueIdOrKey)}`,
        {
          query: {
            fields: data.fields?.join(","),
          },
        }
      );

      return {
        site: siteSummary(context),
        issue: response,
      };
    }

    case "list_issue_comments": {
      const data = parsed.data as z.infer<typeof jiraActionSchemas.list_issue_comments>;
      const response = await callJiraApi<{
        comments?: Array<Record<string, unknown>>;
        startAt?: number;
        total?: number;
        maxResults?: number;
      }>(
        context,
        `/rest/api/3/issue/${encodeURIComponent(data.issueIdOrKey)}/comment`,
        {
          query: {
            startAt: data.startAt ?? 0,
            maxResults: data.maxResults ?? 50,
          },
        },
      );

      const comments = response.comments ?? [];
      const startAt = response.startAt ?? data.startAt ?? 0;
      const maxResults = response.maxResults ?? data.maxResults ?? 50;
      const total = response.total ?? null;
      const nextStartAt =
        total !== null && startAt + comments.length < total
          ? startAt + comments.length
          : null;

      return {
        site: siteSummary(context),
        issueIdOrKey: data.issueIdOrKey,
        comments,
        total,
        returnedCount: comments.length,
        maxResults,
        startAt,
        nextStartAt,
        hasMore: nextStartAt !== null,
      };
    }

    case "create_issue": {
      const data = parsed.data as z.infer<typeof jiraActionSchemas.create_issue>;
      const fields: Record<string, unknown> = {
        project: { key: data.projectKey },
        issuetype: { name: data.issueType },
        summary: data.summary,
        ...(data.description ? { description: plainTextToAdf(data.description) } : {}),
        ...(data.labels ? { labels: data.labels } : {}),
        ...(data.assigneeAccountId
          ? { assignee: { accountId: data.assigneeAccountId } }
          : {}),
        ...(data.additionalFields ?? {}),
      };

      const response = await callJiraApi<Record<string, unknown>>(
        context,
        "/rest/api/3/issue",
        {
          method: "POST",
          body: { fields },
        }
      );

      return {
        site: siteSummary(context),
        issue: response,
      };
    }

    case "list_issue_transitions": {
      const data =
        parsed.data as z.infer<typeof jiraActionSchemas.list_issue_transitions>;
      const response = await callJiraApi<{
        transitions?: Array<{
          id: string;
          name: string;
          to?: {
            id?: string;
            name?: string;
            statusCategory?: { key?: string; name?: string };
          };
        }>;
      }>(context, `/rest/api/3/issue/${encodeURIComponent(data.issueIdOrKey)}/transitions`);

      return {
        site: siteSummary(context),
        issueIdOrKey: data.issueIdOrKey,
        transitions: (response.transitions ?? []).map((transition) => ({
          id: transition.id,
          name: transition.name,
          to: transition.to
            ? {
                id: transition.to.id ?? null,
                name: transition.to.name ?? null,
                statusCategoryKey: transition.to.statusCategory?.key ?? null,
                statusCategoryName: transition.to.statusCategory?.name ?? null,
              }
            : null,
        })),
      };
    }

    case "transition_issue": {
      const data = parsed.data as z.infer<typeof jiraActionSchemas.transition_issue>;
      await callJiraApi<Record<string, unknown>>(
        context,
        `/rest/api/3/issue/${encodeURIComponent(data.issueIdOrKey)}/transitions`,
        {
          method: "POST",
          body: {
            transition: { id: data.transitionId },
          },
        }
      );

      let comment: Record<string, unknown> | null = null;
      if (data.comment) {
        comment = await callJiraApi<Record<string, unknown>>(
          context,
          `/rest/api/3/issue/${encodeURIComponent(data.issueIdOrKey)}/comment`,
          {
            method: "POST",
            body: {
              body: plainTextToAdf(data.comment),
            },
          }
        );
      }

      return {
        site: siteSummary(context),
        issueIdOrKey: data.issueIdOrKey,
        transitionId: data.transitionId,
        transitioned: true,
        comment,
      };
    }

    case "add_comment": {
      const data = parsed.data as z.infer<typeof jiraActionSchemas.add_comment>;
      const response = await callJiraApi<Record<string, unknown>>(
        context,
        `/rest/api/3/issue/${encodeURIComponent(data.issueIdOrKey)}/comment`,
        {
          method: "POST",
          body: {
            body: plainTextToAdf(data.body),
          },
        }
      );

      return {
        site: siteSummary(context),
        comment: response,
      };
    }
  }

  throw new ConnectorHubError(`Unsupported Jira action: ${action}`, {
    status: 400,
    code: "unsupported_jira_action",
  });
}
