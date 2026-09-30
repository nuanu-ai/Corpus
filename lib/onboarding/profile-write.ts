/**
 * Canonical profile-field writer for chat onboarding.
 *
 * Writes onboarding profile answers to the SAME places /api/onboarding/
 * status reads them, so the snapshot reflects them on the next turn:
 *   - companyName        → companies.name (column)
 *   - jurisdiction       → companies.jurisdiction (column)
 *   - entityType         → companies.entityType (column)
 *   - businessType       → companies.businessType (column)
 *   - website            → companies.website (column)
 *   - founderRole        → companies.settings.onboarding.founderRole (nested)
 *   - companyStage       → companies.settings.onboarding.companyStage (nested)
 *   - primaryQuestion    → companies.settings.onboarding.primaryQuestion (nested)
 *   - operatingContext   → companies.settings.onboarding.operatingContext (nested)
 *
 * This is a PARTIAL update — only provided fields are written, and it does
 * NOT mark onboarding complete (that's the handoff's job). It coexists with
 * the legacy /api/onboarding/complete which owns the `complete` flag.
 *
 * The nested writes use jsonb merge so they never clobber the company-
 * scoped chat state at settings.onboardingChat.
 */

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";

const COLUMN_FIELDS = [
  "jurisdiction",
  "entityType",
  "businessType",
  "website",
] as const;
const NESTED_FIELDS = [
  "founderRole",
  "companyStage",
  "primaryQuestion",
  "operatingContext",
] as const;

export type OnboardingProfileField =
  | "companyName"
  | (typeof COLUMN_FIELDS)[number]
  | (typeof NESTED_FIELDS)[number];

export const WRITABLE_PROFILE_FIELDS: OnboardingProfileField[] = [
  "companyName",
  ...COLUMN_FIELDS,
  ...NESTED_FIELDS,
];

/**
 * Max length for a profile column string. These map to Postgres `text`
 * columns; without a cap an authed POST could stuff unbounded values into
 * them (ONB-2). `companyName` keeps its tighter 120 cap below.
 */
const MAX_COLUMN_FIELD_LENGTH = 200;

function normalize(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Normalize and enforce a max length (oversized values are clamped, not dropped). */
function normalizeCapped(value: unknown, maxLength: number): string | null {
  const normalized = normalize(value);
  if (!normalized) return null;
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

/**
 * Writes a partial set of profile fields to canonical storage. Unknown
 * keys are ignored; empty values are skipped (no clobber). Returns the
 * list of fields actually written.
 */
export async function writeOnboardingProfileFields(
  companyId: string,
  input: Partial<Record<OnboardingProfileField, unknown>>,
): Promise<OnboardingProfileField[]> {
  const written: OnboardingProfileField[] = [];

  const columnUpdates: Record<string, string> = {};
  const nestedUpdates: Record<string, string> = {};

  const companyName = normalizeCapped(input.companyName, 120);
  if (companyName) {
    columnUpdates.name = companyName;
    written.push("companyName");
  }
  for (const field of COLUMN_FIELDS) {
    const value = normalizeCapped(input[field], MAX_COLUMN_FIELD_LENGTH);
    if (value) {
      columnUpdates[field] = value;
      written.push(field);
    }
  }
  for (const field of NESTED_FIELDS) {
    const value = normalizeCapped(input[field], MAX_COLUMN_FIELD_LENGTH);
    if (value) {
      nestedUpdates[field] = value;
      written.push(field);
    }
  }

  if (written.length === 0) return [];

  // Build the SET clause. Column updates are direct; nested updates merge
  // into settings.onboarding via jsonb concat so we preserve sibling keys
  // (and the distinct settings.onboardingChat state).
  const setClause: Record<string, unknown> = { ...columnUpdates, updatedAt: new Date() };

  if (Object.keys(nestedUpdates).length > 0) {
    setClause.settings = sql`
      jsonb_set(
        COALESCE(${companies.settings}, '{}'::jsonb),
        '{onboarding}',
        COALESCE(${companies.settings} -> 'onboarding', '{}'::jsonb)
          || ${JSON.stringify(nestedUpdates)}::jsonb,
        true
      )
    `;
  }

  await db.update(companies).set(setClause).where(eq(companies.id, companyId));
  return written;
}
