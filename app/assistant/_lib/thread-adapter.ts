import type { ChatV2Config } from "./chat-context";
import type { ChatPersona } from "./types";

// Framework-agnostic thread adapter. Mirrors the surface of assistant-ui's
// RemoteThreadListAdapter (sans generateTitle/fetch/unstable_Provider, which
// are added in Phase 1 when we bind the adapter to the hook wrapper). Keeping
// this file independent of @assistant-ui/react makes it unit-testable and lets
// the runtime.ts wrapper own all framework coupling.

export interface ChatThreadSummary {
  remoteId: string;
  status: "regular" | "archived";
  title: string;
}

export interface ChatThreadListResponse {
  threads: ChatThreadSummary[];
}

export interface ChatThreadInitializeResponse {
  remoteId: string;
  // Required key, nullable value — matches @assistant-ui/core's RemoteThreadInitializeResponse
  // under exactOptionalPropertyTypes.
  externalId: string | undefined;
}

export interface ChatThreadListAdapter {
  list(): Promise<ChatThreadListResponse>;
  initialize(): Promise<ChatThreadInitializeResponse>;
  fetchThread(remoteId: string): Promise<ChatThreadSummary>;
  rename(remoteId: string, newTitle: string): Promise<void>;
  delete(remoteId: string): Promise<void>;
}

function buildThreadListUrl(threadsApi: string, persona?: ChatPersona): string {
  // Filter list by persona when set so the user only sees threads scoped
  // to the active persona (CFO, legal, etc). Default `company` / `personal`
  // are no-ops — server treats absent param as "no filter" which is the
  // legacy behaviour we want for the unscoped surfaces.
  const personaQuery =
    persona && persona !== "company" && persona !== "personal"
      ? `&persona=${encodeURIComponent(persona)}`
      : "";
  return `${threadsApi}?summary=1${personaQuery}`;
}

function buildThreadsUrl(threadsApi: string): string {
  return threadsApi;
}

function buildThreadUrl(threadsApi: string, threadId: string): string {
  return `${threadsApi}/${encodeURIComponent(threadId)}`;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json();
    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
    ) {
      return (payload as { error: string }).error;
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

function normalizeSummary(value: unknown): ChatThreadSummary | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const remoteId =
    typeof candidate.remoteId === "string"
      ? candidate.remoteId
      : typeof candidate.id === "string"
        ? candidate.id
        : null;
  if (!remoteId) return null;
  const status =
    candidate.status === "archived" ? ("archived" as const) : ("regular" as const);
  const title =
    typeof candidate.title === "string" && candidate.title.trim().length > 0
      ? candidate.title
      : "New chat";
  return { remoteId, status, title };
}

export function createThreadListAdapter(config: ChatV2Config): ChatThreadListAdapter {
  const { threadsApi, persona } = config;
  // POST body for thread init: only stamp personaSlug for scoped personas;
  // company/personal default falls through to the server default.
  const initBody: Record<string, unknown> =
    persona && persona !== "company" && persona !== "personal"
      ? { personaSlug: persona }
      : {};

  return {
    async list(): Promise<ChatThreadListResponse> {
      const response = await fetch(buildThreadListUrl(threadsApi, persona), {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const message = await readErrorMessage(
          response,
          `Failed to list chat threads (${response.status})`,
        );
        throw new Error(message);
      }
      const payload = (await response.json().catch(() => null)) as unknown;
      // Server returns a bare array for ?summary=1. Also accept { threads: [] } defensively.
      const rawThreads = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as { threads?: unknown } | null)?.threads)
          ? (payload as { threads: unknown[] }).threads
          : [];
      const threads = rawThreads
        .map((entry) => normalizeSummary(entry))
        .filter((entry): entry is ChatThreadSummary => entry !== null);
      return { threads };
    },

    async initialize(): Promise<ChatThreadInitializeResponse> {
      // Server mints thread id; client-supplied id would be ignored.
      const response = await fetch(buildThreadsUrl(threadsApi), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(initBody),
      });
      if (!response.ok) {
        const message = await readErrorMessage(
          response,
          `Failed to initialize chat thread (${response.status})`,
        );
        throw new Error(message);
      }
      const payload = (await response.json().catch(() => null)) as
        | { remoteId?: unknown; id?: unknown; externalId?: unknown }
        | null;
      const remoteId =
        typeof payload?.remoteId === "string"
          ? payload.remoteId
          : typeof payload?.id === "string"
            ? payload.id
            : null;
      if (!remoteId) {
        throw new Error("Thread initialize response did not include a remoteId");
      }
      const externalId =
        typeof payload?.externalId === "string" ? payload.externalId : undefined;
      return { remoteId, externalId };
    },

    async fetchThread(remoteId: string): Promise<ChatThreadSummary> {
      const response = await fetch(buildThreadUrl(threadsApi, remoteId), {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const message = await readErrorMessage(
          response,
          `Failed to fetch chat thread (${response.status})`,
        );
        throw new Error(message);
      }
      const payload = (await response.json().catch(() => null)) as unknown;
      const summary = normalizeSummary(payload);
      if (!summary) {
        throw new Error("Thread fetch response did not include a remoteId");
      }
      return summary;
    },

    async rename(remoteId: string, newTitle: string): Promise<void> {
      const response = await fetch(buildThreadUrl(threadsApi, remoteId), {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ title: newTitle }),
      });
      if (!response.ok) {
        const message = await readErrorMessage(
          response,
          `Failed to rename chat thread (${response.status})`,
        );
        throw new Error(message);
      }
    },

    async delete(remoteId: string): Promise<void> {
      const response = await fetch(buildThreadUrl(threadsApi, remoteId), {
        method: "DELETE",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const message = await readErrorMessage(
          response,
          `Failed to delete chat thread (${response.status})`,
        );
        throw new Error(message);
      }
    },
  };
}
