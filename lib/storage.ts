import { mkdir, writeFile, readFile, unlink, rename } from "fs/promises";
import { dirname, extname, resolve } from "path";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Key sanitization
// ---------------------------------------------------------------------------

export function sanitizeStorageKey(key: string): string {
  if (!key || key.length === 0) {
    throw new Error("Invalid storage key: empty");
  }

  if (key.includes("\0")) {
    throw new Error("Invalid storage key: null bytes");
  }

  if (key.startsWith("/")) {
    throw new Error("Invalid storage key: absolute path");
  }

  const segments = key.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new Error("Invalid storage key: path traversal");
    }
  }

  return key;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]+$/i;

export function buildStorageKey(opts: {
  companyId: string;
  documentId: string;
  sha256: string;
  fileName: string;
}): string {
  if (!UUID_RE.test(opts.companyId)) throw new Error("Invalid companyId format");
  if (!UUID_RE.test(opts.documentId)) throw new Error("Invalid documentId format");
  if (!HEX_RE.test(opts.sha256)) throw new Error("Invalid sha256 format");

  const ext = extname(opts.fileName).toLowerCase();
  const name = ext ? `${opts.sha256}${ext}` : opts.sha256;
  const key = `${opts.companyId}/${opts.documentId}/${name}`;
  sanitizeStorageKey(key);
  return key;
}

// ---------------------------------------------------------------------------
// Storage provider interface + local implementation
// ---------------------------------------------------------------------------

export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export class LocalStorage implements StorageProvider {
  private readonly resolvedBase: string;

  constructor(baseDir: string) {
    this.resolvedBase = resolve(baseDir);
  }

  private guardPath(key: string): string {
    sanitizeStorageKey(key);
    const fullPath = resolve(this.resolvedBase, key);
    if (!fullPath.startsWith(this.resolvedBase + "/")) {
      throw new Error("Invalid storage key: path escape");
    }
    return fullPath;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const fullPath = this.guardPath(key);
    await mkdir(dirname(fullPath), { recursive: true });
    const tmpPath = `${fullPath}.tmp.${randomUUID()}`;
    try {
      await writeFile(tmpPath, data);
      await rename(tmpPath, fullPath);
    } catch (err) {
      try { await unlink(tmpPath); } catch { /* ignore */ }
      throw err;
    }
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.guardPath(key));
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.guardPath(key));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton — configured from env, deferred to first use
// ---------------------------------------------------------------------------

let _storage: StorageProvider | undefined;

export function getStorage(): StorageProvider {
  if (!_storage) {
    const dir = process.env.STORAGE_DIR || "./uploads";
    _storage = new LocalStorage(dir);
  }
  return _storage;
}

/** Lazy singleton — resolves STORAGE_DIR on first access, not at import time. */
export const storage: StorageProvider = {
  put: (key, data) => getStorage().put(key, data),
  get: (key) => getStorage().get(key),
  remove: (key) => getStorage().remove(key),
};
