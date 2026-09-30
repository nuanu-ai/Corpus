import { spawn } from "child_process";
import { join } from "path";

import { NextRequest, NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  createCodexChatAuthChallenge,
  expireCodexChatChallenges,
  getLatestCodexChatAuthChallenge,
  saveCodexChatLoginProfile,
  updateCodexChatAuthProfileState,
} from "@/lib/codex-chat/auth-store";
import {
  CODEX_CHAT_DEVICE_AUTH_HINT_WAIT_MS,
  CODEX_CHAT_DEVICE_AUTH_MAX_LIFETIME_MS,
} from "@/lib/codex-chat/device-auth";

const NPX_BIN = process.platform === "win32" ? "npx.cmd" : "npx";
const LOGIN_RUNNER_PATH = join(process.cwd(), "scripts", "codex-chat-device-login.ts");

function spawnDeviceLoginRunner(challengeId: string): void {
  const child = spawn(NPX_BIN, ["tsx", LOGIN_RUNNER_PATH, "--challenge-id", challengeId], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
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

    const label =
      typeof body.label === "string" && body.label.trim().length > 0
        ? body.label.trim()
        : "Codex ChatGPT login";

    const profile = await saveCodexChatLoginProfile({
      companyId,
      userId,
      label,
      codexHomePath: null,
    });

    const activeChallenge = await getLatestCodexChatAuthChallenge({
      companyId,
      userId,
      authProfileId: profile.id,
    });

    if (
      activeChallenge &&
      (activeChallenge.status === "pending" || activeChallenge.status === "awaiting_user") &&
      (!activeChallenge.expiresAt || new Date(activeChallenge.expiresAt).getTime() > Date.now())
    ) {
      return NextResponse.json({
        ok: true,
        profile,
        challenge: activeChallenge,
        reused: true,
      });
    }

    await expireCodexChatChallenges({ authProfileId: profile.id });
    await updateCodexChatAuthProfileState({
      companyId,
      userId,
      profileId: profile.id,
      status: "pending",
      lastFailureAt: null,
      metadata: {
        lastDeviceLoginError: null,
      },
    });

    const challenge = await createCodexChatAuthChallenge({
      authProfileId: profile.id,
      challengeType: "device_login",
      status: "pending",
      expiresAt: new Date(Date.now() + CODEX_CHAT_DEVICE_AUTH_MAX_LIFETIME_MS),
      metadata: {
        companyId,
        userId,
        requestedLabel: label,
      },
    });

    spawnDeviceLoginRunner(challenge.id);

    const startedAt = Date.now();
    let latest = challenge;
    while (Date.now() - startedAt < CODEX_CHAT_DEVICE_AUTH_HINT_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const next = await getLatestCodexChatAuthChallenge({
        companyId,
        userId,
        authProfileId: profile.id,
      });
      if (!next) continue;
      latest = next;
      if (next.loginUrl || next.deviceCode || next.status === "failed" || next.status === "completed") {
        break;
      }
    }

    return NextResponse.json({
      ok: true,
      profile,
      challenge: latest,
      reused: false,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
