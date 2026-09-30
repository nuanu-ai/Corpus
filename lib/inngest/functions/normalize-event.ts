import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { canonicalTxns } from "@/lib/db/schema";
import { normalizeRawEvent } from "@/lib/normalization";
import { buildCanonicalTxnWriteValues } from "@/lib/canonical-txns";

/**
 * Event-driven normalization pipeline.
 * Triggered when a raw event is created and needs normalization.
 * Creates a canonical transaction from the normalized data.
 */
export const normalizeRawEventFn = inngest.createFunction(
  {
    id: "normalize-raw-event",
    concurrency: [{ key: "event.data.rawEventId", limit: 1 }],
  },
  { event: "raw-event/created" },
  async ({ event, step }) => {
    const { rawEventId, companyId, connectionId, source, eventType, rawPayload } = event.data as {
      rawEventId: string;
      companyId: string;
      connectionId: string | null;
      source: string;
      eventType: string;
      rawPayload: Record<string, unknown>;
    };

    // Step 1: Normalize the raw event
    const normalized = await step.run("normalize", async () => {
      const result = normalizeRawEvent(source, eventType, rawPayload);
      if (!result) return null;

      // Serialize Date for Inngest JSON transport
      return {
        ...result,
        date: result.date.toISOString(),
      };
    });

    if (!normalized) {
      return { rawEventId, status: "skipped", reason: "unknown source or unnormalizable event" };
    }

    // Step 2: Create canonical transaction
    await step.run("create-canonical-txn", async () => {
      await db.insert(canonicalTxns).values(await buildCanonicalTxnWriteValues({
        companyId,
        rawEventId,
        connectionId,
        date: new Date(normalized.date),
        amount: normalized.amount,
        currency: normalized.currency,
        description: normalized.description,
        merchantName: normalized.merchantName,
        merchantMcc: normalized.merchantMcc,
        sourceRef: normalized.sourceRef,
        type: normalized.type,
        status: normalized.status,
        metadata: normalized.metadata,
      }));
    });

    // Step 3: Fire downstream events for categorization + dedup
    await step.sendEvent("fire-downstream", [
      {
        name: "canonical-txn/created",
        data: {
          companyId,
          rawEventId,
          sourceRef: normalized.sourceRef,
          merchantName: normalized.merchantName,
          merchantMcc: normalized.merchantMcc ?? null,
          description: normalized.description,
          amount: normalized.amount,
          currency: normalized.currency,
          type: normalized.type,
        },
      },
    ]);

    return { rawEventId, status: "normalized" };
  }
);
