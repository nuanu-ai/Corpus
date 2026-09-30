/**
 * Company slug resolution for Company-DB integration.
 *
 * Maps the app's internal companyId (UUID) to a company_slug
 * (text identifier used by company-db for git repo paths).
 */

import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

const MAX_SLUG_LENGTH = 50;
const MAX_SLUG_ATTEMPTS = 100;
const SAFE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Get the tenant slug for a given tenantId.
 * Falls back to generating a slug from the tenant name if not set.
 */
export async function getTenantSlug(tenantId: string): Promise<string> {
  const company = await db
    .select({
      slug: companies.slug,
      name: companies.name,
      tenantKind: companies.tenantKind,
    })
    .from(companies)
    .where(eq(companies.id, tenantId))
    .limit(1);

  if (!company.length) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  const { slug, name, tenantKind } = company[0];

  // Persisted slugs are used as filesystem path segments. Reject imported or
  // manually edited values that could escape the configured repository root.
  if (slug) {
    if (slug.length > MAX_SLUG_LENGTH || !SAFE_SLUG_PATTERN.test(slug)) {
      throw new Error(`Unsafe tenant slug for tenant ${tenantId}`);
    }
    return slug;
  }

  // Generate slug from company name and persist it with collision handling.
  const base = slugify(name) || fallbackSlug(tenantId, tenantKind === "person" ? "person" : "company");

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = makeCandidateSlug(base, attempt);

    const existing = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.slug, candidate))
      .limit(1);

    if (existing.length > 0 && existing[0].id !== tenantId) {
      continue;
    }

    try {
      const updated = await db
        .update(companies)
        .set({ slug: candidate })
        .where(and(eq(companies.id, tenantId), isNull(companies.slug)))
        .returning({ slug: companies.slug });

      if (updated.length > 0 && updated[0].slug) {
        return updated[0].slug;
      }
    } catch (error) {
      if (isUniqueViolation(error)) {
        continue;
      }
      throw error;
    }

    // Another parallel request may already set a slug for this company.
    const fresh = await db
      .select({ slug: companies.slug })
      .from(companies)
      .where(eq(companies.id, tenantId))
      .limit(1);

    if (fresh.length > 0 && fresh[0].slug) {
      return fresh[0].slug;
    }
  }

  throw new Error(`Unable to assign unique tenant slug for tenantId=${tenantId}`);
}

export async function getCompanySlug(companyId: string): Promise<string> {
  return getTenantSlug(companyId);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, MAX_SLUG_LENGTH);
}

function fallbackSlug(tenantId: string, tenantKind: "company" | "person"): string {
  const shortId = tenantId.replace(/-/g, "").slice(0, 12) || "unknown";
  return `${tenantKind}-${shortId}`.substring(0, MAX_SLUG_LENGTH);
}

function makeCandidateSlug(base: string, attempt: number): string {
  if (attempt === 0) return base;
  const suffix = `-${attempt + 1}`;
  return `${base.substring(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /duplicate key value|unique constraint/i.test(error.message);
}
