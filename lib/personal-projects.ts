import { and, eq } from "drizzle-orm";

import { provisionTenantDbRepo, allocateNextCompanyDbPort } from "@/lib/company-db/provisioning";
import { db } from "@/lib/db";
import { companies, companyMembers, users } from "@/lib/db/schema";

export interface PersonalProjectRecord {
  id: string;
  name: string;
  slug: string | null;
  companyDbPort: number;
  settings: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

function buildPersonalProjectName(name: string | null | undefined, email: string | null | undefined): string {
  const seed = typeof name === "string" && name.trim().length > 0
    ? name.trim()
    : typeof email === "string" && email.includes("@")
      ? email.split("@")[0]
      : "Personal";
  const firstWord = seed.split(/\s+/).filter(Boolean)[0] ?? "Personal";
  return `${firstWord}'s Personal`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /duplicate key value|unique constraint/i.test(error.message);
}

export async function getPersonalProjectForUser(userId: string): Promise<PersonalProjectRecord | null> {
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      companyDbPort: companies.companyDbPort,
      settings: companies.settings,
      createdAt: companies.createdAt,
      updatedAt: companies.updatedAt,
    })
    .from(companies)
    .where(
      and(
        eq(companies.tenantKind, "person"),
        eq(companies.schemaPack, "person"),
        eq(companies.personalForUserId, userId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function ensurePersonalProjectForUser(input: {
  userId: string;
  name?: string | null;
  email?: string | null;
  /**
   * When true, only the DB rows are created — the per-tenant git repo + PM2
   * daemon are NOT spun up. Used for tier='community' (BYOK) sign-ups so we don't
   * pay 85+ MB of RAM per casual signup. The repo is materialised lazily on
   * first chat/upload via ensureCompanyProvisioned.
   */
  skipProvisioning?: boolean;
}): Promise<PersonalProjectRecord> {
  const existing = await getPersonalProjectForUser(input.userId);
  if (existing) return existing;

  let name = input.name ?? null;
  let email = input.email ?? null;
  if (!name || !email) {
    const [user] = await db
      .select({
        name: users.name,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    name = name ?? user?.name ?? null;
    email = email ?? user?.email ?? null;
  }

  try {
    const created = await db.transaction(async (tx) => {
      const companyDbPort = await allocateNextCompanyDbPort(tx);
      const [personal] = await tx
        .insert(companies)
        .values({
          name: buildPersonalProjectName(name, email),
          tenantKind: "person",
          schemaPack: "person",
          personalForUserId: input.userId,
          reportingCurrency: "USD",
          settings: {
            personalProject: true,
            autoCreated: true,
          },
          companyDbPort,
          provisioningStatus: input.skipProvisioning ? "pending" : "active",
        })
        .returning({
          id: companies.id,
          name: companies.name,
          slug: companies.slug,
          companyDbPort: companies.companyDbPort,
          settings: companies.settings,
          createdAt: companies.createdAt,
          updatedAt: companies.updatedAt,
        });

      await tx.insert(companyMembers).values({
        companyId: personal.id,
        userId: input.userId,
        role: "owner",
      });

      return personal;
    });

    if (!input.skipProvisioning) {
      try {
        await provisionTenantDbRepo(created.id);
      } catch (error) {
        console.error(
          `[personal-project] Provisioning failed for tenant=${created.id}:`,
          error,
        );
      }
    }

    return created;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const current = await getPersonalProjectForUser(input.userId);
    if (current) return current;
    throw error;
  }
}
