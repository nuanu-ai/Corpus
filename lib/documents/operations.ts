import { randomUUID, createHash } from "crypto";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import {
  queryAllEntities,
  submitCompanyDbDelete,
} from "@/lib/company-db/client";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { resolveCompanyCodexWorkerPool } from "@/lib/codex-worker/pool";
import {
  getEffectiveDocumentSource,
  getCodexSourceContext,
  mergeCodexSourceContext,
} from "@/lib/codex-worker/source-context";
import { normalizeOcrResult } from "@/lib/codex-worker/ocr-result";
import {
  buildQueuedCodexOcrResult,
  getCodexPreprocessState,
  summarizeCodexState,
} from "@/lib/codex-worker/status";
import {
  buildQueuedCodexAuditOcrResult,
  summarizeCodexAudit,
} from "@/lib/codex-worker/audit-status";
import { summarizeCodexPromotion } from "@/lib/codex-worker/promotion";
import { db } from "@/lib/db";
import { auditLog, chatAttachments, companies, documents, rawEvents } from "@/lib/db/schema";
import {
  countPendingClarificationQuestions,
  getCodexReviewSummary,
  sourceFolderFromContext,
} from "@/lib/documents/clarifications";
import { buildDocumentImportTemplateDefaults } from "@/lib/documents/import-templates";
import {
  inferDownloadMimeType,
  inferFileType,
  normalizeFileNameForMimeType,
  validateUploadFile,
} from "@/lib/documents";
import {
  getLargeFileFallbackState,
  LARGE_FILE_CHUNK_ROLE,
  LARGE_FILE_PARENT_ROLE,
} from "@/lib/documents-large-file";
import {
  buildDocumentIngressEvent,
  buildSimplifiedNarrativeShadowEvent,
  shouldUsePostIngressDispatch,
} from "@/lib/inngest/document-ingress-events";
import { summarizeIngressDispatchState } from "@/lib/inngest/ingress-dispatch-state";
import { enqueueOutboxEvent } from "@/lib/outbox";
import { buildStorageKey, storage } from "@/lib/storage";

export interface ListedDocument {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  source: string;
  status: string;
  extractedTxnCount: number | null;
  confidenceScore: string | null;
  error: string | null;
  documentType: string | null;
  reportingPeriod: string | null;
  createdAt: Date;
  reviewRequired: boolean;
  reviewFlags: string[];
  overallConfidence: string | null;
  clarificationPendingCount: number;
  codex: Record<string, unknown> | null;
  promotion: Record<string, unknown> | null;
  audit: Record<string, unknown> | null;
  ingressDispatch: ReturnType<typeof summarizeIngressDispatchState>;
  sourceContext: ReturnType<typeof getCodexSourceContext>;
  sourceFile: DocumentDownloadDescriptor | null;
}

export interface DocumentStatusRecord {
  id: string;
  fileName: string;
  fileType: string;
  status: string;
  extractedTxnCount: number | null;
  confidenceScore: string | null;
  error: string | null;
  createdAt: Date;
  sourceFile: DocumentDownloadDescriptor | null;
}

export interface DocumentDownloadDescriptor {
  document: {
    id: string;
    fileName: string;
    fileType: string;
    status: string;
    contentType: string;
  };
  viewPath: string;
  viewUrl: string | null;
  downloadPath: string;
  downloadUrl: string | null;
  requiresAuthorization: true;
}

export interface DeleteDocumentResult {
  success: true;
  alreadyDeleted?: true;
  removedPaths: string[];
  commits?: Array<{ domain: string; commitSha: string | null; fileCount: number }>;
}

export interface ReprocessDocumentResult {
  success: true;
  mode: "codex_queue" | "ingest_event";
  removedPaths: string[];
  commits?: Array<{ domain: string; commitSha: string | null; fileCount: number }>;
}

export interface QueueDocumentAuditResult {
  success: true;
  documentId: string;
  status: "queued";
}

export interface CreatedCompanyDocumentResult {
  documentId: string;
  fileName: string;
  fileType: string;
  status: "processing";
}

const DEFAULT_DOCUMENT_LIST_LIMIT = 50;
const MAX_DOCUMENT_LIST_LIMIT = 200;
const MAX_ATTENTION_FIRST_SCAN_LIMIT = 500;
function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isNonEmptyStorageKey(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DOCUMENT_LIST_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(value), 1), MAX_DOCUMENT_LIST_LIMIT);
}

