import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import {
  getApiKeyCompanyContext,
  handleApiError,
  requireGrantedApiKeyScope,
} from "@/lib/api-auth";
import { db } from "@/lib/db";
import { companyMembers, users } from "@/lib/db/schema";

const MANAGER_ROLES = new Set(["owner", "admin"]);
const ASSIGNABLE_ROLES = new Set([
  "owner",
  "admin",
  "member",
  "viewer",
  "cfo_agent",
  "external_accountant",
  "investor_view",
  "partner_agent",
]);

function canManageMembers(role: string): boolean {
  return MANAGER_ROLES.has(role);
}

function emailEquals(column: typeof users.email, value: string) {
  return sql<boolean>`lower(${column}) = ${value.toLowerCase()}`;
}

export async function GET() {
  try {
    const { apiKey, membership } = await getApiKeyCompanyContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.members.read");

    const members = await db
      .select({
        userId: companyMembers.userId,
        role: companyMembers.role,
        joinedAt: companyMembers.createdAt,
        name: users.name,
        email: users.email,
      })
      .from(companyMembers)
      .innerJoin(users, eq(users.id, companyMembers.userId))
      .where(eq(companyMembers.companyId, membership.companyId));

    return NextResponse.json({
      company: {
        id: membership.companyId,
        name: membership.companyName,
        slug: membership.companySlug,
        role: membership.role,
      },
      members,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, membership } = await getApiKeyCompanyContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.members.manage");

    if (!canManageMembers(membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "member";

    if (!email) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }
    if (!ASSIGNABLE_ROLES.has(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (role === "owner" && membership.role !== "owner") {
      return NextResponse.json(
        { error: "Only owners can assign owner role" },
        { status: 403 },
      );
    }

    const [targetUser] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(emailEquals(users.email, email))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json(
        { error: "Target user not found. The user must register first." },
        { status: 404 },
      );
    }

    const [existing] = await db
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, membership.companyId),
          eq(companyMembers.userId, targetUser.id),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(companyMembers)
        .set({ role })
        .where(eq(companyMembers.id, existing.id));
    } else {
      await db.insert(companyMembers).values({
        companyId: membership.companyId,
        userId: targetUser.id,
        role,
      });
    }

    return NextResponse.json({
      status: "ok",
      member: {
        userId: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        role,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { apiKey, membership } = await getApiKeyCompanyContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.members.manage");

    if (!canManageMembers(membership.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const rawTargetUserId = typeof body.userId === "string" ? body.userId.trim() : "";
    const rawTargetEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    let targetUserId = rawTargetUserId;
    if (!targetUserId && rawTargetEmail) {
      const [targetUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(emailEquals(users.email, rawTargetEmail))
        .limit(1);
      targetUserId = targetUser?.id ?? "";
    }

    if (!targetUserId) {
      return NextResponse.json(
        { error: "userId or email is required" },
        { status: 400 },
      );
    }

    const [targetMembership] = await db
      .select({
        id: companyMembers.id,
        role: companyMembers.role,
      })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, membership.companyId),
          eq(companyMembers.userId, targetUserId),
        ),
      )
      .limit(1);

    if (!targetMembership) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (targetMembership.role === "owner") {
      if (membership.role !== "owner") {
        return NextResponse.json(
          { error: "Only owners can remove owners" },
          { status: 403 },
        );
      }

      const owners = await db
        .select({ id: companyMembers.id })
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.companyId, membership.companyId),
            eq(companyMembers.role, "owner"),
          ),
        );

      if (owners.length <= 1) {
        return NextResponse.json(
          { error: "Cannot remove the last owner from a company" },
          { status: 400 },
        );
      }
    }

    await db.delete(companyMembers).where(eq(companyMembers.id, targetMembership.id));
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    return handleApiError(err);
  }
}
