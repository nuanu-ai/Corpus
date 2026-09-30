import type Database from "better-sqlite3";
import type { RepoHandle, FileChange, AuthorInfo } from "../git/types.js";
import type { BaseEntity } from "../schema/domain-types/common.js";
import type { DomainConfig, EntityTypeConfig } from "../schema/types.js";
import { DOMAINS, getDomain } from "../schema/domains.js";
import { TYPE_PREFIXES } from "../schema/types.js";
import {
  createIdRegistry,
  allocateId,
  type IdRegistry,
} from "../schema/id-registry.js";
import { parseQmd } from "../qmd/parser.js";
import { writeQmd } from "../qmd/writer.js";
import { readFile } from "../git/repo-manager.js";
import { indexFile } from "../index/indexer.js";
import { getEntity, queryEntities } from "../index/query.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EntityValidator = (
  entity: BaseEntity
) => { valid: boolean; errors?: string[] };

export interface DomainEngine {
  createEntity<T extends BaseEntity>(
    domain: string,
    entityData: Omit<T, "id" | "created_at" | "updated_at">,
    options?: { actor?: AuthorInfo }
  ): Promise<{ id: string; filePath: string }>;

  readEntity<T extends BaseEntity>(
    domain: string,
    entityId: string
  ): Promise<T | null>;

  updateEntity<T extends BaseEntity>(
    domain: string,
    entityId: string,
    updates: Partial<T>,
    options?: { actor?: AuthorInfo }
  ): Promise<{ filePath: string }>;

  listEntities<T extends BaseEntity>(
    domain: string,
    filters?: { type?: string; status?: string }
  ): Promise<T[]>;

  registerValidator(domain: string, validator: EntityValidator): void;
}

// ---------------------------------------------------------------------------
// Plural mappings for file paths
// ---------------------------------------------------------------------------

/**
 * Convert an entity type name to its plural directory form.
 * Uses the EntityTypeConfig name (e.g. "Customer" -> "customers").
 * Falls back to appending "s" for unknown types.
 */
function pluralizeTypeName(name: string): string {
  const lower = name.toLowerCase().replace(/\s+/g, "-");

  // Special cases
  const irregulars: Record<string, string> = {
    "company-profile": "companies",
    "journal-entry": "ledger/journal-entries",
    "job-posting": "job-postings",
    "purchase-order": "purchase-orders",
    "expense-report": "expense-reports",
    "tax-filing": "tax-filings",
    "board-member": "board-members",
    "funding-round": "funding-rounds",
  };

  if (irregulars[lower]) return irregulars[lower];

  // Standard English pluralization
  if (lower.endsWith("y") && !/[aeiou]y$/.test(lower)) {
    return lower.slice(0, -1) + "ies";
  }
  if (lower.endsWith("s") || lower.endsWith("x") || lower.endsWith("ch") || lower.endsWith("sh")) {
    return lower + "es";
  }
  return lower + "s";
}

/**
 * Find the EntityTypeConfig for a given prefix within a domain.
 */
function findEntityTypeConfig(
  domainConfig: DomainConfig,
  prefix: string
): EntityTypeConfig | undefined {
  return domainConfig.entityTypes.find((et) => et.prefix === prefix);
}

/**
 * Resolve the prefix from entity data type field.
 * The type field in entityData is the prefix itself (e.g., "cust", "inv").
 */
function resolvePrefix(type: string): string {
  // The type might be a full name like "customer" or a prefix like "cust"
  // Check prefix first
  if (TYPE_PREFIXES[type]) return type;

  // Try to find by entity name (case insensitive)
  for (const [prefix, config] of Object.entries(TYPE_PREFIXES)) {
    if (config.name.toLowerCase() === type.toLowerCase()) {
      return prefix;
    }
  }

  return type;
}

// ---------------------------------------------------------------------------
// createDomainEngine
// ---------------------------------------------------------------------------

