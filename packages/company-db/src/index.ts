export const VERSION = "0.0.1";

export { createSemanticChunks } from "./semantic/chunking.js";
export { evaluateSemanticEligibility } from "./semantic/eligibility.js";
export { createOpenAiEmbeddingClient } from "./semantic/embeddings.js";
export { reindexSemanticRepo, indexSemanticFile } from "./semantic/indexer.js";
export { QdrantSemanticClient } from "./semantic/qdrant.js";
export {
  createSemanticIndexRuntimeFromEnv,
  createSemanticSearchRuntimeFromEnv,
} from "./semantic/runtime.js";
export { searchSemanticChunks } from "./semantic/search.js";
export type {
  EmbeddingClient,
  SemanticChunk,
  SemanticEligibilityInput,
  SemanticEligibilityReason,
  SemanticEligibilityResult,
  SemanticIndexFileResult,
  SemanticPoint,
  SemanticPointPayload,
  SemanticReindexSummary,
  SemanticSearchFilters,
  SemanticSearchResult,
  SemanticVectorStore,
} from "./semantic/types.js";
export type { SemanticSearchRuntime } from "./semantic/runtime.js";
