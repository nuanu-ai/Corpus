import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import { canRunRoutineNow, requireRoutineDomainAccess } from "@/lib/routines/api-access";
import { getCompanyRoutine, recordRoutineAuditLog } from "@/lib/routines/store";
import {
  getMostRecentDueRoutineScheduleWindow,
  parseRoutineScheduleBoundary,
} from "@/lib/routines/scheduler";
import { enqueueRoutineBackfillRuns } from "@/lib/routines/scheduler-runtime";
import { isReportAutomationTemplateKey } from "@/lib/routines/types";

const backfillRequestSchema = z.object({
  windowStart: z.string().trim().min(1).optional(),
  windowEnd: z.string().trim().min(1).optional(),
  latestDue: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  confirm: z.boolean().optional(),
  maxWindowCount: z.number().int().min(1).max(366).optional(),
}).strict();

function parseBackfillBoundary(policy: unknown, value: string, label: string): Date {
  const date = parseRoutineScheduleBoundary(policy, value);
  if (!date) {
    throw new Error(`${label} must be a valid ISO datetime or local schedule date`);
  }
  return date;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ routineId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "write");
    if (!isReportAutomationTemplateKey(routine.templateKey)) {
      return NextResponse.json(
        { error: "Backfill is enabled for report automation templates only" },
        { status: 409 },
      );
    }
    if (!canRunRoutineNow(routine.status)) {
      return NextResponse.json(
        { error: "Routine must be active or paused before it can be backfilled" },
        { status: 409 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const parsed = backfillRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid backfill request" },
        { status: 400 },
      );
    }

    let windowStart: Date;
    let windowEnd: Date;
    if (parsed.data.latestDue === true) {
      const latest = getMostRecentDueRoutineScheduleWindow(routine.schedulePolicy, new Date());
      if (!latest) {
        return NextResponse.json(
          { error: "Routine schedule has no recurring due window to backfill" },
          { status: 400 },
        );
      }
      windowStart = latest.windowStart;
      windowEnd = latest.windowEnd;
    } else {
      if (!parsed.data.windowStart || !parsed.data.windowEnd) {
        return NextResponse.json(
          { error: "Provide windowStart and windowEnd, or latestDue=true" },
          { status: 400 },
        );
      }
      windowStart = parseBackfillBoundary(routine.schedulePolicy, parsed.data.windowStart, "windowStart");
      windowEnd = parseBackfillBoundary(routine.schedulePolicy, parsed.data.windowEnd, "windowEnd");
    }

    const result = await enqueueRoutineBackfillRuns({
      routine,
      windowStart,
      windowEnd,
      dryRun: parsed.data.dryRun,
      confirm: parsed.data.confirm,
      requestedByUserId: auth.userId,
      maxWindowCount: parsed.data.maxWindowCount,
    });
    if (!result.ok && result.windows.length === 0) {
      return NextResponse.json({ error: result.error ?? "Backfill request failed", result }, { status: 400 });
    }
    if (!result.dryRun && result.ok) {
      await recordRoutineAuditLog({
        companyId: auth.companyId,
        userId: auth.userId,
        action: "routine_backfill_requested",
        entityType: "routine_definition",
        entityId: routineId,
        newValue: {
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          maxWindowCount: parsed.data.maxWindowCount ?? null,
        },
        details: {
          queuedWindowCount: result.windows.filter((window) => window.action === "queued").length,
          skippedWindowCount: result.windows.filter((window) => window.action !== "queued").length,
          latestDue: parsed.data.latestDue === true,
        },
      });
    }
    return NextResponse.json({ result }, { status: result.dryRun ? 200 : 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
