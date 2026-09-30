import Database from "better-sqlite3";
import { randomUUID, timingSafeEqual } from "crypto";
import { mkdir } from "fs/promises";
import { join } from "path";
import simpleGit from "simple-git";

import type { RepoHandle, FileChange, AuthorInfo } from "../git/types.js";
import type { InternalServiceSecretMap } from "../internal-auth.js";
import { commitFiles, deleteFiles, getCommitSha, readFile } from "../git/repo-manager.js";
import { indexFile, isSearchIndexableQmdPath, removeFile } from "../index/indexer.js";
import {
  loadAccessControls,
  loadAgentProfile,
  checkWritePermission,
  checkPeriodLock,
} from "../access/access-control.js";
import type {
  WriteIntent,
  WriteResult,
  WriteError,
  WriteErrorCode,
  IntentStatus,
  StoredIntent,
  WriteOperation,
} from "./types.js";

// ── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_QUEUE_SIZE = 100;
const DEFAULT_INTENT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_BASE_MS = 100;

export interface WriteQueueOptions {
  maxQueueSize?: number;
  intentTimeoutMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  /** Shared secret for verifying agentToken in WriteIntent. */
  secret?: string;
  /** Signed internal-service secrets also accepted as write-intent tokens. */
  serviceSecrets?: InternalServiceSecretMap;
  /** SQLite index database — when provided, committed .qmd files are indexed automatically. */
  indexDb?: Database.Database;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function backoffMs(retry: number, base: number): number {
  // 100ms, 400ms, 1600ms  (base * 4^retry)
  return base * Math.pow(4, retry);
}

function makeWriteError(code: WriteErrorCode, message: string, details?: Record<string, unknown>): WriteError {
  return { code, message, ...(details ? { details } : {}) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract a period identifier from a file path, if the path targets a finance
 * ledger directory containing a period-formatted segment (YYYY-MM).
 */
function extractPeriodFromPaths(paths: string[]): string | null {
  const periodPattern = /\b(\d{4}-\d{2})\b/;
  for (const p of paths) {
    if (!p.startsWith("finance/ledger/")) continue;
    const match = p.match(periodPattern);
    if (match) return match[1];
  }
  return null;
}

function getFilePaths(operation: WriteOperation): string[] {
  switch (operation.type) {
    case "commit":
      return operation.files.map((f) => f.path);
    case "delete_files":
      return operation.files.map((f) => f.path);
    case "commit_to_branch":
      return operation.files.map((f) => f.path);
    case "create_branch":
    case "merge_branch":
      return [];
  }
}

const DOMAIN_PATTERN = /^[a-z][a-z0-9-]*$/;
const QMD_FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function validateIntentDomain(domain: string): WriteError | null {
  if (!DOMAIN_PATTERN.test(domain)) {
    return makeWriteError(
      "validation",
      `Invalid intent domain "${domain}". Expected kebab-case (e.g. "finance", "knowledge").`,
    );
  }
  return null;
}

function validateCommitFiles(
  domain: string,
  files: FileChange[],
): WriteError | null {
  for (const file of files) {
    const normalizedPath = normalizePath(file.path).replace(/^\/+/, "");
    const pathDomain = normalizedPath.split("/")[0];

    if (!pathDomain) {
      return makeWriteError("validation", `Invalid file path "${file.path}"`);
    }
    if (pathDomain !== domain) {
      return makeWriteError(
        "validation",
        `Path domain mismatch for "${file.path}". intent.domain="${domain}" but path targets "${pathDomain}".`,
      );
    }
    if (!normalizedPath.endsWith(".qmd")) {
      return makeWriteError(
        "validation",
        `Invalid file extension for "${file.path}". Only .qmd files are allowed.`,
      );
    }
    if (!QMD_FRONTMATTER_PATTERN.test(file.content)) {
      return makeWriteError(
        "validation",
        `Invalid QMD content for "${file.path}". Missing YAML frontmatter block.`,
      );
    }
  }

  return null;
}

function validateDeleteFiles(
  domain: string,
  files: Array<{ path: string }>,
): WriteError | null {
  for (const file of files) {
    const normalizedPath = normalizePath(file.path).replace(/^\/+/, "");
    const pathDomain = normalizedPath.split("/")[0];

    if (!pathDomain) {
      return makeWriteError("validation", `Invalid file path "${file.path}"`);
    }
    if (pathDomain !== domain) {
      return makeWriteError(
        "validation",
        `Path domain mismatch for "${file.path}". intent.domain="${domain}" but path targets "${pathDomain}".`,
      );
    }
    if (!normalizedPath.endsWith(".qmd")) {
      return makeWriteError(
        "validation",
        `Invalid file extension for "${file.path}". Only .qmd files are allowed.`,
      );
    }
  }

  return null;
}

// ── WriteQueue ────────────────────────────────────────────────────────────

interface PendingResolve {
  resolve: (result: WriteResult) => void;
}

export class WriteQueue {
  private db!: Database.Database;
  private processing = false;
  private queue: string[] = []; // intent IDs in FIFO order
  private inflight = 0; // total unresolved intents (pending + processing)
  private pending = new Map<string, PendingResolve>();
  private closed = false;
  private currentProcessing: Promise<void> | null = null;
  private abortController: AbortController | null = null;

  private maxQueueSize: number;
  private intentTimeoutMs: number;
  private maxRetries: number;
  private backoffBaseMs: number;
  private trustedAgentTokens: string[];
  private indexDb: Database.Database | undefined;

  constructor(
    private repo: RepoHandle,
    private queueDir: string,
    options?: WriteQueueOptions
  ) {
    this.maxQueueSize = options?.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.intentTimeoutMs = options?.intentTimeoutMs ?? DEFAULT_INTENT_TIMEOUT_MS;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.backoffBaseMs = options?.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.trustedAgentTokens = Array.from(
      new Set([
        ...(options?.secret ? [options.secret] : []),
        ...Object.values(options?.serviceSecrets ?? {}).filter((secret) => secret.trim().length > 0),
      ]),
    );
    this.indexDb = options?.indexDb;
  }

  /**
   * Initialize the queue: open SQLite, create tables, recover interrupted intents.
   * Must be called before submit().
   */
  async init(): Promise<void> {
    await mkdir(this.queueDir, { recursive: true });

    const dbPath = join(this.queueDir, "intents.sqlite");
    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma("journal_mode = WAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS intents (
        id TEXT PRIMARY KEY,
        intent TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        commit_sha TEXT,
        error TEXT,
        retries INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    await this.recoverInterrupted();
  }

  /**
   * Submit a write intent to the queue. Returns a promise that resolves
   * when the intent has been processed (committed, failed, or dead-lettered).
   */
  async submit(intent: WriteIntent): Promise<WriteResult> {
    if (this.closed) {
      return {
        success: false,
        error: makeWriteError("unknown", "Queue is closed"),
      };
    }

    if (this.inflight >= this.maxQueueSize) {
      return {
        success: false,
        error: makeWriteError("queue_full", `Queue is full (max ${this.maxQueueSize} intents)`),
      };
    }

    const id = intent.id ?? randomUUID();
    const intentWithId: WriteIntent = { ...intent, id };

    // Persist to SQLite
    this.db
      .prepare(
        `INSERT INTO intents (id, intent, status, retries)
         VALUES (?, ?, 'pending', 0)`
      )
      .run(id, JSON.stringify(intentWithId));

    this.queue.push(id);
    this.inflight++;

    // Create a promise that will resolve when this intent is processed
    const resultPromise = new Promise<WriteResult>((resolve) => {
      this.pending.set(id, { resolve });
    });

    // Trigger processing (non-blocking)
    this.triggerProcessing();

    return resultPromise;
  }

  /**
   * Get a stored intent by ID.
   */
  getIntent(id: string): StoredIntent | null {
    const row = this.db
      .prepare("SELECT * FROM intents WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as string,
      intent: JSON.parse(row.intent as string) as WriteIntent,
      status: row.status as IntentStatus,
      commitSha: (row.commit_sha as string) ?? undefined,
      error: (row.error as string) ?? undefined,
      retries: row.retries as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /** Number of intents currently in the queue (pending + processing). */
  get size(): number {
    return this.inflight;
  }

  /**
   * Close the queue: wait for current processing to finish, then close SQLite.
   */
  async close(): Promise<void> {
    this.closed = true;

    // Wait for any in-flight processing
    if (this.currentProcessing) {
      await this.currentProcessing;
    }

    // Reject any remaining pending submits
    for (const [id, p] of this.pending) {
      this.inflight = Math.max(0, this.inflight - 1);
      p.resolve({
        success: false,
        intentId: id,
        error: makeWriteError("unknown", "Queue closed while intent was pending"),
      });
    }
    this.pending.clear();

    if (this.db) {
      this.db.close();
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private triggerProcessing(): void {
    if (this.processing) return;
    if (this.queue.length === 0) return;

    this.processing = true;
    this.currentProcessing = this.processLoop();
  }

  private async processLoop(): Promise<void> {
    try {
      while (this.queue.length > 0 && !this.closed) {
        const intentId = this.queue.shift()!;
        await this.processOne(intentId);
      }
    } finally {
      this.processing = false;
      this.currentProcessing = null;
    }
  }

  private async processOne(intentId: string): Promise<void> {
    const stored = this.getIntent(intentId);
    if (!stored) {
      // Intent was deleted from DB somehow — resolve with error
      this.resolvePending(intentId, {
        success: false,
        intentId,
        error: makeWriteError("unknown", "Intent not found in journal"),
      });
      return;
    }

    // Mark as processing
    this.updateStatus(intentId, "processing");

    const intent = stored.intent;

    // Create AbortController so timeout can cancel executeIntent
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Use a cancellable timeout so it doesn't fire after intent completes
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<WriteResult>((resolve) => {
      timeoutId = setTimeout(() => {
        // Signal executeIntent to stop
        this.abortController?.abort();

        this.updateStatus(intentId, "failed", undefined, `Timeout after ${this.intentTimeoutMs}ms`);

        resolve({
          success: false,
          intentId,
          error: makeWriteError("timeout", `Intent processing timed out after ${this.intentTimeoutMs}ms`),
        });
      }, this.intentTimeoutMs);
    });

    const result = await Promise.race([
      this.executeIntent(intentId, intent, stored.retries, signal),
      timeoutPromise,
    ]);

    // Cancel timeout if executeIntent finished first
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    this.abortController = null;
    this.resolvePending(intentId, result);
  }

  private async executeIntent(
    intentId: string,
    intent: WriteIntent,
    currentRetries: number,
    signal?: AbortSignal
  ): Promise<WriteResult> {
    const operation = intent.operation;

    const domainError = validateIntentDomain(intent.domain);
    if (domainError) {
      this.updateStatus(intentId, "failed", undefined, domainError.message);
      return {
        success: false,
        intentId,
        error: domainError,
      };
    }

    if (operation.type === "commit" || operation.type === "commit_to_branch") {
      const fileError = validateCommitFiles(intent.domain, operation.files);
      if (fileError) {
        this.updateStatus(intentId, "failed", undefined, fileError.message);
        return {
          success: false,
          intentId,
          error: fileError,
        };
      }
    }
    if (operation.type === "delete_files") {
      const fileError = validateDeleteFiles(intent.domain, operation.files);
      if (fileError) {
        this.updateStatus(intentId, "failed", undefined, fileError.message);
        return {
          success: false,
          intentId,
          error: fileError,
        };
      }
    }

    // ── Step 1: Authenticate agent (always, regardless of operation type) ──
    if (signal?.aborted) {
      throw new Error("AbortedError: intent was cancelled by timeout");
    }

    // Verify agentToken matches a trusted write-intent token.
    if (this.trustedAgentTokens.length > 0) {
      const tokenBuf = Buffer.from(intent.agentToken);
      const tokenMatches = this.trustedAgentTokens.some((trustedToken) => {
        const trustedBuf = Buffer.from(trustedToken);
        return tokenBuf.length === trustedBuf.length && timingSafeEqual(tokenBuf, trustedBuf);
      });
      if (!tokenMatches) {
        const error = `Invalid agentToken for agent: ${intent.agentId}`;
        this.updateStatus(intentId, "failed", undefined, error);
        return {
          success: false,
          intentId,
          error: makeWriteError("permission", error),
        };
      }
    }

    const profile = await loadAgentProfile(this.repo, intent.agentId);

    if (!profile) {
      const error = `Agent profile not found: ${intent.agentId}`;
      this.updateStatus(intentId, "failed", undefined, error);
      return {
        success: false,
        intentId,
        error: makeWriteError("permission", error),
      };
    }

    if (profile.status !== "active") {
      const error = `Agent ${intent.agentId} is ${profile.status}`;
      this.updateStatus(intentId, "failed", undefined, error);
      return {
        success: false,
        intentId,
        error: makeWriteError("permission", error),
      };
    }

    // ── Step 2: Validate paths and permissions ──
    const filePaths = getFilePaths(operation);

    if (filePaths.length > 0) {
      if (signal?.aborted) {
        throw new Error("AbortedError: intent was cancelled by timeout");
      }

      const controls = await loadAccessControls(this.repo);

      // Step 3: Check domain boundaries
      const permResult = checkWritePermission(
        intent.agentId,
        filePaths,
        controls,
        profile
      );

      if (!permResult.allowed) {
        this.updateStatus(intentId, "failed", undefined, permResult.reason);
        return {
          success: false,
          intentId,
          error: makeWriteError("permission", permResult.reason ?? "Permission denied"),
        };
      }

      // Step 4: Check period locks for finance/ledger writes
      const period = extractPeriodFromPaths(filePaths);
      if (period) {
        const lock = await checkPeriodLock(this.repo, period);
        if (lock.locked) {
          const error = lock.reason ?? `Period ${period} is locked`;
          this.updateStatus(intentId, "failed", undefined, error);
          return {
            success: false,
            intentId,
            error: makeWriteError("permission", error),
          };
        }
      }
    } else if (operation.type === "create_branch" || operation.type === "merge_branch") {
      // Branch operations have no file paths but still need permission checks.
      // Only agents with "admin" or "write" permission should create/merge branches.
      const canBranch = profile.permissions.includes("admin") || profile.permissions.includes("write");
      if (!canBranch) {
        const error = `Agent ${intent.agentId} lacks 'admin' or 'write' permission for branch operations`;
        this.updateStatus(intentId, "failed", undefined, error);
        return {
          success: false,
          intentId,
          error: makeWriteError("permission", error),
        };
      }
    }

    // ── Step 5-7: Execute operation with git retry logic ──
    if (signal?.aborted) {
      throw new Error("AbortedError: intent was cancelled by timeout");
    }

    return this.executeWithRetry(intentId, intent, currentRetries, signal);
  }

  private async executeWithRetry(
    intentId: string,
    intent: WriteIntent,
    startRetry: number,
    signal?: AbortSignal
  ): Promise<WriteResult> {
    let retries = startRetry;

    while (retries < this.maxRetries) {
      try {
        // Check abort before each attempt to prevent ghost commits
        if (signal?.aborted) {
          this.updateStatus(intentId, "failed", undefined, "Aborted by timeout");
          return {
            success: false,
            intentId,
            error: makeWriteError("timeout", "Intent aborted by timeout before execution"),
          };
        }

        const result = await this.executeOperation(intent, signal);

        // Check abort after execution — if timed out during commit, roll back
        if (signal?.aborted) {
          this.updateStatus(intentId, "failed", undefined, "Aborted by timeout after execution");
          return {
            success: false,
            intentId,
            error: makeWriteError("timeout", "Intent aborted by timeout after execution"),
          };
        }

        // Success — mark completed
        this.updateStatus(intentId, "completed", result.commitSha);

        return {
          success: true,
          intentId,
          commitSha: result.commitSha,
        };
      } catch (err) {
        if (signal?.aborted) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.updateStatus(intentId, "failed", undefined, errorMsg);
          return {
            success: false,
            intentId,
            error: makeWriteError(
              "timeout",
              `Intent aborted by timeout: ${errorMsg}`,
            ),
          };
        }

        retries++;
        this.db
          .prepare("UPDATE intents SET retries = ?, updated_at = datetime('now') WHERE id = ?")
          .run(retries, intentId);

        if (retries >= this.maxRetries) {
          // Dead letter
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.updateStatus(intentId, "dead_letter", undefined, errorMsg);

          return {
            success: false,
            intentId,
            error: makeWriteError(
              "unknown",
              `Failed after ${this.maxRetries} retries: ${errorMsg}`
            ),
          };
        }

        // Exponential backoff before retry
        await sleep(backoffMs(retries - 1, this.backoffBaseMs));

        // Reset any dirty state before retry
        try {
          const git = simpleGit(this.repo.path);
          await git.reset(["--hard", "HEAD"]);
        } catch {
          // Best effort cleanup
        }
      }
    }

    // Should not reach here, but guard
    this.updateStatus(intentId, "dead_letter", undefined, "Exhausted retries");
    return {
      success: false,
      intentId,
      error: makeWriteError("unknown", "Exhausted retries"),
    };
  }

  private async executeOperation(
    intent: WriteIntent,
    signal?: AbortSignal
  ): Promise<{ commitSha?: string }> {
    const op = intent.operation;
    const git = simpleGit(this.repo.path);
    const author: AuthorInfo = {
      name: `agent:${intent.agentId}`,
      email: `${intent.agentId}@company-db.local`,
    };

    switch (op.type) {
      case "commit": {
        if (signal?.aborted) throw new Error("AbortedError: intent was cancelled by timeout");
        const result = await commitFiles(
          this.repo,
          op.files,
          op.commitMessage,
          author
        );
        // Index committed .qmd files in SQLite for search/query
        if (this.indexDb) {
          for (const file of op.files) {
            if (isSearchIndexableQmdPath(file.path)) {
              try {
                const content = await readFile(this.repo, file.path);
                if (content) indexFile(this.indexDb, file.path, content);
              } catch { /* best effort — index will catch up on restart */ }
            }
          }
        }
        return { commitSha: result.sha };
      }

      case "delete_files": {
        if (signal?.aborted) throw new Error("AbortedError: intent was cancelled by timeout");
        const result = await deleteFiles(
          this.repo,
          op.files,
          op.commitMessage,
          author,
        );
        if (this.indexDb) {
          for (const file of op.files) {
            if (file.path.endsWith(".qmd")) {
              try {
                removeFile(this.indexDb, file.path);
              } catch { /* best effort — index will catch up on restart */ }
            }
          }
        }
        return { commitSha: result.sha };
      }

      case "create_branch": {
        if (signal?.aborted) throw new Error("AbortedError: intent was cancelled by timeout");
        const fromRef = op.fromRef ?? "HEAD";
        await git.checkoutBranch(op.branchName, fromRef);
        // Switch back to main
        await git.checkout("main");
        const sha = await getCommitSha(this.repo);
        return { commitSha: sha };
      }

      case "merge_branch": {
        if (signal?.aborted) throw new Error("AbortedError: intent was cancelled by timeout");
        await git.checkout(op.targetBranch);
        try {
          await git.merge([op.sourceBranch, "-m", op.commitMessage]);
        } catch (mergeErr) {
          if (op.conflictPolicy === "ours") {
            await git.merge(["--abort"]).catch(() => {});
            await git.merge([
              op.sourceBranch,
              "-m",
              op.commitMessage,
              "--strategy-option",
              "ours",
            ]);
          } else {
            await git.merge(["--abort"]).catch(() => {});
            // Switch back to main before throwing
            await git.checkout("main").catch(() => {});
            throw mergeErr;
          }
        }
        const sha = await getCommitSha(this.repo);
        // Switch back to main
        if (op.targetBranch !== "main") {
          await git.checkout("main");
        }
        return { commitSha: sha };
      }

      case "commit_to_branch": {
        if (signal?.aborted) throw new Error("AbortedError: intent was cancelled by timeout");
        await git.checkout(op.branchName);
        try {
          const result = await commitFiles(
            this.repo,
            op.files,
            op.commitMessage,
            author
          );
          // Index committed .qmd files (branch commits are also searchable)
          if (this.indexDb) {
            for (const file of op.files) {
              if (isSearchIndexableQmdPath(file.path)) {
                try {
                  const content = await readFile(this.repo, file.path);
                  if (content) indexFile(this.indexDb, file.path, content);
                } catch { /* best effort */ }
              }
            }
          }
          return { commitSha: result.sha };
        } finally {
          // Always switch back to main
          await git.checkout("main");
        }
      }
    }
  }

  private updateStatus(
    intentId: string,
    status: IntentStatus,
    commitSha?: string,
    error?: string
  ): void {
    this.db
      .prepare(
        `UPDATE intents
         SET status = ?, commit_sha = ?, error = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(status, commitSha ?? null, error ?? null, intentId);
  }

  private resolvePending(intentId: string, result: WriteResult): void {
    const p = this.pending.get(intentId);
    if (p) {
      this.inflight = Math.max(0, this.inflight - 1);
      p.resolve(result);
      this.pending.delete(intentId);
    }
  }

  /**
   * On startup: scan for intents stuck in 'processing' status (from a crash).
   * - If files are uncommitted in git, reset and re-queue.
   * - If commit succeeded but status wasn't updated, mark completed.
   */
  private async recoverInterrupted(): Promise<void> {
    const rows = this.db
      .prepare("SELECT * FROM intents WHERE status = 'processing'")
      .all() as Array<Record<string, unknown>>;

    if (rows.length === 0) return;

    const git = simpleGit(this.repo.path);
    const status = await git.status();
    const isDirty =
      status.modified.length > 0 ||
      status.not_added.length > 0 ||
      status.staged.length > 0;

    for (const row of rows) {
      const intentId = row.id as string;

      if (isDirty) {
        // Files uncommitted — reset and re-queue
        await git.reset(["--hard", "HEAD"]);
        this.updateStatus(intentId, "pending");
        this.queue.push(intentId);
        this.inflight++;
      } else {
        // A clean tree is not enough proof that the commit succeeded.
        // Leave the intent failed so an operator can verify or retry it.
        this.updateStatus(
          intentId,
          "failed",
          undefined,
          "Interrupted processing recovered on a clean tree; manual verification required",
        );
      }
    }
  }
}
