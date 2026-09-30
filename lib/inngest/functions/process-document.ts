import { eq, and, gte, inArray, notInArray, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import {
  documents,
  companies,
  rawEvents,
  canonicalTxns,
  stagingRecords,
} from "@/lib/db/schema";
import {
  parseDocument,
  type ParseResult,
} from "@/lib/document-parsers/format-router";
import {
  buildCanonicalFinanceOcrState,
  buildCanonicalFinanceStagingRows,
} from "@/lib/document-parsers/canonical-finance-staging";
import { buildBankBalanceStagingRows } from "@/lib/document-parsers/bank-balance-staging";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { normalizeOcrResult } from "@/lib/codex-worker/ocr-result";
import { buildQueuedCodexAuditOcrResult } from "@/lib/codex-worker/audit-status";
import { getCodexSourceContext } from "@/lib/codex-worker/source-context";
import type { ExtractedReport } from "@/lib/document-parsers/report-types";
import {
  classifyDocumentForIngestion,
  type DocumentClassification,
} from "@/lib/document-parsers/document-classification";
import { getDocumentClarificationState } from "@/lib/documents/clarifications";
import {
  fallbackFinancialClassification,
  resolveFlagForCompany,
  resolveNeedsReview,
  shouldRunFinancialParser,
  shouldStageDocumentEvidence,
  type IngestRoutingFlags,
} from "@/lib/inngest/document-routing";
import {
  INGRESS_BUDGET_CONSUMING_DOCUMENT_STATUSES,
  resolveIngressBudgetGuardSettings,
  utcDayStart,
} from "@/lib/inngest/ingress-budget-guard";
import { triggerReconciliationForCompany } from "@/lib/workers/reconciliation-trigger";
import {
  loadDocumentFileBuffer,
  MissingDocumentFileError,
} from "@/lib/inngest/document-file-loader";
import { buildCanonicalTxnWriteValues } from "@/lib/canonical-txns";
import { resolveTxnCurrency } from "@/lib/finance/resolve-currency";
import { planCanonicalTxnReplayWrites } from "@/lib/inngest/process-document-idempotency";
import {
  guardrailMetadata,
  logGuardrailEvent,
  resolveGuardrailRollout,
} from "@/lib/guardrails/safe-rollout";
import { resolveNeedsReviewFinancePromotion } from "@/lib/guardrails/needs-review-finance-promotion";

function envFlagEnabled(name: string): boolean {
  return process.env[name] === "true";
}

interface RuntimeParseResult extends ParseResult {
  fileName: string;
}

interface IngressBudgetGuardDecision {
  enabled: boolean;
  exhausted: boolean;
  nonFinancialDailyCap: number;
  usedToday: number;
  windowStartIso: string;
  reason: string | null;
}

export const processDocument = inngest.createFunction(
  {
    id: "process-document",
    concurrency: [{ key: "event.data.documentId", limit: 1 }],
  },
  { event: "document/uploaded" },
  async ({ event, step }) => {
    const { documentId, companyId, fileType, storageKey, storageUrl, approved, reprocess } = event.data as {
      documentId: string;
      companyId: string;
      fileType: string;
      storageKey?: string;
      storageUrl?: string;  // legacy — Vercel Blob URL
      approved?: boolean;   // set when re-processing after manual approval
      reprocess?: boolean;
    };
    let lastKnownOcrResult: Record<string, unknown> | null = null;

    try {
      // Load outside step.run so large file blobs are not serialized into step output.
      const fileBuffer = await (async (): Promise<Buffer> => {
        try {
          return await loadDocumentFileBuffer({ storageKey, storageUrl });
        } catch (error) {
          if (error instanceof MissingDocumentFileError) {
            throw new NonRetriableError(error.message);
          }
          throw error;
        }
      })();

      // Step 2: Load document metadata
      const doc = await step.run("load-document-metadata", async () => {
        const [row] = await db
          .select({
            fileName: documents.fileName,
            status: documents.status,
            ocrResult: documents.ocrResult,
            reportingCurrency: companies.reportingCurrency,
          })
          .from(documents)
          .innerJoin(companies, eq(companies.id, documents.companyId))
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

      const flags: IngestRoutingFlags = {
        classifierEnabled: envFlagEnabled("INGEST_CLASSIFIER_V1"),
        routerSplitEnabled: resolveFlagForCompany(
          envFlagEnabled("INGEST_ROUTER_SPLIT_V1"),
          companyId,
          process.env.INGEST_CANARY_COMPANY_IDS,
        ),
        nonFinancialWriterEnabled: resolveFlagForCompany(
          envFlagEnabled("INGEST_NON_FINANCIAL_WRITER_V1"),
          companyId,
          process.env.INGEST_CANARY_COMPANY_IDS,
        ),
        ingressAssistNonFinancialEnabled: resolveFlagForCompany(
          envFlagEnabled("INGEST_INGRESS_ASSIST_NON_FIN_V1"),
          companyId,
          process.env.INGEST_CANARY_COMPANY_IDS,
        ),
        ingressAutoRouteLowRiskEnabled: resolveFlagForCompany(
          envFlagEnabled("INGEST_INGRESS_AUTOROUTE_LOW_RISK_V1"),
          companyId,
          process.env.INGEST_CANARY_COMPANY_IDS,
        ),
        ingressBudgetGuardEnabled: resolveFlagForCompany(
          envFlagEnabled("INGEST_INGRESS_BUDGET_GUARD_V1"),
          companyId,
          process.env.INGEST_CANARY_COMPANY_IDS,
        ),
      };
      const budgetGuardSettings = resolveIngressBudgetGuardSettings();
      const sourcePath = getCodexSourceContext(doc.ocrResult)?.sourcePath ?? null;

      // Step 3: Pre-parse classification (required for split routing)
      const preClassification = await step.run(
        "classify-document-routing-preparse",
        async (): Promise<DocumentClassification> => {
          if (!flags.classifierEnabled) {
            return fallbackFinancialClassification();
          }
          return classifyDocumentForIngestion({
            fileType,
            fileName: doc.fileName,
            documentType: null,
            transactionsCount: 0,
            reportsCount: 0,
            sourcePath,
          });
        },
      );

      // Step 4: Parse financial documents only when routing allows it.
      // Run outside step.run so large report payloads are not serialized in
      // Inngest step output (prevents "output_too_large" on big GL files).
      const shouldParseFinancial = shouldRunFinancialParser(
        flags,
        preClassification,
      );
      let parseResult: RuntimeParseResult;

      if (!shouldParseFinancial) {
        parseResult = {
          fileName: doc.fileName,
          transactions: [],
          confidence: preClassification.confidence,
          metadata: {},
          reports: [],
          documentType: undefined,
          needsReview: false,
        };
      } else {
        const parsed = await parseDocument(fileBuffer, fileType, doc.fileName, {
          companyId,
          sourceContext: getCodexSourceContext(doc.ocrResult) ?? undefined,
          clarificationAnswers: getDocumentClarificationState(doc.ocrResult).answers,
        });
        parseResult = {
          fileName: doc.fileName,
          ...parsed,
        };
      }

      // Step 5: Final classification (refined by parser outputs for financial docs)
      const classification = await step.run(
        "classify-document-routing-final",
        async (): Promise<DocumentClassification> => {
          if (!flags.classifierEnabled) return preClassification;
          if (!shouldParseFinancial) return preClassification;
          return classifyDocumentForIngestion({
            fileType,
            fileName: parseResult.fileName,
            documentType: parseResult.documentType,
            transactionsCount: parseResult.transactions.length,
            reportsCount: parseResult.reports?.length ?? 0,
            sourcePath,
          });
        },
      );

      const budgetGuardDecision = await step.run(
        "evaluate-ingress-budget-guard",
        async (): Promise<IngressBudgetGuardDecision> => {
          const windowStart = utcDayStart();
          const windowStartIso = windowStart.toISOString();
          if (!flags.ingressBudgetGuardEnabled) {
            return {
              enabled: false,
              exhausted: false,
              nonFinancialDailyCap: budgetGuardSettings.nonFinancialDailyCap,
              usedToday: 0,
              windowStartIso,
              reason: null,
            };
          }
          if (classification.document_kind !== "non_financial") {
            return {
              enabled: true,
              exhausted: false,
              nonFinancialDailyCap: budgetGuardSettings.nonFinancialDailyCap,
              usedToday: 0,
              windowStartIso,
              reason: null,
            };
          }

          const [row] = await db
            .select({ count: sql<number>`count(*)` })
            .from(documents)
            .where(
              and(
                eq(documents.companyId, companyId),
                inArray(documents.status, INGRESS_BUDGET_CONSUMING_DOCUMENT_STATUSES),
                gte(documents.createdAt, windowStart),
                sql`(${documents.ocrResult} -> 'routing' ->> 'branch') = 'non_financial'`,
              ),
            );

          const usedToday = Number(row?.count ?? 0);
          const exhausted = usedToday >= budgetGuardSettings.nonFinancialDailyCap;
          return {
            enabled: true,
            exhausted,
            nonFinancialDailyCap: budgetGuardSettings.nonFinancialDailyCap,
            usedToday,
            windowStartIso,
            reason: exhausted ? "non_financial_daily_cap_exhausted" : null,
          };
        },
      );

      const isFinancialRoute = !flags.routerSplitEnabled || classification.document_kind === "financial";
      const needsReview = resolveNeedsReview(
        flags,
        classification,
        parseResult.needsReview ?? false,
      ) || budgetGuardDecision.exhausted;
      const needsReviewPromotionGuardrail = resolveGuardrailRollout({
        key: "needs_review_finance_promotion",
        companyId,
      });
      const needsReviewPromotionDecision = resolveNeedsReviewFinancePromotion({
        needsReview,
        approved: approved ?? false,
        extractedTransactionCount: parseResult.transactions.length,
        canonicalFinanceRecordCount: parseResult.canonicalFinance?.records.length ?? 0,
        bankBalanceAccountCount: parseResult.bankBalanceSnapshot?.accountCount ?? 0,
      });
      const shouldGateDecisionGradeFinance =
        needsReviewPromotionDecision.blockedDecisionGradePromotion;

      if (needsReview && !approved) {
        logGuardrailEvent({
          decision: needsReviewPromotionGuardrail,
          action: shouldGateDecisionGradeFinance
            ? "blocked_decision_grade_finance_promotion"
            : "would_block_decision_grade_finance_promotion",
          reason: budgetGuardDecision.exhausted
            ? budgetGuardDecision.reason ?? "budget_guard_exhausted"
            : "needs_review_without_approval",
          details: {
            documentId,
            fileType,
            classificationKind: classification.document_kind,
            candidateCounts: needsReviewPromotionDecision.candidateCounts,
          },
        });
      }

      // Step 6: Find the raw event for financial transactions only
      // Query by sourceEventId (set to documentId in all upload routes)
      // rather than idempotencyKey (which varies by source: upload, gdrive, email)
      const rawEventId = await step.run("find-raw-event", async (): Promise<string | null> => {
        if (shouldGateDecisionGradeFinance) {
          return null;
        }
        const needsRawEvent =
          isFinancialRoute &&
          (parseResult.transactions.length > 0 || Boolean(approved && reprocess));
        if (!needsRawEvent) {
          return null;
        }

        const [rawEvent] = await db
          .select({ id: rawEvents.id })
          .from(rawEvents)
          .where(
            and(
              eq(rawEvents.companyId, companyId),
              eq(rawEvents.sourceEventId, documentId),
            ),
          );

        if (!rawEvent)
          throw new Error(
            `Raw event for document ${documentId} not found`,
          );
        return rawEvent.id;
      });

      // Step 7: Insert canonical transactions and paired staging rows atomically.
      const transactionWriteResult = await step.run(
        "insert-transactions-and-staging-records",
        async () => {
          if (shouldGateDecisionGradeFinance) {
            return { insertedCount: 0, stagingCount: 0 };
          }
          if (!isFinancialRoute || parseResult.transactions.length === 0) {
            if (approved && reprocess && isFinancialRoute && rawEventId) {
              await db
                .update(canonicalTxns)
                .set({
                  status: "superseded",
                  metadata: sql`coalesce(${canonicalTxns.metadata}, '{}'::jsonb) || ${JSON.stringify({
                    supersededByDocumentReprocess: documentId,
                    supersededAt: new Date().toISOString(),
                    reason: "approved_reprocess_emitted_no_transactions",
                  })}::jsonb`,
                })
                .where(
                  and(
                    eq(canonicalTxns.companyId, companyId),
                    eq(canonicalTxns.rawEventId, rawEventId),
                  ),
                );
            }
            return { insertedCount: 0, stagingCount: 0 };
          }
          if (!rawEventId) {
            throw new Error(`Raw event for document ${documentId} not found`);
          }

          const companySlug = await getCompanySlug(companyId);
          const format =
            (parseResult.metadata as Record<string, unknown> | undefined)
              ?.format ?? "csv";
          const source = `csv-import:${format}`;

          const resolvedRows = parseResult.transactions.map((txn) =>
            resolveTxnCurrency(txn.currency, { reportingCurrency: doc.reportingCurrency }),
          );

          const rows = await Promise.all(
            parseResult.transactions.map((txn, idx) =>
              buildCanonicalTxnWriteValues({
                companyId,
                rawEventId,
                connectionId: null,
                date: txn.date,
                amount: Math.abs(txn.amount),
                currency: resolvedRows[idx].currency,
                description: txn.description,
                merchantName: txn.merchantName,
                sourceRef: txn.sourceRef ?? `${documentId}:${idx}`,
                type: (txn.amount >= 0 ? "credit" : "debit") as
                  | "credit"
                  | "debit",
                status: "pending",
                metadata: resolvedRows[idx].assumed
                  ? {
                      currencyAssumed: true,
                      currencyAssumedFrom: resolvedRows[idx].source,
                    }
                  : {},
              }),
            ),
          );

          const stagingRows = parseResult.transactions.map((txn, idx) => ({
            companySlug,
            source,
            externalId: `${documentId}:${idx}`,
            payload: {
              documentId,
              date: txn.date,
              amount: txn.amount,
              currency: resolvedRows[idx].currency,
              currencyAssumed: resolvedRows[idx].assumed,
              description: txn.description,
              merchantName: txn.merchantName,
              sourceRef: txn.sourceRef,
              type: txn.amount >= 0 ? "transaction" : "transaction",
              domain: "banking",
            } as Record<string, unknown>,
            status: "pending" as const,
          }));

          const writeResult = await db.transaction(async (tx) => {
            const sourceRefs = rows
              .map((row) => row.sourceRef)
              .filter((value): value is string => typeof value === "string" && value.length > 0);
            let rowsToInsert = rows;
            let rowsToUpdate: typeof rows = [];
            let stagingRowsToInsert = stagingRows;

            if (sourceRefs.length > 0) {
              const lockKey = `${companyId}:document:${documentId}:canonical_txns`;
              await tx.execute(
                sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
              );
              const existingRows = await tx
                .select({ sourceRef: canonicalTxns.sourceRef })
                .from(canonicalTxns)
                .where(
                  and(
                    eq(canonicalTxns.companyId, companyId),
                    eq(canonicalTxns.rawEventId, rawEventId),
                    inArray(canonicalTxns.sourceRef, sourceRefs),
                  ),
                );
              const existingSourceRefs = new Set(
                existingRows
                  .map((row) => row.sourceRef)
                  .filter((value): value is string => typeof value === "string"),
              );
              const plannedWrites = planCanonicalTxnReplayWrites({
                rows,
                stagingRows,
                existingSourceRefs: Array.from(existingSourceRefs),
                replaceExisting: Boolean(approved && reprocess),
              });
              rowsToInsert = plannedWrites.rowsToInsert;
              rowsToUpdate = plannedWrites.rowsToUpdate;
              stagingRowsToInsert = plannedWrites.stagingRowsToInsert;
            }

            if (approved && reprocess && sourceRefs.length > 0) {
              await tx
                .update(canonicalTxns)
                .set({
                  status: "superseded",
                  metadata: sql`coalesce(${canonicalTxns.metadata}, '{}'::jsonb) || ${JSON.stringify({
                    supersededByDocumentReprocess: documentId,
                    supersededAt: new Date().toISOString(),
                    reason: "approved_reprocess_missing_source_ref",
                  })}::jsonb`,
                })
                .where(
                  and(
                    eq(canonicalTxns.companyId, companyId),
                    eq(canonicalTxns.rawEventId, rawEventId),
                    notInArray(canonicalTxns.sourceRef, sourceRefs),
                  ),
                );
            }

            for (const row of rowsToUpdate) {
              if (!row.sourceRef) continue;
              await tx
                .update(canonicalTxns)
                .set({
                  rawEventId: row.rawEventId,
                  connectionId: row.connectionId,
                  date: row.date,
                  amount: row.amount,
                  currency: row.currency,
                  amountUsd: row.amountUsd,
                  fxRate: row.fxRate,
                  description: row.description,
                  merchantName: row.merchantName,
                  merchantMcc: row.merchantMcc,
                  type: row.type,
                  status: row.status,
                  metadata: row.metadata,
                })
                .where(
                  and(
                    eq(canonicalTxns.companyId, companyId),
                    eq(canonicalTxns.rawEventId, rawEventId),
                    eq(canonicalTxns.sourceRef, row.sourceRef),
                  ),
                );
            }

            if (rowsToInsert.length > 0) {
              await tx.insert(canonicalTxns).values(rowsToInsert);
            }
            if (stagingRowsToInsert.length > 0) {
              await tx
                .insert(stagingRecords)
                .values(stagingRowsToInsert)
                .onConflictDoNothing();
            }

            return {
              insertedCount: rowsToInsert.length,
              updatedCount: rowsToUpdate.length,
              stagingCount: stagingRowsToInsert.length,
            };
          });

          return writeResult;
        },
      );
      const insertedCount = transactionWriteResult.insertedCount;
      const stagingCount = transactionWriteResult.stagingCount;

      // Step 9: Insert report staging_records for Company-DB (GL, P&L, balance sheet, etc.)
      const reportStagingCount = await step.run(
        "insert-report-staging-records",
        async () => {
          if (!isFinancialRoute) return 0;
          const reports = parseResult.reports as ExtractedReport[] | undefined;
          if (!reports || reports.length === 0) return 0;
          // Canonical finance cutover: structured report artifacts remain useful as
          // an internal parser substrate, but document-origin report snapshots
          // should no longer materialize into legacy finance/snapshots records.
          // The new canonical finance lane and evidence lane now own finance-doc output.
          return 0;
        },
      );

      const canonicalFinanceStagingCount = await step.run(
        "insert-canonical-finance-staging-records",
        async () => {
          if (shouldGateDecisionGradeFinance) return 0;
          if (!isFinancialRoute) return 0;
          const canonicalFinance = parseResult.canonicalFinance;
          if (!canonicalFinance || canonicalFinance.records.length === 0) return 0;

          let companySlug: string;
          try {
            companySlug = await getCompanySlug(companyId);
          } catch (error) {
            console.warn(
              `[process-document] Skipping canonical finance staging for document ${documentId}: failed to resolve company slug for company ${companyId}`,
              error,
            );
            return 0;
          }

          const stagingRows = buildCanonicalFinanceStagingRows({
            companySlug,
            documentId,
            companyCurrency: doc.reportingCurrency,
            bundle: canonicalFinance,
          });
          if (stagingRows.length === 0) return 0;

          await db
            .insert(stagingRecords)
            .values(stagingRows)
            .onConflictDoUpdate({
              target: [
                stagingRecords.companySlug,
                stagingRecords.source,
                stagingRecords.externalId,
              ],
              set: {
                payload: sql`EXCLUDED.payload`,
                status: "pending",
                lockedBy: sql`NULL`,
                lockedUntil: sql`NULL`,
                retries: 0,
                nextRetryAt: sql`NULL`,
                error: sql`NULL`,
                commitSha: sql`NULL`,
                entityIds: sql`NULL`,
                updatedAt: sql`now()`,
              },
            });

          return stagingRows.length;
        },
      );

      const bankBalanceStagingCount = await step.run(
        "insert-bank-balance-staging-records",
        async () => {
          if (shouldGateDecisionGradeFinance) return 0;
          const snapshot = parseResult.bankBalanceSnapshot;
          if (!snapshot || snapshot.accountCount === 0) return 0;

          let companySlug: string;
          try {
            companySlug = await getCompanySlug(companyId);
          } catch (error) {
            console.warn(
              `[process-document] Skipping bank balance staging for document ${documentId}: failed to resolve company slug for company ${companyId}`,
              error,
            );
            return 0;
          }

          const stagingRows = buildBankBalanceStagingRows({
            companySlug,
            documentId,
            sourceDocumentName: parseResult.fileName,
            snapshot,
          });
          if (stagingRows.length === 0) return 0;

          await db
            .insert(stagingRecords)
            .values(stagingRows)
            .onConflictDoUpdate({
              target: [
                stagingRecords.companySlug,
                stagingRecords.source,
                stagingRecords.externalId,
              ],
              set: {
                payload: sql`EXCLUDED.payload`,
                status: "pending",
                lockedBy: sql`NULL`,
                lockedUntil: sql`NULL`,
                retries: 0,
                nextRetryAt: sql`NULL`,
                error: sql`NULL`,
                commitSha: sql`NULL`,
                entityIds: sql`NULL`,
                updatedAt: sql`now()`,
              },
            });

          return stagingRows.length;
        },
      );

      // Step 10: Always stage an evidence-layer document import when split mode is on.
      // This keeps every uploaded document represented in Company-DB even when
      // deeper structured ingestion is gated by review requirements.
      const documentEvidenceStagingCount = await step.run(
        "insert-document-evidence-staging-records",
        async () => {
          if (!shouldStageDocumentEvidence(flags)) return 0;

          let companySlug: string;
          try {
            companySlug = await getCompanySlug(companyId);
          } catch (error) {
            console.warn(
              `[process-document] Skipping evidence staging for document ${documentId}: failed to resolve company slug for company ${companyId}`,
              error,
            );
            return 0;
          }

          const primaryDomain = classification.candidate_domains[0] ?? "documents";
          const hasCanonicalFinance =
            (parseResult.canonicalFinance?.records?.length ?? 0) > 0 ||
            ((parseResult.reports as ExtractedReport[] | undefined)?.length ?? 0) > 0;
          const evidenceDomain =
            classification.document_kind === "financial" && hasCanonicalFinance
              ? "documents"
              : primaryDomain;
          const docTypePart = (parseResult.documentType ?? "unknown")
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 64) || "unknown";
          const source = `doc-import:${evidenceDomain}`;
          const externalId = `doc:${documentId}:${evidenceDomain}:${docTypePart}:v1`;

          const payload = {
            documentId,
            fileType,
            fileName: parseResult.fileName,
            documentType: parseResult.documentType ?? null,
            confidence: parseResult.confidence,
            metadata: parseResult.metadata ?? {},
            needs_review: needsReview,
            requires_review: needsReview,
            review_pending: needsReview && !approved,
            evidence_status: "captured",
            ingestion_mode: needsReview && !approved ? "needs_review" : "auto_ingest",
            ingestion_reason:
              needsReview && !approved
                ? "Stored as evidence in Company-DB; decision-grade structured ingestion remains review-gated."
                : "Stored as evidence in Company-DB through the universal ingestion pipeline.",
            document_kind: classification.document_kind,
            target_domain: primaryDomain,
            target_entity_type: parseResult.documentType ?? null,
            approved: approved ?? false,
            storage_key: storageKey ?? null,
            storage_url: storageUrl ?? null,
            classification,
            guardrails: {
              needs_review_finance_promotion: {
                ...guardrailMetadata(needsReviewPromotionGuardrail),
                would_block_decision_grade_promotion:
                  needsReviewPromotionDecision.wouldBlockDecisionGradePromotion,
                blocked_decision_grade_promotion: shouldGateDecisionGradeFinance,
              },
            },
          } as Record<string, unknown>;

          await db
            .insert(stagingRecords)
            .values([
              {
                companySlug,
                source,
                externalId,
                payload,
                status: "pending" as const,
              },
            ])
            .onConflictDoUpdate({
              target: [
                stagingRecords.companySlug,
                stagingRecords.source,
                stagingRecords.externalId,
              ],
              set: {
                payload: sql`EXCLUDED.payload`,
                status: "pending",
                lockedBy: sql`NULL`,
                lockedUntil: sql`NULL`,
                retries: 0,
                nextRetryAt: sql`NULL`,
                error: sql`NULL`,
                commitSha: sql`NULL`,
                entityIds: sql`NULL`,
                updatedAt: sql`now()`,
              },
            });

          return 1;
        },
      );

      // Step 11: Update document status
      await step.run("update-document", async () => {
        const reports = parseResult.reports as ExtractedReport[] | undefined;
        const firstReport = reports?.[0];
        const previousOcrResult = normalizeOcrResult(doc.ocrResult) ?? {};
        const nextOcrResult: Record<string, unknown> = buildQueuedCodexAuditOcrResult({
          ...previousOcrResult,
          ...(parseResult.metadata ?? {}),
          classification,
          routing: {
            classifier_enabled: flags.classifierEnabled,
            split_enabled: flags.routerSplitEnabled,
            non_financial_writer_enabled: flags.nonFinancialWriterEnabled,
            ingress_assist_non_fin_enabled:
              flags.ingressAssistNonFinancialEnabled,
            ingress_autoroute_low_risk_enabled:
              flags.ingressAutoRouteLowRiskEnabled,
            ingress_budget_guard_enabled: flags.ingressBudgetGuardEnabled,
            non_financial_daily_cap: budgetGuardDecision.nonFinancialDailyCap,
            non_financial_used_today: budgetGuardDecision.usedToday,
            non_financial_window_start: budgetGuardDecision.windowStartIso,
            budget_guard_exhausted: budgetGuardDecision.exhausted,
            budget_guard_reason: budgetGuardDecision.reason,
            branch: isFinancialRoute ? "financial" : classification.document_kind,
          },
          canonical_finance: buildCanonicalFinanceOcrState(parseResult.canonicalFinance),
          guardrails: {
            needs_review_finance_promotion: {
              ...guardrailMetadata(needsReviewPromotionGuardrail),
              would_block_decision_grade_promotion:
                needsReviewPromotionDecision.wouldBlockDecisionGradePromotion,
              blocked_decision_grade_promotion: shouldGateDecisionGradeFinance,
            },
          },
          bank_balance: parseResult.bankBalanceSnapshot
            ? {
                as_of_date: parseResult.bankBalanceSnapshot.asOfDate,
                reporting_currency: parseResult.bankBalanceSnapshot.reportingCurrency,
                total_idr: parseResult.bankBalanceSnapshot.totalIdr,
                company_count: parseResult.bankBalanceSnapshot.companyCount,
                account_count: parseResult.bankBalanceSnapshot.accountCount,
                source_sheets: parseResult.bankBalanceSnapshot.sourceSheets,
                warnings: parseResult.bankBalanceSnapshot.warnings,
              }
            : undefined,
        });

        const nextStatus = (needsReview && !approved) ? "needs_review" : "completed";
        await db
          .update(documents)
          .set({
            status: nextStatus,
            // Tier A1 dual-write: needs_review and completed both mean the
            // parser finished — terminal-success from the pipeline's POV.
            processingStage: "parsed",
            error: null,
            extractedTxnCount: needsReviewPromotionDecision.extractedTxnCount,
            confidenceScore: String(parseResult.confidence),
            documentType: parseResult.documentType ?? null,
            ocrResult: nextOcrResult,
            reportingPeriod: firstReport
              ? (firstReport.reporting_period.label || firstReport.reporting_period.start)
              : null,
          })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.companyId, companyId),
            ),
          );
        // chat_attachments.status is no longer the source of truth — readers
        // derive from documents.status via JOIN. Tier A4.
      });

      const totalStagingCreated =
        stagingCount +
        reportStagingCount +
        canonicalFinanceStagingCount +
        bankBalanceStagingCount +
        documentEvidenceStagingCount;

      if (totalStagingCreated > 0 && !shouldGateDecisionGradeFinance) {
        await step.run("trigger-reconciliation", async () => {
          try {
            const companySlug = await getCompanySlug(companyId);
            return await triggerReconciliationForCompany(companySlug);
          } catch (error) {
            console.error(
              `[reconciliation-trigger] Failed for document ${documentId}:`,
              error,
            );
            return {
              processed: 0,
              failed: 0,
              skipped: 0,
              recovered: 0,
            };
          }
        });
      }

      return {
        documentId,
        transactionsInserted: insertedCount,
        stagingRecordsCreated: stagingCount,
        reportStagingRecordsCreated: reportStagingCount,
        canonicalFinanceStagingRecordsCreated: canonicalFinanceStagingCount,
        bankBalanceStagingRecordsCreated: bankBalanceStagingCount,
        nonFinancialStagingRecordsCreated: documentEvidenceStagingCount,
        classification,
        confidence: parseResult.confidence,
        metadata: parseResult.metadata,
        needsReview,
        guardrails: {
          needsReviewFinancePromotion: {
            ...guardrailMetadata(needsReviewPromotionGuardrail),
            wouldBlockDecisionGradePromotion:
              needsReviewPromotionDecision.wouldBlockDecisionGradePromotion,
            blockedDecisionGradePromotion: shouldGateDecisionGradeFinance,
          },
        },
      };
    } catch (error) {
      // Update document status to failed with error message
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
