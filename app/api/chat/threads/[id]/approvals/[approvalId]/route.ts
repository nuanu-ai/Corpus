import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { resolveChatApprovalDecision } from "@/lib/consultant/chat-approval-resolution";
import { db } from "@/lib/db";
import { chatThreads } from "@/lib/db/schema";

const patchApprovalSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; approvalId: string }> },
) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const { id, approvalId } = await params;

    const body = await req.json().catch(() => null);
    const parsed = patchApprovalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid approval status payload" }, { status: 400 });
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

    const approval = await resolveChatApprovalDecision({
      threadId: id,
      approvalId,
      companyId,
      userId,
      status: parsed.data.status,
    });

    if (!approval) {
      return NextResponse.json({ error: "Approval not found" }, { status: 404 });
    }

    return NextResponse.json(approval);
  } catch (err) {
    return handleApiError(err);
  }
}
