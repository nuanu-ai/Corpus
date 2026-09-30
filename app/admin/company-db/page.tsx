import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { companies, companyMembers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CompanyDbObservatory } from "./_components/observatory";
import { listAdminAccessibleCompanies } from "@/lib/platform-admin";
import { getRequestedCompanyIdFromHeaders } from "@/lib/company-context";

export const dynamic = "force-dynamic";

async function getUserCompanies(userId: string) {
  return db
    .select({
      id: companies.id,
      name: companies.name,
      slug: companies.slug,
      role: companyMembers.role,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .where(eq(companyMembers.userId, userId));
}

export default async function CompanyDbPage({
  searchParams,
}: {
  searchParams?: Promise<{ company?: string }>;
}) {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session?.user) {
    redirect("/login");
  }

  const userCompanies =
    session.user.email && session.user.id
      ? await listAdminAccessibleCompanies({
          userId: session.user.id,
          email: session.user.email,
        })
      : await getUserCompanies(session.user.id);

  const requestedCompanyId = getRequestedCompanyIdFromHeaders(hdrs);
  const requestedSlug = (await searchParams)?.company?.trim() || null;
  const activeCompanySlug =
    userCompanies.find((company) => company.id === requestedCompanyId)?.slug ?? null;
  const selectedSlug =
    requestedSlug &&
    userCompanies.some((company) => company.slug === requestedSlug)
      ? requestedSlug
      : activeCompanySlug;

  return (
    <CompanyDbObservatory
      companies={userCompanies}
      selectedSlug={selectedSlug ?? undefined}
    />
  );
}
