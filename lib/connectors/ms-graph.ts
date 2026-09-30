import {
  getMicrosoftAccessToken,
  getMicrosoftServicePrincipalCredentials,
} from "@/lib/connectors/microsoft-auth";
import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const MS_GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const MS_GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MS_GRAPH_ALLOWED_ORIGIN = "https://graph.microsoft.com";
const MS_GRAPH_TIMEOUT_MS = 15_000;
const DEFAULT_USER_FIELDS = [
  "id",
  "displayName",
  "userPrincipalName",
  "mail",
  "jobTitle",
  "department",
  "accountEnabled",
] as const;
const DEFAULT_GROUP_FIELDS = ["id", "displayName", "mail", "mailEnabled", "securityEnabled"] as const;
const DEFAULT_GROUP_MEMBER_FIELDS = [
  "id",
  "displayName",
  "userPrincipalName",
  "mail",
  "jobTitle",
  "department",
] as const;
const DEFAULT_EVENT_FIELDS = [
  "id",
  "subject",
  "start",
  "end",
  "organizer",
  "attendees",
  "location",
  "onlineMeeting",
  "isOnlineMeeting",
] as const;

function isMsGraphInsufficientPrivilegesError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("insufficient privileges") ||
    message.includes("authorization_requestdenied") ||
    message.includes("does not have permission")
  );
}

