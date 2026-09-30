export type CodexUnitKind = "sheet" | "page" | "file";

export const CODEX_TARGET_DOMAINS = [
  "finance",
  "knowledge",
  "legal",
  "tax",
  "governance",
  "strategy",
  "operations",
  "assets",
  "documents",
] as const;

export type CodexTargetDomain = (typeof CODEX_TARGET_DOMAINS)[number];

export const CODEX_DOCUMENT_KINDS = [
  "financial_report",
  "general_ledger",
  "trial_balance",
  "bank_statement",
  "invoice",
  "receipt",
  "payroll",
  "tax_document",
  "legal_document",
  "license_document",
  "operational_document",
  "mixed_document",
  "unknown",
] as const;

export type CodexDocumentKind = (typeof CODEX_DOCUMENT_KINDS)[number];

export type CodexJobStage =
  | "queued"
  | "artifactizing"
  | "running"
  | "persisting"
  | "completed"
  | "failed";

export type CodexWorkerPool = "chatgpt" | "api_key";

export type CodexConfidence = "low" | "medium" | "high";
export type CodexAuditOverallStatus = "ok" | "warning" | "fail";
export type CodexAuditCheckStatus = "pass" | "warning" | "fail" | "not_applicable";
export type CodexAuditDisposition =
  | "ok"
  | "monitor"
  | "manual_review"
  | "reprocess"
  | "cleanup_stale_artifacts"
  | "extractor_fix";

export interface CodexNormalizedMetadata {
  report_type: string | null;
  book: string | null;
  currency: string | null;
  entity: string | null;
  sheet_name: string | null;
  period_start: string | null;
  period_end: string | null;
  period_label: string | null;
  company_names_detected: string[];
  source_language: string | null;
}

export interface CodexToplineFinding {
  label: string;
  value: string;
  evidence: string;
}

export interface CodexAnomaly {
  severity: CodexConfidence;
  issue: string;
  impact: string;
  evidence: string;
}

export interface CodexIngestionRecommendation {
  mode: "auto_ingest" | "needs_review" | "knowledge_only" | "reject";
  reason: string;
}

export interface CodexArtifactUnit {
  slug: string;
  ordinal: number;
  title: string;
  unitKind: CodexUnitKind;
  sourcePath: string;
  visualPath?: string;
  previewPath?: string;
  metadataPath?: string;
  metadata: Record<string, unknown>;
}

export interface CodexArtifactManifest {
  version: 1;
  documentId: string;
  fileName: string;
  fileType: string;
  originalFilePath: string;
  generatedAt: string;
  notes: string[];
  units: CodexArtifactUnit[];
  sourceContext?: {
    provider?: string | null;
    sourcePath?: string | null;
    rootPath?: string | null;
    connectionLabel?: string | null;
    ingressSource?: string | null;
    driveFileId?: string | null;
    inferredPeriod?: {
      start: string;
      end: string;
      label?: string | null;
    } | null;
  };
  clarificationContext?: {
    documentAnswers?: Partial<Record<string, string>>;
    uploadProvenance?: {
      sourceUrl?: string | null;
      externalDocumentId?: string | null;
      agentNotes?: string | null;
    };
    templateHints?: Array<{
      provider: string | null;
      sourceFolder: string | null;
      documentKind: string | null;
      reportType: string | null;
      answers: Partial<Record<string, string>>;
    }>;
  };
}

export interface CodexAgentUnitOutput {
  slug: string;
  title: string;
  unit_kind: CodexUnitKind;
  source_ref: string;
  confidence: CodexConfidence;
  markdown: string;
  key_figures: string[];
  risks: string[];
  assumptions: string[];
  evidence: string[];
  candidate_role?: string | null;
}

