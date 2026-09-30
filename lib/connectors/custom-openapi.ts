import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";
import {
  executeConfiguredCustomHttpAction,
  normalizeCustomHttpBaseUrl,
  type CustomHttpActionDefinition,
} from "@/lib/connectors/custom-http";

const DEFAULT_OPENAPI_TIMEOUT_MS = 15_000;

type CustomOpenApiCredentials = {
  connectionLabel?: string;
  specUrl: string;
  baseUrl: string;
  authMode?: string;
  authToken?: string;
  authHeaderName?: string;
  authQueryParam?: string;
  defaultHeaders?: string;
  actions: CustomHttpActionDefinition[];
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
    return value.map((entry) => normalizeString(entry)).filter(Boolean);
  }

  const text = normalizeString(value);
  if (!text) {
    return [];
  }

  try {
    const parsed = parseJson(text);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => normalizeString(entry)).filter(Boolean);
    }
  } catch {
    // Fall through to line-based parsing.
  }

  return text
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeActionName(input: string) {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return normalized.replace(/^_+|_+$/g, "");
}

function normalizePath(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeSpecUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("specUrl is required");
  }

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OpenAPI spec URL must use http or https");
  }

  return url.toString();
}

function buildSpecFetchHeaders(credentials: Record<string, unknown>) {
  const authMode = normalizeString(credentials.authMode).toLowerCase();
  const token =
    normalizeString(credentials.authToken) ||
    normalizeString(credentials.token) ||
    normalizeString(credentials.apiKey) ||
    normalizeString(credentials.bearerToken);
  const authHeaderName = normalizeString(credentials.authHeaderName);

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (normalizeString(credentials.defaultHeaders)) {
    const parsed = parseJson(normalizeString(credentials.defaultHeaders));
    if (!isRecord(parsed)) {
      throw new Error("defaultHeaders must be a JSON object");
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        headers[key] = String(value);
      }
    }
  }

  if (authMode === "bearer" && token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (authMode === "header" && token && authHeaderName) {
    headers[authHeaderName] = token;
  }

  return headers;
}

async function fetchOpenApiSpec(specUrl: string, headers: Record<string, string>) {
  const response = await fetchWithTimeoutAndRetry(
    specUrl,
    {
      method: "GET",
      headers,
      cache: "no-store",
    },
    {
      timeoutMs: DEFAULT_OPENAPI_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      text.trim().length > 0
        ? text.trim()
        : `OpenAPI spec request failed (${response.status})`,
    );
  }

  try {
    return parseJson(text);
  } catch {
    throw new Error("Custom OpenAPI currently supports JSON specs only");
  }
}

function deriveBaseUrlFromSpec(spec: Record<string, unknown>, fallback?: string) {
  if (fallback) {
    return normalizeCustomHttpBaseUrl(fallback);
  }

  const servers = spec.servers;
  if (Array.isArray(servers) && servers.length > 0) {
    const first = servers[0];
    if (isRecord(first) && typeof first.url === "string" && first.url.trim().length > 0) {
      return normalizeCustomHttpBaseUrl(first.url);
    }
  }

  throw new Error("OpenAPI spec does not define a usable server URL; provide baseUrl explicitly");
}

function collectOperationParameterNames(operation: Record<string, unknown>) {
  const pathParamNames: string[] = [];
  const queryParamNames: string[] = [];
  const requiredQueryParamNames: string[] = [];
  const parameters = operation.parameters;

  if (!Array.isArray(parameters)) {
    return {
      pathParamNames,
      queryParamNames,
      requiredQueryParamNames,
    };
  }

  for (const parameter of parameters) {
    if (!isRecord(parameter)) {
      continue;
    }

    const name = normalizeString(parameter.name);
    const location = normalizeString(parameter.in).toLowerCase();
    if (!name) {
      continue;
    }

    if (location === "path") {
      pathParamNames.push(name);
      continue;
    }

    if (location === "query") {
      queryParamNames.push(name);
      if (parameter.required === true) {
        requiredQueryParamNames.push(name);
      }
    }
  }

  return {
    pathParamNames: Array.from(new Set(pathParamNames)),
    queryParamNames: Array.from(new Set(queryParamNames)),
    requiredQueryParamNames: Array.from(new Set(requiredQueryParamNames)),
  };
}

