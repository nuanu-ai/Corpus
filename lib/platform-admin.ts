import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { companies, companyMembers } from "@/lib/db/schema";
import { requireCompanyBySlug } from "@/lib/db/tenant";
import { NoCompanyError } from "@/lib/errors";
import { asc, eq, sql } from "drizzle-orm";

const FALLBACK_PLATFORM_ADMIN_EMAILS: readonly string[] = [];

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parsePlatformAdminEmails(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(normalizeEmail);
}

export function getPlatformAdminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  const envEmails = parsePlatformAdminEmails(env.PLATFORM_ADMIN_EMAILS);
  const fallbackEmails = FALLBACK_PLATFORM_ADMIN_EMAILS.map(normalizeEmail);

  return [...new Set([...fallbackEmails, ...envEmails])];
}

export function getPlatformAdminDiagnostics(env: NodeJS.ProcessEnv = process.env) {
  const envEmails = parsePlatformAdminEmails(env.PLATFORM_ADMIN_EMAILS);
  const fallbackEmails = FALLBACK_PLATFORM_ADMIN_EMAILS.map(normalizeEmail);
  const effectiveEmails = getPlatformAdminEmails(env);

  return {
    envConfiguredCount: new Set(envEmails).size,
    fallbackCount: fallbackEmails.length,
    usesFallback:
      fallbackEmails.some((email) => !envEmails.includes(email)) || envEmails.length === 0,
    effectiveCount: effectiveEmails.length,
  };
}

export function isPlatformAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return getPlatformAdminEmails().includes(normalizeEmail(email));
}

export async function getPlatformAdminSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user || !isPlatformAdminEmail(session.user.email ?? null)) {
    return null;
  }
  return session;
}

export async function requireAdminCompanyAccess(input: {
  userId: string;
  email?: string | null;
  slug: string;
  requiredRole?: string;
}) {
  if (isPlatformAdminEmail(input.email ?? null)) {
    const [company] = await db
      .select({
        companyId: companies.id,
        companyDbPort: companies.companyDbPort,
      })
      .from(companies)
      .where(eq(companies.slug, input.slug))
      .limit(1);

    if (!company) {
      throw new NoCompanyError();
    }

    return {
      companyId: company.companyId,
      role: input.requiredRole ?? "admin",
      companyDbPort: company.companyDbPort,
    };
  }

  return requireCompanyBySlug(input.userId, input.slug, input.requiredRole);
}

export async function listAdminAccessibleCompanies(input: {
  userId: string;
  email?: string | null;
}) {
  if (isPlatformAdminEmail(input.email ?? null)) {
    return db
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug,
        role: sql<string>`'admin'`,
      })
      .from(companies)
      .orderBy(asc(companies.createdAt));
  }

  return db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      role: companyMembers.role,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(eq(companyMembers.userId, input.userId));
}
