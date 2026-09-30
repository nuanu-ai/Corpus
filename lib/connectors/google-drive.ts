/**
 * Google Drive connector — lists files and downloads them for import.
 *
 * Uses the Google Drive v3 API with an OAuth2 access token obtained
 * through the standard OAuth flow (see lib/oauth-providers.ts).
 */

import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";
import { normalizeFileNameForMimeType } from "@/lib/documents";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_API_TIMEOUT_MS = 15_000;
const DRIVE_DOWNLOAD_TIMEOUT_MS = 30_000;
const DRIVE_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** Supported MIME types that we can import as general business documents. */
const IMPORTABLE_MIME_TYPES = [
  "text/csv",
  "text/plain",
  "text/markdown",
  "text/html",
  "application/xhtml+xml",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "application/vnd.oasis.opendocument.spreadsheet", // .ods (will export as xlsx)
  "application/vnd.google-apps.spreadsheet", // Google Sheets — exported as CSV
  "application/vnd.google-apps.document", // Google Docs — exported as DOCX
];

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_FILE_FIELDS =
  "nextPageToken,files(id,name,mimeType,size,modifiedTime,version,iconLink,webViewLink,driveId)";

/** File metadata returned from the list endpoint. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string; // bytes, missing for Google-native docs
  modifiedTime: string;
  version?: string;
  iconLink?: string;
  webViewLink?: string;
  isFolder?: boolean;
  driveId?: string;
  path?: string;
  isSharedDriveRoot?: boolean;
  browseMode?: "sharedWithMe";
}

export interface DriveListResult {
  files: DriveFile[];
  nextPageToken?: string;
}

export interface SharedDrive {
  id: string;
  name: string;
}

export interface GoogleDriveWatchedFolder {
  folderId: string;
  name: string;
  enabled: boolean;
  driveId?: string;
  browseMode?: "sharedWithMe";
  path?: string;
  watchCreatedAt?: string;
}

export interface GoogleDriveConnectionMetadata {
  connectionLabel?: string | null;
  rootFolderId?: string | null;
  rootDriveId?: string | null;
  rootBrowseMode?: "sharedWithMe" | null;
  rootPath?: string | null;
  watchedFolders: GoogleDriveWatchedFolder[];
  autoImportFrequency: "daily";
  autoImportLastRunAt?: string | null;
  autoImportLastQueued?: number;
  autoImportLastSkipped?: number;
  autoImportLastError?: string | null;
}

export interface GoogleDriveRootSelection {
  folderId: string;
  driveId?: string;
  browseMode?: "sharedWithMe";
  path?: string;
  isSharedDriveRoot: boolean;
}

interface DriveListOptions {
  pageToken?: string;
  pageSize?: number;
  query?: string;
  driveId?: string;
}

function compareDriveNames(left: DriveFile, right: DriveFile): number {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortDriveBrowseEntries(files: DriveFile[]): DriveFile[] {
  const folders = files.filter((file) => file.isFolder).sort(compareDriveNames);
  const regularFiles = files.filter((file) => !file.isFolder).sort(compareDriveNames);
  return [...folders, ...regularFiles];
}

async function collectAllPages(
  loader: (pageToken?: string) => Promise<DriveListResult>
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const page = await loader(pageToken);
    files.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return files;
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function sanitizeDriveIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "root") return trimmed;
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error(`Invalid Google Drive ${label}`);
  }
  return trimmed;
}

export function isGoogleDriveFolderMimeType(mimeType: string): boolean {
  return mimeType === FOLDER_MIME_TYPE;
}

export function isImportableDriveMimeType(mimeType: string): boolean {
  return IMPORTABLE_MIME_TYPES.includes(mimeType);
}

export function parseGoogleDriveLink(input: string): ParsedGoogleDriveLink | null {
  const value = input.trim();
  if (!value) return null;

  if (/^[A-Za-z0-9_-]{20,}$/.test(value)) {
    return { fileId: value, resourceHint: "unknown" };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "drive.google.com") {
    const folderMatch = url.pathname.match(
      /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/,
    );
    if (folderMatch?.[1]) {
      return { fileId: folderMatch[1], resourceHint: "folder" };
    }

    const fileMatch = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)/);
    if (fileMatch?.[1]) {
      return { fileId: fileMatch[1], resourceHint: "file" };
    }

    const idParam = url.searchParams.get("id");
    if (idParam && /^[A-Za-z0-9_-]+$/.test(idParam)) {
      return { fileId: idParam, resourceHint: "unknown" };
    }
  }

  if (host === "docs.google.com") {
    const docsMatch = url.pathname.match(
      /^\/(document|spreadsheets|presentation)\/d\/([A-Za-z0-9_-]+)/,
    );
    if (docsMatch?.[1] && docsMatch[2]) {
      const resourceHint =
        docsMatch[1] === "document"
          ? "document"
          : docsMatch[1] === "spreadsheets"
            ? "spreadsheet"
            : "presentation";
      return { fileId: docsMatch[2], resourceHint };
    }
  }

  return null;
}

export function coerceGoogleDriveConnectionMetadata(
  input: unknown
): GoogleDriveConnectionMetadata {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const watchedFolderMap = new Map<string, GoogleDriveWatchedFolder>();
  if (Array.isArray(value.watchedFolders)) {
    for (const entry of value.watchedFolders) {
      const folder =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : null;
      if (!folder || typeof folder.folderId !== "string") continue;

      const watchedFolder: GoogleDriveWatchedFolder = {
        folderId: folder.folderId,
        name:
          typeof folder.name === "string" && folder.name.trim().length > 0
            ? folder.name.trim()
            : "Google Drive folder",
        enabled: folder.enabled !== false,
        driveId:
          typeof folder.driveId === "string" && folder.driveId.trim()
            ? folder.driveId.trim()
            : undefined,
        browseMode:
          folder.browseMode === "sharedWithMe" ? "sharedWithMe" : undefined,
        path:
          typeof folder.path === "string" && folder.path.trim().length > 0
            ? folder.path.trim()
            : undefined,
        watchCreatedAt:
          typeof folder.watchCreatedAt === "string" &&
          folder.watchCreatedAt.trim().length > 0
            ? folder.watchCreatedAt.trim()
            : undefined,
      };

      if (watchedFolder.folderId === "__shared_with_me__") continue;

      watchedFolderMap.set(
        `${watchedFolder.driveId ?? "my-drive"}:${watchedFolder.folderId}`,
        watchedFolder
      );
    }
  }

  const dedupedFolders = Array.from(watchedFolderMap.values());
  const connectionLabel =
    typeof value.connectionLabel === "string" && value.connectionLabel.trim().length > 0
      ? value.connectionLabel.trim()
      : null;
  const rootFolderId =
    typeof value.rootFolderId === "string" && value.rootFolderId.trim().length > 0
      ? value.rootFolderId.trim()
      : null;
  const rootDriveId =
    typeof value.rootDriveId === "string" && value.rootDriveId.trim().length > 0
      ? value.rootDriveId.trim()
      : null;
  const rootBrowseMode =
    value.rootBrowseMode === "sharedWithMe" ? "sharedWithMe" : null;
  const rootPath =
    typeof value.rootPath === "string" && value.rootPath.trim().length > 0
      ? value.rootPath.trim()
      : null;

  return {
    connectionLabel,
    rootFolderId,
    rootDriveId,
    rootBrowseMode,
    rootPath,
    watchedFolders: dedupedFolders,
    autoImportFrequency: "daily",
    autoImportLastRunAt:
      typeof value.autoImportLastRunAt === "string"
        ? value.autoImportLastRunAt
        : null,
    autoImportLastQueued:
      typeof value.autoImportLastQueued === "number"
        ? value.autoImportLastQueued
        : 0,
    autoImportLastSkipped:
      typeof value.autoImportLastSkipped === "number"
        ? value.autoImportLastSkipped
        : 0,
    autoImportLastError:
      typeof value.autoImportLastError === "string"
        ? value.autoImportLastError
        : null,
  };
}

export function getGoogleDriveRootSelection(
  metadata: GoogleDriveConnectionMetadata
): GoogleDriveRootSelection | null {
  if (!metadata.rootFolderId) {
    return null;
  }

  return {
    folderId: metadata.rootFolderId,
    driveId: metadata.rootDriveId ?? undefined,
    browseMode: metadata.rootBrowseMode ?? undefined,
    path: metadata.rootPath ?? undefined,
    isSharedDriveRoot:
      Boolean(metadata.rootDriveId) &&
      metadata.rootFolderId === metadata.rootDriveId,
  };
}

export function hasGoogleDriveConfiguredRoot(
  metadata: GoogleDriveConnectionMetadata
): boolean {
  return Boolean(getGoogleDriveRootSelection(metadata));
}

export function hasGoogleDriveActiveAutoImport(
  metadata: GoogleDriveConnectionMetadata
): boolean {
  return metadata.watchedFolders.some((folder) => folder.enabled !== false);
}

export function getGoogleDriveFolderSelectionKey(
  folderId: string,
  driveId?: string
): string {
  return `${driveId ?? "my-drive"}:${folderId}`;
}

export interface DriveItemMetadata {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  driveId?: string;
  size?: string;
  modifiedTime?: string;
  version?: string;
  webViewLink?: string;
}

export interface ParsedGoogleDriveLink {
  fileId: string;
  resourceHint:
    | "file"
    | "folder"
    | "document"
    | "spreadsheet"
    | "presentation"
    | "unknown";
}

function buildDriveListParams(
  q: string,
  options?: DriveListOptions & { orderBy?: string; searchAllDrives?: boolean }
) {
  const params = new URLSearchParams({
    q,
    fields: DRIVE_FILE_FIELDS,
    pageSize: String(options?.pageSize ?? 20),
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  if (options?.pageToken) {
    params.set("pageToken", options.pageToken);
  }

  if (options?.orderBy) {
    params.set("orderBy", options.orderBy);
  }

  if (options?.driveId) {
    params.set("corpora", "drive");
    params.set("driveId", options.driveId);
  } else if (options?.searchAllDrives) {
    params.set("corpora", "allDrives");
  }

  return params;
}

async function fetchDriveFileList(
  accessToken: string,
  params: URLSearchParams
): Promise<DriveListResult> {
  const res = await fetchWithTimeoutAndRetry(
    `${DRIVE_API_BASE}/files?${params}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { timeoutMs: DRIVE_API_TIMEOUT_MS, maxRetriesOn429: 1 }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Google Drive list failed (${res.status}): ${text.slice(0, 200)}`
    );
  }

  const data = (await res.json()) as {
    files: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime: string;
      version?: string;
      iconLink?: string;
      webViewLink?: string;
      driveId?: string;
    }>;
    nextPageToken?: string;
  };

  return {
    files: data.files.map((file) => ({
      ...file,
      isFolder: file.mimeType === FOLDER_MIME_TYPE,
      driveId: file.driveId,
    })),
    nextPageToken: data.nextPageToken,
  };
}

function getResponseHeader(response: Response, name: string): string | null {
  const headers = (response as Response & { headers?: { get(name: string): string | null } }).headers;
  return headers?.get(name) ?? null;
}

async function readResponseBufferWithLimit(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Buffer> {
  const contentLengthHeader = getResponseHeader(response, "content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`${label} exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`);
    }
  }

  const body = (response as Response & { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      throw new Error(`${label} exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`);
    }
    return Buffer.from(arrayBuffer);
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`${label} exceeds the ${Math.floor(maxBytes / (1024 * 1024))}MB limit`);
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}

export async function getDriveItemMetadata(
  accessToken: string,
  fileId: string
): Promise<DriveItemMetadata> {
  const params = new URLSearchParams({
    fields: "id,name,mimeType,parents,driveId,size,modifiedTime,version,webViewLink",
    supportsAllDrives: "true",
  });

  const res = await fetchWithTimeoutAndRetry(
    `${DRIVE_API_BASE}/files/${fileId}?${params}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { timeoutMs: DRIVE_API_TIMEOUT_MS, maxRetriesOn429: 1 }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Google Drive file metadata failed (${res.status}): ${text.slice(0, 200)}`
    );
  }

  const data = (await res.json()) as {
    id: string;
    name: string;
    mimeType: string;
    parents?: string[];
    driveId?: string;
    size?: string;
    modifiedTime?: string;
    version?: string;
    webViewLink?: string;
  };

  return {
    id: data.id,
    name: data.name,
    mimeType: data.mimeType,
    parents: Array.isArray(data.parents) ? data.parents : [],
    driveId: data.driveId,
    ...(data.size ? { size: data.size } : {}),
    ...(data.modifiedTime ? { modifiedTime: data.modifiedTime } : {}),
    ...(data.version ? { version: data.version } : {}),
    ...(data.webViewLink ? { webViewLink: data.webViewLink } : {}),
  };
}

export async function isDriveItemWithinRoot(
  accessToken: string,
  itemId: string,
  root: GoogleDriveRootSelection
): Promise<boolean> {
  if (itemId === root.folderId) {
    return true;
  }

  if (root.isSharedDriveRoot && root.driveId) {
    const item = await getDriveItemMetadata(accessToken, itemId);
    return item.driveId === root.driveId;
  }

  let cursor = itemId;
  const visited = new Set<string>();

  while (!visited.has(cursor)) {
    visited.add(cursor);
    const item = await getDriveItemMetadata(accessToken, cursor);

    if (item.id === root.folderId) {
      return true;
    }

    if (!item.parents.length) {
      return false;
    }

    if (item.parents.includes(root.folderId)) {
      return true;
    }

    cursor = item.parents[0];
  }

  return false;
}

export async function listSharedDrives(
  accessToken: string,
  options?: { pageSize?: number; pageToken?: string; query?: string }
): Promise<{ drives: SharedDrive[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    fields: "nextPageToken,drives(id,name)",
    pageSize: String(options?.pageSize ?? 100),
  });

  if (options?.pageToken) {
    params.set("pageToken", options.pageToken);
  }

  if (options?.query) {
    params.set("q", `name contains '${escapeDriveQueryLiteral(options.query)}'`);
  }

  const res = await fetchWithTimeoutAndRetry(
    `${DRIVE_API_BASE}/drives?${params}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { timeoutMs: DRIVE_API_TIMEOUT_MS, maxRetriesOn429: 1 }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Google Drive drives.list failed (${res.status}): ${text.slice(0, 200)}`
    );
  }

  const data = (await res.json()) as {
    drives?: SharedDrive[];
    nextPageToken?: string;
  };

  return {
    drives: data.drives ?? [],
    nextPageToken: data.nextPageToken,
  };
}

export async function listSharedDrivesComplete(
  accessToken: string,
  options?: { query?: string }
): Promise<SharedDrive[]> {
  const drives: SharedDrive[] = [];
  let pageToken: string | undefined;

  do {
    const page = await listSharedDrives(accessToken, {
      pageToken,
      pageSize: 100,
      query: options?.query,
    });
    drives.push(...page.drives);
    pageToken = page.nextPageToken;
  } while (pageToken);

  return drives;
}

export async function listSharedWithMe(
  accessToken: string,
  options?: { pageToken?: string; pageSize?: number }
): Promise<DriveListResult> {
  const mimeFilter = IMPORTABLE_MIME_TYPES.map((m) => `mimeType='${m}'`).join(
    " or "
  );
  const q = `(mimeType='${FOLDER_MIME_TYPE}' or (${mimeFilter})) and sharedWithMe=true and trashed=false`;

  const data = await fetchDriveFileList(
    accessToken,
    buildDriveListParams(q, {
      pageSize: options?.pageSize ?? 100,
      pageToken: options?.pageToken,
    })
  );

  const folders = data.files
    .filter((file) => file.isFolder)
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = data.files
    .filter((file) => !file.isFolder)
    .sort(
      (a, b) =>
        new Date(b.modifiedTime).getTime() -
        new Date(a.modifiedTime).getTime()
    );

  return {
    files: [...folders, ...files],
    nextPageToken: data.nextPageToken,
  };
}

export async function listSharedWithMeComplete(
  accessToken: string,
  options?: { pageSize?: number }
): Promise<DriveListResult> {
  const files = await collectAllPages((pageToken) =>
    listSharedWithMe(accessToken, {
      pageToken,
      pageSize: options?.pageSize ?? 200,
    })
  );

  return {
    files: sortDriveBrowseEntries(files),
    nextPageToken: undefined,
  };
}

/**
 * List importable business documents from the user's Google Drive.
 *
 * Filters to spreadsheets, PDFs, text files, DOCX, and Google-native docs.
 * Supports pagination with pageToken.
 */
