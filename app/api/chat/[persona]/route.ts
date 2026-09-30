/**
 * Persona-aware chat endpoint.
 *
 * `POST /api/chat/[persona]` — runs a chat turn under the given persona
 * (cfo / legal / marketing / company). Delegates to
 * `executeCompanyChatTurn` with the `persona` field set, which:
 *   - injects the persona's `<persona_memory>` block into the system prompt
 *     (when the persona has memory enabled), and
 *   - exposes the `upsert_persona_memory_entry` tool so the model can
 *     record durable facts back into `persona_memory_entries`.
 *
 * `personal` is intentionally NOT routed here — the personal copilot has
 * its own runtime under `/api/personal/chat` with a tighter tool set.
 */

import { NextResponse } from "next/server";
import type { UIMessage } from "ai";

import {
  isPersonaSlug,
  resolvePersonaSlug,
  PERSONA_CONFIG,
} from "@/lib/ai/personas";
import { handleApiError } from "@/lib/api-auth";
import {
  executeCompanyChatTurn,
} from "@/app/api/chat/route";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ persona: string }> },
) {
  try {
    const { persona: personaParam } = await params;
    if (!personaParam || !isPersonaSlug(personaParam)) {
      return NextResponse.json(
        { error: `Unknown persona: ${personaParam}` },
        { status: 404 },
      );
    }
    if (personaParam === "personal") {
      return NextResponse.json(
        {
          error:
            "Personal workspace has its own endpoint at /api/personal/chat.",
        },
        { status: 400 },
      );
    }
    const slug = resolvePersonaSlug(personaParam, "company");
    const config = PERSONA_CONFIG[slug];
    if (!config.visibleInCompanySidebar) {
      return NextResponse.json(
        { error: `Persona '${slug}' is not exposed via this endpoint.` },
        { status: 404 },
      );
    }

    let body: { messages?: UIMessage[]; id?: string; threadId?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: "messages must be an array" },
        { status: 400 },
      );
    }

    const result = await executeCompanyChatTurn({
      messages: body.messages,
      threadId:
        typeof body.threadId === "string" && body.threadId.trim().length > 0
          ? body.threadId.trim()
          : typeof body.id === "string" && body.id.trim().length > 0
            ? body.id.trim()
            : null,
      persona: { slug },
    });

    return result instanceof Response
      ? result
      : result.toUIMessageStreamResponse();
  } catch (error) {
    return handleApiError(error);
  }
}
