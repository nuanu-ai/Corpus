import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";

import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import { getCodexSourceContext } from "@/lib/codex-worker/source-context";
import { db } from "@/lib/db";
import { companies, documents } from "@/lib/db/schema";
import { resolveAgentSafeDocumentLimit } from "@/lib/company-db/agent-safe-defaults";
import {
  buildPendingDocumentClarificationQuestions,
  getCanonicalFinanceClarificationState,
  getCodexReviewSummary,
  getDocumentClarificationState,
  sourceFolderFromContext,
} from "@/lib/documents/clarifications";
import { buildDocumentImportTemplateDefaults } from "@/lib/documents/import-templates";
import {
  getDocumentDownloadDescriptor,
} from "@/lib/documents/operations";
import {
  buildDocumentAgentWorkflow,
  getDocumentUploadProvenance,
} from "@/lib/documents/upload-metadata";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.read");
    const { companyId } = auth;

    const parsedLimit = Number(req.nextUrl.searchParams.get("limit"));
    const limit = resolveAgentSafeDocumentLimit(
      auth.authMethod,
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20,
    ) ?? 20;
    const scanLimit = Math.min(Math.max(limit * 5, 50), 250);
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (req.nextUrl ? req.nextUrl.origin : new URL(req.url).origin);

    const [rows, companyRows] = await Promise.all([
      db
        .select({
          id: documents.id,
          status: documents.status,
          fileName: documents.fileName,
          fileType: documents.fileType,
          source: documents.source,
          createdAt: documents.createdAt,
          ocrResult: documents.ocrResult,
        })
        .from(documents)
        .where(and(eq(documents.companyId, companyId), ne(documents.status, "deleted")))
        .orderBy(desc(documents.createdAt))
        .limit(scanLimit),
      db
        .select({ settings: companies.settings })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1),
    ]);

    const companySettings = companyRows[0]?.settings;
    const items = [];

    for (const row of rows) {
      const review = getCodexReviewSummary(row.ocrResult);
      const canonicalFinance = getCanonicalFinanceClarificationState(row.ocrResult);
      const clarifications = getDocumentClarificationState(row.ocrResult);
      const sourceContext = getCodexSourceContext(row.ocrResult);
      const templateDefaults = buildDocumentImportTemplateDefaults(companySettings, {
        provider: sourceContext?.provider ?? null,
        sourceFolder: sourceFolderFromContext(sourceContext),
        documentKind: review?.documentKind ?? null,
        reportType: review?.normalizedMetadata.report_type ?? null,
      });
      const effectiveAnswers = {
        ...templateDefaults,
        ...clarifications.answers,
      };
      const questions = buildPendingDocumentClarificationQuestions({
        review,
        canonicalFinance,
        answers: effectiveAnswers,
      });

      if (questions.length === 0) {
        continue;
      }

      const workflow = buildDocumentAgentWorkflow(row.id, baseUrl);
      items.push({
        documentId: row.id,
        fileName: row.fileName,
        fileType: row.fileType,
        status: row.status,
        source: row.source,
        createdAt: row.createdAt.toISOString(),
        questionCount: questions.length,
        questions,
        answers: clarifications.answers,
        templateDefaults,
        review,
        canonicalFinance,
        sourceContext,
        uploadProvenance: getDocumentUploadProvenance(row.ocrResult),
        sourceFile: await getDocumentDownloadDescriptor({
          companyId,
          documentId: row.id,
          baseUrl,
        }),
        questionsUrl: workflow.questionsUrl,
        agentWorkflow: workflow,
      });

      if (items.length >= limit) {
        break;
      }
    }

    return NextResponse.json({
      capability: "document_questions",
      version: 1,
      summary: {
        documentCount: items.length,
        questionCount: items.reduce((sum, item) => sum + item.questionCount, 0),
        scannedDocumentCount: rows.length,
        limit,
      },
      endpoints: {
        documents: `${baseUrl.replace(/\/$/, "")}/api/documents`,
        upload: `${baseUrl.replace(/\/$/, "")}/api/documents/upload`,
        batchUpload: `${baseUrl.replace(/\/$/, "")}/api/documents/batch-upload`,
        questionQueue: `${baseUrl.replace(/\/$/, "")}/api/documents/questions`,
        documentQuestionsTemplate: `${baseUrl.replace(/\/$/, "")}/api/documents/{documentId}/clarifications`,
      },
      uploadMetadataContract: {
        acceptedMultipartFields: [
          "metadata",
          "sourceContext",
          "sourceProvider",
          "sourcePath",
          "rootPath",
          "connectionLabel",
          "sourceUrl",
          "externalDocumentId",
          "agentNotes",
          "clarificationAnswers",
        ],
        clarificationAnswerKeys: [
          "currency",
          "entity",
          "book",
          "report_type",
          "target_domain",
          "period_label",
          "pnl_sheet_name",
          "balance_sheet_sheet_name",
          "cash_flow_sheet_name",
          "projection_sheet_name",
          "metrics_sheet_name",
        ],
      },
      answerContract: {
        method: "POST",
        urlTemplate: `${baseUrl.replace(/\/$/, "")}/api/documents/{documentId}/clarifications`,
        body: {
          answers: {
            currency: "IDR",
            period_label: "2026-02",
          },
          reprocess: true,
          saveTemplate: false,
          applyToSimilar: false,
        },
      },
      items,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
