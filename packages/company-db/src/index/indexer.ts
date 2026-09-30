import type Database from "better-sqlite3";
import type { RepoHandle } from "../git/types.js";
import { parseQmd } from "../qmd/parser.js";
import { readFile, listFiles, getCommitSha } from "../git/repo-manager.js";
import simpleGit from "simple-git";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexFileResult {
  qualifiedId: string;
  refsCount: number;
}

// Frontmatter fields we extract into dedicated columns
interface EntityFrontmatter {
  id?: string;
  type?: string;
  title?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

// Pattern matching qualified IDs:
//   "abc-123", "je-00042", "inv-007"              (local)
//   "sub-co:emp-001", "branch-x:je-00042"         (namespaced)
const QUALIFIED_ID_PATTERN = /^(?:[a-z][a-z0-9-]*:)?[a-z][a-z0-9]*-\d+$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect entity slug from a file path for multi-entity repos.
 * Files under "entities/<slug>/..." belong to that child entity.
 * All other paths belong to the "root" entity.
 * E.g. "entities/sub-co/finance/je-001.qmd" -> "sub-co"
 */
function detectEntitySlug(filePath: string): string {
  if (filePath.startsWith("entities/")) {
    const parts = filePath.split("/");
    if (parts.length >= 3) {
      return parts[1];
    }
  }
  return "root";
}

/**
 * Detect domain from a file path.
 * Domain is the first directory component (e.g. "finance/ledger/je-001.qmd" -> "finance").
 * For multi-entity paths like "entities/sub-co/finance/...", the domain is the 3rd segment.
 */
function detectDomain(filePath: string): string {
  // Multi-entity path: entities/<slug>/<domain>/...
  if (filePath.startsWith("entities/")) {
    const parts = filePath.split("/");
    // parts[0]="entities", parts[1]=slug, parts[2]=domain
    if (parts.length >= 4 && parts[2]) {
      return parts[2];
    }
    return "_root";
  }

  const firstSlash = filePath.indexOf("/");
  if (firstSlash === -1) return "_root";
  return filePath.substring(0, firstSlash);
}

function normalizeReportType(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/-/g, "_");
}

function isTechnicalSidecarPath(filePath: string): boolean {
  return filePath.endsWith(".statement-lines.qmd");
}

export function isEntityIndexableQmdPath(filePath: string): boolean {
  return filePath.endsWith(".qmd") && !filePath.startsWith(".schema/");
}

export function isSearchIndexableQmdPath(filePath: string): boolean {
  return isEntityIndexableQmdPath(filePath) && !isTechnicalSidecarPath(filePath);
}

