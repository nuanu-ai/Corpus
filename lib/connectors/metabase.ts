import { readFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";

import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const METABASE_TIMEOUT_MS = 15_000;
const DEFAULT_METABASE_LIMIT = 25;
const MAX_METABASE_LIMIT = 100;

export type MetabaseCredentials = {
  baseUrl: string;
  apiKey: string;
};

type MetabaseMtlsPaths = {
  certPath: string;
  keyPath: string;
};

type MetabaseRawResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
};

let metabaseMtlsAgentCache:
  | {
      cacheKey: string;
      agent: HttpsAgent;
    }
  | null = null;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeMetabaseBaseUrl(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Metabase base URL must use http or https");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export function getMetabaseCredentials(
  credentials: Record<string, unknown>,
): MetabaseCredentials | null {
  const baseUrlRaw =
    normalizeString(credentials.baseUrl) || normalizeString(credentials.siteUrl);
  const apiKey =
    normalizeString(credentials.apiKey) || normalizeString(credentials.token);

  if (!baseUrlRaw || !apiKey) {
    return null;
  }

  return {
    baseUrl: normalizeMetabaseBaseUrl(baseUrlRaw),
    apiKey,
  };
}

function extractFetchErrorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") {
      return null;
    }

    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code.trim().length > 0) {
      return code.trim();
    }

    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

function getMetabaseMtlsPaths(): MetabaseMtlsPaths | null {
  const certPath = normalizeString(process.env.METABASE_CERT_PATH);
  const keyPath = normalizeString(process.env.METABASE_KEY_PATH);

  if (!certPath && !keyPath) {
    return null;
  }

  if (!certPath || !keyPath) {
    throw new Error(
      "Metabase mTLS is partially configured. Set both METABASE_CERT_PATH and METABASE_KEY_PATH on Corpus runtime.",
    );
  }

  return { certPath, keyPath };
}

async function getMetabaseMtlsAgent(): Promise<HttpsAgent | null> {
  const paths = getMetabaseMtlsPaths();
  if (!paths) {
    return null;
  }

  const cacheKey = `${paths.certPath}::${paths.keyPath}`;
  if (metabaseMtlsAgentCache?.cacheKey === cacheKey) {
    return metabaseMtlsAgentCache.agent;
  }

  const [cert, key] = await Promise.all([
    readFile(paths.certPath),
    readFile(paths.keyPath),
  ]);

  const agent = new HttpsAgent({
    cert,
    key,
    keepAlive: true,
  });

  metabaseMtlsAgentCache = { cacheKey, agent };
  return agent;
}

function metabaseTransportErrorMessage(err: unknown, baseUrl: string) {
  if (err instanceof Error && err.name === "AbortError") {
    return `Metabase request timed out after ${METABASE_TIMEOUT_MS}ms (${baseUrl})`;
  }

  const code = extractFetchErrorCode(err);
  const rawMessage = err instanceof Error ? err.message : String(err);
  const message = rawMessage.toLowerCase();

  if (message.includes("metabase mtls is partially configured")) {
    return rawMessage;
  }

  if (code === "ENOENT" || code === "EACCES") {
    return "Configured Metabase client certificate files could not be read. Check METABASE_CERT_PATH and METABASE_KEY_PATH on Corpus runtime.";
  }

  if (
    code === "ECONNRESET" ||
    code === "UND_ERR_SOCKET" ||
    message.includes("socket hang up") ||
    message.includes("connection reset") ||
    message.includes("client certificate") ||
    message.includes("certificate required")
  ) {
    return `Metabase transport failed before any HTTP response. ${baseUrl} appears to require a client TLS certificate (mTLS) or a network allowlist from the Corpus runtime.`;
  }

  return `Metabase request failed: ${rawMessage}`;
}

