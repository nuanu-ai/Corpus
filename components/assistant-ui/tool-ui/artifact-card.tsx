"use client";

// Inline artifact card rendered by tool UI for `create_consultant_artifact`,
// `create_consultant_export`, and any tool result carrying `action:
// "artifact_created"`. Ported from app/dashboard/_components/chat-panel.tsx
// (~line 636 / ~line 2287) but re-implemented as a standalone component so we
// do not import from dashboard/_components.

import { useState } from "react";
import { useLocale } from "next-intl";
import { Download, Eye, FileText, Loader2, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toaster";
import {
  downloadConsultantArtifact,
  isPreviewableConsultantArtifact,
  shareConsultantArtifactToCompany,
} from "@/lib/consultant/artifact-client";
import { getAppCopy } from "@/lib/i18n/copy";
import { cn } from "@/lib/utils";

import type { StoredChatArtifact } from "@/app/assistant/_lib/types";

import { ArtifactPreviewModal } from "./artifact-preview-modal";

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
  if (status === "pending" || status === "pending_approval" || status === "draft") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-border text-muted-foreground";
}

function formatTimestamp(value: string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export interface ArtifactCardProps {
  artifact: StoredChatArtifact;
  threadId: string | null;
  threadsApi: string;
  allowShare: boolean;
}

export function ArtifactCard({
  artifact,
  threadId,
  threadsApi,
  allowShare,
}: ArtifactCardProps) {
  const locale = useLocale();
  const artifactCopy = getAppCopy(locale).chat.v2.artifact;
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [sharedDocumentId, setSharedDocumentId] = useState<string | null>(
    typeof artifact.metadata?.sharedDocumentId === "string"
      ? (artifact.metadata.sharedDocumentId as string)
      : null,
  );

  const previewable = isPreviewableConsultantArtifact({
    filePath: artifact.filePath,
    mimeType: artifact.mimeType,
  });
  const canInteract = Boolean(threadId);

  const handleDownload = () => {
    if (!threadId) {
      showToast(artifactCopy.threadNotPersisted, {
        variant: "error",
      });
      return;
    }
    void downloadConsultantArtifact(
      threadId,
      artifact.id,
      artifact.title,
      { routeBase: threadsApi },
    ).catch((err) => {
      showToast(
        err instanceof Error ? err.message : artifactCopy.downloadFailed,
        { variant: "error" },
      );
    });
  };

  const handleShare = () => {
    if (!threadId) {
      showToast(artifactCopy.threadNotPersisted, {
        variant: "error",
      });
      return;
    }
    setIsSharing(true);
    shareConsultantArtifactToCompany(threadId, artifact.id, {
      routeBase: threadsApi,
    })
      .then((result) => {
        setSharedDocumentId(result.documentId);
        showToast(artifactCopy.shareSuccess, { variant: "success" });
      })
      .catch((err) => {
        showToast(
          err instanceof Error ? err.message : artifactCopy.shareFailed,
          { variant: "error" },
        );
      })
      .finally(() => {
        setIsSharing(false);
      });
  };

  return (
    <div className="my-2 min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-foreground">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium [overflow-wrap:anywhere] break-words">
              {artifact.title}
            </span>
            <span className="shrink-0 rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {artifact.kind}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                getStatusBadgeClass(artifact.status),
              )}
            >
              {formatArtifactStatus(artifact.status)}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-mono break-all text-primary/90">
              {artifact.filePath}
            </span>
            {artifact.mimeType ? (
              <span className="rounded border border-border/50 bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {artifact.mimeType}
              </span>
            ) : null}
            <span>{formatTimestamp(artifact.createdAt)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {previewable ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={!canInteract}
              onClick={() => setPreviewOpen(true)}
            >
              <Eye className="size-3.5" />
              {artifactCopy.preview}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            disabled={!canInteract}
            onClick={handleDownload}
          >
            <Download className="size-3.5" />
            {artifactCopy.download}
          </Button>
          {allowShare ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              disabled={!canInteract || isSharing || Boolean(sharedDocumentId)}
              onClick={handleShare}
            >
              {isSharing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Share2 className="size-3.5" />
              )}
              {sharedDocumentId ? artifactCopy.sharedToCompany : artifactCopy.shareToCompany}
            </Button>
          ) : null}
        </div>
      </div>

      {previewable ? (
        <ArtifactPreviewModal
          artifact={artifact}
          threadId={threadId}
          threadsApi={threadsApi}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      ) : null}
    </div>
  );
}

// Error variant, rendered when a create tool result contains `error`.
export function ArtifactErrorCard({ error }: { error: string }) {
  const locale = useLocale();
  const artifactCopy = getAppCopy(locale).chat.v2.artifact;
  return (
    <div className="my-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
      <div className="font-medium">{artifactCopy.artifactCreationFailed}</div>
      <div className="mt-1 break-words [overflow-wrap:anywhere]">{error}</div>
    </div>
  );
}
