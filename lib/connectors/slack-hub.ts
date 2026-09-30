import { z } from "zod";
import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";
import { ConnectorHubError } from "@/lib/connectors/hub-errors";
import { tokenExpiresAtFromExpiresIn } from "@/lib/connectors/oauth-token-metadata";

const SLACK_API_BASE = "https://slack.com/api";
const SLACK_TIMEOUT_MS = 15_000;

type SlackConnection = {
  id: string;
  companyId: string;
  credentials: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
};

type SlackActionName =
  | "list_channels"
  | "list_users"
  | "search_all"
  | "list_files"
  | "get_message_reactions"
  | "get_channel_info"
  | "list_channel_members"
  | "get_channel_history"
  | "get_thread_replies"
  | "post_message";

type SlackAuthTestResponse = {
  ok: boolean;
  url?: string;
  team?: string;
  team_id?: string;
  user_id?: string;
  bot_id?: string;
  enterprise_id?: string;
};

const slackActionSchemas = {
  list_channels: z.object({
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).optional(),
    excludeArchived: z.boolean().optional(),
    types: z
      .array(z.enum(["public_channel", "private_channel"]))
      .min(1)
      .max(2)
      .optional(),
  }),
  list_users: z.object({
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().min(1).optional(),
    includeLocale: z.boolean().optional(),
  }),
  search_all: z.object({
    query: z.string().min(1),
    count: z.number().int().min(1).max(100).optional(),
    page: z.number().int().min(1).max(100).optional(),
    sort: z.enum(["score", "timestamp"]).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
    highlight: z.boolean().optional(),
  }),
  list_files: z.object({
    channel: z.string().min(1).optional(),
    user: z.string().min(1).optional(),
    count: z.number().int().min(1).max(1000).optional(),
    page: z.number().int().min(1).max(100).optional(),
    types: z.string().min(1).optional(),
    tsFrom: z.string().min(1).optional(),
    tsTo: z.string().min(1).optional(),
    showFilesHiddenByLimit: z.boolean().optional(),
  }),
  get_message_reactions: z.object({
    channel: z.string().min(1),
    timestamp: z.string().min(1),
    full: z.boolean().optional(),
  }),
  get_channel_info: z.object({
    channel: z.string().min(1),
    includeNumMembers: z.boolean().optional(),
  }),
  list_channel_members: z.object({
    channel: z.string().min(1),
    limit: z.number().int().min(1).max(1000).optional(),
    cursor: z.string().min(1).optional(),
  }),
  get_channel_history: z.object({
    channel: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).optional(),
    oldest: z.string().min(1).optional(),
    latest: z.string().min(1).optional(),
    inclusive: z.boolean().optional(),
  }),
  get_thread_replies: z.object({
    channel: z.string().min(1),
    ts: z.string().min(1),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).optional(),
    oldest: z.string().min(1).optional(),
    latest: z.string().min(1).optional(),
    inclusive: z.boolean().optional(),
  }),
  post_message: z.object({
    channel: z.string().min(1),
    text: z.string().min(1).max(40000),
    threadTs: z.string().min(1).optional(),
    replyBroadcast: z.boolean().optional(),
  }),
} satisfies Record<SlackActionName, z.ZodTypeAny>;

export const slackHubDefinition = {
  provider: "slack" as const,
  label: "Slack",
  description: "Read channels, inspect message history, and post messages to the connected workspace.",
  actions: [
    {
      name: "list_channels",
      description: "List public and private channels visible to the installed Slack app.",
    },
    {
      name: "get_channel_info",
      description: "Fetch metadata for a specific Slack channel.",
    },
    {
      name: "list_users",
      description: "List Slack workspace users visible to the installed app.",
    },
    {
      name: "search_all",
      description: "Search Slack messages and files with one query when the token grants search access.",
    },
    {
      name: "list_files",
      description: "List Slack files with optional channel, user, type, and time filters.",
    },
    {
      name: "get_message_reactions",
      description: "Fetch reaction data for a specific Slack message by channel and timestamp.",
    },
    {
      name: "list_channel_members",
      description: "List member IDs for a Slack channel the app can inspect.",
    },
    {
      name: "get_channel_history",
      description: "Read recent messages from a channel the app has access to.",
    },
    {
      name: "get_thread_replies",
      description: "Read replies in a Slack thread by parent message timestamp.",
    },
    {
      name: "post_message",
      description: "Post a plain-text message into a Slack channel or thread.",
    },
  ] as const,
};