function extractMetabaseErrorMessage(payload: unknown, status: number) {
  if (status === 401 || status === 403) {
    return "Metabase API key authentication failed. Reconnect Metabase with a valid API key.";
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }

  if (isRecord(payload)) {
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message;
    }
    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return payload.error;
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const first = payload.errors[0];
      if (typeof first === "string" && first.trim().length > 0) {
        return first;
      }
      if (isRecord(first) && typeof first.message === "string" && first.message.trim().length > 0) {
        return first.message;
      }
    }
    if (isRecord(payload.data) && typeof payload.data.message === "string") {
      return payload.data.message;
    }
  }

  return `Metabase request failed (${status})`;
}

function getLimit(input: Record<string, unknown>, fallback = DEFAULT_METABASE_LIMIT) {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_METABASE_LIMIT);
}

function getOffset(input: Record<string, unknown>) {
  if (typeof input.offset !== "number" || !Number.isInteger(input.offset)) {
    return 0;
  }
  return Math.max(input.offset, 0);
}

function normalizeEntityId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function pickId(input: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const resolved = normalizeEntityId(input[key]);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function listFromPayload(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }

  if (!isRecord(payload)) {
    return [];
  }

  if (Array.isArray(payload.data)) {
    return payload.data.filter(isRecord);
  }
  if (Array.isArray(payload.items)) {
    return payload.items.filter(isRecord);
  }
  if (Array.isArray(payload.results)) {
    return payload.results.filter(isRecord);
  }

  return [];
}

function paginateItems<T>(items: T[], offset: number, limit: number) {
  const paged = items.slice(offset, offset + limit);
  return {
    paged,
    totalCount: items.length,
    returnedCount: paged.length,
    hasMore: offset + paged.length < items.length,
    nextOffset: offset + paged.length < items.length ? offset + paged.length : null,
  };
}

function readNestedId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return normalizeEntityId(value.id);
}

function matchesCollectionFilter(
  entity: Record<string, unknown>,
  collectionId: string | null,
) {
  if (!collectionId) {
    return true;
  }

  const direct =
    normalizeEntityId(entity.collection_id) ??
    normalizeEntityId(entity.collectionId) ??
    readNestedId(entity.collection);

  return direct === collectionId;
}

function matchesDatabaseFilter(entity: Record<string, unknown>, databaseId: string | null) {
  if (!databaseId) {
    return true;
  }

  const direct =
    normalizeEntityId(entity.database_id) ??
    normalizeEntityId(entity.databaseId) ??
    readNestedId(entity.database);

  return direct === databaseId;
}

function matchesArchivedFilter(entity: Record<string, unknown>, archived: boolean | null) {
  if (archived == null) {
    return true;
  }
  return Boolean(entity.archived) === archived;
}

function matchesModelFilter(entity: Record<string, unknown>, models: Set<string> | null) {
  if (!models || models.size === 0) {
    return true;
  }

  const model =
    normalizeString(entity.model) ||
    normalizeString(entity.model_type) ||
    normalizeString(entity.modelType);

  return model ? models.has(model.toLowerCase()) : false;
}

async function metabaseRequestWithMtls(
  url: URL,
  apiKey: string,
): Promise<MetabaseRawResponse> {
  const agent = await getMetabaseMtlsAgent();
  if (!agent) {
    throw new Error("Metabase mTLS agent is not configured");
  }

  if (url.protocol !== "https:") {
    throw new Error("Metabase mTLS requires an https base URL");
  }

  return await new Promise<MetabaseRawResponse>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-Key": apiKey,
        },
        agent,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );

    request.on("error", reject);
    request.setTimeout(METABASE_TIMEOUT_MS, () => {
      const timeoutError = new Error(
        `Metabase request timed out after ${METABASE_TIMEOUT_MS}ms (${url.origin})`,
      );
      timeoutError.name = "AbortError";
      request.destroy(timeoutError);
    });
    request.end();
  });
}

