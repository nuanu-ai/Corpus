import { eq, and, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { extractKnowledgeText } from "@/lib/document-parsers/knowledge-extractor";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import { buildQueuedCodexAuditOcrResult } from "@/lib/codex-worker/audit-status";
import { normalizeOcrResult } from "@/lib/codex-worker/ocr-result";
import {
  loadDocumentFileBuffer,
  MissingDocumentFileError,
} from "@/lib/inngest/document-file-loader";

export const processKnowledgeDoc = inngest.createFunction(
  {
    id: "process-knowledge-doc",
    concurrency: [{ key: "event.data.documentId", limit: 1 }],
  },
  { event: "document/knowledge-uploaded" },
  async ({ event, step }) => {
    const { documentId, companyId, fileType, storageKey } = event.data as {
      documentId: string;
      companyId: string;
      fileType: string;
      storageKey: string;
    };
    let lastKnownOcrResult: Record<string, unknown> | null = null;

    try {
      // Load outside step.run so file blobs are never serialized into step output.
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
          .select({ fileName: documents.fileName, status: documents.status, ocrResult: documents.ocrResult })
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

      // Keep extraction out of step.run to avoid serializing full text payloads.
      const extractResult = await extractKnowledgeText(
        fileBuffer,
        doc.fileName,
        fileType,
      );

      // Step 3: Submit to Company-DB knowledge domain (if configured)
      const submitted = await step.run("submit-to-company-db", async () => {
        let companySlug: string;
        try {
          companySlug = await getCompanySlug(companyId);
        } catch {
          // Company-DB not configured — skip
          return false;
        }

        // Resolve write queue port from company record
        // Same pattern as lib/workers/reconciliation.ts:72-76
        const portRow = await db.execute<{ company_db_port: number }>(sql`
          SELECT company_db_port FROM companies WHERE id = ${companyId} LIMIT 1
        `);
        const basePort = portRow[0]?.company_db_port ?? 3100;
        const writeQueuePort = basePort + 1;

        const { submitKnowledgeDoc } = await import(
          "@/lib/company-db/client"
        );
        await submitKnowledgeDoc(
          companySlug,
          {
            documentId,
            title: extractResult.title,
            text: extractResult.text,
            wordCount: extractResult.wordCount,
          },
          writeQueuePort,
        );

        return true;
      });

      await step.run("refresh-knowledge-summaries", async () => {
        if (!submitted) return null;

        let companySlug: string;
        try {
          companySlug = await getCompanySlug(companyId);
        } catch {
          return null;
        }

        const portRow = await db.execute<{ company_db_port: number }>(sql`
          SELECT company_db_port FROM companies WHERE id = ${companyId} LIMIT 1
        `);
        const basePort = portRow[0]?.company_db_port ?? 3100;

        try {
          return await refreshSummaryTargets({
            companySlug,
            port: basePort,
            writeQueuePort: basePort + 1,
            domains: ["knowledge"],
            reason: "queue_write",
          });
        } catch (error) {
          console.warn("[summary-materializer] knowledge refresh failed", error);
          return null;
        }
      });

      // Step 4: Update document status (no transactions extracted)
      await step.run("update-document", async () => {
        await db
          .update(documents)
          .set({
            status: "completed",
            // Tier A1 dual-write
            processingStage: "parsed",
            extractedTxnCount: 0,
            confidenceScore: "1.0",
            ocrResult: buildQueuedCodexAuditOcrResult(normalizeOcrResult(doc.ocrResult)),
          })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.companyId, companyId),
            ),
          );
        // chat_attachments.status no longer source of truth (Tier A4).
      });

      return {
        documentId,
        type: "knowledge",
        title: extractResult.title,
        wordCount: extractResult.wordCount,
        submittedToCompanyDb: submitted,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await step.run("mark-document-failed", async () => {
        await db
          .update(documents)
          .set({
            status: "failed",
            // Tier A1 dual-write
            processingStage: "failed",
            error: errorMessage,
            ocrResult: buildQueuedCodexAuditOcrResult(lastKnownOcrResult),
          })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.companyId, companyId),
            ),
          );
        // chat_attachments.status no longer source of truth (Tier A4).
      });

      throw error;
    }
  },
);
