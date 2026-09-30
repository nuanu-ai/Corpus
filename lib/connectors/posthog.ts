import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_POSTHOG_BASE_URL = "https://app.posthog.com";
const POSTHOG_TIMEOUT_MS = 15_000;
const DEFAULT_POSTHOG_LIMIT = 25;
const MAX_POSTHOG_LIMIT = 100;

export type PosthogCredentials = {
  token: string;
  baseUrl: string;
  organizationId?: string;
  projectId?: string;
};

type PosthogRequestScope = "root" | "organization" | "project";

type PosthogBaseParts = {
  apiRoot: string;
  projectBase: string | null;
  projectIdFromBase: string | null;
  organizationBase: string | null;
  organizationIdFromBase: string | null;
};

type PosthogPagination = {
  count: number | null;
  hasMore: boolean;
  nextOffset: number | null;
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
    return DEFAULT_POSTHOG_BASE_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PostHog base URL must use http or https");
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function normalizePosthogBaseUrl(baseUrl: string) {
  return normalizeUrl(baseUrl);
}

function parsePosthogBaseParts(baseUrl: string): PosthogBaseParts {
  const url = new URL(normalizePosthogBaseUrl(baseUrl));
  const pathname = url.pathname.replace(/\/+$/, "");
  const apiIndex = pathname.toLowerCase().indexOf("/api");
  const pathPrefix = apiIndex >= 0 ? pathname.slice(0, apiIndex) : pathname;
  const apiRoot = `${url.origin}${pathPrefix || ""}/api`.replace(/\/+$/, "");

  const projectMatch = pathname.match(/^(.*)\/api\/projects\/([^/]+)$/i);
  const organizationMatch = pathname.match(/^(.*)\/api\/organizations\/([^/]+)$/i);

  return {
    apiRoot,
    projectBase: projectMatch
      ? `${url.origin}${projectMatch[1]}/api/projects/${projectMatch[2]}`
      : null,
    projectIdFromBase: projectMatch ? decodeURIComponent(projectMatch[2]) : null,
    organizationBase: organizationMatch
      ? `${url.origin}${organizationMatch[1]}/api/organizations/${organizationMatch[2]}`
      : null,
    organizationIdFromBase: organizationMatch ? decodeURIComponent(organizationMatch[2]) : null,
  };
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

function pickId(input: Record<string, unknown>, keys: readonly string[]) {
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

function pickCollection(
  payload: unknown,
  keys: readonly string[],
): Array<Record<string, unknown>> {
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

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_POSTHOG_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_POSTHOG_LIMIT);
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

function posthogHeaders(token: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function getPosthogErrorMessage(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "PostHog authentication failed. Reconnect PostHog with a valid personal API key.";
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }

  if (isRecord(payload)) {
    const message = payload.detail ?? payload.message ?? payload.error;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
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

  return `PostHog request failed (${status})`;
}

function resolveScopedBaseUrl(
  baseUrl: string,
  scope: PosthogRequestScope,
  context?: {
    organizationId?: string;
    projectId?: string;
  },
) {
  const parts = parsePosthogBaseParts(baseUrl);

  if (scope === "root") {
    return parts.apiRoot;
  }

  if (scope === "organization") {
    const organizationId =
      context?.organizationId ||
      parts.organizationIdFromBase ||
      "";
    if (parts.organizationBase && (!organizationId || organizationId === parts.organizationIdFromBase)) {
      return parts.organizationBase;
    }
    if (organizationId) {
      return `${parts.apiRoot}/organizations/${encodeURIComponent(organizationId)}`;
    }
    return parts.apiRoot;
  }

  const projectId =
    context?.projectId ||
    parts.projectIdFromBase ||
    "";
  if (parts.projectBase && (!projectId || projectId === parts.projectIdFromBase)) {
    return parts.projectBase;
  }
  if (projectId) {
    return `${parts.apiRoot}/projects/${encodeURIComponent(projectId)}`;
  }
  return parts.projectBase ?? parts.apiRoot;
}

async function posthogRequest<T>(
  credentials: PosthogCredentials,
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    scope?: PosthogRequestScope;
    organizationId?: string;
    projectId?: string;
  },
): Promise<T> {
  const scope = options?.scope ?? "root";
  const baseUrl = resolveScopedBaseUrl(credentials.baseUrl, scope, {
    organizationId: options?.organizationId,
    projectId: options?.projectId,
  });
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
      headers: posthogHeaders(credentials.token),
      body:
        options?.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      cache: "no-store",
    },
    {
      timeoutMs: POSTHOG_TIMEOUT_MS,
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
    throw new Error(getPosthogErrorMessage(response.status, payload));
  }

  return payload as T;
}

function getPosthogActionContext(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  input: Record<string, unknown>,
) {
  const credentials = getPosthogCredentials(connection.credentials);
  if (!credentials) {
    return null;
  }

  const metadata = connection.metadata ?? {};
  const projectId =
    pickString(input, ["projectId", "project_id"]) ||
    pickString(metadata, ["defaultProjectId", "projectId", "project_id"]) ||
    credentials.projectId ||
    "";
  const organizationId =
    pickString(input, ["organizationId", "organization_id"]) ||
    pickString(metadata, ["defaultOrganizationId", "organizationId", "organization_id"]) ||
    credentials.organizationId ||
    "";

  return {
    credentials,
    projectId,
    organizationId,
  };
}

function mapProjectToEnvironment(project: Record<string, unknown>) {
  const id = pickId(project, ["id", "project_id", "projectId", "uuid"]);
  const name =
    pickString(project, ["name", "project_name", "slug", "label"]) ||
    (id ? `Project ${id}` : "Project");

  return {
    id: id || name,
    name,
    projectId: id || null,
    organizationId:
      pickString(project, ["organization_id", "organizationId", "org_id"]) || null,
    slug: pickString(project, ["slug"]) || null,
    isDefault:
      project.is_default === true || project.is_default_project === true || false,
  };
}

export function getPosthogCredentials(
  credentials: Record<string, unknown>,
): PosthogCredentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.apiKey) ||
    normalizeString(credentials.bearerToken) ||
    normalizeString(credentials.personalApiKey);

  const baseUrlRaw =
    normalizeString(credentials.baseUrl) ||
    normalizeString(credentials.apiBaseUrl) ||
    normalizeString(credentials.siteUrl);

  if (!token || !baseUrlRaw) {
    return null;
  }

  const normalized = normalizePosthogBaseUrl(baseUrlRaw);
  const organizationId =
    normalizeString(credentials.organizationId) ||
    normalizeString(credentials.defaultOrganizationId) ||
    normalizeString(credentials.projectOrganizationId);
  const projectId =
    normalizeString(credentials.projectId) ||
    normalizeString(credentials.defaultProjectId) ||
    normalizeString(credentials.project_id);

  return {
    token,
    baseUrl: normalized,
    ...(organizationId ? { organizationId } : {}),
    ...(projectId ? { projectId } : {}),
  };
}

