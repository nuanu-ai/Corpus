import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { chatApprovals, chatArtifacts, chatThreads } from "@/lib/db/schema";

const createApprovalSchema = z.object({
  artifactId: z.string().uuid(),
  action: z.string().trim().min(1).max(120),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const { id } = await params;

    const [thread] = await db
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.id, id),
          eq(chatThreads.companyId, companyId),
          eq(chatThreads.userId, userId),
        ),
      )
      .limit(1);

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const approvals = await db
      .select({
        id: chatApprovals.id,
        artifactId: chatApprovals.artifactId,
        action: chatApprovals.action,
        status: chatApprovals.status,
        payload: chatApprovals.payload,
        requestedBy: chatApprovals.requestedBy,
        approvedBy: chatApprovals.approvedBy,
        resolvedAt: chatApprovals.resolvedAt,
        createdAt: chatApprovals.createdAt,
        updatedAt: chatApprovals.updatedAt,
      })
      .from(chatApprovals)
      .where(
        and(
          eq(chatApprovals.threadId, id),
          eq(chatApprovals.companyId, companyId),
        ),
      )
      .orderBy(desc(chatApprovals.createdAt));

    return NextResponse.json(
      approvals.map((approval) => ({
        ...approval,
        resolvedAt: approval.resolvedAt?.toISOString() ?? null,
        createdAt: approval.createdAt.toISOString(),
        updatedAt: approval.updatedAt.toISOString(),
      })),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const { id } = await params;

    const body = await req.json().catch(() => null);
    const parsed = createApprovalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid approval payload" }, { status: 400 });
    }

    const [thread] = await db
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.id, id),
          eq(chatThreads.companyId, companyId),
          eq(chatThreads.userId, userId),
        ),
      )
      .limit(1);

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const [artifact] = await db
      .select({
        id: chatArtifacts.id,
      })
      .from(chatArtifacts)
      .where(
        and(
          eq(chatArtifacts.id, parsed.data.artifactId),
          eq(chatArtifacts.threadId, id),
          eq(chatArtifacts.companyId, companyId),
        ),
      )
      .limit(1);

    if (!artifact) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const [approval] = await db.transaction(async (tx) => {
      await tx
        .update(chatArtifacts)
        .set({
          status: "pending_approval",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(chatArtifacts.id, artifact.id),
            eq(chatArtifacts.threadId, id),
            eq(chatArtifacts.companyId, companyId),
          ),
        );

      const [createdApproval] = await tx
        .insert(chatApprovals)
        .values({
          threadId: id,
          companyId,
          artifactId: artifact.id,
          action: parsed.data.action,
          status: "pending",
          requestedBy: userId,
          payload: parsed.data.payload ?? {},
        })
        .returning({
          id: chatApprovals.id,
          artifactId: chatApprovals.artifactId,
          action: chatApprovals.action,
          status: chatApprovals.status,
          payload: chatApprovals.payload,
          requestedBy: chatApprovals.requestedBy,
          approvedBy: chatApprovals.approvedBy,
          resolvedAt: chatApprovals.resolvedAt,
          createdAt: chatApprovals.createdAt,
          updatedAt: chatApprovals.updatedAt,
        });

      return [createdApproval] as const;
    });

    return NextResponse.json(
      {
        ...approval,
        resolvedAt: approval.resolvedAt?.toISOString() ?? null,
        createdAt: approval.createdAt.toISOString(),
        updatedAt: approval.updatedAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
