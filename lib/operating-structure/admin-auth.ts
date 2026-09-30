import { headers } from "next/headers";
import { and, eq, isNull, or } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { companies, userAdminRoles } from "@/lib/db/schema";
import { ForbiddenError, NoCompanyError, UnauthorizedError } from "@/lib/errors";

export type OrganizationStructureAdminRole =
  | "platform_admin"
  | "organization_structure_admin"
  | "organization_structure_admin_break_glass";

export interface OrganizationStructureAdminContext {
  userId: string;
  email: string | null;
  role: OrganizationStructureAdminRole;
  rootCompanyId: string;
  rootCompanySlug: string;
  rootCompanyDbPort: number;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parseBreakGlassEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean)
      .map(normalizeEmail),
  );
}

async function getOrganizationRootCompany(): Promise<{
  id: string;
  slug: string;
  companyDbPort: number;
}> {
  const slug = process.env.OPERATING_STRUCTURE_ROOT_COMPANY_SLUG ?? "example-holdings";
  const [company] = await db
    .select({
      id: companies.id,
      slug: companies.slug,
      companyDbPort: companies.companyDbPort,
    })
    .from(companies)
    .where(eq(companies.slug, slug))
    .limit(1);

  if (!company?.slug) throw new NoCompanyError();
  return {
    id: company.id,
    slug: company.slug,
    companyDbPort: company.companyDbPort,
  };
}

export async function requireOrganizationStructureAdmin(): Promise<OrganizationStructureAdminContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new UnauthorizedError();

  const rootCompany = await getOrganizationRootCompany();
  const userId = session.user.id;
  const email = session.user.email ?? null;

  const [role] = await db
    .select({
      role: userAdminRoles.role,
      scopeCompanyId: userAdminRoles.scopeCompanyId,
    })
    .from(userAdminRoles)
    .where(
      and(
        eq(userAdminRoles.userId, userId),
        eq(userAdminRoles.status, "active"),
        or(
          and(
            eq(userAdminRoles.role, "platform_admin"),
            isNull(userAdminRoles.scopeCompanyId),
          ),
          and(
            eq(userAdminRoles.role, "organization_structure_admin"),
            eq(userAdminRoles.scopeCompanyId, rootCompany.id),
          ),
        ),
      ),
    )
    .limit(1);

  if (role?.role === "platform_admin" || role?.role === "organization_structure_admin") {
    return {
      userId,
      email,
      role: role.role,
      rootCompanyId: rootCompany.id,
      rootCompanySlug: rootCompany.slug,
      rootCompanyDbPort: rootCompany.companyDbPort,
    };
  }

  const breakGlassEmails = parseBreakGlassEmails(process.env.OPERATING_STRUCTURE_ADMIN_EMAILS);
  if (email && breakGlassEmails.has(normalizeEmail(email))) {
    return {
      userId,
      email,
      role: "organization_structure_admin_break_glass",
      rootCompanyId: rootCompany.id,
      rootCompanySlug: rootCompany.slug,
      rootCompanyDbPort: rootCompany.companyDbPort,
    };
  }

  throw new ForbiddenError("organization structure admin role required");
}