function normalizeOffset(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(Math.trunc(value), 0);
}

function normalizeBaseUrl(baseUrl: string | null | undefined): string | null {
  if (typeof baseUrl !== "string") return null;
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, "");
}

function compareListedDocumentAttentionOrder(
  left: { clarificationPendingCount: number; createdAt: Date },
  right: { clarificationPendingCount: number; createdAt: Date },
): number {
  const pendingDiff =
    Math.max(0, right.clarificationPendingCount) -
    Math.max(0, left.clarificationPendingCount);
  if (pendingDiff !== 0) return pendingDiff;
  return right.createdAt.getTime() - left.createdAt.getTime();
}

function normalizeDownloadPathPrefix(prefix: string | null | undefined): string {
  if (typeof prefix !== "string") {
    return "/api/documents";
  }
  const trimmed = prefix.trim();
  if (!trimmed) {
    return "/api/documents";
  }
  return trimmed.startsWith("/") ? trimmed.replace(/\/$/, "") : `/${trimmed.replace(/\/$/, "")}`;
}

function buildDocumentDownloadDescriptor(
  doc: {
    id: string;
    fileName: string;
    fileType: string;
    status: string;
    storageUrl: string | null;
  },
  baseUrl?: string | null,
  downloadPathPrefix?: string | null,
): DocumentDownloadDescriptor | null {
  if (!isNonEmptyStorageKey(doc.storageUrl)) {
    return null;
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const pathPrefix = normalizeDownloadPathPrefix(downloadPathPrefix);
  const downloadPath = `${pathPrefix}/${doc.id}/download`;
  const viewPath = `${downloadPath}?disposition=inline`;

  return {
    document: {
      id: doc.id,
      fileName: doc.fileName,
      fileType: doc.fileType,
      status: doc.status,
      contentType: inferDownloadMimeType(doc.fileName, doc.fileType),
    },
    viewPath,
    viewUrl: normalizedBaseUrl ? `${normalizedBaseUrl}${viewPath}` : null,
    downloadPath,
    downloadUrl: normalizedBaseUrl ? `${normalizedBaseUrl}${downloadPath}` : null,
    requiresAuthorization: true,
  };
}

function excludeLargeFileChunkDocuments() {
  return sql<boolean>`coalesce(${documents.ocrResult} -> 'large_file_fallback' ->> 'role', '') <> 'chunk'`;
}

function rawEventPayloadText(key: string) {
  return sql<string | null>`${rawEvents.rawPayload}->>${key}`;
}

async function resolveLargeFileFamilyDocumentIds(input: {
  companyId: string;
  documentId: string;
  ocrResult: unknown;
}): Promise<string[]> {
  const state = getLargeFileFallbackState(input.ocrResult);
  if (!state) {
    return [input.documentId];
  }

  if (state.role === LARGE_FILE_PARENT_ROLE) {
    return unique([input.documentId, ...state.child_document_ids]);
  }

  const parentId = state.parent_document_id;
  const [parentDoc] = await db
    .select({
      id: documents.id,
      ocrResult: documents.ocrResult,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, parentId),
        eq(documents.companyId, input.companyId),
      ),
    )
    .limit(1);

  const parentState = getLargeFileFallbackState(parentDoc?.ocrResult ?? null);
  if (parentState?.role === LARGE_FILE_PARENT_ROLE) {
    return unique([parentId, ...parentState.child_document_ids]);
  }

  return unique([input.documentId, parentId]);
}

async function findGoogleDriveRawEventForDocument(input: {
  companyId: string;
  documentId: string;
}) {
  const [row] = await db
    .select({
      connectionId: rawEvents.connectionId,
      driveFileId: rawEventPayloadText("driveFileId"),
      mimeType: rawEventPayloadText("mimeType"),
      fileName: rawEventPayloadText("fileName"),
      sourcePath: rawEventPayloadText("sourcePath"),
      rootPath: rawEventPayloadText("rootPath"),
      connectionLabel: rawEventPayloadText("connectionLabel"),
      ingressSource: rawEventPayloadText("ingressSource"),
    })
    .from(rawEvents)
    .where(
      and(
        eq(rawEvents.companyId, input.companyId),
        eq(rawEvents.source, "google_drive"),
        eq(rawEvents.sourceEventId, input.documentId),
      ),
    )
    .orderBy(desc(rawEvents.receivedAt))
    .limit(1);

  return row ?? null;
}

