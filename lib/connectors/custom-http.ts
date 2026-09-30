import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";
import { assertUrlNotSsrf } from "@/lib/connectors/ssrf-guard";

const DEFAULT_CUSTOM_HTTP_TIMEOUT_MS = 15_000;

type CustomHttpAuthMode = "none" | "bearer" | "header" | "query";

type CustomHttpPrimitive = string | number | boolean | null;

export type CustomHttpActionDefinition = {
  name: string;
  description: string | null;
  method: "GET";
  path: string;
  readOnly: true;
  queryDefaults?: Record<string, string | number | boolean>;
  responseCollectionPath?: string | null;
  pathParamNames?: string[];
  queryParamNames?: string[];
  requiredQueryParamNames?: string[];
};

export type CustomHttpCredentials = {
  connectionLabel?: string;
  baseUrl: string;
  authMode: CustomHttpAuthMode;
  authToken?: string;
  authHeaderName?: string;
  authQueryParam?: string;
  defaultHeaders?: Record<string, string>;
  allowedPathPrefixes: string[];
  actions: CustomHttpActionDefinition[];
  probePath?: string;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function parseStringArrayInput(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeString(entry))
      .filter(Boolean);
  }

  const text = normalizeString(value);
  if (!text) {
    return [];
  }

  try {
    const parsed = parseJson(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => normalizeString(entry))
        .filter(Boolean);
    }
  } catch {
    // Fall through to line-based parsing.
  }

  return text
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseStringRecordInput(
  value: unknown,
  fieldName: string,
): Record<string, string> {
  if (value == null || value === "") {
    return {};
  }

  const parsed =
    typeof value === "string" ? parseJson(value) : value;
  if (!isRecord(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }

  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) {
      continue;
    }
    if (
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    ) {
      throw new Error(`${fieldName}.${normalizedKey} must be a string, number, or boolean`);
    }
    output[normalizedKey] = String(entry);
  }

  return output;
}

export function normalizeCustomHttpBaseUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("baseUrl is required");
  }

  const url = new URL(trimmed);
  assertUrlNotSsrf(url, "Custom connector base URL");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Custom connector base URL must use http or https");
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function normalizePathPrefix(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") || "/" : `/${trimmed.replace(/\/+$/, "")}`;
}

function normalizeActionName(input: string) {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return normalized.replace(/^_+|_+$/g, "");
}

function parseMethod(input: unknown): "GET" {
  const method = normalizeString(input).toUpperCase();
  if (method === "GET") {
    return "GET";
  }
  throw new Error("Custom HTTP actions currently support only GET");
}

function normalizePrimitiveRecord(
  value: unknown,
  fieldName: string,
): Record<string, string | number | boolean> | undefined {
  if (value == null || value === "") {
    return undefined;
  }

  const parsed =
    typeof value === "string" ? parseJson(value) : value;
  if (!isRecord(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }

  const output: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) {
      continue;
    }
    if (
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    ) {
      throw new Error(`${fieldName}.${normalizedKey} must be a string, number, or boolean`);
    }
    output[normalizedKey] = entry;
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function parseCustomHttpActions(
  value: unknown,
  allowedPathPrefixes: readonly string[],
): CustomHttpActionDefinition[] {
  const parsed =
    typeof value === "string" ? parseJson(value) : value;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("actions must be a non-empty JSON array");
  }

  const actionNames = new Set<string>();

  return parsed.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`actions[${index}] must be an object`);
    }

    const name = normalizeActionName(
      normalizeString(entry.name) || normalizeString(entry.operationId),
    );
    if (!name) {
      throw new Error(`actions[${index}].name is required`);
    }
    if (actionNames.has(name)) {
      throw new Error(`Duplicate custom HTTP action name: ${name}`);
    }
    actionNames.add(name);

    const path = normalizePathPrefix(normalizeString(entry.path));
    if (!path || path === "/") {
      throw new Error(`actions[${index}].path is required`);
    }

    if (
      allowedPathPrefixes.length > 0 &&
      !allowedPathPrefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    ) {
      throw new Error(`actions[${index}].path must stay inside allowedPathPrefixes`);
    }

    const readOnly =
      entry.readOnly === undefined ? true : entry.readOnly === true;
    if (!readOnly) {
      throw new Error(`actions[${index}] must be marked readOnly: true`);
    }

    return {
      name,
      description: normalizeString(entry.description) || null,
      method: parseMethod(entry.method ?? "GET"),
      path,
      readOnly: true,
      queryDefaults: normalizePrimitiveRecord(
        entry.queryDefaults,
        `actions[${index}].queryDefaults`,
      ),
      responseCollectionPath:
        normalizeString(entry.responseCollectionPath) || null,
      pathParamNames: parseStringArrayInput(entry.pathParamNames),
      queryParamNames: parseStringArrayInput(entry.queryParamNames),
      requiredQueryParamNames: parseStringArrayInput(
        entry.requiredQueryParamNames,
      ),
    };
  });
}

