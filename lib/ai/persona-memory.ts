/**
 * Persona long-term memory: read, upsert, and prompt-render helpers.
 *
 * Storage: `persona_memory_entries`, scoped to `(companyId, personaSlug)`.
 * Natural upsert key: `(company_id, persona_slug, kind, title)`.
 *
 * Concurrency: writes use `pg_advisory_xact_lock` keyed on
 * `(companyId, personaSlug)` so two simultaneous tool-driven upserts on
 * the same persona serialize cleanly without blocking reads.
 *
 * Prompt rendering: `renderPersonaMemoryForPrompt` produces a compact
 * `<persona_memory persona="…">` markdown block, recency-sorted, capped
 * by a byte budget so the prefix of the system prompt stays cache-stable.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { personaMemoryEntries } from "@/lib/db/schema";

import { isPersonaSlug, type PersonaSlug } from "./personas";

/** Domain types — what callers (tool handlers, prompt builders) work with. */
export interface PersonaMemoryEntry {
  id: string;
  companyId: string;
  personaSlug: PersonaSlug;
  kind: string;
  title: string;
  description: string | null;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonaMemoryUpsertInput {
  companyId: string;
  personaSlug: PersonaSlug;
  kind: string;
  title: string;
  content: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
}

/** Hard cap matching the DB CHECK constraint (`length(content) <= 8000`). */
export const PERSONA_MEMORY_MAX_CONTENT_LENGTH = 8000;
/**
 * Default budget for the cumulative size of memory rendered into a system
 * prompt. Older entries that don't fit are silently dropped from the
 * injected block (still kept in the DB for direct inspection).
 */
export const PERSONA_MEMORY_DEFAULT_PROMPT_BUDGET = 8 * 1024;

function assertPersonaSlug(slug: string): asserts slug is PersonaSlug {
  if (!isPersonaSlug(slug)) {
    throw new Error(`Invalid persona slug: ${slug}`);
  }
}

function rowToEntry(
  row: typeof personaMemoryEntries.$inferSelect,
): PersonaMemoryEntry {
  assertPersonaSlug(row.personaSlug);
  return {
    id: row.id,
    companyId: row.companyId,
    personaSlug: row.personaSlug,
    kind: row.kind,
    title: row.title,
    description: row.description,
    content: row.content,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Get all memory entries for a persona, recency-sorted (newest first).
 */
export async function getPersonaMemoryEntries(input: {
  companyId: string;
  personaSlug: PersonaSlug;
}): Promise<PersonaMemoryEntry[]> {
  const rows = await db
    .select()
    .from(personaMemoryEntries)
    .where(
      and(
        eq(personaMemoryEntries.companyId, input.companyId),
        eq(personaMemoryEntries.personaSlug, input.personaSlug),
      ),
    )
    .orderBy(desc(personaMemoryEntries.updatedAt), asc(personaMemoryEntries.id));
  return rows.map(rowToEntry);
}

/**
 * Insert or update a single memory entry by its natural key.
 * Wrapped in a transaction with an advisory lock keyed on
 * (companyId, personaSlug) to serialize concurrent upserts safely.
 */
export async function upsertPersonaMemoryEntry(
  input: PersonaMemoryUpsertInput,
): Promise<PersonaMemoryEntry> {
  const { companyId, personaSlug, kind, title, content } = input;
  if (!companyId) throw new Error("companyId is required");
  if (!personaSlug) throw new Error("personaSlug is required");
  if (!isPersonaSlug(personaSlug)) {
    throw new Error(`Invalid persona slug: ${personaSlug}`);
  }
  if (!kind?.trim()) throw new Error("kind is required");
  if (!title?.trim()) throw new Error("title is required");
  if (!content?.trim()) throw new Error("content is required");
  if (content.length > PERSONA_MEMORY_MAX_CONTENT_LENGTH) {
    throw new Error(
      `content exceeds max length ${PERSONA_MEMORY_MAX_CONTENT_LENGTH}`,
    );
  }

  const description = input.description?.trim() || null;
  const metadata = input.metadata ?? {};

  return db.transaction(async (tx) => {
    // Serialize concurrent writes for the same persona without blocking reads.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${companyId}:${personaSlug}`}))`,
    );

    const [row] = await tx
      .insert(personaMemoryEntries)
      .values({
        companyId,
        personaSlug,
        kind: kind.trim(),
        title: title.trim(),
        description,
        content,
        metadata,
      })
      .onConflictDoUpdate({
        target: [
          personaMemoryEntries.companyId,
          personaMemoryEntries.personaSlug,
          personaMemoryEntries.kind,
          personaMemoryEntries.title,
        ],
        set: {
          description,
          content,
          metadata,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) throw new Error("upsertPersonaMemoryEntry: no row returned");
    return rowToEntry(row);
  });
}

export async function deletePersonaMemoryEntry(input: {
  companyId: string;
  personaSlug: PersonaSlug;
  kind: string;
  title: string;
}): Promise<boolean> {
  const result = await db
    .delete(personaMemoryEntries)
    .where(
      and(
        eq(personaMemoryEntries.companyId, input.companyId),
        eq(personaMemoryEntries.personaSlug, input.personaSlug),
        eq(personaMemoryEntries.kind, input.kind.trim()),
        eq(personaMemoryEntries.title, input.title.trim()),
      ),
    )
    .returning({ id: personaMemoryEntries.id });
  return result.length > 0;
}

/**
 * Render a list of entries as a compact `<persona_memory>` block for the
 * system prompt. Recency-sorted (newest first), capped by `byteBudget`.
 *
 * Format (one entry):
 *   ## [kind] title
 *   _description_  (optional)
 *
 *   content
 *
 * The block as a whole is wrapped in
 *   `<persona_memory persona="cfo">…</persona_memory>` so Claude can cleanly
 *   distinguish it from user-provided text.
 */
export function renderPersonaMemoryForPrompt(
  entries: PersonaMemoryEntry[],
  options: { personaSlug: PersonaSlug; byteBudget?: number } = {
    personaSlug: "cfo",
  },
): string {
  const personaSlug = options.personaSlug;
  const byteBudget =
    options.byteBudget ?? PERSONA_MEMORY_DEFAULT_PROMPT_BUDGET;

  if (entries.length === 0) {
    return `<persona_memory persona="${personaSlug}">\n(empty)\n</persona_memory>`;
  }

  const sorted = [...entries].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );

  const sections: string[] = [];
  let budgetRemaining = byteBudget;
  for (const entry of sorted) {
    const heading = `## [${entry.kind}] ${entry.title}`;
    const desc = entry.description ? `_${entry.description}_\n\n` : "";
    const block = `${heading}\n${desc}${entry.content.trim()}`;
    const blockBytes = Buffer.byteLength(block, "utf8") + 2; // + delimiter
    if (blockBytes > budgetRemaining) break;
    sections.push(block);
    budgetRemaining -= blockBytes;
  }

  if (sections.length === 0) {
    return `<persona_memory persona="${personaSlug}">\n(memory exceeds budget — see settings to review)\n</persona_memory>`;
  }

  const body = sections.join("\n\n");
  return `<persona_memory persona="${personaSlug}">\n${body}\n</persona_memory>`;
}
