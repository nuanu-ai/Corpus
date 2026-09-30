import { normalizeOcrResult } from "@/lib/codex-worker/ocr-result";

export type IngressDispatchStage = "queued" | "running" | "completed" | "failed";

export interface IngressDispatchState {
  stage: IngressDispatchStage;
  processingStrategy: string | null;
  dispatchTarget: string | null;
  dispatchEvent: string | null;
  routingConfidence: number | null;
  extractionConfidence: number | null;
  ocrNeeded: boolean | null;
  tableDensity: string | null;
  language: string | null;
  reasons: string[];
  error: string | null;
  updatedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function getIngressDispatchState(ocrResult: unknown): IngressDispatchState | null {
  const normalized = normalizeOcrResult(ocrResult);
  if (!normalized) return null;

  const raw = normalized.ingress_dispatch;
  if (!isRecord(raw)) return null;

  const rawStage = asString(raw.stage);
  const stage = (
    rawStage && ["queued", "running", "completed", "failed"].includes(rawStage)
      ? rawStage
      : "queued"
  ) as IngressDispatchStage;

  return {
    stage,
    processingStrategy: asString(raw.processing_strategy),
    dispatchTarget: asString(raw.dispatch_target),
    dispatchEvent: asString(raw.dispatch_event),
    routingConfidence: asNumber(raw.routing_confidence),
    extractionConfidence: asNumber(raw.extraction_confidence),
    ocrNeeded: asBoolean(raw.ocr_needed),
    tableDensity: asString(raw.table_density),
    language: asString(raw.language),
    reasons: asReasons(raw.reasons),
    error: typeof raw.error === "string" ? raw.error : null,
    updatedAt: asString(raw.updated_at),
  };
}

export function summarizeIngressDispatchState(ocrResult: unknown): IngressDispatchState | null {
  return getIngressDispatchState(ocrResult);
}
