import { and, eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { resolveCompanyCodexWorkerPool } from "@/lib/codex-worker/pool";
import { mergeCodexPreprocessState } from "@/lib/codex-worker/status";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { auditLog, documents } from "@/lib/db/schema";
import { extractKnowledgeText } from "@/lib/document-parsers/knowledge-extractor";
import { extractUnstructuredText } from "@/lib/document-parsers/unstructured-text";
import { getCodexSourceContext } from "@/lib/codex-worker/source-context";
import { normalizeOcrResult } from "@/lib/codex-worker/ocr-result";
import { resolveDocumentProcessingStrategy } from "@/lib/inngest/document-processing-strategy";
import { loadDocumentFileBuffer } from "@/lib/inngest/document-file-loader";

type IngressDispatchStage = "queued" | "running" | "completed" | "failed";

interface IngressDispatchState {
  stage: IngressDispatchStage;
  processing_strategy?: string;
  dispatch_target?: string;
  dispatch_event?: string | null;
  routing_confidence?: number | null;
  extraction_confidence?: number | null;
  ocr_needed?: boolean;
  table_density?: string | null;
  language?: string | null;
  reasons?: string[];
  error?: string | null;
  updated_at?: string;
}

function mergeIngressDispatchState(
  ocrResult: unknown,
  patch: IngressDispatchState,
): Record<string, unknown> {
  return {
    ...(normalizeOcrResult(ocrResult) ?? {}),
    ingress_dispatch: {
      ...(((normalizeOcrResult(ocrResult) ?? {}).ingress_dispatch as Record<string, unknown>) ?? {}),
      ...patch,
    },
  };
}

export const dispatchDocumentProcessing = inngest.createFunction(
  {
    id: "dispatch-document-processing",
    concurrency: [{ key: "event.data.documentId", limit: 1 }],
  },
  { event: "document/ingress-received" },
  async ({ event, step }) => {
    const { documentId, companyId, storageKey } = event.data as {
      documentId: string;
      companyId: string;
      storageKey?: string;
    };
    let existingOcrResult: unknown = undefined;
    let loadedDocument:
      | {
          fileName: string;
          fileType: string;
        }
      | undefined;

    try {
      const doc = await step.run("load-document-metadata", async () => {
        const [row] = await db
          .select({
            id: documents.id,
            fileName: documents.fileName,
            fileType: documents.fileType,
            status: documents.status,
            storageUrl: documents.storageUrl,
            ocrResult: documents.ocrResult,
          })
          .from(documents)
          .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));

        if (!row) throw new Error(`Document ${documentId} not found`);
        loadedDocument = {
          fileName: row.fileName,
          fileType: row.fileType,
        };
        existingOcrResult = row.ocrResult;
        if (row.status === "deleted") {
          throw new NonRetriableError(`Document ${documentId} was deleted before dispatch`);
        }

        return row;
      });

      if (doc.status !== "processing") {
        return {
          documentId,
          status: "skipped",
          reason: `document_status=${doc.status}`,
        };
      }

      const strategy = await step.run("resolve-processing-strategy", async () => {
        let textSample: string | null = null;
        let pdfTriage:
          | {
              extractedText?: string;
              pageCount?: number | null;
              pagesWithText?: number | null;
              imagePageCount?: number | null;
              extractionFailed?: boolean | null;
            }
          | undefined;

        if (doc.fileType === "knowledge") {
          const buffer = await loadDocumentFileBuffer({
            storageKey: storageKey ?? doc.storageUrl,
          });
          const extracted = await extractKnowledgeText(buffer, doc.fileName, doc.fileType);
          textSample = extracted.text.slice(0, 4000);
        } else if (doc.fileType === "pdf") {
          const buffer = await loadDocumentFileBuffer({
            storageKey: storageKey ?? doc.storageUrl,
          });

          try {
            const extracted = await extractUnstructuredText(buffer, {
              fileType: "pdf",
              fileName: doc.fileName,
            });
            const rawPageCount = extracted.metadata?.page_count;
            const pageCount =
              typeof rawPageCount === "number" &&
              Number.isFinite(rawPageCount) &&
              rawPageCount > 0
                ? Math.floor(rawPageCount)
                : null;

            textSample = extracted.text.slice(0, 4000);
            pdfTriage = {
              extractedText: extracted.text,
              pageCount,
              pagesWithText: extracted.text.trim() ? (pageCount ?? 1) : 0,
              imagePageCount: 0,
              extractionFailed: false,
            };
          } catch {
            pdfTriage = {
              extractionFailed: true,
            };
          }
        }

        return resolveDocumentProcessingStrategy({
          fileName: doc.fileName,
          fileType: doc.fileType,
          textSample,
          pdfTriage,
          sourcePath: getCodexSourceContext(doc.ocrResult)?.sourcePath ?? null,
        });
      });

      const ingressDispatchOcrResult = mergeIngressDispatchState(doc.ocrResult, {
        stage: "completed",
        processing_strategy: strategy.processingStrategy,
        dispatch_target: strategy.dispatchTarget,
        dispatch_event: strategy.dispatchEvent,
        routing_confidence: strategy.routingConfidence,
        extraction_confidence: strategy.extractionConfidence,
        ocr_needed: strategy.ocrNeeded,
        table_density: strategy.tableDensity,
        language: strategy.language,
        reasons: strategy.reasons,
        error: null,
        updated_at: new Date().toISOString(),
      });

      await step.run("persist-ingress-dispatch", async () => {
        await db
          .update(documents)
          .set({
            ocrResult: ingressDispatchOcrResult,
            // Tier A1 dual-write: type-safe column alongside JSONB stage.
            processingStage: "dispatched",
          })
          .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));
      });
      existingOcrResult = ingressDispatchOcrResult;

      if (doc.fileType === "pdf") {
        await step.run("audit-pdf-ingress-dispatch", async () => {
          await db.insert(auditLog).values({
            companyId,
            action: "document_ingress_dispatched",
            entityType: "document",
            entityId: documentId,
            newValue: {
              documentId,
              fileName: doc.fileName,
              fileType: doc.fileType,
              processingStrategy: strategy.processingStrategy,
              dispatchTarget: strategy.dispatchTarget,
              dispatchEvent: strategy.dispatchEvent,
              routingConfidence: strategy.routingConfidence,
              extractionConfidence: strategy.extractionConfidence,
              ocrNeeded: strategy.ocrNeeded,
              tableDensity: strategy.tableDensity,
              language: strategy.language,
              reasons: strategy.reasons,
            },
          });
        });
      }

      if (strategy.dispatchTarget === "codex_worker") {
        await step.run("handoff-to-codex-worker", async () => {
          const nowIso = new Date().toISOString();
          const workerPool = await resolveCompanyCodexWorkerPool(companyId);
          const codexHandoffOcrResult = mergeCodexPreprocessState(existingOcrResult, {
            pool: workerPool,
            stage: "queued",
            attempts: 0,
            queued_at: nowIso,
            updated_at: nowIso,
            error: null,
          });

          await db
            .update(documents)
            .set({
              source: "codex_upload",
              ocrResult: codexHandoffOcrResult,
            })
            .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));

          existingOcrResult = codexHandoffOcrResult;
        });
      } else if (strategy.dispatchEvent) {
        await step.sendEvent("dispatch-next-stage", [
          {
            name: strategy.dispatchEvent,
            data: {
              documentId,
              companyId,
              fileType: doc.fileType,
              storageKey: storageKey ?? doc.storageUrl,
            },
          },
        ]);
      }

      return {
        documentId,
        status: "dispatched",
        processingStrategy: strategy.processingStrategy,
        dispatchTarget: strategy.dispatchTarget,
        dispatchEvent: strategy.dispatchEvent,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await step.run("mark-dispatch-failed", async () => {
        await db
          .update(documents)
          .set({
            ocrResult: mergeIngressDispatchState(existingOcrResult, {
              stage: "failed",
              error: errorMessage,
              updated_at: new Date().toISOString(),
            }),
            // Tier A1 dual-write
            processingStage: "failed",
          })
          .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId)));
      });

      if (loadedDocument?.fileType === "pdf") {
        await step.run("audit-pdf-ingress-dispatch-failed", async () => {
          await db.insert(auditLog).values({
            companyId,
            action: "document_ingress_dispatch_failed",
            entityType: "document",
            entityId: documentId,
            newValue: {
              documentId,
              fileName: loadedDocument?.fileName ?? null,
              fileType: loadedDocument?.fileType ?? null,
              error: errorMessage,
            },
          });
        });
      }

      throw error;
    }
  },
);
