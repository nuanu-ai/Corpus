"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Clock3, Download, Eye, FileText, Loader2, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface PersonalDocumentRow {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  source: string;
  status: string;
  documentType: string | null;
  createdAt: string;
  error: string | null;
  reviewRequired: boolean;
  reviewFlags: string[];
  overallConfidence: string | null;
  clarificationPendingCount: number;
  sourceFile: {
    document: {
      id: string;
      fileName: string;
      fileType: string;
      status: string;
      contentType: string;
    };
    viewPath: string;
    viewUrl: string | null;
    downloadPath: string;
    downloadUrl: string | null;
    requiresAuthorization: true;
  } | null;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-0">Completed</Badge>;
    case "processing":
      return <Badge className="bg-amber-500/15 text-amber-300 border-0">Processing</Badge>;
    case "failed":
      return <Badge className="bg-red-500/15 text-red-400 border-0">Failed</Badge>;
    case "needs_review":
      return <Badge className="bg-yellow-500/15 text-yellow-300 border-0">Needs review</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

export function PersonalDocumentsView() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [documents, setDocuments] = useState<PersonalDocumentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDocuments = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/personal/documents?limit=100", {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Failed to load personal documents (${res.status})`);
      }
      const payload = await res.json();
      setDocuments(Array.isArray(payload) ? payload : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load personal documents");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  const processingCount = useMemo(
    () => documents.filter((document) => document.status === "processing").length,
    [documents],
  );

  useEffect(() => {
    if (processingCount === 0) return;

    const intervalId = window.setInterval(() => {
      void refreshDocuments();
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [processingCount, refreshDocuments]);

  const handleUpload = useCallback(async () => {
    const files = inputRef.current?.files;
    if (!files || files.length === 0) {
      setError("Choose at least one file");
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/personal/documents/upload", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : `Failed to upload ${file.name}`,
          );
        }
      }
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      await refreshDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }, [refreshDocuments]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Documents</CardTitle>
            <CardDescription>Personal document rows in the tenant database</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{documents.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Processing</CardTitle>
            <CardDescription>Documents still running through ingestion</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{processingCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Needs review</CardTitle>
            <CardDescription>Rows that surfaced review flags</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {documents.filter((document) => document.reviewRequired).length}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload personal documents</CardTitle>
          <CardDescription>
            Files uploaded here stay in your personal project. Company document routes remain separate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input ref={inputRef} type="file" multiple />
          <div className="flex items-center gap-3">
            <Button onClick={handleUpload} disabled={isUploading}>
              {isUploading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
              Upload
            </Button>
            {error ? (
              <div className="inline-flex items-center gap-2 text-sm text-red-400">
                <AlertCircle className="size-4" />
                {error}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent personal documents</CardTitle>
          <CardDescription>
            Original files can be opened or downloaded from the personal route surface.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading personal documents
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-8 text-sm text-muted-foreground">
              No personal documents yet.
            </div>
          ) : (
            <div className="space-y-3">
              {documents.map((document) => (
                <div
                  key={document.id}
                  className="rounded-xl border border-border/70 bg-card/60 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-muted-foreground" />
                        <div className="font-medium">{document.fileName}</div>
                        {statusBadge(document.status)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatDate(document.createdAt)} · {document.fileType} · {document.source}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {document.reviewRequired ? (
                          <Badge variant="outline">
                            review flags: {document.reviewFlags.length}
                          </Badge>
                        ) : null}
                        {document.clarificationPendingCount > 0 ? (
                          <Badge variant="outline">
                            clarification: {document.clarificationPendingCount}
                          </Badge>
                        ) : null}
                        {document.status === "processing" ? (
                          <Badge variant="outline">
                            <Clock3 className="mr-1 size-3" />
                            auto-refreshing
                          </Badge>
                        ) : null}
                      </div>
                      {document.error ? (
                        <div className="text-sm text-red-400">{document.error}</div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {document.sourceFile ? (
                        <>
                          <Button asChild variant="outline" size="sm">
                            <a href={document.sourceFile.viewPath} target="_blank" rel="noreferrer">
                              <Eye className="mr-2 size-4" />
                              Open
                            </a>
                          </Button>
                          <Button asChild variant="outline" size="sm">
                            <a href={document.sourceFile.downloadPath} download={document.fileName}>
                              <Download className="mr-2 size-4" />
                              Download
                            </a>
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
