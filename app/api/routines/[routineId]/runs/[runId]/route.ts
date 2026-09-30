import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { serializeRoutineReportJobs } from "@/lib/report-jobs/routine-api";
import {
  cancelReportJobsForRoutineRun,
  listReportJobsForRoutine,
} from "@/lib/report-jobs/store";
import { requireRoutineDomainAccess } from "@/lib/routines/api-access";
import {
  cancelRoutineRun,
  getCompanyRoutine,
  getRoutineRun,
  recordRoutineAuditLog,
} from "@/lib/routines/store";
import { isReportAutomationTemplateKey } from "@/lib/routines/types";

const patchRunSchema = z.object({
  action: z.literal("cancel"),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ routineId: string; runId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId, runId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "read");

    const run = await getRoutineRun({
      companyId: auth.companyId,
      routineId,
      runId,
    });
    if (!run) return NextResponse.json({ error: "Routine run not found" }, { status: 404 });

    const reportJobs = isReportAutomationTemplateKey(routine.templateKey)
      ? await listReportJobsForRoutine({
          companyId: auth.companyId,
          routineId,
          routineRunId: runId,
          limit: 20,
        })
      : [];

    return NextResponse.json({
      run,
      reportJobs: serializeRoutineReportJobs(reportJobs, routineId),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ routineId: string; runId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId, runId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "write");

    const body = await req.json().catch(() => ({}));
    const parsed = patchRunSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid run action" },
        { status: 400 },
      );
    }

    const run = await cancelRoutineRun({
      companyId: auth.companyId,
      routineId,
      runId,
      reason: parsed.data.reason,
      cancelledByUserId: auth.userId,
    });
    if (!run) return NextResponse.json({ error: "Routine run not found" }, { status: 404 });
    const didCancelRun = run.status === "cancelled";
    if (didCancelRun) {
      await recordRoutineAuditLog({
        companyId: auth.companyId,
        userId: auth.userId,
        action: "routine_run_cancelled",
        entityType: "routine_run",
        entityId: runId,
        newValue: {
          status: run.status,
          error: run.error ?? null,
        },
        details: {
          routineId,
          reason: parsed.data.reason ?? null,
        },
      });
    }

    const cancelledReportJobs = didCancelRun && isReportAutomationTemplateKey(routine.templateKey)
      ? await cancelReportJobsForRoutineRun({
          companyId: auth.companyId,
          routineRunId: runId,
          reason: "The parent routine run was cancelled.",
        })
      : [];

    return NextResponse.json({
      run,
      cancelledReportJobCount: cancelledReportJobs.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
