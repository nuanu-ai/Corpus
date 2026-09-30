import { NextRequest, NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { disconnectCodexChatAuthProfile } from "@/lib/codex-chat/auth-store";

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const profile = await disconnectCodexChatAuthProfile({
      companyId,
      userId,
      profileId: stringOrNull(body.profileId),
    });

    return NextResponse.json({
      ok: true,
      profile,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
