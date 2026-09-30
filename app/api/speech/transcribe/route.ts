import { NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { getUserApiKeyPlaintext } from "@/lib/auth/user-api-keys";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whisper API caps individual uploads at 25 MB. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Mime types accepted by OpenAI Whisper. Browser MediaRecorder usually emits
 * `audio/webm;codecs=opus`; Safari emits `audio/mp4`. We validate loosely and
 * pass the blob straight to OpenAI.
 */
const ACCEPTED_PREFIXES = ["audio/"];

function resolveServerApiKey(): string | null {
  return (
    process.env.OPENAI_TRANSCRIPTION_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.CODEX_OPENAI_API_KEY?.trim() ||
    null
  );
}

/**
 * Resolve the OpenAI API key for the current request.
 *
 * - tier='community' (BYOK) users MUST provide their own OpenAI key via
 *   /settings/byok. We never fall back to the shared key for them — that
 *   would defeat the cost-sharing goal.
 * - tier='managed' / api-key auth / other paths: use the shared server key.
 */
async function resolveApiKey(userId: string): Promise<
  | { source: "user_byok" | "server"; apiKey: string }
  | { source: "missing_byok"; tier: string }
  | { source: "no_server_key" }
> {
  const [userRow] = await db
    .select({ tier: users.tier })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const tier = userRow?.tier ?? "managed";

  if (tier === "community") {
    const byok = await getUserApiKeyPlaintext({ userId, provider: "openai" });
    if (byok) {
      return { source: "user_byok", apiKey: byok };
    }
    return { source: "missing_byok", tier };
  }

  const server = resolveServerApiKey();
  if (server) {
    return { source: "server", apiKey: server };
  }
  return { source: "no_server_key" };
}

export async function POST(request: NextRequest) {
  try {
    // Authenticated session or API key — voice input is user-initiated from
    // the chat UI but we still want the same access perimeter as /api/chat.
    const auth = await getAuthContext();

    const resolved = await resolveApiKey(auth.userId);
    if (resolved.source === "missing_byok") {
      return NextResponse.json(
        {
          error:
            "Voice transcription requires your own OpenAI API key. Add it at /settings/byok.",
          reason: "byok_required",
        },
        { status: 412 },
      );
    }
    if (resolved.source === "no_server_key") {
      return NextResponse.json(
        {
          error:
            "Transcription is not configured. Set OPENAI_API_KEY (or OPENAI_TRANSCRIPTION_API_KEY) in the environment.",
        },
        { status: 503 },
      );
    }
    const apiKey = resolved.apiKey;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing 'file' field with audio blob." },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: "Uploaded audio is empty." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `Audio exceeds ${Math.round(MAX_BYTES / (1024 * 1024))} MB limit.`,
        },
        { status: 413 },
      );
    }

    const contentType = file.type || "audio/webm";
    if (!ACCEPTED_PREFIXES.some((prefix) => contentType.startsWith(prefix))) {
      return NextResponse.json(
        { error: `Unsupported audio mime type: ${contentType}` },
        { status: 415 },
      );
    }

    const language = typeof form.get("language") === "string"
      ? String(form.get("language"))
      : undefined;
    const prompt = typeof form.get("prompt") === "string"
      ? String(form.get("prompt"))
      : undefined;
    const requestedModel = typeof form.get("model") === "string"
      ? String(form.get("model"))
      : undefined;
    const model = requestedModel?.trim() ||
      process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() ||
      "whisper-1";

    // Re-wrap the blob so OpenAI gets a proper filename with extension —
    // `whisper-1` uses the extension as a format hint.
    const ext = contentType.includes("mp4")
      ? "mp4"
      : contentType.includes("ogg")
        ? "ogg"
        : contentType.includes("wav")
          ? "wav"
          : contentType.includes("mpeg")
            ? "mp3"
            : "webm";
    const filename = `voice-input.${ext}`;

    const upstream = new FormData();
    upstream.append(
      "file",
      new File([await file.arrayBuffer()], filename, { type: contentType }),
    );
    upstream.append("model", model);
    upstream.append("response_format", "verbose_json");
    if (language) upstream.append("language", language);
    if (prompt) upstream.append("prompt", prompt);

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upstream,
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        `[speech/transcribe] OpenAI error (${response.status}):`,
        text.slice(0, 500),
      );
      return NextResponse.json(
        {
          error: `Transcription service error (${response.status}).`,
        },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as {
      text?: string;
      language?: string;
      duration?: number;
    };

    const text = typeof payload.text === "string" ? payload.text.trim() : "";

    return NextResponse.json({
      text,
      language: payload.language ?? null,
      duration: typeof payload.duration === "number" ? payload.duration : null,
      model,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
