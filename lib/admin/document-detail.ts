import { and, desc, eq } from "drizzle-orm";

import { summarizeCodexPromotion } from "@/lib/codex-worker/promotion";
import { summarizeCodexState } from "@/lib/codex-worker/status";
import { summarizeCodexAudit } from "@/lib/codex-worker/audit-status";
import { getEffectiveDocumentSource } from "@/lib/codex-worker/source-context";
import { db } from "@/lib/db";
import { auditLog, companies, documents, rawEvents, users } from "@/lib/db/schema";
import {
  getLargeFileFallbackState,
  LARGE_FILE_CHUNK_ROLE,
  LARGE_FILE_PARENT_ROLE,
} from "@/lib/documents-large-file";
import { summarizeIngressDispatchState } from "@/lib/inngest/ingress-dispatch-state";

interface AdminDocumentAuditSummaryItem {
  label: string;
  value: string;
}

interface AdminCodexPromotionSummary {
  stage: string;
  updatedAt: string | null;
  completedAt: string | null;
  error: string | null;
  reportStagingCount: number;
  canonicalFinanceStagingCount: number;
  transactionStagingCount: number;
  nonFinancialStagingCount: number;
  promotedDomains: string[];
  reconciliation: Record<string, unknown> | null;
  classification: Record<string, unknown> | null;
}

interface AdminDocumentAuditEntry {
  id: string;
  action: string;
  createdAt: Date;
  actorName: string | null;
  actorEmail: string | null;
  summaryItems: AdminDocumentAuditSummaryItem[];
  error: string | null;
}

interface AdminDocumentActionEligibility {
  review: {
    eligible: boolean;
    availableActions: string[];
    reasons: string[];
  };
  reprocess: {
    eligible: boolean;
    reasons: string[];
    mode: "codex_queue" | "ingest_event" | null;
    effectiveDocumentId: string;
    effectiveFileName: string;
    effectiveSource: string;
    effectiveStatus: string;
    targetsParentDocument: boolean;
    canUseStoredOriginal: boolean;
    canRedownloadFromGoogleDrive: boolean;
  };
}

interface EligibilityDocumentRow {
  id: string;
  fileName: string;
  fileType: string;
  source: string;
  status: string;
  storageUrl: string;
  ocrResult: Record<string, unknown> | null;
}

export interface AdminDocumentDetail {
  document: {
    id: string;
    fileName: string;
    fileType: string;
    fileSizeBytes: number;
    sha256: string;
    source: string;
    status: string;
    error: string | null;
    documentType: string | null;
    reportingPeriod: string | null;
    extractedTxnCount: number | null;
    confidenceScore: string | number | null;
    createdAt: Date;
  };
  company: {
    id: string;
    name: string;
    slug: string | null;
  };
  ingressDispatch: ReturnType<typeof summarizeIngressDispatchState>;
  codexPreprocess: ReturnType<typeof summarizeCodexState>;
  codexPromotion: AdminCodexPromotionSummary | null;
  codexAudit: ReturnType<typeof summarizeCodexAudit>;
  actionEligibility: AdminDocumentActionEligibility;
  recentAuditEntries: AdminDocumentAuditEntry[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringifyAuditValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => stringifyAuditValue(item))
      .filter((item): item is string => Boolean(item));
    return items.length > 0 ? items.join(", ") : null;
  }
  return null;
}

function buildAuditSummaryItems(action: string, oldValue: unknown, newValue: unknown) {
  const items: AdminDocumentAuditSummaryItem[] = [];
  const oldRecord = asRecord(oldValue);
  const newRecord = asRecord(newValue);

  const addItem = (label: string, value: unknown) => {
    const rendered = stringifyAuditValue(value);
    if (!rendered) return;
    items.push({ label, value: rendered });
  };

  addItem("reason", newRecord?.reason);
  addItem("strategy", newRecord?.processingStrategy);
  addItem("target", newRecord?.dispatchTarget);
  addItem("event", newRecord?.dispatchEvent);
  addItem("routing", newRecord?.routingConfidence);
  addItem("extract", newRecord?.extractionConfidence);
  addItem("ocr", newRecord?.ocrNeeded);
  addItem("table", newRecord?.tableDensity);
  addItem("language", newRecord?.language);
  addItem("domain", newRecord?.domain);
  addItem("wordCount", newRecord?.wordCount);
  addItem("statusAtRun", newRecord?.statusAtRun);
  addItem("pool", newRecord?.pool);
  addItem("title", newRecord?.title);
  addItem("auditStatus", newRecord?.overallStatus);
  addItem("disposition", newRecord?.recommendedDisposition);
  addItem("issues", newRecord?.issueCount);
  addItem("warnings", newRecord?.warningCount);

  if (action === "delete_document") {
    addItem("oldStatus", oldRecord?.status);
    addItem("newStatus", newRecord?.status);
  }

  const reasons = Array.isArray(newRecord?.reasons)
    ? newRecord.reasons
        .map((reason) => stringifyAuditValue(reason))
        .filter((reason): reason is string => Boolean(reason))
    : [];
  if (reasons.length > 0) {
    items.push({ label: "reasons", value: reasons.join(", ") });
  }

  return items.slice(0, 8);
}

