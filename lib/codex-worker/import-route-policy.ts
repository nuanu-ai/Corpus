import { parseCodexPersistedBundle, serializeCodexPersistedBundle } from "./bundle";
import { parseQmd, toQmd } from "@/lib/company-db/summary/qmd";

const FORECAST_IMPORT_BOOKS = new Set(["forecast", "budget", "projection"]);

function normalizeBook(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function resolveFinanceImportRouteOverride(
  book: string | null | undefined,
): string | null {
  const normalizedBook = normalizeBook(book);
  if (!normalizedBook) return null;
  if (FORECAST_IMPORT_BOOKS.has(normalizedBook)) {
    return "forecast";
  }
  return null;
}

export type FinanceImportRewriteCandidate = {
  currentRouteKey: string;
  targetRouteKey: string;
  documentId: string;
  oldRootPath: string;
  newRootPath: string;
};

export type ImportRouteParts = {
  domain: string;
  routeKey: string;
  documentId: string;
  rootPath: string;
};

const FINANCE_IMPORT_INDEX_PATH_PATTERN =
  /^finance\/imports\/([^/]+)\/([^/]+)\/index\.qmd$/;

export function getFinanceImportRewriteCandidate(input: {
  filePath: string;
  frontmatter: Record<string, unknown>;
}): FinanceImportRewriteCandidate | null {
  const match = input.filePath.match(FINANCE_IMPORT_INDEX_PATH_PATTERN);
  if (!match) return null;

  const [, currentRouteKey, documentId] = match;
  if (!currentRouteKey || !documentId) return null;

  const targetRouteKey = resolveFinanceImportRouteOverride(
    typeof input.frontmatter.book === "string" ? input.frontmatter.book : null,
  );
  if (!targetRouteKey || targetRouteKey === currentRouteKey) {
    return null;
  }

  const oldRootPath = `finance/imports/${currentRouteKey}/${documentId}`;
  const newRootPath = `finance/imports/${targetRouteKey}/${documentId}`;

  return {
    currentRouteKey,
    targetRouteKey,
    documentId,
    oldRootPath,
    newRootPath,
  };
}

export function parseImportRootPath(filePath: string): ImportRouteParts | null {
  const normalized = filePath.replace(/^\/+/, "");
  const match = normalized.match(/^([^/]+)\/imports\/([^/]+)\/([^/]+)(?:\/|$)/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }

  const domain = match[1];
  const routeKey = match[2];
  const documentId = match[3];
  return {
    domain,
    routeKey,
    documentId,
    rootPath: `${domain}/imports/${routeKey}/${documentId}`,
  };
}

export function rewriteFinanceImportPath(
  filePath: string,
  candidate: Pick<FinanceImportRewriteCandidate, "oldRootPath" | "newRootPath">,
): string | null {
  if (!filePath.startsWith(`${candidate.oldRootPath}/`) && filePath !== `${candidate.oldRootPath}/index.qmd` && filePath !== `${candidate.oldRootPath}/manifest.qmd`) {
    return null;
  }
  return `${candidate.newRootPath}${filePath.slice(candidate.oldRootPath.length)}`;
}

function replaceAll(input: string, search: string, replacement: string): string {
  return input.split(search).join(replacement);
}

export function rewriteCodexImportQmd(
  raw: string,
  candidate: Pick<FinanceImportRewriteCandidate, "oldRootPath" | "newRootPath" | "targetRouteKey">,
): string {
  const parsed = parseQmd(raw);
  const nextFrontmatter = { ...parsed.frontmatter };
  if (typeof nextFrontmatter.route_key === "string") {
    nextFrontmatter.route_key = candidate.targetRouteKey;
  }
  if (typeof nextFrontmatter.import_root_path === "string") {
    nextFrontmatter.import_root_path = replaceAll(
      nextFrontmatter.import_root_path,
      candidate.oldRootPath,
      candidate.newRootPath,
    );
  }
  if (typeof nextFrontmatter.index_file_path === "string") {
    nextFrontmatter.index_file_path = replaceAll(
      nextFrontmatter.index_file_path,
      candidate.oldRootPath,
      candidate.newRootPath,
    );
  }
  return toQmd(
    nextFrontmatter,
    replaceAll(parsed.body, candidate.oldRootPath, candidate.newRootPath),
  );
}

export function rewriteCodexPersistedBundleImportRoute(
  raw: string | Buffer,
  candidate: Pick<FinanceImportRewriteCandidate, "oldRootPath" | "newRootPath" | "targetRouteKey">,
): string {
  const bundle = parseCodexPersistedBundle(raw);
  const nextCommitMessage = bundle.commitMessage.replace(
    /(codex-import:)([^):\s]+)/,
    `$1${candidate.targetRouteKey}`,
  );

  return serializeCodexPersistedBundle({
    ...bundle,
    rootPath: candidate.newRootPath,
    indexFilePath: rewriteFinanceImportPath(bundle.indexFilePath, candidate) ?? bundle.indexFilePath,
    commitMessage: nextCommitMessage,
    files: bundle.files.map((file) => ({
      ...file,
      path: rewriteFinanceImportPath(file.path, candidate) ?? file.path,
      frontmatter:
        typeof file.frontmatter.route_key === "string"
          ? { ...file.frontmatter, route_key: candidate.targetRouteKey }
          : file.frontmatter,
      body: replaceAll(file.body, candidate.oldRootPath, candidate.newRootPath),
    })),
  });
}
