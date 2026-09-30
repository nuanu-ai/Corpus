import { NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { requireRoutineDomainAccess } from "@/lib/routines/api-access";
import {
  describeRoutineScheduleStatus,
  type RoutineScheduleWindow,
} from "@/lib/routines/scheduler";
import {
  getActiveScheduledRoutineRun,
  getCompanyRoutine,
} from "@/lib/routines/store";

function serializeWindow(window: RoutineScheduleWindow | null | undefined) {
  if (!window) return null;
  return {
    cadence: window.cadence,
    timezone: window.timezone,
    periodKey: window.periodKey,
    windowStart: window.windowStart.toISOString(),
    windowEnd: window.windowEnd.toISOString(),
    dueAt: window.dueAt.toISOString(),
  };
}

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

    const activeScheduledRun = await getActiveScheduledRoutineRun({
      companyId: auth.companyId,
      routineId,
    });
    const now = new Date();
    const status = describeRoutineScheduleStatus({
      routineId,
      routineStatus: routine.status,
      schedulePolicy: routine.schedulePolicy,
      now,
      globalSchedulerEnabled: process.env.ROUTINE_SCHEDULER_ENABLED === "1",
      hasActiveScheduledRun: Boolean(activeScheduledRun),
    });

    return NextResponse.json({
      schedule: {
        cadence: status.cadence,
        timezone: status.timezone,
        schedulerEnabled: status.schedulerEnabled,
        globalSchedulerEnabled: status.globalSchedulerEnabled,
        runnable: status.runnable,
        currentWindow: serializeWindow(status.currentWindow),
        latestDueWindow: serializeWindow(status.latestDueWindow),
        nextDueWindow: serializeWindow(status.nextDueWindow),
        decision: {
          action: status.decision.action,
          reason: "reason" in status.decision ? status.decision.reason : null,
          idempotencyKey: "idempotencyKey" in status.decision ? status.decision.idempotencyKey : null,
          window: "window" in status.decision ? serializeWindow(status.decision.window) : null,
        },
        blockingRun: activeScheduledRun
          ? {
              id: activeScheduledRun.id,
              trigger: activeScheduledRun.trigger,
              status: activeScheduledRun.status,
              windowStart: activeScheduledRun.windowStart?.toISOString() ?? null,
              windowEnd: activeScheduledRun.windowEnd?.toISOString() ?? null,
              createdAt: activeScheduledRun.createdAt.toISOString(),
              updatedAt: activeScheduledRun.updatedAt.toISOString(),
            }
          : null,
        checkedAt: now.toISOString(),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