function isNonEmptyStorageKey(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getRawPayloadText(payload: unknown, key: string): string | null {
  const record = asRecord(payload);
  return stringifyAuditValue(record?.[key]);
}

function toAdminCodexPromotionSummary(ocrResult: unknown): AdminCodexPromotionSummary | null {
  const summary = summarizeCodexPromotion(ocrResult);
  const record = asRecord(summary);
  if (!record) return null;

  return {
    stage: stringifyAuditValue(record.stage) ?? "unknown",
    updatedAt: stringifyAuditValue(record.updatedAt),
    completedAt: stringifyAuditValue(record.completedAt),
    error: stringifyAuditValue(record.error),
    reportStagingCount:
      typeof record.reportStagingCount === "number" ? record.reportStagingCount : 0,
    canonicalFinanceStagingCount:
      typeof record.canonicalFinanceStagingCount === "number"
        ? record.canonicalFinanceStagingCount
        : 0,
    transactionStagingCount:
      typeof record.transactionStagingCount === "number" ? record.transactionStagingCount : 0,
    nonFinancialStagingCount:
      typeof record.nonFinancialStagingCount === "number" ? record.nonFinancialStagingCount : 0,
    promotedDomains: Array.isArray(record.promotedDomains)
      ? record.promotedDomains
          .map((domain) => stringifyAuditValue(domain))
          .filter((domain): domain is string => Boolean(domain))
      : [],
    reconciliation: asRecord(record.reconciliation),
    classification: asRecord(record.classification),
  };
}

async function resolveReprocessContext(
  doc: EligibilityDocumentRow,
  companyId: string,
): Promise<AdminDocumentActionEligibility["reprocess"]> {
  let effectiveDoc = doc;
  let targetsParentDocument = false;
  const familyState = getLargeFileFallbackState(doc.ocrResult);

  if (familyState?.role === LARGE_FILE_CHUNK_ROLE) {
    const [parentDoc] = await db
      .select({
        id: documents.id,
        fileName: documents.fileName,
        fileType: documents.fileType,
        source: documents.source,
        status: documents.status,
        storageUrl: documents.storageUrl,
        ocrResult: documents.ocrResult,
      })
      .from(documents)
      .where(and(eq(documents.id, familyState.parent_document_id), eq(documents.companyId, companyId)))
      .limit(1);

    if (parentDoc) {
      effectiveDoc = parentDoc;
      targetsParentDocument = true;
    }
  }

  const effectiveFamilyState = getLargeFileFallbackState(effectiveDoc.ocrResult);
  const effectiveSource = getEffectiveDocumentSource(
    effectiveDoc.source,
    effectiveDoc.ocrResult,
  );
  const canUseStoredOriginal = isNonEmptyStorageKey(effectiveDoc.storageUrl);

  let canRedownloadFromGoogleDrive = false;
  if (effectiveSource === "google_drive") {
    const [rawEvent] = await db
      .select({
        rawPayload: rawEvents.rawPayload,
      })
      .from(rawEvents)
      .where(
        and(
          eq(rawEvents.companyId, companyId),
          eq(rawEvents.source, "google_drive"),
          eq(rawEvents.sourceEventId, effectiveDoc.id),
        ),
      )
      .orderBy(desc(rawEvents.receivedAt))
      .limit(1);

    const driveFileId = getRawPayloadText(rawEvent?.rawPayload, "driveFileId");
    const mimeType = getRawPayloadText(rawEvent?.rawPayload, "mimeType");
    canRedownloadFromGoogleDrive = Boolean(driveFileId && mimeType);
  }

  const reasons: string[] = [];
  if (targetsParentDocument) reasons.push("targets_parent_document");
  if (effectiveDoc.status === "deleted") reasons.push("document_deleted");
  if (effectiveDoc.status === "processing") reasons.push("already_processing");
  if (canUseStoredOriginal) reasons.push("stored_original_available");
  if (canRedownloadFromGoogleDrive) reasons.push("google_drive_redownload_available");

  const eligible =
    effectiveDoc.status !== "deleted" &&
    effectiveDoc.status !== "processing" &&
    (canUseStoredOriginal || canRedownloadFromGoogleDrive);

  if (!eligible && !canUseStoredOriginal && !canRedownloadFromGoogleDrive) {
    reasons.push("original_unavailable");
  }

  const isGoogleDriveLargeFileParent =
    effectiveFamilyState?.role === LARGE_FILE_PARENT_ROLE &&
    effectiveSource === "google_drive";
  const mode =
    eligible
      ? effectiveDoc.source === "codex_upload" &&
        effectiveSource !== "google_drive" &&
        !isGoogleDriveLargeFileParent
        ? "codex_queue"
        : "ingest_event"
      : null;

  if (mode === "codex_queue") {
    reasons.push("codex_queue");
  } else if (mode === "ingest_event") {
    reasons.push("ingest_event");
  }

  return {
    eligible,
    reasons: Array.from(new Set(reasons)),
    mode,
    effectiveDocumentId: effectiveDoc.id,
    effectiveFileName: effectiveDoc.fileName,
    effectiveSource,
    effectiveStatus: effectiveDoc.status,
    targetsParentDocument,
    canUseStoredOriginal,
    canRedownloadFromGoogleDrive,
  };
}

async function resolveActionEligibility(
  doc: EligibilityDocumentRow,
  companyId: string,
): Promise<AdminDocumentActionEligibility> {
  return {
    review: {
      eligible: doc.status === "needs_review",
      availableActions: doc.status === "needs_review" ? ["approve", "reject", "requeue"] : [],
      reasons: doc.status === "needs_review" ? ["status_needs_review"] : [`status_${doc.status}`],
    },
    reprocess: await resolveReprocessContext(doc, companyId),
  };
}

export async function getAdminDocumentDetail(
  documentId: string,
): Promise<AdminDocumentDetail | null> {
  const [row] = await db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      fileType: documents.fileType,
      fileSizeBytes: documents.fileSizeBytes,
      storageUrl: documents.storageUrl,
      sha256: documents.sha256,
      source: documents.source,
      status: documents.status,
      error: documents.error,
      documentType: documents.documentType,
      reportingPeriod: documents.reportingPeriod,
      extractedTxnCount: documents.extractedTxnCount,
      confidenceScore: documents.confidenceScore,
      createdAt: documents.createdAt,
      ocrResult: documents.ocrResult,
      companyId: companies.id,
      companyName: companies.name,
      companySlug: companies.slug,
    })
    .from(documents)
    .innerJoin(companies, eq(companies.id, documents.companyId))
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!row) return null;

  const actionEligibility = await resolveActionEligibility(
    {
      id: row.id,
      fileName: row.fileName,
      fileType: row.fileType,
      source: row.source,
      status: row.status,
      storageUrl: row.storageUrl,
      ocrResult: row.ocrResult,
    },
    row.companyId,
  );

  const auditRows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      createdAt: auditLog.createdAt,
      oldValue: auditLog.oldValue,
      newValue: auditLog.newValue,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(
      and(
        eq(auditLog.companyId, row.companyId),
        eq(auditLog.entityType, "document"),
        eq(auditLog.entityId, row.id),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(10);

  return {
    document: {
      id: row.id,
      fileName: row.fileName,
      fileType: row.fileType,
      fileSizeBytes: row.fileSizeBytes,
      sha256: row.sha256,
      source: getEffectiveDocumentSource(row.source, row.ocrResult),
      status: row.status,
      error: row.error ?? null,
      documentType: row.documentType ?? null,
      reportingPeriod: row.reportingPeriod ?? null,
      extractedTxnCount: row.extractedTxnCount ?? null,
      confidenceScore: row.confidenceScore ?? null,
      createdAt: row.createdAt,
    },
    company: {
      id: row.companyId,
      name: row.companyName,
      slug: row.companySlug ?? null,
    },
    ingressDispatch: summarizeIngressDispatchState(row.ocrResult),
    codexPreprocess: summarizeCodexState(row.ocrResult),
    codexPromotion: toAdminCodexPromotionSummary(row.ocrResult),
    codexAudit: summarizeCodexAudit(row.ocrResult),
    actionEligibility,
    recentAuditEntries: auditRows.map((entry) => ({
      id: entry.id,
      action: entry.action,
      createdAt: entry.createdAt,
      actorName: entry.actorName ?? null,
      actorEmail: entry.actorEmail ?? null,
      summaryItems: buildAuditSummaryItems(entry.action, entry.oldValue, entry.newValue),
      error: stringifyAuditValue(asRecord(entry.newValue)?.error),
    })),
  };
}
