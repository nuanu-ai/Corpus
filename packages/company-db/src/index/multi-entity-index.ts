import type Database from "better-sqlite3";

import type { RepoHandle, FileChange } from "../git/types.js";
import { readFile } from "../git/repo-manager.js";
import { parseQmd } from "../qmd/parser.js";
import { writeQmd } from "../qmd/writer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EntityEntry {
  slug: string;
  legal_name?: string;
  relationship?: string;
  parent_entity?: string;
}

interface SubsidiarySummary {
  slug: string;
  legal_name: string;
  relationship: string;
  domain_count: number;
  entity_count: number;
  finance_summary: FinanceSummary | null;
}

interface FinanceSummary {
  revenue: number;
  expenses: number;
  net_income: number;
  currency: string;
}

function resolveSummaryCurrency(fm: Record<string, unknown>): string {
  const candidates = [fm.reporting_currency, fm.company_currency, fm.currency];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim().toUpperCase();
    if (!normalized) continue;
    return normalized;
  }
  return "USD";
}

// ---------------------------------------------------------------------------
// buildMultiEntityIndex
// ---------------------------------------------------------------------------

/**
 * Build a consolidated `entities/_index.qmd` that includes subsidiary
 * summaries derived from each entity's `finance/_index.qmd`.
 *
 * 1. Read the current `entities/_index.qmd` to find all registered entities
 * 2. For each entity, read its `finance/_index.qmd` (if it exists)
 * 3. Query SQLite for per-entity domain/entity counts
 * 4. Build a consolidated index with subsidiary summaries
 * 5. Return FileChange[] for the caller to commit
 */
export function buildMultiEntityIndex(
  repo: RepoHandle,
  db: Database.Database,
): FileChange[] {
  // This is async internally but we need to return sync — wrap in a sync
  // facade that the caller awaits. Actually, since readFile is async, we
  // need to make this async too.
  // Re-export as async (the task spec signature returns FileChange[] but
  // the implementation must be async because it reads files from disk).
  throw new Error(
    "Use buildMultiEntityIndexAsync instead — file I/O requires async",
  );
}

/**
 * Async implementation of the multi-entity index builder.
 */
export async function buildMultiEntityIndexAsync(
  repo: RepoHandle,
  db: Database.Database,
): Promise<FileChange[]> {
  // 1. Read the current entities/_index.qmd
  const indexContent = await readFile(repo, "entities/_index.qmd");
  if (!indexContent) {
    // No entities index — nothing to consolidate
    return [];
  }

  const parsed = parseQmd(indexContent);
  const fm = parsed.frontmatter as Record<string, unknown>;
  const entities = (fm.entities ?? []) as EntityEntry[];

  if (entities.length === 0) {
    return [];
  }

  // 2. For each entity, gather summary data
  const summaries: SubsidiarySummary[] = [];

  for (const entity of entities) {
    const slug = entity.slug;
    if (!slug) continue;

    // Read finance/_index.qmd for this entity
    const financeSummary = await readFinanceSummary(repo, slug);

    // Query SQLite for entity counts scoped to this subsidiary
    const { domainCount, entityCount } = queryEntityCounts(db, slug);

    summaries.push({
      slug,
      legal_name: entity.legal_name ?? slug,
      relationship: entity.relationship ?? "unknown",
      domain_count: domainCount,
      entity_count: entityCount,
      finance_summary: financeSummary,
    });
  }

  // 3. Build consolidated frontmatter
  const now = new Date().toISOString();

  const consolidatedEntities = summaries.map((s) => ({
    slug: s.slug,
    legal_name: s.legal_name,
    relationship: s.relationship,
    domain_count: s.domain_count,
    entity_count: s.entity_count,
    ...(s.finance_summary
      ? {
          revenue: s.finance_summary.revenue,
          expenses: s.finance_summary.expenses,
          net_income: s.finance_summary.net_income,
          currency: s.finance_summary.currency,
        }
      : {}),
  }));

  // Aggregate totals across all entities
  const totalRevenue = summaries.reduce(
    (sum, s) => sum + (s.finance_summary?.revenue ?? 0),
    0,
  );
  const totalExpenses = summaries.reduce(
    (sum, s) => sum + (s.finance_summary?.expenses ?? 0),
    0,
  );
  const totalNetIncome = summaries.reduce(
    (sum, s) => sum + (s.finance_summary?.net_income ?? 0),
    0,
  );

  const frontmatter: Record<string, unknown> = {
    title: "Entity Registry",
    entity_count: entities.length,
    entities: consolidatedEntities,
    consolidated_totals: {
      revenue: totalRevenue,
      expenses: totalExpenses,
      net_income: totalNetIncome,
    },
    updated_at: now,
  };

  const body =
    "Registry of all entities in this company database.\n";

  const content = writeQmd(frontmatter, body);

  return [
    {
      path: "entities/_index.qmd",
      content,
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the finance summary for a given entity.
 * Only reads the entity-scoped finance summary.
 * Falling back to top-level `finance/_index.qmd` would double-count parent
 * totals across every subsidiary, so the index builder treats parent finance
 * as a separate source of truth.
 */
async function readFinanceSummary(
  repo: RepoHandle,
  slug: string,
): Promise<FinanceSummary | null> {
  const content = await readFile(repo, `entities/${slug}/finance/_index.qmd`);
  if (!content) return null;

  const parsed = parseQmd(content);
  const fm = parsed.frontmatter as Record<string, unknown>;

  return {
    revenue: numericField(fm, "revenue"),
    expenses: numericField(fm, "expenses"),
    net_income: numericField(fm, "net_income"),
    currency: resolveSummaryCurrency(fm),
  };
}

/**
 * Query SQLite for approximate domain count and entity count for a slug.
 *
 * Entity-scoped files live under `entities/{slug}/...` in file_path.
 * We count distinct domains and total rows matching that prefix.
 */
function queryEntityCounts(
  db: Database.Database,
  slug: string,
): { domainCount: number; entityCount: number } {
  const prefix = `entities/${slug}/`;

  try {
    const countRow = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM entities WHERE file_path LIKE ?",
      )
      .get(`${prefix}%`) as { cnt: number } | undefined;

    const domainRow = db
      .prepare(
        "SELECT COUNT(DISTINCT domain) as cnt FROM entities WHERE file_path LIKE ?",
      )
      .get(`${prefix}%`) as { cnt: number } | undefined;

    return {
      entityCount: countRow?.cnt ?? 0,
      domainCount: domainRow?.cnt ?? 0,
    };
  } catch {
    // Table might not exist or be empty
    return { domainCount: 0, entityCount: 0 };
  }
}

/**
 * Safely extract a numeric field from frontmatter.
 */
function numericField(fm: Record<string, unknown>, key: string): number {
  const val = fm[key];
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}
