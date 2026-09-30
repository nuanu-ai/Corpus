import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies, platformSettings } from "@/lib/db/schema";

export const CODEX_WORKER_POOLS = ["chatgpt", "api_key"] as const;

export type CodexWorkerPool = (typeof CODEX_WORKER_POOLS)[number];

const DEFAULT_CODEX_WORKER_POOL: CodexWorkerPool = "chatgpt";
const CODEX_ROUTING_PLATFORM_SETTINGS_KEY = "codex_routing";

export function isCodexWorkerPool(value: unknown): value is CodexWorkerPool {
  return typeof value === "string" && (CODEX_WORKER_POOLS as readonly string[]).includes(value);
}

export function normalizeCodexWorkerPool(
  value: unknown,
  fallback: CodexWorkerPool = DEFAULT_CODEX_WORKER_POOL,
): CodexWorkerPool {
  return isCodexWorkerPool(value) ? value : fallback;
}

export function getDefaultCodexWorkerPool(env: NodeJS.ProcessEnv = process.env): CodexWorkerPool {
  return normalizeCodexWorkerPool(env.CODEX_DEFAULT_POOL);
}

export async function resolveDefaultCodexWorkerPool(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CodexWorkerPool> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, CODEX_ROUTING_PLATFORM_SETTINGS_KEY))
    .limit(1);

  const storedValue =
    row?.value && typeof row.value === "object" && !Array.isArray(row.value)
      ? (row.value as Record<string, unknown>).defaultPool
      : null;

  return normalizeCodexWorkerPool(storedValue, getDefaultCodexWorkerPool(env));
}

export function getCodexWorkerPoolFromCompanySettings(
  settings: Record<string, unknown> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CodexWorkerPool {
  if (settings && typeof settings === "object") {
    return normalizeCodexWorkerPool(settings.codexWorkerPool, getDefaultCodexWorkerPool(env));
  }
  return getDefaultCodexWorkerPool(env);
}

export async function resolveCompanyCodexWorkerPool(companyId: string): Promise<CodexWorkerPool> {
  const [row] = await db
    .select({ settings: companies.settings })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const companyPool = row?.settings && typeof row.settings === "object"
    ? (row.settings as Record<string, unknown>).codexWorkerPool
    : null;

  if (isCodexWorkerPool(companyPool)) {
    return companyPool;
  }

  return resolveDefaultCodexWorkerPool();
}
