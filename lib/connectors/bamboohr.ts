const DEFAULT_BAMBOOHR_FIELDS = [
  "id",
  "displayName",
  "firstName",
  "lastName",
  "jobTitle",
  "department",
  "workEmail",
] as const;

const ORG_STRUCTURE_FIELDS = [
  "id",
  "displayName",
  "firstName",
  "lastName",
  "jobTitle",
  "department",
  "division",
  "location",
  "supervisor",
  "supervisorId",
  "workEmail",
] as const;
const MAX_BAMBOOHR_LIMIT = 200;
const BAMBOOHR_TIMEOUT_MS = 15_000;

export type BambooHrCredentials = {
  subdomain: string;
  apiKey: string;
};

function normalizeCredential(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeBambooHrSubdomain(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error("subdomain must contain only letters, numbers, or hyphens");
  }
  return normalized;
}

export function getBambooHrCredentials(
  credentials: Record<string, unknown>,
): BambooHrCredentials | null {
  const subdomainRaw = normalizeCredential(credentials.subdomain);
  const apiKey = normalizeCredential(credentials.apiKey);

  if (!subdomainRaw || !apiKey) {
    return null;
  }

  return {
    subdomain: normalizeBambooHrSubdomain(subdomainRaw),
    apiKey,
  };
}

function bambooHrBaseUrl(subdomain: string) {
  return `https://api.bamboohr.com/api/gateway.php/${encodeURIComponent(subdomain)}/v1`;
}

function bambooHrAuthHeader(apiKey: string) {
  return `Basic ${Buffer.from(`${apiKey}:x`).toString("base64")}`;
}

async function bambooHrRequest<T>(
  credentials: BambooHrCredentials,
  path: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | undefined>;
    body?: Record<string, unknown>;
  },
): Promise<T> {
  const url = new URL(`${bambooHrBaseUrl(credentials.subdomain)}${path}`);
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchWithTimeoutAndRetry(
    url,
    {
      method: options?.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: bambooHrAuthHeader(credentials.apiKey),
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    },
    {
      timeoutMs: BAMBOOHR_TIMEOUT_MS,
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
    const detail =
      payload && typeof payload === "object" && "message" in (payload as Record<string, unknown>)
        ? (payload as Record<string, unknown>).message
        : payload;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `BambooHR request failed (${response.status})`,
    );
  }

  return payload as T;
}

export async function validateBambooHrConnection(input: BambooHrCredentials) {
  await bambooHrRequest(input, "/reports/custom", {
    method: "POST",
    query: { format: "JSON" },
    body: {
      fields: [...DEFAULT_BAMBOOHR_FIELDS],
    },
  });

  return {
    externalAccountId: input.subdomain,
    metadata: {
      subdomain: input.subdomain,
    },
  };
}

function getRequestedFields(input: Record<string, unknown>): string[] {
  const raw = Array.isArray(input.fields)
    ? input.fields.filter((value): value is string => typeof value === "string")
    : [];
  return raw.length > 0 ? raw.slice(0, 25) : [...DEFAULT_BAMBOOHR_FIELDS];
}

async function requestBambooHrCustomReport(
  credentials: BambooHrCredentials,
  fields: readonly string[],
) {
  const response = await bambooHrRequest<Record<string, unknown>>(credentials, "/reports/custom", {
    method: "POST",
    query: { format: "JSON" },
    body: { fields: [...fields] },
  });
  return Array.isArray(response.employees) ? response.employees : [];
}

function getLimit(input: Record<string, unknown>, fallback = 25): number {
  if (typeof input.limit !== "number" || !Number.isInteger(input.limit)) {
    return fallback;
  }
  return Math.min(Math.max(input.limit, 1), MAX_BAMBOOHR_LIMIT);
}

function getOffset(input: Record<string, unknown>, limit: number): number {
  if (typeof input.offset === "number" && Number.isInteger(input.offset)) {
    return Math.max(input.offset, 0);
  }
  if (typeof input.page === "number" && Number.isInteger(input.page)) {
    return Math.max(input.page - 1, 0) * limit;
  }
  return 0;
}

function buildPagedEmployees<T>(
  employees: T[],
  pagination: { limit: number; offset: number },
) {
  const totalCount = employees.length;
  const pagedEmployees = employees.slice(
    pagination.offset,
    pagination.offset + pagination.limit,
  );
  const nextOffset =
    pagination.offset + pagedEmployees.length < totalCount
      ? pagination.offset + pagedEmployees.length
      : null;

  return {
    count: totalCount,
    totalCount,
    returnedCount: pagedEmployees.length,
    limit: pagination.limit,
    offset: pagination.offset,
    nextOffset,
    hasMore: nextOffset !== null,
    employees: pagedEmployees,
  };
}

