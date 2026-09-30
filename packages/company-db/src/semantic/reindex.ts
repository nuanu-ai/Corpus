import { basename, resolve } from "path";

import type { RepoHandle } from "../git/types.js";
import { createOpenAiEmbeddingClient } from "./embeddings.js";
import { DEFAULT_ALLOWED_DOMAINS } from "./eligibility.js";
import { QdrantSemanticClient } from "./qdrant.js";
import { reindexSemanticRepo } from "./indexer.js";

interface CliArgs {
  repoPath: string;
  companySlug: string;
  allowedDomains: string[];
}

function parseArgs(argv: string[]): CliArgs {
  let repoPath = process.env.COMPANY_DB_REPO?.trim() ?? "";
  let companySlug = process.env.COMPANY_DB_TENANT_SLUG?.trim() ?? "";
  let allowedDomains = (process.env.COMPANY_DB_SEMANTIC_ALLOWED_DOMAINS ?? DEFAULT_ALLOWED_DOMAINS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--repo" && next) {
      repoPath = next;
      index += 1;
      continue;
    }
    if (arg === "--company-slug" && next) {
      companySlug = next;
      index += 1;
      continue;
    }
    if (arg === "--domains" && next) {
      allowedDomains = next.split(",").map((value) => value.trim()).filter(Boolean);
      index += 1;
      continue;
    }
  }

  if (!repoPath) {
    throw new Error("Missing repo path. Pass --repo <path> or set COMPANY_DB_REPO.");
  }

  const resolvedRepoPath = resolve(repoPath);
  const resolvedCompanySlug = companySlug || basename(resolvedRepoPath);

  return {
    repoPath: resolvedRepoPath,
    companySlug: resolvedCompanySlug,
    allowedDomains,
  };
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const qdrantUrl = process.env.QDRANT_URL?.trim();
  const collection = process.env.COMPANY_DB_SEMANTIC_COLLECTION?.trim();
  const embeddingModel = process.env.COMPANY_DB_SEMANTIC_EMBEDDING_MODEL?.trim();
  const openAiApiKey =
    process.env.CODEX_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();

  if (!qdrantUrl) {
    throw new Error("Missing QDRANT_URL");
  }
  if (!collection) {
    throw new Error("Missing COMPANY_DB_SEMANTIC_COLLECTION");
  }
  if (!embeddingModel) {
    throw new Error("Missing COMPANY_DB_SEMANTIC_EMBEDDING_MODEL");
  }
  if (!openAiApiKey) {
    throw new Error("Missing OPENAI_API_KEY or CODEX_OPENAI_API_KEY");
  }

  const repo: RepoHandle = {
    path: args.repoPath,
    slug: args.companySlug,
  };

  const embedder = createOpenAiEmbeddingClient({
    apiKey: openAiApiKey,
    model: embeddingModel,
    baseUrl: process.env.COMPANY_DB_SEMANTIC_EMBEDDING_BASE_URL?.trim(),
    dimensions: parsePositiveInteger(process.env.COMPANY_DB_SEMANTIC_EMBEDDING_DIMENSIONS),
  });

  const vectorStore = new QdrantSemanticClient({
    url: qdrantUrl,
    collection,
    apiKey: process.env.QDRANT_API_KEY?.trim(),
  });

  const summary = await reindexSemanticRepo(
    repo,
    {
      companySlug: args.companySlug,
      allowedDomains: args.allowedDomains,
    },
    {
      embedder,
      vectorStore,
    },
  );

  console.log(JSON.stringify(summary, null, 2));
}

const isDirectExecution =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/semantic/reindex.js") ||
  process.argv[1]?.endsWith("\\semantic\\reindex.js");

if (isDirectExecution) {
  main().catch((error) => {
    console.error("semantic reindex failed:", error);
    process.exit(1);
  });
}
