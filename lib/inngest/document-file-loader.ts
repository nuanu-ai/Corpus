import { storage } from "@/lib/storage";

export type MissingDocumentFileReason =
  | "missing_storage_key"
  | "missing_storage_url"
  | "missing_storage_reference";

const LEGACY_STORAGE_URL_TIMEOUT_MS = 30_000;
const LEGACY_STORAGE_URL_MAX_BYTES = 25 * 1024 * 1024;

export class MissingDocumentFileError extends Error {
  readonly reason: MissingDocumentFileReason;

  constructor(reason: MissingDocumentFileReason, message: string) {
    super(message);
    this.name = "MissingDocumentFileError";
    this.reason = reason;
  }
}

function isMissingStorageKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "ENOENT";
}

async function readResponseBufferWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      throw new Error(`Legacy storage URL exceeds the maximum supported size of ${maxBytes} bytes`);
    }
  }

  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error(`Legacy storage URL exceeds the maximum supported size of ${maxBytes} bytes`);
    }
    return Buffer.from(arrayBuffer);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Legacy storage URL exceeds the maximum supported size of ${maxBytes} bytes`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

interface LoadDocumentFileInput {
  storageKey?: string;
  storageUrl?: string;
}

/**
 * Load a document binary from local storage key (preferred) or legacy URL.
 * Throws MissingDocumentFileError for non-retriable missing reference cases.
 */
export async function loadDocumentFileBuffer(
  input: LoadDocumentFileInput,
): Promise<Buffer> {
  const storageKey = input.storageKey?.trim();
  if (storageKey) {
    try {
      return await storage.get(storageKey);
    } catch (error) {
      if (isMissingStorageKeyError(error)) {
        throw new MissingDocumentFileError(
          "missing_storage_key",
          `Storage file not found for key: ${storageKey}`,
        );
      }
      throw error;
    }
  }

  const storageUrl = input.storageUrl?.trim();
  if (storageUrl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LEGACY_STORAGE_URL_TIMEOUT_MS);
    try {
      const response = await fetch(storageUrl, {
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new MissingDocumentFileError(
            "missing_storage_url",
            `Storage URL not found: ${storageUrl}`,
          );
        }
        throw new Error(`Failed to download: ${response.status}`);
      }

      return await readResponseBufferWithLimit(response, LEGACY_STORAGE_URL_MAX_BYTES);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Legacy storage URL fetch timed out after ${LEGACY_STORAGE_URL_TIMEOUT_MS / 1000}s`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new MissingDocumentFileError(
    "missing_storage_reference",
    "No storageKey or storageUrl in event data",
  );
}
