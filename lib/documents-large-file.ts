import { PDFDocument } from "pdf-lib";
import { extname } from "path";

export const LARGE_FILE_PARENT_ROLE = "parent";
export const LARGE_FILE_CHUNK_ROLE = "chunk";
export const DEFAULT_LARGE_FILE_CHUNK_MAX_BYTES = 95 * 1024 * 1024;
export const DEFAULT_LARGE_FILE_CHUNK_TARGET_BYTES = 80 * 1024 * 1024;

export interface LargeFileFallbackParentState {
  role: typeof LARGE_FILE_PARENT_ROLE;
  provider: "google_drive";
  chunk_count: number;
  child_document_ids: string[];
  original_file_name: string;
  original_file_size_bytes: number;
  original_storage_key: string;
  original_sha256: string;
  chunk_max_bytes: number;
  chunk_target_bytes: number;
}

export interface LargeFileFallbackChunkState {
  role: typeof LARGE_FILE_CHUNK_ROLE;
  provider: "google_drive";
  parent_document_id: string;
  chunk_index: number;
  chunk_count: number;
  page_start: number;
  page_end: number;
  original_file_name: string;
  original_file_size_bytes: number;
}

export type LargeFileFallbackState =
  | LargeFileFallbackParentState
  | LargeFileFallbackChunkState;

export interface PdfChunkResult {
  buffer: Buffer;
  pageStart: number;
  pageEnd: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
  return items.length === value.length ? items : null;
}

export function getLargeFileFallbackState(
  ocrResult: unknown,
): LargeFileFallbackState | null {
  if (!isRecord(ocrResult)) return null;
  const raw = ocrResult.large_file_fallback;
  if (!isRecord(raw) || typeof raw.role !== "string") return null;

  if (raw.role === LARGE_FILE_PARENT_ROLE) {
    const childDocumentIds = asStringArray(raw.child_document_ids);
    const chunkCount = asPositiveInteger(raw.chunk_count);
    const originalFileName =
      typeof raw.original_file_name === "string" &&
      raw.original_file_name.trim().length > 0
        ? raw.original_file_name
        : null;
    const originalFileSizeBytes = asPositiveInteger(raw.original_file_size_bytes);
    const originalStorageKey =
      typeof raw.original_storage_key === "string" &&
      raw.original_storage_key.trim().length > 0
        ? raw.original_storage_key
        : null;
    const originalSha256 =
      typeof raw.original_sha256 === "string" && raw.original_sha256.trim().length > 0
        ? raw.original_sha256
        : null;
    const chunkMaxBytes = asPositiveInteger(raw.chunk_max_bytes);
    const chunkTargetBytes = asPositiveInteger(raw.chunk_target_bytes);

    if (
      !childDocumentIds ||
      !chunkCount ||
      !originalFileName ||
      !originalFileSizeBytes ||
      !originalStorageKey ||
      !originalSha256 ||
      !chunkMaxBytes ||
      !chunkTargetBytes
    ) {
      return null;
    }

    return {
      role: LARGE_FILE_PARENT_ROLE,
      provider: raw.provider === "google_drive" ? "google_drive" : "google_drive",
      chunk_count: chunkCount,
      child_document_ids: childDocumentIds,
      original_file_name: originalFileName,
      original_file_size_bytes: originalFileSizeBytes,
      original_storage_key: originalStorageKey,
      original_sha256: originalSha256,
      chunk_max_bytes: chunkMaxBytes,
      chunk_target_bytes: chunkTargetBytes,
    };
  }

  if (raw.role === LARGE_FILE_CHUNK_ROLE) {
    const parentDocumentId =
      typeof raw.parent_document_id === "string" &&
      raw.parent_document_id.trim().length > 0
        ? raw.parent_document_id
        : null;
    const chunkIndex = asPositiveInteger(raw.chunk_index);
    const chunkCount = asPositiveInteger(raw.chunk_count);
    const pageStart = asPositiveInteger(raw.page_start);
    const pageEnd = asPositiveInteger(raw.page_end);
    const originalFileName =
      typeof raw.original_file_name === "string" &&
      raw.original_file_name.trim().length > 0
        ? raw.original_file_name
        : null;
    const originalFileSizeBytes = asPositiveInteger(raw.original_file_size_bytes);

    if (
      !parentDocumentId ||
      !chunkIndex ||
      !chunkCount ||
      !pageStart ||
      !pageEnd ||
      !originalFileName ||
      !originalFileSizeBytes
    ) {
      return null;
    }

    return {
      role: LARGE_FILE_CHUNK_ROLE,
      provider: raw.provider === "google_drive" ? "google_drive" : "google_drive",
      parent_document_id: parentDocumentId,
      chunk_index: chunkIndex,
      chunk_count: chunkCount,
      page_start: pageStart,
      page_end: pageEnd,
      original_file_name: originalFileName,
      original_file_size_bytes: originalFileSizeBytes,
    };
  }

  return null;
}

