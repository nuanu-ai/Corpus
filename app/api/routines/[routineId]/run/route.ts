import { NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { enqueueOutboxEvent } from "@/lib/outbox";
import { canRunRoutineNow, requireRoutineDomainAccess } from "@/lib/routines/api-access";
import {
  createOrGetOpenRoutineRun,
  getCompanyRoutine,
  recordRoutineAuditLog,
} from "@/lib/routines/store";
import {
  LEGAL_WATCH_BKPM_TEMPLATE_KEY,
  LEGAL_WATCH_RUN_EVENT,
  ROUTINE_REPORT_RUN_EVENT,
  isReportAutomationTemplateKey,
} from "@/lib/routines/types";
import { getMostRecentDueRoutineScheduleWindow } from "@/lib/routines/scheduler";

function routineRunObservability(routineId: string, runId: string) {
  return {
    runPath: `/api/routines/${routineId}/runs/${runId}`,
    reportJobsPath: `/api/routines/${routineId}/report-jobs`,
    pollAfterMs: 2_000,
  };
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ routineId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "write");
    const isLegalWatch = routine.templateKey === LEGAL_WATCH_BKPM_TEMPLATE_KEY;
    const isReportAutomation = isReportAutomationTemplateKey(routine.templateKey);
    if (!isLegalWatch && !isReportAutomation) {
      return NextResponse.json(
        {
          error: "This automation template can be created and inspected, but its runner is not enabled yet",
        },
        { status: 409 },
      );
    }
    if (isReportAutomation && routine.metadata?.sourcesConfigured !== true) {
      return NextResponse.json(
        { error: "Report automation sources must be configured before it can be run" },
        { status: 409 },
      );
    }
    if (!canRunRoutineNow(routine.status)) {
      return NextResponse.json(
        { error: "Routine must be active or paused before it can be run manually" },
        { status: 409 },
      );
    }
    const reportWindow = isReportAutomation
      ? getMostRecentDueRoutineScheduleWindow(routine.schedulePolicy, new Date())
      : null;
    const { run, created } = await createOrGetOpenRoutineRun({
      companyId: auth.companyId,
      routineId,
      trigger: "manual",
      windowStart: reportWindow?.windowStart ?? null,
      windowEnd: reportWindow?.windowEnd ?? null,
      afterCreate: async (tx, run) => {
        await enqueueOutboxEvent(tx, {
          name: isReportAutomation ? ROUTINE_REPORT_RUN_EVENT : LEGAL_WATCH_RUN_EVENT,
          data: {
            companyId: auth.companyId,
            routineId,
            runId: run.id,
            trigger: "manual",
            requestedByUserId: auth.userId,
            ...(reportWindow
              ? {
                  windowStart: reportWindow.windowStart.toISOString(),
                  windowEnd: reportWindow.windowEnd.toISOString(),
                  periodKey: reportWindow.periodKey,
                }
              : {}),
          },
        });
      },
    });
    if (!created) {
      return NextResponse.json({
        run,
        existing: true,
        observability: routineRunObservability(routineId, run.id),
      });
    }
    await recordRoutineAuditLog({
      companyId: auth.companyId,
      userId: auth.userId,
      action: "routine_run_requested",
      entityType: "routine_run",
      entityId: run.id,
      newValue: {
        status: run.status,
        trigger: "manual",
        windowStart: reportWindow?.windowStart.toISOString() ?? null,
        windowEnd: reportWindow?.windowEnd.toISOString() ?? null,
      },
      details: {
        routineId,
        templateKey: routine.templateKey,
      },
    });
    return NextResponse.json(
      { run, existing: false, observability: routineRunObservability(routineId, run.id) },
      { status: 202 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