export async function validatePosthogConnection(credentials: Record<string, unknown>) {
  const normalized = getPosthogCredentials(credentials);
  if (!normalized) {
    throw new Error("PostHog credentials are incomplete");
  }

  const projectsResult = await posthogRequest<Record<string, unknown>>(
    normalized,
    "/projects/",
    {
      scope: "root",
    },
  );
  const projects = pickCollection(projectsResult, [
    "projects",
    "results",
    "items",
    "data",
  ]);
  const organizations = await (async () => {
    try {
      const organizationResult = await posthogRequest<Record<string, unknown>>(
        normalized,
        "/organizations/",
        {
          scope: "root",
        },
      );
      return pickCollection(organizationResult, [
        "organizations",
        "results",
        "items",
        "data",
      ]);
    } catch {
      return [];
    }
  })();

  const defaultProject = projects[0] ?? null;
  const defaultOrganization = organizations[0] ?? null;
  const defaultProjectId = defaultProject ? pickId(defaultProject, ["id", "project_id", "uuid"]) : "";
  const defaultOrganizationId = defaultOrganization
    ? pickId(defaultOrganization, ["id", "organization_id", "uuid"])
    : pickString(defaultProject ?? {}, ["organization_id", "organizationId", "org_id"]);

  return {
    externalAccountId:
      defaultProjectId ||
      defaultOrganizationId ||
      normalized.projectId ||
      normalized.organizationId ||
      normalized.baseUrl,
    metadata: {
      authMode: "personal_api_key",
      baseUrl: normalized.baseUrl,
      accessibleProjectCount: projects.length,
      accessibleOrganizationCount: organizations.length,
      defaultProjectId: defaultProjectId || null,
      defaultProjectName: defaultProject
        ? pickString(defaultProject, ["name", "project_name", "slug"]) || null
        : null,
      defaultOrganizationId: defaultOrganizationId || null,
      defaultOrganizationName: defaultOrganization
        ? pickString(defaultOrganization, ["name", "organization_name", "slug"]) || null
        : null,
      projectId: normalized.projectId ?? null,
      organizationId: normalized.organizationId ?? null,
    },
  };
}