export function createDomainEngine(
  repo: RepoHandle,
  db: Database.Database
): DomainEngine {
  const idRegistry: IdRegistry = createIdRegistry();
  const validators = new Map<string, EntityValidator>();

  // Sync the registry with existing entities in the index to avoid ID collisions.
  // Scan all entity types and set the sequence to the highest existing number.
  _syncRegistryFromIndex(db, idRegistry);

  return {
    async createEntity<T extends BaseEntity>(
      domain: string,
      entityData: Omit<T, "id" | "created_at" | "updated_at">,
      options?: { actor?: AuthorInfo }
    ): Promise<{ id: string; filePath: string }> {
      // 1. Look up domain in registry
      const domainConfig = getDomain(domain);
      if (!domainConfig) {
        throw new Error(`Unknown domain: ${domain}`);
      }

      // 2. Resolve the entity type prefix
      const typeField = (entityData as Record<string, unknown>).type as string;
      if (!typeField) {
        throw new Error("entityData must include a 'type' field");
      }

      const prefix = resolvePrefix(typeField);
      const entityTypeConfig = findEntityTypeConfig(domainConfig, prefix);
      if (!entityTypeConfig) {
        throw new Error(
          `Entity type prefix '${prefix}' not found in domain '${domain}'`
        );
      }

      // 3. Allocate ID
      const id = allocateId(idRegistry, prefix);

      // 4. Build frontmatter
      const now = new Date().toISOString();
      const frontmatter: Record<string, unknown> = {
        id,
        ...entityData,
        created_at: now,
        updated_at: now,
      };

      if (options?.actor) {
        frontmatter.created_by = options.actor.name;
      }

      // 5. Run validator if registered
      const validator = validators.get(domain);
      if (validator) {
        const result = validator(frontmatter as unknown as BaseEntity);
        if (!result.valid) {
          throw new Error(
            `Validation failed: ${result.errors?.join(", ") ?? "unknown error"}`
          );
        }
      }

      // 6. Build QMD content
      const content = writeQmd(frontmatter, "");

      // 7. Determine file path
      const typePlural = pluralizeTypeName(entityTypeConfig.name);
      const filePath = `${domainConfig.basePath}/${typePlural}/${id}.qmd`;

      // 8. Write to disk
      const fullDir = join(repo.path, domainConfig.basePath, typePlural);
      await mkdir(fullDir, { recursive: true });
      await writeFile(join(repo.path, filePath), content);

      // 9. Index the file
      indexFile(db, filePath, content, domain);

      return { id, filePath };
    },

    async readEntity<T extends BaseEntity>(
      domain: string,
      entityId: string
    ): Promise<T | null> {
      // 1. Query SQLite index by qualified ID
      const entityResult = getEntity(db, entityId);
      if (!entityResult) return null;

      // Verify domain matches
      if (entityResult.domain !== domain) return null;

      // 2. Read QMD file from disk
      const content = await readFile(repo, entityResult.filePath);
      if (!content) return null;

      // 3. Parse and return typed entity
      const parsed = parseQmd<T>(content);
      return parsed.frontmatter;
    },

    async updateEntity<T extends BaseEntity>(
      domain: string,
      entityId: string,
      updates: Partial<T>,
      options?: { actor?: AuthorInfo }
    ): Promise<{ filePath: string }> {
      // 1. Read current entity from index
      const entityResult = getEntity(db, entityId);
      if (!entityResult) {
        throw new Error(`Entity not found: ${entityId}`);
      }

      if (entityResult.domain !== domain) {
        throw new Error(
          `Entity ${entityId} belongs to domain '${entityResult.domain}', not '${domain}'`
        );
      }

      // 2. Read current file content
      const content = await readFile(repo, entityResult.filePath);
      if (!content) {
        throw new Error(`File not found on disk: ${entityResult.filePath}`);
      }

      const parsed = parseQmd(content);

      // 3. Merge updates
      const merged: Record<string, unknown> = {
        ...parsed.frontmatter,
        ...updates,
        updated_at: new Date().toISOString(),
      };

      // Preserve immutable fields
      merged.id = entityId;
      merged.created_at = parsed.frontmatter.created_at;

      // 4. Run validator if registered
      const validator = validators.get(domain);
      if (validator) {
        const result = validator(merged as unknown as BaseEntity);
        if (!result.valid) {
          throw new Error(
            `Validation failed: ${result.errors?.join(", ") ?? "unknown error"}`
          );
        }
      }

      // 5. Write back to disk
      const newContent = writeQmd(merged, parsed.body);
      await writeFile(join(repo.path, entityResult.filePath), newContent);

      // 6. Re-index the file
      indexFile(db, entityResult.filePath, newContent, domain);

      return { filePath: entityResult.filePath };
    },

    async listEntities<T extends BaseEntity>(
      domain: string,
      filters?: { type?: string; status?: string }
    ): Promise<T[]> {
      // 1. Query SQLite index with domain and optional filters
      const results = queryEntities(db, {
        domain,
        type: filters?.type,
        status: filters?.status,
      });

      // 2. Read and parse each entity from disk
      const entities: T[] = [];
      for (const result of results) {
        const content = await readFile(repo, result.filePath);
        if (content) {
          const parsed = parseQmd<T>(content);
          entities.push(parsed.frontmatter);
        }
      }

      return entities;
    },

    registerValidator(domain: string, validator: EntityValidator): void {
      validators.set(domain, validator);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Sync the ID registry sequences from the existing index to avoid
 * allocating IDs that already exist.
 */
function _syncRegistryFromIndex(
  db: Database.Database,
  registry: IdRegistry
): void {
  // Query max entity number per prefix from the entities table.
  // qualified_id format is "prefix-NNN" so we parse out the number.
  try {
    const rows = db
      .prepare(
        `SELECT type, qualified_id FROM entities ORDER BY qualified_id`
      )
      .all() as Array<{ type: string; qualified_id: string }>;

    for (const row of rows) {
      const id = row.qualified_id;
      const dashIdx = id.lastIndexOf("-");
      if (dashIdx === -1) continue;

      const prefix = id.substring(0, dashIdx);
      const numStr = id.substring(dashIdx + 1);
      const num = parseInt(numStr, 10);

      if (!isNaN(num) && TYPE_PREFIXES[prefix]) {
        const current = registry.sequences[prefix] ?? 0;
        if (num > current) {
          registry.sequences[prefix] = num;
        }
      }
    }
  } catch {
    // Index might be empty or table might not exist yet — that's fine
  }
}
