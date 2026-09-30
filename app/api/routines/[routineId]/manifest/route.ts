import { NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { requireRoutineDomainAccess } from "@/lib/routines/api-access";
import { buildAutomationManifestV1 } from "@/lib/routines/manifest";
import {
  getCompanyRoutine,
  listRoutineSources,
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
    requireRoutineDomainAccess(auth, routine, "read");
    const sources = await listRoutineSources(auth.companyId, routineId);
    const manifest = buildAutomationManifestV1({ routine, sources });
    return NextResponse.json({ manifest });
  } catch (error) {
    return handleApiError(error);
  }
}
