import { inngest } from "@/lib/inngest";
import {
  reapStaleRoutineRuns,
  scanDueRoutineSchedules,
} from "@/lib/routines/scheduler-runtime";

export const routineSchedulerCron = inngest.createFunction(
  { id: "routine-scheduler", concurrency: 1 },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    return step.run("scan-due-routines", () =>
      scanDueRoutineSchedules({
        enabled: process.env.ROUTINE_SCHEDULER_ENABLED === "1",
      }),
    );
  },
);

export const routineStaleRunReaperCron = inngest.createFunction(
  { id: "routine-stale-run-reaper", concurrency: 1 },
  { cron: "*/30 * * * *" },
  async ({ step }) => {
    return step.run("reap-stale-routine-runs", () =>
      reapStaleRoutineRuns({
        enabled: process.env.ROUTINE_STALE_RUN_REAPER_ENABLED === "1",
      }),
    );
  },
);
