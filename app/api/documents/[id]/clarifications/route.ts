import { and, desc, eq, ne, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import { getCodexSourceContext } from "@/lib/codex-worker/source-context";
import { db } from "@/lib/db";
import { companies, documents } from "@/lib/db/schema";
import {
  buildPendingDocumentClarificationQuestions,
  getCanonicalFinanceClarificationState,
  getCodexReviewSummary,
  getClarificationReuseScope,
  getDocumentClarificationState,
  isReusableClarificationQuestionKey,
  matchesClarificationReuseScope,
  mergeDocumentClarificationState,
  sourceFolderFromContext,
  type ClarificationReuseScope,
  type ClarificationQuestionKey,
} from "@/lib/documents/clarifications";
import {
  buildDocumentImportTemplateDefaults,
  matchDocumentImportTemplates,
  withUpsertedDocumentImportTemplate,
} from "@/lib/documents/import-templates";
import {
  getDocumentDownloadDescriptor,
  reprocessDocumentForCompany,
} from "@/lib/documents/operations";

type ClarificationAnswerMap = Partial<Record<ClarificationQuestionKey, string>>;

const MAX_CLARIFICATION_REUSE_CANDIDATES = 200;
const CLARIFICATION_REUSE_CANDIDATE_FETCH_LIMIT = MAX_CLARIFICATION_REUSE_CANDIDATES + 1;
const MAX_CLARIFICATION_BULK_APPLY_UPDATES = 50;

async function loadClarificationReuseCandidates(
  companyId: string,
  documentId: string,
  reuseScope: ClarificationReuseScope,
) {
  const provider = reuseScope.provider ?? "";
  const documentKind = reuseScope.documentKind ?? "";
  const targetDomain = reuseScope.targetDomain ?? "";
  const reportType = reuseScope.reportType ?? "";
  const rows = await db
    .select({
      id: documents.id,
      ocrResult: documents.ocrResult,
    })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, companyId),
        ne(documents.id, documentId),
        ne(documents.status, "deleted"),
        sql`(${provider} = '' or coalesce(${documents.ocrResult} -> 'source_context' ->> 'provider', '') = ${provider})`,
        sql`(${documentKind} = '' or coalesce(${documents.ocrResult} -> 'codex_review' ->> 'document_kind', '') = ${documentKind})`,
        sql`(${targetDomain} = '' or coalesce(${documents.ocrResult} -> 'codex_review' ->> 'target_domain', '') = ${targetDomain})`,
        sql`(${reportType} = '' or coalesce(${documents.ocrResult} -> 'codex_review' -> 'normalized_metadata' ->> 'report_type', '') = ${reportType})`,
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(CLARIFICATION_REUSE_CANDIDATE_FETCH_LIMIT);

  return {
    rows: rows.slice(0, MAX_CLARIFICATION_REUSE_CANDIDATES),
    candidateScanTruncated: rows.length > MAX_CLARIFICATION_REUSE_CANDIDATES,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.read");
    const { companyId } = auth;
    const { id } = await params;

    const [row] = await db
      .select({
        id: documents.id,
        status: documents.status,
        fileName: documents.fileName,
        ocrResult: documents.ocrResult,
        settings: companies.settings,
      })
      .from(documents)
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .where(and(eq(documents.id, id), eq(documents.companyId, companyId)))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const review = getCodexReviewSummary(row.ocrResult);
    const canonicalFinance = getCanonicalFinanceClarificationState(row.ocrResult);
    const clarifications = getDocumentClarificationState(row.ocrResult);
    const sourceContext = getCodexSourceContext(row.ocrResult);
    const sourceFolder = sourceFolderFromContext(sourceContext);
    const matchedTemplates = matchDocumentImportTemplates(row.settings, {
      provider: sourceContext?.provider ?? null,
      sourceFolder,
      documentKind: review?.documentKind ?? null,
      reportType: review?.normalizedMetadata.report_type ?? null,
    }).slice(0, 3);

    const templateDefaults = buildDocumentImportTemplateDefaults(row.settings, {
      provider: sourceContext?.provider ?? null,
      sourceFolder,
      documentKind: review?.documentKind ?? null,
      reportType: review?.normalizedMetadata.report_type ?? null,
    });
    const effectiveAnswers: ClarificationAnswerMap = {
      ...templateDefaults,
      ...clarifications.answers,
    };

    const questions = buildPendingDocumentClarificationQuestions({
      review,
      canonicalFinance,
      answers: effectiveAnswers,
    });

    const reuseScope = getClarificationReuseScope({ review, sourceContext });
    const reusableQuestionKeys = questions
      .filter((question) => question.templateEligible && isReusableClarificationQuestionKey(question.key))
      .map((question) => question.key);

    let similarDocumentCount = 0;
    let candidateScanTruncated = false;
    if (reuseScope && reusableQuestionKeys.length > 0) {
      const candidateBatch = await loadClarificationReuseCandidates(companyId, id, reuseScope);
      candidateScanTruncated = candidateBatch.candidateScanTruncated;

      similarDocumentCount = candidateBatch.rows.filter((candidate) => {
        const candidateReview = getCodexReviewSummary(candidate.ocrResult);
        const candidateSourceContext = getCodexSourceContext(candidate.ocrResult);
        if (!matchesClarificationReuseScope({
          review: candidateReview,
          sourceContext: candidateSourceContext,
        }, reuseScope)) {
          return false;
        }

        const candidateClarifications = getDocumentClarificationState(candidate.ocrResult);
        const candidateCanonicalFinance = getCanonicalFinanceClarificationState(candidate.ocrResult);
        const candidateTemplateDefaults = buildDocumentImportTemplateDefaults(row.settings, {
          provider: candidateSourceContext?.provider ?? null,
          sourceFolder: sourceFolderFromContext(candidateSourceContext),
          documentKind: candidateReview?.documentKind ?? null,
          reportType: candidateReview?.normalizedMetadata.report_type ?? null,
        });
        const candidateQuestions = buildPendingDocumentClarificationQuestions({
          review: candidateReview,
          canonicalFinance: candidateCanonicalFinance,
          answers: {
            ...candidateTemplateDefaults,
            ...candidateClarifications.answers,
          },
        });

        return candidateQuestions.some((question) => reusableQuestionKeys.includes(question.key));
      }).length;
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (req.nextUrl ? req.nextUrl.origin : new URL(req.url).origin);
    const sourceFile = await getDocumentDownloadDescriptor({
      companyId,
      documentId: id,
      baseUrl,
    });

    return NextResponse.json({
      documentId: row.id,
      fileName: row.fileName,
      status: row.status,
      sourceFile,
      review,
      canonicalFinance,
      sourceContext,
      questions,
      answers: clarifications.answers,
      templateDefaults,
      matchedTemplates,
      bulkApply: {
        available: similarDocumentCount > 0,
        similarDocumentCount,
        candidateLimit: MAX_CLARIFICATION_REUSE_CANDIDATES,
        candidateScanTruncated,
        updateLimit: MAX_CLARIFICATION_BULK_APPLY_UPDATES,
        questionKeys: reusableQuestionKeys,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.write");
    const { companyId, userId, role } = auth;
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const answers = (body.answers ?? {}) as ClarificationAnswerMap;
    const saveTemplate = body.saveTemplate === true;
    const applyToSimilar = body.applyToSimilar === true;
    const reprocess = body.reprocess !== false;

    const [row] = await db
      .select({
        id: documents.id,
        status: documents.status,
        fileName: documents.fileName,
        ocrResult: documents.ocrResult,
        settings: companies.settings,
      })
      .from(documents)
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .where(and(eq(documents.id, id), eq(documents.companyId, companyId)))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const nextOcrResult = mergeDocumentClarificationState(row.ocrResult, {
      answers,
      answeredAt: new Date().toISOString(),
      answeredBy: userId,
    });

    await db
      .update(documents)
      .set({
        ocrResult: nextOcrResult,
      })
      .where(and(eq(documents.id, id), eq(documents.companyId, companyId)));

    let templateSaved = false;
    let similarDocumentsUpdated = 0;
    let similarDocumentsMatched = 0;
    let similarDocumentsTruncated = false;
    let similarDocumentsCandidateScanTruncated = false;
    const review = getCodexReviewSummary(nextOcrResult);
    const sourceContext = getCodexSourceContext(nextOcrResult);
    const sourceFolder = sourceFolderFromContext(sourceContext);

    if (saveTemplate) {
      const templateEligibleAnswers = Object.fromEntries(
        Object.entries(answers).filter(([key, value]) => {
          return (
            typeof value === "string" &&
            value.trim().length > 0 &&
            key !== "period_label"
          );
        }),
      ) as ClarificationAnswerMap;

      if (sourceFolder && Object.keys(templateEligibleAnswers).length > 0) {
        const nextSettings = withUpsertedDocumentImportTemplate(row.settings, {
          provider: sourceContext?.provider ?? null,
          sourceFolder,
          documentKind: review?.documentKind ?? null,
          reportType: review?.normalizedMetadata.report_type ?? null,
          answers: templateEligibleAnswers,
        });

        await db
          .update(companies)
          .set({
            settings: nextSettings,
            updatedAt: new Date(),
          })
          .where(eq(companies.id, companyId));
        templateSaved = true;
      }
    }

    if (applyToSimilar) {
      const reuseScope = getClarificationReuseScope({ review, sourceContext });
      const reusableAnswers = Object.fromEntries(
        Object.entries(answers).filter(([key, value]) => {
          return (
            typeof value === "string" &&
            value.trim().length > 0 &&
            isReusableClarificationQuestionKey(key as ClarificationQuestionKey)
          );
        }),
      ) as ClarificationAnswerMap;

      if (reuseScope && Object.keys(reusableAnswers).length > 0) {
        const candidateBatch = await loadClarificationReuseCandidates(companyId, id, reuseScope);
        similarDocumentsCandidateScanTruncated = candidateBatch.candidateScanTruncated;

        const answeredAt = new Date().toISOString();
        const updates = candidateBatch.rows.flatMap((candidate) => {
          const candidateReview = getCodexReviewSummary(candidate.ocrResult);
          const candidateSourceContext = getCodexSourceContext(candidate.ocrResult);
          if (!matchesClarificationReuseScope({
            review: candidateReview,
            sourceContext: candidateSourceContext,
          }, reuseScope)) {
            return [];
          }

          const candidateClarifications = getDocumentClarificationState(candidate.ocrResult);
          const candidateCanonicalFinance = getCanonicalFinanceClarificationState(candidate.ocrResult);
          const candidateTemplateDefaults = buildDocumentImportTemplateDefaults(row.settings, {
            provider: candidateSourceContext?.provider ?? null,
            sourceFolder: sourceFolderFromContext(candidateSourceContext),
            documentKind: candidateReview?.documentKind ?? null,
            reportType: candidateReview?.normalizedMetadata.report_type ?? null,
          });
          const candidatePending = buildPendingDocumentClarificationQuestions({
            review: candidateReview,
            canonicalFinance: candidateCanonicalFinance,
            answers: {
              ...candidateTemplateDefaults,
              ...candidateClarifications.answers,
            },
          });

          const candidateAnswers = Object.fromEntries(
            Object.entries(reusableAnswers).filter(([key]) =>
              candidatePending.some((question) => question.key === key),
            ),
          ) as ClarificationAnswerMap;

          if (Object.keys(candidateAnswers).length === 0) {
            return [];
          }

          return [{
            id: candidate.id,
            nextOcrResult: mergeDocumentClarificationState(candidate.ocrResult, {
              answers: candidateAnswers,
              answeredAt,
              answeredBy: userId,
            }),
          }];
        });

        similarDocumentsMatched = updates.length;
        const boundedUpdates = updates.slice(0, MAX_CLARIFICATION_BULK_APPLY_UPDATES);
        similarDocumentsTruncated = updates.length > boundedUpdates.length;

        if (boundedUpdates.length > 0) {
          await Promise.all(boundedUpdates.map((update) =>
            db
              .update(documents)
              .set({
                ocrResult: update.nextOcrResult,
              })
              .where(and(eq(documents.id, update.id), eq(documents.companyId, companyId)))
          ));
          similarDocumentsUpdated = boundedUpdates.length;
        }
      }
    }

    let reprocessQueued = false;
    if (reprocess && row.status !== "processing") {
      await reprocessDocumentForCompany({
        companyId,
        userId,
        role,
        documentId: id,
      });
      reprocessQueued = true;
    }

    return NextResponse.json({
      status: "ok",
      templateSaved,
      similarDocumentsMatched,
      similarDocumentsUpdated,
      similarDocumentsTruncated,
      similarDocumentsCandidateScanTruncated,
      similarDocumentsCandidateLimit: MAX_CLARIFICATION_REUSE_CANDIDATES,
      similarDocumentsUpdateLimit: MAX_CLARIFICATION_BULK_APPLY_UPDATES,
      reprocessQueued,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
