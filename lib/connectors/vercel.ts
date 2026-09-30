import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const VERCEL_API_BASE_URL = "https://api.vercel.com";
const VERCEL_TIMEOUT_MS = 15_000;
const DEFAULT_VERCEL_LIMIT = 20;
const MAX_VERCEL_LIMIT = 100;

export type VercelCredentials = {
  token: string;
  defaultTeamId?: string;
  defaultTeamSlug?: string;
};

type VercelScope = {
  teamId?: string;
  slug?: string;
};

type VercelPagination = {
  count: number | null;
  next: string | number | null;
  previous: string | number | null;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getVercelCredentials(
  credentials: Record<string, unknown>,
): VercelCredentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.accessToken) ||
    normalizeString(credentials.apiKey);
  if (!token) {
    return null;
  }

  const explicitTeamId =
    normalizeString(credentials.defaultTeamId) ||
    normalizeString(credentials.teamId);
  const explicitTeamSlug =
    normalizeString(credentials.defaultTeamSlug) ||
    normalizeString(credentials.slug) ||
    normalizeString(credentials.teamSlug);
  const shorthand = normalizeString(credentials.defaultTeam);

  const defaultTeamId =
    explicitTeamId ||
    (shorthand.startsWith("team_") ? shorthand : "");
  const defaultTeamSlug =
    explicitTeamSlug ||
    (!explicitTeamId && shorthand && !shorthand.startsWith("team_") ? shorthand : "");

  return {
    token,
    ...(defaultTeamId ? { defaultTeamId } : {}),
    ...(defaultTeamSlug ? { defaultTeamSlug } : {}),
  };
}

function vercelHeaders(token: string) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_VERCEL_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_VERCEL_LIMIT);
}

function parseVercelPagination(payload: unknown): VercelPagination {
  if (!isRecord(payload) || !isRecord(payload.pagination)) {
    return {
      count: null,
      next: null,
      previous: null,
    };
  }

  const pagination = payload.pagination;
  return {
    count:
      typeof pagination.count === "number" && Number.isFinite(pagination.count)
        ? pagination.count
        : null,
    next:
      typeof pagination.next === "string" ||
      typeof pagination.next === "number"
        ? pagination.next
        : null,
    previous:
      typeof pagination.previous === "string" ||
      typeof pagination.previous === "number"
        ? pagination.previous
        : null,
  };
}

function listFromPayload(
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
    if (Array.isArray(payload[key])) {
      return (payload[key] as unknown[]).filter(isRecord);
    }
  }
  return [];
}

function getVercelErrorMessage(status: number, payload: unknown) {
  if (isRecord(payload) && isRecord(payload.error)) {
    const message = payload.error.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  if (isRecord(payload) && typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message;
  }
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }
  if (status === 401 || status === 403) {
    return "Vercel authentication failed. Reconnect Vercel with a valid access token.";
  }
  return `Vercel request failed (${status})`;
}

function resolveVercelScope(
  payload: Record<string, unknown>,
  credentials: VercelCredentials,
  metadata?: Record<string, unknown> | null,
): VercelScope {
  const teamId =
    normalizeString(payload.teamId) ||
    normalizeString(payload.accountId) ||
    credentials.defaultTeamId ||
    (metadata && typeof metadata.defaultTeamId === "string" ? metadata.defaultTeamId.trim() : "");
  const slug =
    normalizeString(payload.slug) ||
    normalizeString(payload.teamSlug) ||
    credentials.defaultTeamSlug ||
    (metadata && typeof metadata.defaultTeamSlug === "string"
      ? metadata.defaultTeamSlug.trim()
      : "");

  return {
    ...(teamId ? { teamId } : {}),
    ...(slug ? { slug } : {}),
  };
}

