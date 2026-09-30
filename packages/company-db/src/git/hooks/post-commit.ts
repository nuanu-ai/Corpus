import simpleGit from "simple-git";
import { mkdir, appendFile } from "fs/promises";
import { basename, join, dirname } from "path";
import { createIndexDb, closeIndexDb } from "../../index/schema.js";
import { indexCommit } from "../../index/indexer.js";
import type { RepoHandle } from "../types.js";
import { createSemanticIndexRuntimeFromEnv } from "../../semantic/runtime.js";
import { indexSemanticFile } from "../../semantic/indexer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect domain from a file path.
 * Domain is the first directory component (e.g. "finance/ledger/je-001.qmd" -> "finance").
 */
function detectDomain(filePath: string): string | null {
  const firstSlash = filePath.indexOf("/");
  if (firstSlash === -1) return null;
  const domain = filePath.substring(0, firstSlash);
  // Skip hidden directories like .schema, .queue, .git
  if (domain.startsWith(".")) return null;
  return domain;
}

/**
 * Check if a commit message indicates a housekeeping commit.
 * Housekeeping commits (e.g. _index.qmd regeneration) should still be indexed
 * but must NOT mark domains as dirty to prevent infinite loops.
 */
function isHousekeepingCommit(message: string): boolean {
  return message.startsWith("housekeeping:");
}

interface ChangedFile {
  status: string;
  path: string;
  previousPath?: string;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function parseChangedFiles(diffOutput: string): ChangedFile[] {
  return diffOutput
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [statusPart, ...paths] = line.split("\t");
      const status = statusPart.trim();
      if (status.startsWith("R") || status.startsWith("C")) {
        return {
          status,
          previousPath: paths[0],
          path: paths[1],
        };
      }

      return {
        status,
        path: paths[0],
      };
    })
    .filter((entry) => entry.path);
}

function parseAllowedDomains(value: string | undefined): string[] | undefined {
  const domains = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return domains.length > 0 ? domains : undefined;
}

async function syncSemanticIndex(
  repo: RepoHandle,
  commitSha: string,
  changedFiles: ChangedFile[],
): Promise<void> {
  const companySlug = process.env.COMPANY_DB_TENANT_SLUG?.trim() || basename(repo.path);
  const runtime = createSemanticIndexRuntimeFromEnv(companySlug);
  if (!runtime) {
    return;
  }

  const allowedDomains = parseAllowedDomains(process.env.COMPANY_DB_SEMANTIC_ALLOWED_DOMAINS);
  const pendingDeletes = new Set<string>();
  const pendingIndexes = new Set<string>();

  for (const changedFile of changedFiles) {
    const currentPath = normalizePath(changedFile.path);
    const previousPath = changedFile.previousPath ? normalizePath(changedFile.previousPath) : null;

    if (previousPath && previousPath !== currentPath && previousPath.endsWith(".qmd")) {
      pendingDeletes.add(previousPath);
    }

    if (!currentPath.endsWith(".qmd")) {
      continue;
    }

    if (changedFile.status.startsWith("D")) {
      pendingDeletes.add(currentPath);
      continue;
    }

    pendingIndexes.add(currentPath);
  }

  for (const filePath of pendingDeletes) {
    await runtime.vectorStore.deletePointsByFilePath(companySlug, filePath);
  }

  for (const filePath of pendingIndexes) {
    await indexSemanticFile(
      repo,
      filePath,
      {
        companySlug,
        commitSha,
        allowedDomains,
      },
      {
        embedder: runtime.embedder,
        vectorStore: runtime.vectorStore,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Post-commit hook
// ---------------------------------------------------------------------------

/**
 * Run the post-commit hook logic:
 * 1. Read changed files from the latest commit
 * 2. Trigger SQLite index upsert via indexCommit
 * 3. Mark domains dirty for _index.qmd regeneration (unless housekeeping commit)
 *
 * @param repoPath - Absolute path to the git repository
 * @param dbPath - Absolute path to the SQLite index database
 * @returns Number of files indexed and list of dirty domains
 */
export async function runPostCommitHook(
  repoPath: string,
  dbPath: string
): Promise<{ indexed: number; dirtyDomains: string[] }> {
  const git = simpleGit(repoPath);
  const repo: RepoHandle = { path: repoPath, slug: "" };

  // 1. Get the latest commit SHA and message
  const log = await git.log({ maxCount: 1 });
  if (!log.latest) {
    return { indexed: 0, dirtyDomains: [] };
  }

  const commitSha = log.latest.hash;
  const commitMessage = log.latest.message;
  const changedFiles = parseChangedFiles(await git.raw([
    "diff-tree",
    "--no-commit-id",
    "-r",
    "--name-status",
    "--find-renames",
    "HEAD",
  ]));

  // 2. Run SQLite indexer (always, including housekeeping)
  // Ensure the directory exists (hook may run before daemon creates it)
  await mkdir(dirname(dbPath), { recursive: true });
  const db = createIndexDb(dbPath);
  let indexed: number;
  try {
    const result = await indexCommit(db, repo, commitSha);
    indexed = result.indexed + result.removed;
  } finally {
    closeIndexDb(db);
  }

  // 3. Determine dirty domains (skip for housekeeping commits to break the cycle)
  const dirtyDomains: string[] = [];

  if (!isHousekeepingCommit(commitMessage)) {
    // Read changed files from the commit
    const domainSet = new Set<string>();

    for (const filePath of changedFiles) {
      // Only track .qmd files for domain dirtying
      if (!filePath.path.endsWith(".qmd")) continue;
      const domain = detectDomain(filePath.path);
      if (domain) {
        domainSet.add(domain);
      }
    }

    dirtyDomains.push(...[...domainSet].sort());

    // Write dirty domains to .queue/dirty-domains.txt (append)
    if (dirtyDomains.length > 0) {
      const queueDir = join(repoPath, ".queue");
      await mkdir(queueDir, { recursive: true });

      const dirtyFile = join(queueDir, "dirty-domains.txt");
      const content = dirtyDomains.join("\n") + "\n";
      await appendFile(dirtyFile, content);
    }
  }

  await syncSemanticIndex(repo, commitSha, changedFiles);

  return { indexed, dirtyDomains };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  const repoPath = process.cwd();
  // Must match the path used by the CLI daemon (cli.ts): .company-db/index.sqlite
  const dbPath = join(repoPath, ".company-db", "index.sqlite");

  const result = await runPostCommitHook(repoPath, dbPath);

  if (result.indexed > 0) {
    console.log(`post-commit: indexed ${result.indexed} file(s)`);
  }
  if (result.dirtyDomains.length > 0) {
    console.log(
      `post-commit: marked dirty domains: ${result.dirtyDomains.join(", ")}`
    );
  }
}

// Run when executed directly
const isDirectExecution =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("post-commit");

if (isDirectExecution) {
  main().catch((err) => {
    console.error("post-commit hook failed:", err);
    // Post-commit hooks should not block; exit 0 even on error
    process.exit(0);
  });
}
