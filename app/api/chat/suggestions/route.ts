/**
 * POST /api/chat/suggestions
 *
 * Generates 3 short follow-up prompts the user might want to ask next,
 * given the conversation so far. Used by `SuggestionAdapter` to populate
 * the chip row above the composer dynamically (replaces the static
 * `emptyState.suggestions` once a conversation has any history).
 *
 * Uses Haiku for the suggestion generation — small, fast, cheap; this is
 * a UX hint, not a primary task. Fails open: returns an empty array on
 * any error so the UI just falls back to no chips.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { isPersonaSlug, type PersonaSlug } from "@/lib/ai/personas";

const SUGGEST_MODEL = "claude-haiku-4-5-20251001";

// Keep payload small — last few messages give plenty of context for a
// follow-up suggestion, and Haiku doesn't need the full transcript.
const MAX_MESSAGES = 12;
const MAX_TEXT_CHARS = 1500;

const messageSchema = z
  .object({
    role: z.string().optional(),
    text: z.string().optional(),
  })
  .passthrough();

const requestSchema = z.object({
  messages: z.array(messageSchema).max(50).optional(),
  personaSlug: z
    .string()
    .refine(isPersonaSlug, { message: "Unknown personaSlug" })
    .optional(),
});

function trimText(input: string | undefined): string {
  if (!input) return "";
  const trimmed = input.replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_TEXT_CHARS
    ? trimmed.slice(0, MAX_TEXT_CHARS) + "…"
    : trimmed;
}

function personaHint(slug: PersonaSlug | undefined): string {
  switch (slug) {
    case "cfo":
      return "The user is talking to the CFO persona — finance, runway, plan-vs-actual. Suggestions should pull toward financial questions.";
    case "legal":
      return "The user is talking to the Legal persona — contracts, compliance, risk. Suggestions should pull toward legal/compliance questions.";
    case "marketing":
      return "The user is talking to the Marketing persona — growth, brand, campaigns. Suggestions should pull toward marketing questions.";
    default:
      return "Suggestions should be general Corpus follow-ups (finance, operations, ops integrations, documents).";
  }
}

export async function POST(req: NextRequest) {
  try {
    await getSessionCompanyContext();

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ suggestions: [] });
    }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ suggestions: [] });
    }
    const messages = (parsed.data.messages ?? []).slice(-MAX_MESSAGES);
    const personaSlug = parsed.data.personaSlug;

    const transcriptLines = messages
      .map((m) => {
        const role = (m.role as string) === "assistant" ? "assistant" : "user";
        const text = trimText(m.text as string | undefined);
        return text ? `${role}: ${text}` : null;
      })
      .filter((line): line is string => line !== null);

    if (transcriptLines.length === 0) {
      // No transcript → nothing to suggest. Caller falls back to static.
      return NextResponse.json({ suggestions: [] });
    }

    const result = await generateText({
      model: anthropic(SUGGEST_MODEL),
      maxOutputTokens: 200,
      system: [
        "You generate 3 short follow-up prompts the user could click to continue the conversation.",
        personaHint(personaSlug),
        "Rules:",
        "- Each prompt is at most 60 characters.",
        "- Phrased as the user would type, not as the assistant would say.",
        "- Concrete and useful, not generic ('What else?').",
        "- Distinct from each other.",
        "Return ONLY a JSON array of 3 strings. No prose, no markdown.",
      ].join("\n"),
      prompt: [
        "Recent conversation:",
        "",
        ...transcriptLines,
        "",
        'Output JSON only. Example: ["What changed in cash flow this month?","Show plan vs actual","Explain the runway calculation"]',
      ].join("\n"),
    });

    const text = result.text.trim();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      // Common LLM quirk: code-fenced JSON.
      const fence = text.match(/\[[\s\S]*\]/);
      if (!fence) {
        return NextResponse.json({ suggestions: [] });
      }
      try {
        parsedJson = JSON.parse(fence[0]);
      } catch {
        return NextResponse.json({ suggestions: [] });
      }
    }

    if (!Array.isArray(parsedJson)) {
      return NextResponse.json({ suggestions: [] });
    }
    const suggestions = parsedJson
      .filter((item): item is string => typeof item === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 80)
      .slice(0, 3)
      .map((prompt) => ({ prompt }));

    return NextResponse.json({ suggestions });
  } catch (error) {
    // Fail open — UX hint, not a primary task.
    console.warn("[chat/suggestions] generation failed", error);
    return handleApiError(error);
  }
}
