"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HardDrive,
  Search,
  FileSpreadsheet,
  FileText,
  File,
  Folder,
  Loader2,
  CheckCircle2,
  XCircle,
  Import,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  Save,
  Link2,
} from "lucide-react";
import type {
  DriveFile,
  GoogleDriveConnectionMetadata,
  GoogleDriveRootSelection,
  GoogleDriveWatchedFolder,
} from "@/lib/connectors/google-drive";
import {
  coerceGoogleDriveConnectionMetadata,
  getGoogleDriveRootSelection,
} from "@/lib/connectors/google-drive";

type ImportStatus = "idle" | "importing" | "done";

interface ImportResult {
  fileId: string;
  fileName: string;
  status: "queued" | "skipped" | "error";
  error?: string;
}

interface ResolvedDriveLink {
  connectionId: string;
  connectionLabel?: string | null;
  root: GoogleDriveRootSelection | null;
  item: {
    id: string;
    name: string;
    mimeType: string;
    size?: string | null;
    modifiedTime?: string | null;
    version?: string | null;
    webViewLink?: string | null;
    driveId?: string | null;
    parents: string[];
    sourcePath: string;
    isFolder: boolean;
    isImportable: boolean;
  };
  actions: {
    canImport: boolean;
    canWatch: boolean;
    canSetAsRoot: boolean;
    withinRoot: boolean | null;
    rootConfigured: boolean;
    unsupportedReason?: string | null;
  };
}

interface BreadcrumbEntry {
  id: string | null;
  name: string;
  driveId?: string | null;
  browseMode?: "sharedWithMe" | null;
}

interface SelectedFolder {
  folderId: string;
  driveId?: string;
  path?: string;
}

interface GoogleDriveConnectionPayload {
  id: string;
  provider: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

interface DriveConnectionOption {
  id: string;
  metadata: GoogleDriveConnectionMetadata;
  createdAt?: string;
  updatedAt?: string;
}

function readConnectionLabel(metadata: GoogleDriveConnectionMetadata): string {
  return metadata.connectionLabel?.trim() || "Google Drive";
}

function getFolderSelectionKey(folderId: string, driveId?: string) {
  return `${driveId ?? "my-drive"}:${folderId}`;
}

function readWatchedFolders(
  metadata: GoogleDriveConnectionMetadata | Record<string, unknown> | undefined
): Map<string, GoogleDriveWatchedFolder> {
  const raw = Array.isArray(metadata?.watchedFolders)
    ? metadata.watchedFolders
    : [];
  const entries: Array<[string, GoogleDriveWatchedFolder]> = [];

  for (const entry of raw) {
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

    entries.push([
      getFolderSelectionKey(watchedFolder.folderId, watchedFolder.driveId),
      watchedFolder,
    ]);
  }

  return new Map(entries);
}

function buildWatchedFolderPath(
  breadcrumbs: BreadcrumbEntry[],
  folder: DriveFile
): string {
  if (folder.browseMode === "sharedWithMe") {
    return "Shared with me";
  }

  if (folder.isSharedDriveRoot) {
    return folder.name;
  }

  const pathParts = breadcrumbs.slice(1).map((crumb) => crumb.name);
  if (pathParts.length === 0) {
    return `My Drive / ${folder.name}`;
  }
  return [...pathParts, folder.name].join(" / ");
}

function buildCurrentBrowsePath(breadcrumbs: BreadcrumbEntry[]): string | null {
  const pathParts = breadcrumbs.slice(1).map((crumb) => crumb.name).filter(Boolean);
  if (pathParts.length === 0) {
    return null;
  }
  return pathParts.join(" / ");
}

function buildDriveFileSourcePath(
  breadcrumbs: BreadcrumbEntry[],
  file: DriveFile
): string {
  if (typeof file.path === "string" && file.path.trim().length > 0) {
    return file.path;
  }

  const currentPath = buildCurrentBrowsePath(breadcrumbs);
  if (currentPath) {
    return `${currentPath} / ${file.name}`;
  }

  return file.name;
}

function getFileIcon(mimeType: string) {
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("csv") ||
    mimeType.includes("excel")
  ) {
    return FileSpreadsheet;
  }
  if (mimeType.includes("pdf")) {
    return FileText;
  }
  return File;
}

function formatFileSize(sizeStr?: string): string {
  if (!sizeStr) return "Google Doc";
  const bytes = parseInt(sizeStr, 10);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => ({}));
  return typeof payload.error === "string" ? payload.error : fallback;
}

