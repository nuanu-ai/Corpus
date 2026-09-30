import { createHash } from "crypto";

import { parseQmd } from "../qmd/parser.js";
import { getCommitSha, listFiles, readFile } from "../git/repo-manager.js";
import type { RepoHandle } from "../git/types.js";
import { createSemanticChunks } from "./chunking.js";
import {
  buildSemanticSummaryPath,
  detectEntitySlug,
  detectSemanticDomain,
  evaluateSemanticEligibility,
} from "./eligibility.js";
import type {
  EmbeddingClient,
  SemanticIndexFileResult,
  SemanticPoint,
  SemanticPointPayload,
  SemanticReindexSummary,
  SemanticVectorStore,
} from "./types.js";

interface QmdFrontmatter {
  id?: string;
  type?: string;
  title?: string;
  language?: string;
  source_language?: string;
  document_id?: string;
  [key: string]: unknown;
}

interface SemanticIndexerDependencies {
  embedder: EmbeddingClient;
  vectorStore: SemanticVectorStore;
  listFilesImpl?: typeof listFiles;
  readFileImpl?: typeof readFile;
  getCommitShaImpl?: typeof getCommitSha;
}

interface IndexSemanticFileOptions {
  companySlug: string;
  commitSha: string;
  allowedDomains?: string[];
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function buildQualifiedId(filePath: string, frontmatter: QmdFrontmatter): string {
  const localId = typeof frontmatter.id === "string" && frontmatter.id.trim().length > 0
    ? frontmatter.id.trim()
    : normalizePath(filePath);
  const entitySlug = detectEntitySlug(filePath);
  return entitySlug === "root" ? localId : `${entitySlug}:${localId}`;
}

function buildPointId(companySlug: string, filePath: string, chunkId: string): string {
  const hex = createHash("sha1")
    .update(companySlug)
    .update("\n")
    .update(normalizePath(filePath))
    .update("\n")
    .update(chunkId)
    .digest("hex");

  const base = hex.slice(0, 32).split("");
  // Deterministic UUIDv5-like shape so Qdrant accepts the point identifier.
  base[12] = "5";
  base[16] = ((parseInt(base[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${base.slice(0, 8).join("")}-${base.slice(8, 12).join("")}-${base.slice(12, 16).join("")}-${base.slice(16, 20).join("")}-${base.slice(20, 32).join("")}`;
}

function buildPointPayload(
  companySlug: string,
  filePath: string,
  commitSha: string,
  frontmatter: QmdFrontmatter,
  chunk: ReturnType<typeof createSemanticChunks>[number],
): SemanticPointPayload {
  return {
    company_slug: companySlug,
    entity_slug: detectEntitySlug(filePath),
    qualified_id: buildQualifiedId(filePath, frontmatter),
    domain: detectSemanticDomain(filePath) ?? "_root",
    entity_type: typeof frontmatter.type === "string" && frontmatter.type.trim().length > 0
      ? frontmatter.type.trim()
      : "unknown",
    file_path: normalizePath(filePath),
    summary_path: buildSemanticSummaryPath(filePath),
    document_id: typeof frontmatter.document_id === "string" ? frontmatter.document_id : null,
    title: typeof frontmatter.title === "string" ? frontmatter.title : null,
    language: typeof frontmatter.language === "string"
      ? frontmatter.language
      : typeof frontmatter.source_language === "string"
        ? frontmatter.source_language
        : null,
    commit_sha: commitSha,
    chunk_id: chunk.chunkId,
    chunk_index: chunk.chunkIndex,
    section_path: chunk.sectionPath.join(" > "),
    token_count: chunk.tokenCount,
    snippet: chunk.snippet,
  };
}

export async function indexSemanticFile(
  repo: RepoHandle,
  filePath: string,
  options: IndexSemanticFileOptions,
  dependencies: SemanticIndexerDependencies,
): Promise<SemanticIndexFileResult> {
  const readFileImpl = dependencies.readFileImpl ?? readFile;
  const content = await readFileImpl(repo, filePath);
  if (content === null) {
    await dependencies.vectorStore.deletePointsByFilePath(options.companySlug, normalizePath(filePath));
    return {
      status: "skipped",
      filePath,
      reason: "skip_unreadable",
      chunks: 0,
    };
  }

  const { frontmatter, body } = parseQmd<QmdFrontmatter>(content);
  const eligibility = evaluateSemanticEligibility({
    filePath,
    frontmatter,
    body,
    allowedDomains: options.allowedDomains,
  });

  if (!eligibility.eligible) {
    await dependencies.vectorStore.deletePointsByFilePath(options.companySlug, normalizePath(filePath));
    return {
      status: "skipped",
      filePath,
      reason: eligibility.reason,
      chunks: 0,
    };
  }

  const chunks = createSemanticChunks({
    title: typeof frontmatter.title === "string" ? frontmatter.title : null,
    body,
  });

  if (chunks.length === 0) {
    await dependencies.vectorStore.deletePointsByFilePath(options.companySlug, normalizePath(filePath));
    return {
      status: "skipped",
      filePath,
      reason: "skip_unreadable",
      chunks: 0,
    };
  }

  const vectors = await dependencies.embedder.embed(chunks.map((chunk) => chunk.text));
  if (vectors.length !== chunks.length) {
    throw new Error(`Embedder returned ${vectors.length} vectors for ${chunks.length} chunks`);
  }

  if (vectors.some((vector) => vector.length === 0)) {
    throw new Error("Embedder returned an empty vector");
  }

  await dependencies.vectorStore.ensureCollection(vectors[0].length);

  const points: SemanticPoint[] = chunks.map((chunk, index) => ({
    id: buildPointId(options.companySlug, filePath, chunk.chunkId),
    vector: vectors[index],
    payload: buildPointPayload(options.companySlug, filePath, options.commitSha, frontmatter, chunk),
  }));

  await dependencies.vectorStore.upsertPoints(points);
  return {
    status: "indexed",
    filePath,
    reason: eligibility.reason,
    chunks: chunks.length,
  };
}

export async function reindexSemanticRepo(
  repo: RepoHandle,
  options: {
    companySlug: string;
    allowedDomains?: string[];
  },
  dependencies: SemanticIndexerDependencies,
): Promise<SemanticReindexSummary> {
  const listFilesImpl = dependencies.listFilesImpl ?? listFiles;
  const getCommitShaImpl = dependencies.getCommitShaImpl ?? getCommitSha;
  const qmdPaths = await listFilesImpl(repo, "**/*.qmd");
  const commitSha = await getCommitShaImpl(repo);
  const indexedFilePaths = await dependencies.vectorStore.listIndexedFilePaths(options.companySlug);
  const currentPaths = new Set(qmdPaths.map((path) => normalizePath(path)));

  const summary: SemanticReindexSummary = {
    scannedFiles: qmdPaths.length,
    indexedFiles: 0,
    indexedChunks: 0,
    skippedFiles: 0,
    deletedFiles: 0,
    errorFiles: 0,
    errors: [],
  };

  for (const filePath of qmdPaths) {
    try {
      const result = await indexSemanticFile(
        repo,
        filePath,
        {
          companySlug: options.companySlug,
          commitSha,
          allowedDomains: options.allowedDomains,
        },
        dependencies,
      );

      if (result.status === "indexed") {
        summary.indexedFiles += 1;
        summary.indexedChunks += result.chunks;
      } else {
        summary.skippedFiles += 1;
      }
    } catch (error) {
      summary.errorFiles += 1;
      summary.errors.push({
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const indexedPath of indexedFilePaths) {
    if (currentPaths.has(normalizePath(indexedPath))) {
      continue;
    }
    await dependencies.vectorStore.deletePointsByFilePath(options.companySlug, normalizePath(indexedPath));
    summary.deletedFiles += 1;
  }

  return summary;
}