function parseAuthMode(input: unknown): CustomHttpAuthMode {
  const normalized = normalizeString(input).toLowerCase();
  if (!normalized || normalized === "none") return "none";
  if (
    normalized === "bearer" ||
    normalized === "header" ||
    normalized === "query"
  ) {
    return normalized;
  }
  throw new Error("authMode must be one of none, bearer, header, or query");
}

export function getCustomHttpCredentials(
  credentials: Record<string, unknown>,
): CustomHttpCredentials | null {
  const baseUrlRaw =
    normalizeString(credentials.baseUrl) ||
    normalizeString(credentials.apiBaseUrl);
  if (!baseUrlRaw) {
    return null;
  }

  const authMode = parseAuthMode(credentials.authMode);
  const authToken =
    normalizeString(credentials.authToken) ||
    normalizeString(credentials.token) ||
    normalizeString(credentials.apiKey) ||
    normalizeString(credentials.bearerToken);
  const authHeaderName = normalizeString(credentials.authHeaderName);
  const authQueryParam = normalizeString(credentials.authQueryParam);
  const allowedPathPrefixes = parseStringArrayInput(
    credentials.allowedPathPrefixes,
  ).map(normalizePathPrefix).filter(Boolean);

  const actions = parseCustomHttpActions(
    credentials.actions,
    allowedPathPrefixes,
  );

  if (authMode !== "none" && !authToken) {
    throw new Error("authToken is required when authMode is not none");
  }
  if (authMode === "header" && !authHeaderName) {
    throw new Error("authHeaderName is required when authMode is header");
  }
  if (authMode === "query" && !authQueryParam) {
    throw new Error("authQueryParam is required when authMode is query");
  }

  return {
    connectionLabel: normalizeString(credentials.connectionLabel) || undefined,
    baseUrl: normalizeCustomHttpBaseUrl(baseUrlRaw),
    authMode,
    authToken: authToken || undefined,
    authHeaderName: authHeaderName || undefined,
    authQueryParam: authQueryParam || undefined,
    defaultHeaders: parseStringRecordInput(
      credentials.defaultHeaders,
      "defaultHeaders",
    ),
    allowedPathPrefixes,
    actions,
    probePath: normalizePathPrefix(normalizeString(credentials.probePath)) || undefined,
  };
}

function buildRequestHeaders(credentials: CustomHttpCredentials) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...credentials.defaultHeaders,
  };

  if (credentials.authMode === "bearer" && credentials.authToken) {
    headers.Authorization = `Bearer ${credentials.authToken}`;
  }

  if (
    credentials.authMode === "header" &&
    credentials.authHeaderName &&
    credentials.authToken
  ) {
    headers[credentials.authHeaderName] = credentials.authToken;
  }

  return headers;
}

function getPathValue(input: unknown, path: string) {
  if (!path) return input;
  const parts = path.split(".");
  let current: unknown = input;
  for (const part of parts) {
    if (!isRecord(current) && !Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
}

function toPrimitiveRecord(
  value: unknown,
): Record<string, CustomHttpPrimitive> {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, CustomHttpPrimitive> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      output[key] = entry;
    }
  }
  return output;
}

