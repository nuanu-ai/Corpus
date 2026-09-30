export type SemanticEligibilityReason =
  | "eligible_knowledge"
  | "eligible_legal"
  | "eligible_communications"
  | "eligible_operations"
  | "eligible_domain"
  | "skip_summary"
  | "skip_manifest"
  | "skip_generated"
  | "skip_domain"
  | "skip_body_too_small"
  | "skip_failed_extraction"
  | "skip_unreadable";

export interface SemanticEligibilityInput {
  filePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  allowedDomains?: string[];
  minBodyCharacters?: number;
}

export interface SemanticEligibilityResult {
  eligible: boolean;
  reason: SemanticEligibilityReason;
  domain: string | null;
  entitySlug: string;
  summaryPath: string | null;
}

export interface SemanticChunk {
  chunkId: string;
  chunkIndex: number;
  sectionPath: string[];
  text: string;
  bodyText: string;
  snippet: string;
  tokenCount: number;
}

export interface SemanticPointPayload {
  company_slug: string;
  entity_slug: string;
  qualified_id: string;
  domain: string;
  entity_type: string;
  file_path: string;
  summary_path: string | null;
  document_id: string | null;
  title: string | null;
  language: string | null;
  commit_sha: string;
  chunk_id: string;
  chunk_index: number;
  section_path: string;
  token_count: number;
  snippet: string;
}

export interface SemanticPoint {
  id: string;
  vector: number[];
  payload: SemanticPointPayload;
}

export interface SemanticSearchFilters {
  companySlug: string;
  domain?: string;
  limit?: number;
  retrievalMode?: "semantic" | "hybrid";
}

export interface SemanticSearchResult {
  pointId: string;
  score: number;
  payload: SemanticPointPayload;
  retrievalMode: "semantic" | "hybrid";
}

export interface EmbeddingClient {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface SemanticVectorStore {
  ensureCollection(vectorSize: number): Promise<void>;
  upsertPoints(points: SemanticPoint[]): Promise<void>;
  deletePointsByFilePath(companySlug: string, filePath: string): Promise<void>;
  listIndexedFilePaths(companySlug: string): Promise<string[]>;
  search(vector: number[], filters: SemanticSearchFilters): Promise<SemanticSearchResult[]>;
}

export interface SemanticIndexFileResult {
  status: "indexed" | "skipped";
  filePath: string;
  reason: SemanticEligibilityReason;
  chunks: number;
}

export interface SemanticReindexSummary {
  scannedFiles: number;
  indexedFiles: number;
  indexedChunks: number;
  skippedFiles: number;
  deletedFiles: number;
  errorFiles: number;
  errors: Array<{ filePath: string; error: string }>;
}
