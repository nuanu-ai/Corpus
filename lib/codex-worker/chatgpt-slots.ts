import { join } from "node:path";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveWorkerHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME ?? process.env.HOME ?? "/root";
}

function resolveBaseCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME_CHATGPT ?? env.CODEX_HOME ?? join(resolveWorkerHome(env), ".codex");
}

function resolveBaseHealthDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_AUTH_HEALTH_DIR_CHATGPT_BASE ?? env.CODEX_AUTH_HEALTH_DIR ?? "./tmp/codex-auth-health";
}

function resolveBaseWorkerDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_WORKER_DIR ?? "/tmp/corpus-codex-worker";
}

export function getCodexChatGptSlotId(slotIndex: number): string {
  return `chatgpt-${slotIndex}`;
}

export function getCodexChatGptSlotCount(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInt(
    env.CODEX_WORKER_INSTANCES_CHATGPT ?? env.CODEX_WORKER_INSTANCES,
    4,
  );
}

export function resolveCodexChatGptSlotHome(
  slotIndex: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env[`CODEX_HOME_CHATGPT_SLOT_${slotIndex}`];
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }

  const baseHome = resolveBaseCodexHome(env);
  return slotIndex === 0 ? baseHome : `${baseHome}-${slotIndex}`;
}

export function resolveCodexChatGptSlotHealthDir(
  slotIndex: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env[`CODEX_AUTH_HEALTH_DIR_CHATGPT_SLOT_${slotIndex}`];
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }

  return join(resolveBaseHealthDir(env), getCodexChatGptSlotId(slotIndex));
}

export function resolveCodexChatGptSlotWorkerDir(
  slotIndex: number,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env[`CODEX_WORKER_DIR_CHATGPT_SLOT_${slotIndex}`];
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }

  return join(resolveBaseWorkerDir(env), getCodexChatGptSlotId(slotIndex));
}

export function buildCodexChatGptSlotEnv(
  slotIndex: number,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    CODEX_AUTH_MODE: env.CODEX_AUTH_MODE_CHATGPT ?? "chatgpt",
    CODEX_HOME: resolveCodexChatGptSlotHome(slotIndex, env),
    CODEX_AUTH_HEALTH_DIR: resolveCodexChatGptSlotHealthDir(slotIndex, env),
    CODEX_WORKER_DIR: resolveCodexChatGptSlotWorkerDir(slotIndex, env),
    CODEX_WORKER_SLOT_ID: getCodexChatGptSlotId(slotIndex),
  };
}

export function getCodexChatGptSlots(
  env: NodeJS.ProcessEnv = process.env,
): Array<{
  slotId: string;
  slotIndex: number;
  codeHome: string;
  healthDir: string;
  workerDir: string;
}> {
  const count = getCodexChatGptSlotCount(env);
  return Array.from({ length: count }, (_, slotIndex) => ({
    slotId: getCodexChatGptSlotId(slotIndex),
    slotIndex,
    codeHome: resolveCodexChatGptSlotHome(slotIndex, env),
    healthDir: resolveCodexChatGptSlotHealthDir(slotIndex, env),
    workerDir: resolveCodexChatGptSlotWorkerDir(slotIndex, env),
  }));
}
