import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const DEFAULT_GITHUB_BASE_URL = "https://api.github.com";
const DEFAULT_GITHUB_WEB_URL = "https://github.com";
const GITHUB_TIMEOUT_MS = 15_000;
const DEFAULT_GITHUB_LIMIT = 25;
const MAX_GITHUB_LIMIT = 100;

export type GithubCredentials = {
  token: string;
  baseUrl: string;
};

type GithubLinkMeta = {
  hasNext: boolean;
  nextPage: number | null;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeGithubBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_GITHUB_BASE_URL;
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("GitHub API base URL must use http or https");
  }

  if (url.hostname === "github.com" || url.hostname === "www.github.com") {
    return DEFAULT_GITHUB_BASE_URL;
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function normalizeGithubWebUrl(baseUrl: string) {
  if (baseUrl === DEFAULT_GITHUB_BASE_URL) {
    return DEFAULT_GITHUB_WEB_URL;
  }

  const url = new URL(baseUrl);
  const normalizedPath = url.pathname.replace(/\/api\/v3$/i, "").replace(/\/+$/, "");
  return `${url.origin}${normalizedPath}`;
}

export function getGithubCredentials(
  credentials: Record<string, unknown>,
): GithubCredentials | null {
  const token =
    normalizeString(credentials.token) ||
    normalizeString(credentials.personalAccessToken) ||
    normalizeString(credentials.apiKey);
  if (!token) {
    return null;
  }

  const baseUrl = normalizeGithubBaseUrl(
    normalizeString(credentials.baseUrl) ||
      normalizeString(credentials.apiBaseUrl) ||
      DEFAULT_GITHUB_BASE_URL,
  );

  return {
    token,
    baseUrl,
  };
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function buildGithubErrorMessage(status: number, payload: unknown) {
  if (isRecord(payload) && typeof payload.message === "string") {
    return payload.message;
  }
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }
  if (status === 401 || status === 403) {
    return "GitHub authentication failed. Reconnect GitHub with a valid personal access token.";
  }
  return `GitHub request failed (${status})`;
}

async function githubRequest<T>(
  credentials: GithubCredentials,
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<{ payload: T; link: GithubLinkMeta }> {
  const url = new URL(
    path.startsWith("/") ? `${credentials.baseUrl}${path}` : `${credentials.baseUrl}/${path}`,
  );
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchWithTimeoutAndRetry(
    url,
    {
      headers: githubHeaders(credentials.token),
      cache: "no-store",
    },
    {
      timeoutMs: GITHUB_TIMEOUT_MS,
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
    throw new Error(buildGithubErrorMessage(response.status, payload));
  }

  return {
    payload: payload as T,
    link: parseGithubLinkHeader(response.headers.get("link")),
  };
}

function parseGithubLinkHeader(headerValue: string | null): GithubLinkMeta {
  if (!headerValue) {
    return { hasNext: false, nextPage: null };
  }

  const segments = headerValue.split(",");
  for (const segment of segments) {
    const parts = segment.split(";");
    const rawUrl = parts[0]?.trim();
    const rel = parts[1]?.trim();
    if (!rawUrl || rel !== 'rel="next"') continue;
    const url = rawUrl.replace(/^<|>$/g, "");
    try {
      const parsed = new URL(url);
      const page = parsed.searchParams.get("page");
      return {
        hasNext: true,
        nextPage: page && /^\d+$/.test(page) ? Number(page) : null,
      };
    } catch {
      return { hasNext: true, nextPage: null };
    }
  }

  return { hasNext: false, nextPage: null };
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_GITHUB_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_GITHUB_LIMIT);
}

function getPage(input: Record<string, unknown>) {
  if (typeof input.page !== "number" || !Number.isInteger(input.page)) {
    return 1;
  }
  return Math.max(input.page, 1);
}

function pickString(input: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const resolved = normalizeString(input[key]);
    if (resolved) return resolved;
  }
  return "";
}

function resolveRepoCoordinates(input: Record<string, unknown>) {
  const fullName =
    pickString(input, ["fullName", "repoFullName", "repository", "repo"]) ||
    "";
  const owner = pickString(input, ["owner"]);
  const repoName = pickString(input, ["repo", "name"]);

  if (fullName.includes("/")) {
    const [fullOwner, ...rest] = fullName.split("/");
    const fullRepo = rest.join("/").trim();
    if (fullOwner && fullRepo) {
      return {
        owner: fullOwner.trim(),
        repo: fullRepo,
        fullName: `${fullOwner.trim()}/${fullRepo}`,
      };
    }
  }

  if (owner && repoName) {
    return {
      owner,
      repo: repoName,
      fullName: `${owner}/${repoName}`,
    };
  }

  return null;
}

export async function validateGithubConnection(credentials: Record<string, unknown>) {
  const normalized = getGithubCredentials(credentials);
  if (!normalized) {
    throw new Error("GitHub credentials are incomplete");
  }

  const { payload } = await githubRequest<Record<string, unknown>>(
    normalized,
    "/user",
  );

  const login = typeof payload.login === "string" ? payload.login : null;
  if (!login) {
    throw new Error("GitHub validation succeeded but account login was missing");
  }

  return {
    externalAccountId: login,
      metadata: {
        authMode: "personal_access_token",
        baseUrl: normalized.baseUrl,
        webUrl:
          typeof payload.html_url === "string" && payload.html_url.trim().length > 0
            ? payload.html_url
            : normalizeGithubWebUrl(normalized.baseUrl),
        login,
        name: typeof payload.name === "string" ? payload.name : null,
      },
  };
}

export async function executeGithubAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getGithubCredentials(connection.credentials);
  if (!credentials) {
    return {
      status: 400,
      body: { error: "GitHub credentials are incomplete" },
    };
  }

  const payload = isRecord(input) ? input : {};

  if (action === "list_repos") {
    const limit = getLimit(payload);
    const page = getPage(payload);
    const affiliation = pickString(payload, ["affiliation"]);
    const visibility = pickString(payload, ["visibility"]);
    const type = pickString(payload, ["type"]);
    const sort = pickString(payload, ["sort"]) || "updated";
    const direction = pickString(payload, ["direction"]) || "desc";

    const { payload: repos, link } = await githubRequest<Array<Record<string, unknown>>>(
      credentials,
      "/user/repos",
      {
        per_page: limit,
        page,
        affiliation: affiliation || undefined,
        visibility: visibility || undefined,
        type: type || undefined,
        sort,
        direction,
      },
    );

    return {
      status: 200,
      body: {
        provider: "github",
        action,
        repos,
        count: repos.length,
        returnedCount: repos.length,
        limit,
        page,
        hasMore: link.hasNext,
        nextPage: link.nextPage,
      },
    };
  }

  if (action === "get_repo") {
    const repo = resolveRepoCoordinates(payload);
    if (!repo) {
      return {
        status: 400,
        body: { error: "owner and repo (or fullName) are required" },
      };
    }

    const { payload: repository } = await githubRequest<Record<string, unknown>>(
      credentials,
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`,
    );

    return {
      status: 200,
      body: {
        provider: "github",
        action,
        fullName: repo.fullName,
        repository,
      },
    };
  }

  if (action === "list_issues") {
    const repo = resolveRepoCoordinates(payload);
    if (!repo) {
      return {
        status: 400,
        body: { error: "owner and repo (or fullName) are required" },
      };
    }

    const limit = getLimit(payload);
    const page = getPage(payload);
    const state = pickString(payload, ["state"]) || "open";
    const since = pickString(payload, ["since"]);
    const labels = Array.isArray(payload.labels)
      ? payload.labels.filter((label): label is string => typeof label === "string" && label.trim().length > 0).join(",")
      : pickString(payload, ["labels"]);

    const { payload: issues, link } = await githubRequest<Array<Record<string, unknown>>>(
      credentials,
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues`,
      {
        per_page: limit,
        page,
        state,
        since: since || undefined,
        labels: labels || undefined,
      },
    );

    const filteredIssues = issues.filter((issue) => !("pull_request" in issue));
    return {
      status: 200,
      body: {
        provider: "github",
        action,
        fullName: repo.fullName,
        issues: filteredIssues,
        count: filteredIssues.length,
        returnedCount: filteredIssues.length,
        limit,
        page,
        hasMore: link.hasNext,
        nextPage: link.nextPage,
      },
    };
  }

  if (action === "list_pull_requests") {
    const repo = resolveRepoCoordinates(payload);
    if (!repo) {
      return {
        status: 400,
        body: { error: "owner and repo (or fullName) are required" },
      };
    }

    const limit = getLimit(payload);
    const page = getPage(payload);
    const state = pickString(payload, ["state"]) || "open";
    const base = pickString(payload, ["base"]);
    const head = pickString(payload, ["head"]);
    const sort = pickString(payload, ["sort"]) || "updated";
    const direction = pickString(payload, ["direction"]) || "desc";

    const { payload: pullRequests, link } = await githubRequest<Array<Record<string, unknown>>>(
      credentials,
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls`,
      {
        per_page: limit,
        page,
        state,
        base: base || undefined,
        head: head || undefined,
        sort,
        direction,
      },
    );

    return {
      status: 200,
      body: {
        provider: "github",
        action,
        fullName: repo.fullName,
        pullRequests,
        count: pullRequests.length,
        returnedCount: pullRequests.length,
        limit,
        page,
        hasMore: link.hasNext,
        nextPage: link.nextPage,
      },
    };
  }

  if (action === "list_commits") {
    const repo = resolveRepoCoordinates(payload);
    if (!repo) {
      return {
        status: 400,
        body: { error: "owner and repo (or fullName) are required" },
      };
    }

    const limit = getLimit(payload);
    const page = getPage(payload);
    const sha = pickString(payload, ["branch", "sha"]);
    const since = pickString(payload, ["since"]);
    const until = pickString(payload, ["until"]);
    const path = pickString(payload, ["path"]);

    const { payload: commits, link } = await githubRequest<Array<Record<string, unknown>>>(
      credentials,
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits`,
      {
        per_page: limit,
        page,
        sha: sha || undefined,
        since: since || undefined,
        until: until || undefined,
        path: path || undefined,
      },
    );

    return {
      status: 200,
      body: {
        provider: "github",
        action,
        fullName: repo.fullName,
        commits,
        count: commits.length,
        returnedCount: commits.length,
        limit,
        page,
        hasMore: link.hasNext,
        nextPage: link.nextPage,
      },
    };
  }

  if (action === "list_workflow_runs") {
    const repo = resolveRepoCoordinates(payload);
    if (!repo) {
      return {
        status: 400,
        body: { error: "owner and repo (or fullName) are required" },
      };
    }

    const limit = getLimit(payload);
    const page = getPage(payload);
    const branch = pickString(payload, ["branch"]);
    const event = pickString(payload, ["event"]);
    const status = pickString(payload, ["status"]);

    const { payload: result, link } = await githubRequest<Record<string, unknown>>(
      credentials,
      `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/actions/runs`,
      {
        per_page: limit,
        page,
        branch: branch || undefined,
        event: event || undefined,
        status: status || undefined,
      },
    );

    const workflowRuns = Array.isArray(result.workflow_runs)
      ? result.workflow_runs.filter(isRecord)
      : [];

    return {
      status: 200,
      body: {
        provider: "github",
        action,
        fullName: repo.fullName,
        workflowRuns,
        totalCount:
          typeof result.total_count === "number" ? result.total_count : workflowRuns.length,
        count: workflowRuns.length,
        returnedCount: workflowRuns.length,
        limit,
        page,
        hasMore: link.hasNext,
        nextPage: link.nextPage,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported github action: ${action}` },
  };
}
