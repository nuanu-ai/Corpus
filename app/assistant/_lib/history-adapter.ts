"use client";

/**
 * ThreadHistoryAdapter for AI SDK chat runtime.
 *
 * `useAISDKRuntime` (inside `useChatRuntime`) wires a history adapter from
 * `adapters.history` through `useExternalHistory`, which at thread mount:
 *   1. calls `withFormat(aiSDKV6FormatAdapter).load()` to get raw UIMessages
 *   2. hands them to `chatHelpers.setMessages(...)` — the official path to
 *      replace the live Chat's message tree.
 *
 * This is what actually makes a thread's prior history appear when the user
 * opens it from the sidebar. An earlier attempt via `runtime.thread.import`
 * from a sibling component never reached the underlying Chat instance
 * because `useChatRuntime` doesn't expose `setMessages` except via this
 * adapter contract.
 *
 * The adapter runs inside a per-thread runtime hook, so it reads the active
 * thread's remoteId through `useAui()`'s ThreadListItem binding. If no
 * remoteId is set yet (brand-new local thread), load() returns empty.
 */

import type {
  ExportedMessageRepository,
  MessageFormatAdapter,
  ThreadHistoryAdapter,
  ThreadMessage,
} from "@assistant-ui/react";
import type { AssistantClient } from "@assistant-ui/react";
import type { UIMessage } from "ai";

export function createHistoryAdapter({
  threadsApi,
  getRemoteId,
}: {
  threadsApi: string;
  getRemoteId: () => string | null;
}): ThreadHistoryAdapter {
  async function fetchUIMessages(): Promise<UIMessage[]> {
    const remoteId = getRemoteId();
    if (!remoteId) return [];
    try {
      const response = await fetch(`${threadsApi}/${remoteId}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return [];
      const payload = (await response.json()) as { messages?: UIMessage[] } | null;
      return Array.isArray(payload?.messages) ? (payload!.messages as UIMessage[]) : [];
    } catch {
      return [];
    }
  }

  function buildLinearRepo<T extends { id: string }>(messages: T[]) {
    return {
      headId: messages.length > 0 ? messages[messages.length - 1].id : null,
      messages: messages.map((message, index) => ({
        parentId: index > 0 ? messages[index - 1].id : null,
        message,
      })),
    };
  }

  return {
    // `load()` (no format) is a legacy path — useAISDKRuntime always goes
    // through `withFormat` below. Provide a safe empty default.
    async load(): Promise<ExportedMessageRepository & { unstable_resume?: boolean }> {
      return { headId: null, messages: [] };
    },

    // Server persists messages in `onFinish` of the chat route; the client
    // does not need to push history updates. No-op is correct.
    async append(): Promise<void> {
      /* persistence handled server-side */
    },

    withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
      _formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
    ) {
      return {
        async load() {
          const uiMessages = await fetchUIMessages();
          // The format adapter this hook is invoked with is
          // `aiSDKV6FormatAdapter`, whose decoded message IS a UIMessage.
          // Cast accordingly.
          return buildLinearRepo(uiMessages as unknown as Array<TMessage & { id: string }>);
        },
        async append() {
          /* persistence handled server-side */
        },
        getId(message: TMessage): string {
          return (message as unknown as { id: string }).id;
        },
      };
    },
  };
}

/** Helper for the runtime hook: extract remoteId from the per-thread aui client. */
export function remoteIdFromAui(aui: AssistantClient | null | undefined): string | null {
  try {
    if (!aui?.threadListItem?.source) return null;
    const item = aui.threadListItem();
    const state = item.getState() as { remoteId?: string | null } | null;
    return state?.remoteId ?? null;
  } catch {
    return null;
  }
}

// Small re-export surface for callers to avoid importing ThreadMessage type paths.
export type { ThreadMessage };
