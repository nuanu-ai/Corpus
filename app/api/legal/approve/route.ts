/**
 * POST /api/legal/approve — resolve a legal comparison approval gate.
 * Body: { artifactId, threadId, approved: boolean }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { resolveLegalApproval } from "@/lib/legal/approval";

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthContext();
    const { companyId, userId } = auth;
    const body = (await req.json()) as {
      artifactId?: string;
      threadId?: string;
      approved?: boolean;
    };

    if (!body.artifactId || !body.threadId || typeof body.approved !== "boolean") {
      return NextResponse.json(
        { error: "artifactId, threadId, and approved (boolean) are required" },
        { status: 400 },
      );
    }

    const result = await resolveLegalApproval({
      artifactId: body.artifactId,
      threadId: body.threadId,
      companyId,
      approved: body.approved,
      resolvedByUserId: userId,
    });

    return NextResponse.json({
      artifactId: body.artifactId,
      finalStatus: result.finalStatus,
      approved: body.approved,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
