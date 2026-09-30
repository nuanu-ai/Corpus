import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { CodexAuthMode } from "@/lib/codex-worker/auth";

type PersistedStatus = "ready" | "broken";

export interface PersistedCodexAuthHealth {
  mode: Exclude<CodexAuthMode, "auto">;
  status: PersistedStatus;
  updatedAt: string;
  lastReadyAt: string | null;
  lastFailureAt: string | null;
  activeFailureReason: string | null;
  lastFailureReason: string | null;
  workerId: string | null;
  codeHome: string | null;
}

function resolveHealthDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(/* turbopackIgnore: true */ env.CODEX_AUTH_HEALTH_DIR ?? "./tmp/codex-auth-health");
}

function resolveHealthPath(
  mode: Exclude<CodexAuthMode, "auto">,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(resolveHealthDir(env), `${mode}.json`);
}

function resolveCodeHome(
  mode: Exclude<CodexAuthMode, "auto">,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.CODEX_HOME && env.CODEX_HOME.trim().length > 0) {
    return env.CODEX_HOME.trim();
  }
  return mode === "chatgpt"
    ? env.CODEX_HOME_CHATGPT ?? null
    : env.CODEX_HOME_API_KEY ?? null;
}

function resolveAuthStorePath(
  mode: Exclude<CodexAuthMode, "auto">,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const codeHome = resolveCodeHome(mode, env);
  return codeHome ? resolve(codeHome, "auth.json") : null;
}

function toMillis(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function normalizePersisted(
  mode: Exclude<CodexAuthMode, "auto">,
  raw: unknown,
): PersistedCodexAuthHealth | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const status = record.status === "ready" || record.status === "broken" ? record.status : null;
  if (!status) return null;
  return {
    mode,
    status,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date(0).toISOString(),
    lastReadyAt: typeof record.lastReadyAt === "string" ? record.lastReadyAt : null,
    lastFailureAt: typeof record.lastFailureAt === "string" ? record.lastFailureAt : null,
    activeFailureReason:
      typeof record.activeFailureReason === "string" ? record.activeFailureReason : null,
    lastFailureReason:
      typeof record.lastFailureReason === "string" ? record.lastFailureReason : null,
    workerId: typeof record.workerId === "string" ? record.workerId : null,
    codeHome: typeof record.codeHome === "string" ? record.codeHome : null,
  };
}

export async function readPersistedCodexAuthHealth(
  mode: Exclude<CodexAuthMode, "auto">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PersistedCodexAuthHealth | null> {
  try {
    const file = await readFile(resolveHealthPath(mode, env), "utf8");
    return normalizePersisted(mode, JSON.parse(file));
  } catch {
    return null;
  }
}

export async function readCodexAuthStoreState(
  mode: Exclude<CodexAuthMode, "auto">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ path: string | null; modifiedAt: string | null; lastRefresh: string | null }> {
  const filePath = resolveAuthStorePath(mode, env);
  if (!filePath) {
    return { path: null, modifiedAt: null, lastRefresh: null };
  }

  try {
    const [stats, file] = await Promise.all([
      stat(filePath),
      readFile(filePath, "utf8"),
    ]);
    const parsed = JSON.parse(file) as Record<string, unknown>;
    return {
      path: filePath,
      modifiedAt: stats.mtime.toISOString(),
      lastRefresh: typeof parsed.last_refresh === "string" ? parsed.last_refresh : null,
    };
  } catch {
    return {
      path: filePath,
      modifiedAt: null,
      lastRefresh: null,
    };
  }
}

export async function isPersistedCodexAuthFailureActive(
  mode: Exclude<CodexAuthMode, "auto">,
  env: NodeJS.ProcessEnv = process.env,
  persisted?: PersistedCodexAuthHealth | null,
): Promise<boolean> {
  const state = persisted ?? (await readPersistedCodexAuthHealth(mode, env));
  if (!state || state.status !== "broken") return false;

  const failureAt = toMillis(state.updatedAt) ?? toMillis(state.lastFailureAt);
  if (!failureAt) return true;

  const store = await readCodexAuthStoreState(mode, env);
  const storeModifiedAt = toMillis(store.modifiedAt);
  if (!storeModifiedAt) return true;

  return storeModifiedAt <= failureAt;
}

export async function persistCodexAuthHealth(input: {
  mode: Exclude<CodexAuthMode, "auto">;
  status: PersistedStatus;
  reason?: string | null;
  workerId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<PersistedCodexAuthHealth> {
  const env = input.env ?? process.env;
  const current = await readPersistedCodexAuthHealth(input.mode, env);
  const now = new Date().toISOString();

  const next: PersistedCodexAuthHealth = {
    mode: input.mode,
    status: input.status,
    updatedAt: now,
    lastReadyAt: input.status === "ready" ? now : current?.lastReadyAt ?? null,
    lastFailureAt: input.status === "broken" ? now : current?.lastFailureAt ?? null,
    activeFailureReason:
      input.status === "broken"
        ? input.reason?.trim() || current?.activeFailureReason || "Codex auth failed."
        : null,
    lastFailureReason:
      input.status === "broken"
        ? input.reason?.trim() || current?.lastFailureReason || "Codex auth failed."
        : current?.lastFailureReason ?? null,
    workerId: input.workerId ?? current?.workerId ?? null,
    codeHome: resolveCodeHome(input.mode, env),
  };

  await mkdir(resolveHealthDir(env), { recursive: true });
  await writeFile(resolveHealthPath(input.mode, env), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function isCodexAuthRuntimeError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("refresh token") ||
    normalized.includes("sign in again") ||
    normalized.includes("logged out") ||
    normalized.includes("codex auth is not ready") ||
    normalized.includes("codex login status did not confirm") ||
    normalized.includes("invalid_request_error")
  );
}
