import type {
  EmbeddingClient,
  SemanticSearchFilters,
  SemanticSearchResult,
  SemanticVectorStore,
} from "./types.js";

interface SemanticSearchDependencies {
  embedder: EmbeddingClient;
  vectorStore: SemanticVectorStore;
}

export async function searchSemanticChunks(
  query: string,
  filters: SemanticSearchFilters,
  dependencies: SemanticSearchDependencies,
): Promise<SemanticSearchResult[]> {
  const normalized = query.trim();
  if (!normalized) return [];

  const [vector] = await dependencies.embedder.embed([normalized]);
  if (!vector || vector.length === 0) {
    return [];
  }

  return dependencies.vectorStore.search(vector, filters);
}