function getDateString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export async function executeBambooHrAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const credentials = getBambooHrCredentials(connection.credentials);
  if (!credentials) {
    return {
      status: 400,
      body: { error: "BambooHR credentials are incomplete" },
    };
  }

  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  if (action === "list_employees") {
    const fields = getRequestedFields(payload);
    const limit = getLimit(payload, 100);
    const offset = getOffset(payload, limit);
    const employees = await requestBambooHrCustomReport(credentials, fields);
    const page = buildPagedEmployees(employees, { limit, offset });
    return {
      status: 200,
      body: {
        provider: "bamboohr",
        action,
        subdomain: credentials.subdomain,
        fields,
        ...page,
      },
    };
  }

  if (action === "get_employee") {
    const employeeId =
      typeof payload.employeeId === "string" || typeof payload.employeeId === "number"
        ? String(payload.employeeId).trim()
        : "";
    if (!employeeId) {
      return {
        status: 400,
        body: { error: "input.employeeId is required" },
      };
    }

    const fields = getRequestedFields(payload);
    const employee = await bambooHrRequest<Record<string, unknown>>(
      credentials,
      `/employees/${encodeURIComponent(employeeId)}`,
      {
        query: {
          fields: fields.join(","),
        },
      },
    );

    return {
      status: 200,
      body: {
        provider: "bamboohr",
        action,
        employeeId,
        fields,
        employee,
      },
    };
  }

  if (action === "list_directory") {
    const directory = await bambooHrRequest<Record<string, unknown>>(credentials, "/employees/directory");
    const employees = Array.isArray(directory.employees) ? directory.employees : [];
    const limit = getLimit(payload, 50);
    const offset = getOffset(payload, limit);
    const page = buildPagedEmployees(employees, { limit, offset });

    return {
      status: 200,
      body: {
        provider: "bamboohr",
        action,
        subdomain: credentials.subdomain,
        ...page,
      },
    };
  }

  if (action === "list_departments") {
    const employees = await requestBambooHrCustomReport(credentials, ORG_STRUCTURE_FIELDS);
    const departments = new Map<string, { name: string; employeeCount: number; locations: Set<string> }>();

    for (const employee of employees) {
      if (!employee || typeof employee !== "object") continue;
      const record = employee as Record<string, unknown>;
      const department =
        typeof record.department === "string" && record.department.trim().length > 0
          ? record.department.trim()
          : "";
      if (!department) continue;
      const location =
        typeof record.location === "string" && record.location.trim().length > 0
          ? record.location.trim()
          : "";
      const current = departments.get(department) ?? {
        name: department,
        employeeCount: 0,
        locations: new Set<string>(),
      };
      current.employeeCount += 1;
      if (location) current.locations.add(location);
      departments.set(department, current);
    }

    return {
      status: 200,
      body: {
        provider: "bamboohr",
        action,
        subdomain: credentials.subdomain,
        count: departments.size,
        departments: [...departments.values()]
          .map((department) => ({
            name: department.name,
            employeeCount: department.employeeCount,
            locations: [...department.locations],
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    };
  }

  if (action === "get_org_structure") {
    const employees = await requestBambooHrCustomReport(credentials, ORG_STRUCTURE_FIELDS);
    const normalizedEmployees = employees.map((employee) => {
      const record = employee && typeof employee === "object"
        ? (employee as Record<string, unknown>)
        : {};
      const id =
        typeof record.id === "string" || typeof record.id === "number"
          ? String(record.id)
          : "";
      const supervisorId =
        typeof record.supervisorId === "string" || typeof record.supervisorId === "number"
          ? String(record.supervisorId)
          : null;
      return {
        id,
        displayName:
          typeof record.displayName === "string" ? record.displayName : null,
        firstName: typeof record.firstName === "string" ? record.firstName : null,
        lastName: typeof record.lastName === "string" ? record.lastName : null,
        jobTitle: typeof record.jobTitle === "string" ? record.jobTitle : null,
        department: typeof record.department === "string" ? record.department : null,
        division: typeof record.division === "string" ? record.division : null,
        location: typeof record.location === "string" ? record.location : null,
        supervisor: typeof record.supervisor === "string" ? record.supervisor : null,
        supervisorId,
        workEmail: typeof record.workEmail === "string" ? record.workEmail : null,
      };
    });

    const childrenBySupervisor = new Map<string, string[]>();
    let rootCount = 0;
    for (const employee of normalizedEmployees) {
      if (!employee.id) continue;
      if (!employee.supervisorId) {
        rootCount += 1;
        continue;
      }
      const bucket = childrenBySupervisor.get(employee.supervisorId) ?? [];
      bucket.push(employee.id);
      childrenBySupervisor.set(employee.supervisorId, bucket);
    }

    return {
      status: 200,
      body: {
        provider: "bamboohr",
        action,
        subdomain: credentials.subdomain,
        count: normalizedEmployees.length,
        rootCount,
        employees: normalizedEmployees,
        reportingLines: Object.fromEntries(childrenBySupervisor.entries()),
      },
    };
  }

  if (action === "list_whos_out") {
    const result = await bambooHrRequest<Record<string, unknown>>(
      credentials,
      "/time_off/whos_out",
      {
        query: {
          start: getDateString(payload, "start"),
          end: getDateString(payload, "end"),
        },
      },
    );
    const employees = Array.isArray(result.employees) ? result.employees : [];
    return {
      status: 200,
      body: {
        provider: "bamboohr",
        action,
        subdomain: credentials.subdomain,
        count: employees.length,
        returnedCount: employees.length,
        employees,
      },
    };
  }

  if (action === "list_time_off_requests") {
    const limit = getLimit(payload, 50);
    const offset = getOffset(payload, limit);
    const result = await bambooHrRequest<Record<string, unknown>>(
      credentials,
      "/time_off/requests",
      {
        query: {
          start: getDateString(payload, "start"),
          end: getDateString(payload, "end"),
          status: typeof payload.status === "string" ? payload.status.trim() : undefined,
          employeeId:
            typeof payload.employeeId === "string" || typeof payload.employeeId === "number"
              ? String(payload.employeeId).trim()
              : undefined,
        },
      },
    );
    const requests = Array.isArray(result.requests) ? result.requests : [];
    const page = requests.slice(offset, offset + limit);
    const nextOffset = offset + page.length < requests.length ? offset + page.length : null;
    return {
      status: 200,
      body: {
        provider: "bamboohr",
        action,
        subdomain: credentials.subdomain,
        count: requests.length,
        totalCount: requests.length,
        returnedCount: page.length,
        limit,
        offset,
        nextOffset,
        hasMore: nextOffset !== null,
        requests: page,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported bamboohr action: ${action}` },
  };
}
import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";