async function vercelRequest<T>(
  credentials: VercelCredentials,
  path: string,
  options?: {
    query?: Record<string, string | number | undefined>;
    metadata?: Record<string, unknown> | null;
    payload?: Record<string, unknown>;
    expectStreamJson?: boolean;
    includeScope?: boolean;
  },
): Promise<T> {
  const url = new URL(
    path.startsWith("/") ? `${VERCEL_API_BASE_URL}${path}` : `${VERCEL_API_BASE_URL}/${path}`,
  );
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  if (options?.includeScope !== false) {
    const scope = resolveVercelScope(
      options?.payload ?? {},
      credentials,
      options?.metadata ?? null,
    );
    if (scope.teamId) {
      url.searchParams.set("teamId", scope.teamId);
    }
    if (scope.slug) {
      url.searchParams.set("slug", scope.slug);
    }
  }

  const response = await fetchWithTimeoutAndRetry(
    url,
    {
      headers: vercelHeaders(credentials.token),
      cache: "no-store",
    },
    {
      timeoutMs: VERCEL_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );

  const text = await response.text();
  let parsedPayload: unknown = null;

  if (options?.expectStreamJson) {
    parsedPayload = parseStreamJsonPayload(text);
  } else {
    try {
      parsedPayload = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      parsedPayload = text;
    }
  }

  if (!response.ok) {
    throw new Error(getVercelErrorMessage(response.status, parsedPayload));
  }

  return parsedPayload as T;
}

function parseStreamJsonPayload(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const parsed = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { message: line };
        }
      })
      .filter((entry) => entry !== null);
    return parsed;
  }
}

function getProjectIdentifier(input: Record<string, unknown>) {
  const projectId =
    normalizeString(input.projectId) ||
    normalizeString(input.idOrName) ||
    normalizeString(input.project) ||
    normalizeString(input.name);
  return projectId || null;
}

function getDeploymentIdentifier(input: Record<string, unknown>) {
  const deploymentId =
    normalizeString(input.deploymentId) ||
    normalizeString(input.idOrUrl) ||
    normalizeString(input.url);
  return deploymentId || null;
}

export async function validateVercelConnection(credentials: Record<string, unknown>) {
  const normalized = getVercelCredentials(credentials);
  if (!normalized) {
    throw new Error("Vercel credentials are incomplete");
  }

  const result = await vercelRequest<{ user?: Record<string, unknown> }>(
    normalized,
    "/v2/user",
    {
      includeScope: false,
    },
  );
  const user = isRecord(result.user) ? result.user : null;
  if (!user || typeof user.id !== "string") {
    throw new Error("Vercel validation succeeded but the authenticated user payload was incomplete");
  }

  const teamsResult = await vercelRequest<{ teams?: Array<Record<string, unknown>> }>(
    normalized,
    "/v2/teams",
    {
      includeScope: false,
      query: { limit: 100 },
    },
  ).catch(() => ({ teams: [] }));
  const teams = Array.isArray(teamsResult.teams)
    ? teamsResult.teams.filter(isRecord)
    : [];

  const defaultTeamId = normalized.defaultTeamId ?? null;
  const defaultTeamSlug = normalized.defaultTeamSlug ?? null;
  if (defaultTeamId || defaultTeamSlug) {
    const matched = teams.some((team) => {
      const teamId = typeof team.id === "string" ? team.id : "";
      const slug = typeof team.slug === "string" ? team.slug : "";
      return (
        (defaultTeamId && teamId === defaultTeamId) ||
        (defaultTeamSlug && slug === defaultTeamSlug)
      );
    });
    if (!matched && teams.length > 0) {
      throw new Error("Configured default Vercel team is not accessible by this token");
    }
  }

  return {
    externalAccountId: user.id,
    metadata: {
      authMode: "access_token",
      userId: user.id,
      username:
        typeof user.username === "string" && user.username.trim().length > 0
          ? user.username
          : null,
      email:
        typeof user.email === "string" && user.email.trim().length > 0
          ? user.email
          : null,
      name:
        typeof user.name === "string" && user.name.trim().length > 0
          ? user.name
          : null,
      accessibleTeamCount: teams.length,
      ...(defaultTeamId ? { defaultTeamId } : {}),
      ...(defaultTeamSlug ? { defaultTeamSlug } : {}),
    },
  };
}

