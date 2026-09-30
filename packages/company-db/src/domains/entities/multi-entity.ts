import type { FileChange, RepoHandle } from "../../git/types.js";
import type {
  EntityRecord,
  IntercompanyTransaction,
} from "../../schema/domain-types/other.js";
import type { MoneyAmount } from "../../schema/domain-types/common.js";
import { DOMAINS } from "../../schema/domains.js";
import { writeQmd } from "../../qmd/writer.js";
import { parseQmd } from "../../qmd/parser.js";
import { readFile } from "../../git/repo-manager.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinel slug identifying the parent entity in boundary checks. */
export const PARENT_ENTITY_SLUG = "__parent__";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubsidiaryConfig {
  legal_name: string;
  jurisdiction: string;
  relationship?: EntityRecord["relationship"];
  active_domains?: string[];
}

export interface IntercompanyTxnInput {
  source_entity: string;
  target_entity: string;
  amount: MoneyAmount;
  description: string;
  journal_entry_ref?: string;
}

export interface ConsolidatedView {
  parent: string;
  period: string;
  subsidiaries: string[];
  summaries: EntityFinancialSummary[];
  totals: {
    revenue: number;
    expenses: number;
    net_income: number;
    currency: string;
  };
  warnings: string[];
}

export interface EntityFinancialSummary {
  entity: string;
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
// 1. Subsidiary scaffolding
// ---------------------------------------------------------------------------

/**
 * Create a subsidiary entity under a parent.
 *
 * Returns FileChange[] that the caller should commit. Does NOT write to disk.
 * - Creates `entities/{child-slug}/` directory structure
 * - Mirrors the parent's active domain subdirectories
 * - Creates an identity profile QMD for the subsidiary
 * - Creates/updates `entities/_index.qmd` registration
 */
export async function createSubsidiary(
  repo: RepoHandle,
  parentSlug: string,
  childSlug: string,
  config: SubsidiaryConfig,
): Promise<FileChange[]> {
  // Validate slugs
  if (!parentSlug || !childSlug) {
    throw new Error("Both parentSlug and childSlug are required");
  }

  if (parentSlug === childSlug) {
    throw new Error("Child slug cannot be the same as parent slug");
  }

  if (!/^[a-z0-9-]+$/.test(childSlug)) {
    throw new Error(
      `Invalid child slug "${childSlug}": must be lowercase alphanumeric with hyphens`,
    );
  }

  // Check that parent entity exists (look for entity registration)
  const parentEntityPath = `entities/${parentSlug}.qmd`;
  const parentContent = await readFile(repo, parentEntityPath);

  // Determine active domains for the subsidiary
  let activeDomains: string[];
  if (config.active_domains) {
    // Validate provided domains against known domains
    const unknownDomains = config.active_domains.filter((d) => !(d in DOMAINS));
    if (unknownDomains.length > 0) {
      throw new Error(`Unknown domains: ${unknownDomains.join(", ")}`);
    }
    activeDomains = config.active_domains;
  } else if (parentContent) {
    // Mirror parent's active domains
    const parsed = parseQmd<EntityRecord>(parentContent);
    activeDomains = parsed.frontmatter.active_domains ?? Object.keys(DOMAINS);
  } else {
    // Default core domains
    activeDomains = [
      "identity",
      "finance",
      "banking",
      "revenue",
      "expenses",
      "tax",
    ];
  }

  const files: FileChange[] = [];
  const now = new Date().toISOString();

  // 1. Create the entity registration record
  const entityRecord: Record<string, unknown> = {
    type: "entity",
    id: `entity-${childSlug}`,
    slug: childSlug,
    legal_name: config.legal_name,
    relationship: config.relationship ?? "subsidiary",
    parent_entity: parentSlug,
    jurisdiction: config.jurisdiction,
    active_domains: activeDomains,
    created_at: now,
    updated_at: now,
  };

  files.push({
    path: `entities/${childSlug}.qmd`,
    content: writeQmd(entityRecord, ""),
  });

  // 2. Create domain subdirectory placeholder files
  for (const domain of activeDomains) {
    const domainConfig = DOMAINS[domain];
    if (!domainConfig) continue;

    const domainIndexFrontmatter: Record<string, unknown> = {
      title: `${config.legal_name} - ${domainConfig.name}`,
      domain,
      entity: childSlug,
      entity_count: 0,
      created_at: now,
    };

    files.push({
      path: `entities/${childSlug}/${domainConfig.basePath}/_index.qmd`,
      content: writeQmd(
        domainIndexFrontmatter,
        `${domainConfig.name} domain for ${config.legal_name}.\n`,
      ),
    });
  }

  // 3. Create identity profile for the subsidiary
  const profileFrontmatter: Record<string, unknown> = {
    type: "company_profile",
    id: `company-${childSlug}`,
    legal_name: config.legal_name,
    entity_type: config.relationship ?? "subsidiary",
    jurisdiction: config.jurisdiction,
    stage: "active",
    industry: "",
    created_at: now,
    updated_at: now,
  };

  files.push({
    path: `entities/${childSlug}/identity/companies/company-${childSlug}.qmd`,
    content: writeQmd(profileFrontmatter, ""),
  });

  // 4. Update (or create) entities/_index.qmd
  const indexContent = await _buildEntitiesIndex(repo, childSlug, entityRecord);
  files.push({
    path: "entities/_index.qmd",
    content: indexContent,
  });

  return files;
}

// ---------------------------------------------------------------------------
// 2. Intercompany transaction saga
// ---------------------------------------------------------------------------

/**
 * Create an intercompany transaction between two entities.
 *
 * Returns FileChange[] for BOTH entities' records.
 * The source entity record starts with status: pending_counterparty.
 * The target entity gets a mirror record also pending_counterparty.
 */
export function createIntercompanyTransaction(
  txnId: string,
  input: IntercompanyTxnInput,
): FileChange[] {
  if (input.source_entity === input.target_entity) {
    throw new Error("Source and target entity cannot be the same");
  }

  if (!input.amount || input.amount.amount <= 0) {
    throw new Error("Transaction amount must be positive");
  }

  const now = new Date().toISOString();

  // Source entity record
  const sourceTxn: Record<string, unknown> = {
    type: "intercompany_transaction",
    id: txnId,
    source_entity: input.source_entity,
    target_entity: input.target_entity,
    amount: input.amount,
    description: input.description,
    status: "pending_counterparty",
    journal_entry_ref: input.journal_entry_ref ?? null,
    counterparty_journal_entry_ref: null,
    created_at: now,
    updated_at: now,
  };

  // Target entity mirror record
  const targetTxn: Record<string, unknown> = {
    ...sourceTxn,
    id: `${txnId}-mirror`,
    status: "pending_confirmation",
  };

  const files: FileChange[] = [
    {
      path: `entities/${input.source_entity}/intercompany/${txnId}.qmd`,
      content: writeQmd(sourceTxn, ""),
    },
    {
      path: `entities/${input.target_entity}/intercompany/${txnId}-mirror.qmd`,
      content: writeQmd(targetTxn, ""),
    },
  ];

  return files;
}

/**
 * Confirm an intercompany transaction.
 * Returns FileChange[] to update both source and target records to "confirmed".
 */
export async function confirmIntercompany(
  repo: RepoHandle,
  txnId: string,
  sourceEntity: string,
  targetEntity: string,
): Promise<FileChange[]> {
  const sourcePath = `entities/${sourceEntity}/intercompany/${txnId}.qmd`;
  const targetPath = `entities/${targetEntity}/intercompany/${txnId}-mirror.qmd`;

  const sourceContent = await readFile(repo, sourcePath);
  if (!sourceContent) {
    throw new Error(`Intercompany transaction not found: ${txnId}`);
  }

  const sourceParsed = parseQmd<IntercompanyTransaction>(sourceContent);
  if (sourceParsed.frontmatter.status !== "pending_counterparty") {
    throw new Error(
      `Transaction ${txnId} cannot be confirmed: current status is "${sourceParsed.frontmatter.status}"`,
    );
  }

  const now = new Date().toISOString();

  const updatedSource: Record<string, unknown> = {
    ...sourceParsed.frontmatter,
    status: "confirmed",
    updated_at: now,
  };

  const files: FileChange[] = [
    {
      path: sourcePath,
      content: writeQmd(updatedSource, ""),
    },
  ];

  // Update mirror if it exists
  const targetContent = await readFile(repo, targetPath);
  if (targetContent) {
    const targetParsed = parseQmd<IntercompanyTransaction>(targetContent);
    const updatedTarget: Record<string, unknown> = {
      ...targetParsed.frontmatter,
      status: "confirmed",
      updated_at: now,
    };
    files.push({
      path: targetPath,
      content: writeQmd(updatedTarget, ""),
    });
  }

  return files;
}

/**
 * Dispute an intercompany transaction.
 * Returns FileChange[] to update both records to "disputed" with a reason.
 */
export async function disputeIntercompany(
  repo: RepoHandle,
  txnId: string,
  sourceEntity: string,
  targetEntity: string,
  reason: string,
): Promise<FileChange[]> {
  if (!reason || reason.trim().length === 0) {
    throw new Error("Dispute reason is required");
  }

  const sourcePath = `entities/${sourceEntity}/intercompany/${txnId}.qmd`;
  const targetPath = `entities/${targetEntity}/intercompany/${txnId}-mirror.qmd`;

  const sourceContent = await readFile(repo, sourcePath);
  if (!sourceContent) {
    throw new Error(`Intercompany transaction not found: ${txnId}`);
  }

  const sourceParsed = parseQmd<IntercompanyTransaction>(sourceContent);
  if (sourceParsed.frontmatter.status !== "pending_counterparty") {
    throw new Error(
      `Transaction ${txnId} cannot be disputed: current status is "${sourceParsed.frontmatter.status}"`,
    );
  }

  const now = new Date().toISOString();

  const updatedSource: Record<string, unknown> = {
    ...sourceParsed.frontmatter,
    status: "disputed",
    dispute_reason: reason,
    updated_at: now,
  };

  const files: FileChange[] = [
    {
      path: sourcePath,
      content: writeQmd(updatedSource, ""),
    },
  ];

  // Update mirror if it exists
  const targetContent = await readFile(repo, targetPath);
  if (targetContent) {
    const targetParsed = parseQmd<IntercompanyTransaction>(targetContent);
    const updatedTarget: Record<string, unknown> = {
      ...targetParsed.frontmatter,
      status: "disputed",
      dispute_reason: reason,
      updated_at: now,
    };
    files.push({
      path: targetPath,
      content: writeQmd(updatedTarget, ""),
    });
  }

  return files;
}

// ---------------------------------------------------------------------------
// 3. Consolidation reader
// ---------------------------------------------------------------------------

/**
 * Build a consolidated financial view for a parent entity and all its subsidiaries.
 *
 * Reads financial summary data from each entity's finance domain _index.qmd
 * and aggregates totals. Detects circular references.
 */
export async function buildConsolidation(
  repo: RepoHandle,
  parentSlug: string,
  period: string,
): Promise<ConsolidatedView> {
  const warnings: string[] = [];

  // 1. Discover all subsidiary entities
  const subsidiaries = await _discoverSubsidiaries(repo, parentSlug);

  // 2. Detect circular references
  const circularWarnings = await _detectCircularRefs(repo, parentSlug);
  warnings.push(...circularWarnings);

  // 3. Read financial summaries for parent + all subsidiaries
  const allEntities = [parentSlug, ...subsidiaries];
  const summaries: EntityFinancialSummary[] = [];

  for (const entity of allEntities) {
    const summary = await _readEntityFinancialSummary(repo, entity);
    summaries.push(summary);
  }

  // 4. Aggregate totals
  const currency = summaries[0]?.currency ?? "USD";
  const totals = {
    revenue: summaries.reduce((sum, s) => sum + s.revenue, 0),
    expenses: summaries.reduce((sum, s) => sum + s.expenses, 0),
    net_income: summaries.reduce((sum, s) => sum + s.net_income, 0),
    currency,
  };

  return {
    parent: parentSlug,
    period,
    subsidiaries,
    summaries,
    totals,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 4. Domain boundary enforcement
// ---------------------------------------------------------------------------

/**
 * Validate that a file path belongs to the correct entity scope.
 * Subsidiaries must NOT write to the parent's domain directories.
 *
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export function validateEntityBoundary(
  filePath: string,
  entitySlug: string,
): { allowed: boolean; reason?: string } {
  // Files under entities/{slug}/ are scoped to that entity
  const entityPrefix = `entities/${entitySlug}/`;

  if (filePath.startsWith("entities/")) {
    // It's an entity-scoped path
    if (filePath.startsWith(entityPrefix)) {
      return { allowed: true };
    }

    // Check if it's the entity registration file itself
    if (filePath === `entities/${entitySlug}.qmd`) {
      return { allowed: true };
    }

    // Check if it's the entities _index.qmd (allowed for the system)
    if (filePath === "entities/_index.qmd") {
      return { allowed: true };
    }

    // Trying to write to another entity's scope
    return {
      allowed: false,
      reason: `Entity "${entitySlug}" cannot write to path "${filePath}" — outside its scope`,
    };
  }

  // Top-level domain paths belong to the parent entity only
  if (entitySlug !== PARENT_ENTITY_SLUG) {
    // A subsidiary trying to write to top-level domains
    const topLevelDomains = Object.values(DOMAINS).map(
      (d) => d.basePath + "/",
    );
    for (const domainPath of topLevelDomains) {
      if (filePath.startsWith(domainPath)) {
        return {
          allowed: false,
          reason: `Subsidiary "${entitySlug}" cannot write to parent domain path "${filePath}"`,
        };
      }
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the entities/_index.qmd content, reading existing entries and
 * adding/updating the new entity.
 */
async function _buildEntitiesIndex(
  repo: RepoHandle,
  newSlug: string,
  newEntity: Record<string, unknown>,
): Promise<string> {
  const indexPath = "entities/_index.qmd";
  const existing = await readFile(repo, indexPath);

  let entities: Record<string, unknown>[] = [];

  if (existing) {
    const parsed = parseQmd(existing);
    const fm = parsed.frontmatter as Record<string, unknown>;
    if (Array.isArray(fm.entities)) {
      entities = fm.entities as Record<string, unknown>[];
    }
  }

  // Update or add the new entity
  const existingIdx = entities.findIndex(
    (e) => (e as Record<string, unknown>).slug === newSlug,
  );
  const entry = {
    slug: newSlug,
    legal_name: newEntity.legal_name,
    relationship: newEntity.relationship,
    parent_entity: newEntity.parent_entity,
  };

  if (existingIdx >= 0) {
    entities[existingIdx] = entry;
  } else {
    entities.push(entry);
  }

  const frontmatter: Record<string, unknown> = {
    title: "Entity Registry",
    entity_count: entities.length,
    entities,
    updated_at: new Date().toISOString(),
  };

  return writeQmd(frontmatter, "Registry of all entities in this company database.\n");
}

/**
 * Discover all subsidiary slugs for a given parent entity.
 */
async function _discoverSubsidiaries(
  repo: RepoHandle,
  parentSlug: string,
): Promise<string[]> {
  // Read the entities index to find all subsidiaries
  const indexContent = await readFile(repo, "entities/_index.qmd");
  if (!indexContent) return [];

  const parsed = parseQmd(indexContent);
  const fm = parsed.frontmatter as Record<string, unknown>;
  const entities = (fm.entities ?? []) as Array<Record<string, unknown>>;

  return entities
    .filter((e) => e.parent_entity === parentSlug)
    .map((e) => e.slug as string);
}

/**
 * Detect circular parent references among entities.
 * For example, A -> B -> A would be circular.
 */
async function _detectCircularRefs(
  repo: RepoHandle,
  startSlug: string,
): Promise<string[]> {
  const warnings: string[] = [];
  const indexContent = await readFile(repo, "entities/_index.qmd");
  if (!indexContent) return warnings;

  const parsed = parseQmd(indexContent);
  const fm = parsed.frontmatter as Record<string, unknown>;
  const entities = (fm.entities ?? []) as Array<Record<string, unknown>>;

  // Build parent map: child -> parent
  const parentMap = new Map<string, string>();
  for (const e of entities) {
    if (e.parent_entity && typeof e.parent_entity === "string") {
      parentMap.set(e.slug as string, e.parent_entity);
    }
  }

  // Check for cycles by walking up the parent chain from each entity
  for (const e of entities) {
    const slug = e.slug as string;
    const visited = new Set<string>();
    let current: string | undefined = slug;

    while (current) {
      if (visited.has(current)) {
        const chain = [...visited, current].join(" -> ");
        warnings.push(
          `Circular entity reference detected: ${chain}`,
        );
        break;
      }
      visited.add(current);
      current = parentMap.get(current);
    }
  }

  return warnings;
}

/**
 * Read financial summary data for a single entity.
 * Looks in `entities/{slug}/finance/_index.qmd` for subsidiaries,
 * or `finance/_index.qmd` for the parent.
 */
async function _readEntityFinancialSummary(
  repo: RepoHandle,
  entitySlug: string,
): Promise<EntityFinancialSummary> {
  // Try entity-scoped path first, then top-level
  const paths = [
    `entities/${entitySlug}/finance/_index.qmd`,
    `finance/_index.qmd`,
  ];

  for (const path of paths) {
    const content = await readFile(repo, path);
    if (content) {
      const parsed = parseQmd(content);
      const fm = parsed.frontmatter as Record<string, unknown>;

      return {
        entity: entitySlug,
        revenue: _numericField(fm, "revenue"),
        expenses: _numericField(fm, "expenses"),
        net_income: _numericField(fm, "net_income"),
        currency: resolveSummaryCurrency(fm),
      };
    }
  }

  // No financial data — return zeroes
  return {
    entity: entitySlug,
    revenue: 0,
    expenses: 0,
    net_income: 0,
    currency: "USD",
  };
}

/**
 * Safely extract a numeric field from frontmatter.
 */
function _numericField(
  fm: Record<string, unknown>,
  key: string,
): number {
  const val = fm[key];
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}
