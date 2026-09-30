import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_LINEAR_API_URL = "https://api.linear.app/graphql";
const LINEAR_TIMEOUT_MS = 15_000;
const DEFAULT_LINEAR_LIMIT = 25;
const MAX_LINEAR_LIMIT = 100;

export type LinearCredentials = {
  token: string;
  baseUrl: string;
  defaultTeamId?: string;
  defaultProjectId?: string;
};

type LinearPageInfo = {
  hasNextPage?: boolean | null;
  endCursor?: string | null;
};

type LinearConnection<T> = {
  nodes?: T[] | null;
  pageInfo?: LinearPageInfo | null;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeLinearApiUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_LINEAR_API_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Linear API URL must use http or https");
  }

  const normalizedPath = url.pathname === "/" ? "/graphql" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${normalizedPath.endsWith("/graphql") ? normalizedPath : `${normalizedPath}/graphql`}`;
}

export function getLinearCredentials(
  credentials: Record<string, unknown>,
): LinearCredentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.apiKey) ||
    normalizeString(credentials.personalApiKey) ||
    normalizeString(credentials.personalAccessToken);
  if (!token) {
    return null;
  }

  const baseUrl = normalizeLinearApiUrl(
    normalizeString(credentials.baseUrl) ||
      normalizeString(credentials.apiUrl) ||
      DEFAULT_LINEAR_API_URL,
  );

  const defaultTeamId =
    normalizeString(credentials.defaultTeamId) ||
    normalizeString(credentials.teamId) ||
    "";
  const defaultProjectId =
    normalizeString(credentials.defaultProjectId) ||
    normalizeString(credentials.projectId) ||
    "";

  return {
    token,
    baseUrl,
    ...(defaultTeamId ? { defaultTeamId } : {}),
    ...(defaultProjectId ? { defaultProjectId } : {}),
  };
}

function linearHeaders(token: string) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: token,
  };
}

function buildLinearErrorMessage(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "Linear authentication failed. Reconnect Linear with a valid personal API key.";
  }
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }
  if (isRecord(payload) && typeof payload.message === "string" && payload.message.trim().length > 0) {
    return payload.message.trim();
  }
  return `Linear request failed (${status})`;
}

async function linearRequest<T>(
  credentials: LinearCredentials,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetchWithTimeoutAndRetry(
    credentials.baseUrl,
    {
      method: "POST",
      headers: linearHeaders(credentials.token),
      cache: "no-store",
      body: JSON.stringify({
        query,
        variables: variables ?? {},
      }),
    },
    {
      timeoutMs: LINEAR_TIMEOUT_MS,
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
    throw new Error(buildLinearErrorMessage(response.status, payload));
  }

  if (isRecord(payload) && Array.isArray(payload.errors) && payload.errors.length > 0) {
    const first = payload.errors[0];
    if (isRecord(first) && typeof first.message === "string" && first.message.trim().length > 0) {
      throw new Error(first.message.trim());
    }
    throw new Error("Linear request returned GraphQL errors");
  }

  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error("Linear response did not include a data object");
  }

  return payload.data as T;
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_LINEAR_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_LINEAR_LIMIT);
}

function getCursor(input: Record<string, unknown>) {
  return (
    normalizeString(input.from) ||
    normalizeString(input.after) ||
    ""
  );
}

function getScopedId(
  input: Record<string, unknown>,
  keys: readonly string[],
  fallback?: string,
) {
  for (const key of keys) {
    const resolved = normalizeString(input[key]);
    if (resolved) return resolved;
  }
  return fallback ?? "";
}

function connectionNodes<T extends Record<string, unknown>>(
  connection: LinearConnection<T> | null | undefined,
) {
  if (!connection || !Array.isArray(connection.nodes)) {
    return [] as T[];
  }
  return connection.nodes.filter(isRecord) as T[];
}

function connectionPageInfo<T>(
  connection: LinearConnection<T> | null | undefined,
): LinearPageInfo {
  if (!connection?.pageInfo || !isRecord(connection.pageInfo)) {
    return { hasNextPage: false, endCursor: null };
  }
  return {
    hasNextPage: connection.pageInfo.hasNextPage === true,
    endCursor:
      typeof connection.pageInfo.endCursor === "string"
        ? connection.pageInfo.endCursor
        : null,
  };
}

function linearListResponse(
  action: string,
  collectionKey: string,
  records: Array<Record<string, unknown>>,
  limit: number,
  pageInfo: LinearPageInfo,
  extra?: Record<string, unknown>,
) {
  return {
    status: 200,
    body: {
      provider: "linear",
      action,
      [collectionKey]: records,
      count: records.length,
      returnedCount: records.length,
      limit,
      hasMore: pageInfo.hasNextPage === true,
      nextCursor: pageInfo.hasNextPage === true ? (pageInfo.endCursor ?? null) : null,
      ...(extra ?? {}),
    },
  };
}

function pickTeamFields() {
  return `
    id
    key
    name
  `;
}

function pickProjectFields() {
  return `
    id
    name
    slug
    description
    progress
    startDate
    targetDate
  `;
}

function pickIssueFields() {
  return `
    id
    identifier
    title
    description
    priority
    url
    createdAt
    updatedAt
    state {
      id
      name
      type
    }
    team {
      ${pickTeamFields()}
    }
    project {
      id
      name
      slug
    }
    assignee {
      id
      name
      email
    }
    cycle {
      id
      number
      name
    }
  `;
}

function pickCycleFields() {
  return `
    id
    number
    name
    startsAt
    endsAt
  `;
}

function pickUserFields() {
  return `
    id
    name
    email
    active
    admin
  `;
}

export async function validateLinearConnection(credentials: Record<string, unknown>) {
  const normalized = getLinearCredentials(credentials);
  if (!normalized) {
    throw new Error("Linear credentials are incomplete");
  }

  const data = await linearRequest<{
    viewer?: Record<string, unknown> | null;
    teams?: LinearConnection<Record<string, unknown>> | null;
  }>(
    normalized,
    `
      query ValidateLinearConnection($first: Int!) {
        viewer {
          id
          name
          email
        }
        teams(first: $first) {
          nodes {
            ${pickTeamFields()}
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
    { first: 50 },
  );

  const viewer = isRecord(data.viewer) ? data.viewer : null;
  if (!viewer || typeof viewer.id !== "string" || viewer.id.trim().length === 0) {
    throw new Error("Linear validation succeeded but viewer details were missing");
  }

  const teams = connectionNodes(data.teams);
  const firstTeam = teams[0];

  return {
    externalAccountId: viewer.id,
    metadata: {
      authMode: "personal_api_key",
      baseUrl: normalized.baseUrl,
      viewerId: viewer.id,
      viewerName: typeof viewer.name === "string" ? viewer.name : null,
      viewerEmail: typeof viewer.email === "string" ? viewer.email : null,
      accessibleTeamCount: teams.length,
      defaultTeamId:
        normalized.defaultTeamId ??
        (firstTeam && typeof firstTeam.id === "string" ? firstTeam.id : null),
      defaultTeamName:
        firstTeam && typeof firstTeam.name === "string" ? firstTeam.name : null,
      defaultProjectId: normalized.defaultProjectId ?? null,
    },
  };
}

async function listTeams(credentials: LinearCredentials, input: Record<string, unknown>) {
  const limit = getLimit(input);
  const after = getCursor(input);
  const data = await linearRequest<{
    teams?: LinearConnection<Record<string, unknown>> | null;
  }>(
    credentials,
    `
      query ListLinearTeams($first: Int!, $after: String) {
        teams(first: $first, after: $after) {
          nodes {
            ${pickTeamFields()}
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
    {
      first: limit,
      after: after || null,
    },
  );

  return linearListResponse(
    "list_teams",
    "teams",
    connectionNodes(data.teams),
    limit,
    connectionPageInfo(data.teams),
  );
}

async function listProjects(
  credentials: LinearCredentials,
  input: Record<string, unknown>,
) {
  const limit = getLimit(input);
  const after = getCursor(input);
  const teamId = getScopedId(input, ["teamId", "team_id"], credentials.defaultTeamId);

  if (teamId) {
    const data = await linearRequest<{
      team?: (Record<string, unknown> & {
        projects?: LinearConnection<Record<string, unknown>> | null;
      }) | null;
    }>(
      credentials,
      `
        query ListLinearTeamProjects($teamId: String!, $first: Int!, $after: String) {
          team(id: $teamId) {
            ${pickTeamFields()}
            projects(first: $first, after: $after) {
              nodes {
                ${pickProjectFields()}
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      {
        teamId,
        first: limit,
        after: after || null,
      },
    );

    const projects = connectionNodes(data.team?.projects);
    return linearListResponse(
      "list_projects",
      "projects",
      projects,
      limit,
      connectionPageInfo(data.team?.projects),
      { teamId },
    );
  }

  const data = await linearRequest<{
    projects?: LinearConnection<Record<string, unknown>> | null;
  }>(
    credentials,
    `
      query ListLinearProjects($first: Int!, $after: String) {
        projects(first: $first, after: $after) {
          nodes {
            ${pickProjectFields()}
            teams {
              nodes {
                ${pickTeamFields()}
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
    {
      first: limit,
      after: after || null,
    },
  );

  return linearListResponse(
    "list_projects",
    "projects",
    connectionNodes(data.projects),
    limit,
    connectionPageInfo(data.projects),
  );
}

async function listIssues(
  credentials: LinearCredentials,
  input: Record<string, unknown>,
) {
  const limit = getLimit(input);
  const after = getCursor(input);
  const teamId = getScopedId(input, ["teamId", "team_id"], credentials.defaultTeamId);
  const projectId = getScopedId(input, ["projectId", "project_id"], credentials.defaultProjectId);

  if (teamId) {
    const data = await linearRequest<{
      team?: (Record<string, unknown> & {
        issues?: LinearConnection<Record<string, unknown>> | null;
      }) | null;
    }>(
      credentials,
      `
        query ListLinearTeamIssues($teamId: String!, $first: Int!, $after: String) {
          team(id: $teamId) {
            ${pickTeamFields()}
            issues(first: $first, after: $after) {
              nodes {
                ${pickIssueFields()}
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      {
        teamId,
        first: limit,
        after: after || null,
      },
    );

    return linearListResponse(
      "list_issues",
      "issues",
      connectionNodes(data.team?.issues),
      limit,
      connectionPageInfo(data.team?.issues),
      { teamId },
    );
  }

  if (projectId) {
    const data = await linearRequest<{
      project?: (Record<string, unknown> & {
        issues?: LinearConnection<Record<string, unknown>> | null;
      }) | null;
    }>(
      credentials,
      `
        query ListLinearProjectIssues($projectId: String!, $first: Int!, $after: String) {
          project(id: $projectId) {
            id
            name
            slug
            issues(first: $first, after: $after) {
              nodes {
                ${pickIssueFields()}
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      {
        projectId,
        first: limit,
        after: after || null,
      },
    );

    return linearListResponse(
      "list_issues",
      "issues",
      connectionNodes(data.project?.issues),
      limit,
      connectionPageInfo(data.project?.issues),
      { projectId },
    );
  }

  const data = await linearRequest<{
    issues?: LinearConnection<Record<string, unknown>> | null;
  }>(
    credentials,
    `
      query ListLinearIssues($first: Int!, $after: String) {
        issues(first: $first, after: $after) {
          nodes {
            ${pickIssueFields()}
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
    {
      first: limit,
      after: after || null,
    },
  );

  return linearListResponse(
    "list_issues",
    "issues",
    connectionNodes(data.issues),
    limit,
    connectionPageInfo(data.issues),
  );
}

async function getIssue(
  credentials: LinearCredentials,
  input: Record<string, unknown>,
) {
  const issueId = getScopedId(input, ["issueId", "issue_id", "id"]);
  if (!issueId) {
    return {
      status: 400,
      body: { error: "issueId is required for get_issue" },
    };
  }

  const data = await linearRequest<{
    issue?: Record<string, unknown> | null;
  }>(
    credentials,
    `
      query GetLinearIssue($issueId: String!) {
        issue(id: $issueId) {
          ${pickIssueFields()}
        }
      }
    `,
    { issueId },
  );

  return {
    status: 200,
    body: {
      provider: "linear",
      action: "get_issue",
      issueId,
      issue: data.issue ?? null,
    },
  };
}

async function listIssueComments(
  credentials: LinearCredentials,
  input: Record<string, unknown>,
) {
  const issueId = getScopedId(input, ["issueId", "issue_id", "id"]);
  if (!issueId) {
    return {
      status: 400,
      body: { error: "issueId is required for list_issue_comments" },
    };
  }

  const limit = getLimit(input);
  const after = getCursor(input);
  const data = await linearRequest<{
    issue?: (Record<string, unknown> & {
      comments?: LinearConnection<Record<string, unknown>> | null;
      team?: Record<string, unknown> | null;
      project?: Record<string, unknown> | null;
    }) | null;
  }>(
    credentials,
    `
      query ListLinearIssueComments($issueId: String!, $first: Int!, $after: String) {
        issue(id: $issueId) {
          id
          identifier
          team {
            ${pickTeamFields()}
          }
          project {
            id
            name
            slug
          }
          comments(first: $first, after: $after) {
            nodes {
              id
              body
              createdAt
              updatedAt
              user {
                id
                name
                email
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `,
    {
      issueId,
      first: limit,
      after: after || null,
    },
  );

  const issue = data.issue ?? null;
  return linearListResponse(
    "list_issue_comments",
    "comments",
    connectionNodes(issue?.comments),
    limit,
    connectionPageInfo(issue?.comments),
    {
      issueId,
      teamId: issue && isRecord(issue.team) && typeof issue.team.id === "string" ? issue.team.id : null,
      projectId:
        issue && isRecord(issue.project) && typeof issue.project.id === "string"
          ? issue.project.id
          : null,
    },
  );
}

async function listCycles(
  credentials: LinearCredentials,
  input: Record<string, unknown>,
) {
  const limit = getLimit(input);
  const after = getCursor(input);
  const teamId = getScopedId(input, ["teamId", "team_id"], credentials.defaultTeamId);

  if (teamId) {
    const data = await linearRequest<{
      team?: (Record<string, unknown> & {
        cycles?: LinearConnection<Record<string, unknown>> | null;
      }) | null;
    }>(
      credentials,
      `
        query ListLinearTeamCycles($teamId: String!, $first: Int!, $after: String) {
          team(id: $teamId) {
            ${pickTeamFields()}
            cycles(first: $first, after: $after) {
              nodes {
                ${pickCycleFields()}
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      {
        teamId,
        first: limit,
        after: after || null,
      },
    );

    return linearListResponse(
      "list_cycles",
      "cycles",
      connectionNodes(data.team?.cycles),
      limit,
      connectionPageInfo(data.team?.cycles),
      { teamId },
    );
  }

  const data = await linearRequest<{
    cycles?: LinearConnection<Record<string, unknown>> | null;
  }>(
    credentials,
    `
      query ListLinearCycles($first: Int!, $after: String) {
        cycles(first: $first, after: $after) {
          nodes {
            ${pickCycleFields()}
            team {
              ${pickTeamFields()}
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
    {
      first: limit,
      after: after || null,
    },
  );

  return linearListResponse(
    "list_cycles",
    "cycles",
    connectionNodes(data.cycles),
    limit,
    connectionPageInfo(data.cycles),
  );
}

async function listUsers(
  credentials: LinearCredentials,
  input: Record<string, unknown>,
) {
  const limit = getLimit(input);
  const after = getCursor(input);
  const data = await linearRequest<{
    users?: LinearConnection<Record<string, unknown>> | null;
  }>(
    credentials,
    `
      query ListLinearUsers($first: Int!, $after: String) {
        users(first: $first, after: $after) {
          nodes {
            ${pickUserFields()}
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
    {
      first: limit,
      after: after || null,
    },
  );

  return linearListResponse(
    "list_users",
    "users",
    connectionNodes(data.users),
    limit,
    connectionPageInfo(data.users),
  );
}

export async function executeLinearAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getLinearCredentials(connection.credentials);
  if (!credentials) {
    return {
      status: 400,
      body: { error: "Linear credentials are incomplete" },
    };
  }

  const payload = isRecord(input) ? input : {};
  const metadata = connection.metadata ?? {};
  const scopedCredentials: LinearCredentials = {
    ...credentials,
    ...(typeof metadata.defaultTeamId === "string" && metadata.defaultTeamId.trim().length > 0
      ? { defaultTeamId: metadata.defaultTeamId.trim() }
      : {}),
    ...(typeof metadata.defaultProjectId === "string" && metadata.defaultProjectId.trim().length > 0
      ? { defaultProjectId: metadata.defaultProjectId.trim() }
      : {}),
  };

  if (action === "list_teams") {
    return listTeams(scopedCredentials, payload);
  }

  if (action === "list_projects") {
    return listProjects(scopedCredentials, payload);
  }

  if (action === "list_issues") {
    return listIssues(scopedCredentials, payload);
  }

  if (action === "get_issue") {
    return getIssue(scopedCredentials, payload);
  }

  if (action === "list_issue_comments") {
    return listIssueComments(scopedCredentials, payload);
  }

  if (action === "list_cycles") {
    return listCycles(scopedCredentials, payload);
  }

  if (action === "list_users") {
    return listUsers(scopedCredentials, payload);
  }

  return {
    status: 400,
    body: {
      error: `Unsupported Linear action: ${action}`,
      provider: "linear",
      supportedActions: [
        "list_teams",
        "list_projects",
        "list_issues",
        "get_issue",
        "list_issue_comments",
        "list_cycles",
        "list_users",
      ],
    },
  };
}
