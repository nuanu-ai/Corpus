import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";

export type CompanyRefMatch = {
  id: string;
  name: string;
  slug: string | null;
  parentCompanyId: string | null;
  matchedBy: "id" | "slug" | "name" | "alias";
};

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a free-text reference to a single company within a tenant scope.
 *
 * Lookup order: id → slug → name (case-insensitive) → alias (case-insensitive).
 * Returns null when no row matches or when name/alias matches are ambiguous
 * (more than one company shares that name/alias inside the same scope).
 */
export async function resolveCompanyRef(
  input: string,
  options: { tenantKind?: "company" | "personal" } = {},
): Promise<CompanyRefMatch | null> {
  const raw = input?.toString().trim();
  if (!raw) return null;
  const norm = normalize(raw);

  const baseFilter = options.tenantKind
    ? eq(companies.tenantKind, options.tenantKind)
    : undefined;

  if (UUID_RE.test(raw)) {
    const rows = await db
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        parentCompanyId: companies.parentCompanyId,
      })
      .from(companies)
      .where(baseFilter ? and(eq(companies.id, raw), baseFilter) : eq(companies.id, raw))
      .limit(1);
    if (rows[0]) return { ...rows[0], matchedBy: "id" };
  }

  const slugRows = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      parentCompanyId: companies.parentCompanyId,
    })
    .from(companies)
    .where(baseFilter ? and(eq(companies.slug, norm), baseFilter) : eq(companies.slug, norm))
    .limit(2);
  if (slugRows.length === 1) return { ...slugRows[0], matchedBy: "slug" };

  const nameRows = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      parentCompanyId: companies.parentCompanyId,
    })
    .from(companies)
    .where(
      baseFilter
        ? and(sql`lower(${companies.name}) = ${norm}`, baseFilter)
        : sql`lower(${companies.name}) = ${norm}`,
    )
    .limit(2);
  if (nameRows.length === 1) return { ...nameRows[0], matchedBy: "name" };

  const aliasRows = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      parentCompanyId: companies.parentCompanyId,
    })
    .from(companies)
    .where(
      baseFilter
        ? and(
            sql`EXISTS (SELECT 1 FROM unnest(${companies.aliases}) a WHERE lower(a) = ${norm})`,
            baseFilter,
          )
        : sql`EXISTS (SELECT 1 FROM unnest(${companies.aliases}) a WHERE lower(a) = ${norm})`,
    )
    .limit(2);
  if (aliasRows.length === 1) return { ...aliasRows[0], matchedBy: "alias" };

  return null;
}

/**
 * Walk parent_company_id upwards from a starting company.
 * Stops at top (parent_company_id IS NULL), at a cycle, or at MAX_DEPTH.
 */
export async function getCompanyAncestry(companyId: string): Promise<CompanyRefMatch[]> {
  const MAX_DEPTH = 16;
  const trail: CompanyRefMatch[] = [];
  const seen = new Set<string>();
  let current: string | null = companyId;
  for (let depth = 0; depth < MAX_DEPTH && current && !seen.has(current); depth += 1) {
    seen.add(current);
    const rows = await db
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        parentCompanyId: companies.parentCompanyId,
      })
      .from(companies)
      .where(eq(companies.id, current))
      .limit(1);
    if (!rows[0]) break;
    trail.push({ ...rows[0], matchedBy: "id" });
    current = rows[0].parentCompanyId;
  }
  return trail;
}

/**
 * Returns ids of all descendants of `rootCompanyId` via parent_company_id, plus the root itself.
 * Used to expand "all companies under Example Holdings" queries.
 */
export async function getCompanyDescendantIds(rootCompanyId: string): Promise<string[]> {
  const MAX_DEPTH = 16;
  const acc = new Set<string>([rootCompanyId]);
  let frontier: string[] = [rootCompanyId];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const rows = await db
      .select({
        id: companies.id,
        parentCompanyId: companies.parentCompanyId,
      })
      .from(companies)
      .where(sql`${companies.parentCompanyId} = ANY(${frontier})`);
    const next: string[] = [];
    for (const row of rows) {
      if (acc.has(row.id)) continue;
      acc.add(row.id);
      next.push(row.id);
    }
    frontier = next;
  }
  return Array.from(acc);
}
