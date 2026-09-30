import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import type { WriteQueue } from "./write-queue.js";
import type { WriteIntent, WriteResult } from "./types.js";
import {
  type InternalServiceSecretMap,
  verifySignedInternalRequest,
} from "../internal-auth.js";

// ── Options ──────────────────────────────────────────────────────────────

export interface HttpServerOptions {
  port: number;
  host?: string;
  serviceSecrets?: InternalServiceSecretMap;
  writeQueue: WriteQueue;
  bodyLimitBytes?: number;
}

const DEFAULT_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

// ── Server factory ───────────────────────────────────────────────────────

/**
 * Build a Fastify instance with write-queue routes registered but NOT
 * yet listening. Useful for testing via `server.inject()`.
 */
export function buildServer(
  writeQueue: WriteQueue,
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
  serviceSecrets: InternalServiceSecretMap = {},
): FastifyInstance {
  const server = Fastify({
    logger: false,
    bodyLimit: bodyLimitBytes,
  });

  // ── Auth hook — validate signed internal auth ──
  server.addHook("preValidation", async (request: FastifyRequest, reply: FastifyReply) => {
    const signed = verifySignedInternalRequest({
      headers: request.headers,
      serviceSecrets,
      method: request.method,
      path: request.raw.url ?? request.url,
      body: request.method === "POST" ? request.body : undefined,
    });
    if (signed) {
      return;
    }
    reply.code(401).send({ error: "Unauthorized" });
    return reply;
  });

  // ── POST /write — submit a WriteIntent ──────────────────────────────
  server.post("/write", async (request: FastifyRequest, reply: FastifyReply) => {
    let intent: WriteIntent;

    try {
      intent = parseWriteIntent(request.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid request body";
      reply.code(400).send({ error: message });
      return;
    }

    try {
      const result: WriteResult = await writeQueue.submit(intent);
      reply.code(200).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      reply.code(500).send({ error: message });
    }
  });

  // ── GET /status — health check ──────────────────────────────────────
  server.get("/status", async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.code(200).send({ status: "ok", queueSize: writeQueue.size });
  });

  return server;
}

/**
 * Create and start an HTTP server for the write queue.
 * Returns a running Fastify instance (call `server.close()` to stop).
 */
export async function createHttpServer(options: HttpServerOptions): Promise<FastifyInstance> {
  const {
    port,
    host = "127.0.0.1",
    writeQueue,
    bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES,
    serviceSecrets = {},
  } = options;

  const server = buildServer(writeQueue, bodyLimitBytes, serviceSecrets);
  await server.listen({ port, host });

  return server;
}

// ── Validation ───────────────────────────────────────────────────────────

function parseWriteIntent(body: unknown): WriteIntent {
  if (body === null || body === undefined || typeof body !== "object") {
    throw new Error("Request body must be a JSON object");
  }

  const obj = body as Record<string, unknown>;

  if (typeof obj.agentId !== "string" || obj.agentId.length === 0) {
    throw new Error("Missing or invalid field: agentId");
  }

  if (typeof obj.agentToken !== "string" || obj.agentToken.length === 0) {
    throw new Error("Missing or invalid field: agentToken");
  }

  if (typeof obj.domain !== "string" || obj.domain.length === 0) {
    throw new Error("Missing or invalid field: domain");
  }

  if (obj.operation === null || obj.operation === undefined || typeof obj.operation !== "object") {
    throw new Error("Missing or invalid field: operation");
  }

  const op = obj.operation as Record<string, unknown>;
  const validTypes = ["commit", "delete_files", "create_branch", "merge_branch", "commit_to_branch"];
  if (!validTypes.includes(op.type as string)) {
    throw new Error(`Invalid operation type: ${String(op.type)}`);
  }

  // Sub-field validation per operation type
  switch (op.type) {
    case "commit":
      if (!Array.isArray(op.files) || op.files.length === 0) {
        throw new Error("commit operation requires a non-empty 'files' array");
      }
      if (typeof op.commitMessage !== "string" || op.commitMessage.length === 0) {
        throw new Error("commit operation requires a non-empty 'commitMessage'");
      }
      break;
    case "delete_files":
      if (!Array.isArray(op.files) || op.files.length === 0) {
        throw new Error("delete_files operation requires a non-empty 'files' array");
      }
      if (typeof op.commitMessage !== "string" || op.commitMessage.length === 0) {
        throw new Error("delete_files operation requires a non-empty 'commitMessage'");
      }
      break;
    case "commit_to_branch":
      if (typeof op.branchName !== "string" || op.branchName.length === 0) {
        throw new Error("commit_to_branch operation requires a non-empty 'branchName'");
      }
      if (!Array.isArray(op.files) || op.files.length === 0) {
        throw new Error("commit_to_branch operation requires a non-empty 'files' array");
      }
      if (typeof op.commitMessage !== "string" || op.commitMessage.length === 0) {
        throw new Error("commit_to_branch operation requires a non-empty 'commitMessage'");
      }
      break;
    case "create_branch":
      if (typeof op.branchName !== "string" || op.branchName.length === 0) {
        throw new Error("create_branch operation requires a non-empty 'branchName'");
      }
      break;
    case "merge_branch":
      if (typeof op.sourceBranch !== "string" || op.sourceBranch.length === 0) {
        throw new Error("merge_branch operation requires a non-empty 'sourceBranch'");
      }
      if (typeof op.targetBranch !== "string" || op.targetBranch.length === 0) {
        throw new Error("merge_branch operation requires a non-empty 'targetBranch'");
      }
      if (typeof op.commitMessage !== "string" || op.commitMessage.length === 0) {
        throw new Error("merge_branch operation requires a non-empty 'commitMessage'");
      }
      if (op.conflictPolicy !== "abort" && op.conflictPolicy !== "ours") {
        throw new Error("merge_branch operation requires conflictPolicy: 'abort' or 'ours'");
      }
      break;
  }

  return body as WriteIntent;
}
