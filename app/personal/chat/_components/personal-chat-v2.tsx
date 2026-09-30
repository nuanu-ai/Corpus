"use client";

// Thin client wrapper around the v2 chat shell, configured for the personal
// surface. Delegates all runtime/config wiring to <ChatV2 />, which reads
// `{ surface: "personal" }` from ChatV2Provider and resolves apiBase +
// documentUploadUrl to /api/personal/chat endpoints via
// `defaultConfigForSurface` in _lib/chat-context.tsx.

import { ChatV2 } from "@/app/assistant/_components/chat-v2";

export function PersonalChatV2() {
  return <ChatV2 surface="personal" />;
}
