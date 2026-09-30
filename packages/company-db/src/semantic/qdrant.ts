import type {
  SemanticPoint,
  SemanticSearchFilters,
  SemanticSearchResult,
  SemanticVectorStore,
} from "./types.js";

interface QdrantSemanticClientOptions {
  url: string;
  collection: string;
  apiKey?: string;
  distance?: "Cosine" | "Dot" | "Euclid" | "Manhattan";
  searchEf?: number;
  fetchImpl?: typeof fetch;
}

type QdrantFilter = {
  must: Array<{
    key: string;
    match: { value: string };
  }>;
};

function buildFilter(companySlug: string, domain?: string): QdrantFilter {
  const must: QdrantFilter["must"] = [
    {
      key: "company_slug",
      match: { value: companySlug },
    },
  ];

  if (domain) {
    must.push({
      key: "domain",
      match: { value: domain },
    });
  }

  return { must };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort();
}

export class QdrantSemanticClient implements SemanticVectorStore {
  private static readonly DEFAULT_HNSW_M = 32;
  private static readonly DEFAULT_HNSW_EF_CONSTRUCT = 128;
  private static readonly DEFAULT_SEARCH_EF = 128;
  private readonly fetchImpl: typeof fetch;
  private readonly url: string;
  private readonly collection: string;
  private readonly apiKey?: string;
  private readonly distance: "Cosine" | "Dot" | "Euclid" | "Manhattan";
  private readonly searchEf: number;
  private ensuredVectorSize: number | null = null;
  private ensuredIndexes = false;

  constructor(options: QdrantSemanticClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("Global fetch is not available for Qdrant requests");
    }

    if (!options.url.trim()) {
      throw new Error("Qdrant URL is required");
    }
    if (!options.collection.trim()) {
      throw new Error("Qdrant collection is required");
    }

