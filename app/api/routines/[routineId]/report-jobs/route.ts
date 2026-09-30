import { NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { serializeRoutineReportArtifact, serializeRoutineReportJobs } from "@/lib/report-jobs/routine-api";
import {
  listReportJobsForRoutine,
  summarizeReportArtifactsForRoutine,
} from "@/lib/report-jobs/store";
import { requireRoutineDomainAccess } from "@/lib/routines/api-access";
import { getCompanyRoutine } from "@/lib/routines/store";

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
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const [reportJobs, summary] = await Promise.all([
      listReportJobsForRoutine({
        companyId: auth.companyId,
        routineId,
        limit: Number.isFinite(limit) ? limit : 20,
      }),
      summarizeReportArtifactsForRoutine({
        companyId: auth.companyId,
        routineId,
      }),
    ]);

    return NextResponse.json({
      reportJobs: serializeRoutineReportJobs(reportJobs, routineId),
      summary: {
        pendingArtifactCount: summary.pendingArtifactCount,
        latestArtifact: summary.latestArtifact
          ? serializeRoutineReportArtifact(summary.latestArtifact, routineId)
          : null,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
