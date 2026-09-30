import { inngest } from "@/lib/inngest";
import { drainOutboxOnce, getOutboxStats, reapSentOutbox } from "@/lib/outbox";

/**
 * Drains the transactional outbox every minute.
 *
 * Runs unconditionally — workload is dominated by the empty-table case
 * (one cheap COUNT-style query). Fan-out per pending row only when there
 * is something to send.
 *
 * If Inngest itself is down, this function obviously cannot run; recovery
 * is automatic when Inngest returns (next tick picks up the still-pending
 * rows). For Inngest-down catastrophes lasting more than a few minutes,
 * the rows are observable in `outbox_events` for ops manual triage.
 *
 * See docs/architecture/document-pipeline-stability.md (Tier A3).
 */
export const drainOutboxCron = inngest.createFunction(
  { id: "drain-outbox", concurrency: 1 },
  { cron: "* * * * *" }, // every minute (Inngest minimum cron granularity)
  async ({ step }) => {
    const result = await step.run("drain", async () => {
      return await drainOutboxOnce();
    });

    if (result.failed > 0) {
      console.warn(
        `[outbox] ${result.failed} events exceeded retry budget and were marked failed`,
      );
    }

    return result;
  },
);

/**
 * Hourly housekeeping: prune sent rows older than 7 days. Keeps the
 * outbox table small without losing recent history for debugging.
 */
export const reapOutboxCron = inngest.createFunction(
  { id: "reap-outbox" },
  { cron: "0 * * * *" }, // top of each hour
  async ({ step }) => {
    const reaped = await step.run("reap", () => reapSentOutbox(7));
    const stats = await step.run("stats", () => getOutboxStats());
    return { reaped, stats };
  },
);
