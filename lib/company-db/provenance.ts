import type { EntityResult } from "@/lib/company-db/client";

export interface EntitySourceDocumentLink {
  documentId: string;
  fileName: string | null;
  adminPath: string;
  viewPath: string;
  downloadPath: string;
  requiresAuthorization: true;
}

export interface EntitySourceProvenance {
  originalDocument: EntitySourceDocumentLink | null;
  sourceEntityCount: number | null;
  sourceFileCount: number | null;
  evidenceStatus: string | null;
  reviewPending: boolean | null;
  ingestionMode: string | null;
  ingestionReason: string | null;
}

type EntityLike = Pick<EntityResult, "frontmatter" | "title">;

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function deriveDocumentId(frontmatter: Record<string, unknown>): string | null {
  const direct = readString(frontmatter.document_id);
  if (direct) return direct;

  const storagePath = readString(frontmatter.storage_path);
  if (storagePath?.startsWith("document:")) {
    const derived = storagePath.slice("document:".length).trim();
    return derived.length > 0 ? derived : null;
  }

  return null;
}

export function deriveEntitySourceProvenance(entity: EntityLike): EntitySourceProvenance {
  const frontmatter = entity.frontmatter ?? {};
  const documentId = deriveDocumentId(frontmatter);
  const fileName =
    readString(frontmatter.source_document_name) ??
    readString(frontmatter.source_file_name) ??
    readString(frontmatter.filename) ??
    readString(frontmatter.file_name) ??
    readString(entity.title);

  return {
    originalDocument: documentId
      ? {
          documentId,
          fileName,
          adminPath: `/admin/documents/${documentId}`,
          viewPath: `/api/documents/${documentId}/download?disposition=inline`,
          downloadPath: `/api/documents/${documentId}/download`,
          requiresAuthorization: true,
        }
      : null,
    sourceEntityCount: readNumber(frontmatter.source_entity_count),
    sourceFileCount: readNumber(frontmatter.source_file_count),
    evidenceStatus: readString(frontmatter.evidence_status),
    reviewPending: readBoolean(frontmatter.review_pending),
    ingestionMode: readString(frontmatter.ingestion_mode),
    ingestionReason: readString(frontmatter.ingestion_reason),
  };
}
