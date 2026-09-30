import { normalizeOcrResult } from "@/lib/codex-worker/ocr-result";
import {
  type CodexSourceContext,
  mergeCodexSourceContext,
} from "@/lib/codex-worker/source-context";
import {
  mergeDocumentClarificationState,
  normalizeClarificationAnswers,
  type ClarificationAnswerMap,
} from "@/lib/documents/clarifications";

export class InvalidDocumentUploadMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentUploadMetadataError";
  }
}

export interface DocumentUploadProvenance {
  sourceUrl?: string | null;
  externalDocumentId?: string | null;
  agentNotes?: string | null;
  rawMetadata?: Record<string, unknown> | null;
  receivedAt?: string | null;
  receivedBy?: string | null;
}

export interface ParsedDocumentUploadMetadata {
  sourceContext: CodexSourceContext | null;
  clarificationAnswers: ClarificationAnswerMap;
  provenance: DocumentUploadProvenance | null;
  rawMetadata: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function parseJsonRecord(raw: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new InvalidDocumentUploadMetadataError(`${label} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof InvalidDocumentUploadMetadataError) throw error;
    throw new InvalidDocumentUploadMetadataError(`${label} must be valid JSON`);
  }
}

function getTextField(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return normalizeString(value);
}

function getJsonField(formData: FormData, key: string): Record<string, unknown> | null {
  const raw = getTextField(formData, key);
  return raw ? parseJsonRecord(raw, key) : null;
}

function pickFirstRecord(...values: unknown[]): Record<string, unknown> | null {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return null;
}

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeSourceContext(
  raw: Record<string, unknown> | null,
  fallbackIngressSource: string,
): CodexSourceContext | null {
  const provider = pickFirstString(raw?.provider, raw?.sourceProvider);
  const sourcePath = pickFirstString(raw?.sourcePath, raw?.path, raw?.filePath);
  const rootPath = pickFirstString(raw?.rootPath, raw?.folderPath);
  const connectionLabel = pickFirstString(raw?.connectionLabel, raw?.connection);
  const ingressSource = pickFirstString(raw?.ingressSource, raw?.source) ?? fallbackIngressSource;
  const driveFileId = pickFirstString(raw?.driveFileId, raw?.googleDriveFileId);

  if (!provider && !sourcePath && !rootPath && !connectionLabel && !driveFileId && !ingressSource) {
    return null;
  }

  return {
    provider,
    sourcePath,
    rootPath,
    connectionLabel,
    ingressSource,
    driveFileId,
  };
}

function normalizeProvenance(input: {
  metadata: Record<string, unknown> | null;
  agentNotes: unknown;
  sourceUrl: unknown;
  externalDocumentId: unknown;
}): DocumentUploadProvenance | null {
  const sourceUrl = pickFirstString(
    input.sourceUrl,
    input.metadata?.sourceUrl,
    input.metadata?.url,
    input.metadata?.webUrl,
  );
  const externalDocumentId = pickFirstString(
    input.externalDocumentId,
    input.metadata?.externalDocumentId,
    input.metadata?.sourceId,
    input.metadata?.id,
  );
  const agentNotes = pickFirstString(
    input.agentNotes,
    input.metadata?.agentNotes,
    input.metadata?.notes,
    input.metadata?.description,
  );

  if (!sourceUrl && !externalDocumentId && !agentNotes && !input.metadata) {
    return null;
  }

  return {
    sourceUrl,
    externalDocumentId,
    agentNotes,
    rawMetadata: input.metadata,
  };
}

export function parseDocumentUploadMetadata(
  formData: FormData,
  options?: {
    fallbackIngressSource?: string;
  },
): ParsedDocumentUploadMetadata {
  const metadata =
    getJsonField(formData, "metadata") ??
    getJsonField(formData, "documentMetadata");
  const sourceContextInput: Record<string, unknown> = {
    ...(pickFirstRecord(
      getJsonField(formData, "sourceContext"),
      metadata?.sourceContext,
      metadata?.source_context,
    ) ?? {}),
  };
  for (const [key, value] of Object.entries({
    provider: getTextField(formData, "sourceProvider") ?? metadata?.sourceProvider,
    sourcePath: getTextField(formData, "sourcePath") ?? metadata?.sourcePath,
    rootPath: getTextField(formData, "rootPath") ?? metadata?.rootPath,
    connectionLabel:
      getTextField(formData, "connectionLabel") ?? metadata?.connectionLabel,
    ingressSource: getTextField(formData, "ingressSource") ?? metadata?.ingressSource,
    driveFileId: getTextField(formData, "driveFileId") ?? metadata?.driveFileId,
  })) {
    if (value !== null && value !== undefined) {
      sourceContextInput[key] = value;
    }
  }
  const sourceContext = normalizeSourceContext(
    sourceContextInput,
    options?.fallbackIngressSource ?? "upload",
  );
  const answerSource =
    getJsonField(formData, "clarificationAnswers") ??
    getJsonField(formData, "answers") ??
    pickFirstRecord(
      metadata?.clarificationAnswers,
      metadata?.answers,
      metadata?.documentQuestions,
    );
  const provenance = normalizeProvenance({
    metadata,
    agentNotes: getTextField(formData, "agentNotes"),
    sourceUrl: getTextField(formData, "sourceUrl"),
    externalDocumentId: getTextField(formData, "externalDocumentId"),
  });

  return {
    sourceContext,
    clarificationAnswers: normalizeClarificationAnswers(answerSource),
    provenance,
    rawMetadata: metadata,
  };
}

export function getDocumentUploadProvenance(
  ocrResult: unknown,
): DocumentUploadProvenance | null {
  const normalized = normalizeOcrResult(ocrResult);
  if (!normalized) return null;
  const raw = normalized.upload_provenance;
  if (!isRecord(raw)) return null;

  return {
    sourceUrl: normalizeString(raw.source_url),
    externalDocumentId: normalizeString(raw.external_document_id),
    agentNotes: normalizeString(raw.agent_notes),
    rawMetadata: isRecord(raw.raw_metadata) ? raw.raw_metadata : null,
    receivedAt: normalizeString(raw.received_at),
    receivedBy: normalizeString(raw.received_by),
  };
}

export function mergeDocumentUploadProvenance(
  ocrResult: unknown,
  provenance: DocumentUploadProvenance | null,
): Record<string, unknown> {
  const normalized = normalizeOcrResult(ocrResult) ?? {};
  if (!provenance) return normalized;

  return {
    ...normalized,
    upload_provenance: {
      source_url: provenance.sourceUrl ?? null,
      external_document_id: provenance.externalDocumentId ?? null,
      agent_notes: provenance.agentNotes ?? null,
      raw_metadata: provenance.rawMetadata ?? null,
      received_at: provenance.receivedAt ?? null,
      received_by: provenance.receivedBy ?? null,
    },
  };
}

export function buildInitialDocumentOcrResult(input: {
  baseOcrResult: unknown;
  metadata: ParsedDocumentUploadMetadata;
  answeredAt: string;
  answeredBy: string;
}): Record<string, unknown> | null {
  let next = normalizeOcrResult(input.baseOcrResult) ?? {};

  next = mergeCodexSourceContext(next, input.metadata.sourceContext);
  if (Object.keys(input.metadata.clarificationAnswers).length > 0) {
    next = mergeDocumentClarificationState(next, {
      answers: input.metadata.clarificationAnswers,
      answeredAt: input.answeredAt,
      answeredBy: input.answeredBy,
    });
  }
  if (input.metadata.provenance || input.metadata.rawMetadata) {
    next = mergeDocumentUploadProvenance(next, {
      ...(input.metadata.provenance ?? {}),
      rawMetadata: input.metadata.rawMetadata,
      receivedAt: input.answeredAt,
      receivedBy: input.answeredBy,
    });
  }

  return Object.keys(next).length > 0 ? next : null;
}

export function buildDocumentAgentWorkflow(
  documentId: string,
  baseUrl?: string | null,
) {
  const prefix = baseUrl ? baseUrl.replace(/\/$/, "") : "";
  return {
    documentsUrl: `${prefix}/api/documents`,
    statusUrl: `${prefix}/api/documents/status?documentId=${encodeURIComponent(documentId)}`,
    questionsUrl: `${prefix}/api/documents/${encodeURIComponent(documentId)}/clarifications`,
    questionQueueUrl: `${prefix}/api/documents/questions`,
    answerMethod: "POST",
    answerBody: {
      answers: {
        currency: "IDR",
        entity: "PT Example",
        report_type: "profit_and_loss",
        target_domain: "finance",
        period_label: "2026-02",
      },
      reprocess: true,
    },
  };
}