export function DriveFilePicker() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [driveConnections, setDriveConnections] = useState<DriveConnectionOption[]>([]);
  const [connectionLabel, setConnectionLabel] = useState("");
  const [rootFolderId, setRootFolderId] = useState<string | null>(null);
  const [rootDriveId, setRootDriveId] = useState<string | null>(null);
  const [rootBrowseMode, setRootBrowseMode] = useState<"sharedWithMe" | null>(null);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<
    Map<string, SelectedFolder>
  >(new Map());
  const [watchedFolders, setWatchedFolders] = useState<
    Map<string, GoogleDriveWatchedFolder>
  >(new Map());
  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [watchSaving, setWatchSaving] = useState(false);
  const [watchSyncing, setWatchSyncing] = useState(false);
  const [watchNotice, setWatchNotice] = useState<string | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [lastAutoImportAt, setLastAutoImportAt] = useState<string | null>(null);
  const [watchConfigLoaded, setWatchConfigLoaded] = useState(false);
  const [rootSelectionMode, setRootSelectionMode] = useState(false);
  const [driveLink, setDriveLink] = useState("");
  const [linkResolving, setLinkResolving] = useState(false);
  const [resolvedLink, setResolvedLink] = useState<ResolvedDriveLink | null>(null);
  const [linkAction, setLinkAction] = useState<
    "import" | "watch" | "root" | "root-watch" | null
  >(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);

  // Folder navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentDriveId, setCurrentDriveId] = useState<string | null>(null);
  const [currentBrowseMode, setCurrentBrowseMode] = useState<
    "sharedWithMe" | null
  >(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([
    { id: null, name: "Google Drive", driveId: null, browseMode: null },
  ]);

  // Track whether we are in search mode (query entered)
  const isSearching = query.length > 0;

  // Ref to track the latest folderId for fetchFiles
  const currentFolderRef = useRef(currentFolderId);
  const currentDriveRef = useRef(currentDriveId);
  const currentBrowseModeRef = useRef(currentBrowseMode);
  const fetchRequestIdRef = useRef(0);
  const fetchFilesRef = useRef<
    | ((
        folderId?: string | null,
        driveId?: string | null,
        browseMode?: "sharedWithMe" | null
      ) => Promise<void>)
    | undefined
  >(undefined);
  currentFolderRef.current = currentFolderId;
  currentDriveRef.current = currentDriveId;
  currentBrowseModeRef.current = currentBrowseMode;

  const fetchFiles = useCallback(
    async (
      folderId?: string | null,
      driveId?: string | null,
      browseMode?: "sharedWithMe" | null
    ) => {
      const requestId = ++fetchRequestIdRef.current;
      setLoading(true);
      setError(null);

      // Use provided folderId or fall back to current
      const targetFolderId =
        folderId !== undefined ? folderId : currentFolderRef.current;
      const targetDriveId =
        driveId !== undefined ? driveId : currentDriveRef.current;
      const targetBrowseMode =
        browseMode !== undefined ? browseMode : currentBrowseModeRef.current;

      if (!connectionId) {
        if (requestId === fetchRequestIdRef.current) {
          setFiles([]);
          setHasLoaded(true);
          setLoading(false);
        }
        return;
      }

      try {
        const params = new URLSearchParams();
        params.set("connectionId", connectionId);
        if (query) {
          params.set("query", query);
        } else if (targetBrowseMode === "sharedWithMe") {
          params.set("view", "sharedWithMe");
        } else if (targetFolderId) {
          params.set("folderId", targetFolderId);
        }
        if (!query && targetDriveId) {
          params.set("driveId", targetDriveId);
        }
        params.set("fetchAll", "1");

        const res = await fetch(
          `/api/connections/google-drive/files?${params}`
        );

        if (!res.ok) {
          const body = await res
            .json()
            .catch(() => ({ error: "Failed to list files" }));
          throw new Error(body.error || `HTTP ${res.status}`);
        }

        const data = await res.json();

        if (requestId !== fetchRequestIdRef.current) {
          return;
        }

        setFiles(data.files);
        setHasLoaded(true);
      } catch (err) {
        if (requestId !== fetchRequestIdRef.current) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to list files");
      } finally {
        if (requestId === fetchRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [connectionId, query]
  );

  useEffect(() => {
    fetchFilesRef.current = fetchFiles;
  }, [fetchFiles]);

  // Initial load
  useEffect(() => {
    if (!hasLoaded && connectionId) {
      fetchFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const loadWatchConfig = useCallback(async () => {
    setWatchError(null);
    try {
      const response = await fetch("/api/connections");
      const payload = await response.json().catch(() => []);

      if (!response.ok || !Array.isArray(payload)) {
        throw new Error("Failed to load Google Drive connection");
      }

      const googleDriveConnections = payload
        .filter(
          (item: unknown): item is GoogleDriveConnectionPayload =>
            !!item &&
            typeof item === "object" &&
            (item as Record<string, unknown>).provider === "google_drive" &&
            (item as Record<string, unknown>).status === "active"
        )
        .map((connection) => ({
          id: connection.id,
          metadata: coerceGoogleDriveConnectionMetadata(connection.metadata),
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        }));

      setDriveConnections(googleDriveConnections);

      if (googleDriveConnections.length === 0) {
        setConnectionId(null);
        setConnectionLabel("");
        setRootFolderId(null);
        setRootDriveId(null);
        setRootBrowseMode(null);
        setRootPath(null);
        setWatchedFolders(new Map());
        setLastAutoImportAt(null);
        setWatchConfigLoaded(true);
        return;
      }

      const selectedConnection =
        googleDriveConnections.find((connection) => connection.id === connectionId) ??
        googleDriveConnections[0];
      const root = getGoogleDriveRootSelection(selectedConnection.metadata);

      setConnectionId(selectedConnection.id);
      setConnectionLabel(readConnectionLabel(selectedConnection.metadata));
      setRootFolderId(root?.folderId ?? null);
      setRootDriveId(root?.driveId ?? null);
      setRootBrowseMode(root?.browseMode ?? null);
      setRootPath(root?.path ?? null);
      setWatchedFolders(readWatchedFolders(selectedConnection.metadata));
      setLastAutoImportAt(selectedConnection.metadata.autoImportLastRunAt ?? null);
      setRootSelectionMode(!root);
      setCurrentFolderId(root?.folderId ?? null);
      setCurrentDriveId(root?.driveId ?? null);
      setCurrentBrowseMode(root?.browseMode ?? null);
      setBreadcrumbs(
        root
          ? [
              {
                id: null,
                name: readConnectionLabel(selectedConnection.metadata),
                driveId: null,
                browseMode: null,
              },
              {
                id: root.folderId,
                name: root.path ?? "Company Root",
                driveId: root.driveId ?? null,
                browseMode: root.browseMode ?? null,
              },
            ]
          : [{ id: null, name: "Google Drive", driveId: null, browseMode: null }]
      );
      setHasLoaded(false);
      setWatchConfigLoaded(true);
    } catch (err) {
      setWatchError(
        err instanceof Error
          ? err.message
          : "Failed to load auto-import configuration"
      );
      setWatchConfigLoaded(true);
    }
  }, [connectionId]);

  useEffect(() => {
    void loadWatchConfig();
  }, [loadWatchConfig]);

  const handleSearch = useCallback(() => {
    if (!connectionId) return;
    setSelectedIds(new Set());
    setSelectedFolders(new Map());
    void fetchFilesRef.current?.();
  }, [connectionId]);

  const handleSelectConnection = useCallback((nextConnectionId: string) => {
    setConnectionId(nextConnectionId);
    setFiles([]);
    setHasLoaded(false);
    setSelectedIds(new Set());
    setSelectedFolders(new Map());
    setCurrentFolderId(null);
    setCurrentDriveId(null);
    setCurrentBrowseMode(null);
    setBreadcrumbs([
      { id: null, name: "Google Drive", driveId: null, browseMode: null },
    ]);
    setQuery("");
    setImportStatus("idle");
    setImportResults([]);
  }, []);

  // When query is cleared, go back to folder view
  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (value === "" && isSearching) {
        // Clear search, return to current folder
        setSelectedIds(new Set());
        setSelectedFolders(new Map());
        // Need to delay fetchFiles so query state updates first
        setTimeout(
          () =>
            void fetchFilesRef.current?.(
              currentFolderId,
              currentDriveId,
              currentBrowseMode
            ),
          0
        );
      }
    },
    [isSearching, currentBrowseMode, currentDriveId, currentFolderId]
  );

  const navigateToFolder = useCallback(
    (folder: DriveFile | BreadcrumbEntry) => {
      const folderId = folder.id;
      const folderName = folder.name;
      const driveId =
        "driveId" in folder ? (folder.driveId ?? null) : currentDriveRef.current;
      const browseMode =
        "browseMode" in folder ? (folder.browseMode ?? null) : null;

      setCurrentFolderId(folderId);
      setCurrentDriveId(driveId);
      setCurrentBrowseMode(browseMode);
      setFiles([]);
      setSelectedIds(new Set());
      setSelectedFolders(new Map());
      setQuery("");
      setImportStatus("idle");
      setImportResults([]);

      if (folderId === null) {
        // Going to root
        setBreadcrumbs([
          { id: null, name: "Google Drive", driveId: null, browseMode: null },
        ]);
      } else {
        setBreadcrumbs((prev) => [
          ...prev,
          { id: folderId, name: folderName, driveId, browseMode },
        ]);
      }

      void fetchFilesRef.current?.(folderId, driveId, browseMode);
    },
    []
  );

  const navigateToBreadcrumb = useCallback(
    (index: number) => {
      const target = breadcrumbs[index];
      setCurrentFolderId(target.id);
      setCurrentDriveId(target.driveId ?? null);
      setCurrentBrowseMode(target.browseMode ?? null);
      setBreadcrumbs(breadcrumbs.slice(0, index + 1));
      setFiles([]);
      setSelectedIds(new Set());
      setSelectedFolders(new Map());
      setQuery("");
      setImportStatus("idle");
      setImportResults([]);

      void fetchFilesRef.current?.(
        target.id,
        target.driveId ?? null,
        target.browseMode ?? null
      );
    },
    [breadcrumbs]
  );

  const toggleSelection = useCallback((fileId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }, []);

  const toggleFolderSelection = useCallback((folder: DriveFile) => {
    const key = getFolderSelectionKey(folder.id, folder.driveId);
    setSelectedFolders((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, {
          folderId: folder.id,
          driveId: folder.driveId,
          path: buildWatchedFolderPath(breadcrumbs, folder),
        });
      }
      return next;
    });
  }, [breadcrumbs]);

  const toggleWatchedFolder = useCallback(
    (folder: DriveFile) => {
      if (folder.id === "__shared_with_me__") return;

      const key = getFolderSelectionKey(folder.id, folder.driveId);
      setWatchedFolders((current) => {
        const next = new Map(current);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.set(key, {
            folderId: folder.id,
            driveId: folder.driveId,
            browseMode: folder.browseMode,
            enabled: true,
            name: folder.name,
            path: buildWatchedFolderPath(breadcrumbs, folder),
            watchCreatedAt: new Date().toISOString(),
          });
        }
        return next;
      });
      setWatchNotice(null);
      setWatchError(null);
    },
    [breadcrumbs]
  );

  const handleImport = useCallback(async () => {
    if (selectedIds.size === 0 && selectedFolders.size === 0) return;

    setImportStatus("importing");
    setImportResults([]);

    const selectedFiles = files.filter(
      (f) => selectedIds.has(f.id) && !f.isFolder
    );

    try {
      const res = await fetch("/api/connections/google-drive/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          files: selectedFiles.map((f) => ({
            fileId: f.id,
            fileName: f.name,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
            version: f.version,
            sourcePath: buildDriveFileSourcePath(breadcrumbs, f),
            rootPath,
            connectionLabel: connectionLabel.trim() || undefined,
          })),
          folderSelections: Array.from(selectedFolders.values()),
        }),
      });

      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: "Import failed" }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setImportResults(data.results);
      setImportStatus("done");
      setSelectedIds(new Set());
      setSelectedFolders(new Map());
    } catch (err) {
      setImportResults([
        {
          fileId: "all",
          fileName: "Import",
          status: "error",
          error: err instanceof Error ? err.message : "Import failed",
        },
      ]);
      setImportStatus("done");
    }
  }, [
    breadcrumbs,
    connectionId,
    connectionLabel,
    files,
    rootPath,
    selectedFolders,
    selectedIds,
  ]);

  const handleSaveWatchedFolders = useCallback(async () => {
    if (!connectionId) return;

    setWatchSaving(true);
    setWatchError(null);
    setWatchNotice(null);

    try {
      const response = await fetch(`/api/connections/${connectionId}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionLabel: connectionLabel.trim() || null,
          rootFolderId,
          rootDriveId,
          rootBrowseMode,
          rootPath,
          watchedFolders: Array.from(watchedFolders.values()),
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to save watched folders (${response.status})`
        );
      }

      setWatchedFolders(readWatchedFolders(payload));
      setConnectionLabel(
        typeof payload.connectionLabel === "string"
          ? payload.connectionLabel
          : connectionLabel
      );
      setRootFolderId(
        typeof payload.rootFolderId === "string" ? payload.rootFolderId : null
      );
      setRootDriveId(
        typeof payload.rootDriveId === "string" ? payload.rootDriveId : null
      );
      setRootBrowseMode(
        payload.rootBrowseMode === "sharedWithMe" ? "sharedWithMe" : null
      );
      setRootPath(
        typeof payload.rootPath === "string" ? payload.rootPath : null
      );
      setWatchNotice("Saved daily auto-import folders.");

      const refresh = (window as unknown as Record<string, unknown>)
        .__refreshConnections;
      if (typeof refresh === "function") {
        (refresh as () => void)();
      }
    } catch (err) {
      setWatchError(
        err instanceof Error
          ? err.message
          : "Failed to save watched folders"
      );
    } finally {
      setWatchSaving(false);
    }
  }, [
    connectionId,
    connectionLabel,
    rootBrowseMode,
    rootDriveId,
    rootFolderId,
    rootPath,
    watchedFolders,
  ]);

  const handleSetCompanyRoot = useCallback((folder: DriveFile) => {
    const nextRootPath =
      folder.browseMode === "sharedWithMe"
        ? folder.name
        : buildWatchedFolderPath(breadcrumbs, folder);

    setRootFolderId(folder.id);
    setRootDriveId(folder.driveId ?? null);
    setRootBrowseMode(folder.browseMode ?? null);
    setRootPath(nextRootPath);
    setRootSelectionMode(false);
    setWatchedFolders(new Map());
    setWatchNotice(
      `Selected ${folder.name} as the company root. Save to apply the new boundary.`
    );
    setWatchError(null);
  }, [breadcrumbs]);

  const handleClearCompanyRoot = useCallback(() => {
    setRootFolderId(null);
    setRootDriveId(null);
    setRootBrowseMode(null);
    setRootPath(null);
    setRootSelectionMode(true);
    setWatchedFolders(new Map());
    setCurrentFolderId(null);
    setCurrentDriveId(null);
    setCurrentBrowseMode(null);
    setBreadcrumbs([
      { id: null, name: "Google Drive", driveId: null, browseMode: null },
    ]);
    setFiles([]);
    setHasLoaded(false);
    setWatchNotice("Cleared the company root. Choose a new root folder and save.");
    setWatchError(null);
  }, []);

  const handleSyncWatchedFolders = useCallback(async () => {
    if (!connectionId) return;

    setWatchSyncing(true);
    setWatchError(null);
    setWatchNotice(null);

    try {
      const response = await fetch(`/api/connections/${connectionId}/sync`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to trigger Google Drive sync (${response.status})`
        );
      }

      setWatchNotice("Google Drive watched-folder sync triggered.");

      const refresh = (window as unknown as Record<string, unknown>)
        .__refreshConnections;
      if (typeof refresh === "function") {
        (refresh as () => void)();
      }
    } catch (err) {
      setWatchError(
        err instanceof Error
          ? err.message
          : "Failed to trigger watched-folder sync"
      );
    } finally {
      setWatchSyncing(false);
    }
  }, [connectionId]);

  const updateDriveConfigFromLink = useCallback(
    async (input: {
      rootFolderId: string | null;
      rootDriveId: string | null;
      rootBrowseMode: "sharedWithMe" | null;
      rootPath: string | null;
      watchedFolders: GoogleDriveWatchedFolder[];
      notice: string;
    }) => {
      if (!connectionId) {
        throw new Error("Choose a Google Drive connection first.");
      }

      const response = await fetch(`/api/connections/${connectionId}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionLabel: connectionLabel.trim() || null,
          rootFolderId: input.rootFolderId,
          rootDriveId: input.rootDriveId,
          rootBrowseMode: input.rootBrowseMode,
          rootPath: input.rootPath,
          watchedFolders: input.watchedFolders,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to save Google Drive configuration (${response.status})`
        );
      }

      setWatchedFolders(readWatchedFolders(payload));
      setConnectionLabel(
        typeof payload.connectionLabel === "string"
          ? payload.connectionLabel
          : connectionLabel
      );
      setRootFolderId(
        typeof payload.rootFolderId === "string" ? payload.rootFolderId : null
      );
      setRootDriveId(
        typeof payload.rootDriveId === "string" ? payload.rootDriveId : null
      );
      setRootBrowseMode(
        payload.rootBrowseMode === "sharedWithMe" ? "sharedWithMe" : null
      );
      setRootPath(
        typeof payload.rootPath === "string" ? payload.rootPath : null
      );
      setRootSelectionMode(!payload.rootFolderId);
      setWatchNotice(input.notice);
      setLinkNotice(input.notice);

      const refresh = (window as unknown as Record<string, unknown>)
        .__refreshConnections;
      if (typeof refresh === "function") {
        (refresh as () => void)();
      }
    },
    [connectionId, connectionLabel]
  );

  const handleResolveDriveLink = useCallback(async () => {
    if (!driveLink.trim()) return;

    setLinkResolving(true);
    setLinkError(null);
    setLinkNotice(null);
    setResolvedLink(null);

    try {
      const response = await fetch("/api/connections/google-drive/resolve-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: driveLink.trim(), connectionId }),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            `Failed to resolve Google Drive link (${response.status})`
          )
        );
      }

      const payload = (await response.json()) as ResolvedDriveLink;
      setResolvedLink(payload);
      if (!connectionId) {
        setConnectionId(payload.connectionId);
      }
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : "Failed to resolve Google Drive link"
      );
    } finally {
      setLinkResolving(false);
    }
  }, [connectionId, driveLink]);

  const handleImportResolvedLink = useCallback(async () => {
    if (!resolvedLink || !resolvedLink.actions.canImport) return;

    setLinkAction("import");
    setLinkError(null);
    setLinkNotice(null);

    try {
      const item = resolvedLink.item;
      const response = await fetch("/api/connections/google-drive/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          item.isFolder
            ? {
                connectionId: resolvedLink.connectionId,
                folderSelections: [
                  {
                    folderId: item.id,
                    driveId: item.driveId ?? undefined,
                    path: item.sourcePath || item.name,
                  },
                ],
              }
            : {
                connectionId: resolvedLink.connectionId,
                files: [
                  {
                    fileId: item.id,
                    fileName: item.name,
                    mimeType: item.mimeType,
                    modifiedTime: item.modifiedTime ?? undefined,
                    version: item.version ?? undefined,
                    sourcePath: item.sourcePath || item.name,
                    rootPath,
                    connectionLabel: connectionLabel.trim() || undefined,
                  },
                ],
              }
        ),
      });

      if (!response.ok) {
        throw new Error(
          await readApiError(
            response,
            `Google Drive import failed (${response.status})`
          )
        );
      }

      const payload = await response.json();
      setImportResults(Array.isArray(payload.results) ? payload.results : []);
      setImportStatus("done");
      setLinkNotice(
        item.isFolder
          ? `Queued import for folder "${item.name}".`
          : `Queued import for "${item.name}".`
      );
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Failed to import link");
    } finally {
      setLinkAction(null);
    }
  }, [connectionLabel, resolvedLink, rootPath]);

  const handleWatchResolvedFolder = useCallback(async () => {
    if (!resolvedLink || !resolvedLink.item.isFolder || !resolvedLink.actions.canWatch) {
      return;
    }

    setLinkAction("watch");
    setLinkError(null);
    setLinkNotice(null);

    try {
      const item = resolvedLink.item;
      const nextWatchedFolders = new Map(watchedFolders);
      nextWatchedFolders.set(getFolderSelectionKey(item.id, item.driveId ?? undefined), {
        folderId: item.id,
        driveId: item.driveId ?? undefined,
        enabled: true,
        name: item.name,
        path: item.sourcePath || item.name,
        watchCreatedAt: new Date().toISOString(),
      });

      await updateDriveConfigFromLink({
        rootFolderId,
        rootDriveId,
        rootBrowseMode,
        rootPath,
        watchedFolders: Array.from(nextWatchedFolders.values()),
        notice: `Added "${item.name}" to daily watched folders.`,
      });
    } catch (err) {
      setLinkError(
        err instanceof Error ? err.message : "Failed to watch Google Drive folder"
      );
    } finally {
      setLinkAction(null);
    }
  }, [
    resolvedLink,
    rootBrowseMode,
    rootDriveId,
    rootFolderId,
    rootPath,
    updateDriveConfigFromLink,
    watchedFolders,
  ]);

  const handleUseResolvedFolderAsRoot = useCallback(
    async (watch: boolean) => {
      if (!resolvedLink || !resolvedLink.item.isFolder) return;

      setLinkAction(watch ? "root-watch" : "root");
      setLinkError(null);
      setLinkNotice(null);

      try {
        const item = resolvedLink.item;
        const nextWatchedFolders: GoogleDriveWatchedFolder[] = watch
          ? [
              {
                folderId: item.id,
                driveId: item.driveId ?? undefined,
                enabled: true,
                name: item.name,
                path: item.name,
                watchCreatedAt: new Date().toISOString(),
              },
            ]
          : [];

        await updateDriveConfigFromLink({
          rootFolderId: item.id,
          rootDriveId: item.driveId ?? null,
          rootBrowseMode: null,
          rootPath: item.name,
          watchedFolders: nextWatchedFolders,
          notice: watch
            ? `Set "${item.name}" as company root and enabled daily watch.`
            : `Set "${item.name}" as company root.`,
        });

        setCurrentFolderId(item.id);
        setCurrentDriveId(item.driveId ?? null);
        setCurrentBrowseMode(null);
        setBreadcrumbs([
          { id: null, name: connectionLabel || "Google Drive", driveId: null, browseMode: null },
          { id: item.id, name: item.name, driveId: item.driveId ?? null, browseMode: null },
        ]);
        setHasLoaded(false);
        void fetchFilesRef.current?.(item.id, item.driveId ?? null, null);
      } catch (err) {
        setLinkError(
          err instanceof Error ? err.message : "Failed to save Google Drive root"
        );
      } finally {
        setLinkAction(null);
      }
    },
    [connectionLabel, resolvedLink, updateDriveConfigFromLink]
  );

  // Separate folders and files for rendering
  const folders = files.filter((f) => f.isFolder);
  const regularFiles = files.filter((f) => !f.isFolder);

  const totalSelected = selectedIds.size + selectedFolders.size;
  const watchedFolderList = Array.from(watchedFolders.values()).sort((a, b) =>
    (a.path ?? a.name).localeCompare(b.path ?? b.name)
  );

  // Compute import result summary
  const queuedCount = importResults.filter(
    (r) => r.status === "queued"
  ).length;
  const skippedCount = importResults.filter(
    (r) => r.status === "skipped"
  ).length;
  const errorCount = importResults.filter((r) => r.status === "error").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDrive className="size-4" />
          Import from Google Drive
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Google Drive connection
              </p>
              <Select
                value={connectionId ?? undefined}
                onValueChange={handleSelectConnection}
                disabled={driveConnections.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      driveConnections.length === 0
                        ? "No active Google Drive connection"
                        : "Choose a Google Drive connection"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {driveConnections.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {readConnectionLabel(connection.metadata)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                Connection label
              </p>
              <Input
                value={connectionLabel}
                onChange={(event) => setConnectionLabel(event.target.value)}
                placeholder="Example Finance Drive"
                disabled={!connectionId}
              />
            </div>
          </div>

          <div className="rounded-md border border-border/70 bg-background/70 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Company root folder
                </p>
                <p className="text-xs text-muted-foreground">
                  Browse, search, import, and watched folders are limited to this root and its subtree.
                </p>
                {rootFolderId ? (
                  <p className="text-xs text-muted-foreground">
                    {rootPath ?? rootFolderId}
                  </p>
                ) : (
                  <p className="text-xs text-amber-600">
                    Root folder not configured yet. Select a folder below and set it as the company root before importing.
                  </p>
                )}
              </div>
              {rootFolderId ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClearCompanyRoot}
                >
                  Clear Root
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Link2 className="size-4" />
                Import by Google Drive link
              </p>
              <p className="text-xs text-muted-foreground">
                Paste a Drive file, Google Doc, Sheet, or folder link. Files are
                imported once; folders can also be marked for daily watch.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 md:flex-row">
            <Input
              value={driveLink}
              onChange={(event) => {
                setDriveLink(event.target.value);
                setResolvedLink(null);
                setLinkError(null);
                setLinkNotice(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleResolveDriveLink();
                }
              }}
              placeholder="https://drive.google.com/drive/folders/..."
              disabled={!connectionId || linkResolving}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleResolveDriveLink()}
              disabled={!connectionId || !driveLink.trim() || linkResolving}
            >
              {linkResolving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Link2 className="mr-2 size-4" />
              )}
              Check Link
            </Button>
          </div>

          {linkError ? (
            <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
              <AlertCircle className="size-4 shrink-0" />
              <span>{linkError}</span>
            </div>
          ) : null}

          {linkNotice ? (
            <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
              {linkNotice}
            </div>
          ) : null}

          {resolvedLink ? (
            <div className="space-y-3 rounded-md border border-border/70 bg-background/70 px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {resolvedLink.item.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {resolvedLink.item.mimeType}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">
                    {resolvedLink.item.isFolder ? "Folder" : "File"}
                  </Badge>
                  {resolvedLink.actions.withinRoot === false ? (
                    <Badge variant="destructive">Outside root</Badge>
                  ) : resolvedLink.actions.withinRoot === true ? (
                    <Badge variant="outline">Inside root</Badge>
                  ) : (
                    <Badge variant="outline">No root yet</Badge>
                  )}
                </div>
              </div>

              {resolvedLink.actions.unsupportedReason ? (
                <p className="text-sm text-amber-600">
                  {resolvedLink.actions.unsupportedReason}
                </p>
              ) : null}

              {!resolvedLink.actions.rootConfigured && !resolvedLink.item.isFolder ? (
                <p className="text-sm text-amber-600">
                  Configure a company root folder first. File links are only
                  imported after the Drive connection has an explicit company
                  root boundary.
                </p>
              ) : null}

              {resolvedLink.actions.rootConfigured &&
              resolvedLink.actions.withinRoot === false ? (
                <p className="text-sm text-amber-600">
                  This link is outside the configured company root. Choose a
                  link inside the root or change the root deliberately.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {resolvedLink.item.isFolder && !resolvedLink.actions.rootConfigured ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleUseResolvedFolderAsRoot(false)}
                      disabled={linkAction !== null}
                    >
                      {linkAction === "root" ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : null}
                      Use as Company Root
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleUseResolvedFolderAsRoot(true)}
                      disabled={linkAction !== null}
                    >
                      {linkAction === "root-watch" ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : null}
                      Root + Watch Daily
                    </Button>
                  </>
                ) : null}

                {resolvedLink.actions.canImport ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleImportResolvedLink()}
                    disabled={linkAction !== null}
                  >
                    {linkAction === "import" ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Import className="mr-2 size-4" />
                    )}
                    {resolvedLink.item.isFolder ? "Import Folder Now" : "Import File Now"}
                  </Button>
                ) : null}

                {resolvedLink.actions.canWatch ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleWatchResolvedFolder()}
                    disabled={linkAction !== null}
                  >
                    {linkAction === "watch" ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 size-4" />
                    )}
                    Watch Daily
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                Daily auto-import
              </p>
              <p className="text-xs text-muted-foreground">
                Watched folders are checked once a day for new supported
                documents and queued into the normal import pipeline for this specific Drive connection.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {watchedFolderList.length} watched folder
                {watchedFolderList.length === 1 ? "" : "s"}
              </Badge>
              {lastAutoImportAt ? (
                <span>Last run {formatDate(lastAutoImportAt)}</span>
              ) : null}
            </div>
          </div>

          {watchError ? (
            <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
              <AlertCircle className="size-4 shrink-0" />
              <span>{watchError}</span>
            </div>
          ) : null}

          {watchNotice ? (
            <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
              {watchNotice}
            </div>
          ) : null}

          {!watchConfigLoaded ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading auto-import configuration...
            </div>
          ) : !rootFolderId ? (
            <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              Choose and save a company root folder before enabling watched folders.
            </div>
          ) : watchedFolderList.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              No folders are watched yet. Browse below and click `Watch` on the
              folders you want checked every day.
            </div>
          ) : (
            <div className="space-y-2">
              {watchedFolderList.map((folder) => (
                <div
                  key={getFolderSelectionKey(folder.folderId, folder.driveId)}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {folder.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {folder.path ?? folder.folderId}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setWatchedFolders((current) => {
                        const next = new Map(current);
                        next.delete(
                          getFolderSelectionKey(folder.folderId, folder.driveId)
                        );
                        return next;
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadWatchConfig()}
              disabled={watchSaving || watchSyncing}
            >
              <RefreshCw className="mr-2 size-4" />
              Reload
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSaveWatchedFolders()}
              disabled={watchSaving || !connectionId}
            >
              {watchSaving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Save className="mr-2 size-4" />
              )}
              Save Watched Folders
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleSyncWatchedFolders()}
              disabled={
                watchSyncing ||
                !connectionId ||
                !rootFolderId ||
                watchedFolderList.length === 0
              }
            >
              {watchSyncing ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Sync Watched Folders
            </Button>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9 text-sm"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleSearch}>
            Search
          </Button>
        </div>

        {/* Breadcrumbs - shown when not searching */}
        {!isSearching && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 text-sm overflow-x-auto">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <span key={crumb.id ?? "root"} className="flex items-center gap-1 shrink-0">
                  {index > 0 && (
                    <ChevronRight className="size-3 text-muted-foreground shrink-0" />
                  )}
                  {isLast ? (
                    <span className="font-medium text-foreground">
                      {crumb.name}
                    </span>
                  ) : (
                    <button
                      onClick={() => navigateToBreadcrumb(index)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {crumb.name}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
        )}

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-500 p-3 rounded-lg bg-red-500/10">
            <XCircle className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {/* File list */}
        {loading && files.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 text-muted-foreground animate-spin" />
          </div>
        ) : files.length === 0 && hasLoaded ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              {isSearching
                ? "No files found matching your search."
                : "No importable files found. Supported formats: CSV, PDF, Excel, Google Sheets."}
            </p>
          </div>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {/* Folders first */}
            {folders.map((folder) => {
              const isFolderSelected = selectedFolders.has(
                getFolderSelectionKey(folder.id, folder.driveId)
              );
              const isWatched = watchedFolders.has(
                getFolderSelectionKey(folder.id, folder.driveId)
              );
              const canBulkImport =
                folder.browseMode !== "sharedWithMe" && Boolean(rootFolderId);
              const canWatch =
                folder.id !== "__shared_with_me__" && Boolean(rootFolderId);
              const canSetAsRoot =
                folder.id !== "__shared_with_me__" &&
                (!rootFolderId || rootSelectionMode);
              return (
                <div
                  key={folder.id}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                    isFolderSelected
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:bg-muted/50"
                  }`}
                >
                  {/* Folder checkbox */}
                  {canBulkImport ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFolderSelection(folder);
                      }}
                      className="group relative shrink-0"
                      title="Select folder to import all files"
                    >
                      <div
                        className={`size-4 rounded border flex items-center justify-center ${
                          isFolderSelected
                            ? "bg-primary border-primary"
                            : "border-border"
                        }`}
                      >
                        {isFolderSelected && (
                          <CheckCircle2 className="size-3 text-primary-foreground" />
                        )}
                      </div>
                      <span className="absolute left-6 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        Import all
                      </span>
                    </button>
                  ) : (
                    <div className="size-4 shrink-0" />
                  )}

                  {/* Folder icon + name (click to navigate) */}
                  <button
                    onClick={() => navigateToFolder(folder)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <Folder className="size-4 text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {folder.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {folder.browseMode === "sharedWithMe"
                          ? "Shared with me"
                          : folder.isSharedDriveRoot
                          ? "Shared drive"
                          : `Folder · ${formatDate(folder.modifiedTime)}`}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {canSetAsRoot ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSetCompanyRoot(folder);
                        }}
                      >
                        Set Root
                      </Button>
                    ) : null}
                    {canWatch ? (
                      <Button
                        type="button"
                        variant={isWatched ? "secondary" : "ghost"}
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleWatchedFolder(folder);
                        }}
                      >
                        {isWatched ? "Watching" : "Watch"}
                      </Button>
                    ) : null}
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                  </div>
                </div>
              );
            })}

            {/* Regular files */}
            {regularFiles.map((file) => {
              const FileIcon = getFileIcon(file.mimeType);
              const isSelected = selectedIds.has(file.id);
              return (
                <button
                  key={file.id}
                  onClick={() => toggleSelection(file.id)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:bg-muted/50"
                  }`}
                >
                  <div
                    className={`size-4 rounded border flex items-center justify-center shrink-0 ${
                      isSelected
                        ? "bg-primary border-primary"
                        : "border-border"
                    }`}
                  >
                    {isSelected && (
                      <CheckCircle2 className="size-3 text-primary-foreground" />
                    )}
                  </div>
                  <FileIcon className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)} &middot;{" "}
                      {formatDate(file.modifiedTime)}
                    </p>
                  </div>
                </button>
              );
            })}

          </div>
        )}

        {/* Import action */}
        {totalSelected > 0 && importStatus !== "importing" && (
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="text-sm text-muted-foreground">
              {selectedIds.size > 0 && (
                <>
                  {selectedIds.size} file{selectedIds.size > 1 ? "s" : ""}
                </>
              )}
              {selectedIds.size > 0 && selectedFolders.size > 0 && ", "}
              {selectedFolders.size > 0 && (
                <>
                  {selectedFolders.size} folder
                  {selectedFolders.size > 1 ? "s" : ""}
                </>
              )}{" "}
              selected
            </span>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={!connectionId || !rootFolderId}
            >
              <Import className="size-4 mr-1" />
              Import Selected
            </Button>
          </div>
        )}

        {importStatus === "importing" && (
          <div className="flex items-center justify-center gap-2 py-3">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Importing files...
            </span>
          </div>
        )}

        {/* Import results */}
        {importStatus === "done" && importResults.length > 0 && (
          <div className="space-y-3 pt-2 border-t border-border">
            {/* Summary line */}
            <div className="flex flex-wrap gap-2 text-sm">
              {queuedCount > 0 && (
                <Badge
                  variant="outline"
                  className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
                >
                  {queuedCount} file{queuedCount > 1 ? "s" : ""} queued for
                  import
                </Badge>
              )}
              {skippedCount > 0 && (
                <Badge
                  variant="outline"
                  className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30"
                >
                  {skippedCount} file{skippedCount > 1 ? "s" : ""} skipped
                  (already imported)
                </Badge>
              )}
              {errorCount > 0 && (
                <Badge
                  variant="outline"
                  className="bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30"
                >
                  {errorCount} error{errorCount > 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            {/* Individual results */}
            <div className="space-y-1">
              {importResults.map((result, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 text-sm p-2 rounded-md ${
                    result.status === "queued"
                      ? "bg-green-500/10 text-green-700 dark:text-green-400"
                      : result.status === "skipped"
                        ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                        : "bg-red-500/10 text-red-700 dark:text-red-400"
                  }`}
                >
                  {result.status === "queued" ? (
                    <CheckCircle2 className="size-4 shrink-0" />
                  ) : result.status === "skipped" ? (
                    <AlertCircle className="size-4 shrink-0" />
                  ) : (
                    <XCircle className="size-4 shrink-0" />
                  )}
                  <span className="truncate">{result.fileName}</span>
                  {result.status === "queued" && (
                    <Badge
                      variant="outline"
                      className="ml-auto text-[10px] px-1.5 py-0 bg-green-500/15 text-green-500 border-green-500/30"
                    >
                      Processing
                    </Badge>
                  )}
                  {result.status === "skipped" && (
                    <span className="text-xs ml-auto shrink-0">
                      Already imported
                    </span>
                  )}
                  {result.error && (
                    <span className="text-xs ml-auto shrink-0">
                      {result.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
