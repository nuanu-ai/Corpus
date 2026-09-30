import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import {
  buildDocumentIngressEvent,
  buildSimplifiedNarrativeShadowEvent,
} from "@/lib/inngest/document-ingress-events";
import { enqueueOutboxEvent } from "@/lib/outbox";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { triggerReconciliationForCompany } from "@/lib/workers/reconciliation-trigger";

const VALID_ACTIONS = new Set(["approve", "reject", "requeue"]);

/**
 * POST /api/documents/[id]/review
 *
 * Review a document that is in "needs_review" status.
 * Actions:
 *   approve — creates staging records from stored report data, marks completed
 *   reject  — marks rejected
 *   requeue — resets to processing and re-emits Inngest event
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.write");
    const { companyId } = auth;
    const { id } = await params;

    const body = await req.json();
    const { action } = body;

    if (!action || !VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${[...VALID_ACTIONS].join(", ")}` },
        { status: 400 },
      );
    }

    // Fetch the document — must exist and belong to this company
    const [doc] = await db
      .select({
        id: documents.id,
        status: documents.status,
        fileType: documents.fileType,
        storageUrl: documents.storageUrl,
        documentType: documents.documentType,
      })
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.companyId, companyId)));

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    if (doc.status !== "needs_review") {
      return NextResponse.json(
        { error: `Document is not in needs_review status (current: ${doc.status})` },
        { status: 409 },
      );
    }

    switch (action) {
      case "approve": {
        if (doc.documentType) {
          try {
            const companySlug = await getCompanySlug(companyId);

            // Check if there are already report staging records for this document.
            const existing = await db.execute<{ cnt: number; open_cnt: number }>(sql`
              SELECT
                COUNT(*)::int as cnt,
                COUNT(*) FILTER (WHERE status <> 'committed')::int as open_cnt
              FROM staging_records
              WHERE company_slug = ${companySlug}
                AND source LIKE 'report-import:%'
                AND payload->>'documentId' = ${id}
            `);
            const stats = existing[0] ?? { cnt: 0, open_cnt: 0 };

            // No staging exists yet: move back to processing and re-run the
            // approved document so process-document can create staging records
            // and immediately reconcile them.
            if (stats.cnt === 0) {
              await db.transaction(async (tx) => {
                await tx
                  .update(documents)
                  .set({ status: "processing", error: null })
                  .where(and(eq(documents.id, id), eq(documents.companyId, companyId)));

                await enqueueOutboxEvent(
                  tx,
                  buildDocumentIngressEvent({
                    documentId: id,
                    companyId,
                    fileType: doc.fileType,
                    storageKey: doc.storageUrl,
                    approved: true, // bypass needsReview skip in staging
                    reprocess: true,
                  }),
                );
                const shadowEvent = buildSimplifiedNarrativeShadowEvent({
                  documentId: id,
                  companyId,
                  fileType: doc.fileType,
                  storageKey: doc.storageUrl,
                  reprocess: true,
                });
                if (shadowEvent) {
                  await enqueueOutboxEvent(tx, shadowEvent);
                }
              });
              break;
            }

            // Staging already exists. Keep the document completed and try to
            // flush any open records through reconciliation immediately.
            await db
              .update(documents)
              .set({ status: "completed", error: null })
              .where(and(eq(documents.id, id), eq(documents.companyId, companyId)));

            if (stats.open_cnt > 0) {
              try {
                await triggerReconciliationForCompany(companySlug);
              } catch (error) {
                console.error(
                  `[document-review] Failed to reconcile approved document ${id}:`,
                  error,
                );
              }
            }

            break;
          } catch (error) {
            console.error(`[document-review] Failed to approve document ${id}:`, error);
            return NextResponse.json(
              { error: "Failed to approve document" },
              { status: 500 },
            );
          }
        }

        await db
          .update(documents)
          .set({ status: "completed", error: null })
          .where(and(eq(documents.id, id), eq(documents.companyId, companyId)));
        break;
      }

      case "reject": {
        await db
          .update(documents)
          .set({ status: "rejected" })
          .where(and(eq(documents.id, id), eq(documents.companyId, companyId)));
        break;
      }

      case "requeue": {
        await db.transaction(async (tx) => {
          await tx
            .update(documents)
            .set({ status: "processing", error: null })
            .where(and(eq(documents.id, id), eq(documents.companyId, companyId)));

          await enqueueOutboxEvent(
            tx,
            buildDocumentIngressEvent({
              documentId: id,
              companyId,
              fileType: doc.fileType,
              storageKey: doc.storageUrl,
            }),
          );
          const shadowEvent = buildSimplifiedNarrativeShadowEvent({
            documentId: id,
            companyId,
            fileType: doc.fileType,
            storageKey: doc.storageUrl,
          });
          if (shadowEvent) {
            await enqueueOutboxEvent(tx, shadowEvent);
          }
        });
        break;
      }
    }

    return NextResponse.json({ status: "ok", action });
  } catch (err) {
    return handleApiError(err);
  }
}
