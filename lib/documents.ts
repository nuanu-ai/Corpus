const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const MIME_TO_ALLOWED_EXTENSION: Record<string, string> = {
  "application/pdf": ".pdf",
  "text/csv": ".csv",
  "text/html": ".html",
  "application/xhtml+xml": ".html",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "text/plain": ".txt",
  "text/markdown": ".md",
};

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".csv",
  ".xlsx",
  ".xls",
  ".ofx",
  ".qif",
  ".png",
  ".jpg",
  ".jpeg",
  ".txt",
  ".md",
  ".qmd",
  ".html",
  ".htm",
  ".docx",
]);

const EXTENSION_TO_DOWNLOAD_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".ofx": "application/x-ofx",
  ".qif": "application/x-qif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".qmd": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const FILE_TYPE_TO_DOWNLOAD_MIME: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ofx: "application/x-ofx",
  qif: "application/x-qif",
  image: "application/octet-stream",
};

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx === -1 ? "" : fileName.slice(idx).toLowerCase();
}

function getAllowedExtensionFromMimeType(mimeType: string): string {
  return MIME_TO_ALLOWED_EXTENSION[mimeType.toLowerCase()] ?? "";
}

function resolveAcceptedExtension(fileName: string, mimeType: string): string {
  const ext = getExtension(fileName);
  if (ALLOWED_EXTENSIONS.has(ext)) {
    return ext;
  }

  const mimeExt = getAllowedExtensionFromMimeType(mimeType);
  if (mimeExt && ALLOWED_EXTENSIONS.has(mimeExt)) {
    return mimeExt;
  }

  return ext;
}

export function normalizeFileNameForMimeType(fileName: string, mimeType: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return fileName;

  const ext = getExtension(trimmed);
  if (ext) return trimmed;

  const mimeExt = getAllowedExtensionFromMimeType(mimeType);
  if (!mimeExt) return trimmed;

  return `${trimmed}${mimeExt}`;
}

export function validateUploadFile(file: {
  name: string;
  size: number;
  type: string;
}, options?: {
  maxFileSizeBytes?: number;
}): { valid: true } | { valid: false; error: string } {
  if (!file.name) {
    return { valid: false, error: "File name is required" };
  }

  const ext = resolveAcceptedExtension(file.name, file.type);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `File type "${ext || "unknown"}" is not allowed. Accepted: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
    };
  }

  const maxFileSizeBytes = options?.maxFileSizeBytes ?? MAX_FILE_SIZE;
  if (file.size > maxFileSizeBytes) {
    const maxFileSizeMb = (maxFileSizeBytes / 1024 / 1024).toFixed(0);
    return {
      valid: false,
      error: `File size ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds the ${maxFileSizeMb}MB limit`,
    };
  }

  if (file.size === 0) {
    return { valid: false, error: "File is empty" };
  }

  return { valid: true };
}

export function validateUploadedBuffer(buffer: Uint8Array | ArrayBuffer): { valid: true } | { valid: false; error: string } {
  const size = buffer instanceof ArrayBuffer ? buffer.byteLength : buffer.byteLength;
  if (size === 0) {
    return { valid: false, error: "File is empty" };
  }

  return { valid: true };
}

export function inferFileType(fileName: string, mimeType: string): string {
  const ext = resolveAcceptedExtension(fileName, mimeType);
  const extToType: Record<string, string> = {
    ".pdf": "pdf",
    ".csv": "csv",
    ".xlsx": "excel",
    ".xls": "excel",
    ".ofx": "ofx",
    ".qif": "qif",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".txt": "knowledge",
    ".md": "knowledge",
    ".qmd": "knowledge",
    ".html": "knowledge",
    ".htm": "knowledge",
    ".docx": "knowledge",
  };
  return extToType[ext] ?? mimeType;
}

export function inferDownloadMimeType(fileName: string, fileType: string): string {
  const ext = getExtension(fileName);
  return (
    EXTENSION_TO_DOWNLOAD_MIME[ext] ??
    FILE_TYPE_TO_DOWNLOAD_MIME[fileType.trim().toLowerCase()] ??
    "application/octet-stream"
  );
}

export function isKnowledgeType(fileType: string): boolean {
  return fileType === "knowledge";
}

/** Pick the correct Inngest event name based on file type. */
export function documentEventName(fileType: string): string {
  return isKnowledgeType(fileType)
    ? "document/knowledge-uploaded"
    : "document/uploaded";
}