async function removeLinkedCompanyDbArtifactsForDocument(input: {
  companySlug: string;
  documentId: string;
  callerId: string;
  callerRole: string;
  port: number;
  writeQueuePort: number;
}) {
  const linkedEntities = await queryAllEntities(
    {
      documentId: input.documentId,
      view: "full",
    },
    {
      companySlug: input.companySlug,
      callerId: input.callerId,
      callerRole: input.callerRole,
      port: input.port,
    },
  );
  const technicalSidecars = await queryAllEntities(
    {
      documentId: input.documentId,
      type: "statement_lines_technical",
      view: "full",
    },
    {
      companySlug: input.companySlug,
      callerId: input.callerId,
      callerRole: input.callerRole,
      port: input.port,
    },
  );

  const linkedPaths = unique(
    [...linkedEntities, ...technicalSidecars]
      .map((entity) => entity.filePath)
      .filter((filePath) => filePath.endsWith(".qmd"))
      .filter((filePath) => !filePath.endsWith("/_summary.qmd")),
  );

  const pathsByDomain = new Map<string, string[]>();
  for (const filePath of linkedPaths) {
    const domain = filePath.split("/")[0];
    if (!domain) continue;
    const bucket = pathsByDomain.get(domain) ?? [];
    bucket.push(filePath);
    pathsByDomain.set(domain, bucket);
  }

  const deleteCommits: Array<{ domain: string; commitSha: string | null; fileCount: number }> = [];
  for (const [domain, filePaths] of pathsByDomain.entries()) {
    const result = await submitCompanyDbDelete(
      input.companySlug,
      {
        domain,
        filePaths,
        commitMessage: `${domain}: delete document ${input.documentId}`,
        metadata: {
          source: "documents-delete",
          documentId: input.documentId,
          deletedBy: input.callerId,
        },
      },
      input.writeQueuePort,
    );
    deleteCommits.push({
      domain,
      commitSha: result.commitSha,
      fileCount: filePaths.length,
    });
  }

  const affectedDomains = unique(Array.from(pathsByDomain.keys())).filter(
    (domain) => domain !== "people",
  );
  if (affectedDomains.length > 0) {
    await refreshSummaryTargets({
      companySlug: input.companySlug,
      port: input.port,
      writeQueuePort: input.writeQueuePort,
      domains: affectedDomains,
      reason: "manual_delete",
    }).catch(() => null);
  }

  return {
    linkedPaths,
    deleteCommits,
  };
}

