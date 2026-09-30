import { NextRequest, NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { saveCodexChatApiKeyProfile } from "@/lib/codex-chat/auth-store";

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const apiKey = stringOrNull(body.apiKey);
    if (!apiKey) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }

    const profile = await saveCodexChatApiKeyProfile({
      companyId,
      userId,
      apiKey,
      label: stringOrNull(body.label),
      codexHomePath: stringOrNull(body.codexHomePath),
    });

    return NextResponse.json({ ok: true, profile });
  } catch (err) {
    if (err instanceof Error && err.message.includes("must start with sk-")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return handleApiError(err);
  }
}