export interface CodexAgentOutput {
  document_title: string;
  document_kind: CodexDocumentKind;
  target_domain: CodexTargetDomain;
  target_entity_type: string;
  routing_confidence: CodexConfidence;
  routing_reasons: string[];
  requires_review: boolean;
  review_flags: string[];
  overall_confidence: CodexConfidence;
  document_summary: string;
  executive_summary: string;
  key_themes: string[];
  risks: string[];
  assumptions: string[];
  normalized_metadata: CodexNormalizedMetadata;
  topline_findings: CodexToplineFinding[];
  anomalies: CodexAnomaly[];
  ingestion_recommendation: CodexIngestionRecommendation;
  index_markdown: string;
  units: CodexAgentUnitOutput[];
}

export interface CodexBundleFile {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface CodexGeneratedBundle {
  domain: CodexTargetDomain;
  rootPath: string;
  indexFilePath: string;
  localBundleDir: string;
  localManifestPath: string;
  commitMessage: string;
  files: CodexBundleFile[];
}

export interface CodexPersistedBundle {
  version: 1;
  documentId: string;
  generatedAt: string;
  domain: CodexTargetDomain;
  rootPath: string;
  indexFilePath: string;
  commitMessage: string;
  files: CodexBundleFile[];
}

export interface CodexPreprocessState {
  source_mode: "codex_worker";
  pool?: CodexWorkerPool;
  stage: CodexJobStage;
  attempts: number;
  queued_at?: string;
  started_at?: string;
  updated_at?: string;
  completed_at?: string;
  worker_id?: string;
  claim_expires_at?: string;
  last_heartbeat_at?: string;
  error?: string | null;
  model?: string | null;
  artifact_manifest_path?: string | null;
  artifact_count?: number | null;
  unit_count?: number | null;
  import_root_path?: string | null;
  index_file_path?: string | null;
  bundle_storage_key?: string | null;
}

export interface CodexDocumentSummary {
  pool: CodexWorkerPool | null;
  stage: CodexJobStage;
  attempts: number;
  updatedAt: string | null;
  completedAt: string | null;
  error: string | null;
  model: string | null;
  artifactManifestPath: string | null;
  artifactCount: number | null;
  unitCount: number | null;
  importRootPath: string | null;
  indexFilePath: string | null;
  bundleStorageKey: string | null;
}

export interface CodexAuditCheck {
  check: string;
  status: CodexAuditCheckStatus;
  summary: string;
  evidence: string;
}

export interface CodexAuditIssue {
  severity: CodexConfidence;
  code: string;
  issue: string;
  impact: string;
  evidence: string;
  affected_paths: string[];
}

export interface CodexAuditOutput {
  audit_summary: string;
  overall_status: CodexAuditOverallStatus;
  overall_confidence: CodexConfidence;
  recommended_disposition: CodexAuditDisposition;
  checks: CodexAuditCheck[];
  issues: CodexAuditIssue[];
  recommended_actions: string[];
}

export interface CodexAuditState {
  source_mode: "codex_audit_worker";
  pool?: CodexWorkerPool;
  stage: CodexJobStage;
  attempts: number;
  queued_at?: string;
  started_at?: string;
  updated_at?: string;
  completed_at?: string;
  worker_id?: string;
  claim_expires_at?: string;
  last_heartbeat_at?: string;
  error?: string | null;
  model?: string | null;
  artifact_manifest_path?: string | null;
  artifact_count?: number | null;
  company_db_artifact_count?: number | null;
  overall_status?: CodexAuditOverallStatus | null;
  overall_confidence?: CodexConfidence | null;
  recommended_disposition?: CodexAuditDisposition | null;
  issue_count?: number | null;
  warning_count?: number | null;
  audit_summary?: string | null;
  result?: CodexAuditOutput | null;
}

export interface CodexAuditSummary {
  pool: CodexWorkerPool | null;
  stage: CodexJobStage;
  attempts: number;
  updatedAt: string | null;
  completedAt: string | null;
  error: string | null;
  model: string | null;
  artifactManifestPath: string | null;
  artifactCount: number | null;
  companyDbArtifactCount: number | null;
  overallStatus: CodexAuditOverallStatus | null;
  overallConfidence: CodexConfidence | null;
  recommendedDisposition: CodexAuditDisposition | null;
  issueCount: number | null;
  warningCount: number | null;
  auditSummary: string | null;
  result: CodexAuditOutput | null;
}
