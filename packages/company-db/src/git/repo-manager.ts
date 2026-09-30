import simpleGit from "simple-git";
import { mkdir, readFile as fsReadFile, writeFile, access, rm } from "fs/promises";
import { join, resolve } from "path";
import { glob } from "tinyglobby";
import type {
  RepoHandle,
  FileChange,
  FileDeletion,
  AuthorInfo,
  CommitResult,
} from "./types.js";
import { writeQmd } from "../qmd/writer.js";
import { installHooks } from "./hooks/install.js";
import type { SchemaPack, TenantKind } from "../schema/types.js";

export interface InitTenantRepoOptions {
  tenantKind?: TenantKind;
  schemaPack?: SchemaPack;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function initTenantRepo(
  basePath: string,
  slug: string,
  options: InitTenantRepoOptions = {},
): Promise<RepoHandle> {
  const tenantKind = options.tenantKind ?? "company";
  const schemaPack = options.schemaPack ?? tenantKind;
  const repoPath = join(basePath, slug);
  await mkdir(repoPath, { recursive: true });

  // If the repo has already been scaffolded, skip initialization.
  // Re-running git init is safe (it's a no-op on existing repos),
  // but overwriting .schema files destroys customized access controls
  // and resets ID sequences.
  const versionFile = join(repoPath, ".schema", "version.qmd");
  if (await fileExists(versionFile)) {
    await installHooks(repoPath);
    return { path: repoPath, slug };
  }

  const git = simpleGit(repoPath);
  await git.init();
  await git.addConfig("user.name", "company-db");
  await git.addConfig("user.email", "company-db@local");

  // Create .gitignore for runtime files (index, queue, audit)
  await writeFile(join(repoPath, ".gitignore"), ".company-db/\n.queue/\n");

  // Create .schema directory with version.qmd
  const schemaDir = join(repoPath, ".schema");
  await mkdir(schemaDir, { recursive: true });

  const versionContent = writeQmd(
    {
      schema_version: "0.0.1",
      tenant_kind: tenantKind,
      schema_pack: schemaPack,
      created_at: new Date().toISOString(),
    },
    tenantKind === "person" ? "Personal database schema." : "Company database schema."
  );
  await writeFile(join(schemaDir, "version.qmd"), versionContent);

  // Create id-registry.qmd
  const registryContent = writeQmd(
    { sequences: {} },
    "ID sequence registry. Managed by write queue."
  );
  await writeFile(join(schemaDir, "id-registry.qmd"), registryContent);

  // Create access-controls.qmd
  const accessControlsContent = writeQmd(
    { rules: [], agents: {} },
    "Access control rules. Managed by admin."
  );
  await writeFile(join(schemaDir, "access-controls.qmd"), accessControlsContent);

  await git.add(".");
  await git.commit("init: scaffold company repository");
  await installHooks(repoPath);

  return { path: repoPath, slug };
}

export async function initCompanyRepo(
  basePath: string,
  slug: string
): Promise<RepoHandle> {
  return initTenantRepo(basePath, slug, {
    tenantKind: "company",
    schemaPack: "company",
  });
}

/**
 * Assert that a resolved file path stays within the repository root.
 * Prevents path traversal attacks (e.g. "../../etc/passwd").
 */
function assertWithinRepo(repoPath: string, filePath: string): string {
  const root = resolve(repoPath);
  const full = resolve(repoPath, filePath);
  if (!full.startsWith(root + "/") && full !== root) {
    throw new Error(`Path traversal denied: ${filePath}`);
  }
  return full;
}

export async function readFile(
  repo: RepoHandle,
  filePath: string
): Promise<string | null> {
  try {
    const fullPath = assertWithinRepo(repo.path, filePath);
    return await fsReadFile(fullPath, "utf-8");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Path traversal")) {
      throw err;
    }
    return null;
  }
}

export async function listFiles(
  repo: RepoHandle,
  pattern: string
): Promise<string[]> {
  const files = await glob([pattern], {
    cwd: repo.path,
    dot: true,
    ignore: [".git/**"],
  });
  return files.sort();
}

export async function getCommitSha(repo: RepoHandle): Promise<string> {
  const git = simpleGit(repo.path);
  const log = await git.log({ maxCount: 1 });
  return log.latest?.hash ?? "";
}

// ── Commit Log ────────────────────────────────────────────────────────────

export interface CommitLogEntry {
  sha: string;       // 7-char abbreviated SHA
  message: string;   // full commit message
  author: string;    // author name
  date: string;      // ISO 8601 date string
  filesChanged: number;
}

export interface CommitLog {
  data: CommitLogEntry[];
  count: number;     // total commits in repo (for pagination)
}

