"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, Loader2 } from "lucide-react";

type CodexStatusPayload = {
  generatedAt: string;
  auth: {
    mode: string;
    ready: boolean;
    degraded: boolean;
    reason: string | null;
    lastReadyAt: string | null;
    lastFailureAt: string | null;
    effectiveWorkers: number;
    requestedWorkers: number;
    configuredSlots: number;
    readySlots: number;
    slots: Array<{
      slotId: string;
      slotIndex: number;
      codeHome: string | null;
      ready: boolean;
      reason: string | null;
      lastReadyAt: string | null;
      lastFailureAt: string | null;
    }>;
  };
  queue: {
    companyQueued: number;
    companyRunning: number;
    companyOldestQueuedAt: string | null;
    globalQueued: number;
    globalRunning: number;
    globalOldestQueuedAt: string | null;
  };
  routing: {
    pool: string;
    fallbackToApiKeyPool: boolean;
  };
};

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getTone(payload: CodexStatusPayload | null, error: string | null) {
  if (error) {
    return {
      border: "border-yellow-500/20",
      bg: "bg-yellow-500/10",
      text: "text-yellow-200",
      subtle: "text-yellow-100/80",
      icon: AlertCircle,
      title: "Codex worker status unavailable",
    };
  }

  if (!payload) {
    return {
      border: "border-border/70",
      bg: "bg-muted/30",
      text: "text-foreground",
      subtle: "text-muted-foreground",
      icon: Loader2,
      title: "Checking Codex worker",
    };
  }

  if (!payload.auth.ready) {
    return {
      border: "border-red-500/20",
      bg: "bg-red-500/10",
      text: "text-red-200",
      subtle: "text-red-100/80",
      icon: AlertCircle,
      title: "Codex auth needs repair",
    };
  }

  if (payload.queue.companyQueued > 0 || payload.queue.globalQueued > 0) {
    return {
      border: "border-blue-500/20",
      bg: "bg-blue-500/10",
      text: "text-blue-100",
      subtle: "text-blue-100/80",
      icon: Clock3,
      title: "Codex worker ready",
    };
  }

  return {
    border: "border-emerald-500/20",
    bg: "bg-emerald-500/10",
    text: "text-emerald-100",
    subtle: "text-emerald-100/80",
    icon: CheckCircle2,
    title: "Codex worker ready",
  };
}

export function CodexAuthStatusNotice() {
  const [payload, setPayload] = useState<CodexStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/codex/status", {
          cache: "no-store",
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Status check failed" }));
          throw new Error(body.error ?? "Status check failed");
        }
        const nextPayload = (await response.json()) as CodexStatusPayload;
        if (cancelled) return;
        setPayload(nextPayload);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Status check failed");
      }
    }

    void load();
    const intervalId = window.setInterval(() => {
      void load();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const tone = getTone(payload, error);
  const Icon = tone.icon;
  const lastReady = formatDateTime(payload?.auth.lastReadyAt ?? null);
  const lastFailure = formatDateTime(payload?.auth.lastFailureAt ?? null);

  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone.border} ${tone.bg}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-4 shrink-0 ${payload ? "" : "animate-spin"} ${tone.text}`} />
        <div className="min-w-0 space-y-1">
          <div className={`text-sm font-medium ${tone.text}`}>{tone.title}</div>
          {error ? (
            <p className={`text-xs leading-5 ${tone.subtle}`}>
              {error}. Documents keep their assigned worker pool; this banner could not confirm live status.
            </p>
          ) : payload ? (
            <>
              <p className={`text-xs leading-5 ${tone.subtle}`}>
                {payload.auth.ready
                  ? `ChatGPT worker slots are available. ${payload.auth.readySlots}/${payload.auth.configuredSlots} slots are ready. This company has ${payload.queue.companyQueued} queued and ${payload.queue.companyRunning} running Codex documents. Global queue is ${payload.queue.globalQueued} queued and ${payload.queue.globalRunning} running.`
                  : `Shared ${payload.auth.mode} worker is not ready. Documents stay queued in the ${payload.routing.pool} pool until auth is repaired. Automatic fallback to the API-key pool is disabled.`}
              </p>
              <p className={`text-[11px] ${tone.subtle}`}>
                workers {payload.auth.effectiveWorkers}/{payload.auth.requestedWorkers}
                {" · "}
                slots {payload.auth.readySlots}/{payload.auth.configuredSlots}
                {" · "}
                last ready {lastReady ?? "never"}
                {" · "}
                last failure {lastFailure ?? "none"}
              </p>
              {payload.auth.degraded ? (
                <p className={`text-[11px] ${tone.subtle}`}>
                  Waiting on{" "}
                  {payload.auth.slots
                    .filter((slot) => !slot.ready)
                    .map((slot) => slot.slotId)
                    .join(", ")}
                  .
                </p>
              ) : null}
              {!payload.auth.ready && payload.auth.reason ? (
                <p className={`text-[11px] ${tone.subtle}`}>{payload.auth.reason}</p>
              ) : null}
            </>
          ) : (
            <p className={`text-xs leading-5 ${tone.subtle}`}>
              Checking shared worker readiness and queue backlog...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
