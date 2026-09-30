"use client";

import { useCallback, useRef, useState } from "react";
import { Bot, CheckCircle2, FileUp, Loader2, XCircle } from "lucide-react";

import { CodexAuthStatusNotice } from "@/components/codex-auth-status-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ACCEPTED_FORMATS = "PDF, Excel, CSV, DOCX, TXT, Markdown/QMD, HTML, OFX, QIF, images";
const ACCEPTED_EXTENSIONS = ".pdf,.csv,.xlsx,.xls,.ofx,.qif,image/*,.txt,.md,.qmd,.html,.htm,.docx";

type UploadResult = {
  name: string;
  status: "success" | "error";
  error?: string;
};

export function CodexUploadZone() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setResults([]);

    const nextResults: UploadResult[] = [];
    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/codex/documents/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Upload failed" }));
          nextResults.push({
            name: file.name,
            status: "error",
            error: body.error,
          });
        } else {
          nextResults.push({ name: file.name, status: "success" });
        }
      } catch {
        nextResults.push({
          name: file.name,
          status: "error",
          error: "Network error",
        });
      }
    }

    setResults(nextResults);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-4" />
          Upload to Codex worker
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <CodexAuthStatusNotice />
        <div
          className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-muted-foreground/50"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleUpload(e.dataTransfer.files);
          }}
        >
          <div className="mx-auto flex max-w-xs flex-col items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-full bg-muted">
              {uploading ? (
                <Loader2 className="size-7 animate-spin text-muted-foreground" />
              ) : (
                <FileUp className="size-7 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {uploading ? "Queueing files..." : "Drop files for Codex analysis"}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                The file goes into a separate worker flow. Codex inspects the real
                document and creates markdown per sheet or page.
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={ACCEPTED_EXTENSIONS}
              multiple
              onChange={(e) => void handleUpload(e.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading..." : "Select files"}
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 text-xs leading-5 text-muted-foreground">
          Accepts {ACCEPTED_FORMATS}. This path is intentionally separate from the
          standard document ingestion pipeline.
        </div>

        {results.length > 0 && (
          <div className="space-y-2">
            {results.map((result) => (
              <div
                key={`${result.name}-${result.status}`}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                  result.status === "success"
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-red-500/10 text-red-600 dark:text-red-400"
                }`}
              >
                {result.status === "success" ? (
                  <CheckCircle2 className="size-4 shrink-0" />
                ) : (
                  <XCircle className="size-4 shrink-0" />
                )}
                <span className="truncate">{result.name}</span>
                {result.error ? (
                  <span className="ml-auto text-xs">{result.error}</span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
