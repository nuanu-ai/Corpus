"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Folder,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import type { EntityResult } from "@/lib/company-db/client";

// ── Helpers ──────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ── Tree data structure ──────────────────────────────────────────────────

interface TreeFolder {
  kind: "folder";
  name: string;
  /** Full path from root, e.g. "banking/transactions" */
  path: string;
  children: Map<string, TreeNode>;
  /** Total leaf entity count in this subtree */
  entityCount: number;
}

interface TreeFile {
  kind: "file";
  name: string;
  entity: EntityResult;
}

type TreeNode = TreeFolder | TreeFile;

/**
 * Build a nested tree from a flat list of entities.
 * Each entity's `filePath` is split by `/` to determine folder nesting.
 */
function buildTree(entities: EntityResult[]): Map<string, TreeNode> {
  const root = new Map<string, TreeNode>();

  for (const entity of entities) {
    const parts = entity.filePath.split("/");
    const fileName = parts[parts.length - 1];
    const folderParts = parts.slice(0, -1);

    let current = root;
    let pathSoFar = "";

    // Create/traverse folders
    for (const folderName of folderParts) {
      pathSoFar = pathSoFar ? `${pathSoFar}/${folderName}` : folderName;
      let node = current.get(folderName);
      if (!node) {
        node = {
          kind: "folder",
          name: folderName,
          path: pathSoFar,
          children: new Map(),
          entityCount: 0,
        };
        current.set(folderName, node);
      }
      if (node.kind !== "folder") break;
      current = node.children;
    }

    // Add the file
    current.set(fileName, {
      kind: "file",
      name: fileName,
      entity,
    });
  }

  // Compute entity counts bottom-up
  function countEntities(nodes: Map<string, TreeNode>): number {
    let count = 0;
    for (const node of nodes.values()) {
      if (node.kind === "file") {
        count += 1;
      } else {
        node.entityCount = countEntities(node.children);
        count += node.entityCount;
      }
    }
    return count;
  }
  countEntities(root);

  return root;
}

/**
 * Sort tree nodes: folders first (alphabetical), then files (alphabetical).
 */
function sortedEntries(nodes: Map<string, TreeNode>): TreeNode[] {
  const folders: TreeFolder[] = [];
  const files: TreeFile[] = [];
  for (const node of nodes.values()) {
    if (node.kind === "folder") folders.push(node);
    else files.push(node);
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}

/**
 * Collect all top-level folder paths for default-expanded state.
 */
function getTopLevelPaths(root: Map<string, TreeNode>): Set<string> {
  const paths = new Set<string>();
  for (const node of root.values()) {
    if (node.kind === "folder") {
      paths.add(node.path);
    }
  }
  return paths;
}

// ── Status dot ───────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500",
  draft: "bg-yellow-500",
  archived: "bg-gray-400",
};

