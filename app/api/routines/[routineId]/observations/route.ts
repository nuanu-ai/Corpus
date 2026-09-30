import { NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { requireRoutineDomainAccess } from "@/lib/routines/api-access";
import {
  getCompanyRoutine,
  listRoutineObservations,
} from "@/lib/routines/store";

function compactObservationMetadata(metadata: Record<string, unknown>) {
  return {
    ...(typeof metadata.contentType === "string" ? { contentType: metadata.contentType } : {}),
    ...(typeof metadata.provider === "string" ? { provider: metadata.provider } : {}),
    ...(typeof metadata.error === "string" ? { error: metadata.error.slice(0, 500) } : {}),
  };
}

function serializeObservation(observation: Awaited<ReturnType<typeof listRoutineObservations>>[number]) {
  return {
    ...observation,
    metadata: compactObservationMetadata(observation.metadata ?? {}),
    sourceDate: observation.sourceDate?.toISOString() ?? null,
    fetchedAt: observation.fetchedAt.toISOString(),
    createdAt: observation.createdAt.toISOString(),
    updatedAt: observation.updatedAt.toISOString(),
  };
}

export async function GET(
  req: Request,
  context: { params: Promise<{ routineId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "read");

    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const routineRunId = url.searchParams.get("runId") ?? url.searchParams.get("run_id");
    const observations = await listRoutineObservations({
      companyId: auth.companyId,
      routineId,
      routineRunId,
      limit: Number.isFinite(limit) ? limit : 50,
    });

    return NextResponse.json({
      observations: observations.map(serializeObservation),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
