import { setTimeout as delay } from "node:timers/promises";

export async function isCompanyDbReady(port: number, slug: string): Promise<boolean> {
  try {
    const host = process.env.COMPANY_DB_HOST || "127.0.0.1";
    const response = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
      cache: "no-store",
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health.status === "ok" && health.tenantSlug === slug;
  } catch {
    return false;
  }
}

export async function waitForCompanyDb(
  port: number, slug: string, timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await isCompanyDbReady(port, slug)) return true;
    await delay(250);
  } while (Date.now() < deadline);
  return false;
}