function buildActionsFromSpec(
  spec: Record<string, unknown>,
  allowedOperationIds: readonly string[],
): CustomHttpActionDefinition[] {
  const paths = spec.paths;
  if (!isRecord(paths)) {
    throw new Error("OpenAPI spec is missing paths");
  }

  const allowed = new Set(
    allowedOperationIds.map((entry) => entry.trim()).filter(Boolean),
  );

  const actions: CustomHttpActionDefinition[] = [];
  for (const [rawPath, entry] of Object.entries(paths)) {
    if (!isRecord(entry)) {
      continue;
    }
    const operation = entry.get;
    if (!isRecord(operation)) {
      continue;
    }

    const operationId =
      normalizeString(operation.operationId) ||
      normalizeActionName(`get_${rawPath}`);
    if (allowed.size > 0 && !allowed.has(operationId)) {
      continue;
    }

    const parameterNames = collectOperationParameterNames(operation);
    actions.push({
      name: normalizeActionName(operationId),
      description:
        normalizeString(operation.summary) ||
        normalizeString(operation.description) ||
        null,
      method: "GET",
      path: normalizePath(rawPath),
      readOnly: true,
      pathParamNames: parameterNames.pathParamNames,
      queryParamNames: parameterNames.queryParamNames,
      requiredQueryParamNames: parameterNames.requiredQueryParamNames,
    });
  }

  if (actions.length === 0) {
    throw new Error("No allowed read-only GET operations were found in the OpenAPI spec");
  }

  return actions;
}

export async function getCustomOpenApiCredentials(
  credentials: Record<string, unknown>,
): Promise<CustomOpenApiCredentials | null> {
  const specUrlRaw =
    normalizeString(credentials.specUrl) ||
    normalizeString(credentials.openapiUrl);
  if (!specUrlRaw) {
    return null;
  }

  const specUrl = normalizeSpecUrl(specUrlRaw);
  const spec = await fetchOpenApiSpec(specUrl, buildSpecFetchHeaders(credentials));
  if (!isRecord(spec)) {
    throw new Error("OpenAPI spec must be a JSON object");
  }

  const allowedOperationIds = parseStringArrayInput(
    credentials.allowedOperationIds,
  );
  const actions = buildActionsFromSpec(spec, allowedOperationIds);
  const baseUrl = deriveBaseUrlFromSpec(
    spec,
    normalizeString(credentials.baseUrl) || undefined,
  );

  return {
    connectionLabel: normalizeString(credentials.connectionLabel) || undefined,
    specUrl,
    baseUrl,
    authMode: normalizeString(credentials.authMode) || "none",
    authToken:
      normalizeString(credentials.authToken) ||
      normalizeString(credentials.token) ||
      normalizeString(credentials.apiKey) ||
      normalizeString(credentials.bearerToken) ||
      undefined,
    authHeaderName: normalizeString(credentials.authHeaderName) || undefined,
    authQueryParam: normalizeString(credentials.authQueryParam) || undefined,
    defaultHeaders: normalizeString(credentials.defaultHeaders) || undefined,
    actions,
  };
}

export async function validateCustomOpenApiConnection(
  credentialsRecord: Record<string, unknown>,
) {
  const credentials = await getCustomOpenApiCredentials(credentialsRecord);
  if (!credentials) {
    throw new Error("specUrl is required for custom_openapi");
  }

  return {
    externalAccountId: credentials.baseUrl,
    credentials: {
      connectionLabel: credentials.connectionLabel,
      baseUrl: credentials.baseUrl,
      authMode: credentials.authMode,
      authToken: credentials.authToken,
      authHeaderName: credentials.authHeaderName,
      authQueryParam: credentials.authQueryParam,
      defaultHeaders: credentials.defaultHeaders,
      allowedPathPrefixes: Array.from(
        new Set(credentials.actions.map((entry) => normalizePath(entry.path).split("/{")[0] || "/")),
      ),
      actions: credentials.actions,
      importedFromSpecUrl: credentials.specUrl,
      probePath: undefined,
    },
    metadata: {
      connectionLabel: credentials.connectionLabel ?? null,
      baseUrl: credentials.baseUrl,
      importedFromSpecUrl: credentials.specUrl,
      importedOperationCount: credentials.actions.length,
      actionNames: credentials.actions.map((entry) => entry.name),
      validationMode: "spec_import",
    },
  };
}

export async function executeCustomOpenApiAction(
  connection: {
    id: string;
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  return executeConfiguredCustomHttpAction(
    "custom_openapi",
    connection,
    action,
    input,
  );
}
