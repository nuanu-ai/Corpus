import { inngest } from "@/lib/inngest";
import {
  listFilteredPendingCommunicationBatches,
  processCommunicationBatch,
} from "@/lib/communications/process-pending";

export const dailyCommunicationsSynthesis = inngest.createFunction(
  { id: "daily-communications-synthesis" },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const batches = await step.run("list-pending-communication-batches", async () => {
      return listFilteredPendingCommunicationBatches({ limit: 20 });
    });

    const results: Array<Record<string, unknown>> = [];
    for (const batch of batches) {
      const result = await step.run(
        `synthesize-${batch.companyId}-${batch.provider}-${batch.providerThreadId}-${batch.dayKey}`,
        async () => processCommunicationBatch(batch),
      );
      results.push(result);
    }

    return {
      processedBatches: results.length,
      results,
    };
  },
);

export const communicationsSynthesisRequested = inngest.createFunction(
  {
    id: "communications-synthesis-requested",
    concurrency: [{ key: "event.data.companyId", limit: 1 }],
  },
  { event: "communications/synthesis.requested" },
  async ({ event, step }) => {
    const data = event.data as {
      companyId: string;
      provider?: string;
      limit?: number;
    };

    const batches = await step.run("list-filtered-pending-communication-batches", async () => {
      return listFilteredPendingCommunicationBatches({
        companyId: data.companyId,
        provider: data.provider,
        limit: data.limit ?? 25,
      });
    });

    const results: Array<Record<string, unknown>> = [];
    for (const batch of batches) {
      const result = await step.run(
        `synthesize-on-demand-${batch.companyId}-${batch.provider}-${batch.providerThreadId}-${batch.dayKey}`,
        async () => processCommunicationBatch(batch),
      );
      results.push(result);
    }

    return {
      processedBatches: results.length,
      results,
    };
  },
);
