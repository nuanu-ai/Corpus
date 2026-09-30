"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { ChatPersona, ChatSurface } from "./types";

export interface ChatV2Config {
  surface: ChatSurface;
  /**
   * Optional persona scoping for the company surface (cfo / legal /
   * marketing). When unset on company surface, behaves as the legacy CEO
   * chat — `streamApi` is `/api/chat`, no persona slug stamped on threads.
   */
  persona?: ChatPersona;
  /**
   * Endpoint that handles streaming chat turns (POST). Persona-aware on
   * company surface — `/api/chat/cfo` for the CFO persona, `/api/chat`
   * otherwise.
   */
  streamApi: string;
  /**
   * Base URL for thread CRUD (list / init / fetch / rename / delete) and
   * thread message history. Persona scoping is layered via `?persona=`
   * query (list) and `personaSlug` POST body (init), not via path —
   * because thread routes live at a single canonical mount, not per-persona.
   */
  threadsApi: string;
  documentUploadUrl: string;
  storageKeyPrefix: string;
  allowCompanyArtifactShare: boolean;
}

export type ChatV2ConfigInput = Partial<ChatV2Config> & {
  surface: ChatSurface;
};

const ChatV2Context = createContext<ChatV2Config | null>(null);

export function resolveChatV2Config(input: ChatV2ConfigInput): ChatV2Config {
  const surface = input.surface;
  const persona = input.persona;
  const defaults = defaultConfigForSurface(surface, persona);
  return {
    surface,
    persona,
    streamApi: input.streamApi ?? defaults.streamApi,
    threadsApi: input.threadsApi ?? defaults.threadsApi,
    documentUploadUrl: input.documentUploadUrl ?? defaults.documentUploadUrl,
    storageKeyPrefix: input.storageKeyPrefix ?? defaults.storageKeyPrefix,
    allowCompanyArtifactShare:
      input.allowCompanyArtifactShare ?? defaults.allowCompanyArtifactShare,
  };
}

function defaultConfigForSurface(
  surface: ChatSurface,
  persona?: ChatPersona,
): ChatV2Config {
  if (surface === "personal") {
    return {
      surface,
      streamApi: "/api/personal/chat",
      threadsApi: "/api/personal/chat/threads",
      documentUploadUrl: "/api/personal/chat/upload",
      storageKeyPrefix: "corpus:chat:personal:v2",
      allowCompanyArtifactShare: false,
    };
  }
  if (surface === "onboarding") {
    return {
      surface,
      // Dedicated onboarding endpoint — slim version of /api/chat with
      // onboarding tools + onboarding system prompt. Lives parallel to
      // /api/chat so the existing chat route stays untouched.
      streamApi: "/api/onboarding/chat",
      // Reuse the canonical thread CRUD — onboarding threads are just
      // chat_threads rows with kind='onboarding'. The onboarding route
      // tags them on first turn via ensureOnboardingThread().
      threadsApi: "/api/chat/threads",
      documentUploadUrl: "/api/documents/upload",
      storageKeyPrefix: "corpus:chat:onboarding:v2",
      allowCompanyArtifactShare: false,
    };
  }
  // Company surface — optionally personalised by persona slug.
  const personaSegment =
    persona && persona !== "company" && persona !== "personal"
      ? `/${persona}`
      : "";
  return {
    surface,
    persona,
    streamApi: `/api/chat${personaSegment}`,
    threadsApi: "/api/chat/threads",
    documentUploadUrl: "/api/documents/upload",
    storageKeyPrefix: `corpus:chat:company${personaSegment ? `:${persona}` : ""}:v2`,
    allowCompanyArtifactShare: true,
  };
}

export interface ChatV2ProviderProps {
  config: ChatV2ConfigInput;
  children: ReactNode;
}

export function ChatV2Provider({ config, children }: ChatV2ProviderProps) {
  const resolved = useMemo(
    () => resolveChatV2Config(config),
    [config],
  );

  return <ChatV2Context.Provider value={resolved}>{children}</ChatV2Context.Provider>;
}

export function useChatV2Config(): ChatV2Config {
  const value = useContext(ChatV2Context);
  if (!value) {
    throw new Error(
      "useChatV2Config must be used within <ChatV2Provider>. Wrap the chat tree with a provider and supply at least { surface }.",
    );
  }
  return value;
}

export { ChatV2Context };