export async function listDriveFiles(
  accessToken: string,
  options?: DriveListOptions
): Promise<DriveListResult> {
  const pageSize = options?.pageSize ?? 20;

  // Build the query: show importable file types, not trashed
  const mimeFilter = IMPORTABLE_MIME_TYPES.map((m) => `mimeType='${m}'`).join(
    " or "
  );
  let q = `(${mimeFilter}) and trashed=false`;
  if (options?.query) {
    q += ` and name contains '${escapeDriveQueryLiteral(options.query)}'`;
  }

  const params = buildDriveListParams(q, {
    pageSize,
    pageToken: options?.pageToken,
    query: options?.query,
    driveId: options?.driveId,
    orderBy: "modifiedTime desc",
    searchAllDrives: !options?.driveId,
  });

  return fetchDriveFileList(accessToken, params);
}

export async function listDriveFilesComplete(
  accessToken: string,
  options?: Omit<DriveListOptions, "pageToken" | "pageSize">
): Promise<DriveListResult> {
  const files = await collectAllPages((pageToken) =>
    listDriveFiles(accessToken, {
      ...options,
      pageToken,
      pageSize: 200,
    })
  );

  return {
    files: files.sort(compareDriveNames),
    nextPageToken: undefined,
  };
}

/**
 * List the contents of a specific Google Drive folder.
 *
 * Returns both folders and importable files within the given parent folder.
 * Results are sorted: folders first (by name), then files (by modifiedTime desc).
 * Supports pagination with pageToken.
 *
 * @param accessToken OAuth2 access token
 * @param folderId    Parent folder ID (defaults to "root" for top-level)
 * @param options     Pagination options
 */
