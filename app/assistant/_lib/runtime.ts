"use client";

// This file isolates assistant-ui API. Do not add logic here — only wiring.

import { useCallback, useMemo } from "react";

import {
  useAui,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { createAssistantStream } from "assistant-stream";

import { showToast } from "@/components/ui/toaster";

import { createAttachmentAdapter } from "./attachment-adapter";
import type { ChatV2Config } from "./chat-context";
import { createFeedbackAdapter } from "./feedback-adapter";
import { createHistoryAdapter, remoteIdFromAui } from "./history-adapter";
import { createSuggestionAdapter } from "./suggestion-adapter";
import { createThreadListAdapter } from "./thread-adapter";
import { createWhisperDictationAdapter } from "./whisper-dictation-adapter";

export function useChatV2Runtime(config: ChatV2Config) {
  const { streamApi, threadsApi, surface, persona, documentUploadUrl, storageKeyPrefix, allowCompanyArtifactShare } = config;

  const adapter = useMemo(() => {
    const base = createThreadListAdapter({
      streamApi,
      threadsApi,
      surface,
      persona,
      documentUploadUrl,
      storageKeyPrefix,
      allowCompanyArtifactShare,
    });
    return {
      list: () => base.list(),
      initialize: () => base.initialize(),
      rename: (remoteId: string, newTitle: string) => base.rename(remoteId, newTitle),
      delete: (remoteId: string) => base.delete(remoteId),
      fetch: (threadId: string) => base.fetchThread(threadId),
      // Archive/unarchive: schema has no status column. UI does not surface these actions.
      async archive(): Promise<void> {
        throw new Error("Archive not supported — schema has no status column");
      },
      async unarchive(): Promise<void> {
        throw new Error("Unarchive not supported — schema has no status column");
      },
      // generateTitle: Phase 5 (i18n + title generation). Return an empty stream so
      // assistant-ui's auto-title flow silently no-ops instead of throwing.
      async generateTitle() {
        return createAssistantStream(() => {});
      },
    };
  }, [streamApi, threadsApi, surface, persona, documentUploadUrl, storageKeyPrefix, allowCompanyArtifactShare]);

  const useRuntimeHook = useCallback(
    function useRuntimeHook() {
      return useInnerRuntime({ streamApi, threadsApi, documentUploadUrl, persona });
    },
    [streamApi, threadsApi, documentUploadUrl, persona],
  );

  return useRemoteThreadListRuntime({ runtimeHook: useRuntimeHook, adapter });
}

// Inner runtime hook. Runs inside a `ThreadListItemRuntimeProvider` context
// (see RemoteThreadListHookInstanceManager), so we can read the active
// thread's remoteId via the @assistant-ui/store `aui` client.
function useInnerRuntime({
  streamApi,
  threadsApi,
  persona,
  documentUploadUrl,
}: {
  streamApi: string;
  threadsApi: string;
  persona?: ChatV2Config["persona"];
  documentUploadUrl: string;
}) {
  const aui = useAui();

  const getThreadId = useCallback(async (): Promise<string | null> => {
    const client = aui;
    if (!client?.threadListItem?.source) return null;
    const item = client.threadListItem();

    const existing = item.getState().remoteId;
    if (existing) return existing;

    // No server-persisted thread yet — mint one via the thread list adapter.
    // This mirrors legacy `ensurePersistableThread`: uploads happen after the
    // thread row exists so the backend can link chat_attachments to it.
    try {
      const { remoteId } = await item.initialize();
      return remoteId ?? null;
    } catch {
      return null;
    }
  }, [aui]);

  // Sandbox attachments — files live in the outgoing message only, not
  // in the documents table. Spreadsheets / CSV / text-like files go
  // through `/api/chat/inspect-attachment` for an in-memory preview;
  // images and PDFs are inlined as Anthropic file parts. `documentUploadUrl`
  // is kept on the config for the legacy save-to-db flow that a future
  // tool can use, but the default attach path no longer touches it.
  const attachments = useMemo(
    () =>
      createAttachmentAdapter({
        onError: (error) => {
          showToast(error.message, { variant: "error" });
        },
      }),
    [],
  );

  const history = useMemo(
    () =>
      createHistoryAdapter({
        threadsApi,
        getRemoteId: () => remoteIdFromAui(aui),
      }),
    [threadsApi, aui],
  );

  // Voice-to-text via Whisper. Adapter is stateless (creates a fresh Session
  // on each `listen()`), so we can memoize it for the life of the runtime.
  const dictation = useMemo(() => createWhisperDictationAdapter(), []);

  // Thumbs up/down → POST to /api/chat/feedback. Fire-and-forget; failure
  // surfaces as a toast but never blocks the click.
  const feedback = useMemo(
    () =>
      createFeedbackAdapter({
        getThreadId,
        onError: (error) => {
          showToast(error.message, { variant: "error" });
        },
      }),
    [getThreadId],
  );

  // Dynamic follow-up suggestions — Haiku-driven, persona-biased, fail-open.
  // NOTE: `useChatRuntime` (from react-ai-sdk) doesn't expose a
  // SuggestionAdapter slot today (only LocalRuntime does). The adapter +
  // /api/chat/suggestions endpoint are wired so the next iteration can hook
  // them into a `<ThreadPrimitive.Suggestion>` chip row directly from a UI
  // component, rather than via runtime adapters.
  void persona; // silence unused warning until the chip row lands
  void documentUploadUrl;
  void createSuggestionAdapter;

  // Override `prepareSendMessagesRequest` so the outgoing body `id` is the
  // real remote thread id from OUR adapter, not the in-memory placeholder
  // "DEFAULT_THREAD_ID" that the cloud-adapter fallback would otherwise
  // substitute. `useChatRuntime` internally nests another RemoteThreadList
  // runtime with a `useCloudThreadListAdapter` that, when no cloud is
  // configured, returns `{ remoteId: threadId }` as-is — turning the local
  // placeholder into the wire id. Intercept here to inject our real UUID.
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: streamApi,
        prepareSendMessagesRequest: async (options) => {
          const realId = (await getThreadId()) ?? options.id;
          return {
            body: {
              ...(options.body as Record<string, unknown> | undefined),
              id: realId,
              messages: options.messages,
              trigger: options.trigger,
              messageId: options.messageId,
              metadata: options.requestMetadata,
            },
          };
        },
      }),
    [streamApi, getThreadId],
  );

  // History comes through the supported `adapters.history` slot (consumed
  // by useAISDKRuntime → useExternalHistory → chatHelpers.setMessages).
  // This is the only pathway that actually replaces the live Chat's
  // message tree on thread open — earlier attempts via `runtime.thread
  // .import` or `messages` seed option did not reach the Chat instance.
  return useChatRuntime({
    transport,
    adapters: { attachments, history, dictation, feedback },
  });
}
