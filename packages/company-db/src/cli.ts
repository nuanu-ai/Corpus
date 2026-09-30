/**
 * CLI entry point for the company-db daemon.
 *
 * Starts:
 *   1. Git repo manager (opens or inits the company repo)
 *   2. SQLite index database
 *   3. Write queue with its HTTP server
 *   4. REST API server with query service + RBAC
 *
 * Configuration via environment variables:
 *   COMPANY_DB_REPO   — path to the git repository (or pass as argv[2])
 *   COMPANY_DB_PORT   — API server port (default: 3100)
 *   COMPANY_DB_INTERNAL_SERVICE_ID — current internal caller ID (default: corpus-app)
 *   COMPANY_DB_INTERNAL_SERVICE_SECRET — current internal caller secret
 *   COMPANY_DB_INTERNAL_SERVICE_SECRETS — JSON map of serviceId -> secret
 *   COMPANY_DB_QUEUE_PORT — write queue HTTP port (default: 3101)
 */

import Fastify from "fastify";
import { join } from "path";
import { mkdir } from "fs/promises";

import { initCompanyRepo } from "./git/repo-manager.js";
import { createIndexDb } from "./index/schema.js";
import { WriteQueue } from "./queue/write-queue.js";
import { createHttpServer } from "./queue/http-server.js";
import { createQueryService } from "./api/query-service.js";
import { registerApiRoutes } from "./api/routes.js";
import { startMcpHttpServer } from "./api/mcp-transport.js";
import { createAuditLogger } from "./audit/logger.js";
import { createSemanticSearchRuntimeFromEnv } from "./semantic/runtime.js";
import type { PolicyConfig } from "./api/policy-engine.js";
import {
  getFirstInternalServiceSecret,
  hasInternalServiceSecrets,
  parseInternalServiceSecrets,
} from "./internal-auth.js";

// ── Default policy (MVP) ─────────────────────────────────────────────────