function StatusDot({ status }: { status: string | null }) {
  if (!status || !STATUS_COLORS[status]) return null;
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${STATUS_COLORS[status]}`}
      title={status}
    />
  );
}

// ── Domain color ─────────────────────────────────────────────────────────

const DOMAIN_COLORS: Record<string, string> = {
  banking: "text-blue-500",
  finance: "text-emerald-500",
  expenses: "text-orange-500",
  revenue: "text-violet-500",
  tax: "text-red-500",
  knowledge: "text-cyan-500",
};

// ── Recursive tree renderer ──────────────────────────────────────────────

function FolderNode({
  folder,
  depth,
  expandedPaths,
  togglePath,
  selectedFolderPath,
  onFolderClick,
  onFileClick,
}: {
  folder: TreeFolder;
  depth: number;
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedFolderPath?: string | null;
  onFolderClick?: (path: string) => void;
  onFileClick?: (entity: EntityResult) => void;
}) {
  const isOpen = expandedPaths.has(folder.path);
  const isSelected = selectedFolderPath === folder.path;
  const children = sortedEntries(folder.children);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          togglePath(folder.path);
          onFolderClick?.(folder.path);
        }}
        className={`flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-sm transition-colors ${
          isSelected ? "bg-accent/70" : "hover:bg-accent/50"
        }`}
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
      >
        {isOpen ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {isOpen ? (
          <FolderOpen className="size-4 shrink-0 text-amber-500" />
        ) : (
          <Folder className="size-4 shrink-0 text-amber-500" />
        )}
        <span className="font-medium truncate">{folder.name}</span>
        <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
          {folder.entityCount}
        </span>
      </button>

      {isOpen && (
        <div>
          {children.map((child) =>
            child.kind === "folder" ? (
              <FolderNode
                key={child.path}
                folder={child}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                togglePath={togglePath}
                selectedFolderPath={selectedFolderPath}
                onFolderClick={onFolderClick}
                onFileClick={onFileClick}
              />
            ) : (
              <FileNode
                key={child.name}
                file={child}
                depth={depth + 1}
                onFileClick={onFileClick}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function FileNode({
  file,
  depth,
  onFileClick,
}: {
  file: TreeFile;
  depth: number;
  onFileClick?: (entity: EntityResult) => void;
}) {
  const { entity } = file;
  const domainColor = DOMAIN_COLORS[entity.domain] ?? "text-muted-foreground";
  const wrapperClassName =
    "flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-sm transition-colors";
  const wrapperStyle = { paddingLeft: `${depth * 20 + 4 + 18}px` };
  const commonRight = (
    <div className="ml-auto flex items-center gap-1.5 shrink-0">
      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
        {entity.type}
      </Badge>
      <span className={`text-[10px] ${domainColor}`}>{entity.domain}</span>
      <StatusDot status={entity.status} />
      {entity.updatedAt && (
        <time
          dateTime={entity.updatedAt}
          title={new Date(entity.updatedAt).toLocaleString()}
          className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap"
        >
          {relativeTime(entity.updatedAt)}
        </time>
      )}
    </div>
  );

  if (onFileClick) {
    return (
      <button
        type="button"
        onClick={() => onFileClick(entity)}
        className={`${wrapperClassName} hover:bg-accent/50 cursor-pointer`}
        style={wrapperStyle}
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-left" title={entity.filePath}>
          {file.name}
        </span>
        {commonRight}
      </button>
    );
  }

  return (
    <div
      className={`${wrapperClassName} hover:bg-accent/50`}
      style={wrapperStyle}
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate" title={entity.filePath}>
        {file.name}
      </span>

      {/* Metadata badges */}
      {commonRight}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────

export function FileTree({
  entities,
  totalCount,
  truncated,
  hasMore,
  loadingMore,
  onLoadMore,
  selectedFolderPath,
  onFolderClick,
  onFileClick,
}: {
  entities: EntityResult[];
  totalCount: number;
  truncated: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  selectedFolderPath?: string | null;
  onFolderClick?: (path: string) => void;
  onFileClick?: (entity: EntityResult) => void;
}) {
  const tree = useMemo(() => buildTree(entities), [entities]);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => getTopLevelPaths(tree),
  );

  const togglePath = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const sorted = sortedEntries(tree);

  // ── Empty state ──────────────────────────────────────────────────────

  if (entities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
        <FileText className="size-8 mb-3 opacity-50" />
        <p>No entities found</p>
      </div>
    );
  }

  return (
    <div>
      {/* Truncated warning */}
      {truncated && (
        <div className="mb-3 flex flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-600 dark:text-amber-400 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              Loaded {entities.length} of {totalCount} entities.
              {hasMore ? " Load more to inspect the rest." : ""}
            </span>
          </div>
          {hasMore && onLoadMore ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="border-amber-500/40 bg-transparent text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
            >
              {loadingMore ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              Load more
            </Button>
          ) : null}
        </div>
      )}

      {/* Tree */}
      <div className="rounded-md border border-border p-1">
        {sorted.map((node) =>
          node.kind === "folder" ? (
            <FolderNode
              key={node.path}
              folder={node}
              depth={0}
              expandedPaths={expandedPaths}
              togglePath={togglePath}
              selectedFolderPath={selectedFolderPath}
              onFolderClick={onFolderClick}
              onFileClick={onFileClick}
            />
          ) : (
            <FileNode
              key={node.name}
              file={node}
              depth={0}
              onFileClick={onFileClick}
            />
          ),
        )}
      </div>
    </div>
  );
}
