"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, GitCommit, Loader2 } from "lucide-react";
import type { CommitLogEntry } from "@/lib/company-db/client";

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

function truncateMessage(message: string, max = 80): string {
  return message.length > max ? message.slice(0, max) + "..." : message;
}

// ── Component ────────────────────────────────────────────────────────────

export function CommitLog({
  commits,
  totalCount,
  onLoadMore,
  loadingMore,
}: {
  commits: CommitLogEntry[];
  totalCount: number;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasMore = commits.length < totalCount;

  // ── Empty state ──────────────────────────────────────────────────────

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
        <GitCommit className="size-8 mb-3 opacity-50" />
        <p>No commits found</p>
      </div>
    );
  }

  // ── Collapsible commit log ───────────────────────────────────────────

  return (
    <div>
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="size-4" />
        ) : (
          <ChevronRight className="size-4" />
        )}
        {totalCount} {totalCount === 1 ? "commit" : "commits"}
        <span className="text-xs font-normal">
          ({commits.length} loaded)
        </span>
      </button>

      {/* Collapsible content */}
      {expanded && (
        <div className="mt-2">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    SHA
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Message
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Author
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                    Files
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {commits.map((commit) => (
                  <tr
                    key={commit.sha}
                    className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs text-muted-foreground">
                        {commit.sha.slice(0, 7)}
                      </code>
                    </td>
                    <td className="px-3 py-2 max-w-[400px]">
                      <span title={commit.message}>
                        {truncateMessage(commit.message)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {commit.author}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {commit.filesChanged}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">
                      <time
                        dateTime={commit.date}
                        title={new Date(commit.date).toLocaleString()}
                      >
                        {relativeTime(commit.date)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Show more button */}
          {hasMore && onLoadMore && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={onLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>Show more ({totalCount - commits.length} remaining)</>
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
