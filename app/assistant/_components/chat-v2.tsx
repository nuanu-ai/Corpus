"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";

import { Thread } from "@/components/assistant-ui/thread";
import { ThreadSidebar } from "@/components/assistant-ui/thread-sidebar";

import { ApprovalToolUIs } from "../_lib/approval-tool-ui";
import { ArtifactToolUIs } from "../_lib/artifact-tool-ui";
import { ChatV2Provider, useChatV2Config } from "../_lib/chat-context";
import { OnboardingToolUIs } from "../_lib/onboarding-tool-ui";
import { useChatV2Runtime } from "../_lib/runtime";
import { CompanyDbToolUIs } from "../_lib/tool-ui-registry";
import type { ChatPersona, ChatSurface } from "../_lib/types";

export interface ChatV2Props {
  surface?: ChatSurface;
  /**
   * Optional persona scoping for the company surface — drives streamApi,
   * thread storage key, and the persona slug stamped on new threads.
   */
  persona?: ChatPersona;
  initialPrompt?: string | null;
  initialPromptLabel?: string | null;
}

export function ChatV2({
  surface = "company",
  persona,
  initialPrompt,
  initialPromptLabel,
}: ChatV2Props = {}) {
  return (
    <ChatV2Provider config={{ surface, persona }}>
      <ChatV2Inner
        initialPrompt={initialPrompt}
        initialPromptLabel={initialPromptLabel}
      />
    </ChatV2Provider>
  );
}

function ChatV2Inner({
  initialPrompt,
  initialPromptLabel,
}: {
  initialPrompt?: string | null;
  initialPromptLabel?: string | null;
}) {
  const config = useChatV2Config();
  const runtime = useChatV2Runtime(config);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {/* Tool UI registrations — side-effect-only components that register
          render overrides for artifact- and approval-emitting tools. Must
          live inside AssistantRuntimeProvider. */}
      <ArtifactToolUIs />
      <ApprovalToolUIs />
      <CompanyDbToolUIs />
      {/* Onboarding cards + autostart live in the main company chat now
          (unified single-chat model). Autostart only greets when the
          company hasn't finished onboarding (checks /api/onboarding/status),
          so onboarded users are unaffected. */}
      {(config.surface === "company" || config.surface === "onboarding") && (
        <OnboardingToolUIs />
      )}
      <ThreadSidebar>
        <Thread
          initialPrompt={initialPrompt}
          initialPromptLabel={initialPromptLabel}
        />
      </ThreadSidebar>
    </AssistantRuntimeProvider>
  );
}