export async function listDocumentsForCompany(input: {
  companyId: string;
  status?: string | null;
  source?: string | null;
  includeDeleted?: boolean;
  includeChunkChildren?: boolean;
  attentionFirst?: boolean;
  limit?: number | null;
  offset?: number | null;
  baseUrl?: string | null;
  downloadPathPrefix?: string | null;
}) {
  const limit = normalizeLimit(input.limit);
  const offset = normalizeOffset(input.offset);
  const status = typeof input.status === "string" && input.status.trim().length > 0
    ? input.status.trim()
    : null;
  const source = typeof input.source === "string" && input.source.trim().length > 0
    ? input.source.trim()
    : null;

  const filters = [eq(documents.companyId, input.companyId)];
  if (!input.includeDeleted) {
    filters.push(ne(documents.status, "deleted"));
  }
  if (status) {
    filters.push(eq(documents.status, status));
  }
  if (source) {
    filters.push(eq(documents.source, source));
  }

  const whereClause = and(...filters);
  const visibleWhereClause = input.includeChunkChildren
    ? whereClause
    : and(whereClause, excludeLargeFileChunkDocuments());
  const canScanForAttention =
    input.attentionFirst === true && offset === 0 && !status && !source;
  const queryLimit = canScanForAttention
    ? Math.min(Math.max(limit * 10, limit), MAX_ATTENTION_FIRST_SCAN_LIMIT)
    : limit;
  const [rows, totalRows, companyRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        fileName: documents.fileName,
        fileType: documents.fileType,
        fileSizeBytes: documents.fileSizeBytes,
        source: documents.source,
        status: documents.status,
        storageUrl: documents.storageUrl,
        extractedTxnCount: documents.extractedTxnCount,
        confidenceScore: documents.confidenceScore,
        error: documents.error,
        documentType: documents.documentType,
        reportingPeriod: documents.reportingPeriod,
        createdAt: documents.createdAt,
        ocrResult: documents.ocrResult,
      })
      .from(documents)
      .where(visibleWhereClause)
      .orderBy(desc(documents.createdAt))
      .limit(queryLimit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(documents)
      .where(visibleWhereClause),
    db
      .select({ settings: companies.settings })
      .from(companies)
      .where(eq(companies.id, input.companyId))
      .limit(1),
  ]);

  const total = totalRows[0]?.total ?? 0;
  const companySettings = companyRows[0]?.settings;
  const listedDocuments = rows.map((row) => {
    const review = getCodexReviewSummary(row.ocrResult);
    const sourceContext = getCodexSourceContext(row.ocrResult);
    const clarificationTemplateDefaults = buildDocumentImportTemplateDefaults(companySettings, {
      provider: sourceContext?.provider ?? null,
      sourceFolder: sourceFolderFromContext(sourceContext),
      documentKind: review?.documentKind ?? null,
      reportType: review?.normalizedMetadata.report_type ?? null,
    });
    return {
      id: row.id,
      fileName: row.fileName,
      fileType: row.fileType,
      fileSizeBytes: row.fileSizeBytes,
      source: getEffectiveDocumentSource(row.source, row.ocrResult),
      status: row.status,
      extractedTxnCount: row.extractedTxnCount,
      confidenceScore: row.confidenceScore,
      error: row.error,
      documentType: row.documentType,
      reportingPeriod: row.reportingPeriod,
      createdAt: row.createdAt,
      reviewRequired: review?.requiresReview ?? false,
      reviewFlags: review?.reviewFlags ?? [],
      overallConfidence: review?.overallConfidence ?? null,
      clarificationPendingCount: countPendingClarificationQuestions(row.ocrResult, {
        review,
        answers: clarificationTemplateDefaults,
      }),
      codex: summarizeCodexState(row.ocrResult),
      promotion: summarizeCodexPromotion(row.ocrResult),
      audit: summarizeCodexAudit(row.ocrResult),
      ingressDispatch: summarizeIngressDispatchState(row.ocrResult),
      sourceContext,
      sourceFile: buildDocumentDownloadDescriptor(
        row,
        input.baseUrl,
        input.downloadPathPrefix,
      ),
    };
  });
  const orderedDocuments = canScanForAttention
    ? [...listedDocuments].sort(compareListedDocumentAttentionOrder).slice(0, limit)
    : listedDocuments;

  return {
    documents: orderedDocuments,
    total,
    limit,
    offset,
    hasMore: offset + orderedDocuments.length < total,
    nextOffset: offset + orderedDocuments.length < total ? offset + orderedDocuments.length : null,
  };
}

export async function getDocumentStatusForCompany(input: {
  companyId: string;
  documentId: string;
  includeDeleted?: boolean;
  baseUrl?: string | null;
  downloadPathPrefix?: string | null;
}): Promise<DocumentStatusRecord | null> {
  const filters = [
    eq(documents.id, input.documentId),
    eq(documents.companyId, input.companyId),
  ];
  if (!input.includeDeleted) {
    filters.push(ne(documents.status, "deleted"));
  }

  const [doc] = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      fileType: documents.fileType,
      status: documents.status,
      storageUrl: documents.storageUrl,
      extractedTxnCount: documents.extractedTxnCount,
      confidenceScore: documents.confidenceScore,
      error: documents.error,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(...filters))
    .limit(1);

  if (!doc) {
    return null;
  }

  return {
    ...doc,
    sourceFile: buildDocumentDownloadDescriptor(
      doc,
      input.baseUrl,
      input.downloadPathPrefix,
    ),
  };
}

