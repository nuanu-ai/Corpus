import { inngest } from "@/lib/inngest";
import { executeReportAutomationRun } from "@/lib/routines/report-runner";
import { ROUTINE_REPORT_RUN_EVENT } from "@/lib/routines/types";

export const runReportAutomationFn = inngest.createFunction(
  {
    id: "report-automation-run",
    concurrency: [{ key: "event.data.routineId", limit: 1 }],
  },
  { event: ROUTINE_REPORT_RUN_EVENT },
  async ({ event, step }) => {
    const data = event.data as {
      companyId: string;
      routineId: string;
      runId: string;
      requestedByUserId?: string | null;
    };

    return step.run("execute-report-automation-run", async () =>
      executeReportAutomationRun({
        companyId: data.companyId,
        routineId: data.routineId,
        runId: data.runId,
        requestedByUserId: data.requestedByUserId,
      }),
    );
  },
);
