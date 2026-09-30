"use client";

// FeedbackAdapter — sends `{message, type}` to /api/chat/feedback.
//
// The message comes from assistant-ui as a `ThreadMessage` with `id` (the
// UI message id assistant-ui mints client-side). We need the active thread
// id at submit time too — the runtime hook closes over a `getThreadId`
// callback (the same one the attachment adapter uses) so we don't have to
// thread it through props.

import type { FeedbackAdapter } from "@assistant-ui/react";

export interface CreateFeedbackAdapterOptions {
  getThreadId: () => Promise<string | null> | string | null;
  /** Defaults to `/api/chat/feedback`. Per-persona is fine — same endpoint. */
  apiUrl?: string;
  onError?: (error: Error) => void;
}

export function createFeedbackAdapter({
  getThreadId,
  apiUrl = "/api/chat/feedback",
  onError,
}: CreateFeedbackAdapterOptions): FeedbackAdapter {
  return {
    submit({ message, type }) {
      // Fire-and-forget — feedback is non-blocking; failures are logged but
      // don't surface to the user beyond an optional toast.
      void (async () => {
        try {
          const threadId = await Promise.resolve(getThreadId());
          if (!threadId) {
            // No persisted thread yet — feedback only makes sense on
            // assistant messages from a saved turn, so silently no-op.
            return;
          }
          const res = await fetch(apiUrl, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId,
              uiMessageId: message.id,
              type,
            }),
          });
          if (!res.ok) {
            throw new Error(`Feedback failed (HTTP ${res.status})`);
          }
        } catch (error) {
          try {
            onError?.(
              error instanceof Error ? error : new Error(String(error)),
            );
          } catch {
            // never let onError abort
          }
        }
      })();
    },
  };
}
