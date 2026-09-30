import { eq } from "drizzle-orm";

import { getCodexSourceContext } from "@/lib/codex-worker/source-context";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import {
  getCodexReviewSummary,
  getDocumentClarificationState,
  sourceFolderFromContext,
} from "@/lib/documents/clarifications";
import { matchDocumentImportTemplates } from "@/lib/documents/import-templates";
import { getDocumentUploadProvenance } from "@/lib/documents/upload-metadata";

export async function getDocumentPromptClarificationContext(input: {
  companyId: string;
  ocrResult: unknown;
}) {
  const review = getCodexReviewSummary(input.ocrResult);
  const clarifications = getDocumentClarificationState(input.ocrResult);
  const sourceContext = getCodexSourceContext(input.ocrResult);
  const uploadProvenance = getDocumentUploadProvenance(input.ocrResult);
  const sourceFolder = sourceFolderFromContext(sourceContext);

  const [company] = await db
    .select({ settings: companies.settings })
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1);

  const templateHints = matchDocumentImportTemplates(company?.settings, {
    provider: sourceContext?.provider ?? null,
    sourceFolder,
    documentKind: review?.documentKind ?? null,
    reportType: review?.normalizedMetadata.report_type ?? null,
  }).slice(0, 3);

  return {
    documentAnswers:
      Object.keys(clarifications.answers).length > 0 ? clarifications.answers : undefined,
    uploadProvenance: uploadProvenance
      ? {
          sourceUrl: uploadProvenance.sourceUrl ?? null,
          externalDocumentId: uploadProvenance.externalDocumentId ?? null,
          agentNotes: uploadProvenance.agentNotes ?? null,
        }
      : undefined,
    templateHints:
      templateHints.length > 0
        ? templateHints.map((template) => ({
            provider: template.provider,
            sourceFolder: template.sourceFolder,
            documentKind: template.documentKind,
            reportType: template.reportType,
            answers: template.answers,
          }))
        : undefined,
  };
}