async function metabaseRequest<T>(
  credentials: MetabaseCredentials,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const sanitizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(credentials.baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}${sanitizedPath}`.replace(/\/{2,}/g, "/");
  url.search = "";

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let status: number;
  let text: string;
  try {
    if (getMetabaseMtlsPaths()) {
      const mtlsResponse = await metabaseRequestWithMtls(url, credentials.apiKey);
      status = mtlsResponse.status;
      text = mtlsResponse.text;
    } else {
      const response = await fetchWithTimeoutAndRetry(
        url,
        {
          headers: {
            Accept: "application/json",
            "X-API-Key": credentials.apiKey,
          },
          cache: "no-store",
        },
        {
          timeoutMs: METABASE_TIMEOUT_MS,
          maxRetriesOn429: 1,
        },
      );
      status = response.status;
      text = await response.text();
    }
  } catch (err) {
    throw new Error(metabaseTransportErrorMessage(err, credentials.baseUrl));
  }

  let payload: unknown = null;
  try {
    payload = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    payload = text;
  }

  if (status < 200 || status >= 300) {
    throw new Error(extractMetabaseErrorMessage(payload, status));
  }

  return payload as T;
}

export async function validateMetabaseConnection(credentials: Record<string, unknown>) {
  const normalized = getMetabaseCredentials(credentials);
  if (!normalized) {
    throw new Error("Metabase credentials are incomplete");
  }

  const collections = await metabaseRequest<unknown>(normalized, "/api/collection");

  return {
    externalAccountId: normalized.baseUrl,
    metadata: {
      authMode: "api_key",
      baseUrl: normalized.baseUrl,
      accessibleCollectionCount: listFromPayload(collections).length,
    },
  };
}

export async function executeMetabaseAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getMetabaseCredentials(connection.credentials);
  if (!credentials) {
    return {
      status: 400,
      body: { error: "Metabase credentials are incomplete" },
    };
  }

  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const limit = getLimit(payload);
  const offset = getOffset(payload);

  if (action === "list_collections") {
    const archived =
      typeof payload.archived === "boolean" ? payload.archived : null;
    const collections = listFromPayload(
      await metabaseRequest<unknown>(credentials, "/api/collection"),
    ).filter((collection) => matchesArchivedFilter(collection, archived));
    const page = paginateItems(collections, offset, limit);

    return {
      status: 200,
      body: {
        provider: "metabase",
        action,
        totalCount: page.totalCount,
        count: page.returnedCount,
        returnedCount: page.returnedCount,
        limit,
        offset,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
        collections: page.paged,
      },
    };
  }

  if (action === "get_collection") {
    const collectionId = pickId(payload, ["collectionId", "id"]);
    if (!collectionId) {
      return {
        status: 400,
        body: { error: "input.collectionId is required" },
      };
    }

    const collection = await metabaseRequest<Record<string, unknown>>(
      credentials,
      `/api/collection/${encodeURIComponent(collectionId)}`,
    );

    if (payload.includeItems === true) {
      const items = listFromPayload(
        await metabaseRequest<unknown>(
          credentials,
          `/api/collection/${encodeURIComponent(collectionId)}/items`,
        ),
      );
      const itemsLimit =
        typeof payload.itemsLimit === "number" && Number.isInteger(payload.itemsLimit)
          ? Math.min(Math.max(payload.itemsLimit, 1), MAX_METABASE_LIMIT)
          : limit;
      const itemsOffset =
        typeof payload.itemsOffset === "number" && Number.isInteger(payload.itemsOffset)
          ? Math.max(payload.itemsOffset, 0)
          : 0;
      const page = paginateItems(items, itemsOffset, itemsLimit);

      return {
        status: 200,
        body: {
          provider: "metabase",
          action,
          collectionId,
          collection,
          items: page.paged,
          totalItems: page.totalCount,
          returnedItems: page.returnedCount,
          itemsLimit,
          itemsOffset,
          hasMoreItems: page.hasMore,
          nextItemsOffset: page.nextOffset,
        },
      };
    }

    return {
      status: 200,
      body: {
        provider: "metabase",
        action,
        collectionId,
        collection,
      },
    };
  }

  if (action === "list_dashboards") {
    const collectionId = pickId(payload, ["collectionId"]);
    const archived =
      typeof payload.archived === "boolean" ? payload.archived : null;
    const dashboards = listFromPayload(
      await metabaseRequest<unknown>(credentials, "/api/dashboard"),
    ).filter(
      (dashboard) =>
        matchesCollectionFilter(dashboard, collectionId) &&
        matchesArchivedFilter(dashboard, archived),
    );
    const page = paginateItems(dashboards, offset, limit);

    return {
      status: 200,
      body: {
        provider: "metabase",
        action,
        collectionId,
        totalCount: page.totalCount,
        count: page.returnedCount,
        returnedCount: page.returnedCount,
        limit,
        offset,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
        dashboards: page.paged,
      },
    };
  }

  if (action === "get_dashboard") {
    const dashboardId = pickId(payload, ["dashboardId", "id"]);
    if (!dashboardId) {
      return {
        status: 400,
        body: { error: "input.dashboardId is required" },
      };
    }

    const dashboard = await metabaseRequest<Record<string, unknown>>(
      credentials,
      `/api/dashboard/${encodeURIComponent(dashboardId)}`,
    );

    return {
      status: 200,
      body: {
        provider: "metabase",
        action,
        dashboardId,
        dashboard,
      },
    };
  }

  if (action === "list_cards") {
    const collectionId = pickId(payload, ["collectionId"]);
    const databaseId = pickId(payload, ["databaseId"]);
    const archived =
      typeof payload.archived === "boolean" ? payload.archived : null;
    const cards = listFromPayload(
      await metabaseRequest<unknown>(credentials, "/api/card"),
    ).filter(
      (card) =>
        matchesCollectionFilter(card, collectionId) &&
        matchesDatabaseFilter(card, databaseId) &&
        matchesArchivedFilter(card, archived),
    );
    const page = paginateItems(cards, offset, limit);

    return {
      status: 200,
      body: {
        provider: "metabase",
        action,
        collectionId,
        databaseId,
        totalCount: page.totalCount,
        count: page.returnedCount,
        returnedCount: page.returnedCount,
        limit,
        offset,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
        cards: page.paged,
      },
    };
  }

  if (action === "get_card") {
    const cardId = pickId(payload, ["cardId", "id"]);
    if (!cardId) {
      return {
        status: 400,
        body: { error: "input.cardId is required" },
      };
    }

    const card = await metabaseRequest<Record<string, unknown>>(
      credentials,
      `/api/card/${encodeURIComponent(cardId)}`,
    );

    return {
      status: 200,
      body: {
        provider: "metabase",
        action,
        cardId,
        card,
      },
    };
  }

  if (action === "list_databases") {
    const databases = listFromPayload(
      await metabaseRequest<unknown>(credentials, "/api/database"),
    );
    const page = paginateItems(databases, offset, limit);

    return {
      status: 200,
      body: {
        provider: "metabase",
        action,
        totalCount: page.totalCount,
        count: page.returnedCount,
        returnedCount: page.returnedCount,
        limit,
        offset,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
        databases: page.paged,
      },
    };
  }

  if (action === "search_content") {
    const query =
      normalizeString(payload.query) || normalizeString(payload.q);
    if (!query) {
      return {
        status: 400,
        body: { error: "input.query is required" },
      };
    }

    const modelInput = payload.models;
    const models =
      Array.isArray(modelInput) && modelInput.length > 0
        ? new Set(
            modelInput
              .map((value) => normalizeString(value).toLowerCase())
              .filter(Boolean),
          )
        : typeof payload.model === "string" && payload.model.trim().length > 0
          ? new Set([payload.model.trim().toLowerCase()])
          : null;
    const collectionId = pickId(payload, ["collectionId"]);
    const rawResults = listFromPayload(
      await metabaseRequest<unknown>(credentials, "/api/search", { q: query }),
    );
    const results = rawResults.filter(
      (entry) =>
        matchesModelFilter(entry, models) &&
        matchesCollectionFilter(entry, collectionId),
    );
    const page = paginateItems(results, offset, limit);

    return {
      status: 200,
      body: {
        provider: "metabase",
        action,
        query,
        models: models ? Array.from(models) : null,
        collectionId,
        totalCount: page.totalCount,
        count: page.returnedCount,
        returnedCount: page.returnedCount,
        limit,
        offset,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
        results: page.paged,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported Metabase action: ${action}` },
  };
}
