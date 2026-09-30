"use client";

// Inline approval card rendered by tool UI for `request_consultant_approval`,
// or any tool result carrying `action: "approval_requested"`. Ported from
// app/dashboard/_components/chat-panel.tsx (~601-603 for formatApprovalAction,
// ~2436-2515 for the approval list row). Re-implemented here as a standalone
// component so we do not import from dashboard/_components.

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { Check, Clock3, Loader2, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toaster";
import { getAppCopy } from "@/lib/i18n/copy";
import { cn } from "@/lib/utils";

import { useResolveApproval } from "@/app/assistant/_lib/approval-hook";
import type { StoredChatApproval } from "@/app/assistant/_lib/types";

// Humanize helper — ported verbatim from app/dashboard/_components/chat-panel.tsx:601.
function formatApprovalAction(action: string): string {
  return action.replace(/_/g, " ");
}

function formatApprovalStatus(status: string): string {
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

function isTerminalStatus(status: string): boolean {
  return (
    status === "approved" ||
    status === "rejected" ||
    status === "committed"
  );
}

export interface ApprovalCardProps {
  approval: StoredChatApproval;
  threadId: string | null;
  threadsApi: string;
}

export function ApprovalCard({ approval, threadId, threadsApi }: ApprovalCardProps) {
  const locale = useLocale();
  const approvalCopy = getAppCopy(locale).chat.v2.approval;
  // Keep a local copy so the card can optimistically lock into terminal state
  // without waiting for the parent runtime to re-render.
  const [current, setCurrent] = useState<StoredChatApproval>(approval);
  const { resolve, isResolving } = useResolveApproval(threadId, threadsApi);

  // If the server-echoed approval changes (e.g., history refresh), adopt it.
  useEffect(() => {
    setCurrent(approval);
  }, [approval]);

  const resolving = isResolving(current.id);
  const terminal = isTerminalStatus(current.status);

  const handleResolve = (status: "approved" | "rejected") => {
    if (resolving || terminal) return;
    resolve(current.id, status)
      .then((next) => {
        setCurrent(next);
        showToast(
          status === "approved" ? approvalCopy.approvalConfirmed : approvalCopy.approvalRejected,
          { variant: status === "approved" ? "success" : "error" },
        );
      })
      .catch((err) => {
        showToast(
          err instanceof Error ? err.message : approvalCopy.approvalUpdateFailed,
          { variant: "error" },
        );
      });
  };

  const canInteract = Boolean(threadId);
  const statusLabel =
    current.status === "approved"
      ? approvalCopy.approved
      : current.status === "committed"
        ? approvalCopy.committed
        : current.status === "rejected"
          ? approvalCopy.rejected
          : formatApprovalStatus(current.status);

  return (
    <div className="my-2 min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-foreground">
      <div className="flex flex-col gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
            {terminal ? (
              <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Clock3 className="size-3.5 shrink-0 text-amber-500" />
            )}
            <span className="min-w-0 truncate font-medium [overflow-wrap:anywhere] break-words">
              {approvalCopy.title}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                getStatusBadgeClass(current.status),
              )}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-1.5 text-muted-foreground">
            {formatApprovalAction(current.action)}
          </p>
          {current.artifactId ? (
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
              {approvalCopy.artifactLabel} {current.artifactId}
            </p>
          ) : null}
        </div>

        {!terminal ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 whitespace-normal"
              disabled={resolving || !canInteract}
              onClick={() => handleResolve("approved")}
            >
              {resolving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {approvalCopy.approve}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 whitespace-normal"
              disabled={resolving || !canInteract}
              onClick={() => handleResolve("rejected")}
            >
              <X className="size-3.5" />
              {approvalCopy.reject}
            </Button>
            {!canInteract ? (
              <span className="text-[11px] text-muted-foreground">
                {approvalCopy.threadNotPersisted}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            {current.status === "rejected"
              ? approvalCopy.rejected
              : current.status === "committed"
                ? `${approvalCopy.approved} \u2713 (${approvalCopy.committed.toLowerCase()})`
                : `${approvalCopy.approved} \u2713`}
          </div>
        )}
      </div>
    </div>
  );
}

export function ApprovalErrorCard({ error }: { error: string }) {
  const locale = useLocale();
  const approvalCopy = getAppCopy(locale).chat.v2.approval;
  return (
    <div className="my-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
      <div className="font-medium">{approvalCopy.approvalRequestFailed}</div>
      <div className="mt-1 break-words [overflow-wrap:anywhere]">{error}</div>
    </div>
  );
}