export function isLargeFileFallbackChunk(ocrResult: unknown): boolean {
  return getLargeFileFallbackState(ocrResult)?.role === LARGE_FILE_CHUNK_ROLE;
}

export function isOversizedPdfForFallback(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  maxFileSizeBytes: number;
}): boolean {
  if (input.sizeBytes <= input.maxFileSizeBytes) return false;
  const extension = extname(input.fileName).toLowerCase();
  return (
    input.mimeType === "application/pdf" ||
    extension === ".pdf"
  );
}

export function buildLargeFileChunkName(input: {
  fileName: string;
  chunkIndex: number;
  chunkCount: number;
}): string {
  const extension = extname(input.fileName).toLowerCase() || ".pdf";
  const base = input.fileName.endsWith(extension)
    ? input.fileName.slice(0, -extension.length)
    : input.fileName;
  return `${base} (part ${input.chunkIndex} of ${input.chunkCount})${extension}`;
}

async function savePdfPages(
  source: PDFDocument,
  pageIndexes: number[],
): Promise<Buffer> {
  const chunk = await PDFDocument.create();
  const copiedPages = await chunk.copyPages(source, pageIndexes);
  for (const page of copiedPages) {
    chunk.addPage(page);
  }
  return Buffer.from(await chunk.save());
}

export async function splitPdfBufferForLargeFileFallback(input: {
  buffer: Buffer;
  maxChunkBytes?: number;
  targetChunkBytes?: number;
}): Promise<PdfChunkResult[]> {
  const maxChunkBytes =
    input.maxChunkBytes ?? DEFAULT_LARGE_FILE_CHUNK_MAX_BYTES;
  const targetChunkBytes =
    input.targetChunkBytes ?? DEFAULT_LARGE_FILE_CHUNK_TARGET_BYTES;

  if (targetChunkBytes > maxChunkBytes) {
    throw new Error("Large-file chunk target must not exceed the hard chunk limit");
  }

  const source = await PDFDocument.load(input.buffer, { ignoreEncryption: true });
  const pageCount = source.getPageCount();
  if (pageCount <= 0) {
    throw new Error("PDF contains no pages");
  }

  const averageBytesPerPage = Math.max(input.buffer.length / pageCount, 1);
  const initialPagesPerChunk = Math.max(
    1,
    Math.min(pageCount, Math.floor(targetChunkBytes / averageBytesPerPage)),
  );

  const chunks: PdfChunkResult[] = [];
  let pageCursor = 0;

  while (pageCursor < pageCount) {
    const remainingPages = pageCount - pageCursor;
    let candidatePageCount = Math.max(
      1,
      Math.min(remainingPages, initialPagesPerChunk),
    );
    let chunkBuffer: Buffer | null = null;

    while (candidatePageCount >= 1) {
      const pageIndexes = Array.from(
        { length: candidatePageCount },
        (_, index) => pageCursor + index,
      );
      const nextBuffer = await savePdfPages(source, pageIndexes);
      if (nextBuffer.length <= maxChunkBytes) {
        chunkBuffer = nextBuffer;
        break;
      }

      if (candidatePageCount === 1) {
        throw new Error(
          `Unable to split PDF into chunks below ${(maxChunkBytes / 1024 / 1024).toFixed(0)}MB; a single page is too large`,
        );
      }

      candidatePageCount = Math.max(1, Math.floor(candidatePageCount / 2));
    }

    if (!chunkBuffer) {
      throw new Error("Failed to build large-file PDF chunks");
    }

    chunks.push({
      buffer: chunkBuffer,
      pageStart: pageCursor + 1,
      pageEnd: pageCursor + candidatePageCount,
    });
    pageCursor += candidatePageCount;
  }

  return chunks;
}
