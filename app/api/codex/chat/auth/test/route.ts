import { NextRequest, NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { checkCodexAuthReady } from "@/lib/codex-worker/auth";
import {
  getCodexChatAuthProfileById,
  getLatestCodexChatAuthProfile,
  readCodexChatApiKey,
} from "@/lib/codex-chat/auth-store";
import {
  buildCodexChatAuthEnv,
  ensureCodexChatProfileHomePath,
} from "@/lib/codex-chat/env";

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

    const requestedProfileId = stringOrNull(body.profileId);
    const activeProfile = await getLatestCodexChatAuthProfile({ companyId, userId });
    const profileId = requestedProfileId ?? activeProfile?.id ?? null;

    if (!profileId) {
      return NextResponse.json(
        { ok: false, ready: false, error: "No Codex auth profile configured" },
        { status: 404 },
      );
    }

    const profile = await getCodexChatAuthProfileById({
      companyId,
      userId,
      profileId,
    });
    if (!profile) {
      return NextResponse.json(
        { ok: false, ready: false, error: "Codex auth profile not found" },
        { status: 404 },
      );
    }

    const apiKey =
      profile.authMode === "api_key"
        ? await readCodexChatApiKey(profileId)
        : null;
    if (profile.authMode === "api_key" && (!apiKey || !apiKey.startsWith("sk-"))) {
      return NextResponse.json(
        { ok: false, ready: false, error: "Stored Codex API key is not usable" },
        { status: 400 },
      );
    }

    const codexHomePath = await ensureCodexChatProfileHomePath({
      companyId,
      userId,
      profileId,
    });
    const env = buildCodexChatAuthEnv({
      companyId,
      userId,
      profileId,
      authMode: profile.authMode,
      apiKey,
      codexHomePath: profile.codexHomePath ?? codexHomePath,
    });
    const auth = await checkCodexAuthReady({
      codexBin: process.env.CODEX_BIN ?? "codex",
      env,
    });
    if (!auth.ready) {
      return NextResponse.json(
        {
          ok: false,
          ready: false,
          error: auth.reason,
          profileId,
          billingMode: profile.authMode,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      ready: true,
      profileId,
      billingMode: profile.authMode,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