/**
 * Paginated commit log with file-change counts per commit.
 * Returns most-recent-first ordering.
 */
export async function getCommitLog(
  repo: RepoHandle,
  limit = 20,
  offset = 0,
): Promise<CommitLog> {
  const git = simpleGit(repo.path);

  // Total commit count (for pagination)
  const countRaw = await git.raw(["rev-list", "--count", "HEAD"]);
  const count = parseInt(countRaw.trim(), 10) || 0;

  // Paginated log with --stat so we get diff.changed per entry
  const log = await git.log({
    maxCount: limit,
    "--skip": offset,
    "--stat": "4096",
  } as Record<string, string | number>);

  const data: CommitLogEntry[] = log.all.map((entry) => ({
    sha: entry.hash.slice(0, 7),
    message: entry.message,
    author: entry.author_name,
    date: entry.date,
    filesChanged: entry.diff?.changed ?? 0,
  }));

  return { data, count };
}

// ── Stats ─────────────────────────────────────────────────────────────────

export interface HeatmapEntry {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface LastCommitInfo {
  sha: string;
  message: string;
  date: string;
}

export interface RepoStats {
  totalCommits: number;
  heatmap: HeatmapEntry[];
  lastCommit: LastCommitInfo | null;
}

/**
 * Gather repository-level statistics:
 * - totalCommits: total number of commits via `git rev-list --count HEAD`
 * - heatmap: commit count per day for the last 52 weeks
 * - lastCommit: SHA, message, and date of the most recent commit
 */
export async function getRepoStats(repo: RepoHandle): Promise<RepoStats> {
  const git = simpleGit(repo.path);

  // Total commit count
  const countRaw = await git.raw(["rev-list", "--count", "HEAD"]);
  const totalCommits = parseInt(countRaw.trim(), 10) || 0;

  // Last commit info
  const log = await git.log({ maxCount: 1 });
  const lastCommit: LastCommitInfo | null = log.latest
    ? {
        sha: log.latest.hash.slice(0, 7),
        message: log.latest.message,
        date: log.latest.date,
      }
    : null;

  // Heatmap: commit dates for the last 52 weeks
  const since = new Date();
  since.setDate(since.getDate() - 52 * 7);
  const sinceStr = since.toISOString().split("T")[0];

  const datesRaw = await git.raw([
    "log",
    "--format=%aI",
    `--since=${sinceStr}`,
  ]);

  const dayCounts = new Map<string, number>();
  for (const line of datesRaw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Extract YYYY-MM-DD from ISO date
    const day = trimmed.slice(0, 10);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  const heatmap: HeatmapEntry[] = Array.from(dayCounts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { totalCommits, heatmap, lastCommit };
}

/**
 * Write files to disk, stage, and commit them in one atomic operation.
 *
 * Commit message format (convention, not enforced here):
 *   {domain}: {action} {entity-type} {id}
 *   e.g. "finance: create journal_entry je-00042"
 */
export async function commitFiles(
  repo: RepoHandle,
  files: FileChange[],
  message: string,
  author: AuthorInfo
): Promise<CommitResult> {
  // Write each file to disk, creating parent directories as needed
  for (const file of files) {
    const fullPath = assertWithinRepo(repo.path, file.path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, file.content);
  }

  const git = simpleGit(repo.path);

  // Stage all changed files
  await git.add(files.map((f) => f.path));

  // Commit with author info
  await git.commit(message, undefined, {
    "--author": `${author.name} <${author.email}>`,
  });

  // Read back the commit SHA
  const log = await git.log({ maxCount: 1 });
  const sha = log.latest?.hash ?? "";

  return {
    sha,
    message,
    filesChanged: files.length,
  };
}

export async function deleteFiles(
  repo: RepoHandle,
  files: FileDeletion[],
  message: string,
  author: AuthorInfo,
): Promise<CommitResult> {
  const existingPaths: string[] = [];

  for (const file of files) {
    const fullPath = assertWithinRepo(repo.path, file.path);
    if (!(await fileExists(fullPath))) continue;
    await rm(fullPath, { force: true });
    existingPaths.push(file.path);
  }

  if (existingPaths.length === 0) {
    const sha = await getCommitSha(repo);
    return {
      sha,
      message,
      filesChanged: 0,
    };
  }

  const git = simpleGit(repo.path);
  await git.add(existingPaths);
  await git.commit(message, undefined, {
    "--author": `${author.name} <${author.email}>`,
  });

  const log = await git.log({ maxCount: 1 });
  const sha = log.latest?.hash ?? "";

  return {
    sha,
    message,
    filesChanged: existingPaths.length,
  };
}