async function listPosthogProjects(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  input: Record<string, unknown>,
) {
  const context = getPosthogActionContext(connection, input);
  if (!context) {
    return null;
  }

  const limit = getLimit(input);
  const offset = getOffset(input, limit);

  try {
    return await posthogRequest<Record<string, unknown>>(context.credentials, "/projects/", {
      scope: "root",
      query: {
        limit,
        offset,
      },
    });
  } catch (error) {
    if (!context.organizationId) {
      throw error;
    }
    return posthogRequest<Record<string, unknown>>(
      context.credentials,
      "/projects/",
      {
        scope: "organization",
        organizationId: context.organizationId,
        query: {
          limit,
          offset,
        },
      },
    );
  }
}

function stringifyResponseArray(
  items: Array<Record<string, unknown>>,
  keys: readonly string[],
) {
  return items.map((item) => {
    const normalized = { ...item };
    for (const key of keys) {
      const value = normalized[key];
      if (value === undefined) {
        continue;
      }
      normalized[key] = value;
    }
    return normalized;
  });
}

function buildListResponse(
  provider: string,
  action: string,
  items: Array<Record<string, unknown>>,
  limit: number,
  offset: number,
  totalCount?: number | null,
) {
  const count = typeof totalCount === "number" && Number.isFinite(totalCount)
    ? totalCount
    : items.length;
  const returnedCount = items.length;
  const hasMore = returnedCount + offset < count;

  return {
    status: 200,
    body: {
      provider,
      action,
      count,
      returnedCount,
      limit,
      offset,
      hasMore,
      nextOffset: hasMore ? offset + returnedCount : null,
    },
  };
}

function extractCount(payload: unknown, items: Array<Record<string, unknown>>) {
  if (isRecord(payload)) {
    const count =
      payload.count ?? payload.total_count ?? payload.totalCount ?? payload.total;
    if (typeof count === "number" && Number.isFinite(count)) {
      return count;
    }
  }
  return items.length;
}

