"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  downloadConsultantArtifact,
  getConsultantArtifactApiUrl,
  isPreviewableConsultantArtifact,
  shareConsultantArtifactToCompany,
} from "@/lib/consultant/artifact-client";

interface AgentFileRow {
  id: string;
  threadId: string;
  threadTitle: string;
  kind: string;
  title: string;
  filePath: string;
  mimeType: string | null;
  status: string;
  uiMessageId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface PreviewState {
  isLoading: boolean;
  content?: string;
  error?: string;
}

function formatArtifactStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function getStatusBadgeClass(status: string): string {
  if (status === "approved" || status === "committed") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "rejected") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  if (status === "pending" || status === "pending_approval") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-border text-muted-foreground";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isSpreadsheet(file: AgentFileRow): boolean {
  return (
    file.kind === "spreadsheet_export" ||
    file.filePath.toLowerCase().endsWith(".xlsx") ||
    file.filePath.toLowerCase().endsWith(".csv") ||
    file.filePath.toLowerCase().endsWith(".tsv")
  );
}

export function AgentFilesView() {
  const [files, setFiles] = useState<AgentFileRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [previews, setPreviews] = useState<Record<string, PreviewState>>({});

  const loadFiles = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/chat/artifacts", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Failed to load agent files (${response.status})`);
      }
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) {
        throw new Error("Invalid agent file payload");
      }
      setFiles(payload as AgentFileRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent files");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return files;
    }
    return files.filter((file) =>
      [
        file.title,
        file.kind,
        file.filePath,
        file.threadTitle,
        file.status,
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [files, query]);

  const handleTogglePreview = useCallback(async (file: AgentFileRow) => {
    if (!isPreviewableConsultantArtifact(file)) {
      return;
    }

    const current = previews[file.id];
    if (current?.content || current?.error) {
      setPreviews((prev) => {
        const next = { ...prev };
        delete next[file.id];
        return next;
      });
      return;
    }

    setPreviews((prev) => ({
      ...prev,
      [file.id]: { isLoading: true },
    }));

    try {
      const response = await fetch(
        getConsultantArtifactApiUrl(file.threadId, file.id),
        {
          method: "GET",
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to open file (${response.status})`);
      }

      const payload = (await response.json()) as { content?: unknown };
      setPreviews((prev) => ({
        ...prev,
        [file.id]: {
          isLoading: false,
          content:
            typeof payload.content === "string" && payload.content.length > 0
              ? payload.content
              : "File is empty.",
        },
      }));
    } catch (err) {
      setPreviews((prev) => ({
        ...prev,
        [file.id]: {
          isLoading: false,
          error: err instanceof Error ? err.message : "Failed to open file.",
        },
      }));
    }
  }, [previews]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-sm text-muted-foreground font-medium">
              My AI Files
            </CardTitle>
            <p className="mt-1 text-sm text-foreground">
              Personal drafts, exports, and approved files created by the consultant across all your company chat threads.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => {
              void loadFiles();
            }}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agent files by title, thread, path, or status"
            className="pl-9"
          />
        </div>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {!isLoading && filteredFiles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">No agent files yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Generated reports, memos, and exports will appear here.
            </p>
          </div>
        ) : null}

        <div className="space-y-3">
          {filteredFiles.map((file) => {
            const previewState = previews[file.id];
            const previewable = isPreviewableConsultantArtifact(file);
            const isOpen = Boolean(previewState?.content || previewState?.error);
            const sharedDocumentId =
              typeof file.metadata?.sharedDocumentId === "string"
                ? file.metadata.sharedDocumentId
                : null;

            return (
              <div
                key={file.id}
                className="rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="flex flex-col gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      {isSpreadsheet(file) ? (
                        <FileSpreadsheet className="size-4 text-emerald-500" />
                      ) : (
                        <FileText className="size-4 text-muted-foreground" />
                      )}
                      <span className="font-medium break-words [overflow-wrap:anywhere]">
                        {file.title}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground break-all">
                      {file.kind} · {file.filePath}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge variant="outline">{file.threadTitle}</Badge>
                      <span>{formatDate(file.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {previewable ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 whitespace-normal"
                        onClick={() => {
                          void handleTogglePreview(file);
                        }}
                      >
                        {previewState?.isLoading ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Eye className="size-3.5" />
                        )}
                        {isOpen ? "Hide" : "Open"}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 whitespace-normal"
                      onClick={() => {
                        void downloadConsultantArtifact(
                          file.threadId,
                          file.id,
                          file.title,
                        ).catch((err) => {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Failed to download agent file.",
                          );
                        });
                      }}
                    >
                      <Download className="size-3.5" />
                      Download
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 whitespace-normal"
                      disabled={Boolean(sharedDocumentId)}
                      onClick={() => {
                        void shareConsultantArtifactToCompany(
                          file.threadId,
                          file.id,
                        )
                          .then((result) => {
                            setFiles((current) =>
                              current.map((entry) =>
                                entry.id === file.id
                                  ? {
                                      ...entry,
                                      metadata: {
                                        ...entry.metadata,
                                        sharedDocumentId: result.documentId,
                                      },
                                    }
                                  : entry,
                              ),
                            );
                          })
                          .catch((err) => {
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Failed to share agent file to company documents.",
                            );
                          });
                      }}
                    >
                      <FileText className="size-3.5" />
                      {sharedDocumentId ? "Shared to Company" : "Share to Company"}
                    </Button>
                    <div
                      className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusBadgeClass(file.status)}`}
                    >
                      {formatArtifactStatus(file.status)}
                    </div>
                  </div>
                </div>

                {previewState ? (
                  <div className="mt-3">
                    {previewState.error ? (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                        {previewState.error}
                      </div>
                    ) : previewState.content ? (
                      <pre className="max-h-96 overflow-auto rounded-lg bg-background/80 p-3 font-mono text-[11px] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                        {previewState.content}
                      </pre>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
