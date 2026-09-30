import type { EmbeddingClient } from "./types.js";

const DEFAULT_BATCH_SIZE = 32;

interface OpenAiEmbeddingClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  batchSize?: number;
  dimensions?: number;
  fetchImpl?: typeof fetch;
}

function chunkArray<T>(values: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize));
  }
  return batches;
}

export function createOpenAiEmbeddingClient(
  options: OpenAiEmbeddingClientOptions,
): EmbeddingClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("Global fetch is not available for embedding requests");
  }

  if (!options.apiKey.trim()) {
    throw new Error("OpenAI API key is required for semantic embeddings");
  }
  if (!options.model.trim()) {
    throw new Error("Embedding model is required for semantic embeddings");
  }

  const normalizedBaseUrl = options.baseUrl?.trim();
  const baseUrl = (normalizedBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const dimensions = Number.isInteger(options.dimensions) && (options.dimensions ?? 0) > 0
    ? options.dimensions
    : undefined;

  return {
    model: options.model,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];

      const outputs: number[][] = [];
      for (const batch of chunkArray(texts, batchSize)) {
        const response = await fetchImpl(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            input: batch,
            ...(dimensions ? { dimensions } : {}),
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Embedding request failed (${response.status}): ${error}`);
        }

        const payload = await response.json() as {
          data?: Array<{ embedding?: number[]; index?: number }>;
        };
        const data = Array.isArray(payload.data) ? payload.data : [];
        const vectors = data
          .slice()
          .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
          .map((item) => item.embedding ?? []);

        if (vectors.length !== batch.length || vectors.some((vector) => vector.length === 0)) {
          throw new Error("Embedding response did not return one non-empty vector per input");
        }

        outputs.push(...vectors);
      }

      return outputs;
    },
  };
}