export async function createCompanyDocumentFromBytes(input: {
  companyId: string;
  userId: string;
  fileName: string;
  mimeType?: string | null;
  content: Buffer;
  source: string;
  ingressSource: string;
  rawPayload?: Record<string, unknown>;
}): Promise<CreatedCompanyDocumentResult> {
  const normalizedFileName = normalizeFileNameForMimeType(
    input.fileName,
    input.mimeType ?? "application/octet-stream"
  );
  const validation = validateUploadFile(
    {
      name: normalizedFileName,
      size: input.content.byteLength,
      type: input.mimeType ?? "application/octet-stream",
    },
    {
      maxFileSizeBytes: 25 * 1024 * 1024,
    }
  );

  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const documentId = randomUUID();
  const sha256 = createHash("sha256").update(input.content).digest("hex");
  const fileType = inferFileType(
    normalizedFileName,
    input.mimeType ?? "application/octet-stream"
  );
  const usePostIngressDispatch = shouldUsePostIngressDispatch({
    companyId: input.companyId,
    fileType,
  });
  const workerPool = usePostIngressDispatch
    ? null
    : await resolveCompanyCodexWorkerPool(input.companyId);
  const storedSource = usePostIngressDispatch ? input.ingressSource : "codex_upload";
  const eventType = usePostIngressDispatch
    ? `${input.ingressSource}.document.received`
    : "codex.document.queued";
  const initialOcrResult = usePostIngressDispatch
    ? null
    : mergeCodexSourceContext(
        buildQueuedCodexOcrResult(undefined, workerPool ?? undefined),
        {
          provider: input.ingressSource,
          sourcePath: normalizedFileName,
          rootPath: null,
          connectionLabel: null,
          ingressSource: input.ingressSource,
          driveFileId: null,
          inferredPeriod: null,
        },
      );
  const storageKey = buildStorageKey({
    companyId: input.companyId,
    documentId,
    sha256,
    fileName: normalizedFileName,
  });

  await storage.put(storageKey, input.content);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(documents).values({
        id: documentId,
        companyId: input.companyId,
        fileName: normalizedFileName,
        fileType,
        fileSizeBytes: input.content.byteLength,
        storageUrl: storageKey,
        sha256,
        source: storedSource,
        status: "processing",
        ocrResult: initialOcrResult,
      });

      await tx
        .insert(rawEvents)
        .values({
          companyId: input.companyId,
          sourceEventId: documentId,
          idempotencyKey: `${storedSource}:${documentId}`,
          source: storedSource,
          eventType,
          rawPayload: {
            documentId,
            fileName: normalizedFileName,
            fileType,
            fileSizeBytes: input.content.byteLength,
            sha256,
            storageKey,
            ingressSource: input.ingressSource,
            source: input.source,
            ...input.rawPayload,
          },
        })
        .onConflictDoNothing();

      await tx.insert(auditLog).values({
        companyId: input.companyId,
        userId: input.userId,
        action: "create",
        entityType: "document",
        entityId: documentId,
        newValue: {
          fileName: normalizedFileName,
          fileType,
          source: storedSource,
          ingressSource: input.ingressSource,
        },
      });

      if (usePostIngressDispatch) {
        await enqueueOutboxEvent(
          tx,
          buildDocumentIngressEvent({
            documentId,
            companyId: input.companyId,
            fileType,
            storageKey,
          }),
        );
      }

      const shadowEvent = buildSimplifiedNarrativeShadowEvent({
        documentId,
        companyId: input.companyId,
        fileType,
        storageKey,
      });
      if (shadowEvent) {
        await enqueueOutboxEvent(tx, shadowEvent);
      }
    });
  } catch (error) {
    await storage.remove(storageKey).catch(() => null);
    throw error;
  }

  return {
    documentId,
    fileName: normalizedFileName,
    fileType,
    status: "processing",
  };
}

export async function getDocumentDownloadDescriptor(input: {
  companyId: string;
  documentId: string;
  baseUrl?: string | null;
  downloadPathPrefix?: string | null;
}): Promise<DocumentDownloadDescriptor | null> {
  const [doc] = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      fileType: documents.fileType,
      status: documents.status,
      storageUrl: documents.storageUrl,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, input.documentId),
        eq(documents.companyId, input.companyId),
        ne(documents.status, "deleted"),
      ),
    )
    .limit(1);

  if (!doc) return null;

  return buildDocumentDownloadDescriptor(doc, input.baseUrl, input.downloadPathPrefix);
}