function getSlackBotToken(credentials: Record<string, unknown>): string {
  const accessToken = credentials.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new ConnectorHubError("Slack connection is missing a bot access token", {
      status: 400,
      code: "slack_missing_access_token",
    });
  }
  return accessToken;
}

function mapSlackErrorStatus(errorCode: string | undefined): number {
  switch (errorCode) {
    case "channel_not_found":
    case "thread_not_found":
    case "message_not_found":
      return 404;
    case "invalid_auth":
    case "not_authed":
    case "account_inactive":
    case "token_revoked":
    case "token_expired":
      return 401;
    case "missing_scope":
    case "not_in_channel":
      return 403;
    case "ratelimited":
      return 429;
    default:
      return 502;
  }
}

async function callSlackApi<T>(
  path: string,
  token: string,
  options?: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown>;
  }
): Promise<T> {
  const url = new URL(`${SLACK_API_BASE}${path}`);
  for (const [key, value] of Object.entries(options?.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetchWithTimeoutAndRetry(
    url,
    {
      method: options?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options?.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    },
    {
      timeoutMs: SLACK_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );

  const text = await res.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = null;
  }

  if (!res.ok) {
    throw new ConnectorHubError(`Slack API request failed (${res.status})`, {
      status: res.status >= 400 && res.status < 500 ? res.status : 502,
      code: "slack_http_error",
      details: payload ?? text,
    });
  }

  if (!payload || payload.ok !== true) {
    const providerError =
      typeof payload?.error === "string" ? payload.error : "unknown_slack_error";
    throw new ConnectorHubError(`Slack API error: ${providerError}`, {
      status: mapSlackErrorStatus(providerError),
      code: `slack_${providerError}`,
      details: payload ?? text,
    });
  }

  return payload as T;
}

export async function resolveSlackConnectionMetadata(
  tokenResponse: Record<string, unknown>
): Promise<{ externalAccountId?: string; metadata: Record<string, unknown> }> {
  const fallbackTeam = (() => {
    const team = tokenResponse.team;
    if (!team || typeof team !== "object") return null;
    const record = team as Record<string, unknown>;
    return {
      id: typeof record.id === "string" ? record.id : undefined,
      name: typeof record.name === "string" ? record.name : undefined,
    };
  })();

  const metadata: Record<string, unknown> = {};
  const tokenExpiresAt = tokenExpiresAtFromExpiresIn(tokenResponse.expires_in);
  if (tokenExpiresAt) {
    metadata.tokenExpiresAt = tokenExpiresAt;
  }

  const accessToken =
    typeof tokenResponse.access_token === "string" ? tokenResponse.access_token : null;
  if (!accessToken) {
    return {
      externalAccountId: fallbackTeam?.id,
      metadata: {
        ...metadata,
        workspaceName: fallbackTeam?.name ?? null,
        teamId: fallbackTeam?.id ?? null,
      },
    };
  }

  try {
    const auth = await callSlackApi<SlackAuthTestResponse>("/auth.test", accessToken);
    return {
      externalAccountId: auth.team_id ?? fallbackTeam?.id,
      metadata: {
        ...metadata,
        workspaceName: auth.team ?? fallbackTeam?.name ?? null,
        workspaceUrl: auth.url ?? null,
        teamId: auth.team_id ?? fallbackTeam?.id ?? null,
        enterpriseId: auth.enterprise_id ?? null,
        botUserId: auth.bot_id ?? null,
        userId: auth.user_id ?? null,
      },
    };
  } catch {
    return {
      externalAccountId: fallbackTeam?.id,
      metadata: {
        ...metadata,
        workspaceName: fallbackTeam?.name ?? null,
        teamId: fallbackTeam?.id ?? null,
      },
    };
  }
}

export async function executeSlackHubAction(
  connection: SlackConnection,
  action: string,
  input: unknown
) {
  const schema = slackActionSchemas[action as SlackActionName];
  if (!schema) {
    throw new ConnectorHubError(`Unsupported Slack action: ${action}`, {
      status: 400,
      code: "unsupported_slack_action",
    });
  }

  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new ConnectorHubError("Invalid Slack action payload", {
      status: 400,
      code: "invalid_slack_payload",
      details: parsed.error.flatten(),
    });
  }

  const token = getSlackBotToken(connection.credentials);

  switch (action as SlackActionName) {
    case "list_channels": {
      const data = parsed.data as z.infer<typeof slackActionSchemas.list_channels>;
      const response = await callSlackApi<{
        ok: true;
        channels?: Array<{
          id: string;
          name: string;
          is_channel?: boolean;
          is_group?: boolean;
          is_private?: boolean;
          is_archived?: boolean;
          num_members?: number;
          topic?: { value?: string };
          purpose?: { value?: string };
        }>;
        response_metadata?: { next_cursor?: string };
      }>("/conversations.list", token, {
        query: {
          limit: data.limit ?? 100,
          cursor: data.cursor,
          exclude_archived: data.excludeArchived ?? true,
          types: (data.types ?? ["public_channel", "private_channel"]).join(","),
        },
      });

      return {
        workspace: {
          teamId: connection.metadata?.teamId ?? null,
          workspaceName: connection.metadata?.workspaceName ?? null,
        },
        channels: (response.channels ?? []).map((channel) => ({
          id: channel.id,
          name: channel.name,
          isPrivate: channel.is_private ?? false,
          isArchived: channel.is_archived ?? false,
          memberCount: channel.num_members ?? null,
          topic: channel.topic?.value ?? null,
          purpose: channel.purpose?.value ?? null,
        })),
        nextCursor: response.response_metadata?.next_cursor ?? null,
      };
    }

    case "get_channel_info": {
      const data = parsed.data as z.infer<typeof slackActionSchemas.get_channel_info>;
      const response = await callSlackApi<{
        ok: true;
        channel?: {
          id: string;
          name: string;
          is_private?: boolean;
          is_archived?: boolean;
          num_members?: number;
          topic?: { value?: string };
          purpose?: { value?: string };
          created?: number;
        };
      }>("/conversations.info", token, {
        query: {
          channel: data.channel,
          include_num_members: data.includeNumMembers ?? true,
        },
      });

      return {
        workspace: {
          teamId: connection.metadata?.teamId ?? null,
          workspaceName: connection.metadata?.workspaceName ?? null,
        },
        channel: response.channel
          ? {
              id: response.channel.id,
              name: response.channel.name,
              isPrivate: response.channel.is_private ?? false,
              isArchived: response.channel.is_archived ?? false,
              memberCount: response.channel.num_members ?? null,
              topic: response.channel.topic?.value ?? null,
              purpose: response.channel.purpose?.value ?? null,
              created: response.channel.created ?? null,
            }
          : null,
      };
    }

    case "list_users": {
      const data = parsed.data as z.infer<typeof slackActionSchemas.list_users>;
      const response = await callSlackApi<{
        ok: true;
        members?: Array<Record<string, unknown>>;
        response_metadata?: { next_cursor?: string };
      }>("/users.list", token, {
        query: {
          limit: data.limit ?? 100,
          cursor: data.cursor,
          include_locale: data.includeLocale ?? false,
        },
      });

      return {
        workspace: {
          teamId: connection.metadata?.teamId ?? null,
          workspaceName: connection.metadata?.workspaceName ?? null,
        },
        users: response.members ?? [],
        returnedCount: Array.isArray(response.members) ? response.members.length : 0,
        nextCursor: response.response_metadata?.next_cursor ?? null,
      };
    }

    case "search_all": {
      const data = parsed.data as z.infer<typeof slackActionSchemas.search_all>;
      const response = await callSlackApi<{
        ok: true;
        query?: string;
        messages?: Record<string, unknown>;
        files?: Record<string, unknown>;
        posts?: Record<string, unknown>;
      }>("/search.all", token, {
        query: {
          query: data.query,
          count: data.count ?? 20,
          page: data.page ?? 1,
          sort: data.sort,
          sort_dir: data.sortDir,
          highlight: data.highlight,
        },
      });

      return {
        workspace: {
          teamId: connection.metadata?.teamId ?? null,
          workspaceName: connection.metadata?.workspaceName ?? null,
        },
        query: response.query ?? data.query,
        messages: response.messages ?? null,
        files: response.files ?? null,
        posts: response.posts ?? null,
      };
    }

    case "list_files": {
      const data = parsed.data as z.infer<typeof slackActionSchemas.list_files>;
      const response = await callSlackApi<{
        ok: true;
        files?: Array<Record<string, unknown>>;
        paging?: Record<string, unknown>;
      }>("/files.list", token, {
        query: {
          channel: data.channel,
          user: data.user,
          count: data.count ?? 100,
          page: data.page ?? 1,
          types: data.types,
          ts_from: data.tsFrom,
          ts_to: data.tsTo,
          show_files_hidden_by_limit: data.showFilesHiddenByLimit,
        },
      });

      return {
        workspace: {
          teamId: connection.metadata?.teamId ?? null,
          workspaceName: connection.metadata?.workspaceName ?? null,
        },
        files: response.files ?? [],
        paging: response.paging ?? null,
      };
    }

    case "get_message_reactions": {
      const data = parsed.data as z.infer<typeof slackActionSchemas.get_message_reactions>;
      const response = await callSlackApi<{
        ok: true;
        type?: string;
        channel?: string;
        message?: Record<string, unknown>;
      }>("/reactions.get", token, {
        query: {
          channel: data.channel,
          timestamp: data.timestamp,
          full: data.full,
        },
      });

      return {
        workspace: {
          teamId: connection.metadata?.teamId ?? null,
          workspaceName: connection.metadata?.workspaceName ?? null,
        },
        type: response.type ?? "message",
        channel: response.channel ?? data.channel,
        message: response.message ?? null,
      };
    }

    case "list_channel_members": {
      const data =
        parsed.data as z.infer<typeof slackActionSchemas.list_channel_members>;
      const response = await callSlackApi<{
        ok: true;
        members?: string[];
        response_metadata?: { next_cursor?: string };
      }>("/conversations.members", token, {
        query: {
          channel: data.channel,
          limit: data.limit ?? 200,
          cursor: data.cursor,
        },
      });

      return {
        channel: data.channel,
        members: response.members ?? [],
        nextCursor: response.response_metadata?.next_cursor ?? null,
      };
    }

    case "get_channel_history": {
      const data =
        parsed.data as z.infer<typeof slackActionSchemas.get_channel_history>;
      const response = await callSlackApi<{
        ok: true;
        messages?: Array<Record<string, unknown>>;
        has_more?: boolean;
        response_metadata?: { next_cursor?: string };
      }>("/conversations.history", token, {
        method: "POST",
        body: {
          channel: data.channel,
          limit: data.limit ?? 50,
          cursor: data.cursor,
          oldest: data.oldest,
          latest: data.latest,
          inclusive: data.inclusive,
        },
      });

      return {
        channel: data.channel,
        messages: response.messages ?? [],
        hasMore: response.has_more ?? false,
        nextCursor: response.response_metadata?.next_cursor ?? null,
      };
    }

    case "get_thread_replies": {
      const data =
        parsed.data as z.infer<typeof slackActionSchemas.get_thread_replies>;
      const response = await callSlackApi<{
        ok: true;
        messages?: Array<Record<string, unknown>>;
        has_more?: boolean;
        response_metadata?: { next_cursor?: string };
      }>("/conversations.replies", token, {
        query: {
          channel: data.channel,
          ts: data.ts,
          limit: data.limit ?? 50,
          cursor: data.cursor,
          oldest: data.oldest,
          latest: data.latest,
          inclusive: data.inclusive,
        },
      });

      return {
        channel: data.channel,
        ts: data.ts,
        messages: response.messages ?? [],
        hasMore: response.has_more ?? false,
        nextCursor: response.response_metadata?.next_cursor ?? null,
      };
    }

    case "post_message": {
      const data = parsed.data as z.infer<typeof slackActionSchemas.post_message>;
      const response = await callSlackApi<{
        ok: true;
        channel?: string;
        ts?: string;
        message?: Record<string, unknown>;
      }>("/chat.postMessage", token, {
        method: "POST",
        body: {
          channel: data.channel,
          text: data.text,
          thread_ts: data.threadTs,
          reply_broadcast: data.replyBroadcast,
        },
      });

      return {
        channel: response.channel ?? data.channel,
        ts: response.ts ?? null,
        message: response.message ?? null,
      };
    }
  }
}