export async function executeVercelAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getVercelCredentials(connection.credentials);
  if (!credentials) {
    return {
      status: 400,
      body: { error: "Vercel credentials are incomplete" },
    };
  }

  const payload = isRecord(input) ? input : {};

  if (action === "list_teams") {
    const limit = getLimit(payload);
    const since = typeof payload.since === "number" ? payload.since : undefined;
    const until = typeof payload.until === "number" ? payload.until : undefined;
    const result = await vercelRequest<{ teams?: Array<Record<string, unknown>> }>(
      credentials,
      "/v2/teams",
      {
        includeScope: false,
        payload,
        metadata: connection.metadata,
        query: { limit, since, until },
      },
    );
    const teams = Array.isArray(result.teams) ? result.teams.filter(isRecord) : [];
    return {
      status: 200,
      body: {
        provider: "vercel",
        action,
        teams,
        count: teams.length,
        returnedCount: teams.length,
        limit,
      },
    };
  }

  if (action === "list_projects") {
    const limit = getLimit(payload);
    const result = await vercelRequest<unknown>(
      credentials,
      "/v10/projects",
      {
        payload,
        metadata: connection.metadata,
        query: {
          limit,
          from: typeof payload.from === "number" ? payload.from : undefined,
          repoUrl:
            typeof payload.repoUrl === "string" && payload.repoUrl.trim().length > 0
              ? payload.repoUrl.trim()
              : undefined,
        },
      },
    );
    const projects = listFromPayload(result, ["projects"]);
    const pagination = parseVercelPagination(result);
    return {
      status: 200,
      body: {
        provider: "vercel",
        action,
        projects,
        count: projects.length,
        returnedCount: projects.length,
        limit,
        hasMore: pagination.next !== null,
        nextCursor: pagination.next,
        totalCount: pagination.count,
      },
    };
  }

  if (action === "get_project") {
    const idOrName = getProjectIdentifier(payload);
    if (!idOrName) {
      return {
        status: 400,
        body: { error: "projectId or idOrName is required" },
      };
    }

    const project = await vercelRequest<Record<string, unknown>>(
      credentials,
      `/v9/projects/${encodeURIComponent(idOrName)}`,
      {
        payload,
        metadata: connection.metadata,
      },
    );
    return {
      status: 200,
      body: {
        provider: "vercel",
        action,
        idOrName,
        project,
      },
    };
  }

  if (action === "list_deployments") {
    const limit = getLimit(payload);
    const result = await vercelRequest<unknown>(
      credentials,
      "/v6/deployments",
      {
        payload,
        metadata: connection.metadata,
        query: {
          limit,
          from:
            typeof payload.from === "number" || typeof payload.from === "string"
              ? (payload.from as string | number)
              : undefined,
          projectId: getProjectIdentifier(payload) ?? undefined,
          target:
            typeof payload.target === "string" && payload.target.trim().length > 0
              ? payload.target.trim()
              : undefined,
          state:
            typeof payload.state === "string" && payload.state.trim().length > 0
              ? payload.state.trim()
              : undefined,
          since: typeof payload.since === "number" ? payload.since : undefined,
          until: typeof payload.until === "number" ? payload.until : undefined,
        },
      },
    );
    const deployments = listFromPayload(result, ["deployments"]);
    const pagination = parseVercelPagination(result);
    return {
      status: 200,
      body: {
        provider: "vercel",
        action,
        deployments,
        count: deployments.length,
        returnedCount: deployments.length,
        limit,
        hasMore: pagination.next !== null,
        nextCursor: pagination.next,
        totalCount: pagination.count,
      },
    };
  }

  if (action === "get_deployment") {
    const idOrUrl = getDeploymentIdentifier(payload);
    if (!idOrUrl) {
      return {
        status: 400,
        body: { error: "deploymentId or idOrUrl is required" },
      };
    }

    const deployment = await vercelRequest<Record<string, unknown>>(
      credentials,
      `/v13/deployments/${encodeURIComponent(idOrUrl)}`,
      {
        payload,
        metadata: connection.metadata,
        query: {
          withGitRepoInfo: payload.withGitRepoInfo === true ? "true" : undefined,
        },
      },
    );
    return {
      status: 200,
      body: {
        provider: "vercel",
        action,
        idOrUrl,
        deployment,
      },
    };
  }

  if (action === "get_build_logs") {
    const idOrUrl = getDeploymentIdentifier(payload);
    if (!idOrUrl) {
      return {
        status: 400,
        body: { error: "deploymentId or idOrUrl is required" },
      };
    }

    const limit = getLimit(payload, 50);
    const events = await vercelRequest<unknown[]>(
      credentials,
      `/v3/deployments/${encodeURIComponent(idOrUrl)}/events`,
      {
        payload,
        metadata: connection.metadata,
        query: {
          limit,
          direction:
            typeof payload.direction === "string" && payload.direction.trim().length > 0
              ? payload.direction.trim()
              : "backward",
          follow: payload.follow === true ? 1 : 0,
          builds: 1,
          statusCode:
            typeof payload.statusCode === "string" && payload.statusCode.trim().length > 0
              ? payload.statusCode.trim()
              : undefined,
        },
      },
    );
    const logEvents = Array.isArray(events) ? events.filter(isRecord) : [];
    return {
      status: 200,
      body: {
        provider: "vercel",
        action,
        idOrUrl,
        events: logEvents,
        count: logEvents.length,
        returnedCount: logEvents.length,
        limit,
      },
    };
  }

  if (action === "get_runtime_logs") {
    const projectId = getProjectIdentifier(payload);
    const deploymentId = getDeploymentIdentifier(payload);
    if (!projectId || !deploymentId) {
      return {
        status: 400,
        body: { error: "projectId (or idOrName) and deploymentId are required" },
      };
    }

    const logs = await vercelRequest<unknown>(
      credentials,
      `/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(
        deploymentId,
      )}/runtime-logs`,
      {
        payload,
        metadata: connection.metadata,
        expectStreamJson: true,
      },
    );
    const entries = Array.isArray(logs)
      ? logs.filter(isRecord)
      : isRecord(logs)
        ? [logs]
        : [];
    return {
      status: 200,
      body: {
        provider: "vercel",
        action,
        projectId,
        deploymentId,
        logs: entries,
        count: entries.length,
        returnedCount: entries.length,
      },
    };
  }

  if (action === "list_domains") {
    const limit = getLimit(payload);
    const projectId = getProjectIdentifier(payload);
    const path = projectId
      ? `/v9/projects/${encodeURIComponent(projectId)}/domains`
      : "/v5/domains";
    const result = await vercelRequest<unknown>(
      credentials,
      path,
      {
        payload,
        metadata: connection.metadata,
        query: {
          limit,
          from:
            typeof payload.from === "number" || typeof payload.from === "string"
              ? (payload.from as string | number)
              : undefined,
          since: typeof payload.since === "number" ? payload.since : undefined,
          until: typeof payload.until === "number" ? payload.until : undefined,
        },
      },
    );
    const domains = listFromPayload(result, ["domains"]);
    const pagination = parseVercelPagination(result);
    return {
      status: 200,
      body: {
        provider: "vercel",
        action,
        ...(projectId ? { projectId } : {}),
        domains,
        count: domains.length,
        returnedCount: domains.length,
        limit,
        hasMore: pagination.next !== null,
        nextCursor: pagination.next,
        totalCount: pagination.count,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported vercel action: ${action}` },
  };
}
