import { inngest } from "@/lib/inngest";
import { executeReportJob } from "@/lib/report-jobs/executor";

export const executeReportJobFn = inngest.createFunction(
  {
    id: "execute-report-job",
    concurrency: [{ key: "event.data.jobId", limit: 1 }],
  },
  { event: "report-job/requested" },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: string };

    return step.run("execute-report-job", async () => executeReportJob(jobId));
  },
);
