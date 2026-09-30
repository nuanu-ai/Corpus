import { execFile, spawn } from "child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const CODEX_LOGIN_TIMEOUT_MS = 30_000;

export const CODEX_AUTH_MODES = ["chatgpt", "api_key", "auto"] as const;

export type CodexAuthMode = (typeof CODEX_AUTH_MODES)[number];

function normalizeMode(value: unknown): CodexAuthMode {
  if (typeof value === "string" && (CODEX_AUTH_MODES as readonly string[]).includes(value)) {
    return value as CodexAuthMode;
  }
  return "chatgpt";
}

export function getCodexApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.CODEX_OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function resolveCodexAuthMode(env: NodeJS.ProcessEnv = process.env): Exclude<CodexAuthMode, "auto"> {
  const mode = normalizeMode(env.CODEX_AUTH_MODE);
  if (mode === "auto") {
    return getCodexApiKey(env) ? "api_key" : "chatgpt";
  }
  return mode;
}

export function buildCodexCliEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {
    ...env,
    NO_COLOR: "1",
  };

  const mode = resolveCodexAuthMode(env);
  if (mode === "api_key") {
    const apiKey = getCodexApiKey(env);
    if (apiKey) {
      nextEnv.OPENAI_API_KEY = apiKey;
    }
  } else {
    delete nextEnv.OPENAI_API_KEY;
  }

  return nextEnv;
}

async function readCodexLoginStatus(
  codexBin: string,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; stdout: string; stderr: string; reason?: string }> {
  if (env.CODEX_HOME && env.CODEX_HOME.trim().length > 0) {
    await mkdir(env.CODEX_HOME, { recursive: true }).catch(() => null);
  }
  try {
    const result = await execFileAsync(codexBin, ["login", "status"], {
      maxBuffer: 1024 * 1024,
      env: buildCodexCliEnv(env),
    });
    return {
      ok: true,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (execError.code === "ENOENT") {
      return {
        ok: false,
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
        reason: `Codex CLI not found (${codexBin}).`,
      };
    }
    const details = [execError.stderr, execError.stdout]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim())
      .join(" ");
    return {
      ok: false,
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? "",
      reason: details || (error instanceof Error ? error.message : "Codex auth is not ready."),
    };
  }
}

async function loginCodexWithApiKey(
  codexBin: string,
  apiKey: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (env.CODEX_HOME && env.CODEX_HOME.trim().length > 0) {
    await mkdir(env.CODEX_HOME, { recursive: true }).catch(() => null);
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(codexBin, ["login", "--with-api-key"], {
      env: buildCodexCliEnv(env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    let stdout = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5_000).unref();
      reject(new Error("codex login --with-api-key timed out"));
    }, CODEX_LOGIN_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const details = [stderr, stdout]
        .filter((value) => value.trim().length > 0)
        .map((value) => value.trim())
        .join(" ");
      reject(
        new Error(details || `codex login --with-api-key exited with code ${code ?? "unknown"}`),
      );
    });

    child.stdin.write(apiKey);
    child.stdin.end();
  });
}

export async function checkCodexAuthReady(input: {
  codexBin: string;
  env?: NodeJS.ProcessEnv;
}): Promise<{ ready: true; mode: "chatgpt" | "api_key" } | { ready: false; mode: "chatgpt" | "api_key"; reason: string }> {
  const env = input.env ?? process.env;
  const mode = resolveCodexAuthMode(env);

  if (mode === "api_key") {
    const apiKey = getCodexApiKey(env);
    if (!apiKey) {
      return { ready: false, mode, reason: "CODEX_OPENAI_API_KEY or OPENAI_API_KEY is required for api_key auth." };
    }

    const status = await readCodexLoginStatus(input.codexBin, env);
    const statusText = `${status.stdout}\n${status.stderr}`;
    if (status.ok && statusText.includes("API key")) {
      return { ready: true, mode };
    }

    try {
      await loginCodexWithApiKey(input.codexBin, apiKey, env);
    } catch (error) {
      return {
        ready: false,
        mode,
        reason: error instanceof Error ? error.message : "Codex API-key login failed.",
      };
    }

    const nextStatus = await readCodexLoginStatus(input.codexBin, env);
    const nextText = `${nextStatus.stdout}\n${nextStatus.stderr}`;
    if (nextStatus.ok && nextText.includes("API key")) {
      return { ready: true, mode };
    }

    return {
      ready: false,
      mode,
      reason:
        nextStatus.reason ??
        "Codex login status did not confirm API-key auth in the configured CODEX_HOME.",
    };
  }

  const status = await readCodexLoginStatus(input.codexBin, env);
  if (status.ok) {
    return { ready: true, mode };
  }
  return { ready: false, mode, reason: status.reason ?? "Codex auth is not ready." };
}
