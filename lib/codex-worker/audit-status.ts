import type {
  CodexAuditOutput,
  CodexAuditState,
  CodexAuditSummary,
  CodexJobStage,
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

export function getCodexAuditState(
  ocrResult: unknown,
): CodexAuditState | null {
  const normalized = normalizeOcrResult(ocrResult);
  if (!normalized) return null;

  const raw = normalized.codex_audit;
  if (!isRecord(raw)) return null;

  const stageValue = asString(raw.stage);
  const stage = (
    stageValue &&
    ["queued", "artifactizing", "running", "persisting", "completed", "failed"].includes(stageValue)
      ? stageValue
      : DEFAULT_STAGE
  ) as CodexJobStage;

  return {
    source_mode: "codex_audit_worker",
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
    company_db_artifact_count: asNumber(raw.company_db_artifact_count),
    overall_status:
      raw.overall_status === "ok" || raw.overall_status === "warning" || raw.overall_status === "fail"
        ? raw.overall_status
        : null,
    overall_confidence:
      raw.overall_confidence === "low" ||
      raw.overall_confidence === "medium" ||
      raw.overall_confidence === "high"
        ? raw.overall_confidence
        : null,
    recommended_disposition:
      raw.recommended_disposition === "ok" ||
      raw.recommended_disposition === "monitor" ||
      raw.recommended_disposition === "manual_review" ||
      raw.recommended_disposition === "reprocess" ||
      raw.recommended_disposition === "cleanup_stale_artifacts" ||
      raw.recommended_disposition === "extractor_fix"
        ? raw.recommended_disposition
        : null,
    issue_count: asNumber(raw.issue_count),
    warning_count: asNumber(raw.warning_count),
    audit_summary:
      typeof raw.audit_summary === "string" ? raw.audit_summary : null,
    result: isRecord(raw.result) ? (raw.result as unknown as CodexAuditOutput) : null,
  };
}

export function mergeCodexAuditState(
  ocrResult: unknown,
  patch: Partial<CodexAuditState>,
): Record<string, unknown> {
  const currentState = getCodexAuditState(ocrResult);
  const nextState: CodexAuditState = {
    source_mode: "codex_audit_worker",
    pool: patch.pool ?? currentState?.pool ?? "chatgpt",
    stage: patch.stage ?? currentState?.stage ?? DEFAULT_STAGE,
    attempts: patch.attempts ?? currentState?.attempts ?? 0,
    queued_at: patch.queued_at ?? currentState?.queued_at,
    started_at: patch.started_at ?? currentState?.started_at,
    updated_at: patch.updated_at ?? currentState?.updated_at,
    completed_at: patch.completed_at ?? currentState?.completed_at,
    worker_id: patch.worker_id ?? currentState?.worker_id,
    claim_expires_at: patch.claim_expires_at ?? currentState?.claim_expires_at,
    last_heartbeat_at: patch.last_heartbeat_at ?? currentState?.last_heartbeat_at,
    error: patch.error !== undefined ? patch.error : currentState?.error ?? null,
    model: patch.model !== undefined ? patch.model : currentState?.model ?? null,
    artifact_manifest_path:
      patch.artifact_manifest_path !== undefined
        ? patch.artifact_manifest_path
        : currentState?.artifact_manifest_path ?? null,
    artifact_count:
      patch.artifact_count !== undefined
        ? patch.artifact_count
        : currentState?.artifact_count ?? null,
    company_db_artifact_count:
      patch.company_db_artifact_count !== undefined
        ? patch.company_db_artifact_count
        : currentState?.company_db_artifact_count ?? null,
    overall_status:
      patch.overall_status !== undefined
        ? patch.overall_status
        : currentState?.overall_status ?? null,
    overall_confidence:
      patch.overall_confidence !== undefined
        ? patch.overall_confidence
        : currentState?.overall_confidence ?? null,
    recommended_disposition:
      patch.recommended_disposition !== undefined
        ? patch.recommended_disposition
        : currentState?.recommended_disposition ?? null,
    issue_count:
      patch.issue_count !== undefined ? patch.issue_count : currentState?.issue_count ?? null,
    warning_count:
      patch.warning_count !== undefined
        ? patch.warning_count
        : currentState?.warning_count ?? null,
    audit_summary:
      patch.audit_summary !== undefined
        ? patch.audit_summary
        : currentState?.audit_summary ?? null,
    result: patch.result !== undefined ? patch.result : currentState?.result ?? null,
  };

  return {
    ...(normalizeOcrResult(ocrResult) ?? {}),
    codex_audit: nextState,
  };
}

export function buildQueuedCodexAuditOcrResult(
  ocrResult: unknown,
  nowIso = new Date().toISOString(),
  pool: CodexAuditState["pool"] = "chatgpt",
): Record<string, unknown> {
  return mergeCodexAuditState(ocrResult, {
    pool,
    stage: "queued",
    attempts: (getCodexAuditState(ocrResult)?.attempts ?? 0) + 1,
    queued_at: nowIso,
    updated_at: nowIso,
    completed_at: undefined,
    error: null,
    model: null,
    artifact_manifest_path: null,
    artifact_count: null,
    company_db_artifact_count: null,
    overall_status: null,
    overall_confidence: null,
    recommended_disposition: null,
    issue_count: null,
    warning_count: null,
    audit_summary: null,
    result: null,
  });
}

export function summarizeCodexAudit(
  ocrResult: unknown,
): CodexAuditSummary | null {
  const state = getCodexAuditState(ocrResult);
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
    companyDbArtifactCount: state.company_db_artifact_count ?? null,
    overallStatus: state.overall_status ?? null,
    overallConfidence: state.overall_confidence ?? null,
    recommendedDisposition: state.recommended_disposition ?? null,
    issueCount: state.issue_count ?? null,
    warningCount: state.warning_count ?? null,
    auditSummary: state.audit_summary ?? null,
    result: state.result ?? null,
  };
}
