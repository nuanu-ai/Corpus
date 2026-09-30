export type ReportSourceStatus = "available" | "partial" | "unavailable" | "failed";

export interface ReportSourceEvidenceRef {
  id: string;
  source: string;
  title?: string;
  url?: string;
  recordType?: string;
  observedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ReportSourceFreshness {
  asOf?: string;
  collectedAt?: string;
  staleAfter?: string;
}

export interface ReportSourceCollectionWindow {
  start?: string;
  end?: string;
  timezone?: string;
  label?: string;
}

export interface ReportSourceEvidenceInput {
  source: string;
  status: ReportSourceStatus;
  label?: string;
  reason?: string;
  error?: string;
  refs?: ReportSourceEvidenceRef[];
  freshness?: ReportSourceFreshness;
  window?: ReportSourceCollectionWindow;
  counts?: Record<string, number>;
  metadata?: Record<string, unknown>;
}

export interface NormalizedReportSourceEvidence {
  source: string;
  status: ReportSourceStatus;
  label: string;
  reason?: string;
  error?: string;
  refs: ReportSourceEvidenceRef[];
  freshness: ReportSourceFreshness;
  window: ReportSourceCollectionWindow;
  counts: Record<string, number>;
  metadata: Record<string, unknown>;
  zeroValuePolicy?: "unavailable_is_not_zero";
  unavailableWording?: string;
  truncated: boolean;
}

export interface ReportSourceEvidenceSnapshot {
  version: 1;
  generatedAt: string;
  sources: NormalizedReportSourceEvidence[];
  summary: {
    totalSources: number;
    availableSources: number;
    partialSources: number;
    unavailableSources: number;
    failedSources: number;
    totalEvidenceRefs: number;
    truncated: boolean;
  };
}

export interface SourceEvidenceSnapshotOptions {
  generatedAt?: string;
  maxSources?: number;
  maxRefsPerSource?: number;
  maxMetadataKeys?: number;
  maxMetadataStringLength?: number;
}

const DEFAULT_MAX_SOURCES = 12;
const DEFAULT_MAX_REFS_PER_SOURCE = 20;
const DEFAULT_MAX_METADATA_KEYS = 16;
const DEFAULT_MAX_METADATA_STRING_LENGTH = 240;
const BLOCKED_METADATA_KEYS = new Set([
  "base64",
  "base64Content",
  "body",
  "content",
  "data",
  "html",
  "items",
  "payload",
  "raw",
  "records",
  "rows",
  "text",
  "textContent",
]);

function normalizeStatus(value: ReportSourceStatus): ReportSourceStatus {
  if (["available", "partial", "unavailable", "failed"].includes(value)) return value;
  return "failed";
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 15))}...[truncated]`;
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
  options: Required<Pick<SourceEvidenceSnapshotOptions, "maxMetadataKeys" | "maxMetadataStringLength">>,
): Record<string, unknown> {
  if (!metadata) return {};

  const entries = Object.entries(metadata)
    .filter(([key]) => !BLOCKED_METADATA_KEYS.has(key))
    .slice(0, options.maxMetadataKeys);
  const output: Record<string, unknown> = {};

  for (const [key, value] of entries) {
    if (value === null || ["number", "boolean"].includes(typeof value)) {
      output[key] = value;
    } else if (typeof value === "string") {
      output[key] = truncateString(value, options.maxMetadataStringLength);
    } else if (Array.isArray(value)) {
      output[key] = value
        .filter((item) => item === null || ["string", "number", "boolean"].includes(typeof item))
        .slice(0, 8)
        .map((item) => (typeof item === "string" ? truncateString(item, options.maxMetadataStringLength) : item));
    }
  }

  return output;
}

function normalizeRefs(
  source: string,
  refs: ReportSourceEvidenceRef[] | undefined,
  options: Required<Pick<SourceEvidenceSnapshotOptions, "maxRefsPerSource" | "maxMetadataKeys" | "maxMetadataStringLength">>,
): { refs: ReportSourceEvidenceRef[]; truncated: boolean } {
  const inputRefs = refs ?? [];
  const cappedRefs = inputRefs.slice(0, options.maxRefsPerSource);

  return {
    refs: cappedRefs.map((ref) => ({
      id: truncateString(ref.id, options.maxMetadataStringLength),
      source: ref.source || source,
      ...(ref.title ? { title: truncateString(ref.title, options.maxMetadataStringLength) } : {}),
      ...(ref.url ? { url: truncateString(ref.url, options.maxMetadataStringLength) } : {}),
      ...(ref.recordType ? { recordType: truncateString(ref.recordType, options.maxMetadataStringLength) } : {}),
      ...(ref.observedAt ? { observedAt: ref.observedAt } : {}),
      metadata: sanitizeMetadata(ref.metadata, options),
    })),
    truncated: inputRefs.length > cappedRefs.length,
  };
}

function buildUnavailableWording(source: NormalizedReportSourceEvidence): string {
  const label = source.label || source.source;
  if (source.status === "failed") {
    return `${label} failed during source collection; do not treat missing values as zero.`;
  }
  if (source.status === "unavailable") {
    return `${label} was unavailable for this collection window; do not treat missing values as zero.`;
  }
  return "";
}

export function createReportSourceEvidenceSnapshot(
  sources: ReportSourceEvidenceInput[],
  options: SourceEvidenceSnapshotOptions = {},
): ReportSourceEvidenceSnapshot {
  const maxSources = options.maxSources ?? DEFAULT_MAX_SOURCES;
  const metadataOptions = {
    maxMetadataKeys: options.maxMetadataKeys ?? DEFAULT_MAX_METADATA_KEYS,
    maxMetadataStringLength: options.maxMetadataStringLength ?? DEFAULT_MAX_METADATA_STRING_LENGTH,
  };
  const refOptions = {
    maxRefsPerSource: options.maxRefsPerSource ?? DEFAULT_MAX_REFS_PER_SOURCE,
    ...metadataOptions,
  };
  const cappedSources = sources.slice(0, maxSources);
  let snapshotTruncated = sources.length > cappedSources.length;

  const normalizedSources = cappedSources.map((sourceInput): NormalizedReportSourceEvidence => {
    const source = sourceInput.source.trim();
    const status = normalizeStatus(sourceInput.status);
    const { refs, truncated } = normalizeRefs(source, sourceInput.refs, refOptions);
    snapshotTruncated ||= truncated;

    const normalized: NormalizedReportSourceEvidence = {
      source,
      status,
      label: sourceInput.label?.trim() || source,
      ...(sourceInput.reason ? { reason: truncateString(sourceInput.reason, metadataOptions.maxMetadataStringLength) } : {}),
      ...(sourceInput.error ? { error: truncateString(sourceInput.error, metadataOptions.maxMetadataStringLength) } : {}),
      refs,
      freshness: sourceInput.freshness ?? {},
      window: sourceInput.window ?? {},
      counts: sourceInput.counts ?? {},
      metadata: sanitizeMetadata(sourceInput.metadata, metadataOptions),
      truncated,
    };

    if (status === "unavailable" || status === "failed") {
      normalized.zeroValuePolicy = "unavailable_is_not_zero";
      normalized.unavailableWording = buildUnavailableWording(normalized);
    }

    return normalized;
  });

  return {
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sources: normalizedSources,
    summary: {
      totalSources: normalizedSources.length,
      availableSources: normalizedSources.filter((source) => source.status === "available").length,
      partialSources: normalizedSources.filter((source) => source.status === "partial").length,
      unavailableSources: normalizedSources.filter((source) => source.status === "unavailable").length,
      failedSources: normalizedSources.filter((source) => source.status === "failed").length,
      totalEvidenceRefs: normalizedSources.reduce((sum, source) => sum + source.refs.length, 0),
      truncated: snapshotTruncated,
    },
  };
}

export function mergeSourceEvidenceSnapshotIntoExecutionContext(
  executionContext: Record<string, unknown>,
  snapshot: ReportSourceEvidenceSnapshot,
  options: SourceEvidenceSnapshotOptions = {},
): Record<string, unknown> {
  const boundedSnapshot = createReportSourceEvidenceSnapshot(
    snapshot.sources.map((source) => ({
      source: source.source,
      status: source.status,
      label: source.label,
      reason: source.reason,
      error: source.error,
      refs: source.refs,
      freshness: source.freshness,
      window: source.window,
      counts: source.counts,
      metadata: source.metadata,
    })),
    { ...options, generatedAt: snapshot.generatedAt },
  );

  return {
    ...executionContext,
    sourceEvidence: boundedSnapshot,
  };
}
