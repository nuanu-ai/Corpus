import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { requireRoutineDomainAccess } from "@/lib/routines/api-access";
import {
  getCompanyRoutine,
  listRoutineCandidates,
} from "@/lib/routines/store";
import type { RoutineCandidateReviewStatus } from "@/lib/routines/types";

const VALID_STATUS = new Set(["pending", "approving", "approved", "rejected", "superseded"]);

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ routineId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine);
    const status = req.nextUrl.searchParams.get("status");
    const candidates = await listRoutineCandidates({
      companyId: auth.companyId,
      routineId,
      status: status && VALID_STATUS.has(status)
        ? (status as RoutineCandidateReviewStatus)
        : undefined,
    });
    return NextResponse.json({ candidates });
  } catch (error) {
    return handleApiError(error);
  }
}
