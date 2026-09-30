import { NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { requireRoutineDomainAccess } from "@/lib/routines/api-access";
import {
  getCompanyRoutine,
  listRoutineDigestArtifacts,
} from "@/lib/routines/store";

export async function GET(
  _req: Request,
  context: { params: Promise<{ routineId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine);
    const digests = await listRoutineDigestArtifacts(auth.companyId, routineId);
    return NextResponse.json({ digests });
  } catch (error) {
    return handleApiError(error);
  }
}
