import { basename } from "path";
import type {
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
} from "fastify";

import type Database from "better-sqlite3";

import type { QueryService } from "./query-service.js";
import { evaluateAccess, type Caller, type CallerRole, type PolicyConfig } from "./policy-engine.js";
import type { WriteQueue } from "../queue/write-queue.js";
import type { AuditLogger } from "../audit/logger.js";
import type { WriteIntent } from "../queue/types.js";
import type { RepoHandle } from "../git/types.js";
import { getRepoStats, getCommitLog, readFile as readRepoFile } from "../git/repo-manager.js";
import { getEntityStats, countEntities, type EntityView } from "../index/query.js";
import {
  type InternalServiceSecretMap,
  verifySignedInternalRequest,
} from "../internal-auth.js";

// ── Helpers ──────────────────────────────────────────────────────────────

const VALID_ROLES: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "member",
  "viewer",
  "cfo_agent",
  "external_accountant",
  "investor_view",
  "partner_agent",
]);
const SUBMIT_DOMAIN_PATTERN = /^[a-z][a-z0-9-]*$/;
const SUBMIT_QMD_FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function detectDomainFromPath(filePath: string): string | null {
  if (!filePath) return null;

  const parts = filePath.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  if (parts[0] === "entities") {
    return parts[2] ?? null;
  }

  return parts[0] ?? null;
}

function isTruthyQueryValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseEntityView(value: unknown): EntityView | undefined {
  if (value === "summary" || value === "full") return value;
  return undefined;
}

/**
 * Extract caller identity from request headers.
 * Accepts signed internal-service auth only.
 * Returns null if authentication fails.
 */
function extractCaller(
  request: FastifyRequest,
  serviceSecrets: InternalServiceSecretMap,
  body?: unknown,
): Caller | null {
  const signed = verifySignedInternalRequest({
    headers: request.headers,
    serviceSecrets,
    method: request.method,
    path: request.raw.url ?? request.url,
    body,
  });

  if (signed && signed.callerId && signed.callerRole && VALID_ROLES.has(signed.callerRole)) {
    return {
      id: signed.callerId,
      role: signed.callerRole as CallerRole,
      authenticatedVia: signed.authenticatedVia,
    };
  }

  return null;
}

// ── Route registration ───────────────────────────────────────────────────

/**
 * Register REST API v1 routes on a Fastify instance.
 *
 * Endpoints:
 *   GET  /api/v1/:domain/:entityId  — get entity by domain and ID
 *   GET  /api/v1/file               — read a raw .qmd file by repo path
 *   GET  /api/v1/query              — query entities with filters
 *   GET  /api/v1/search             — full-text search
 *   GET  /api/v1/search/semantic    — semantic narrative search
 *   GET  /api/v1/stats              — repo + entity statistics
 *   GET  /api/v1/commits            — paginated commit log
 *   POST /api/v1/submit-document    — submit extraction document
 */
