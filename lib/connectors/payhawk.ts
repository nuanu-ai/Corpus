import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

export type PayhawkCredentials = {
  apiKey: string;
  baseUrl: string;
  accountId?: string;
};
const PAYHAWK_TIMEOUT_MS = 15_000;
const PAYHAWK_LOCAL_SCAN_PAGE_SIZE = 500;
const PAYHAWK_PAGINATION_GUARD_PAGES = 10_000;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value: string): string {
  const candidate = value.trim();
  if (!candidate) {
    return "https://api.payhawk.com";
  }
  const url = new URL(candidate);
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function getPayhawkCredentials(
  credentials: Record<string, unknown>,
): PayhawkCredentials | null {
  const apiKey = normalizeString(credentials.apiKey);
  const accountId = normalizeString(credentials.accountId);
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(normalizeString(credentials.baseUrl)),
    ...(accountId ? { accountId } : {}),
  };
}

async function payhawkRequest(
  credentialsRecord: Record<string, unknown>,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
) {
  const credentials = getPayhawkCredentials(credentialsRecord);
  if (!credentials) {
    throw new Error("Payhawk credentials are incomplete");
  }

  const sanitizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${credentials.baseUrl}${sanitizedPath}`);
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
        "X-Payhawk-ApiKey": credentials.apiKey,
      },
      cache: "no-store",
    },
    {
      timeoutMs: PAYHAWK_TIMEOUT_MS,
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
    throw new Error(
      typeof payload === "string"
        ? payload
        : `Payhawk request failed (${response.status})`,
    );
  }

  return payload;
}

function resolvePayhawkAccountId(
  payload: Record<string, unknown>,
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
) {
  const payloadAccountId = normalizeString(payload.accountId);
  if (payloadAccountId) {
    return payloadAccountId;
  }

  const metadataAccountId =
    connection.metadata && typeof connection.metadata.accountId === "string"
      ? normalizeString(connection.metadata.accountId)
      : "";
  if (metadataAccountId) {
    return metadataAccountId;
  }

  const credentials = getPayhawkCredentials(connection.credentials);
  return credentials?.accountId ?? "";
}

function isAllowedPayhawkResourcePath(path: string, accountId: string): boolean {
  if (!accountId) return false;
  if (!path.startsWith("/")) return false;
  if (path.includes("..") || path.includes("//")) return false;
  const accountPrefix = `/api/v3/accounts/${encodeURIComponent(accountId)}/`;
  return path.startsWith(accountPrefix);
}

function serializePayhawkQueryValue(
  value: unknown,
): string | number | boolean | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return JSON.stringify(value);
  }
  return undefined;
}

function resolveRequestedLimit(payload: Record<string, unknown>, fallback = 100): number {
  if (typeof payload.limit === "number" && Number.isInteger(payload.limit)) {
    return Math.max(payload.limit, 1);
  }
  if (typeof payload.take === "number" && Number.isInteger(payload.take)) {
    return Math.max(payload.take, 1);
  }
  return fallback;
}

function resolveRequestedOffset(payload: Record<string, unknown>, fallback = 0): number {
  if (typeof payload.offset === "number" && Number.isInteger(payload.offset)) {
    return Math.max(payload.offset, 0);
  }
  if (typeof payload.skip === "number" && Number.isInteger(payload.skip)) {
    return Math.max(payload.skip, 0);
  }
  return fallback;
}

function shouldFetchAllPayhawkPages(payload: Record<string, unknown>) {
  return payload.fetchAll !== false;
}

function normalizePayhawkDateBoundary(value: string, endOfDay: boolean) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return endOfDay
      ? `${trimmed}T23:59:59.999Z`
      : `${trimmed}T00:00:00.000Z`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }

  return parsed.toISOString();
}

function buildPayhawkExpenseDateFilter(payload: Record<string, unknown>) {
  const startDate = normalizeString(payload.startDate);
  const endDate = normalizeString(payload.endDate);
  if (!startDate && !endDate) {
    return null;
  }

  const clauses: Array<Record<string, Record<string, string>>> = [];
  if (startDate) {
    clauses.push({
      "document.documentDate": {
        $greaterThanEqual: normalizePayhawkDateBoundary(startDate, false),
      },
    });
  }
  if (endDate) {
    clauses.push({
      "document.documentDate": {
        $lessThanEqual: normalizePayhawkDateBoundary(endDate, true),
      },
    });
  }

  if (clauses.length === 0) {
    return null;
  }

  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

function extractPayhawkExpenseDate(expense: Record<string, unknown>): string | null {
  const document =
    expense.document && typeof expense.document === "object" && !Array.isArray(expense.document)
      ? (expense.document as Record<string, unknown>)
      : null;

  const candidates = [
    document ? normalizeString(document.documentDate) : "",
    normalizeString(expense.settledAt),
    normalizeString(expense.createdAt),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return null;
}

function matchesPayhawkExpenseDateRange(
  expense: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  const selectedDate = extractPayhawkExpenseDate(expense);
  if (!selectedDate) {
    return false;
  }

  const selectedMs = Date.parse(selectedDate);
  if (Number.isNaN(selectedMs)) {
    return false;
  }

  const startDate = normalizeString(payload.startDate);
  if (startDate) {
    const startMs = Date.parse(normalizePayhawkDateBoundary(startDate, false));
    if (!Number.isNaN(startMs) && selectedMs < startMs) {
      return false;
    }
  }

  const endDate = normalizeString(payload.endDate);
  if (endDate) {
    const endMs = Date.parse(normalizePayhawkDateBoundary(endDate, true));
    if (!Number.isNaN(endMs) && selectedMs > endMs) {
      return false;
    }
  }

  return true;
}

function buildPayhawkQuery(
  payload: Record<string, unknown>,
  options?: {
    limitFallback?: number;
    offsetFallback?: number;
    includePagination?: boolean;
  },
) {
  const query =
    payload.query && typeof payload.query === "object"
      ? Object.entries(payload.query as Record<string, unknown>).reduce<
          Record<string, string | number | boolean | undefined>
        >((acc, [key, value]) => {
          const serialized = serializePayhawkQueryValue(value);
          if (serialized !== undefined) {
            acc[key] = serialized;
          }
          return acc;
        }, {})
      : {};

  if (options?.includePagination) {
    const limit =
      typeof payload.limit === "number" && Number.isInteger(payload.limit)
        ? Math.max(payload.limit, 1)
        : typeof payload.take === "number" && Number.isInteger(payload.take)
          ? Math.max(payload.take, 1)
          : options.limitFallback ?? 100;
    const offset =
      typeof payload.offset === "number" && Number.isInteger(payload.offset)
        ? Math.max(payload.offset, 0)
        : typeof payload.skip === "number" && Number.isInteger(payload.skip)
          ? Math.max(payload.skip, 0)
          : options.offsetFallback ?? 0;

    if (query["$take"] === undefined && query.take === undefined) {
      query["$take"] = limit;
    }
    if (query["$skip"] === undefined && query.skip === undefined) {
      query["$skip"] = offset;
    }
  }

  if (
    payload.filter !== undefined &&
    query["$filter"] === undefined &&
    query.filter === undefined
  ) {
    const filter = serializePayhawkQueryValue(payload.filter);
    if (filter !== undefined) {
      query["$filter"] = filter;
    }
  }

  if (payload.orderBy !== undefined && query.orderBy === undefined) {
    const orderBy = serializePayhawkQueryValue(payload.orderBy);
    if (orderBy !== undefined) {
      query.orderBy = orderBy;
    }
  }

  return query;
}

function isPayhawkBadRequestError(error: unknown) {
  return error instanceof Error && /Payhawk request failed \(400\)/.test(error.message);
}

async function listPayhawkExpensesWithLocalDateRange(
  credentialsRecord: Record<string, unknown>,
  accountId: string,
  payload: Record<string, unknown>,
) {
  const requestedLimit = resolveRequestedLimit(payload, 100);
  const requestedOffset = resolveRequestedOffset(payload, 0);
  const pageSize = Math.max(requestedLimit, PAYHAWK_LOCAL_SCAN_PAGE_SIZE);
  const baseQuery = buildPayhawkQuery(payload);
  delete baseQuery["$take"];
  delete baseQuery.take;
  delete baseQuery["$skip"];
  delete baseQuery.skip;
  delete baseQuery["$filter"];
  delete baseQuery.filter;

  const matchedExpenses: Record<string, unknown>[] = [];
  const seenExpenseIds = new Set<string>();
  let scannedExpenses = 0;
  let scanIncomplete = true;
  let fetchedPages = 0;

  for (
    let pageIndex = 0, offset = 0;
    pageIndex < PAYHAWK_PAGINATION_GUARD_PAGES;
    pageIndex += 1, offset += pageSize
  ) {
    fetchedPages += 1;
    const result = await payhawkRequest(
      credentialsRecord,
      `/api/v3/accounts/${encodeURIComponent(accountId)}/expenses`,
      {
        ...baseQuery,
        $take: pageSize,
        $skip: offset,
      },
    );
    const expenses = extractPayhawkCollection(result) ?? [];
    scannedExpenses += expenses.length;

    if (expenses.length === 0) {
      scanIncomplete = false;
      break;
    }

    for (const expense of expenses) {
      const expenseId = normalizeString(expense.id);
      if (expenseId) {
        if (seenExpenseIds.has(expenseId)) continue;
        seenExpenseIds.add(expenseId);
      }

      if (matchesPayhawkExpenseDateRange(expense, payload)) {
        matchedExpenses.push(expense);
      }
    }
  }

  const expenses = matchedExpenses.slice(
    requestedOffset,
    requestedOffset + requestedLimit,
  );

  return {
    status: 200,
    body: {
      provider: "payhawk",
      action: "list_expenses",
      accountId,
      count: expenses.length,
      returnedCount: expenses.length,
      matchingCount: matchedExpenses.length,
      limit: requestedLimit,
      offset: requestedOffset,
      hasMore:
        requestedOffset + expenses.length < matchedExpenses.length || scanIncomplete,
      nextOffset:
        requestedOffset + expenses.length < matchedExpenses.length || scanIncomplete
          ? requestedOffset + expenses.length
          : null,
      dateRangeApplied: {
        mode: "local_scan",
        startDate: normalizeString(payload.startDate) || null,
        endDate: normalizeString(payload.endDate) || null,
        dateFieldPriority: ["document.documentDate", "settledAt", "createdAt"],
        scannedExpenses,
        fetchedPages,
        scanIncomplete,
      },
      expenses,
    },
  };
}

async function listPayhawkExpensesExhaustively(
  credentialsRecord: Record<string, unknown>,
  accountId: string,
  payload: Record<string, unknown>,
) {
  const pageSize = resolveRequestedLimit(payload, PAYHAWK_LOCAL_SCAN_PAGE_SIZE);
  const initialOffset = resolveRequestedOffset(payload, 0);
  const baseQuery = buildPayhawkQuery(payload);
  delete baseQuery["$take"];
  delete baseQuery.take;
  delete baseQuery["$skip"];
  delete baseQuery.skip;

  const expenseDateFilter = buildPayhawkExpenseDateFilter(payload);
  if (
    expenseDateFilter &&
    baseQuery["$filter"] === undefined &&
    baseQuery.filter === undefined
  ) {
    const serialized = serializePayhawkQueryValue(expenseDateFilter);
    if (typeof serialized === "string") {
      baseQuery["$filter"] = serialized;
    }
  }

  const expenses: Record<string, unknown>[] = [];
  const seenExpenseIds = new Set<string>();
  let fetchedPages = 0;
  let traversalIncomplete = true;

  for (
    let pageIndex = 0, offset = initialOffset;
    pageIndex < PAYHAWK_PAGINATION_GUARD_PAGES;
    pageIndex += 1, offset += pageSize
  ) {
    fetchedPages += 1;
    const result = await payhawkRequest(
      credentialsRecord,
      `/api/v3/accounts/${encodeURIComponent(accountId)}/expenses`,
      {
        ...baseQuery,
        $take: pageSize,
        $skip: offset,
      },
    );
    const page = extractPayhawkCollection(result) ?? [];
    if (page.length === 0) {
      traversalIncomplete = false;
      break;
    }

    for (const expense of page) {
      const expenseId = normalizeString(expense.id);
      if (expenseId) {
        if (seenExpenseIds.has(expenseId)) continue;
        seenExpenseIds.add(expenseId);
      }
      expenses.push(expense);
    }

    if (page.length < pageSize) {
      traversalIncomplete = false;
      break;
    }
  }

  return {
    status: 200,
    body: {
      provider: "payhawk",
      action: "list_expenses",
      accountId,
      count: expenses.length,
      returnedCount: expenses.length,
      limit: pageSize,
      offset: initialOffset,
      hasMore: traversalIncomplete,
      nextOffset: traversalIncomplete ? initialOffset + expenses.length : null,
      pageTraversalMode: "exhaustive",
      fetchedPages,
      expenses,
    },
  };
}

function extractPayhawkCollection(payload: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(payload)) {
    return payload.filter(
      (value): value is Record<string, unknown> =>
        Boolean(value && typeof value === "object" && !Array.isArray(value)),
    );
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.items, record.results, record.value, record.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (value): value is Record<string, unknown> =>
          Boolean(value && typeof value === "object" && !Array.isArray(value)),
      );
    }
  }

  return null;
}

export async function validatePayhawkConnection(credentials: Record<string, unknown>) {
  const normalized = getPayhawkCredentials(credentials);
  if (!normalized) {
    throw new Error("Payhawk credentials are incomplete");
  }

  if (normalized.accountId) {
    await payhawkRequest(credentials, `/api/v3/accounts/${encodeURIComponent(normalized.accountId)}/fund-accounts`);
  }

  return {
    externalAccountId: normalized.accountId ?? normalized.baseUrl,
    metadata: {
      baseUrl: normalized.baseUrl,
      accountId: normalized.accountId ?? null,
      authMode: "header_api_key",
    },
  };
}

export async function executePayhawkAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const accountId = resolvePayhawkAccountId(payload, connection);

  if (action === "list_fund_accounts") {
    if (!accountId) {
      return {
        status: 400,
        body: { error: "accountId is required in the connection or request input" },
      };
    }

    const result = await payhawkRequest(
      connection.credentials,
      `/api/v3/accounts/${encodeURIComponent(accountId)}/fund-accounts`,
      buildPayhawkQuery(payload),
    );
    const fundAccounts = extractPayhawkCollection(result) ?? [];
    return {
      status: 200,
      body: {
        provider: "payhawk",
        action,
        accountId,
        count: fundAccounts.length,
        returnedCount: fundAccounts.length,
        fundAccounts,
      },
    };
  }

  if (action === "list_expenses") {
    if (!accountId) {
      return {
        status: 400,
        body: { error: "accountId is required in the connection or request input" },
      };
    }

    if (shouldFetchAllPayhawkPages(payload)) {
      try {
        return await listPayhawkExpensesExhaustively(
          connection.credentials,
          accountId,
          payload,
        );
      } catch (error) {
        if (
          buildPayhawkExpenseDateFilter(payload) &&
          isPayhawkBadRequestError(error)
        ) {
          return listPayhawkExpensesWithLocalDateRange(
            connection.credentials,
            accountId,
            payload,
          );
        }
        throw error;
      }
    }

    const query = buildPayhawkQuery(payload, {
      includePagination: true,
      limitFallback: 100,
      offsetFallback: 0,
    });
    const expenseDateFilter = buildPayhawkExpenseDateFilter(payload);
    if (expenseDateFilter && query["$filter"] === undefined && query.filter === undefined) {
      const serialized = serializePayhawkQueryValue(expenseDateFilter);
      if (typeof serialized === "string") {
        query["$filter"] = serialized;
      }
    }
    let result: unknown;
    try {
      result = await payhawkRequest(
        connection.credentials,
        `/api/v3/accounts/${encodeURIComponent(accountId)}/expenses`,
        query,
      );
    } catch (error) {
      if (
        expenseDateFilter &&
        query["$filter"] !== undefined &&
        isPayhawkBadRequestError(error)
      ) {
        return listPayhawkExpensesWithLocalDateRange(
          connection.credentials,
          accountId,
          payload,
        );
      }
      throw error;
    }
    const expenses = extractPayhawkCollection(result) ?? [];
    return {
      status: 200,
      body: {
        provider: "payhawk",
        action,
        accountId,
        count: expenses.length,
        returnedCount: expenses.length,
        limit:
          typeof query["$take"] === "number"
            ? query["$take"]
            : typeof query.take === "number"
              ? query.take
              : null,
        offset:
          typeof query["$skip"] === "number"
            ? query["$skip"]
            : typeof query.skip === "number"
              ? query.skip
              : null,
        expenses,
      },
    };
  }

  if (action === "get_expense") {
    if (!accountId) {
      return {
        status: 400,
        body: { error: "accountId is required in the connection or request input" },
      };
    }

    const expenseId = normalizeString(payload.expenseId);
    if (!expenseId) {
      return {
        status: 400,
        body: { error: "input.expenseId is required" },
      };
    }

    const expense = await payhawkRequest(
      connection.credentials,
      `/api/v3/accounts/${encodeURIComponent(accountId)}/expenses/${encodeURIComponent(expenseId)}`,
      buildPayhawkQuery(payload),
    );
    return {
      status: 200,
      body: {
        provider: "payhawk",
        action,
        accountId,
        expenseId,
        expense,
      },
    };
  }

  if (action === "get_expense_workflow") {
    if (!accountId) {
      return {
        status: 400,
        body: { error: "accountId is required in the connection or request input" },
      };
    }

    const expenseId = normalizeString(payload.expenseId);
    if (!expenseId) {
      return {
        status: 400,
        body: { error: "input.expenseId is required" },
      };
    }

    const workflow = await payhawkRequest(
      connection.credentials,
      `/api/v3/accounts/${encodeURIComponent(accountId)}/expenses/${encodeURIComponent(expenseId)}/workflow`,
      buildPayhawkQuery(payload),
    );
    return {
      status: 200,
      body: {
        provider: "payhawk",
        action,
        accountId,
        expenseId,
        workflow,
      },
    };
  }

  if (action === "get_bank_statement") {
    if (!accountId) {
      return {
        status: 400,
        body: { error: "accountId is required in the connection or request input" },
      };
    }

    const fundAccountId = normalizeString(payload.fundAccountId);
    if (!fundAccountId) {
      return {
        status: 400,
        body: { error: "input.fundAccountId is required" },
      };
    }

    const bankStatement = await payhawkRequest(
      connection.credentials,
      `/api/v3/accounts/${encodeURIComponent(accountId)}/fund-accounts/${encodeURIComponent(fundAccountId)}/bank-statement`,
      buildPayhawkQuery(payload),
    );
    const transactions = extractPayhawkCollection(bankStatement);
    return {
      status: 200,
      body: {
        provider: "payhawk",
        action,
        accountId,
        fundAccountId,
        returnedCount: transactions?.length ?? null,
        bankStatement,
      },
    };
  }

  if (action !== "get_resource") {
    return {
      status: 400,
      body: {
        error: "Unsupported payhawk action",
      },
    };
  }

  const path =
    typeof payload.path === "string" && payload.path.trim().length > 0
      ? payload.path.trim()
      : "";
  if (!path.startsWith("/")) {
    return {
      status: 400,
      body: { error: "input.path must start with '/'" },
    };
  }
  if (!isAllowedPayhawkResourcePath(path, accountId)) {
    return {
      status: 400,
      body: {
        error:
          "input.path must stay within the connected account resource prefix (/api/v3/accounts/{accountId}/...)",
      },
    };
  }

  const query =
    payload.query && typeof payload.query === "object"
      ? Object.entries(payload.query as Record<string, unknown>).reduce<
          Record<string, string | number | boolean | undefined>
        >((acc, [key, value]) => {
          if (["string", "number", "boolean"].includes(typeof value)) {
            acc[key] = value as string | number | boolean;
          }
          return acc;
        }, {})
      : undefined;

  const result = await payhawkRequest(connection.credentials, path, query);
  return {
    status: 200,
    body: {
      provider: "payhawk",
      action,
      path,
      result,
    },
  };
}