export async function deleteDocumentForCompany(input: {
  companyId: string;
  userId: string;
  role: string;
  documentId: string;
}): Promise<DeleteDocumentResult> {
  const companySlug = await getCompanySlug(input.companyId);
  const [doc] = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      storageUrl: documents.storageUrl,
      status: documents.status,
      ocrResult: documents.ocrResult,
      companyDbPort: companies.companyDbPort,
    })
    .from(documents)
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .where(and(eq(documents.id, input.documentId), eq(documents.companyId, input.companyId)))
    .limit(1);

  if (!doc) {
    throw new Error("Document not found");
  }

  if (doc.status === "deleted") {
    return {
      success: true,
      alreadyDeleted: true,
      removedPaths: [],
    };
  }

  const familyDocumentIds = await resolveLargeFileFamilyDocumentIds({
    companyId: input.companyId,
    documentId: input.documentId,
    ocrResult: doc.ocrResult,
  });
  const familyDocs = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      storageUrl: documents.storageUrl,
      status: documents.status,
    })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, input.companyId),
        inArray(documents.id, familyDocumentIds),
      ),
    );

  const port = doc.companyDbPort ?? 3100;
  const writeQueuePort = port + 1;
  const linkedPaths: string[] = [];
  const deleteCommits: Array<{ domain: string; commitSha: string | null; fileCount: number }> = [];
  for (const familyDoc of familyDocs) {
    if (familyDoc.status === "deleted") continue;
    const removal = await removeLinkedCompanyDbArtifactsForDocument({
      companySlug,
      documentId: familyDoc.id,
      callerId: input.userId,
      callerRole: input.role,
      port,
      writeQueuePort,
    });
    linkedPaths.push(...removal.linkedPaths);
    deleteCommits.push(...removal.deleteCommits);
    if (isNonEmptyStorageKey(familyDoc.storageUrl)) {
      await storage.remove(familyDoc.storageUrl).catch(() => {});
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({
        status: "deleted",
        error: "Deleted by user",
      })
      .where(
        and(
          eq(documents.companyId, input.companyId),
          inArray(documents.id, familyDocumentIds),
        ),
      );

    await tx
      .update(chatAttachments)
      .set({
        status: "deleted",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chatAttachments.companyId, input.companyId),
          inArray(chatAttachments.documentId, familyDocumentIds),
        ),
      );

    await tx.insert(auditLog).values({
      companyId: input.companyId,
      userId: input.userId,
      action: "delete_document",
      entityType: "document",
      entityId: input.documentId,
      oldValue: {
        fileName: doc.fileName,
        status: doc.status,
        linkedPaths: unique(linkedPaths),
        familyDocumentIds,
      },
      newValue: {
        status: "deleted",
      },
    });
  });

  return {
    success: true,
    removedPaths: unique(linkedPaths),
    commits: deleteCommits,
  };
}