export function registerApiRoutes(
  server: FastifyInstance,
  queryService: QueryService,
  writeQueue: WriteQueue,
  auditLogger: AuditLogger,
  policy: PolicyConfig,
  /** Expected tenant slug. When set, requests with a mismatched x-company-slug are rejected. */
  tenantSlug?: string | null,
  /** Git repo handle for stats endpoint. */
  repo?: RepoHandle | null,
  /** SQLite database for entity stats. */
  indexDb?: Database.Database | null,
  /** Signed internal-service verifier map. */
  serviceSecrets: InternalServiceSecretMap = {},
): void {
  // ── Tenant routing guard ────────────────────────────────────────────
  // In process-per-tenant mode each Company-DB process serves one company.
  // If COMPANY_DB_TENANT_SLUG is set, reject requests intended for a
  // different tenant to prevent data leakage from misrouted requests.
  if (tenantSlug) {
    server.addHook("onRequest", async (request, reply) => {
      const slug = request.headers["x-company-slug"] as string | undefined;
      if (slug && slug !== tenantSlug) {
        reply.code(403).send({ error: "Forbidden" });
        return reply;
      }
    });
  }
  // ── GET /api/v1/:domain/:entityId ──────────────────────────────────

  server.get<{
    Params: { domain: string; entityId: string };
    Querystring: { view?: string };
  }>("/api/v1/:domain/:entityId", async (request, reply: FastifyReply) => {
    const caller = extractCaller(request, serviceSecrets);
    if (!caller) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    const { domain, entityId } = request.params;
    const view = parseEntityView(request.query.view);

    // Index stores qualified_id = frontmatter.id (e.g. "je-00001"), not "domain/id".
    // Look up by entityId directly, then verify the domain matches.
    const entity = queryService.getEntity(caller, entityId, view);

    const domainMatch = entity?.domain === domain;

    auditLogger.log({
      actor: caller.id,
      action: "get_entity",
      resource: `${domain}/${entityId}`,
      domain,
      result: entity && domainMatch ? "allow" : "deny",
      reason: !entity ? "not found or access denied" : !domainMatch ? "domain mismatch" : undefined,
    });

    if (!entity || !domainMatch) {
      reply.code(404).send({ error: "Entity not found or access denied" });
      return;
    }

    reply.code(200).send(entity);
  });

  server.get<{
    Params: { qualifiedId: string };
    Querystring: { view?: string };
  }>("/api/v1/entity/:qualifiedId", async (request, reply: FastifyReply) => {
    const caller = extractCaller(request, serviceSecrets);
    if (!caller) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    const qualifiedId = request.params.qualifiedId;
    const view = parseEntityView(request.query.view);
    const entity = queryService.getEntity(caller, qualifiedId, view);

    auditLogger.log({
      actor: caller.id,
      action: "get_entity",
      resource: qualifiedId,
      domain: entity?.domain,
      result: entity ? "allow" : "deny",
      reason: entity ? undefined : "not found or access denied",
    });

    if (!entity) {
      reply.code(404).send({ error: "Entity not found or access denied" });
      return;
    }

    reply.code(200).send(entity);
  });

  // ── GET /api/v1/file ───────────────────────────────────────────────

  server.get<{
    Querystring: { path?: string; download?: string };
  }>("/api/v1/file", async (request, reply: FastifyReply) => {
    const caller = extractCaller(request, serviceSecrets);
    if (!caller) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    if (!repo) {
      reply.code(503).send({ error: "File preview unavailable: repo not configured" });
      return;
    }

    const rawPath = typeof request.query.path === "string" ? request.query.path : "";
    const filePath = normalizeFilePath(rawPath);
    const download = isTruthyQueryValue(request.query.download);

    if (!filePath) {
      reply.code(400).send({ error: "Missing required query parameter: path" });
      return;
    }
    if (!filePath.endsWith(".qmd")) {
      reply.code(400).send({ error: "Only .qmd files can be previewed" });
      return;
    }

    const domain = detectDomainFromPath(filePath);
    if (!domain) {
      reply.code(400).send({ error: "Invalid file path" });
      return;
    }

    const accessDecision = evaluateAccess(caller, { domain }, policy);
    if (!accessDecision.allowed) {
      auditLogger.log({
        actor: caller.id,
        action: "get_file",
        resource: filePath,
        domain,
        result: "deny",
        reason: accessDecision.reason ?? "Access denied",
      });
      reply.code(403).send({ error: "Forbidden: " + (accessDecision.reason ?? "Access denied") });
      return;
    }

    let content: string | null = null;
    try {
      content = await readRepoFile(repo, filePath);
    } catch {
      reply.code(400).send({ error: "Invalid file path" });
      return;
    }

    if (content === null) {
      reply.code(404).send({ error: "File not found" });
      return;
    }

    auditLogger.log({
      actor: caller.id,
      action: "get_file",
      resource: filePath,
      domain,
      result: "allow",
      metadata: { download },
    });

    reply.header("Content-Type", "text/plain; charset=utf-8");
    if (download) {
      const fileName = basename(filePath).replace(/"/g, "");
      reply.header("Content-Disposition", `attachment; filename="${fileName}"`);
    }
    reply.code(200).send(content);
  });

  // ── GET /api/v1/query ──────────────────────────────────────────────

  server.get<{
    Querystring: {
      domain?: string;
      type?: string;
      status?: string;
      documentId?: string;
      limit?: string;
      offset?: string;
      view?: string;
    };
  }>("/api/v1/query", async (request, reply: FastifyReply) => {
    const caller = extractCaller(request, serviceSecrets);
    if (!caller) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    const { domain, type, status, documentId, limit, offset, view } = request.query;

    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? parseInt(offset, 10) : undefined;

    if (parsedLimit !== undefined && isNaN(parsedLimit)) {
      reply.code(400).send({ error: "Invalid limit parameter: must be a number" });
      return;
    }
    if (parsedOffset !== undefined && isNaN(parsedOffset)) {
      reply.code(400).send({ error: "Invalid offset parameter: must be a number" });
      return;
    }

    const filters = {
      domain,
      type,
      status,
      documentId,
      limit: parsedLimit,
      offset: parsedOffset,
      view: parseEntityView(view),
    };

    const results = queryService.query(caller, filters);

    auditLogger.log({
      actor: caller.id,
      action: "query",
      resource: "entities",
      domain: filters.domain,
      result: "allow",
      metadata: { filterCount: Object.keys(filters).filter((k) => filters[k as keyof typeof filters] !== undefined).length },
    });

    // Return total matching count (not page size) so clients can detect truncation.
    let totalCount = results.length;
    if (parsedLimit !== undefined && indexDb) {
      totalCount = countEntities(indexDb, { domain, type, status, documentId });
    }

    reply.code(200).send({ data: results, count: totalCount });
  });

  // ── GET /api/v1/search ─────────────────────────────────────────────

  server.get<{
    Querystring: { q?: string; domain?: string; view?: string; limit?: string };
  }>("/api/v1/search", async (request, reply: FastifyReply) => {
    const caller = extractCaller(request, serviceSecrets);
    if (!caller) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    const { q, domain, view, limit } = request.query;

    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    if (parsedLimit !== undefined && isNaN(parsedLimit)) {
      reply.code(400).send({ error: "Invalid limit parameter: must be a number" });
      return;
    }

    if (!q || q.trim().length === 0) {
      reply.code(400).send({ error: "Missing required query parameter: q" });
      return;
    }

    const results = queryService.search(caller, q, {
      domain,
      view: parseEntityView(view),
      limit: parsedLimit,
    });

    auditLogger.log({
      actor: caller.id,
      action: "search",
      resource: "entities",
      result: "allow",
      metadata: { query: q, resultCount: results.length },
    });

    reply.code(200).send({ data: results, count: results.length });
  });

  // ── GET /api/v1/search/semantic ────────────────────────────────────

  server.get<{
    Querystring: { q?: string; domain?: string; limit?: string };
  }>("/api/v1/search/semantic", async (request, reply: FastifyReply) => {
    const caller = extractCaller(request, serviceSecrets);
    if (!caller) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    if (!queryService.semanticSearchAvailable()) {
      reply.code(503).send({ error: "Semantic search is not enabled" });
      return;
    }

    const { q, domain, limit } = request.query;
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    if (parsedLimit !== undefined && isNaN(parsedLimit)) {
      reply.code(400).send({ error: "Invalid limit parameter: must be a number" });
      return;
    }

    if (!q || q.trim().length === 0) {
      reply.code(400).send({ error: "Missing required query parameter: q" });
      return;
    }

    const results = await queryService.searchSemantic(caller, q, {
      domain,
      limit: parsedLimit,
    });

    auditLogger.log({
      actor: caller.id,
      action: "search_semantic",
      resource: "entities",
      result: "allow",
      metadata: {
        query: q,
        domain,
        resultCount: results.length,
      },
    });

    reply.code(200).send({ data: results, count: results.length });
  });

  // ── GET /api/v1/stats ────────────────────────────────────────────────

  server.get("/api/v1/stats", async (request, reply: FastifyReply) => {
    const caller = extractCaller(request, serviceSecrets);
    if (!caller) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    // Stats requires a management-level role.
    if (caller.role !== "owner" && caller.role !== "admin" && caller.role !== "cfo_agent") {
      auditLogger.log({
        actor: caller.id,
        action: "get_stats",
        resource: "stats",
        result: "deny",
        reason: `Role ${caller.role} is not authorized. Requires owner, admin, or cfo_agent.`,
      });
      reply.code(403).send({ error: "Forbidden: requires owner, admin, or cfo_agent role" });
      return;
    }

    if (!repo || !indexDb) {
      reply.code(503).send({ error: "Stats not available: repo or index not configured" });
      return;
    }

    const [repoStats, entityStats] = await Promise.all([
      getRepoStats(repo),
      Promise.resolve(getEntityStats(indexDb)),
    ]);

    auditLogger.log({
      actor: caller.id,
      action: "get_stats",
      resource: "stats",
      result: "allow",
    });

    reply.code(200).send({
      totalEntities: entityStats.totalEntities,
      totalCommits: repoStats.totalCommits,
      domains: entityStats.domains,
      heatmap: repoStats.heatmap,
      lastCommit: repoStats.lastCommit,
    });
  });

  // ── GET /api/v1/commits ──────────────────────────────────────────────

  server.get<{
    Querystring: { limit?: string; offset?: string };
  }>("/api/v1/commits", async (request, reply: FastifyReply) => {
    const caller = extractCaller(request, serviceSecrets);
    if (!caller) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    // Commit history requires a management-level role.
    if (caller.role !== "owner" && caller.role !== "admin" && caller.role !== "cfo_agent") {
      auditLogger.log({
        actor: caller.id,
        action: "get_commits",
        resource: "commits",
        result: "deny",
        reason: `Role ${caller.role} is not authorized. Requires owner, admin, or cfo_agent.`,
      });
      reply.code(403).send({ error: "Forbidden: requires owner, admin, or cfo_agent role" });
      return;
    }

    if (!repo) {
      reply.code(503).send({ error: "Commits not available: repo not configured" });
      return;
    }

    const { limit, offset } = request.query;
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedOffset = offset ? parseInt(offset, 10) : undefined;

    if (parsedLimit !== undefined && (isNaN(parsedLimit) || parsedLimit < 1)) {
      reply.code(400).send({ error: "Invalid limit parameter: must be a positive number" });
      return;
    }
    if (parsedOffset !== undefined && (isNaN(parsedOffset) || parsedOffset < 0)) {
      reply.code(400).send({ error: "Invalid offset parameter: must be a non-negative number" });
      return;
    }

    const result = await getCommitLog(repo, parsedLimit ?? 20, parsedOffset ?? 0);

    auditLogger.log({
      actor: caller.id,
      action: "get_commits",
      resource: "commits",
      result: "allow",
      metadata: { limit: parsedLimit ?? 20, offset: parsedOffset ?? 0 },
    });

    reply.code(200).send(result);
  });

  // ── POST /api/v1/submit-document ───────────────────────────────────

  server.post("/api/v1/submit-document", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.body || typeof request.body !== "object") {
      reply.code(400).send({ error: "Request body must be a JSON object" });
      return;
    }

    const caller = extractCaller(request, serviceSecrets, request.body);
    if (!caller) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    // Check tool-level access for submit_document
    const toolCheck = evaluateAccess(caller, { tool: "submit_document" }, policy);
    if (!toolCheck.allowed) {
      reply.code(403).send({ error: "Forbidden: " + toolCheck.reason });
      return;
    }

    const body = request.body as Record<string, unknown>;

    // Validate required fields
    if (typeof body.domain !== "string" || body.domain.length === 0) {
      reply.code(400).send({ error: "Missing required field: domain" });
      return;
    }
    if (!SUBMIT_DOMAIN_PATTERN.test(body.domain)) {
      reply.code(400).send({
        error: `Invalid domain "${body.domain}". Expected kebab-case (e.g. finance, knowledge).`,
      });
      return;
    }

    if (!body.files || !Array.isArray(body.files) || body.files.length === 0) {
      reply.code(400).send({ error: "Missing required field: files (non-empty array)" });
      return;
    }

    for (const [index, file] of body.files.entries()) {
      if (!file || typeof file !== "object") {
        reply.code(400).send({ error: `files[${index}] must be an object` });
        return;
      }

      const path = (file as Record<string, unknown>).path;
      const content = (file as Record<string, unknown>).content;

      if (typeof path !== "string" || path.length === 0) {
        reply.code(400).send({ error: `files[${index}].path must be a non-empty string` });
        return;
      }
      if (typeof content !== "string" || content.length === 0) {
        reply.code(400).send({ error: `files[${index}].content must be a non-empty string` });
        return;
      }

      const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!normalizedPath.startsWith(`${body.domain}/`)) {
        reply.code(400).send({
          error: `files[${index}].path must be inside "${body.domain}/"`,
        });
        return;
      }
      if (!normalizedPath.endsWith(".qmd")) {
        reply.code(400).send({
          error: `files[${index}].path must end with .qmd`,
        });
        return;
      }
      if (!SUBMIT_QMD_FRONTMATTER_PATTERN.test(content)) {
        reply.code(400).send({
          error: `files[${index}].content must contain YAML frontmatter`,
        });
        return;
      }
    }

    // Build a write intent from the submission
    const writeIntentToken = Object.values(serviceSecrets).find((secret) => secret.trim().length > 0) ?? "";
    if (!writeIntentToken) {
      reply.code(503).send({ error: "Signed internal-service auth is not configured" });
      return;
    }
    const intent: WriteIntent = {
      agentId: caller.id,
      agentToken: writeIntentToken,
      domain: body.domain as string,
      operation: {
        type: "commit",
        files: body.files as Array<{ path: string; content: string }>,
        commitMessage: (body.commitMessage as string) || `${body.domain}: submit document via API`,
      },
      metadata: {
        submittedBy: caller.id,
        submittedAt: new Date().toISOString(),
        ...(body.metadata as Record<string, unknown> ?? {}),
      },
    };

    const result = await writeQueue.submit(intent);

    auditLogger.log({
      actor: caller.id,
      action: "submit_document",
      resource: `${body.domain}/document`,
      domain: body.domain as string,
      result: result.success ? "allow" : "deny",
      reason: result.error?.message,
      metadata: { intentId: result.intentId, commitSha: result.commitSha },
    });

    if (!result.success) {
      const errorCode = result.error?.code;
      const statusCode = errorCode === "validation"
        ? 400
        : errorCode === "permission"
          ? 403
          : 422;
      reply.code(statusCode).send({ error: result.error?.message ?? "Submission failed", details: result.error });
      return;
    }

    reply.code(201).send({
      success: true,
      intentId: result.intentId,
      commitSha: result.commitSha,
    });
  });
}