function applyPathParams(
  template: string,
  pathParams: Record<string, CustomHttpPrimitive>,
) {
  return template.replace(/\{([^}]+)\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    const value = pathParams[key];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing required path param: ${key}`);
    }
    return encodeURIComponent(String(value));
  });
}

function applyAuthQueryParam(
  url: URL,
  credentials: CustomHttpCredentials,
) {
  if (
    credentials.authMode === "query" &&
    credentials.authQueryParam &&
    credentials.authToken
  ) {
    url.searchParams.set(credentials.authQueryParam, credentials.authToken);
  }
}

function getCustomHttpErrorMessage(status: number, payload: unknown) {
  if (status === 401 || status === 403) {
    return "Custom HTTP connector authentication failed. Verify the configured auth mode and token.";
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }

  if (isRecord(payload)) {
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return payload.error.trim();
    }
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message.trim();
    }
  }

  return `Custom HTTP request failed (${status})`;
}

async function customHttpRequest(
  credentials: CustomHttpCredentials,
  actionDefinition: CustomHttpActionDefinition,
  input: Record<string, unknown>,
) {
  const pathParams = toPrimitiveRecord(input.pathParams);
  const query = {
    ...(actionDefinition.queryDefaults ?? {}),
    ...toPrimitiveRecord(input.query),
  };
  const url = new URL(
    applyPathParams(actionDefinition.path, pathParams),
    `${credentials.baseUrl}/`,
  );

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  applyAuthQueryParam(url, credentials);

  const method = actionDefinition.method;
  const headers = buildRequestHeaders(credentials);

  const response = await fetchWithTimeoutAndRetry(
    url,
    {
      method,
      headers,
      cache: "no-store",
    },
    {
      timeoutMs: DEFAULT_CUSTOM_HTTP_TIMEOUT_MS,
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
    throw new Error(getCustomHttpErrorMessage(response.status, payload));
  }

  return payload;
}

export async function validateCustomHttpConnection(
  credentialsRecord: Record<string, unknown>,
) {
  const credentials = getCustomHttpCredentials(credentialsRecord);
  if (!credentials) {
    throw new Error("baseUrl is required for custom_http");
  }

  let validationMode: "config_only" | "probe" = "config_only";

  if (credentials.probePath) {
    validationMode = "probe";
    const probeAction: CustomHttpActionDefinition = {
      name: "__probe__",
      description: null,
      method: "GET",
      path: credentials.probePath,
      readOnly: true,
    };
    await customHttpRequest(credentials, probeAction, {});
  }

  return {
    externalAccountId: credentials.baseUrl,
    metadata: {
      connectionLabel: credentials.connectionLabel ?? null,
      baseUrl: credentials.baseUrl,
      authMode: credentials.authMode,
      validationMode,
      allowedPathPrefixCount: credentials.allowedPathPrefixes.length,
      actionCount: credentials.actions.length,
      actionNames: credentials.actions.map((entry) => entry.name),
      importedFromSpecUrl: null,
    },
  };
}

function getCollectionPagination(
  input: Record<string, unknown>,
  totalCount: number,
) {
  const limit =
    typeof input.limit === "number" && Number.isInteger(input.limit) && input.limit > 0
      ? input.limit
      : totalCount;
  const offset =
    typeof input.offset === "number" && Number.isInteger(input.offset) && input.offset >= 0
      ? input.offset
      : typeof input.page === "number" && Number.isInteger(input.page) && input.page > 0
        ? (input.page - 1) * limit
        : 0;

  return { limit, offset };
}

export async function executeConfiguredCustomHttpAction(
  provider: "custom_http" | "custom_openapi",
  connection: {
    id: string;
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const credentials = getCustomHttpCredentials(connection.credentials);
  if (!credentials) {
    return {
      status: 400,
      body: { error: `${provider} credentials are incomplete` },
    };
  }

  if (action === "list_actions") {
    return {
      status: 200,
      body: {
        provider,
        action,
        connectionId: connection.id,
        connectionLabel:
          (credentials.connectionLabel ??
            normalizeString(connection.metadata?.connectionLabel)) ||
          null,
        count: credentials.actions.length,
        actions: credentials.actions.map((entry) => ({
          name: entry.name,
          description: entry.description,
          method: entry.method,
          path: entry.path,
          responseCollectionPath: entry.responseCollectionPath ?? null,
          pathParamNames: entry.pathParamNames ?? [],
          queryParamNames: entry.queryParamNames ?? [],
          requiredQueryParamNames: entry.requiredQueryParamNames ?? [],
        })),
      },
    };
  }

  if (action !== "call_action") {
    return {
      status: 400,
      body: { error: `Unsupported ${provider} action: ${action}` },
    };
  }

  const actionName =
    normalizeString(payload.actionName) ||
    normalizeString(payload.name);
  if (!actionName) {
    return {
      status: 400,
      body: { error: "input.actionName is required" },
    };
  }

  const definition = credentials.actions.find((entry) => entry.name === actionName);
  if (!definition) {
    return {
      status: 400,
      body: {
        error: `Unknown custom action: ${actionName}`,
        supportedActions: credentials.actions.map((entry) => entry.name),
      },
    };
  }

  try {
    const rawResult = await customHttpRequest(credentials, definition, payload);
    const collectionCandidate =
      definition.responseCollectionPath
        ? getPathValue(rawResult, definition.responseCollectionPath)
        : Array.isArray(rawResult)
          ? rawResult
          : null;

    if (Array.isArray(collectionCandidate)) {
      const { limit, offset } = getCollectionPagination(
        payload,
        collectionCandidate.length,
      );
      const items = collectionCandidate.slice(offset, offset + limit);
      const nextOffset =
        offset + items.length < collectionCandidate.length
          ? offset + items.length
          : null;
      return {
        status: 200,
        body: {
          provider,
          action,
          actionName,
          connectionId: connection.id,
          connectionLabel:
            (credentials.connectionLabel ??
              normalizeString(connection.metadata?.connectionLabel)) ||
            null,
          count: collectionCandidate.length,
          returnedCount: items.length,
          limit,
          offset,
          hasMore: nextOffset !== null,
          nextOffset,
          items,
        },
      };
    }

    return {
      status: 200,
      body: {
        provider,
        action,
        actionName,
        connectionId: connection.id,
        connectionLabel:
          (credentials.connectionLabel ??
            normalizeString(connection.metadata?.connectionLabel)) ||
          null,
        result: rawResult,
      },
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        error:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : `${provider} request failed`,
      },
    };
  }
}

export async function executeCustomHttpAction(
  connection: {
    id: string;
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  return executeConfiguredCustomHttpAction(
    "custom_http",
    connection,
    action,
    input,
  );
}
