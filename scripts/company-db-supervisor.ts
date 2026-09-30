import { loadEnvConfig } from "@next/env";
import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("Configure DATABASE_URL before starting services.");
  if (process.env.COMPANY_DB_AUTO_PROVISION === "false") {
    throw new Error("Auto provisioning is disabled; use your external Company-DB process manager.");
  }
  if (!process.env.COMPANY_DB_INTERNAL_SERVICE_SECRET?.trim() &&
      !process.env.COMPANY_DB_INTERNAL_SERVICE_SECRETS?.trim()) {
    throw new Error("Configure Company-DB internal service secrets before starting services.");
  }
  if (!["localhost", "127.0.0.1"].includes(process.env.COMPANY_DB_HOST || "127.0.0.1")) {
    throw new Error("This supervisor manages local Company-DB services; configure a loopback host.");
  }
  const entry = resolve("packages/company-db/dist/cli.js");
  await access(entry);
  const { dbClient, closeDbConnection } = await import("../lib/db");
  const { provisionTenantDbRepo } = await import("../lib/company-db/provisioning");
  const { isCompanyDbReady, waitForCompanyDb } = await import("../lib/company-db/readiness");
  // A dedicated session holds the lock for this supervisor's lifetime.
  const lock = await dbClient.reserve();
  const [locked] = await lock`SELECT pg_try_advisory_lock(87451292) AS acquired`;
  if (!locked.acquired) {
    lock.release();
    await closeDbConnection();
    throw new Error("A Company-DB supervisor is already running for this database.");
  }
  const children = new Map<string, { child: ChildProcess; slug: string; port: number }>();
  let stopping = false;
  const stop = () => {
    stopping = true;
    for (const { child } of children.values()) child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const status = async (id: string, value: "active" | "failed") => {
    await dbClient`UPDATE companies SET provisioning_status = ${value}, updated_at = now()
      WHERE id = ${id}::uuid AND provisioning_status IS DISTINCT FROM ${value}`;
  };
  try {
    console.info("[supervisor] Watching tenant services; press Ctrl-C to stop.");
    while (!stopping) {
      // Assigning a slug in ensureCompanyProvisioned requests first startup.
      // Keep unused community tenants lazy; restart already provisioned stores.
      const tenants = await dbClient<{ id: string }[]>`SELECT id FROM companies
        WHERE slug IS NOT NULL OR provisioning_status <> 'pending' ORDER BY created_at`;
      const ids = new Set(tenants.map((tenant) => tenant.id));
      for (const [id, running] of children) {
        if (!ids.has(id)) {
          running.child.kill("SIGTERM");
          children.delete(id);
        }
      }
      for (const { id } of tenants) {
        if (stopping) break;
        try {
          const running = children.get(id);
          if (running) {
            const ready = await isCompanyDbReady(running.port, running.slug);
            await status(id, ready ? "active" : "failed");
            if (!ready) running.child.kill("SIGTERM");
            continue;
          }
          const tenant = await provisionTenantDbRepo(id);
          if (!tenant || stopping) continue;
          const { slug, companyDbPort: port } = tenant;
          const child = spawn(process.execPath, [entry], {
            stdio: "inherit",
            env: {
              ...process.env,
              COMPANY_DB_REPO: resolve(process.env.COMPANY_DB_REPO || "./data/companies"),
              COMPANY_DB_TENANT_SLUG: slug,
              COMPANY_DB_PORT: String(port),
              COMPANY_DB_QUEUE_PORT: String(port + 1),
              COMPANY_DB_MCP_PORT: String(port + 2),
            },
          });
          children.set(id, { child, slug, port });
          child.once("exit", () => {
            if (children.get(id)?.child === child) children.delete(id);
          });
          child.once("error", (error) => {
            console.error("[supervisor] Spawn failed:", error.message);
            if (children.get(id)?.child === child) children.delete(id);
          });
          const ready = await waitForCompanyDb(port, slug, 10_000);
          await status(id, ready && child.exitCode === null && child.signalCode === null ? "active" : "failed");
          if (!ready) child.kill("SIGTERM");
        } catch (error) {
          console.error(`[supervisor] Tenant ${id} failed:`, error);
          await status(id, "failed");
        }
      }
      if (!stopping) await delay(1_000);
    }
  } finally {
    stop();
    await Promise.all([...children.values()].map(({ child }) => new Promise<void>((done) => {
      if (child.exitCode !== null || child.signalCode !== null) return done();
      const timer = setTimeout(() => { child.kill("SIGKILL"); done(); }, 5_000);
      child.once("exit", () => { clearTimeout(timer); done(); });
    })));
    await lock`SELECT pg_advisory_unlock(87451292)`;
    lock.release();
    await closeDbConnection();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
