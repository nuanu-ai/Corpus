import { and, eq } from "drizzle-orm";

import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { auditLog, documents } from "@/lib/db/schema";
import { getCodexSourceContext } from "@/lib/codex-worker/source-context";
import { extractNarrativeContent } from "@/lib/document-parsers/narrative-extractor";
import { extractUnstructuredText } from "@/lib/document-parsers/unstructured-text";
import { resolveDocumentProcessingStrategy } from "@/lib/inngest/document-processing-strategy";
import {
  loadDocumentFileBuffer,
  MissingDocumentFileError,
} from "@/lib/inngest/document-file-loader";

type NarrativeDomain =
  | "legal"
  | "tax"
  | "governance"
  | "strategy"
  | "operations"
  | "assets"
  | "documents";

function selectNarrativeDomain(candidateDomains: string[]): NarrativeDomain {
  const candidate = candidateDomains[0];
  switch (candidate) {
    case "legal":
    case "tax":
    case "governance":
    case "strategy":
    case "operations":
    case "assets":
      return candidate;
    default:
      return "documents";
  }
}

export const shadowSimplifiedNarrativeDocument = inngest.createFunction(
  {
    id: "shadow-simplified-narrative-document",
    concurrency: [{ key: "event.data.documentId", limit: 1 }],
  },
  { event: "document/simplified-narrative-shadowed" },
  async ({ event, step }) => {
    const { documentId, companyId, fileType, storageKey } = event.data as {
      documentId: string;
      companyId: string;
      fileType: string;
      storageKey?: string;
    };

    const audit = async (action: string, newValue: Record<string, unknown>) =>
      step.run(`audit-${action}`, async () => {
        await db.insert(auditLog).values({
          companyId,
          action,
          entityType: "document",
          entityId: documentId,
          newValue,
        });
      });

    let fileName = `${documentId}.${fileType}`;
    let statusAtRun: string | null = null;

    try {
      const [doc] = await step.run("load-document-metadata", async () =>
        db
          .select({
            fileName: documents.fileName,
            status: documents.status,
            ocrResult: documents.ocrResult,
          })
          .from(documents)
          .where(and(eq(documents.id, documentId), eq(documents.companyId, companyId))),
      );

      if (!doc) {
        await audit("document_simplified_narrative_shadow_skipped", {
          documentId,
          fileType,
          reason: "document_not_found",
        });
        return {
          documentId,
          status: "skipped",
          reason: "document_not_found",
        };
      }

      fileName = doc.fileName;
      statusAtRun = doc.status;

      if (doc.status === "deleted") {
        await audit("document_simplified_narrative_shadow_skipped", {
          documentId,
          fileName,
          fileType,
          statusAtRun,
          reason: "document_deleted",
        });
        return {
          documentId,
          status: "skipped",
          reason: "document_deleted",
        };
      }

      if (fileType !== "pdf") {
        await audit("document_simplified_narrative_shadow_skipped", {
          documentId,
          fileName,
          fileType,
          statusAtRun,
          reason: "unsupported_file_type",
        });
        return {
          documentId,
          status: "skipped",
          reason: "unsupported_file_type",
        };
      }

      const fileBuffer = await (async (): Promise<Buffer> => {
        try {
          return await loadDocumentFileBuffer({ storageKey });
        } catch (error) {
          if (error instanceof MissingDocumentFileError) {
            throw new Error(error.message);
          }
          throw error;
        }
      })();

      const extractedText = await extractUnstructuredText(fileBuffer, {
        fileType: "pdf",
        fileName,
      });

      const rawPageCount = extractedText.metadata?.page_count;
      const pageCount =
        typeof rawPageCount === "number" &&
        Number.isFinite(rawPageCount) &&
        rawPageCount > 0
          ? Math.floor(rawPageCount)
          : null;

      const strategy = resolveDocumentProcessingStrategy({
        fileName,
        fileType,
        textSample: extractedText.text.slice(0, 4000),
        sourcePath: getCodexSourceContext(doc.ocrResult)?.sourcePath ?? null,
        pdfTriage: {
          extractedText: extractedText.text,
          pageCount,
          pagesWithText: extractedText.text.trim() ? (pageCount ?? 1) : 0,
          imagePageCount: 0,
          extractionFailed: false,
        },
      });

      if (strategy.dispatchTarget !== "simplified_narrative") {
        await audit("document_simplified_narrative_shadow_skipped", {
          documentId,
          fileName,
          fileType,
          statusAtRun,
          reason: "not_simplified_candidate",
          processingStrategy: strategy.processingStrategy,
          dispatchTarget: strategy.dispatchTarget,
          routingConfidence: strategy.routingConfidence,
          extractionConfidence: strategy.extractionConfidence,
          ocrNeeded: strategy.ocrNeeded,
          tableDensity: strategy.tableDensity,
          language: strategy.language,
          reasons: strategy.reasons,
        });
        return {
          documentId,
          status: "skipped",
          reason: "not_simplified_candidate",
          processingStrategy: strategy.processingStrategy,
        };
      }

      const extracted = await extractNarrativeContent(fileBuffer, {
        fileName,
        fileType,
      });
      const domain = selectNarrativeDomain(strategy.classification.candidate_domains);

      await audit("document_simplified_narrative_shadow_completed", {
        documentId,
        fileName,
        fileType,
        statusAtRun,
        authoritativePath: "codex_worker",
        processingStrategy: strategy.processingStrategy,
        dispatchTarget: strategy.dispatchTarget,
        routingConfidence: strategy.routingConfidence,
        extractionConfidence: strategy.extractionConfidence,
        ocrNeeded: strategy.ocrNeeded,
        tableDensity: strategy.tableDensity,
        language: strategy.language,
        reasons: strategy.reasons,
        domain,
        title: extracted.title,
        wordCount: extracted.wordCount,
        extractorMetadata: extracted.metadata ?? null,
      });

      return {
        documentId,
        status: "completed",
        processingStrategy: strategy.processingStrategy,
        domain,
        title: extracted.title,
        wordCount: extracted.wordCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await audit("document_simplified_narrative_shadow_failed", {
        documentId,
        fileName,
        fileType,
        statusAtRun,
        error: errorMessage,
      });

      return {
        documentId,
        status: "failed",
        error: errorMessage,
      };
    }
  },
);
