import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chatThreads, companies, companyMembers } from "@/lib/db/schema";

export interface DefaultCompanyMembership {
  companyId: string;
  role: string;
}

/**
 * Default company is a UX fallback, not an authorization shortcut.
 * Prefer the user's most recent company chat so cleared/stale cookies do not
 * make old chat history look deleted by silently opening another company.
 */
export async function getDefaultCompanyMembershipForUser(
  userId: string,
): Promise<DefaultCompanyMembership | null> {
  const lastChatAt = sql<Date | null>`max(${chatThreads.updatedAt})`;

  const rows = await db
    .select({
      companyId: companyMembers.companyId,
      role: companyMembers.role,
      lastChatAt,
    })
    .from(companyMembers)
    .innerJoin(companies, eq(companies.id, companyMembers.companyId))
    .leftJoin(
      chatThreads,
      and(
        eq(chatThreads.companyId, companyMembers.companyId),
        eq(chatThreads.userId, companyMembers.userId),
      ),
    )
    .where(
      and(
        eq(companyMembers.userId, userId),
        eq(companies.tenantKind, "company"),
      ),
    )
    .groupBy(
      companyMembers.companyId,
      companyMembers.role,
      companyMembers.createdAt,
      companies.createdAt,
    )
    .orderBy(
      sql`${lastChatAt} desc nulls last`,
      asc(companyMembers.createdAt),
      asc(companies.createdAt),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    companyId: row.companyId,
    role: row.role,
  };
}

export async function getDefaultCompanyIdForUser(
  userId: string,
): Promise<string | null> {
  return (await getDefaultCompanyMembershipForUser(userId))?.companyId ?? null;
}
