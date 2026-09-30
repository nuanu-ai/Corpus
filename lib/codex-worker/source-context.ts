import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { parsePeriodFromSourcePath } from "@/lib/document-parsers/period-utils";

import { normalizeOcrResult } from "./ocr-result";

export interface CodexSourcePeriodHint {
  start: string;
  end: string;
  label?: string | null;
}

export interface CodexSourceContext {
  provider?: string | null;
  sourcePath?: string | null;
  rootPath?: string | null;
  connectionLabel?: string | null;
  ingressSource?: string | null;
  driveFileId?: string | null;
  inferredPeriod?: CodexSourcePeriodHint | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getCodexSourceContext(
  ocrResult: unknown,
): CodexSourceContext | null {
  const normalized = normalizeOcrResult(ocrResult);
  if (!normalized) return null;

  const raw = normalized.source_context;
  if (!isRecord(raw)) return null;

  const sourcePath = normalizeString(raw.sourcePath);
  const inferredPeriod =
    isRecord(raw.inferredPeriod) &&
    typeof raw.inferredPeriod.start === "string" &&
    typeof raw.inferredPeriod.end === "string"
      ? {
          start: raw.inferredPeriod.start,
          end: raw.inferredPeriod.end,
          label:
            typeof raw.inferredPeriod.label === "string"
              ? raw.inferredPeriod.label
              : null,
        }
      : null;

  return {
    provider: normalizeString(raw.provider),
    sourcePath,
    rootPath: normalizeString(raw.rootPath),
    connectionLabel: normalizeString(raw.connectionLabel),
    ingressSource: normalizeString(raw.ingressSource),
    driveFileId: normalizeString(raw.driveFileId),
    inferredPeriod:
      inferredPeriod ??
      (sourcePath ? parsePeriodFromSourcePath(sourcePath) ?? null : null),
  };
}

export function getEffectiveDocumentSource(
  source: string | null | undefined,
  ocrResult: unknown,
): string {
  return getCodexSourceContext(ocrResult)?.provider ?? source ?? "unknown";
}

export function buildEffectiveDocumentSourceExpr(
  source: SQLWrapper,
  ocrResult: SQLWrapper,
): SQL<string> {
  return sql<string>`coalesce(nullif(${ocrResult} -> 'source_context' ->> 'provider', ''), ${source})`;
}

export function mergeCodexSourceContext(
  ocrResult: unknown,
  sourceContext: CodexSourceContext | null,
): Record<string, unknown> {
  const normalized = normalizeOcrResult(ocrResult) ?? {};
  if (!sourceContext) {
    return normalized;
  }

  return {
    ...normalized,
    source_context: {
      provider: sourceContext.provider ?? null,
      sourcePath: sourceContext.sourcePath ?? null,
      rootPath: sourceContext.rootPath ?? null,
      connectionLabel: sourceContext.connectionLabel ?? null,
      ingressSource: sourceContext.ingressSource ?? null,
      driveFileId: sourceContext.driveFileId ?? null,
      inferredPeriod: sourceContext.inferredPeriod ?? null,
    },
  };
}
