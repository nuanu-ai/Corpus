import Database from "better-sqlite3";

/**
 * SQL statements to initialize the index database schema.
 * Executed once when the database is created or opened.
 */
const SCHEMA_SQL = `
-- Main entity table
CREATE TABLE IF NOT EXISTS entities (
  qualified_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  domain TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  frontmatter TEXT NOT NULL,
  title TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT,
  indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  entity_slug TEXT NOT NULL DEFAULT 'root',
  local_id TEXT NOT NULL DEFAULT '',
  commit_sha TEXT
);

-- Cross-references between entities
CREATE TABLE IF NOT EXISTS refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  ref_type TEXT,
  FOREIGN KEY (source_id) REFERENCES entities(qualified_id),
  UNIQUE(source_id, target_id, ref_type)
);

-- Full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  qualified_id,
  title,
  body,
  domain,
  type,
  content=entities,
  content_rowid=rowid
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_domain ON entities(domain);
CREATE INDEX IF NOT EXISTS idx_entities_status ON entities(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_slug_local ON entities(entity_slug, local_id);
CREATE INDEX IF NOT EXISTS idx_refs_source ON refs(source_id);
CREATE INDEX IF NOT EXISTS idx_refs_target ON refs(target_id);
`;

/**
 * Creates or opens a SQLite database at the given path and initializes
 * the index schema (entities, refs, FTS5 virtual table, indexes).
 *
 * Enables WAL mode for better concurrent read performance.
 */
export function createIndexDb(dbPath: string): InstanceType<typeof Database> {
  const db = new Database(dbPath);

  // Enable WAL mode for performance
  db.pragma("journal_mode = WAL");

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Initialize schema
  db.exec(SCHEMA_SQL);

  return db;
}

/**
 * Closes the SQLite database connection.
 */
export function closeIndexDb(db: InstanceType<typeof Database>): void {
  db.close();
}
