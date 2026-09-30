"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileDown,
  FileText,
  Loader2,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CodexStatus {
  stage: string;
  attempts: number;
  updatedAt: string | null;
  completedAt: string | null;
  error: string | null;
  model: string | null;
  artifactManifestPath: string | null;
  artifactCount: number | null;
  unitCount: number | null;
  importRootPath: string | null;
  indexFilePath: string | null;
}

interface CodexPromotionStatus {
  stage: string;
  updatedAt: string | null;
  completedAt: string | null;
  error: string | null;
  reportStagingCount: number;
  canonicalFinanceStagingCount: number;
  transactionStagingCount: number;
  nonFinancialStagingCount: number;
  promotedDomains: string[];
}

interface CodexDocumentRow {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  source: string;
  status: string;
  error: string | null;
  confidenceScore: string | null;
  documentType: string | null;
  createdAt: string;
  codex: CodexStatus | null;
  promotion: CodexPromotionStatus | null;
}

function useCodexDocuments() {
  const [data, setData] = useState<CodexDocumentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/codex/documents?limit=50")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch Codex documents (${response.status})`);
        }
        return response.json();
      })
      .then((rows) => {
        if (cancelled) return;
        setData((rows as CodexDocumentRow[]) ?? []);
        setError(null);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setData([]);
        setError(err.message);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchKey]);

  return {
    data,
    isLoading,
    error,
    refetch: () => {
      setIsLoading(true);
      setFetchKey((value) => value + 1);
    },
  };
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stageBadge(stage: string | null | undefined, status: string) {
  const value = stage ?? (status === "completed" ? "completed" : "queued");

  switch (value) {
    case "queued":
      return <Badge variant="secondary">Queued</Badge>;
    case "artifactizing":
      return <Badge className="border-0 bg-blue-500/15 text-blue-400">Artifactizing</Badge>;
    case "running":
      return <Badge className="border-0 bg-amber-500/15 text-amber-400">Codex running</Badge>;
    case "persisting":
      return <Badge className="border-0 bg-violet-500/15 text-violet-400">Persisting</Badge>;
    case "completed":
      return <Badge className="border-0 bg-emerald-500/15 text-emerald-400">Completed</Badge>;
    case "failed":
      return <Badge className="border-0 bg-red-500/15 text-red-400">Failed</Badge>;
    default:
      return <Badge variant="secondary">{value}</Badge>;
  }
}

function promotionBadge(promotion: CodexPromotionStatus | null) {
  if (!promotion) return <Badge variant="secondary">Not promoted</Badge>;

  switch (promotion.stage) {
    case "running":
      return <Badge className="border-0 bg-blue-500/15 text-blue-400">Promoting</Badge>;
    case "completed":
      return <Badge className="border-0 bg-emerald-500/15 text-emerald-400">Promoted</Badge>;
    case "failed":
      return <Badge className="border-0 bg-red-500/15 text-red-400">Promotion failed</Badge>;
    default:
      return <Badge variant="secondary">{promotion.stage}</Badge>;
  }
}

function PreviewPanel({ documentId }: { documentId: string }) {
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/codex/documents/${documentId}/index`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Preview failed" }));
          throw new Error(body.error ?? "Preview failed");
        }
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading Codex summary...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-400">
        {error}
      </div>
    );
  }

  if (!content) return null;

  return (
    <pre className="max-h-80 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-4 text-xs leading-5 text-foreground whitespace-pre-wrap">
      {content}
    </pre>
  );
}

function CodexDocumentCard({ doc }: { doc: CodexDocumentRow }) {
  const [expanded, setExpanded] = useState(false);
  const showPreview = expanded && doc.status === "completed" && !!doc.codex?.indexFilePath;

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-10 items-center justify-center rounded-2xl bg-muted">
              <Bot className="size-5 text-muted-foreground" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">
                  {doc.fileName}
                </p>
                {stageBadge(doc.codex?.stage, doc.status)}
                {promotionBadge(doc.promotion)}
              </div>
              <p className="text-xs text-muted-foreground">
                {doc.fileType.toUpperCase()} · {formatFileSize(doc.fileSizeBytes)} · queued {formatDate(doc.createdAt)}
              </p>
            </div>
          </div>

            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div>Attempts: <span className="text-foreground">{doc.codex?.attempts ?? 0}</span></div>
              <div>Units: <span className="text-foreground">{doc.codex?.unitCount ?? "-"}</span></div>
              <div>Artifacts: <span className="text-foreground">{doc.codex?.artifactCount ?? "-"}</span></div>
              <div>Model: <span className="text-foreground">{doc.codex?.model ?? "-"}</span></div>
              <div>Promoted domains: <span className="text-foreground">{doc.promotion?.promotedDomains.join(", ") || "-"}</span></div>
              <div>Promotion writes: <span className="text-foreground">{(doc.promotion?.reportStagingCount ?? 0) + (doc.promotion?.canonicalFinanceStagingCount ?? 0) + (doc.promotion?.transactionStagingCount ?? 0) + (doc.promotion?.nonFinancialStagingCount ?? 0)}</span></div>
            </div>

          {doc.codex?.importRootPath ? (
            <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Import root: <span className="font-mono text-foreground">{doc.codex.importRootPath}</span>
            </div>
          ) : null}

          {doc.error || doc.codex?.error || doc.promotion?.error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-400">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>{doc.error ?? doc.codex?.error ?? doc.promotion?.error}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/documents/${doc.id}/download`}>
              <FileDown className="size-4" />
              Source file
            </a>
          </Button>
          {doc.status === "completed" && doc.codex?.indexFilePath ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExpanded((value) => !value)}
            >
              <FileText className="size-4" />
              {expanded ? "Hide summary" : "Preview summary"}
              {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
          ) : null}
        </div>
      </div>

      {showPreview ? (
        <div className="mt-4">
          <PreviewPanel documentId={doc.id} />
        </div>
      ) : null}
    </div>
  );
}

export function CodexDocumentsView() {
  const { data: documents, isLoading, error, refetch } = useCodexDocuments();
  const processingCount = documents.filter((doc) => doc.status === "processing").length;

  return (
    <Card>
      <CardHeader className="border-b border-border/60">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">Codex import queue</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Separate worker-driven pipeline with markdown bundle output.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-4" />
            {processingCount} active
            <Button variant="outline" size="sm" onClick={refetch}>
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        {isLoading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading Codex documents...
          </div>
        ) : null}

        {!isLoading && error ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-4 text-sm text-red-400">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && documents.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
            No Codex imports yet. Upload a file on the left to test the new worker path.
          </div>
        ) : null}

        {!isLoading && !error && documents.length > 0 ? (
          <div className="space-y-4">
            {documents.map((doc) => (
              <CodexDocumentCard key={doc.id} doc={doc} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
