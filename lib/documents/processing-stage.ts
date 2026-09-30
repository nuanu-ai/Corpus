import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

/**
 * Lifecycle stages for a document inside the ingestion pipeline.
 *
 * Linear in normal operation:
 *   received -> dispatched -> parsing -> parsed
 *
 * Failure: any stage can transition to `failed`. There is no recovery
 * pathway from `failed` today (recovery cron retriggers from the previous
 * stage by re-emitting the Inngest event); a future Tier B state-machine
 * library will formalize this.
 *
 * `committed` is reserved for a future "fully reconciled into Company-DB"
 * signal — not used today; do not write it.
 *
 * See docs/architecture/document-pipeline-stability.md (Tier A1).
 */
export const DOCUMENT_PROCESSING_STAGES = [
  "received",
  "dispatched",
  "parsing",
  "parsed",
  "failed",
  // reserved, not yet emitted by any code path:
  "committed",
] as const;

export type DocumentProcessingStage = (typeof DOCUMENT_PROCESSING_STAGES)[number];

const TERMINAL_STAGES = new Set<DocumentProcessingStage>(["parsed", "failed", "committed"]);

export function isTerminalProcessingStage(stage: DocumentProcessingStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

/**
 * Best-effort write of the new `processing_stage` column.
 *
 * Wrapped in try/catch and logged-on-failure: callers in the async pipeline
 * already update other state in the same step.run, and this column is the
 * NEW source of truth being introduced — losing one write must not roll
 * back the existing JSONB-stage update during the dual-write window.
 *
 * Once observers confirm the column is stable, callers should treat the
 * write as load-bearing and drop the swallow-on-failure here.
 */
export async function setDocumentProcessingStage(
  documentId: string,
  companyId: string,
  stage: DocumentProcessingStage,
): Promise<void> {
  try {
    await db
      .update(documents)
      .set({ processingStage: stage })
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.companyId, companyId),
        ),
      );
  } catch (error) {
    console.warn(
      `[processing-stage] Failed to set ${stage} for document ${documentId}:`,
      error,
    );
  }
}
