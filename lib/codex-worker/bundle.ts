import type {
  CodexBundleFile,
  CodexGeneratedBundle,
  CodexPersistedBundle,
  CodexTargetDomain,
} from "./types";

const ALLOWED_DOMAINS = new Set<CodexTargetDomain>([
  "finance",
  "knowledge",
  "legal",
  "tax",
  "governance",
  "strategy",
  "operations",
  "assets",
  "documents",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function validateBundleFile(value: unknown, index: number): CodexBundleFile {
  if (!isRecord(value)) {
    throw new Error(`Codex bundle file[${index}] must be an object.`);
  }

  const path = asNonEmptyString(value.path);
  if (!path) {
    throw new Error(`Codex bundle file[${index}].path must be a string.`);
  }

  const body = typeof value.body === "string" ? value.body : null;
  if (body === null) {
    throw new Error(`Codex bundle file[${index}].body must be a string.`);
  }

  if (!isRecord(value.frontmatter)) {
    throw new Error(`Codex bundle file[${index}].frontmatter must be an object.`);
  }

  return {
    path,
    frontmatter: value.frontmatter,
    body,
  };
}

export function buildCodexBundleStorageKey(companyId: string, documentId: string): string {
  return `${companyId}/${documentId}/codex-bundle-v1.json`;
}

export function buildCodexPersistedBundle(
  documentId: string,
  bundle: CodexGeneratedBundle,
): CodexPersistedBundle {
  return {
    version: 1,
    documentId,
    generatedAt: new Date().toISOString(),
    domain: bundle.domain,
    rootPath: bundle.rootPath,
    indexFilePath: bundle.indexFilePath,
    commitMessage: bundle.commitMessage,
    files: bundle.files,
  };
}

export function serializeCodexPersistedBundle(bundle: CodexPersistedBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function parseCodexPersistedBundle(
  value: string | Buffer,
  expectedDocumentId?: string,
): CodexPersistedBundle {
  const parsed: unknown = JSON.parse(typeof value === "string" ? value : value.toString("utf8"));
  if (!isRecord(parsed)) {
    throw new Error("Codex persisted bundle must be an object.");
  }

  const version = parsed.version;
  if (version !== 1) {
    throw new Error("Codex persisted bundle version is invalid.");
  }

  const documentId = asNonEmptyString(parsed.documentId);
  if (!documentId) {
    throw new Error("Codex persisted bundle documentId is invalid.");
  }

  if (expectedDocumentId && expectedDocumentId !== documentId) {
    throw new Error("Codex persisted bundle documentId does not match.");
  }

  const generatedAt = asNonEmptyString(parsed.generatedAt);
  if (!generatedAt) {
    throw new Error("Codex persisted bundle generatedAt is invalid.");
  }

  const domain = asNonEmptyString(parsed.domain);
  if (!domain || !ALLOWED_DOMAINS.has(domain as CodexTargetDomain)) {
    throw new Error("Codex persisted bundle domain is invalid.");
  }

  const rootPath = asNonEmptyString(parsed.rootPath);
  const indexFilePath = asNonEmptyString(parsed.indexFilePath);
  const commitMessage = asNonEmptyString(parsed.commitMessage);
  if (!rootPath || !indexFilePath || !commitMessage) {
    throw new Error("Codex persisted bundle path metadata is invalid.");
  }

  if (!Array.isArray(parsed.files)) {
    throw new Error("Codex persisted bundle files must be an array.");
  }

  const files = parsed.files.map((file, index) => validateBundleFile(file, index));
  if (files.length === 0) {
    throw new Error("Codex persisted bundle files cannot be empty.");
  }

  return {
    version: 1,
    documentId,
    generatedAt,
    domain: domain as CodexTargetDomain,
    rootPath,
    indexFilePath,
    commitMessage,
    files,
  };
}
