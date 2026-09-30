import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  getSessionCompanyContext,
  handleApiError,
} from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  auditLog,
  companyMemberDomainGrants,
  companyMembers,
  users,
} from "@/lib/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { normalizeCompanyDomain } from "@/lib/db/tenant";

const accessLevels = ["metadata", "read", "file", "write", "admin"] as const;
const accessLevelRank: Record<typeof accessLevels[number], number> = {
  metadata: 0,
  read: 1,
  file: 2,
  write: 3,
  admin: 4,
};

const grantInputSchema = z.object({
  domain: z.string().min(1),
  accessLevel: z.enum(accessLevels).default("read"),
});

const updateSchema = z.object({
  userId: z.string().min(1),
  grants: z.array(grantInputSchema).default([]),
  reason: z.string().min(1),
  source: z.string().min(1).default("manual"),
});

function assertCanManageDomainGrants(role: string): void {
  if (role === "owner" || role === "admin") return;
  throw new ForbiddenError("Company admin role required to manage domain grants");
}

function normalizeGrantInputs(
  grants: Array<z.infer<typeof grantInputSchema>>,
): Array<{ domain: string; accessLevel: typeof accessLevels[number] }> {
  const byDomain = new Map<string, typeof accessLevels[number]>();
  for (const grant of grants) {
    const domain = normalizeCompanyDomain(grant.domain);
    if (!domain) {
      throw new ForbiddenError(`Invalid company domain grant: ${grant.domain}`);
    }
    const current = byDomain.get(domain);
    if (!current || accessLevelRank[grant.accessLevel] > accessLevelRank[current]) {
      byDomain.set(domain, grant.accessLevel);
    }
  }
  if (byDomain.has("*")) {
    return [{ domain: "*", accessLevel: byDomain.get("*") ?? "admin" }];
  }
  return Array.from(byDomain.entries())
    .map(([domain, accessLevel]) => ({ domain, accessLevel }))
    .sort((left, right) => left.domain.localeCompare(right.domain));
}

async function requireCompanyMember(companyId: string, userId: string): Promise<void> {
  const [membership] = await db
    .select({ id: companyMembers.id })
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.userId, userId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new ForbiddenError("Target user is not a member of this company");
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getSessionCompanyContext();
    assertCanManageDomainGrants(auth.role);
    const userId = req.nextUrl.searchParams.get("user_id")?.trim() || null;

    const rows = await db
      .select({
        userId: companyMembers.userId,
        email: users.email,
        name: users.name,
        role: companyMembers.role,
        grantId: companyMemberDomainGrants.id,
        domain: companyMemberDomainGrants.domain,
        accessLevel: companyMemberDomainGrants.accessLevel,
        source: companyMemberDomainGrants.source,
        approvedByUserId: companyMemberDomainGrants.approvedByUserId,
        approvedAt: companyMemberDomainGrants.approvedAt,
      })
      .from(companyMembers)
      .innerJoin(users, eq(users.id, companyMembers.userId))
      .leftJoin(
        companyMemberDomainGrants,
        and(
          eq(companyMemberDomainGrants.companyId, companyMembers.companyId),
          eq(companyMemberDomainGrants.userId, companyMembers.userId),
          eq(companyMemberDomainGrants.status, "active"),
        ),
      )
      .where(
        userId
          ? and(
            eq(companyMembers.companyId, auth.companyId),
            eq(companyMembers.userId, userId),
          )
          : eq(companyMembers.companyId, auth.companyId),
      )
      .orderBy(asc(users.email), asc(companyMemberDomainGrants.domain));

    const members = new Map<string, {
      userId: string;
      email: string;
      name: string;
      role: string;
      grants: Array<{
        id: string;
        domain: string;
        accessLevel: string;
        source: string;
        approvedByUserId: string | null;
        approvedAt: Date;
      }>;
    }>();

    for (const row of rows) {
      const member = members.get(row.userId) ?? {
        userId: row.userId,
        email: row.email,
        name: row.name,
        role: row.role,
        grants: [],
      };
      if (row.grantId && row.domain && row.accessLevel) {
        member.grants.push({
          id: row.grantId,
          domain: row.domain,
          accessLevel: row.accessLevel,
          source: row.source ?? "unknown",
          approvedByUserId: row.approvedByUserId,
          approvedAt: row.approvedAt ?? new Date(0),
        });
      }
      members.set(row.userId, member);
    }

    return NextResponse.json({
      companyId: auth.companyId,
      members: Array.from(members.values()),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await getSessionCompanyContext();
    assertCanManageDomainGrants(auth.role);
    const body = updateSchema.parse(await req.json());
    const nextGrants = normalizeGrantInputs(body.grants);

    await requireCompanyMember(auth.companyId, body.userId);

    const oldGrants = await db
      .select({
        domain: companyMemberDomainGrants.domain,
        accessLevel: companyMemberDomainGrants.accessLevel,
        source: companyMemberDomainGrants.source,
      })
      .from(companyMemberDomainGrants)
      .where(
        and(
          eq(companyMemberDomainGrants.companyId, auth.companyId),
          eq(companyMemberDomainGrants.userId, body.userId),
          eq(companyMemberDomainGrants.status, "active"),
        ),
      )
      .orderBy(asc(companyMemberDomainGrants.domain));

    await db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(companyMemberDomainGrants)
        .set({
          status: "revoked",
          revokedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(companyMemberDomainGrants.companyId, auth.companyId),
            eq(companyMemberDomainGrants.userId, body.userId),
            eq(companyMemberDomainGrants.status, "active"),
          ),
        );

      if (nextGrants.length > 0) {
        await tx.insert(companyMemberDomainGrants).values(
          nextGrants.map((grant) => ({
            companyId: auth.companyId,
            userId: body.userId,
            domain: grant.domain,
            accessLevel: grant.accessLevel,
            source: body.source,
            approvedByUserId: auth.userId,
            approvedAt: now,
          })),
        );
      }

      await tx.insert(auditLog).values({
        companyId: auth.companyId,
        userId: auth.userId,
        action: "company_domain_grants_update",
        entityType: "company_member_domain_grants",
        oldValue: oldGrants,
        newValue: nextGrants,
        details: {
          targetUserId: body.userId,
          reason: body.reason,
          source: body.source,
        },
      });
    });

    return NextResponse.json({
      companyId: auth.companyId,
      userId: body.userId,
      grants: nextGrants,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid company domain grant payload", issues: err.issues },
        { status: 400 },
      );
    }
    return handleApiError(err);
  }
}
