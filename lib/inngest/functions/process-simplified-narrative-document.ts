import { and, eq, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { submitNarrativeDoc } from "@/lib/company-db/client";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import { buildQueuedCodexAuditOcrResult } from "@/lib/codex-worker/audit-status";
import { normalizeOcrResult } from "@/lib/codex-worker/ocr-result";
import { getCodexSourceContext } from "@/lib/codex-worker/source-context";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import {
  classifyDocumentForIngestion,
  type DocumentClassification,
} from "@/lib/document-parsers/document-classification";
import { extractNarrativeContent } from "@/lib/document-parsers/narrative-extractor";
import { getIngressDispatchState } from "@/lib/inngest/ingress-dispatch-state";
import {
  loadDocumentFileBuffer,
  MissingDocumentFileError,
} from "@/lib/inngest/document-file-loader";
import { inngest } from "@/lib/inngest";

type NarrativeDomain =
  | "legal"
  | "tax"
  | "governance"
  | "strategy"
  | "operations"
  | "assets"
  | "documents";

function selectNarrativeDomain(classification: DocumentClassification): NarrativeDomain {
  const candidate = classification.candidate_domains[0];
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

function resolveIngressDispatchMetadata(ocrResult: unknown) {
  const ingressDispatch = getIngressDispatchState(ocrResult);
  if (!ingressDispatch) {
    return {
      language: null as string | null,
      routingConfidence: null as number | null,
      reasons: [] as string[],
    };
  }

  return {
    language: ingressDispatch.language,
    routingConfidence: ingressDispatch.routingConfidence,
    reasons: ingressDispatch.reasons,
  };
}

async function resolveCompanyDbWriteTarget(companyId: string) {
  let companySlug: string;
  try {
    companySlug = await getCompanySlug(companyId);
  } catch {
    throw new NonRetriableError(
      `Company ${companyId} is missing a Company-DB slug required for narrative promotion`,
    );
  }

  const portRow = await db.execute<{ company_db_port: number }>(sql`
    SELECT company_db_port FROM companies WHERE id = ${companyId} LIMIT 1
  `);
  const basePort = portRow[0]?.company_db_port ?? 3100;

  return {
    companySlug,
    basePort,
    writeQueuePort: basePort + 1,
  };
}

export const processSimplifiedNarrativeDocument = inngest.createFunction(
  {
    id: "process-simplified-narrative-document",
    concurrency: [{ key: "event.data.documentId", limit: 1 }],
  },
  { event: "document/simplified-narrative-uploaded" },
  async ({ event, step }) => {
    const { documentId, companyId, fileType, storageKey } = event.data as {
      documentId: string;
      companyId: string;
      fileType: string;
      storageKey?: string;
    };
    let lastKnownOcrResult: Record<string, unknown> | null = null;

    try {
      const fileBuffer = await (async (): Promise<Buffer> => {
        try {
          return await loadDocumentFileBuffer({ storageKey });
        } catch (error) {
          if (error instanceof MissingDocumentFileError) {
            throw new NonRetriableError(error.message);
          }
          throw error;
        }
      })();

      const doc = await step.run("load-document-metadata", async () => {
        const [row] = await db
          .select({
            fileName: documents.fileName,
            status: documents.status,
            ocrResult: documents.ocrResult,
          })
          .from(documents)
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.companyId, companyId),
            ),
          );

        if (!row) throw new Error(`Document ${documentId} not found`);
        if (row.status === "deleted") {
          throw new NonRetriableError(`Document ${documentId} was deleted before processing`);
        }
        lastKnownOcrResult = normalizeOcrResult(row.ocrResult) ?? null;
        return row;
      });

      const extracted = await extractNarrativeContent(fileBuffer, {
        fileName: doc.fileName,
        fileType,
      });

      const classification = await step.run(
        "classify-simplified-narrative",
        async (): Promise<DocumentClassification> =>
          classifyDocumentForIngestion({
            fileType,
            fileName: doc.fileName,
            documentType: null,
            transactionsCount: 0,
            reportsCount: 0,
            sourcePath: getCodexSourceContext(doc.ocrResult)?.sourcePath ?? null,
          }),
      );

      const narrativeDomain = selectNarrativeDomain(classification);
      const ingressDispatch = resolveIngressDispatchMetadata(doc.ocrResult);
      const companyDbTarget = await step.run(
        "resolve-company-db-write-target",
        async () => resolveCompanyDbWriteTarget(companyId),
      );

      await step.run("submit-to-company-db", async () => {
        await submitNarrativeDoc(
          companyDbTarget.companySlug,
          {
            domain: narrativeDomain,
            documentId,
            title: extracted.title,
            markdown: extracted.markdown,
            wordCount: extracted.wordCount,
            sourceLanguage: ingressDispatch.language,
            fileName: doc.fileName,
            documentType: "narrative",
            routing: {
              classification,
              routing_confidence: ingressDispatch.routingConfidence,
              reasons: ingressDispatch.reasons,
              extractor_metadata: extracted.metadata ?? null,
            },
          },
          companyDbTarget.writeQueuePort,
        );
      });

      await step.run("refresh-domain-summaries", async () => {
        try {
          return await refreshSummaryTargets({
            companySlug: companyDbTarget.companySlug,
            port: companyDbTarget.basePort,
            writeQueuePort: companyDbTarget.writeQueuePort,
            domains: [narrativeDomain],
            reason: "queue_write",
          });
        } catch (error) {
          console.warn("[summary-materializer] simplified narrative refresh failed", error);
          return null;
        }
      });

      await step.run("update-document", async () => {
        await db
          .update(documents)
          .set({
            status: "completed",
            error: null,
            extractedTxnCount: 0,
            confidenceScore:
              ingressDispatch.routingConfidence !== null
                ? ingressDispatch.routingConfidence.toFixed(2)
                : "1.0",
            ocrResult: buildQueuedCodexAuditOcrResult(normalizeOcrResult(doc.ocrResult)),
          })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.companyId, companyId),
            ),
          );
      });

      return {
        documentId,
        type: "simplified_narrative",
        domain: narrativeDomain,
        title: extracted.title,
        wordCount: extracted.wordCount,
        submittedToCompanyDb: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await step.run("mark-document-failed", async () => {
        await db
          .update(documents)
          .set({
            status: "failed",
            error: errorMessage,
            ocrResult: buildQueuedCodexAuditOcrResult(lastKnownOcrResult),
          })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.companyId, companyId),
            ),
          );
      });

      throw error;
    }
  },
);