    this.url = options.url.replace(/\/+$/, "");
    this.collection = options.collection;
    this.apiKey = options.apiKey;
    this.distance = options.distance ?? "Cosine";
    this.searchEf = options.searchEf ?? QdrantSemanticClient.DEFAULT_SEARCH_EF;
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit = {},
    allowNotFound = false,
  ): Promise<{ status: number; body: T | null }> {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    if (this.apiKey) {
      headers.set("api-key", this.apiKey);
    }

    const response = await this.fetchImpl(`${this.url}${path}`, {
      ...init,
      headers,
    });

    if (allowNotFound && response.status === 404) {
      return { status: 404, body: null };
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Qdrant request failed (${response.status}) ${path}: ${error}`);
    }

    if (response.status === 204) {
      return { status: response.status, body: null };
    }

    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) as T : null,
    };
  }

  async ensureCollection(vectorSize: number): Promise<void> {
    if (this.ensuredVectorSize === vectorSize) {
      return;
    }

    const existing = await this.request(`/collections/${this.collection}`, { method: "GET" }, true);
    if (existing.status === 404) {
      await this.request(`/collections/${this.collection}`, {
        method: "PUT",
        body: JSON.stringify({
          vectors: {
            size: vectorSize,
            distance: this.distance,
            on_disk: true,
          },
          on_disk_payload: true,
          hnsw_config: {
            m: QdrantSemanticClient.DEFAULT_HNSW_M,
            ef_construct: QdrantSemanticClient.DEFAULT_HNSW_EF_CONSTRUCT,
            on_disk: true,
          },
          quantization_config: {
            scalar: {
              type: "int8",
              always_ram: true,
            },
          },
        }),
      });
    } else {
      await this.bestEffortTuneCollection();
    }

    await this.ensurePayloadIndexes();
    this.ensuredVectorSize = vectorSize;
  }

  private async bestEffortTuneCollection(): Promise<void> {
    try {
      await this.request(`/collections/${this.collection}`, {
        method: "PATCH",
        body: JSON.stringify({
          hnsw_config: {
            m: QdrantSemanticClient.DEFAULT_HNSW_M,
            ef_construct: QdrantSemanticClient.DEFAULT_HNSW_EF_CONSTRUCT,
            on_disk: true,
          },
          quantization_config: {
            scalar: {
              type: "int8",
              always_ram: true,
            },
          },
        }),
      });
    } catch (error) {
      console.warn(
        `[company-db] semantic collection tuning skipped for ${this.collection}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async ensurePayloadIndexes(): Promise<void> {
    if (this.ensuredIndexes) {
      return;
    }

    await this.ensurePayloadIndex("company_slug", {
      type: "keyword",
      is_tenant: true,
    });
    await this.ensurePayloadIndex("domain", "keyword");
    await this.ensurePayloadIndex("document_id", "keyword");
    await this.ensurePayloadIndex("file_path", "keyword");
    await this.ensurePayloadIndex("entity_slug", "keyword");
    await this.ensurePayloadIndex("summary_path", "keyword");
    await this.ensurePayloadIndex("language", "keyword");
    this.ensuredIndexes = true;
  }

  private async ensurePayloadIndex(fieldName: string, fieldSchema: string | Record<string, unknown>): Promise<void> {
    try {
      await this.request(`/collections/${this.collection}/index`, {
        method: "PUT",
        body: JSON.stringify({
          field_name: fieldName,
          field_schema: fieldSchema,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already exists|conflict|same params/i.test(message)) {
        return;
      }
      throw error;
    }
  }

  async upsertPoints(points: SemanticPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.request(`/collections/${this.collection}/points`, {
      method: "PUT",
      body: JSON.stringify({ points }),
    });
  }

  async deletePointsByFilePath(companySlug: string, filePath: string): Promise<void> {
    await this.request(`/collections/${this.collection}/points/delete`, {
      method: "POST",
      body: JSON.stringify({
        filter: {
          must: [
            {
              key: "company_slug",
              match: { value: companySlug },
            },
            {
              key: "file_path",
              match: { value: filePath },
            },
          ],
        },
      }),
    });
  }

  async listIndexedFilePaths(companySlug: string): Promise<string[]> {
    const filePaths: string[] = [];
    let offset: string | number | null | undefined;

    for (;;) {
      const response = await this.request<{
        result?: {
          points?: Array<{ payload?: { file_path?: string } }>;
          next_page_offset?: string | number | null;
        };
      }>(`/collections/${this.collection}/points/scroll`, {
        method: "POST",
        body: JSON.stringify({
          filter: buildFilter(companySlug),
          limit: 256,
          offset,
          with_payload: ["file_path"],
          with_vector: false,
        }),
      }, true);

      if (response.status === 404) {
        return [];
      }

      const result = response.body?.result;
      const points = Array.isArray(result?.points) ? result.points : [];
      for (const point of points) {
        const filePath = point.payload?.file_path;
        if (typeof filePath === "string" && filePath.trim().length > 0) {
          filePaths.push(filePath);
        }
      }

      offset = result?.next_page_offset;
      if (!offset) break;
    }

    return uniqueStrings(filePaths);
  }

  async search(vector: number[], filters: SemanticSearchFilters): Promise<SemanticSearchResult[]> {
    const response = await this.request<{
      result?: {
        points?: Array<{
          id?: string | number;
          score?: number;
          payload?: SemanticSearchResult["payload"];
        }>;
      };
    }>(`/collections/${this.collection}/points/query`, {
      method: "POST",
      body: JSON.stringify({
        query: vector,
        filter: buildFilter(filters.companySlug, filters.domain),
        limit: filters.limit ?? 8,
        params: {
          hnsw_ef: this.searchEf,
        },
        with_payload: true,
        with_vector: false,
      }),
    });

    const points = Array.isArray(response.body?.result?.points)
      ? response.body?.result?.points
      : [];

    return points
      .filter((point): point is NonNullable<typeof point> & { payload: SemanticSearchResult["payload"] } =>
        !!point &&
        typeof point.payload === "object" &&
        point.payload !== null,
      )
      .map((point) => ({
        pointId: String(point.id ?? ""),
        score: typeof point.score === "number" ? point.score : 0,
        payload: point.payload,
        retrievalMode: filters.retrievalMode ?? "semantic",
      }));
  }
}
