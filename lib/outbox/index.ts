import { and, asc, eq, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { outboxEvents } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest";

/**
 * Transactional outbox helper for Inngest events.
 *
 * Use `enqueueOutboxEvent(tx, ...)` inside a DB transaction to durably
 * record an event you would otherwise have sent via `inngest.send()`
 * directly. The drain function (Inngest cron) ships them.
 *
 * If you call `enqueueOutboxEvent(db, ...)` outside a transaction, the
 * write is still durable; you just lose the atomicity guarantee that
 * makes outboxes useful in the first place.
 */
export type OutboxExecutor = Pick<typeof db, "insert">;

const MAX_DRAIN_BATCH = 50;
const MAX_ATTEMPTS = 8;

export async function enqueueOutboxEvent(
  executor: OutboxExecutor,
  event: { name: string; data: Record<string, unknown> },
): Promise<void> {
  await executor.insert(outboxEvents).values({
    eventName: event.name,
    eventData: event.data,
  });
}

/**
 * Drain up to MAX_DRAIN_BATCH pending events. Sends one Inngest call per
 * row (the AI SDK accepts batches but per-row preserves per-event retry
 * accounting). Failures bump attempts; rows past MAX_ATTEMPTS are marked
 * 'failed' so they stop blocking the queue head.
 */
export async function drainOutboxOnce(): Promise<{ sent: number; failed: number }> {
  const pending = await db
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.status, "pending"))
    .orderBy(asc(outboxEvents.createdAt))
    .limit(MAX_DRAIN_BATCH);

  let sent = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      await inngest.send({ name: row.eventName, data: row.eventData });
      await db
        .update(outboxEvents)
        .set({
          status: "sent",
          processedAt: new Date(),
          attempts: row.attempts + 1,
          lastError: null,
        })
        .where(eq(outboxEvents.id, row.id));
      sent += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const nextAttempts = row.attempts + 1;
      const nextStatus = nextAttempts >= MAX_ATTEMPTS ? "failed" : "pending";
      await db
        .update(outboxEvents)
        .set({
          status: nextStatus,
          attempts: nextAttempts,
          lastError: msg,
          // processedAt set only on terminal status so retries reorder by createdAt
          processedAt: nextStatus === "failed" ? new Date() : null,
        })
        .where(eq(outboxEvents.id, row.id));
      if (nextStatus === "failed") failed += 1;
    }
  }

  return { sent, failed };
}

/**
 * Reaper for sent rows older than 7 days. Optional housekeeping; the
 * unique selling point of an outbox is observability, but old 'sent'
 * rows just bloat the table.
 */
export async function reapSentOutbox(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await db
    .delete(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, "sent"),
        lt(outboxEvents.processedAt, cutoff),
      ),
    )
    .returning({ id: outboxEvents.id });
  return result.length;
}

/** Diagnostic: counts by status. */
export async function getOutboxStats(): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: outboxEvents.status,
      count: sql<number>`count(*)::int`,
    })
    .from(outboxEvents)
    .groupBy(outboxEvents.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}
