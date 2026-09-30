#!/usr/bin/env node

import { spawn } from "child_process";

import { eq } from "drizzle-orm";

import { checkCodexAuthReady } from "@/lib/codex-worker/auth";
import {
  updateCodexChatAuthChallenge,
  updateCodexChatAuthProfileState,
} from "@/lib/codex-chat/auth-store";
import {
  CODEX_CHAT_DEVICE_AUTH_MAX_LIFETIME_MS,
  extractCodexDeviceCode,
  extractCodexLoginUrl,
  stripAnsi,
} from "@/lib/codex-chat/device-auth";
import {
  buildCodexChatAuthEnv,
  ensureCodexChatProfileHomePath,
} from "@/lib/codex-chat/env";
import { db } from "@/lib/db";
import { codexChatAuthChallenges, codexChatAuthProfiles } from "@/lib/db/schema";

function parseArgs(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--challenge-id") {
      return argv[index + 1] ?? null;
    }
    if (current.startsWith("--challenge-id=")) {
      return current.slice("--challenge-id=".length) || null;
    }
  }
  return null;
}

function truncate(value: string): string {
  return value.slice(-4000);
}

async function main(): Promise<void> {
  const challengeId = parseArgs(process.argv.slice(2));
  if (!challengeId) {
    throw new Error("Usage: tsx scripts/codex-chat-device-login.ts --challenge-id <uuid>");
  }

  const [row] = await db
    .select({
      challengeId: codexChatAuthChallenges.id,
      challengeStatus: codexChatAuthChallenges.status,
      challengeLoginUrl: codexChatAuthChallenges.loginUrl,
      challengeDeviceCode: codexChatAuthChallenges.deviceCode,
      profileId: codexChatAuthProfiles.id,
      companyId: codexChatAuthProfiles.companyId,
      userId: codexChatAuthProfiles.userId,
      authMode: codexChatAuthProfiles.authMode,
      codexHomePath: codexChatAuthProfiles.codexHomePath,
      profileStatus: codexChatAuthProfiles.status,
    })
    .from(codexChatAuthProfiles)
    .innerJoin(
      codexChatAuthChallenges,
      eq(codexChatAuthChallenges.authProfileId, codexChatAuthProfiles.id),
    )
    .where(eq(codexChatAuthChallenges.id, challengeId))
    .limit(1);

  if (!row) {
    throw new Error(`Codex chat auth challenge ${challengeId} not found.`);
  }

  if (row.challengeStatus === "completed" || row.challengeStatus === "failed") {
    return;
  }

  const codexHomePath = await ensureCodexChatProfileHomePath({
    companyId: row.companyId,
    userId: row.userId,
    profileId: row.profileId,
  });

  const env = buildCodexChatAuthEnv({
    companyId: row.companyId,
    userId: row.userId,
    profileId: row.profileId,
    authMode: "chatgpt_login",
    codexHomePath: row.codexHomePath ?? codexHomePath,
  });

  let stdout = "";
  let stderr = "";
  let loginUrl: string | null = row.challengeLoginUrl ?? null;
  let deviceCode: string | null = row.challengeDeviceCode ?? null;
  let settled = false;

  const child = spawn(process.env.CODEX_BIN ?? "codex", ["login", "--device-auth"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const publishHints = async () => {
    const combined = stripAnsi(`${stdout}\n${stderr}`);
    const nextLoginUrl = loginUrl ?? extractCodexLoginUrl(combined);
    const nextDeviceCode = deviceCode ?? extractCodexDeviceCode(combined);
    const changed = nextLoginUrl !== loginUrl || nextDeviceCode !== deviceCode;
    loginUrl = nextLoginUrl;
    deviceCode = nextDeviceCode;
    if (!changed) return;

    await updateCodexChatAuthChallenge({
      challengeId,
      patch: {
        loginUrl,
        deviceCode,
        status: loginUrl || deviceCode ? "awaiting_user" : "pending",
        expiresAt: new Date(Date.now() + CODEX_CHAT_DEVICE_AUTH_MAX_LIFETIME_MS),
        metadata: {
          stdout: truncate(stdout),
          stderr: truncate(stderr),
        },
      },
    });
  };

  const fail = async (message: string) => {
    await updateCodexChatAuthChallenge({
      challengeId,
      patch: {
        status: "failed",
        metadata: {
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          error: message,
        },
      },
    });
    await updateCodexChatAuthProfileState({
      companyId: row.companyId,
      userId: row.userId,
      profileId: row.profileId,
      status: "degraded",
      lastFailureAt: new Date(),
      metadata: {
        lastDeviceLoginError: message,
      },
    });
  };

  const timeout = setTimeout(async () => {
    if (settled) return;
    settled = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, 5_000).unref();
    await fail("Codex device login timed out.");
  }, CODEX_CHAT_DEVICE_AUTH_MAX_LIFETIME_MS);

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    void publishHints();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    void publishHints();
  });

  child.on("error", (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    void fail(error.message);
  });

  child.on("close", async (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    await publishHints();

    if (code !== 0) {
      await fail(stripAnsi(stderr || stdout).trim() || `codex login exited with code ${code ?? "unknown"}`);
      return;
    }

    const readiness = await checkCodexAuthReady({
      codexBin: process.env.CODEX_BIN ?? "codex",
      env,
    });

    if (!readiness.ready) {
      await fail(readiness.reason);
      return;
    }

    await updateCodexChatAuthChallenge({
      challengeId,
      patch: {
        status: "completed",
        loginUrl,
        deviceCode,
        metadata: {
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          mode: readiness.mode,
        },
      },
    });

    await updateCodexChatAuthProfileState({
      companyId: row.companyId,
      userId: row.userId,
      profileId: row.profileId,
      status: "ready",
      lastReadyAt: new Date(),
      lastFailureAt: null,
      metadata: {
        billingMode: "chatgpt_login",
        lastDeviceLoginError: null,
      },
    });
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
