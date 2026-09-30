"use client";

// Dynamic follow-up chip row — renders 3 short next-question chips above
// the composer once a thread has at least one assistant turn. Empties out
// while the run is in flight so the chips don't clash with streaming.
//
// The chips are produced by `/api/chat/suggestions` (Haiku-driven,
// persona-biased). Click → `ThreadPrimitive.Suggestion` appends + sends
// the suggested prompt for the user.

import { useEffect, useMemo, useRef, useState } from "react";

import { ThreadPrimitive, useThread } from "@assistant-ui/react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const PERSONA_SLUGS = new Set(["cfo", "legal", "marketing"]);

interface DynamicSuggestionsProps {
  /**
   * Optional persona override. Falls back to the slug parsed from
   * `/assistant/<persona>` so most call sites can render
   * `<DynamicSuggestions />` with no props.
   */
  persona?: string;
  className?: string;
}

function usePersonaFromPath(): string | undefined {
  const pathname = usePathname();
  if (!pathname) return undefined;
  const match = pathname.match(/^\/assistant\/([^/]+)/);
  if (!match) return undefined;
  const candidate = match[1];
  return PERSONA_SLUGS.has(candidate) ? candidate : undefined;
}

interface SuggestionsState {
  prompts: string[];
  /** message-count at the moment we asked, used to invalidate when newer turns arrive */
  generatedAtMessageCount: number;
}

const FETCH_DEBOUNCE_MS = 600;

export function DynamicSuggestions({
  persona: personaProp,
  className,
}: DynamicSuggestionsProps) {
  const personaFromPath = usePersonaFromPath();
  const persona = personaProp ?? personaFromPath;
  const messages = useThread((state) => state.messages);
  const isRunning = useThread((state) => state.isRunning);
  const [state, setState] = useState<SuggestionsState | null>(null);
  const lastRequestedFor = useRef<number>(-1);

  // Compact selector — when the latest message is from the assistant and we
  // are NOT mid-run, we should regenerate.
  const trigger = useMemo(() => {
    if (messages.length === 0) return null;
    if (isRunning) return null;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return null;
    return messages.length;
  }, [messages, isRunning]);

  useEffect(() => {
    if (trigger == null) return;
    if (lastRequestedFor.current === trigger) return;
    lastRequestedFor.current = trigger;

    const cancel = { aborted: false };
    const handle = window.setTimeout(async () => {
      try {
        const compactMessages = messages.slice(-12).map((m) => {
          let text = "";
          for (const part of m.content ?? []) {
            if (part?.type === "text" && typeof part.text === "string") {
              text += part.text + "\n";
            }
          }
          return { role: m.role, text };
        });

        const res = await fetch("/api/chat/suggestions", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: compactMessages,
            personaSlug: persona,
          }),
        });
        if (cancel.aborted) return;
        if (!res.ok) {
          setState({ prompts: [], generatedAtMessageCount: trigger });
          return;
        }
        const body = (await res.json()) as
          | { suggestions?: Array<{ prompt?: unknown }> }
          | null;
        if (cancel.aborted) return;
        const prompts =
          body?.suggestions
            ?.map((s) =>
              typeof s?.prompt === "string" ? s.prompt.trim() : null,
            )
            .filter((s): s is string => !!s)
            .slice(0, 3) ?? [];
        setState({ prompts, generatedAtMessageCount: trigger });
      } catch {
        if (cancel.aborted) return;
        setState({ prompts: [], generatedAtMessageCount: trigger });
      }
    }, FETCH_DEBOUNCE_MS);

    return () => {
      cancel.aborted = true;
      window.clearTimeout(handle);
    };
  }, [trigger, messages, persona]);

  // Hide if: empty thread (EmptyState handles that), running, or stale.
  if (trigger == null) return null;
  if (!state || state.generatedAtMessageCount !== trigger) return null;
  if (state.prompts.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap gap-1.5 px-3 pb-1.5 sm:gap-2 sm:px-4 lg:px-4",
        className,
      )}
      aria-label="Follow-up suggestions"
    >
      {state.prompts.map((prompt) => (
        <ThreadPrimitive.Suggestion
          key={prompt}
          prompt={prompt}
          method="replace"
          send
          className="cursor-pointer rounded-full border border-border/50 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground sm:text-sm"
        >
          {prompt}
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
}