export async function listDriveFolder(
  accessToken: string,
  folderId: string = "root",
  options?: { pageToken?: string; pageSize?: number; driveId?: string }
): Promise<DriveListResult> {
  const pageSize = options?.pageSize ?? 100;

  // Include folders and importable file types, scoped to parent folder
  const mimeFilter = IMPORTABLE_MIME_TYPES.map((m) => `mimeType='${m}'`).join(
    " or "
  );
  const effectiveFolderId = options?.driveId && folderId === "root"
    ? sanitizeDriveIdentifier(options.driveId, "drive id")
    : sanitizeDriveIdentifier(folderId, "folder id");
  const q = `(mimeType='${FOLDER_MIME_TYPE}' or (${mimeFilter})) and '${effectiveFolderId}' in parents and trashed=false`;

  const data = await fetchDriveFileList(
    accessToken,
    buildDriveListParams(q, {
      pageSize,
      pageToken: options?.pageToken,
      driveId: options?.driveId,
    })
  );

  // Tag each entry with isFolder and sort: folders first (by name), then files (by modifiedTime desc)
  const tagged = data.files.map((file) => ({
    ...file,
    driveId: file.driveId ?? options?.driveId,
  }));

  const folders = tagged
    .filter((f) => f.isFolder)
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = tagged
    .filter((f) => !f.isFolder)
    .sort(
      (a, b) =>
        new Date(b.modifiedTime).getTime() -
        new Date(a.modifiedTime).getTime()
    );

  return {
    files: [...folders, ...files],
    nextPageToken: data.nextPageToken,
  };
}

