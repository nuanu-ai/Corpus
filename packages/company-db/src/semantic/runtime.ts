import { createOpenAiEmbeddingClient } from "./embeddings.js";
import { QdrantSemanticClient } from "./qdrant.js";
import type { EmbeddingClient, SemanticVectorStore } from "./types.js";

export interface SemanticSearchRuntime {
  companySlug: string;
  embedder: EmbeddingClient;
  vectorStore: SemanticVectorStore;
}

function isEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function parseCanaryCompanySlugs(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function createSemanticRuntimeFromEnv(
  companySlug: string,
  enabledEnvKey: "COMPANY_DB_SEMANTIC_SEARCH_ENABLED" | "COMPANY_DB_SEMANTIC_INDEX_ENABLED",
): SemanticSearchRuntime | null {
  if (!isEnabled(process.env[enabledEnvKey])) {
    return null;
  }

  const canaryCompanySlugs = parseCanaryCompanySlugs(
    process.env.COMPANY_DB_SEMANTIC_CANARY_COMPANY_SLUGS,
  );
  if (canaryCompanySlugs.size === 0) {
    return null;
  }
  if (
    !canaryCompanySlugs.has("*") &&
    !canaryCompanySlugs.has(companySlug.trim().toLowerCase())
  ) {
    return null;
  }

  const qdrantUrl = process.env.QDRANT_URL?.trim();
  const collection = process.env.COMPANY_DB_SEMANTIC_COLLECTION?.trim();
  const embeddingModel = process.env.COMPANY_DB_SEMANTIC_EMBEDDING_MODEL?.trim();
  const openAiApiKey =
    process.env.CODEX_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();

  if (!qdrantUrl) {
    throw new Error("COMPANY_DB_SEMANTIC_SEARCH_ENABLED=true but QDRANT_URL is missing");
  }
  if (!collection) {
    throw new Error(
      "COMPANY_DB_SEMANTIC_SEARCH_ENABLED=true but COMPANY_DB_SEMANTIC_COLLECTION is missing",
    );
  }
  if (!embeddingModel) {
    throw new Error(
      "COMPANY_DB_SEMANTIC_SEARCH_ENABLED=true but COMPANY_DB_SEMANTIC_EMBEDDING_MODEL is missing",
    );
  }
  if (!openAiApiKey) {
    throw new Error(
      "COMPANY_DB_SEMANTIC_SEARCH_ENABLED=true but OPENAI_API_KEY or CODEX_OPENAI_API_KEY is missing",
    );
  }

  const dimensions = parsePositiveInteger(
    process.env.COMPANY_DB_SEMANTIC_EMBEDDING_DIMENSIONS,
  );

  return {
    companySlug,
    embedder: createOpenAiEmbeddingClient({
      apiKey: openAiApiKey,
      model: embeddingModel,
      baseUrl: process.env.COMPANY_DB_SEMANTIC_EMBEDDING_BASE_URL?.trim(),
      dimensions,
    }),
    vectorStore: new QdrantSemanticClient({
      url: qdrantUrl,
      collection,
      apiKey: process.env.QDRANT_API_KEY?.trim(),
    }),
  };
}

export function createSemanticSearchRuntimeFromEnv(
  companySlug: string,
): SemanticSearchRuntime | null {
  return createSemanticRuntimeFromEnv(companySlug, "COMPANY_DB_SEMANTIC_SEARCH_ENABLED");
}

export function createSemanticIndexRuntimeFromEnv(
  companySlug: string,
): SemanticSearchRuntime | null {
  return createSemanticRuntimeFromEnv(companySlug, "COMPANY_DB_SEMANTIC_INDEX_ENABLED");
}