const DEFAULT_POLICY: PolicyConfig = {
  roles: {
    owner: {
      domains: ["*"],
      field_levels: ["public", "internal", "confidential", "restricted"],
      can_submit: true,
    },
    admin: {
      domains: ["*"],
      field_levels: ["public", "internal", "confidential", "restricted"],
      can_submit: true,
    },
    cfo_agent: {
      domains: ["*"],
      field_levels: ["public", "internal", "confidential", "restricted"],
      can_submit: true,
    },
    member: {
      domains: ["*"],
      field_levels: ["public", "internal", "confidential"],
      can_submit: false,
    },
    viewer: {
      domains: ["*"],
      field_levels: ["public", "internal"],
      can_submit: false,
    },
    external_accountant: {
      domains: ["finance", "banking", "tax", "expenses", "revenue"],
      field_levels: ["public", "internal", "confidential"],
      can_submit: true,
    },
    investor_view: {
      domains: ["finance", "revenue"],
      field_levels: ["public"],
      can_submit: false,
    },
    partner_agent: {
      domains: ["revenue", "operations"],
      field_levels: ["public"],
      can_submit: false,
    },
  },
  tools: {
    query_financials: { min_role: "investor_view" },
    query_metrics: { min_role: "investor_view" },
    submit_document: { min_role: "external_accountant", requires: "can_submit" },
    query_customers: { min_role: "partner_agent" },
    query_inventory: { min_role: "partner_agent" },
  },
};

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const repoPath = process.env.COMPANY_DB_REPO || process.argv[2];
  const port = parseInt(process.env.COMPANY_DB_PORT || "3100", 10);
  const serviceId = process.env.COMPANY_DB_INTERNAL_SERVICE_ID?.trim() || "corpus-app";
  const parsedServiceSecrets = parseInternalServiceSecrets(
    process.env.COMPANY_DB_INTERNAL_SERVICE_SECRETS,
    {
      serviceId,
      serviceSecret: process.env.COMPANY_DB_INTERNAL_SERVICE_SECRET,
    },
  );
  const serviceSecrets = hasInternalServiceSecrets(parsedServiceSecrets)
    ? parsedServiceSecrets
    : process.env.NODE_ENV === "production"
      ? parsedServiceSecrets
      : {
          [serviceId]: "dev-internal-service-secret",
        };

  const hasSignedServiceAuth = hasInternalServiceSecrets(serviceSecrets);
  if (process.env.NODE_ENV === "production" && !hasSignedServiceAuth) {
    console.error(
      "[company-db] FATAL: configure COMPANY_DB_INTERNAL_SERVICE_SECRET(S) in production.",
    );
    process.exit(1);
  }

  // Tenant slug this process serves. Used to reject misrouted requests.
  const tenantSlug = process.env.COMPANY_DB_TENANT_SLUG || null;
  const queuePort = parseInt(process.env.COMPANY_DB_QUEUE_PORT || "3101", 10);
  const mcpPort = parseInt(process.env.COMPANY_DB_MCP_PORT || String(port + 2), 10);
  const queueBodyLimitBytes = parseInt(
    process.env.COMPANY_DB_QUEUE_BODY_LIMIT_BYTES || String(32 * 1024 * 1024),
    10,
  );

  if (!repoPath) {
    console.error("Usage: company-db <repo-path>");
    console.error("  or set COMPANY_DB_REPO environment variable");
    process.exit(1);
  }

  console.log(`[company-db] Starting with repo: ${repoPath}`);

  // ── 1. Init git repo ────────────────────────────────────────────────
  // "data" is the default repo subdirectory name for single-tenant mode.
  // In multi-tenant mode, each tenant gets its own directory identified by company slug.
  const repoSlug = tenantSlug || "data";
  const repo = await initCompanyRepo(repoPath, repoSlug);
  console.log(`[company-db] Repo initialized at ${repo.path}`);

  // ── 2. Init SQLite index ────────────────────────────────────────────
  // Use repo.path (git repo dir) so daemon and post-commit hook share the same index.
  const dbDir = join(repo.path, ".company-db");
  await mkdir(dbDir, { recursive: true });
  const indexDb = createIndexDb(join(dbDir, "index.sqlite"));
  console.log(`[company-db] Index DB ready`);

  // ── 3. Init audit logger ────────────────────────────────────────────
  const auditLogger = createAuditLogger(join(dbDir, "audit"));
  console.log(`[company-db] Audit logger ready`);

  // ── 4. Init write queue ─────────────────────────────────────────────
  const queueDir = join(dbDir, "queue");
  const writeQueue = new WriteQueue(repo, queueDir, {
    secret: getFirstInternalServiceSecret(serviceSecrets),
    serviceSecrets,
    indexDb,
  });
  await writeQueue.init();
  console.log(`[company-db] Write queue ready`);

  // ── 5. Start write queue HTTP server ────────────────────────────────
  const queueServer = await createHttpServer({
    port: queuePort,
    host: "127.0.0.1",
    serviceSecrets,
    writeQueue,
    bodyLimitBytes: Number.isFinite(queueBodyLimitBytes) && queueBodyLimitBytes > 0
      ? queueBodyLimitBytes
      : 32 * 1024 * 1024,
  });
  console.log(`[company-db] Write queue HTTP listening on :${queuePort}`);

  // ── 6. Start API server ─────────────────────────────────────────────
  const semanticSearch = createSemanticSearchRuntimeFromEnv(repoSlug);
  const queryService = createQueryService(indexDb, DEFAULT_POLICY, {
    semanticSearch,
  });

  const apiServer = Fastify({ logger: false });

  // Health check
  apiServer.get("/health", async () => ({ status: "ok", version: "0.0.1" }));

  // Register API routes (tenantSlug enables request routing validation)
  registerApiRoutes(
    apiServer,
    queryService,
    writeQueue,
    auditLogger,
    DEFAULT_POLICY,
    tenantSlug,
    repo,
    indexDb,
    serviceSecrets,
  );

  await apiServer.listen({ port, host: "127.0.0.1" });
  console.log(`[company-db] API server listening on :${port}`);

  // ── 7. Start MCP Streamable HTTP server ──────────────────────────────
  const mcpServer = await startMcpHttpServer({
    port: mcpPort,
    host: "127.0.0.1",
    serviceSecrets,
    tenantSlug,
    queryService,
    writeQueue,
    policy: DEFAULT_POLICY,
  });
  console.log(`[company-db] MCP server listening on :${mcpServer.port}`);

  console.log(`[company-db] Ready.`);
  console.log(`  API:   http://127.0.0.1:${port}/api/v1/`);
  console.log(`  Queue: http://127.0.0.1:${queuePort}/write`);
  console.log(`  MCP:   http://127.0.0.1:${mcpServer.port}/mcp`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[company-db] Shutting down...");
    await writeQueue.close();
    await mcpServer.close();
    await apiServer.close();
    await queueServer.close();
    indexDb.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[company-db] Fatal error:", err);
  process.exit(1);
});
