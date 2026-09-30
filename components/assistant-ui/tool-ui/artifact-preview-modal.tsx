"use client";

// Lightweight preview modal used by the inline artifact card.
// We depend on @radix-ui/react-dialog directly because shadcn's Dialog wrapper
// is not present in this repo's components/ui tree.

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";

import { getConsultantArtifactApiUrl } from "@/lib/consultant/artifact-client";
import { getAppCopy } from "@/lib/i18n/copy";
import { cn } from "@/lib/utils";

import type { StoredChatArtifact } from "@/app/assistant/_lib/types";

// Ported from app/dashboard/_components/chat-panel.tsx (see line 553) — keep
// parity with the legacy cap so server-side trimming assumptions still hold.
export const MAX_TOOL_FILE_PREVIEW_CHARS = 4000;

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n...`;
}

interface ArtifactPreviewModalProps {
  artifact: StoredChatArtifact;
  threadId: string | null;
  threadsApi: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PreviewState {
  content?: string;
  error?: string;
  isLoading: boolean;
}

export function ArtifactPreviewModal({
  artifact,
  threadId,
  threadsApi,
  open,
  onOpenChange,
}: ArtifactPreviewModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <ArtifactPreviewModalPortal
        artifact={artifact}
        threadId={threadId}
        threadsApi={threadsApi}
        // Remount the body each time the dialog opens so we never have to
        // transition state inside an effect — initial state already reflects
        // the "loading" intent.
        key={open ? `${threadId ?? "no-thread"}:${artifact.id}:open` : "closed"}
        open={open}
      />
    </Dialog.Root>
  );
}

function ArtifactPreviewModalPortal({
  artifact,
  threadId,
  threadsApi,
  open,
}: {
  artifact: StoredChatArtifact;
  threadId: string | null;
  threadsApi: string;
  open: boolean;
}) {
  const locale = useLocale();
  const artifactCopy = getAppCopy(locale).chat.v2.artifact;
  const [state, setState] = useState<PreviewState>(() => ({
    isLoading: open && Boolean(threadId),
  }));

  useEffect(() => {
    if (!open) return;
    if (!threadId) return;

    let cancelled = false;

    const url = getConsultantArtifactApiUrl(threadId, artifact.id, {
      routeBase: threadsApi,
    });

    fetch(url, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          content?: string;
          previewable?: boolean;
          error?: string;
        };
        if (cancelled) return;

        if (!response.ok) {
          setState({
            isLoading: false,
            error:
              payload.error ??
              artifactCopy.previewErrorStatus.replace(
                "{status}",
                String(response.status),
              ),
          });
          return;
        }

        if (payload.previewable === false) {
          setState({
            isLoading: false,
            error: artifactCopy.previewNotPreviewable,
          });
          return;
        }

        setState({
          isLoading: false,
          content:
            typeof payload.content === "string"
              ? truncateText(payload.content, MAX_TOOL_FILE_PREVIEW_CHARS)
              : "",
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          isLoading: false,
          error: err instanceof Error ? err.message : artifactCopy.previewError,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open, threadId, artifact.id, threadsApi, artifactCopy]);

  return (
    <>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(90vw,720px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-hidden rounded-2xl border border-border bg-background p-5 shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-base font-semibold">
                {artifact.title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                {artifact.filePath}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={artifactCopy.previewClose}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-[160px] flex-1 overflow-auto rounded-lg border border-border/60 bg-muted/20 p-3">
            {!threadId ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {artifactCopy.threadNotPersisted}
              </div>
            ) : state.isLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>{artifactCopy.previewLoading}</span>
              </div>
            ) : state.error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {state.error}
              </div>
            ) : state.content !== undefined && state.content.length > 0 ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground [overflow-wrap:anywhere]">
                {state.content}
              </pre>
            ) : (
              <div className="text-xs text-muted-foreground">{artifactCopy.previewEmpty}</div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </>
  );
}