export async function listDriveFolderComplete(
  accessToken: string,
  folderId: string = "root",
  options?: { driveId?: string }
): Promise<DriveListResult> {
  const files = await collectAllPages((pageToken) =>
    listDriveFolder(accessToken, folderId, {
      pageToken,
      pageSize: 200,
      driveId: options?.driveId,
    })
  );

  return {
    files: sortDriveBrowseEntries(files),
    nextPageToken: undefined,
  };
}

/**
 * Recursively list all importable files within a folder and its subfolders.
 *
 * Uses BFS (queue-based) traversal to avoid deep call stacks.
 * Collects only importable files (not folders) into a flat array.
 *
 * @param accessToken OAuth2 access token
 * @param folderId    Root folder ID to start from
 * @param options.maxFiles        Hard limit. When `onLimitExceeded="throw"` (default) raises,
 *                                when `"truncate"` stops collecting and returns what was gathered.
 * @param options.modifiedAfter   RFC3339 timestamp — only files with `modifiedTime > X` are
 *                                returned. Server-side filter (passed to Drive `q`). Folder
 *                                traversal is unaffected so changed files in subfolders are found.
 * @param options.onLimitExceeded What to do when `maxFiles` is reached.
 * @returns Flat array of importable DriveFile entries
 */
export async function listFolderFilesRecursive(
  accessToken: string,
  folderId: string,
  options?: {
    driveId?: string;
    maxFiles?: number;
    rootPath?: string;
    modifiedAfter?: string;
    onLimitExceeded?: "throw" | "truncate";
  }
): Promise<DriveFile[]> {
  const result: DriveFile[] = [];
  const queue: Array<{ folderId: string; path: string }> = [
    {
      folderId: sanitizeDriveIdentifier(folderId, "folder id"),
      path: options?.rootPath?.trim() || "My Drive",
    },
  ];
  const recursiveFileLimit =
    typeof options?.maxFiles === "number" && options.maxFiles > 0
      ? options.maxFiles
      : null;
  const onLimitExceeded = options?.onLimitExceeded ?? "throw";

  const modifiedAfter =
    typeof options?.modifiedAfter === "string" && options.modifiedAfter.trim()
      ? options.modifiedAfter.trim().replace(/'/g, "")
      : null;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentFolderId = current.folderId;
    const currentPath = current.path;
    let pageToken: string | undefined;

    // Paginate through all items in this folder
    do {
      const mimeFilter = IMPORTABLE_MIME_TYPES.map(
        (m) => `mimeType='${m}'`
      ).join(" or ");
      // Always include folders for recursion; apply modifiedTime only to files
      // so we still descend into subfolders that themselves did not change.
      const fileClause = modifiedAfter
        ? `((${mimeFilter}) and modifiedTime > '${modifiedAfter}')`
        : `(${mimeFilter})`;
      const q = `(mimeType='${FOLDER_MIME_TYPE}' or ${fileClause}) and '${currentFolderId}' in parents and trashed=false`;

      const data = await fetchDriveFileList(
        accessToken,
        buildDriveListParams(q, {
          pageSize: 100,
          pageToken,
          driveId: options?.driveId,
        })
      );

      for (const item of data.files) {
        if (item.mimeType === FOLDER_MIME_TYPE) {
          queue.push({
            folderId: item.id,
            path: `${currentPath} / ${item.name}`,
          });
        } else {
          if (recursiveFileLimit !== null && result.length >= recursiveFileLimit) {
            if (onLimitExceeded === "truncate") {
              return result;
            }
            throw new Error(
              `Folder contains more than ${recursiveFileLimit} importable files (found ${result.length + 1} so far). ` +
                `Please select a smaller folder or import files individually.`
            );
          }
          result.push({
            ...item,
            isFolder: false,
            driveId: item.driveId ?? options?.driveId,
            path: `${currentPath} / ${item.name}`,
          });
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);
  }

  return result;
}

export async function listDriveRoot(
  accessToken: string,
  options?: { pageToken?: string; pageSize?: number }
): Promise<DriveListResult> {
  const folderResult = await listDriveFolder(accessToken, "root", options);

  if (options?.pageToken) {
    return folderResult;
  }

  const sharedDrives = await listSharedDrivesComplete(accessToken);
  const sharedDriveFolders: DriveFile[] = sharedDrives
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((drive) => ({
      id: drive.id,
      name: drive.name,
      mimeType: FOLDER_MIME_TYPE,
      modifiedTime: "",
      isFolder: true,
      driveId: drive.id,
      isSharedDriveRoot: true,
    }));
  const sharedWithMeEntry: DriveFile = {
    id: "__shared_with_me__",
    name: "Shared with me",
    mimeType: FOLDER_MIME_TYPE,
    modifiedTime: "",
    isFolder: true,
    browseMode: "sharedWithMe",
  };

  return {
    files: [sharedWithMeEntry, ...sharedDriveFolders, ...folderResult.files],
    nextPageToken: folderResult.nextPageToken,
  };
}

export async function listDriveRootComplete(
  accessToken: string,
): Promise<DriveListResult> {
  const folderResult = await listDriveFolderComplete(accessToken, "root");
  const sharedDrives = await listSharedDrivesComplete(accessToken);
  const sharedDriveFolders: DriveFile[] = sharedDrives
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
    .map((drive) => ({
      id: drive.id,
      name: drive.name,
      mimeType: FOLDER_MIME_TYPE,
      modifiedTime: "",
      isFolder: true,
      driveId: drive.id,
      isSharedDriveRoot: true,
    }));
  const sharedWithMeEntry: DriveFile = {
    id: "__shared_with_me__",
    name: "Shared with me",
    mimeType: FOLDER_MIME_TYPE,
    modifiedTime: "",
    isFolder: true,
    browseMode: "sharedWithMe",
  };

  return {
    files: [sharedWithMeEntry, ...sharedDriveFolders, ...folderResult.files],
    nextPageToken: undefined,
  };
}

/**
 * Download a file from Google Drive.
 *
 * For Google-native documents (Sheets, Docs), performs an export.
 * For binary files (PDF, CSV, DOCX, text), downloads directly.
 *
 * Returns { buffer, fileName, mimeType }.
 */
export async function downloadDriveFile(
  accessToken: string,
  fileId: string,
  fileMimeType: string,
  fileName: string,
  options?: {
    maxBytes?: number;
  },
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const isGoogleSheet =
    fileMimeType === "application/vnd.google-apps.spreadsheet";
  const isGoogleDoc =
    fileMimeType === "application/vnd.google-apps.document";

  let url: string;
  let exportMimeType: string;
  let exportFileName: string;

  if (isGoogleSheet) {
    // Export Google Sheets as CSV
    url = `${DRIVE_API_BASE}/files/${fileId}/export?mimeType=text/csv`;
    exportMimeType = "text/csv";
    exportFileName = fileName.replace(/\.[^.]*$/, "") + ".csv";
  } else if (isGoogleDoc) {
    // Export Google Docs as DOCX so downstream pipelines can retain document structure.
    url =
      `${DRIVE_API_BASE}/files/${fileId}/export?mimeType=` +
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    exportMimeType =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    exportFileName = fileName.replace(/\.[^.]*$/, "") + ".docx";
  } else {
    // Download directly
    url = `${DRIVE_API_BASE}/files/${fileId}?alt=media&supportsAllDrives=true`;
    exportMimeType = fileMimeType;
    exportFileName = normalizeFileNameForMimeType(fileName, fileMimeType);
  }

  const res = await fetchWithTimeoutAndRetry(
    url,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { timeoutMs: DRIVE_DOWNLOAD_TIMEOUT_MS, maxRetriesOn429: 1 }
  );

  if (!res.ok) {
    const text = await res.text();
    // 403 with "cannotDownloadFile" / "This file cannot be downloaded by the
    // user" is non-retryable: the Drive owner disabled download
    // (`viewersCanCopyContent: false`), or the file is DRM-protected.
    // Surface a typed error so callers can mark the doc failed without
    // burning Inngest retries on it.
    if (res.status === 403 && /cannot\s+be\s+downloaded\s+by\s+the\s+user|cannotDownloadFile/i.test(text)) {
      throw new GoogleDriveDownloadForbiddenError(
        `Google Drive download forbidden by file owner — "${fileName}"`,
        { fileId, fileName, body: text.slice(0, 200) },
      );
    }
    throw new Error(
      `Google Drive download failed (${res.status}): ${text.slice(0, 200)}`
    );
  }

  const buffer = await readResponseBufferWithLimit(
    res,
    options?.maxBytes ?? DRIVE_DOWNLOAD_MAX_BYTES,
    `Google Drive download for ${exportFileName}`,
  );
  return {
    buffer,
    fileName: exportFileName,
    mimeType: exportMimeType,
  };
}

/**
 * Thrown when Google Drive refuses to serve the file content (403 with the
 * "cannot be downloaded by the user" / "cannotDownloadFile" reason — owner
 * disabled download, or DRM). Non-retryable: the policy won't change on a
 * later Inngest attempt.
 */
export class GoogleDriveDownloadForbiddenError extends Error {
  readonly fileId: string;
  readonly fileName: string;
  readonly responseBody: string;
  constructor(
    message: string,
    details: { fileId: string; fileName: string; body: string },
  ) {
    super(message);
    this.name = "GoogleDriveDownloadForbiddenError";
    this.fileId = details.fileId;
    this.fileName = details.fileName;
    this.responseBody = details.body;
  }
}

/**
 * Refresh a Google OAuth2 access token using a refresh_token.
 */
export async function refreshDriveAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetchWithTimeoutAndRetry(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    },
    { timeoutMs: DRIVE_API_TIMEOUT_MS, maxRetriesOn429: 1 }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Google token refresh failed (${res.status}): ${text.slice(0, 200)}`
    );
  }

  return (await res.json()) as { access_token: string; expires_in: number };
}