export async function reprocessDocumentForCompany(input: {
  companyId: string;
  userId: string;
  role: string;
  documentId: string;
}): Promise<ReprocessDocumentResult> {
  const companySlug = await getCompanySlug(input.companyId);
  const [initialDoc] = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      fileType: documents.fileType,
      source: documents.source,
      storageUrl: documents.storageUrl,
      status: documents.status,
      error: documents.error,
      ocrResult: documents.ocrResult,
      companyDbPort: companies.companyDbPort,
    })
    .from(documents)
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .where(and(eq(documents.id, input.documentId), eq(documents.companyId, input.companyId)))
    .limit(1);

  if (!initialDoc) {
    throw new Error("Document not found");
  }

  let doc = initialDoc;
  let familyState = getLargeFileFallbackState(doc.ocrResult);
  if (familyState?.role === LARGE_FILE_CHUNK_ROLE) {
    const [parentDoc] = await db
      .select({
        id: documents.id,
        fileName: documents.fileName,
        fileType: documents.fileType,
        source: documents.source,
        storageUrl: documents.storageUrl,
        status: documents.status,
        error: documents.error,
        ocrResult: documents.ocrResult,
        companyDbPort: companies.companyDbPort,
      })
      .from(documents)
      .innerJoin(companies, eq(companies.id, documents.companyId))
      .where(
        and(
          eq(documents.id, familyState.parent_document_id),
          eq(documents.companyId, input.companyId),
        ),
      )
      .limit(1);

    if (parentDoc) {
      doc = parentDoc;
      familyState = getLargeFileFallbackState(doc.ocrResult);
    }
  }

  if (doc.status === "deleted") {
    throw new Error("Document not found");
  }

  if (doc.status === "processing") {
    throw new Error("Document is already processing");
  }

  const familyDocumentIds = await resolveLargeFileFamilyDocumentIds({
    companyId: input.companyId,
    documentId: doc.id,
    ocrResult: doc.ocrResult,
  });
  const familyDocs = await db
    .select({
      id: documents.id,
      storageUrl: documents.storageUrl,
    })
    .from(documents)
    .where(
      and(
        eq(documents.companyId, input.companyId),
        inArray(documents.id, familyDocumentIds),
      ),
    );
  const port = doc.companyDbPort ?? 3100;
  const writeQueuePort = port + 1;
  const linkedPaths: string[] = [];
  const deleteCommits: Array<{ domain: string; commitSha: string | null; fileCount: number }> = [];
  for (const documentId of familyDocumentIds) {
    const removal = await removeLinkedCompanyDbArtifactsForDocument({
      companySlug,
      documentId,
      callerId: input.userId,
      callerRole: input.role,
      port,
      writeQueuePort,
    });
    linkedPaths.push(...removal.linkedPaths);
    deleteCommits.push(...removal.deleteCommits);
  }

  for (const familyDoc of familyDocs) {
    if (familyDoc.id === doc.id) continue;
    if (!isNonEmptyStorageKey(familyDoc.storageUrl)) continue;
    await storage.remove(familyDoc.storageUrl).catch(() => {});
  }

  const isGoogleDriveLargeFileParent =
    familyState?.role === LARGE_FILE_PARENT_ROLE &&
    getEffectiveDocumentSource(doc.source, doc.ocrResult) === "google_drive";
  const effectiveSource = getEffectiveDocumentSource(doc.source, doc.ocrResult);
  const shouldProbeGoogleDriveRawEvent =
    effectiveSource === "google_drive" ||
    doc.source === "codex_upload" ||
    isGoogleDriveLargeFileParent;
  const googleDriveRawEvent = shouldProbeGoogleDriveRawEvent
    ? await findGoogleDriveRawEventForDocument({
        companyId: input.companyId,
        documentId: doc.id,
      })
    : null;
  const canRedownloadFromGoogleDrive =
    !!googleDriveRawEvent?.driveFileId &&
    !!googleDriveRawEvent?.mimeType;

  if (!isNonEmptyStorageKey(doc.storageUrl) && !canRedownloadFromGoogleDrive) {
    throw new Error("Original file is not available for reprocessing");
  }

  const isCodexDocument =
    doc.source === "codex_upload" &&
    effectiveSource !== "google_drive" &&
    !canRedownloadFromGoogleDrive &&
    !isGoogleDriveLargeFileParent;
  const mode: ReprocessDocumentResult["mode"] = isCodexDocument ? "codex_queue" : "ingest_event";
  const workerPool =
    getCodexPreprocessState(doc.ocrResult)?.pool ??
    (await resolveCompanyCodexWorkerPool(input.companyId));
  const currentCodexAttempts = getCodexPreprocessState(doc.ocrResult)?.attempts ?? 0;
  const queuedCodexState = buildQueuedCodexOcrResult(undefined, workerPool);
  const shouldRedownloadFromGoogleDrive =
    isGoogleDriveLargeFileParent || canRedownloadFromGoogleDrive;
  if (shouldRedownloadFromGoogleDrive && (!googleDriveRawEvent?.driveFileId || !googleDriveRawEvent.mimeType)) {
    throw new Error("Original Google Drive metadata is not available for reprocessing");
  }
  const normalizedOcrResult = normalizeOcrResult(doc.ocrResult) ?? {};
  const {
    codex_preprocess: _oldCodexPreprocess,
    codex_review: _oldCodexReview,
    codex_promotion: _oldCodexPromotion,
    codex_audit: _oldCodexAudit,
    canonical_finance: _oldCanonicalFinance,
    ...preservedOcrResult
  } =
    normalizedOcrResult;
  const resetCodexOcrResult = isCodexDocument
    ? {
        ...preservedOcrResult,
        ...mergeCodexSourceContext({}, getCodexSourceContext(doc.ocrResult)),
        codex_preprocess: {
          ...(queuedCodexState.codex_preprocess as Record<string, unknown> | undefined),
          attempts: currentCodexAttempts + 1,
        },
      }
    : null;

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({
        status: "processing",
        processingStage: "received",
        error: null,
        extractedTxnCount: 0,
        confidenceScore: null,
        documentType: null,
        reportingPeriod: null,
        ocrResult:
          isCodexDocument
            ? resetCodexOcrResult
            : isGoogleDriveLargeFileParent
              ? null
              : null,
      })
      .where(and(eq(documents.id, doc.id), eq(documents.companyId, input.companyId)));

    if (familyDocumentIds.length > 1) {
      await tx
        .update(documents)
        .set({
          status: "deleted",
          error: "Superseded by reprocess",
        })
        .where(
          and(
            eq(documents.companyId, input.companyId),
            inArray(
              documents.id,
              familyDocumentIds.filter((documentId) => documentId !== doc.id),
            ),
          ),
        );
    }

    await tx
      .update(chatAttachments)
      .set({
        status: "processing",
        updatedAt: new Date(),
      })
      .where(and(eq(chatAttachments.companyId, input.companyId), eq(chatAttachments.documentId, doc.id)));

    await tx.insert(auditLog).values({
      companyId: input.companyId,
      userId: input.userId,
      action: "reprocess_document",
      entityType: "document",
      entityId: doc.id,
      oldValue: {
        fileName: doc.fileName,
        status: doc.status,
        error: doc.error,
        linkedPaths: unique(linkedPaths),
        familyDocumentIds,
      },
      newValue: {
        status: "processing",
        mode,
      },
    });

    if (shouldRedownloadFromGoogleDrive) {
      await enqueueOutboxEvent(tx, {
        name: "document/gdrive-download",
        data: {
          documentId: doc.id,
          companyId: input.companyId,
          connectionId: googleDriveRawEvent?.connectionId ?? undefined,
          fileId: googleDriveRawEvent?.driveFileId,
          fileName: googleDriveRawEvent?.fileName ?? doc.fileName,
          mimeType: googleDriveRawEvent?.mimeType,
          fileType: doc.fileType,
          sourcePath: googleDriveRawEvent?.sourcePath ?? undefined,
          rootPath: googleDriveRawEvent?.rootPath ?? undefined,
          connectionLabel: googleDriveRawEvent?.connectionLabel ?? undefined,
          ingressSource: googleDriveRawEvent?.ingressSource ?? undefined,
        },
      });
    } else if (!isCodexDocument) {
      await enqueueOutboxEvent(
        tx,
        buildDocumentIngressEvent({
          documentId: doc.id,
          companyId: input.companyId,
          fileType: doc.fileType,
          storageKey: doc.storageUrl,
          reprocess: true,
        }),
      );
      const shadowEvent = buildSimplifiedNarrativeShadowEvent({
        documentId: doc.id,
        companyId: input.companyId,
        fileType: doc.fileType,
        storageKey: doc.storageUrl,
        reprocess: true,
      });
      if (shadowEvent) {
        await enqueueOutboxEvent(tx, shadowEvent);
      }
    }
  });

  return {
    success: true,
    mode,
    removedPaths: unique(linkedPaths),
    commits: deleteCommits,
  };
}

