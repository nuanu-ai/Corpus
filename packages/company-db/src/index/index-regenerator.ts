import type Database from "better-sqlite3";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

import type { RepoHandle } from "../git/types.js";
import { DOMAINS } from "../schema/domains.js";
import { writeQmd } from "../qmd/writer.js";
import type { WriteQueue } from "../queue/write-queue.js";
import type { WriteIntent, WriteResult } from "../queue/types.js";
import type { FileChange } from "../git/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TypeCount {
  type: string;
  count: number;
}

interface DomainSummary {
  domain: string;
  domainName: string;
  entityCount: number;
  typeCounts: TypeCount[];
  lastUpdated: string;
}

export interface RegenerateResult {
  domains: string[];
  filesWritten: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVICE_AGENT_ID = "svc-index-regen";
const SERVICE_AGENT_TOKEN = "service";
const DIRTY_DOMAINS_PATH = ".queue/dirty-domains.txt";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read and deduplicate dirty domain names from the queue file.
 * Returns an empty array if the file does not exist.
 */
async function readDirtyDomains(repo: RepoHandle): Promise<string[]> {
  const filePath = join(repo.path, DIRTY_DOMAINS_PATH);
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist — nothing to regenerate
    return [];
  }

  const domains = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Deduplicate while preserving order
  return [...new Set(domains)];
}

/**
 * Clear the dirty domains file after successful regeneration.
 */
async function clearDirtyDomains(repo: RepoHandle): Promise<void> {
  const filePath = join(repo.path, DIRTY_DOMAINS_PATH);
  try {
    await writeFile(filePath, "", "utf-8");
  } catch {
    // If we can't clear, the next run will just re-process — acceptable
  }
}

/**
 * Query the entity count and type breakdown for a given domain.
 * Uses direct SQL for efficiency (no pagination issues).
 */
function queryDomainSummary(
  db: Database.Database,
  domain: string
): DomainSummary {
  const domainConfig = DOMAINS[domain];
  const domainName = domainConfig?.name ?? domain;

  // Total entity count
  const countRow = db
    .prepare("SELECT COUNT(*) as cnt FROM entities WHERE domain = ?")
    .get(domain) as { cnt: number };

  // Type breakdown
  const typeRows = db
    .prepare(
      "SELECT type, COUNT(*) as cnt FROM entities WHERE domain = ? GROUP BY type ORDER BY cnt DESC"
    )
    .all(domain) as Array<{ type: string; cnt: number }>;

  // Most recent updated_at
  const lastRow = db
    .prepare(
      "SELECT MAX(updated_at) as last_updated FROM entities WHERE domain = ?"
    )
    .get(domain) as { last_updated: string | null };

  return {
    domain,
    domainName,
    entityCount: countRow.cnt,
    typeCounts: typeRows.map((r) => ({ type: r.type, count: r.cnt })),
    lastUpdated: lastRow.last_updated ?? new Date().toISOString(),
  };
}

/**
 * Build the _index.qmd content for a domain summary.
 */
function buildIndexQmd(summary: DomainSummary): string {
  const types: Record<string, number> = {};
  for (const tc of summary.typeCounts) {
    types[tc.type] = tc.count;
  }

  const frontmatter: Record<string, unknown> = {
    title: `${summary.domainName} Index`,
    domain: summary.domain,
    entity_count: summary.entityCount,
    types,
    last_updated: summary.lastUpdated,
  };

  const body = `Summary of ${summary.domain} domain with ${summary.entityCount} entities.\n`;
  return writeQmd(frontmatter, body);
}

// ---------------------------------------------------------------------------
// Main: regenerateIndexes
// ---------------------------------------------------------------------------

/**
 * Batched regeneration of `_index.qmd` files for dirty domains.
 *
 * 1. Reads `.queue/dirty-domains.txt` for domains that need regeneration
 * 2. Queries SQLite for each domain's entities and builds `_index.qmd`
 * 3. Submits a single commit to the write queue with ALL regenerated files
 * 4. Clears the dirty-domains file on success
 *
 * The commit message is prefixed with `housekeeping:` to prevent the
 * post-commit hook from re-triggering regeneration (cycle prevention).
 */
export async function regenerateIndexes(
  repo: RepoHandle,
  db: Database.Database,
  writeQueue: WriteQueue
): Promise<RegenerateResult> {
  // Step 1: Read and deduplicate dirty domains
  const dirtyDomains = await readDirtyDomains(repo);

  if (dirtyDomains.length === 0) {
    return { domains: [], filesWritten: 0 };
  }

  // Filter to only known domains
  const validDomains = dirtyDomains.filter((d) => d in DOMAINS);

  if (validDomains.length === 0) {
    await clearDirtyDomains(repo);
    return { domains: [], filesWritten: 0 };
  }

  // Step 2: Build _index.qmd for each domain
  const files: FileChange[] = [];

  for (const domain of validDomains) {
    const summary = queryDomainSummary(db, domain);
    const content = buildIndexQmd(summary);
    const domainConfig = DOMAINS[domain];
    const basePath = domainConfig?.basePath ?? domain;

    files.push({
      path: `${basePath}/_index.qmd`,
      content,
    });
  }

  // Step 3: Submit a single commit with all regenerated _index.qmd files
  const commitMessage = `housekeeping: regenerate _index.qmd for ${validDomains.join(", ")}`;

  const intent: WriteIntent = {
    agentId: SERVICE_AGENT_ID,
    agentToken: SERVICE_AGENT_TOKEN,
    domain: "system",
    operation: {
      type: "commit",
      files,
      commitMessage,
    },
  };

  const result: WriteResult = await writeQueue.submit(intent);

  if (!result.success) {
    // Don't clear dirty domains on failure — retry next run
    throw new Error(
      `Failed to commit regenerated indexes: ${result.error?.message ?? "unknown error"}`
    );
  }

  // Step 4: Clear the dirty domains file after successful commit
  await clearDirtyDomains(repo);

  return {
    domains: validDomains,
    filesWritten: files.length,
  };
}
