"use client";

// SuggestionAdapter — asks `/api/chat/suggestions` for 3 follow-up prompts
// based on the recent conversation. Used by assistant-ui to populate the
// chip row above the composer dynamically once a thread has any history.
//
// Fail-open: any network/parse error returns an empty array so the UI just
// shows no chips for that turn.

import type { SuggestionAdapter } from "@assistant-ui/react";

import type { ChatPersona } from "./types";

interface CreateSuggestionAdapterOptions {
  /** Slug to bias suggestions toward (cfo / legal / marketing). */
  persona?: ChatPersona;
  apiUrl?: string;
}

export function createSuggestionAdapter({
  persona,
  apiUrl = "/api/chat/suggestions",
}: CreateSuggestionAdapterOptions = {}): SuggestionAdapter {
  return {
    async generate({ messages }) {
      // Reduce the runtime ThreadMessage shape to what the route expects.
      // We pull the first text-ish content per message — good enough for
      // a suggestion-generation prompt, ignores tool calls.
      const compact = messages.slice(-12).map((m) => {
        let text = "";
        const parts = (m as { content?: unknown }).content;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (
              part &&
              typeof part === "object" &&
              "type" in part &&
              part.type === "text" &&
              "text" in part &&
              typeof part.text === "string"
            ) {
              text += part.text + "\n";
            }
          }
        }
        return { role: m.role, text };
      });

      try {
        const res = await fetch(apiUrl, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: compact, personaSlug: persona }),
        });
        if (!res.ok) return [];
        const body = (await res.json()) as
          | { suggestions?: Array<{ prompt?: unknown }> }
          | null;
        if (!body || !Array.isArray(body.suggestions)) return [];
        return body.suggestions
          .map((s) =>
            typeof s?.prompt === "string" ? { prompt: s.prompt } : null,
          )
          .filter((s): s is { prompt: string } => s !== null);
      } catch {
        return [];
      }
    },
  };
}