function buildBodyForSearchIndex(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  if (
    String(frontmatter.type ?? "") !== "financial_snapshot" ||
    normalizeReportType(frontmatter.report_type) !== "general_ledger"
  ) {
    return body;
  }

  const stripped = body.split(/\n## Line Items\b/)[0]?.trimEnd() ?? "";
  if (stripped.length > 0) return stripped;

  return String(frontmatter.title ?? frontmatter.report_type ?? "").trim();
}

/**
 * Extract cross-references from frontmatter.
 * Looks for:
 *  1. Keys ending in `_id` or `_ref` whose values look like qualified IDs
 *  2. Any string value matching the `xxx-NNN` pattern
 */
function extractRefs(
  frontmatter: Record<string, unknown>,
  sourceId: string
): Array<{ targetId: string; refType: string }> {
  const refs: Array<{ targetId: string; refType: string }> = [];
  const seen = new Set<string>();

  function addRef(targetId: string, refType: string): void {
    const key = `${targetId}:${refType}`;
    if (!seen.has(key) && targetId !== sourceId) {
      seen.add(key);
      refs.push({ targetId, refType });
    }
  }

  function scanValue(key: string, value: unknown): void {
    if (typeof value === "string" && QUALIFIED_ID_PATTERN.test(value)) {
      const refType = key.endsWith("_id") || key.endsWith("_ref") ? key : "mention";
      addRef(value, refType);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        scanValue(key, item);
      }
    }
  }

  for (const [key, value] of Object.entries(frontmatter)) {
    scanValue(key, value);
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Prepared statement factories (cached per db via WeakMap)
// ---------------------------------------------------------------------------

interface PreparedStatements {
  upsertEntity: Database.Statement;
  deleteRefsBySource: Database.Statement;
  insertRef: Database.Statement;
  deleteFtsByQid: Database.Statement;
  insertFts: Database.Statement;
  deleteEntityByPath: Database.Statement;
  getEntityByPath: Database.Statement;
  getMeta: Database.Statement;
  upsertMeta: Database.Statement;
}

const stmtCache = new WeakMap<Database.Database, PreparedStatements>();

function getStatements(db: Database.Database): PreparedStatements {
  let stmts = stmtCache.get(db);
  if (stmts) return stmts;

  // Ensure meta table exists for tracking last-indexed commit
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // The schema creates FTS with content=entities, but entities lacks a body column.
  // Recreate FTS as a standalone (content-storing) table so body text can be indexed.
  // Only perform this migration once — check the fts_migrated flag first.
  const migrated = db
    .prepare("SELECT value FROM index_meta WHERE key = 'fts_migrated'")
    .get() as { value: string } | undefined;

  if (!migrated) {
    const ftsInfo = db
      .prepare(`SELECT sql FROM sqlite_master WHERE name = 'entities_fts'`)
      .get() as { sql: string | null } | undefined;

    if (ftsInfo?.sql?.includes("content=entities")) {
      db.exec(`DROP TABLE IF EXISTS entities_fts`);
      db.exec(`
        CREATE VIRTUAL TABLE entities_fts USING fts5(
          qualified_id,
          title,
          body,
          domain,
          type
        );
      `);
    }

    db.prepare("INSERT OR REPLACE INTO index_meta (key, value) VALUES ('fts_migrated', '1')").run();
  }

  stmts = {
    upsertEntity: db.prepare(`
      INSERT OR REPLACE INTO entities
        (qualified_id, type, domain, file_path, frontmatter, title, status, created_at, updated_at, indexed_at, entity_slug, local_id)
      VALUES
        (@qualified_id, @type, @domain, @file_path, @frontmatter, @title, @status, @created_at, @updated_at, datetime('now'), @entity_slug, @local_id)
    `),

    deleteRefsBySource: db.prepare(`DELETE FROM refs WHERE source_id = ?`),

    insertRef: db.prepare(`
      INSERT OR IGNORE INTO refs (source_id, target_id, ref_type)
      VALUES (@source_id, @target_id, @ref_type)
    `),

    deleteFtsByQid: db.prepare(`DELETE FROM entities_fts WHERE qualified_id = ?`),

    insertFts: db.prepare(`
      INSERT INTO entities_fts(qualified_id, title, body, domain, type)
      VALUES (@qualified_id, @title, @body, @domain, @type)
    `),

    deleteEntityByPath: db.prepare(`DELETE FROM entities WHERE file_path = ?`),

    getEntityByPath: db.prepare(`SELECT qualified_id, rowid, title, domain, type FROM entities WHERE file_path = ?`),

    getMeta: db.prepare(`SELECT value FROM index_meta WHERE key = ?`),
    upsertMeta: db.prepare(`INSERT OR REPLACE INTO index_meta (key, value) VALUES (?, ?)`),
  };

  stmtCache.set(db, stmts);
  return stmts;
}

// ---------------------------------------------------------------------------
// indexFile
// ---------------------------------------------------------------------------

/**
 * Parse a QMD file and upsert it into the index database.
 *
 * @param db - SQLite database with index schema
 * @param filePath - Relative path within the repo (e.g. "finance/ledger/je-001.qmd")
 * @param content - Raw QMD file content
 * @param domain - Optional domain override; auto-detected from filePath if omitted
 * @returns The qualified ID and number of refs extracted
 */
export function indexFile(
  db: Database.Database,
  filePath: string,
  content: string,
  domain?: string
): IndexFileResult {
  const stmts = getStatements(db);
  const { frontmatter, body } = parseQmd<EntityFrontmatter>(content);

  const localId = frontmatter.id ?? filePath;
  const entityType = frontmatter.type ?? "unknown";
  const entityDomain = domain ?? detectDomain(filePath);
  const title = frontmatter.title ?? null;
  const status = frontmatter.status ?? null;
  const createdAt = frontmatter.created_at ?? null;
  const updatedAt = frontmatter.updated_at ?? null;
  const bodyForSearchIndex = buildBodyForSearchIndex(frontmatter, body);

  // Detect entity slug from file path (e.g. "entities/sub-co/finance/..." -> "sub-co")
  const entitySlug = detectEntitySlug(filePath);
  // Namespace the qualified_id with entity slug to prevent collisions
  const qualifiedId = entitySlug !== "root" ? `${entitySlug}:${localId}` : localId;

  // Wrap in transaction for atomicity
  const doIndex = db.transaction(() => {
    // 1. Delete old FTS entry (no-op if entity is new)
    stmts.deleteFtsByQid.run(qualifiedId);

    // 2. Upsert entity
    stmts.upsertEntity.run({
      qualified_id: qualifiedId,
      type: entityType,
      domain: entityDomain,
      file_path: filePath,
      frontmatter: JSON.stringify(frontmatter),
      title,
      status,
      created_at: createdAt,
      updated_at: updatedAt,
      entity_slug: entitySlug,
      local_id: localId,
    });

    // 3. Insert new FTS entry only for search-facing artifacts.
    if (isSearchIndexableQmdPath(filePath)) {
      stmts.insertFts.run({
        qualified_id: qualifiedId,
        title: title ?? "",
        body: bodyForSearchIndex,
        domain: entityDomain,
        type: entityType,
      });
    }

    // 4. Delete old refs, insert new ones
    stmts.deleteRefsBySource.run(qualifiedId);

    const refs = extractRefs(frontmatter as Record<string, unknown>, qualifiedId);
    for (const ref of refs) {
      stmts.insertRef.run({
        source_id: qualifiedId,
        target_id: ref.targetId,
        ref_type: ref.refType,
      });
    }

    return { qualifiedId, refsCount: refs.length };
  });

  return doIndex();
}

// ---------------------------------------------------------------------------
// removeFile
// ---------------------------------------------------------------------------

/**
 * Remove a file's entity from the index (entities + refs + FTS).
 */
export function removeFile(db: Database.Database, filePath: string): void {
  const stmts = getStatements(db);

  const doRemove = db.transaction(() => {
    const entity = stmts.getEntityByPath.get(filePath) as
      | { qualified_id: string }
      | undefined;

    if (!entity) return;

    // Delete FTS
    stmts.deleteFtsByQid.run(entity.qualified_id);

    // Delete refs (both as source)
    stmts.deleteRefsBySource.run(entity.qualified_id);

    // Delete entity
    stmts.deleteEntityByPath.run(filePath);
  });

  doRemove();
}

// ---------------------------------------------------------------------------
// indexCommit
// ---------------------------------------------------------------------------

/**
 * Incrementally index only files changed in a specific commit.
 *
 * Uses git diff to determine added/modified/deleted files, then:
 * - For added/modified .qmd files: reads content and calls indexFile
 * - For deleted .qmd files: removes from index
 * - Updates the last-indexed-commit tracker
 *
 * @param db - SQLite database with index schema
 * @param repo - Repository handle
 * @param commitSha - The commit to index
 */
export async function indexCommit(
  db: Database.Database,
  repo: RepoHandle,
  commitSha: string
): Promise<{ indexed: number; removed: number }> {
  const stmts = getStatements(db);
  const git = simpleGit(repo.path);

  // Get the previously indexed commit
  const lastCommit = (stmts.getMeta.get("last_commit") as { value: string } | undefined)?.value;

  let indexed = 0;
  let removed = 0;

  if (lastCommit) {
    // Incremental: diff between last indexed commit and target commit
    const diffSummary = await git.diffSummary([lastCommit, commitSha]);

    for (const file of diffSummary.files) {
      const filePath = file.file;

      // Only process .qmd files
      if (!isEntityIndexableQmdPath(filePath)) {
        removeFile(db, filePath);
        continue;
      }

      // Try to read the file to determine if it exists (handles deletes/renames)
      const content = await readFile(repo, filePath);

      if (content === null) {
        removeFile(db, filePath);
        removed++;
      } else {
        indexFile(db, filePath, content);
        indexed++;
      }
    }
  } else {
    // First time: use `git diff-tree` to list all files in the commit
    // Use --diff-filter to get the status of each file
    const result = await git.raw([
      "diff-tree", "--no-commit-id", "-r", "--name-only", commitSha,
    ]);

    const files = result.trim().split("\n").filter(Boolean);

    for (const filePath of files) {
      if (!isEntityIndexableQmdPath(filePath)) continue;

      const content = await readFile(repo, filePath);
      if (content !== null) {
        indexFile(db, filePath, content);
        indexed++;
      }
    }
  }

  // Update last-indexed-commit
  stmts.upsertMeta.run("last_commit", commitSha);

  return { indexed, removed };
}

// ---------------------------------------------------------------------------
// rebuildIndex
// ---------------------------------------------------------------------------

/**
 * Full re-index: clears all tables and re-indexes every .qmd file in the repo.
 *
 * @param db - SQLite database with index schema
 * @param repo - Repository handle
 * @returns Number of files indexed
 */
export async function rebuildIndex(
  db: Database.Database,
  repo: RepoHandle
): Promise<number> {
  const stmts = getStatements(db);

  // 1. Clear all tables
  db.exec(`DELETE FROM refs`);
  db.exec(`DELETE FROM entities_fts`);
  db.exec(`DELETE FROM entities`);

  // 2. List all .qmd files
  const files = await listFiles(repo, "**/*.qmd");

  // 3. Index each file (skip .schema)
  let count = 0;
  const batchInsert = db.transaction((filesToIndex: Array<{ path: string; content: string }>) => {
    for (const { path, content } of filesToIndex) {
      indexFile(db, path, content);
      count++;
    }
  });

  // Read all files first, then batch-insert in a transaction
  const filesToIndex: Array<{ path: string; content: string }> = [];
  for (const filePath of files) {
    if (!isEntityIndexableQmdPath(filePath)) continue;

    const content = await readFile(repo, filePath);
    if (content !== null) {
      filesToIndex.push({ path: filePath, content });
    }
  }

  batchInsert(filesToIndex);

  // 4. Set last-indexed-commit to current HEAD
  const headSha = await getCommitSha(repo);
  stmts.upsertMeta.run("last_commit", headSha);

  return count;
}
