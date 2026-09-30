import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { rawEvents } from "@/lib/db/schema";
import { createRoutineObservation } from "@/lib/routines/store";
import type { RoutineObservationChangeKind, RoutineSourceFetchResult } from "@/lib/routines/types";

export function buildLegalWatchIdempotencyKey(input: {
  routineSlug: string;
  sourceKey: string;
  contentHash: string;
}): string {
  return `routine:${input.routineSlug}:source:${input.sourceKey}:hash:${input.contentHash}`;
}

export async function persistLegalWatchEvidence(input: {
  companyId: string;
  routineSlug: string;
  runId: string;
  sourceId: string;
  result: RoutineSourceFetchResult;
  changeKind: RoutineObservationChangeKind;
}) {
  const rawEventIdempotencyKey = buildLegalWatchIdempotencyKey({
    routineSlug: input.routineSlug,
    sourceKey: input.result.sourceKey,
    contentHash: input.result.contentHash,
  });
  const observationIdempotencyKey =
    `routine-run:${input.runId}:source:${input.result.sourceKey}:hash:${input.result.contentHash}`;

  const [existingRawEvent] = await db
    .select({ id: rawEvents.id })
    .from(rawEvents)
    .where(and(eq(rawEvents.companyId, input.companyId), eq(rawEvents.idempotencyKey, rawEventIdempotencyKey)))
    .limit(1);

  let rawEventId = existingRawEvent?.id ?? null;
  if (!rawEventId) {
    const [rawEvent] = await db
      .insert(rawEvents)
      .values({
        companyId: input.companyId,
        sourceEventId: `${input.result.sourceKey}:${input.result.contentHash}`,
        idempotencyKey: rawEventIdempotencyKey,
        source: "routine_watch",
        eventType: "legal_watch_observation",
        rawPayload: {
          ...input.result.rawSnapshot,
          title: input.result.title,
          canonicalUrl: input.result.canonicalUrl,
          sourceDate: input.result.sourceDate,
          fetchedAt: input.result.fetchedAt,
          bodyPreview: input.result.bodyText.slice(0, 4000),
        },
      })
      .returning({ id: rawEvents.id });
    rawEventId = rawEvent?.id ?? null;
  }

  const observation = await createRoutineObservation({
    routineRunId: input.runId,
    routineSourceId: input.sourceId,
    companyId: input.companyId,
    sourceEventId: `${input.result.sourceKey}:${input.result.contentHash}`,
    idempotencyKey: observationIdempotencyKey,
    contentHash: input.result.contentHash,
    canonicalUrl: input.result.canonicalUrl,
    sourceTitle: input.result.title,
    sourceDate: input.result.sourceDate ? new Date(input.result.sourceDate) : null,
    fetchedAt: new Date(input.result.fetchedAt),
    rawEventId,
    snapshotRef: rawEventId ? `raw_events:${rawEventId}` : null,
    changeKind: input.changeKind,
    metadata: {
      contentType: input.result.contentType,
      rawSnapshot: input.result.rawSnapshot,
    },
  });

  return { rawEventId, observation, idempotencyKey: observationIdempotencyKey, rawEventIdempotencyKey };
}
