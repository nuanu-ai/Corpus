import { inngest } from "@/lib/inngest";
import { executeLegalWatchRunWithFailureBoundary } from "@/lib/routines/legal-watch/run";
import { LEGAL_WATCH_RUN_EVENT } from "@/lib/routines/types";

export const runLegalWatchFn = inngest.createFunction(
  {
    id: "legal-watch-run",
    concurrency: [{ key: "event.data.routineId", limit: 1 }],
  },
  { event: LEGAL_WATCH_RUN_EVENT },
  async ({ event, step }) => {
    const data = event.data as {
      companyId: string;
      routineId: string;
      runId: string;
    };

    return step.run("execute-legal-watch-run", async () =>
      executeLegalWatchRunWithFailureBoundary({
        companyId: data.companyId,
        routineId: data.routineId,
        runId: data.runId,
      }),
    );
  },
);