export async function queueDocumentAuditForCompany(input: {
  companyId: string;
  userId: string;
  documentId: string;
}): Promise<QueueDocumentAuditResult> {
  const [doc] = await db
    .select({
      id: documents.id,
      status: documents.status,
      ocrResult: documents.ocrResult,
      storageUrl: documents.storageUrl,
    })
    .from(documents)
    .where(and(eq(documents.id, input.documentId), eq(documents.companyId, input.companyId)))
    .limit(1);

  if (!doc || doc.status === "deleted") {
    throw new Error("Document not found");
  }

  if (doc.status === "processing") {
    throw new Error("Document is already processing");
  }

  if (!isNonEmptyStorageKey(doc.storageUrl)) {
    throw new Error("Original file is not available for audit");
  }

  const nextOcrResult = buildQueuedCodexAuditOcrResult(doc.ocrResult);

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({
        ocrResult: nextOcrResult,
      })
      .where(and(eq(documents.id, input.documentId), eq(documents.companyId, input.companyId)));

    await tx.insert(auditLog).values({
      companyId: input.companyId,
      userId: input.userId,
      action: "queue_document_audit",
      entityType: "document",
      entityId: input.documentId,
      newValue: {
        statusAtQueue: doc.status,
        stage: "queued",
      },
    });
  });

  return {
    success: true,
    documentId: input.documentId,
    status: "queued",
  };
}
