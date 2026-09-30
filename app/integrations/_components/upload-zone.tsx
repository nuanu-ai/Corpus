"use client";

import { useRef, useState, useCallback } from "react";
import { useLocale } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Mail, Loader2, CheckCircle2, XCircle } from "lucide-react";

import { getAppCopy } from "@/lib/i18n/copy";

const ACCEPTED_FORMATS = "PDF, CSV, Excel, OFX, QIF, images, TXT, Markdown/QMD, HTML, DOCX";
const ACCEPTED_EXTENSIONS = ".pdf,.csv,.xlsx,.xls,.ofx,.qif,image/*,.txt,.md,.qmd,.html,.htm,.docx";
const FORWARDING_EMAIL = "Forward documents to your ingest address (see Settings)";

type UploadResult = {
  name: string;
  status: "success" | "error";
  error?: string;
};

export function UploadZone({
  onUploaded,
}: {
  onUploaded?: (results: UploadResult[]) => void;
}) {
  const locale = useLocale();
  const sectionsCopy = getAppCopy(locale).integrations.page.sections;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadResult[]>([]);

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadResults([]);
    const results: UploadResult[] = [];

    const fileList = Array.from(files);

    if (fileList.length === 1) {
      const [file] = fileList;

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Upload failed" }));
          results.push({ name: file.name, status: "error", error: body.error });
        } else {
          results.push({ name: file.name, status: "success" });
        }
      } catch {
        results.push({ name: file.name, status: "error", error: "Network error" });
      }
    } else {
      try {
        const formData = new FormData();
        for (const file of fileList) {
          formData.append("files", file);
        }

        const res = await fetch("/api/documents/batch-upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Upload failed" }));
          const error =
            typeof body.error === "string" && body.error.trim().length > 0
              ? body.error
              : "Upload failed";
          for (const file of fileList) {
            results.push({ name: file.name, status: "error", error });
          }
        } else {
          const body = await res.json().catch(() => ({ results: [] as Array<{ fileName: string; error?: string }> }));
          for (const file of fileList) {
            const fileResult = Array.isArray(body.results)
              ? body.results.find(
                  (entry: { fileName?: string; error?: string }) =>
                    entry?.fileName === file.name,
                )
              : null;
            results.push({
              name: file.name,
              status: fileResult?.error ? "error" : "success",
              error: fileResult?.error,
            });
          }
        }
      } catch {
        for (const file of fileList) {
          results.push({ name: file.name, status: "error", error: "Network error" });
        }
      }
    }

    setUploadResults(results);
    setUploading(false);
    onUploaded?.(results);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [onUploaded]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleUpload(e.dataTransfer.files);
    },
    [handleUpload],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="size-4" />
          {sectionsCopy.uploadTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`relative rounded-xl border-2 border-dashed p-10 text-center transition-all ${
            dragOver
              ? "border-primary/60 bg-primary/5"
              : "border-border/70 hover:border-muted-foreground/50 hover:bg-muted/20"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="size-12 rounded-full bg-gradient-to-br from-muted/80 to-muted ring-1 ring-inset ring-border/60 flex items-center justify-center">
              {uploading ? (
                <Loader2 className="size-6 text-muted-foreground animate-spin" />
              ) : (
                <FileText className="size-6 text-muted-foreground" />
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {uploading ? sectionsCopy.uploadProgress : sectionsCopy.uploadDragHint}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {sectionsCopy.uploadAcceptedHint.replace("{formats}", ACCEPTED_FORMATS)}
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={ACCEPTED_EXTENSIONS}
              multiple
              onChange={(e) => handleUpload(e.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? sectionsCopy.uploadProgress : sectionsCopy.uploadBrowse}
            </Button>
          </div>
        </div>

        {uploadResults.length > 0 && (
          <div className="space-y-2">
            {uploadResults.map((result, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 text-sm p-2 rounded-md ${
                  result.status === "success"
                    ? "bg-green-500/10 text-green-700 dark:text-green-400"
                    : "bg-red-500/10 text-red-700 dark:text-red-400"
                }`}
              >
                {result.status === "success" ? (
                  <CheckCircle2 className="size-4 shrink-0" />
                ) : (
                  <XCircle className="size-4 shrink-0" />
                )}
                <span className="truncate">{result.name}</span>
                {result.error && (
                  <span className="text-xs ml-auto shrink-0">{result.error}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
          <Mail className="size-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {sectionsCopy.uploadEmail}
            </p>
            <p className="text-sm font-mono text-foreground mt-0.5 break-all">
              {FORWARDING_EMAIL}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