export async function executePosthogAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const payload = isRecord(input) ? input : {};
  const context = getPosthogActionContext(connection, payload);

  if (!context) {
    return {
      status: 400,
      body: { error: "PostHog credentials are incomplete" },
    };
  }

  if (action === "list_organizations") {
    const organizationsResult = await posthogRequest<Record<string, unknown>>(
      context.credentials,
      "/organizations/",
      {
        scope: "root",
        query: {
          limit: getLimit(payload),
          offset: getOffset(payload, getLimit(payload)),
        },
      },
    );
    const organizations = pickCollection(organizationsResult, [
      "organizations",
      "results",
      "items",
      "data",
    ]);
    const limit = getLimit(payload);
    const offset = getOffset(payload, limit);

    return {
      status: 200,
      body: {
        provider: "posthog",
        action,
        organizations,
        count: extractCount(organizationsResult, organizations),
        returnedCount: organizations.length,
        limit,
        offset,
        hasMore:
          extractCount(organizationsResult, organizations) > offset + organizations.length,
        nextOffset:
          extractCount(organizationsResult, organizations) > offset + organizations.length
            ? offset + organizations.length
            : null,
      },
    };
  }

  if (action === "list_projects") {
    const projectsResult = await listPosthogProjects(connection, payload);
    if (!projectsResult) {
      return {
        status: 400,
        body: { error: "PostHog credentials are incomplete" },
      };
    }

    const projects = pickCollection(projectsResult, [
      "projects",
      "results",
      "items",
      "data",
    ]);
    const limit = getLimit(payload);
    const offset = getOffset(payload, limit);

    return {
      status: 200,
      body: {
        provider: "posthog",
        action,
        projects,
        count: extractCount(projectsResult, projects),
        returnedCount: projects.length,
        limit,
        offset,
        hasMore:
          extractCount(projectsResult, projects) > offset + projects.length,
        nextOffset:
          extractCount(projectsResult, projects) > offset + projects.length
            ? offset + projects.length
            : null,
      },
    };
  }

  if (action === "get_project") {
    const projectId =
      pickString(payload, ["projectId", "project_id", "id", "slug"]) ||
      context.projectId ||
      pickString(connection.metadata ?? {}, ["defaultProjectId", "projectId"]);
    if (!projectId) {
      return {
        status: 400,
        body: { error: "projectId is required" },
      };
    }

    const project = await posthogRequest<Record<string, unknown>>(
      context.credentials,
      `/projects/${encodeURIComponent(projectId)}/`,
      {
        scope: "project",
        projectId,
      },
    );

    return {
      status: 200,
      body: {
        provider: "posthog",
        action,
        projectId,
        project,
      },
    };
  }

  if (action === "list_environments") {
    const projectsResult = await listPosthogProjects(connection, payload);
    if (!projectsResult) {
      return {
        status: 400,
        body: { error: "PostHog credentials are incomplete" },
      };
    }

    const projects = pickCollection(projectsResult, [
      "projects",
      "results",
      "items",
      "data",
    ]);
    const environments = stringifyResponseArray(
      projects.map(mapProjectToEnvironment),
      ["id", "name", "projectId", "organizationId", "slug", "isDefault"],
    );
    const limit = getLimit(payload);
    const offset = getOffset(payload, limit);
    const totalCount = extractCount(projectsResult, projects);
    const hasMore = totalCount > offset + environments.length;

    return {
      status: 200,
      body: {
        provider: "posthog",
        action,
        environments,
        count: totalCount,
        returnedCount: environments.length,
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + environments.length : null,
      },
    };
  }

  if (action === "list_dashboards") {
    const projectId =
      pickString(payload, ["projectId", "project_id"]) ||
      context.projectId ||
      pickString(connection.metadata ?? {}, ["defaultProjectId", "projectId"]);
    if (!projectId) {
      return {
        status: 400,
        body: { error: "projectId is required" },
      };
    }

    const dashboardsResult = await posthogRequest<Record<string, unknown>>(
      context.credentials,
      "/dashboards/",
      {
        scope: "project",
        projectId,
        query: {
          limit: getLimit(payload),
          offset: getOffset(payload, getLimit(payload)),
        },
      },
    );
    const dashboards = pickCollection(dashboardsResult, [
      "dashboards",
      "results",
      "items",
      "data",
    ]);
    const limit = getLimit(payload);
    const offset = getOffset(payload, limit);

    return {
      status: 200,
      body: {
        provider: "posthog",
        action,
        projectId,
        dashboards,
        count: extractCount(dashboardsResult, dashboards),
        returnedCount: dashboards.length,
        limit,
        offset,
        hasMore: extractCount(dashboardsResult, dashboards) > offset + dashboards.length,
        nextOffset:
          extractCount(dashboardsResult, dashboards) > offset + dashboards.length
            ? offset + dashboards.length
            : null,
      },
    };
  }

  if (action === "get_dashboard") {
    const projectId =
      pickString(payload, ["projectId", "project_id"]) ||
      context.projectId ||
      pickString(connection.metadata ?? {}, ["defaultProjectId", "projectId"]);
    const dashboardId = pickString(payload, ["dashboardId", "dashboard_id", "id", "slug"]);
    if (!projectId) {
      return {
        status: 400,
        body: { error: "projectId is required" },
      };
    }
    if (!dashboardId) {
      return {
        status: 400,
        body: { error: "dashboardId is required" },
      };
    }

    const dashboard = await posthogRequest<Record<string, unknown>>(
      context.credentials,
      `/dashboards/${encodeURIComponent(dashboardId)}/`,
      {
        scope: "project",
        projectId,
      },
    );

    return {
      status: 200,
      body: {
        provider: "posthog",
        action,
        projectId,
        dashboardId,
        dashboard,
      },
    };
  }

  if (action === "list_insights") {
    const projectId =
      pickString(payload, ["projectId", "project_id"]) ||
      context.projectId ||
      pickString(connection.metadata ?? {}, ["defaultProjectId", "projectId"]);
    if (!projectId) {
      return {
        status: 400,
        body: { error: "projectId is required" },
      };
    }

    const insightsResult = await posthogRequest<Record<string, unknown>>(
      context.credentials,
      "/insights/",
      {
        scope: "project",
        projectId,
        query: {
          limit: getLimit(payload),
          offset: getOffset(payload, getLimit(payload)),
        },
      },
    );
    const insights = pickCollection(insightsResult, [
      "insights",
      "results",
      "items",
      "data",
    ]);
    const limit = getLimit(payload);
    const offset = getOffset(payload, limit);

    return {
      status: 200,
      body: {
        provider: "posthog",
        action,
        projectId,
        insights,
        count: extractCount(insightsResult, insights),
        returnedCount: insights.length,
        limit,
        offset,
        hasMore: extractCount(insightsResult, insights) > offset + insights.length,
        nextOffset:
          extractCount(insightsResult, insights) > offset + insights.length
            ? offset + insights.length
            : null,
      },
    };
  }

  if (action === "get_insight") {
    const projectId =
      pickString(payload, ["projectId", "project_id"]) ||
      context.projectId ||
      pickString(connection.metadata ?? {}, ["defaultProjectId", "projectId"]);
    const insightId = pickString(payload, ["insightId", "insight_id", "id", "slug"]);
    if (!projectId) {
      return {
        status: 400,
        body: { error: "projectId is required" },
      };
    }
    if (!insightId) {
      return {
        status: 400,
        body: { error: "insightId is required" },
      };
    }

    const insight = await posthogRequest<Record<string, unknown>>(
      context.credentials,
      `/insights/${encodeURIComponent(insightId)}/`,
      {
        scope: "project",
        projectId,
      },
    );

    return {
      status: 200,
      body: {
        provider: "posthog",
        action,
        projectId,
        insightId,
        insight,
      },
    };
  }

  if (action === "list_feature_flags") {
    const projectId =
      pickString(payload, ["projectId", "project_id"]) ||
      context.projectId ||
      pickString(connection.metadata ?? {}, ["defaultProjectId", "projectId"]);
    if (!projectId) {
      return {
        status: 400,
        body: { error: "projectId is required" },
      };
    }

    const flagsResult = await posthogRequest<Record<string, unknown>>(
      context.credentials,
      "/feature_flags/",
      {
        scope: "project",
        projectId,
        query: {
          limit: getLimit(payload),
          offset: getOffset(payload, getLimit(payload)),
        },
      },
    );
    const featureFlags = pickCollection(flagsResult, [
      "feature_flags",
      "featureFlags",
      "results",
      "items",
      "data",
    ]);
    const limit = getLimit(payload);
    const offset = getOffset(payload, limit);

    return {
      status: 200,
      body: {
        provider: "posthog",
        action,
        projectId,
        featureFlags,
        count: extractCount(flagsResult, featureFlags),
        returnedCount: featureFlags.length,
        limit,
        offset,
        hasMore: extractCount(flagsResult, featureFlags) > offset + featureFlags.length,
        nextOffset:
          extractCount(flagsResult, featureFlags) > offset + featureFlags.length
            ? offset + featureFlags.length
            : null,
      },
    };
  }

  if (action === "get_feature_flag") {
    const projectId =
      pickString(payload, ["projectId", "project_id"]) ||
      context.projectId ||
      pickString(connection.metadata ?? {}, ["defaultProjectId", "projectId"]);
    const flagId = pickString(payload, ["featureFlagId", "feature_flag_id", "id", "key"]);
    if (!projectId) {
      return {
        status: 400,
        body: { error: "projectId is required" },
      };
    }
    if (!flagId) {
      return {
        status: 400,
        body: { error: "featureFlagId is required" },
      };
    }

    const featureFlag = await posthogRequest<Record<string, unknown>>(
      context.credentials,
      `/feature_flags/${encodeURIComponent(flagId)}/`,
      {
        scope: "project",
        projectId,
      },
    );

    return {
      status: 200,
      body: {
        provider: "posthog",
        action,
        projectId,
        featureFlagId: flagId,
        featureFlag,
      },
    };
  }

  if (action === "run_query") {
    const projectId =
      pickString(payload, ["projectId", "project_id"]) ||
      context.projectId ||
      pickString(connection.metadata ?? {}, ["defaultProjectId", "projectId"]);
    if (!projectId) {
      return {
        status: 400,
        body: { error: "projectId is required" },
      };
    }

    const queryBody =
      isRecord(payload.query)
        ? payload.query
        : typeof payload.query === "string"
          ? { query: payload.query }
          : isRecord(payload.body)
            ? payload.body
            : payload;

    const result = await posthogRequest<Record<string, unknown>>(
      context.credentials,
      "/query/",
      {
        scope: "project",
        projectId,
        method: "POST",
        body: queryBody,
      },
    );

    return {
      status: 200,
      body: {
        provider: "posthog",
        action,
        projectId,
        result,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported posthog action: ${action}` },
  };
}