async function msGraphRequest<T>(
  credentials: Record<string, unknown>,
  path: string,
  options?: {
    query?: Record<string, string | number | undefined>;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const normalized = getMicrosoftServicePrincipalCredentials(credentials);
  if (!normalized) {
    throw new Error("Microsoft Graph credentials are incomplete");
  }

  const accessToken = await getMicrosoftAccessToken(normalized, MS_GRAPH_SCOPE);
  const url = path.startsWith("https://")
    ? new URL(path)
    : new URL(`${MS_GRAPH_BASE}${path}`);
  if (url.origin !== MS_GRAPH_ALLOWED_ORIGIN) {
    throw new Error("Microsoft Graph nextLink must remain on graph.microsoft.com");
  }
  if (!url.pathname.startsWith("/v1.0/")) {
    throw new Error("Microsoft Graph path must remain within /v1.0");
  }
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetchWithTimeoutAndRetry(
    url,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(options?.headers ?? {}),
      },
      cache: "no-store",
    },
    {
      timeoutMs: MS_GRAPH_TIMEOUT_MS,
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
    const errorMessage =
      payload &&
      typeof payload === "object" &&
      "error" in (payload as Record<string, unknown>) &&
      typeof (payload as Record<string, unknown>).error === "object" &&
      (payload as Record<string, unknown>).error &&
      typeof ((payload as Record<string, unknown>).error as Record<string, unknown>).message ===
        "string"
        ? (((payload as Record<string, unknown>).error as Record<string, unknown>).message as string)
        : `Microsoft Graph request failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

function getStringArray(input: Record<string, unknown>, key: string, fallback: readonly string[]) {
  const values = Array.isArray(input[key])
    ? (input[key] as unknown[]).filter((value): value is string => typeof value === "string")
    : [];
  return values.length > 0 ? values.slice(0, 20) : [...fallback];
}

function getTop(input: Record<string, unknown>, fallback = 25, max = 100): number {
  const value = input.top;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, 1), max);
}

function getNextLink(input: Record<string, unknown>): string | undefined {
  const value = input.nextLink;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function withListMeta<T>(
  action: string,
  collectionName: string,
  items: T[],
  input: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  const nextLink =
    typeof payload["@odata.nextLink"] === "string" ? payload["@odata.nextLink"] : null;
  const top = getTop(input);
  return {
    provider: "ms_graph",
    action,
    count: items.length,
    returnedCount: items.length,
    top,
    hasMore: nextLink !== null,
    nextLink,
    [collectionName]: items,
  };
}

export async function validateMsGraphConnection(credentials: Record<string, unknown>) {
  const normalized = getMicrosoftServicePrincipalCredentials(credentials);
  if (!normalized) {
    throw new Error("Microsoft Graph credentials are incomplete");
  }

  try {
    const organization = await msGraphRequest<{ value?: Array<Record<string, unknown>> }>(
      credentials,
      "/organization",
      {
        query: {
          $select: "id,displayName",
          $top: 1,
        },
      },
    );

    const org = Array.isArray(organization.value) ? organization.value[0] : null;
    return {
      externalAccountId:
        org && typeof org.id === "string" ? org.id : normalized.tenantId,
      metadata: {
        tenantId: normalized.tenantId,
        organizationId: org && typeof org.id === "string" ? org.id : null,
        organizationName:
          org && typeof org.displayName === "string" ? org.displayName : null,
        limitedPermissions: false,
      },
    };
  } catch (error) {
    if (!isMsGraphInsufficientPrivilegesError(error)) {
      throw error;
    }

    return {
      externalAccountId: normalized.tenantId,
      metadata: {
        tenantId: normalized.tenantId,
        organizationId: null,
        organizationName: null,
        limitedPermissions: true,
        validationMode: "token_only",
        validationWarning:
          "Validated access token issuance, but organization directory reads are not permitted.",
      },
    };
  }
}

export async function executeMsGraphAction(
  connection: {
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  },
  action: string,
  input: unknown,
) {
  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  if (action === "get_organization") {
    const organization = await msGraphRequest<{ value?: Array<Record<string, unknown>> }>(
      connection.credentials,
      "/organization",
      {
        query: {
          $select: "id,displayName,verifiedDomains",
          $top: 1,
        },
      },
    );
    return {
      status: 200,
      body: {
        provider: "ms_graph",
        action,
        organization: Array.isArray(organization.value) ? organization.value[0] ?? null : null,
      },
    };
  }

  if (action === "list_users") {
    const top = getTop(payload);
    const query =
      typeof payload.query === "string" && payload.query.trim().length > 0
        ? payload.query.trim()
        : "";
    const select = getStringArray(payload, "select", DEFAULT_USER_FIELDS);
    const filter = query
      ? `startswith(displayName,'${escapeODataString(query)}') or startswith(userPrincipalName,'${escapeODataString(query)}') or startswith(mail,'${escapeODataString(query)}')`
      : undefined;

    const nextLink = getNextLink(payload);
    const users = await msGraphRequest<{ value?: Array<Record<string, unknown>>; "@odata.nextLink"?: string }>(
      connection.credentials,
      nextLink ?? "/users",
      nextLink
        ? undefined
        : {
            query: {
              $top: top,
              $select: select.join(","),
              $filter: filter,
            },
          },
    );
    const rows = Array.isArray(users.value) ? users.value : [];

    return {
      status: 200,
      body: withListMeta(action, "users", rows, payload, users as Record<string, unknown>),
    };
  }

  if (action === "get_user") {
    const userId =
      typeof payload.userId === "string" && payload.userId.trim().length > 0
        ? payload.userId.trim()
        : "";
    if (!userId) {
      return {
        status: 400,
        body: { error: "input.userId is required" },
      };
    }
    const select = getStringArray(payload, "select", DEFAULT_USER_FIELDS);
    const user = await msGraphRequest<Record<string, unknown>>(
      connection.credentials,
      `/users/${encodeURIComponent(userId)}`,
      {
        query: {
          $select: select.join(","),
        },
      },
    );
    return {
      status: 200,
      body: {
        provider: "ms_graph",
        action,
        userId,
        user,
      },
    };
  }

  if (action === "list_groups") {
    const top = getTop(payload);
    const query =
      typeof payload.query === "string" && payload.query.trim().length > 0
        ? payload.query.trim()
        : "";
    const select = getStringArray(payload, "select", DEFAULT_GROUP_FIELDS);
    const filter = query
      ? `startswith(displayName,'${escapeODataString(query)}')`
      : undefined;

    const nextLink = getNextLink(payload);
    const groups = await msGraphRequest<{ value?: Array<Record<string, unknown>>; "@odata.nextLink"?: string }>(
      connection.credentials,
      nextLink ?? "/groups",
      nextLink
        ? undefined
        : {
            query: {
              $top: top,
              $select: select.join(","),
              $filter: filter,
            },
          },
    );
    const rows = Array.isArray(groups.value) ? groups.value : [];

    return {
      status: 200,
      body: {
        ...withListMeta(action, "groups", rows, payload, groups as Record<string, unknown>),
      },
    };
  }

  if (action === "list_group_members") {
    const groupId =
      typeof payload.groupId === "string" && payload.groupId.trim().length > 0
        ? payload.groupId.trim()
        : "";
    if (!groupId) {
      return {
        status: 400,
        body: { error: "input.groupId is required" },
      };
    }
    const top = getTop(payload);
    const nextLink = getNextLink(payload);
    const transitive = payload.transitive === true;
    const select = getStringArray(payload, "select", DEFAULT_GROUP_MEMBER_FIELDS);
    const path = transitive
      ? `/groups/${encodeURIComponent(groupId)}/transitiveMembers/microsoft.graph.user`
      : `/groups/${encodeURIComponent(groupId)}/members/microsoft.graph.user`;
    const members = await msGraphRequest<{ value?: Array<Record<string, unknown>>; "@odata.nextLink"?: string }>(
      connection.credentials,
      nextLink ?? path,
      nextLink
        ? undefined
        : {
            query: {
              $top: top,
              $select: select.join(","),
            },
          },
    );
    const rows = Array.isArray(members.value) ? members.value : [];
    return {
      status: 200,
      body: {
        groupId,
        transitive,
        ...withListMeta(action, "members", rows, payload, members as Record<string, unknown>),
      },
    };
  }

  if (action === "list_calendar_events") {
    const userId =
      typeof payload.userId === "string" && payload.userId.trim().length > 0
        ? payload.userId.trim()
        : "";
    const startDateTime =
      typeof payload.startDateTime === "string" && payload.startDateTime.trim().length > 0
        ? payload.startDateTime.trim()
        : "";
    const endDateTime =
      typeof payload.endDateTime === "string" && payload.endDateTime.trim().length > 0
        ? payload.endDateTime.trim()
        : "";
    if (!userId || !startDateTime || !endDateTime) {
      return {
        status: 400,
        body: { error: "input.userId, input.startDateTime, and input.endDateTime are required" },
      };
    }
    const top = getTop(payload);
    const nextLink = getNextLink(payload);
    const select = getStringArray(payload, "select", DEFAULT_EVENT_FIELDS);
    const events = await msGraphRequest<{ value?: Array<Record<string, unknown>>; "@odata.nextLink"?: string }>(
      connection.credentials,
      nextLink ?? `/users/${encodeURIComponent(userId)}/calendarView`,
      nextLink
        ? undefined
        : {
            query: {
              startDateTime,
              endDateTime,
              $top: top,
              $select: select.join(","),
            },
            headers: {
              Prefer: 'outlook.timezone="UTC"',
            },
          },
    );
    const rows = Array.isArray(events.value) ? events.value : [];
    return {
      status: 200,
      body: {
        userId,
        startDateTime,
        endDateTime,
        ...withListMeta(action, "events", rows, payload, events as Record<string, unknown>),
      },
    };
  }

  if (action === "get_online_meeting") {
    const userId =
      typeof payload.userId === "string" && payload.userId.trim().length > 0
        ? payload.userId.trim()
        : "";
    const onlineMeetingId =
      typeof payload.onlineMeetingId === "string" && payload.onlineMeetingId.trim().length > 0
        ? payload.onlineMeetingId.trim()
        : "";
    if (!userId || !onlineMeetingId) {
      return {
        status: 400,
        body: { error: "input.userId and input.onlineMeetingId are required" },
      };
    }
    const meeting = await msGraphRequest<Record<string, unknown>>(
      connection.credentials,
      `/users/${encodeURIComponent(userId)}/onlineMeetings/${encodeURIComponent(onlineMeetingId)}`,
    );
    return {
      status: 200,
      body: {
        provider: "ms_graph",
        action,
        userId,
        onlineMeetingId,
        onlineMeeting: meeting,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported ms_graph action: ${action}` },
  };
}
