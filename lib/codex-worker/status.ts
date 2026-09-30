import type {
  CodexDocumentSummary,
  CodexJobStage,
  CodexPreprocessState,
} from "./types";
import { normalizeCodexWorkerPool } from "./pool";
import { normalizeOcrResult } from "./ocr-result";

const DEFAULT_STAGE: CodexJobStage = "queued";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getCodexPreprocessState(
  ocrResult: unknown,
): CodexPreprocessState | null {
  const normalized = normalizeOcrResult(ocrResult);
  if (!normalized) return null;

  const raw = normalized.codex_preprocess;
  if (!isRecord(raw)) return null;

  const stageValue = asString(raw.stage);
  const stage = (
    stageValue &&
    ["queued", "artifactizing", "running", "persisting", "completed", "failed"].includes(stageValue)
      ? stageValue
      : DEFAULT_STAGE
  ) as CodexJobStage;

  return {
    source_mode: "codex_worker",
    pool: normalizeCodexWorkerPool(raw.pool, "chatgpt"),
    stage,
    attempts: asNumber(raw.attempts) ?? 0,
    queued_at: asString(raw.queued_at) ?? undefined,
    started_at: asString(raw.started_at) ?? undefined,
    updated_at: asString(raw.updated_at) ?? undefined,
    completed_at: asString(raw.completed_at) ?? undefined,
    worker_id: asString(raw.worker_id) ?? undefined,
    claim_expires_at: asString(raw.claim_expires_at) ?? undefined,
    last_heartbeat_at: asString(raw.last_heartbeat_at) ?? undefined,
    error: typeof raw.error === "string" ? raw.error : null,
    model: typeof raw.model === "string" ? raw.model : null,
    artifact_manifest_path:
      typeof raw.artifact_manifest_path === "string"
        ? raw.artifact_manifest_path
        : null,
    artifact_count: asNumber(raw.artifact_count),
    unit_count: asNumber(raw.unit_count),
    import_root_path:
      typeof raw.import_root_path === "string" ? raw.import_root_path : null,
    index_file_path:
      typeof raw.index_file_path === "string" ? raw.index_file_path : null,
    bundle_storage_key:
      typeof raw.bundle_storage_key === "string" ? raw.bundle_storage_key : null,
  };
}

export function mergeCodexPreprocessState(
  ocrResult: unknown,
  patch: Partial<CodexPreprocessState>,
): Record<string, unknown> {
  const currentState = getCodexPreprocessState(ocrResult);
  const nextState: CodexPreprocessState = {
    source_mode: "codex_worker",
    pool:
      patch.pool ??
      currentState?.pool ??
      "chatgpt",
    stage: patch.stage ?? currentState?.stage ?? DEFAULT_STAGE,
    attempts: patch.attempts ?? currentState?.attempts ?? 0,
    queued_at: patch.queued_at ?? currentState?.queued_at,
    started_at: patch.started_at ?? currentState?.started_at,
    updated_at: patch.updated_at ?? currentState?.updated_at,
    completed_at: patch.completed_at ?? currentState?.completed_at,
    worker_id: patch.worker_id ?? currentState?.worker_id,
    claim_expires_at:
      patch.claim_expires_at ?? currentState?.claim_expires_at,
    last_heartbeat_at:
      patch.last_heartbeat_at ?? currentState?.last_heartbeat_at,
    error:
      patch.error !== undefined
        ? patch.error
        : currentState?.error ?? null,
    model:
      patch.model !== undefined
        ? patch.model
        : currentState?.model ?? null,
    artifact_manifest_path:
      patch.artifact_manifest_path !== undefined
        ? patch.artifact_manifest_path
        : currentState?.artifact_manifest_path ?? null,
    artifact_count:
      patch.artifact_count !== undefined
        ? patch.artifact_count
        : currentState?.artifact_count ?? null,
    unit_count:
      patch.unit_count !== undefined
        ? patch.unit_count
        : currentState?.unit_count ?? null,
    import_root_path:
      patch.import_root_path !== undefined
        ? patch.import_root_path
        : currentState?.import_root_path ?? null,
    index_file_path:
      patch.index_file_path !== undefined
        ? patch.index_file_path
        : currentState?.index_file_path ?? null,
    bundle_storage_key:
      patch.bundle_storage_key !== undefined
        ? patch.bundle_storage_key
        : currentState?.bundle_storage_key ?? null,
  };

  return {
    ...(normalizeOcrResult(ocrResult) ?? {}),
    codex_preprocess: nextState,
  };
}

export function buildQueuedCodexOcrResult(
  nowIso = new Date().toISOString(),
  pool: CodexPreprocessState["pool"] = "chatgpt",
): Record<string, unknown> {
  return mergeCodexPreprocessState(undefined, {
    pool,
    stage: "queued",
    attempts: 0,
    queued_at: nowIso,
    updated_at: nowIso,
    error: null,
  });
}

export function summarizeCodexState(
  ocrResult: unknown,
): CodexDocumentSummary | null {
  const state = getCodexPreprocessState(ocrResult);
  if (!state) return null;

  return {
    pool: state.pool ?? null,
    stage: state.stage,
    attempts: state.attempts,
    updatedAt: state.updated_at ?? null,
    completedAt: state.completed_at ?? null,
    error: state.error ?? null,
    model: state.model ?? null,
    artifactManifestPath: state.artifact_manifest_path ?? null,
    artifactCount: state.artifact_count ?? null,
    unitCount: state.unit_count ?? null,
    importRootPath: state.import_root_path ?? null,
    indexFilePath: state.index_file_path ?? null,
    bundleStorageKey: state.bundle_storage_key ?? null,
  };
}
