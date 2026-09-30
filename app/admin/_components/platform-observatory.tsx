"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  Building2,
  Database,
  RefreshCw,
  Users,
  Wrench,
  Workflow,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface AdminOverviewResponse {
  generatedAt: string;
  actor: {
    email: string;
    name: string;
  };
  summary: {
    users: number;
    companies: number;
    memberships: number;
    runtimeDiagnostics: {
      platformAdminEnvConfiguredCount: number;
      platformAdminFallbackActive: boolean;
      platformAdminEffectiveCount: number;
      anthropicApiKeyConfigured: boolean;
      codexOpenAiKeyConfigured: boolean;
      codexAuth: {
        chatgpt: {
          requestedWorkers: number;
          effectiveWorkers: number;
          configuredSlots: number;
          readySlots: number;
          degraded: boolean;
          authMode: string;
          codeHome: string | null;
          ready: boolean;
          reason: string | null;
          unsafeSharedToken: boolean;
          lastReadyAt: string | null;
          lastFailureAt: string | null;
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
        apiKey: {
          requestedWorkers: number;
          authMode: string;
          codeHome: string | null;
          ready: boolean;
          reason: string | null;
          lastReadyAt: string | null;
          lastFailureAt: string | null;
        };
      };
      processKeyExposure: {
        available: boolean;
        groups: Array<{
          group: string;
          processCount: number;
          anthropic: boolean;
          openai: boolean;
          codex: boolean;
          sampleNames: string[];
        }>;
        anthropicProcessCount: number;
        openAiProcessCount: number;
        codexProcessCount: number;
      };
    };
    degradedSections: string[];
    connections: number;
    activeConnections: number;
    connectionErrors: number;
    documents: {
      processing: number;
      failed: number;
      completed: number;
      deleted: number;
      stuckProcessing: number;
    };
    staging: {
      pending: number;
      processing: number;
      failed: number;
      committed: number;
    };
    chatRuns: {
      queued: number;
      running: number;
      failed: number;
      completed: number;
    };
    corpusChatUsage24h: {
      totalRuns: number;
      completedRuns: number;
      failedRuns: number;
      uniqueUsers: number;
      uniqueCompanies: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCostUsd: number | null;
    };
    anthropicAttribution: {
      anthropicApiKeyConfigured: boolean;
      trackedChat24h: {
        totalRuns: number;
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCostUsd: number | null;
      };
      structuredReportConfig24h: {
        newConfigs: number;
        activeCompanies: number;
        totalUsageCount: number;
        trackedRuns: number;
        trackedInputTokens: number;
        trackedOutputTokens: number;
        trackedEstimatedCostUsd: number | null;
        topCompanies: Array<{
          companyId: string;
          companyName: string;
          configCount: number;
        }>;
      };
      postCodexDocumentFlow24h: {
        total: number;
        completed: number;
        failed: number;
        needsReview: number;
        extractedTransactions: number;
        anthropicInPath: boolean;
        path: string;
      };
      trackedUsageBySubsystem24h: Array<{
        subsystem: string;
        operation: string;
        provider: string;
        model: string;
        runCount: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
      }>;
      topTrackedUsers24h: Array<{
        userId: string;
        userName: string;
        userEmail: string | null;
        runCount: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
        lastSeenAt: string | null;
      }>;
      topSystemActors24h: Array<{
        executor: string;
        subsystem: string;
        operation: string;
        runCount: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
        lastSeenAt: string | null;
      }>;
      topTrackedCompanies24h: Array<{
        companyId: string | null;
        companyName: string;
        runCount: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
      }>;
      topTrackedReferences24h: Array<{
        companyId: string | null;
        companyName: string;
        subsystem: string;
        operation: string;
        referenceType: string | null;
        referenceId: string | null;
        fileName: string | null;
        runCount: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
        lastSeenAt: string | null;
      }>;
      repeatedReportConfigInitialLoops24h: Array<{
        companyId: string | null;
        companyName: string;
        subsystem: string;
        operation: string;
        referenceType: string | null;
        referenceId: string | null;
        fileName: string | null;
        runCount: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
        lastSeenAt: string | null;
      }>;
      recentTrackedEvents24h: Array<{
        createdAt: string | null;
        companyId: string | null;
        companyName: string;
        userId: string | null;
        userEmail: string | null;
        provider: string;
        model: string;
        subsystem: string;
        operation: string;
        executor: string | null;
        billingMode: string | null;
        referenceType: string | null;
        referenceId: string | null;
        fileName: string | null;
        inputTokens: number;
        outputTokens: number;
        estimatedCostUsd: number;
      }>;
      communicationsSynthesis24h: {
        trackedRuns: number;
        trackedInputTokens: number;
        trackedOutputTokens: number;
        trackedEstimatedCostUsd: number | null;
        proxyCompanies: Array<{
          companyId: string | null;
          companyName: string;
          processedMessages: number;
          synthesisBatches: number;
          lastProcessedAt: string | null;
        }>;
      };
      transactionCategorization24h: {
        trackedRuns: number;
        trackedInputTokens: number;
        trackedOutputTokens: number;
        trackedEstimatedCostUsd: number | null;
      };
      capablePaths: Array<{
        subsystem: string;
        label: string;
        codePath: string;
        tracked: boolean;
        runCount24h: number;
        estimatedCostUsd24h: number | null;
      }>;
      untrackedPotentialConsumers: {
        communicationsSynthesis: boolean;
        transactionCategorization: boolean;
      };
    };
    communications: {
      pending: number;
      processed: number;
      failed: number;
    };
    signals: {
      pending: number;
      approved: number;
      rejected: number;
    };
    codexQueue: {
      defaultPool: "chatgpt" | "api_key";
      configuredWorkers: number;
      configuredWorkersChatgpt: number;
      configuredWorkersApiKey: number;
      activeWorkers: number;
      activeWorkersChatgpt: number;
      activeWorkersApiKey: number;
      queued: number;
      running: number;
      completed6h: number;
      completed24h: number;
      throughputPerHour: number | null;
      approxEtaHours: number | null;
      oldestQueuedAt: string | null;
    };
    ingressDispatch: {
      pdfCanaryEnabled: boolean;
      configuredCanaryCompanyCount: number;
      pdf24h: number;
      processing24h: number;
      completed24h: number;
      failed24h: number;
      simplified24h: number;
      escalated24h: number;
      escalatedFinance24h: number;
      escalatedOcr24h: number;
      escalatedAmbiguous24h: number;
      avgSimplifiedRoutingConfidence24h: number | null;
      avgSimplifiedExtractionConfidence24h: number | null;
      topEscalationReasons24h: Array<{ label: string; count: number }>;
      topFailureErrors24h: Array<{ label: string; count: number }>;
      topDispatchFailureErrors24h: Array<{ label: string; count: number }>;
      shadowNarrative24h: {
        enabled: boolean;
        observed: number;
        completed: number;
        skipped: number;
        failed: number;
        topSkipReasons: Array<{ label: string; count: number }>;
        topFailureErrors: Array<{ label: string; count: number }>;
        comparison: {
          evaluated: number;
          unresolved: number;
          agreeSimplifiedSafe: number;
          agreeHardPathNeeded: number;
          potentialFalseSafe: number;
          potentialNarrativeMiss: number;
          shadowFailed: number;
        };
      };
    };
  };
  corpusUsers: Array<{
    userId: string;
    name: string;
    email: string;
    companyCount: number;
    companyNames: string[];
    threadCount: number;
    chatRunCount: number;
    sessionCount24h: number;
    auditActionCount24h: number;
    chatRunCount24h: number;
    llmUsageEventCount24h: number;
    llmRunCount24h: number;
    llmInputTokens24h: number;
    llmOutputTokens24h: number;
    llmEstimatedCostUsd24h: number;
    anthropicRunCount24h: number;
    anthropicInputTokens24h: number;
    anthropicOutputTokens24h: number;
    anthropicEstimatedCostUsd24h: number;
    lastSessionAt: string | null;
    lastChatAt: string | null;
    lastAuditAt: string | null;
    lastLlmAt: string | null;
    lastActiveAt: string | null;
  }>;
  corpusRecentUserActions24h: Array<{
    createdAt: string | null;
    companyId: string | null;
    companyName: string | null;
    userId: string | null;
    userEmail: string | null;
    action: string;
    entityType: string;
    entityId: string;
    detail: string | null;
    source: string;
  }>;
  corpusChatTopUsers24h: Array<{
    userId: string;
    name: string;
    email: string;
    runCount: number;
    companyCount: number;
    totalTokens: number;
    estimatedCostUsd: number;
    lastRunAt: string | null;
  }>;
  corpusChatByModel24h: Array<{
    provider: string;
    model: string;
    runCount: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
  codexQueueByCompany: Array<{
    companyId: string;
    companyName: string;
    companySlug: string | null;
    targetPool: "chatgpt" | "api_key";
    queued: number;
    running: number;
    completed6h: number;
    completed24h: number;
    oldestQueuedAt: string | null;
    lastCompletedAt: string | null;
    approxEtaHours: number | null;
  }>;
  recentUsers: Array<{
    id: string;
    name: string;
    email: string;
    createdAt: string;
    companyCount: number;
    chatThreadCount: number;
  }>;
  recentCompanies: Array<{
    id: string;
    name: string;
    slug: string | null;
    createdAt: string;
    updatedAt: string;
    memberCount: number;
    connectionCount: number;
    documentCount: number;
    processingCount: number;
    failedCount: number;
    completedCount: number;
    stuckProcessingCount: number;
    lastDocumentAt: string | null;
  }>;
  recentDocuments: Array<{
    id: string;
    fileName: string;
    source: string;
    status: string;
    error: string | null;
    createdAt: string;
    companyId: string;
    companyName: string;
    companySlug: string | null;
  }>;
  recentPdfCanaryDocuments: Array<{
    id: string;
    fileName: string;
    fileType: string;
    source: string;
    status: string;
    error: string | null;
    createdAt: string;
    companyId: string;
    companyName: string;
    companySlug: string | null;
    ingressDispatch: {
      stage: string;
      processingStrategy: string | null;
      dispatchTarget: string | null;
      dispatchEvent: string | null;
      routingConfidence: number | null;
      extractionConfidence: number | null;
      ocrNeeded: boolean | null;
      tableDensity: string | null;
      language: string | null;
      reasons: string[];
      error: string | null;
      updatedAt: string | null;
    } | null;
  }>;
  recentPdfDispatchFailures: Array<{
    id: string;
    createdAt: string;
    companyName: string;
    companySlug: string | null;
    fileName: string | null;
    error: string | null;
  }>;
  recentShadowComparisonMismatches: Array<{
    documentId: string;
    fileName: string;
    companyName: string;
    companySlug: string | null;
    observedAt: string | null;
    mismatchType: "potential_false_safe" | "potential_narrative_miss";
    shadowAction: string | null;
    shadowReason: string | null;
    shadowProcessingStrategy: string | null;
    authoritativeBucket: string | null;
    authoritativeDocumentKind: string | null;
    documentStatus: string | null;
  }>;
  recentConnections: Array<{
    id: string;
    provider: string;
    status: string;
    lastSyncAt: string | null;
    lastError: string | null;
    errorCount: number;
    createdAt: string;
    updatedAt: string;
    companyId: string;
    companyName: string;
    companySlug: string | null;
    syncFreshness: "healthy" | "stale" | "never_synced" | "connected" | "on_demand";
    syncFreshnessLabel: string;
    expectedSyncIntervalLabel: string | null;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: string;
    companyName: string;
    companySlug: string | null;
    userName: string | null;
    userEmail: string | null;
  }>;
}

function formatDate(value: string | null) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function formatEtaHours(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  if (value < 1) return `${Math.max(1, Math.round(value * 60))}m`;
  if (value < 24) return `${value.toFixed(1)}h`;
  return `${(value / 24).toFixed(1)}d`;
}

function formatRate(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(1)}/h`;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function getSyncFreshnessBadgeVariant(
  freshness: AdminOverviewResponse["recentConnections"][number]["syncFreshness"],
) {
  switch (freshness) {
    case "stale":
    case "never_synced":
      return "destructive" as const;
    case "healthy":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function formatInteger(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat().format(value);
}

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function SummaryCard({
  title,
  value,
  sublabel,
  icon: Icon,
}: {
  title: string;
  value: number;
  sublabel?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {sublabel ? (
          <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function PlatformObservatory() {
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [updatingPoolCompanyId, setUpdatingPoolCompanyId] = useState<string | null>(null);
  const [updatingDefaultPool, setUpdatingDefaultPool] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to load admin overview (${response.status})`
        );
      }
      setData(payload as AdminOverviewResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const handleRetryStuckDocuments = useCallback(async () => {
    setRetrying(true);
    setRetryResult(null);
    try {
      const response = await fetch("/api/admin/retry-stuck-documents", {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Retry failed (${response.status})`
        );
      }
      setRetryResult(
        `stuckFound=${payload.stuckFound ?? 0}, uploadRetried=${payload.uploadRetried ?? 0}, downloadRetried=${payload.downloadRetried ?? 0}, failed=${payload.failed ?? 0}`
      );
      await fetchOverview();
    } catch (err) {
      setRetryResult(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  }, [fetchOverview]);

  const handleUpdatePool = useCallback(
    async (companyId: string, pool: "chatgpt" | "api_key") => {
      setUpdatingPoolCompanyId(companyId);
      try {
        const response = await fetch("/api/admin/codex-pools", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, pool }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : `Failed to update Codex pool (${response.status})`,
          );
        }
        await fetchOverview();
      } catch (err) {
        setRetryResult(err instanceof Error ? err.message : "Failed to update Codex pool");
      } finally {
        setUpdatingPoolCompanyId((current) => (current === companyId ? null : current));
      }
    },
    [fetchOverview],
  );

  const handleUpdateDefaultPool = useCallback(
    async (pool: "chatgpt" | "api_key") => {
      setUpdatingDefaultPool(true);
      try {
        const response = await fetch("/api/admin/codex-default-pool", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pool }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : `Failed to update default Codex pool (${response.status})`,
          );
        }
        setRetryResult(`Global Codex routing updated to ${pool}. New ingestions now route there.`);
        await fetchOverview();
      } catch (err) {
        setRetryResult(err instanceof Error ? err.message : "Failed to update default Codex pool");
      } finally {
        setUpdatingDefaultPool(false);
      }
    },
    [fetchOverview],
  );

  const companyIssues = useMemo(() => {
    if (!data) return [];
    return data.recentCompanies.filter(
      (company) => company.processingCount > 0 || company.failedCount > 0 || company.stuckProcessingCount > 0
    );
  }, [data]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" />
            Admin overview failed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{error ?? "No data"}</p>
          <Button onClick={() => void fetchOverview()} variant="outline">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Platform Admin</h1>
          <p className="text-sm text-muted-foreground">
            Users, companies, worker backlog, recent failures, and overall platform activity.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Snapshot: {formatDate(data.generatedAt)} · signed in as {data.actor.email}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void fetchOverview()}>
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
          <Button onClick={() => void handleRetryStuckDocuments()} disabled={retrying}>
            <Wrench className="mr-2 size-4" />
            {retrying ? "Retrying..." : "Retry Stuck Documents"}
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/admin/company-db">Open Company Map</Link>
          </Button>
        </div>
      </div>

      {retryResult ? (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {retryResult}
        </div>
      ) : null}

      {data.summary.degradedSections.length > 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
          Admin overview is showing partial data. Degraded sections: {data.summary.degradedSections.join(", ")}.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Users"
          value={data.summary.users}
          sublabel={`${data.summary.memberships} memberships`}
          icon={Users}
        />
        <SummaryCard
          title="Companies"
          value={data.summary.companies}
          sublabel={`${data.summary.activeConnections} active connections`}
          icon={Building2}
        />
        <SummaryCard
          title="Documents Processing"
          value={data.summary.documents.processing}
          sublabel={`${data.summary.documents.stuckProcessing} stuck > 30m`}
          icon={Database}
        />
        <SummaryCard
          title="Document Failures"
          value={data.summary.documents.failed}
          sublabel={`${data.summary.connectionErrors} connections with errors`}
          icon={AlertCircle}
        />
        <SummaryCard
          title="Staging Pending"
          value={data.summary.staging.pending}
          sublabel={`${data.summary.staging.failed} failed`}
          icon={Activity}
        />
        <SummaryCard
          title="Chat Runs"
          value={data.summary.chatRuns.running + data.summary.chatRuns.queued}
          sublabel={`${data.summary.chatRuns.failed} failed`}
          icon={Activity}
        />
        <SummaryCard
          title="Corpus Chat 24h"
          value={data.summary.corpusChatUsage24h.totalRuns}
          sublabel={`${formatInteger(data.summary.corpusChatUsage24h.totalTokens)} tokens · ${formatUsd(data.summary.corpusChatUsage24h.estimatedCostUsd)}`}
          icon={Activity}
        />
        <SummaryCard
          title="Communications Pending"
          value={data.summary.communications.pending}
          sublabel={`${data.summary.signals.pending} pending signals`}
          icon={Activity}
        />
        <SummaryCard
          title="Completed Documents"
          value={data.summary.documents.completed}
          sublabel={`${data.summary.staging.committed} committed staging records`}
          icon={Database}
        />
        <SummaryCard
          title="Codex Queue"
          value={data.summary.codexQueue.queued}
          sublabel={`${data.summary.codexQueue.running} running · ETA ${formatEtaHours(data.summary.codexQueue.approxEtaHours)}`}
          icon={Workflow}
        />
        <SummaryCard
          title="PDF Canary 24h"
          value={data.summary.ingressDispatch.pdf24h}
          sublabel={`${data.summary.ingressDispatch.simplified24h} simplified · ${data.summary.ingressDispatch.escalated24h} escalated`}
          icon={Workflow}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Runtime Diagnostics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Platform admins</div>
              <div className="mt-1 text-lg font-semibold">
                {data.summary.runtimeDiagnostics.platformAdminEffectiveCount}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                env configured {data.summary.runtimeDiagnostics.platformAdminEnvConfiguredCount}
                {" · "}
                fallback {data.summary.runtimeDiagnostics.platformAdminFallbackActive ? "active" : "off"}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Provider keys</div>
              <div className="mt-1 text-lg font-semibold">
                {data.summary.runtimeDiagnostics.anthropicApiKeyConfigured ? "Anthropic ok" : "Anthropic missing"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Codex/OpenAI {data.summary.runtimeDiagnostics.codexOpenAiKeyConfigured ? "configured" : "missing"}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Codex auth</div>
              <div className="mt-1 text-lg font-semibold">
                {data.summary.runtimeDiagnostics.codexAuth.chatgpt.ready ? "ChatGPT ok" : "ChatGPT broken"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                chatgpt {data.summary.runtimeDiagnostics.codexAuth.chatgpt.effectiveWorkers}/
                {data.summary.runtimeDiagnostics.codexAuth.chatgpt.requestedWorkers}
                {" · "}
                slots {data.summary.runtimeDiagnostics.codexAuth.chatgpt.readySlots}/
                {data.summary.runtimeDiagnostics.codexAuth.chatgpt.configuredSlots}
                {" · "}
                api_key {data.summary.runtimeDiagnostics.codexAuth.apiKey.ready ? "ok" : "broken"}
              </div>
              {data.summary.runtimeDiagnostics.codexAuth.chatgpt.unsafeSharedToken ? (
                <div className="mt-2 text-xs text-red-600">
                  Shared ChatGPT auth across multiple workers is unsafe. Effective workers are clamped to 1.
                </div>
              ) : data.summary.runtimeDiagnostics.codexAuth.chatgpt.configuredSlots > 1 ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  ChatGPT workers use isolated auth stores per slot. Only ready slots can claim new documents.
                </div>
              ) : null}
              {!data.summary.runtimeDiagnostics.codexAuth.chatgpt.ready &&
              data.summary.runtimeDiagnostics.codexAuth.chatgpt.reason ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  {data.summary.runtimeDiagnostics.codexAuth.chatgpt.reason}
                </div>
              ) : null}
              {data.summary.runtimeDiagnostics.codexAuth.chatgpt.degraded ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  Waiting on{" "}
                  {data.summary.runtimeDiagnostics.codexAuth.chatgpt.slots
                    .filter((slot) => !slot.ready)
                    .map((slot) => slot.slotId)
                    .join(", ")}
                  .
                </div>
              ) : null}
              <div className="mt-2 text-xs text-muted-foreground">
                last ready {formatDate(data.summary.runtimeDiagnostics.codexAuth.chatgpt.lastReadyAt)}
                {" · "}
                last failure {formatDate(data.summary.runtimeDiagnostics.codexAuth.chatgpt.lastFailureAt)}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Corpus chat 24h</div>
              <div className="mt-1 text-lg font-semibold">
                {data.summary.corpusChatUsage24h.uniqueUsers} users
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {data.summary.corpusChatUsage24h.uniqueCompanies} companies · {formatUsd(data.summary.corpusChatUsage24h.estimatedCostUsd)}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3 md:col-span-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-muted-foreground">Runtime key exposure</div>
                  <div className="mt-1 text-lg font-semibold">
                    {data.summary.runtimeDiagnostics.processKeyExposure.available
                      ? `${data.summary.runtimeDiagnostics.processKeyExposure.anthropicProcessCount} Anthropic processes`
                      : "PM2 process inventory unavailable"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    OpenAI {data.summary.runtimeDiagnostics.processKeyExposure.openAiProcessCount} · Codex {data.summary.runtimeDiagnostics.processKeyExposure.codexProcessCount}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="secondary">
                    Anthropic {data.summary.runtimeDiagnostics.processKeyExposure.anthropicProcessCount}
                  </Badge>
                  <Badge variant="secondary">
                    OpenAI {data.summary.runtimeDiagnostics.processKeyExposure.openAiProcessCount}
                  </Badge>
                  <Badge variant="secondary">
                    Codex {data.summary.runtimeDiagnostics.processKeyExposure.codexProcessCount}
                  </Badge>
                </div>
              </div>
              <div className="mt-3 grid gap-2">
                {data.summary.runtimeDiagnostics.processKeyExposure.groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No grouped PM2 process exposure data available.</p>
                ) : (
                  data.summary.runtimeDiagnostics.processKeyExposure.groups.map((group) => (
                    <div key={group.group} className="rounded-lg border border-border p-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{group.group}</div>
                          <div className="text-xs text-muted-foreground">
                            {group.processCount} processes · {group.sampleNames.join(", ")}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge variant={group.anthropic ? "destructive" : "outline"}>
                            Anthropic {group.anthropic ? "present" : "absent"}
                          </Badge>
                          <Badge variant={group.openai ? "default" : "outline"}>
                            OpenAI {group.openai ? "present" : "absent"}
                          </Badge>
                          <Badge variant={group.codex ? "secondary" : "outline"}>
                            Codex {group.codex ? "present" : "absent"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Corpus Chat Usage 24h</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Runs</div>
                <div className="mt-1 text-lg font-semibold">{data.summary.corpusChatUsage24h.totalRuns}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  completed {data.summary.corpusChatUsage24h.completedRuns} · failed {data.summary.corpusChatUsage24h.failedRuns}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Input tokens</div>
                <div className="mt-1 text-lg font-semibold">{formatInteger(data.summary.corpusChatUsage24h.inputTokens)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  output {formatInteger(data.summary.corpusChatUsage24h.outputTokens)}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Total tokens</div>
                <div className="mt-1 text-lg font-semibold">{formatInteger(data.summary.corpusChatUsage24h.totalTokens)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  unique users {data.summary.corpusChatUsage24h.uniqueUsers}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Estimated spend</div>
                <div className="mt-1 text-lg font-semibold">{formatUsd(data.summary.corpusChatUsage24h.estimatedCostUsd)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Anthropic standard-rate estimate
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium">Top users</div>
              {data.corpusChatTopUsers24h.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Corpus chat usage recorded in the last 24 hours.</p>
              ) : (
                data.corpusChatTopUsers24h.map((entry) => (
                  <div key={entry.userId} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{entry.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{entry.email}</div>
                      </div>
                      <Badge variant="secondary">{entry.runCount} runs</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{formatInteger(entry.totalTokens)} tokens</Badge>
                      <Badge variant="secondary">{entry.companyCount} companies</Badge>
                      <Badge variant="secondary">{formatUsd(entry.estimatedCostUsd)}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      last run {formatDate(entry.lastRunAt)}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium">By model</div>
              {data.corpusChatByModel24h.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Corpus model usage recorded in the last 24 hours.</p>
              ) : (
                data.corpusChatByModel24h.map((entry) => (
                  <div key={`${entry.provider}:${entry.model}`} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{entry.model}</div>
                        <div className="text-xs text-muted-foreground">{entry.provider}</div>
                      </div>
                      <Badge variant="secondary">{entry.runCount} runs</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{formatInteger(entry.totalTokens)} tokens</Badge>
                      <Badge variant="secondary">{formatUsd(entry.estimatedCostUsd)}</Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Anthropic Attribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">What this means</div>
            <div className="mt-1 text-sm">
              Anthropic spend in Corpus is currently tracked for chat. Post-Codex document promotion is not an
              Anthropic path in this repo; it runs through Codex promotion and reconciliation instead.
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Anthropic key</div>
              <div className="mt-1 text-lg font-semibold">
                {data.summary.anthropicAttribution.anthropicApiKeyConfigured ? "Configured" : "Missing"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">runtime availability only</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Tracked chat 24h</div>
              <div className="mt-1 text-lg font-semibold">
                {formatInteger(data.summary.anthropicAttribution.trackedChat24h.totalTokens)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {data.summary.anthropicAttribution.trackedChat24h.totalRuns} runs ·{" "}
                {formatUsd(data.summary.anthropicAttribution.trackedChat24h.estimatedCostUsd)}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Report configs 24h</div>
              <div className="mt-1 text-lg font-semibold">
                {data.summary.anthropicAttribution.structuredReportConfig24h.newConfigs}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {data.summary.anthropicAttribution.structuredReportConfig24h.activeCompanies} companies · usages{" "}
                {formatInteger(data.summary.anthropicAttribution.structuredReportConfig24h.totalUsageCount)}
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs text-muted-foreground">Post-Codex docs 24h</div>
              <div className="mt-1 text-lg font-semibold">
                {data.summary.anthropicAttribution.postCodexDocumentFlow24h.total}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Anthropic in path:{" "}
                {data.summary.anthropicAttribution.postCodexDocumentFlow24h.anthropicInPath ? "yes" : "no"}
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">Structured report config path</div>
              <div className="mt-2 text-xs text-muted-foreground">
                This is the real document-processing path in this repo that can call Anthropic during structured
                spreadsheet/report config generation.
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">
                  new configs {data.summary.anthropicAttribution.structuredReportConfig24h.newConfigs}
                </Badge>
                <Badge variant="secondary">
                  companies {data.summary.anthropicAttribution.structuredReportConfig24h.activeCompanies}
                </Badge>
                <Badge variant="secondary">
                  usage count {formatInteger(data.summary.anthropicAttribution.structuredReportConfig24h.totalUsageCount)}
                </Badge>
              </div>
              <div className="mt-3 space-y-2">
                {data.summary.anthropicAttribution.structuredReportConfig24h.topCompanies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No new report-config generation recorded in the last 24 hours.</p>
                ) : (
                  data.summary.anthropicAttribution.structuredReportConfig24h.topCompanies.map((entry) => (
                    <div key={entry.companyId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2">
                      <div className="min-w-0">
                        <div className="font-medium">{entry.companyName}</div>
                      </div>
                      <Badge variant="secondary">{entry.configCount} configs</Badge>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-4 space-y-2">
                <div className="text-sm font-medium">Repeated initial-generation loops (24h)</div>
                <div className="text-xs text-muted-foreground">
                  Same workbook fingerprint calling Anthropic initial generation more than once.
                  This is the primary signal for runaway spend when no reusable config gets cached.
                </div>
                {data.summary.anthropicAttribution.repeatedReportConfigInitialLoops24h.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No repeated initial-generation loops detected in the last 24 hours.</p>
                ) : (
                  data.summary.anthropicAttribution.repeatedReportConfigInitialLoops24h.map((entry) => (
                    <div
                      key={`${entry.referenceId ?? "none"}:${entry.lastSeenAt ?? "none"}`}
                      className="rounded-lg border border-amber-400/40 bg-amber-50/40 p-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{entry.companyName}</div>
                          <div className="text-xs text-muted-foreground">
                            {entry.fileName ?? entry.referenceId ?? "unknown workbook"}
                          </div>
                        </div>
                        <Badge variant="secondary">{entry.runCount} runs</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <Badge variant="secondary">input {formatInteger(entry.inputTokens)}</Badge>
                        <Badge variant="secondary">output {formatInteger(entry.outputTokens)}</Badge>
                        <Badge variant="secondary">{formatUsd(entry.estimatedCostUsd)}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        last seen {formatDate(entry.lastSeenAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">Post-Codex document path</div>
              <div className="mt-2 text-xs text-muted-foreground">
                Current path: {data.summary.anthropicAttribution.postCodexDocumentFlow24h.path}. This route is not
                billed through Anthropic in the current codebase.
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">
                  completed {data.summary.anthropicAttribution.postCodexDocumentFlow24h.completed}
                </Badge>
                <Badge variant="secondary">
                  failed {data.summary.anthropicAttribution.postCodexDocumentFlow24h.failed}
                </Badge>
                <Badge variant="secondary">
                  review {data.summary.anthropicAttribution.postCodexDocumentFlow24h.needsReview}
                </Badge>
                <Badge variant="secondary">
                  txns {data.summary.anthropicAttribution.postCodexDocumentFlow24h.extractedTransactions}
                </Badge>
              </div>
              <div className="mt-3 space-y-2">
                <div className="rounded-lg border border-border p-2 text-sm text-muted-foreground">
                  If bills are high while this section is active but chat is near zero, look at structured report config
                  generation, communications synthesis, or transaction categorization instead of Codex promotion.
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">
                    communications synthesis{" "}
                    {data.summary.anthropicAttribution.untrackedPotentialConsumers.communicationsSynthesis ? "untracked" : "tracked"}
                  </Badge>
                  <Badge variant="outline">
                    transaction categorization{" "}
                    {data.summary.anthropicAttribution.untrackedPotentialConsumers.transactionCategorization ? "untracked" : "tracked"}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">Tracked Anthropic-capable paths</div>
              <div className="mt-2 space-y-2">
                {data.summary.anthropicAttribution.capablePaths.map((path) => (
                  <div key={path.subsystem} className="rounded-lg border border-border p-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{path.label}</div>
                        <div className="text-xs text-muted-foreground">{path.codePath}</div>
                      </div>
                      <Badge variant={path.tracked ? "secondary" : "outline"}>
                        {path.tracked ? "tracked" : "not tracked"}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{path.runCount24h} runs</Badge>
                      <Badge variant="secondary">{formatUsd(path.estimatedCostUsd24h)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">Tracked usage by subsystem (24h)</div>
              <div className="mt-2 space-y-2">
                {data.summary.anthropicAttribution.trackedUsageBySubsystem24h.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tracked Anthropic usage events recorded in the last 24 hours.</p>
                ) : (
                  data.summary.anthropicAttribution.trackedUsageBySubsystem24h.map((entry) => (
                    <div key={`${entry.subsystem}:${entry.operation}:${entry.model}`} className="rounded-lg border border-border p-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{entry.subsystem}</div>
                          <div className="text-xs text-muted-foreground">
                            {entry.operation} · {entry.model}
                          </div>
                        </div>
                        <Badge variant="secondary">{entry.runCount} runs</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <Badge variant="secondary">input {formatInteger(entry.inputTokens)}</Badge>
                        <Badge variant="secondary">output {formatInteger(entry.outputTokens)}</Badge>
                        <Badge variant="secondary">{formatUsd(entry.estimatedCostUsd)}</Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">Top tracked users (24h)</div>
              <div className="mt-2 space-y-2">
                {data.summary.anthropicAttribution.topTrackedUsers24h.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tracked user-level LLM usage recorded in the last 24 hours.</p>
                ) : (
                  data.summary.anthropicAttribution.topTrackedUsers24h.map((entry) => (
                    <div key={entry.userId} className="rounded-lg border border-border p-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{entry.userName}</div>
                          <div className="text-xs text-muted-foreground">
                            {entry.userEmail ?? entry.userId}
                          </div>
                        </div>
                        <Badge variant="secondary">{entry.runCount} runs</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <Badge variant="secondary">input {formatInteger(entry.inputTokens)}</Badge>
                        <Badge variant="secondary">output {formatInteger(entry.outputTokens)}</Badge>
                        <Badge variant="secondary">{formatUsd(entry.estimatedCostUsd)}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        last seen {formatDate(entry.lastSeenAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">System-triggered Anthropic usage (24h)</div>
              <div className="mt-2 space-y-2">
                {data.summary.anthropicAttribution.topSystemActors24h.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No system-triggered Anthropic usage recorded in the last 24 hours.</p>
                ) : (
                  data.summary.anthropicAttribution.topSystemActors24h.map((entry) => (
                    <div
                      key={`${entry.executor}:${entry.subsystem}:${entry.operation}`}
                      className="rounded-lg border border-border p-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{entry.executor}</div>
                          <div className="text-xs text-muted-foreground">
                            {entry.subsystem} · {entry.operation}
                          </div>
                        </div>
                        <Badge variant="secondary">{entry.runCount} runs</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <Badge variant="secondary">input {formatInteger(entry.inputTokens)}</Badge>
                        <Badge variant="secondary">output {formatInteger(entry.outputTokens)}</Badge>
                        <Badge variant="secondary">{formatUsd(entry.estimatedCostUsd)}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        last seen {formatDate(entry.lastSeenAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">Top tracked companies (24h)</div>
              <div className="mt-2 space-y-2">
                {data.summary.anthropicAttribution.topTrackedCompanies24h.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tracked company-level Anthropic usage recorded in the last 24 hours.</p>
                ) : (
                  data.summary.anthropicAttribution.topTrackedCompanies24h.map((entry) => (
                    <div key={`${entry.companyId ?? "none"}:${entry.companyName}`} className="rounded-lg border border-border p-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium">{entry.companyName}</div>
                        <Badge variant="secondary">{entry.runCount} runs</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <Badge variant="secondary">input {formatInteger(entry.inputTokens)}</Badge>
                        <Badge variant="secondary">output {formatInteger(entry.outputTokens)}</Badge>
                        <Badge variant="secondary">{formatUsd(entry.estimatedCostUsd)}</Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">Top tracked files and references (24h)</div>
              <div className="mt-2 space-y-2">
                {data.summary.anthropicAttribution.topTrackedReferences24h.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tracked file-level Anthropic usage recorded in the last 24 hours.</p>
                ) : (
                  data.summary.anthropicAttribution.topTrackedReferences24h.map((entry) => (
                    <div
                      key={`${entry.companyId ?? "none"}:${entry.subsystem}:${entry.operation}:${entry.referenceId ?? "none"}`}
                      className="rounded-lg border border-border p-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                      <div className="font-medium">{entry.companyName}</div>
                      <div className="text-xs text-muted-foreground">
                        {entry.subsystem} · {entry.operation}
                      </div>
                    </div>
                    <Badge variant="secondary">{entry.runCount} runs</Badge>
                  </div>
                      <div className="mt-2 break-all text-xs text-muted-foreground">
                        {entry.fileName ?? entry.referenceId ?? "unknown"}
                      </div>
                      <div className="mt-1 break-all text-xs text-muted-foreground">
                        {entry.referenceType ?? "reference"} · {entry.referenceId ?? "unknown"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        last seen {formatDate(entry.lastSeenAt)}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <Badge variant="secondary">input {formatInteger(entry.inputTokens)}</Badge>
                        <Badge variant="secondary">output {formatInteger(entry.outputTokens)}</Badge>
                        <Badge variant="secondary">{formatUsd(entry.estimatedCostUsd)}</Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium">Communications synthesis (24h)</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">
                  tracked runs {data.summary.anthropicAttribution.communicationsSynthesis24h.trackedRuns}
                </Badge>
                <Badge variant="secondary">
                  input {formatInteger(data.summary.anthropicAttribution.communicationsSynthesis24h.trackedInputTokens)}
                </Badge>
                <Badge variant="secondary">
                  output {formatInteger(data.summary.anthropicAttribution.communicationsSynthesis24h.trackedOutputTokens)}
                </Badge>
                <Badge variant="secondary">
                  {formatUsd(data.summary.anthropicAttribution.communicationsSynthesis24h.trackedEstimatedCostUsd)}
                </Badge>
              </div>
              <div className="mt-3 space-y-2">
                {data.summary.anthropicAttribution.communicationsSynthesis24h.proxyCompanies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No communications proxy activity recorded in the last 24 hours.</p>
                ) : (
                  data.summary.anthropicAttribution.communicationsSynthesis24h.proxyCompanies.map((entry) => (
                    <div key={`${entry.companyId ?? "none"}:${entry.companyName}`} className="rounded-lg border border-border p-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium">{entry.companyName}</div>
                        <Badge variant="secondary">{entry.synthesisBatches} batches</Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {entry.processedMessages} processed messages · last processed {formatDate(entry.lastProcessedAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Recent tracked Anthropic events (24h)</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Direct event log for Corpus Anthropic-capable paths.
                </div>
              </div>
              <Badge variant="secondary">
                {data.summary.anthropicAttribution.recentTrackedEvents24h.length} events
              </Badge>
            </div>
            <div className="mt-3 space-y-2">
              {data.summary.anthropicAttribution.recentTrackedEvents24h.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tracked Anthropic events recorded in the last 24 hours.</p>
              ) : (
                data.summary.anthropicAttribution.recentTrackedEvents24h.slice(0, 20).map((entry, index) => (
                  <div key={`${entry.createdAt ?? "none"}:${entry.referenceId ?? index}`} className="rounded-lg border border-border p-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">
                          {entry.subsystem} · {entry.operation}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {entry.companyName}
                          {entry.userEmail ? ` · ${entry.userEmail}` : ""}
                          {entry.referenceType ? ` · ${entry.referenceType}` : ""}
                        </div>
                        {entry.fileName ? (
                          <div className="text-xs text-muted-foreground">{entry.fileName}</div>
                        ) : null}
                      </div>
                      <Badge variant="secondary">{formatUsd(entry.estimatedCostUsd)}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{entry.model}</Badge>
                      <Badge variant="secondary">input {formatInteger(entry.inputTokens)}</Badge>
                      <Badge variant="secondary">output {formatInteger(entry.outputTokens)}</Badge>
                      {entry.billingMode ? <Badge variant="outline">{entry.billingMode}</Badge> : null}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {formatDate(entry.createdAt)}
                      {entry.executor ? ` · ${entry.executor}` : ""}
                      {entry.referenceId ? ` · ref ${entry.referenceId}` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Corpus Users And Recent Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="text-sm font-medium">Users</div>
              {data.corpusUsers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Corpus users found.</p>
              ) : (
                data.corpusUsers.slice(0, 20).map((user) => (
                  <div key={user.userId} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{user.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                      </div>
                      <Badge variant="secondary">{user.companyCount} companies</Badge>
                    </div>
                    {(user.companyNames?.length ?? 0) > 0 ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {user.companyNames.join(" · ")}
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{user.threadCount} threads</Badge>
                      <Badge variant="secondary">{user.chatRunCount} chat runs total</Badge>
                      <Badge variant="secondary">{user.sessionCount24h} sessions 24h</Badge>
                      <Badge variant="secondary">{user.auditActionCount24h} actions 24h</Badge>
                      <Badge variant="secondary">{user.chatRunCount24h} chat runs 24h</Badge>
                      <Badge variant="secondary">{user.llmUsageEventCount24h} llm events 24h</Badge>
                      <Badge variant="secondary">{user.llmRunCount24h} llm runs 24h</Badge>
                      <Badge variant="secondary">
                        {formatInteger(user.llmInputTokens24h + user.llmOutputTokens24h)} llm tokens 24h
                      </Badge>
                      <Badge variant="secondary">{formatUsd(user.llmEstimatedCostUsd24h)} llm spend 24h</Badge>
                      <Badge variant="outline">{user.anthropicRunCount24h} anthropic runs 24h</Badge>
                      <Badge variant="outline">
                        {formatInteger(user.anthropicInputTokens24h + user.anthropicOutputTokens24h)} anthropic tokens 24h
                      </Badge>
                      <Badge variant="outline">{formatUsd(user.anthropicEstimatedCostUsd24h)} anthropic spend 24h</Badge>
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <div>last active {formatDate(user.lastActiveAt)}</div>
                      <div>
                        session {formatDate(user.lastSessionAt)} · chat {formatDate(user.lastChatAt)} · audit{" "}
                        {formatDate(user.lastAuditAt)} · llm {formatDate(user.lastLlmAt)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium">Recent actions (24h)</div>
              {data.corpusRecentUserActions24h.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent Corpus user actions recorded in the last 24 hours.</p>
              ) : (
                data.corpusRecentUserActions24h.slice(0, 20).map((action, index) => (
                  <div key={`${action.createdAt ?? "none"}:${action.entityId}:${index}`} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{action.action}</div>
                        <div className="text-xs text-muted-foreground">
                          {action.userEmail ?? "unknown user"}
                          {action.companyName ? ` · ${action.companyName}` : ""}
                          {action.source ? ` · ${action.source}` : ""}
                        </div>
                      </div>
                      <Badge variant="secondary">{action.entityType}</Badge>
                    </div>
                    {action.detail ? (
                      <div className="mt-2 text-sm text-muted-foreground">{action.detail}</div>
                    ) : null}
                    <div className="mt-2 text-xs text-muted-foreground">
                      {formatDate(action.createdAt)}
                      {action.entityId ? ` · ${action.entityId}` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Codex Queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-border p-3 sm:col-span-2 xl:col-span-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Default routing for new ingestions</div>
                    <div className="mt-1 text-lg font-semibold">
                      {data.summary.codexQueue.defaultPool === "api_key" ? "API key workers" : "ChatGPT workers"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      This switches the service-wide default and aligns all company routing for newly queued documents.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={data.summary.codexQueue.defaultPool === "chatgpt" ? "default" : "outline"}
                      disabled={updatingDefaultPool}
                      onClick={() => void handleUpdateDefaultPool("chatgpt")}
                    >
                      Route all new ingestions to ChatGPT
                    </Button>
                    <Button
                      variant={data.summary.codexQueue.defaultPool === "api_key" ? "default" : "outline"}
                      disabled={updatingDefaultPool}
                      onClick={() => void handleUpdateDefaultPool("api_key")}
                    >
                      Route all new ingestions to API key
                    </Button>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Workers</div>
                <div className="mt-1 text-lg font-semibold">
                  {data.summary.codexQueue.activeWorkers}/{data.summary.codexQueue.configuredWorkers}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  chatgpt {data.summary.codexQueue.activeWorkersChatgpt}/{data.summary.codexQueue.configuredWorkersChatgpt}
                  {" · "}
                  api_key {data.summary.codexQueue.activeWorkersApiKey}/{data.summary.codexQueue.configuredWorkersApiKey}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Throughput</div>
                <div className="mt-1 text-lg font-semibold">
                  {formatRate(data.summary.codexQueue.throughputPerHour)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {data.summary.codexQueue.completed6h} completed 6h · {data.summary.codexQueue.completed24h} completed 24h
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Backlog ETA</div>
                <div className="mt-1 text-lg font-semibold">
                  {formatEtaHours(data.summary.codexQueue.approxEtaHours)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  oldest queued {formatDate(data.summary.codexQueue.oldestQueuedAt)}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Queue State</div>
                <div className="mt-1 text-lg font-semibold">
                  {data.summary.codexQueue.queued} queued
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {data.summary.codexQueue.running} running
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {data.codexQueueByCompany.length === 0 ? (
                <p className="text-sm text-muted-foreground">No codex backlog detected.</p>
              ) : (
                data.codexQueueByCompany.slice(0, 12).map((entry) => (
                  <div key={entry.companyId} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">{entry.companyName}</div>
                        <div className="text-xs text-muted-foreground">
                          {entry.companySlug ?? "no-slug"} · oldest queued {formatDate(entry.oldestQueuedAt)}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Badge variant={entry.targetPool === "api_key" ? "default" : "secondary"}>
                          target {entry.targetPool}
                        </Badge>
                        <Button
                          variant={entry.targetPool === "chatgpt" ? "default" : "outline"}
                          size="sm"
                          disabled={updatingPoolCompanyId === entry.companyId}
                          onClick={() => void handleUpdatePool(entry.companyId, "chatgpt")}
                        >
                          Route to ChatGPT
                        </Button>
                        <Button
                          variant={entry.targetPool === "api_key" ? "default" : "outline"}
                          size="sm"
                          disabled={updatingPoolCompanyId === entry.companyId}
                          onClick={() => void handleUpdatePool(entry.companyId, "api_key")}
                        >
                          Route to API key
                        </Button>
                        {entry.companySlug ? (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/admin/company-db?company=${encodeURIComponent(entry.companySlug)}`}>
                              Inspect
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">queued {entry.queued}</Badge>
                      <Badge variant="secondary">running {entry.running}</Badge>
                      <Badge variant="secondary">completed 24h {entry.completed24h}</Badge>
                      <Badge variant="secondary">ETA {formatEtaHours(entry.approxEtaHours)}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      last completed {formatDate(entry.lastCompletedAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Companies With Active Issues</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {companyIssues.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent company backlog detected.</p>
            ) : (
              companyIssues.map((company) => (
                <div key={company.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{company.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {company.slug ?? "no-slug"} · members {company.memberCount} · connections {company.connectionCount}
                      </div>
                    </div>
                    {company.slug ? (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/company-db?company=${encodeURIComponent(company.slug)}`}>
                          Inspect
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <Badge variant="secondary">processing {company.processingCount}</Badge>
                    <Badge variant="secondary">failed {company.failedCount}</Badge>
                    <Badge variant="secondary">stuck {company.stuckProcessingCount}</Badge>
                    <Badge variant="secondary">documents {company.documentCount}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>PDF Pre-Codex Canary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-border p-3 sm:col-span-2 xl:col-span-4">
                <div className="text-xs text-muted-foreground">Rollout state</div>
                <div className="mt-1 text-lg font-semibold">
                  {data.summary.ingressDispatch.pdfCanaryEnabled ? "Enabled" : "Disabled"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  canary companies {data.summary.ingressDispatch.configuredCanaryCompanyCount}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Observed 24h</div>
                <div className="mt-1 text-lg font-semibold">{data.summary.ingressDispatch.pdf24h}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  processing {data.summary.ingressDispatch.processing24h}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Simplified 24h</div>
                <div className="mt-1 text-lg font-semibold">
                  {data.summary.ingressDispatch.simplified24h}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  routing {formatPercent(data.summary.ingressDispatch.avgSimplifiedRoutingConfidence24h)}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Escalated 24h</div>
                <div className="mt-1 text-lg font-semibold">
                  {data.summary.ingressDispatch.escalated24h}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  ocr {data.summary.ingressDispatch.escalatedOcr24h} · amb {data.summary.ingressDispatch.escalatedAmbiguous24h}
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Outcomes 24h</div>
                <div className="mt-1 text-lg font-semibold">
                  {data.summary.ingressDispatch.completed24h}/{data.summary.ingressDispatch.pdf24h}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  failed {data.summary.ingressDispatch.failed24h} · extract {formatPercent(data.summary.ingressDispatch.avgSimplifiedExtractionConfidence24h)}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Shadow mode</div>
                  <div className="mt-1 text-lg font-semibold">
                    {data.summary.ingressDispatch.shadowNarrative24h.enabled ? "Enabled" : "Disabled"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    hard-path sidecar only
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Shadow observed 24h</div>
                  <div className="mt-1 text-lg font-semibold">
                    {data.summary.ingressDispatch.shadowNarrative24h.observed}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    completed {data.summary.ingressDispatch.shadowNarrative24h.completed}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Shadow outcomes 24h</div>
                  <div className="mt-1 text-lg font-semibold">
                    {data.summary.ingressDispatch.shadowNarrative24h.skipped} skipped
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    failed {data.summary.ingressDispatch.shadowNarrative24h.failed}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Authoritative eval</div>
                  <div className="mt-1 text-lg font-semibold">
                    {data.summary.ingressDispatch.shadowNarrative24h.comparison.evaluated}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    unresolved {data.summary.ingressDispatch.shadowNarrative24h.comparison.unresolved}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Agreements</div>
                  <div className="mt-1 text-lg font-semibold">
                    {data.summary.ingressDispatch.shadowNarrative24h.comparison.agreeSimplifiedSafe}
                    {" / "}
                    {data.summary.ingressDispatch.shadowNarrative24h.comparison.agreeHardPathNeeded}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    simplified safe / hard path needed
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Potential mismatches</div>
                  <div className="mt-1 text-lg font-semibold">
                    {data.summary.ingressDispatch.shadowNarrative24h.comparison.potentialFalseSafe}
                    {" / "}
                    {data.summary.ingressDispatch.shadowNarrative24h.comparison.potentialNarrativeMiss}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    false-safe / narrative miss
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Top escalation reasons</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.summary.ingressDispatch.topEscalationReasons24h.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No escalations yet.</span>
                    ) : (
                      data.summary.ingressDispatch.topEscalationReasons24h.map((entry) => (
                        <Badge key={entry.label} variant="secondary">
                          {entry.label} {entry.count}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Top failed document errors</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.summary.ingressDispatch.topFailureErrors24h.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No failed simplified docs.</span>
                    ) : (
                      data.summary.ingressDispatch.topFailureErrors24h.map((entry) => (
                        <Badge key={entry.label} variant="secondary">
                          {entry.label} {entry.count}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Top dispatch failures</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.summary.ingressDispatch.topDispatchFailureErrors24h.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No dispatch failures logged.</span>
                    ) : (
                      data.summary.ingressDispatch.topDispatchFailureErrors24h.map((entry) => (
                        <Badge key={entry.label} variant="secondary">
                          {entry.label} {entry.count}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Top shadow skip reasons</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.summary.ingressDispatch.shadowNarrative24h.topSkipReasons.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No shadow skips logged.</span>
                    ) : (
                      data.summary.ingressDispatch.shadowNarrative24h.topSkipReasons.map((entry) => (
                        <Badge key={entry.label} variant="secondary">
                          {entry.label} {entry.count}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-xs text-muted-foreground">Top shadow failures</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.summary.ingressDispatch.shadowNarrative24h.topFailureErrors.length === 0 ? (
                      <span className="text-xs text-muted-foreground">No shadow failures logged.</span>
                    ) : (
                      data.summary.ingressDispatch.shadowNarrative24h.topFailureErrors.map((entry) => (
                        <Badge key={entry.label} variant="secondary">
                          {entry.label} {entry.count}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium">Recent comparison mismatches</div>
                {data.recentShadowComparisonMismatches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent shadow mismatches detected.</p>
                ) : (
                  data.recentShadowComparisonMismatches.map((entry) => (
                    <div key={`${entry.documentId}:${entry.mismatchType}`} className="rounded-lg border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{entry.fileName}</div>
                          <div className="text-xs text-muted-foreground">
                            {entry.companyName} · {formatDate(entry.observedAt)}
                          </div>
                        </div>
                        <Badge variant="destructive">{entry.mismatchType}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <Badge variant="secondary">
                          shadow {entry.shadowAction ?? "unknown"}
                        </Badge>
                        {entry.shadowProcessingStrategy ? (
                          <Badge variant="secondary">
                            strategy {entry.shadowProcessingStrategy}
                          </Badge>
                        ) : null}
                        <Badge variant="secondary">
                          auth {entry.authoritativeBucket ?? "unknown"}
                        </Badge>
                        <Badge variant="secondary">
                          kind {entry.authoritativeDocumentKind ?? "unknown"}
                        </Badge>
                        <Badge variant="secondary">
                          doc {entry.documentStatus ?? "unknown"}
                        </Badge>
                      </div>
                      {entry.shadowReason ? (
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          shadow reason: {entry.shadowReason}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/admin/documents/${encodeURIComponent(entry.documentId)}`}>
                            Open detail
                          </Link>
                        </Button>
                        {entry.companySlug ? (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/admin/company-db?company=${encodeURIComponent(entry.companySlug)}`}>
                              Inspect company
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {data.recentPdfCanaryDocuments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent PDF canary traffic observed.</p>
              ) : (
                data.recentPdfCanaryDocuments.map((document) => (
                  <div key={document.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{document.fileName}</div>
                        <div className="text-xs text-muted-foreground">
                          {document.companyName} · {document.source} · {formatDate(document.createdAt)}
                        </div>
                      </div>
                      <Badge variant={document.status === "failed" ? "destructive" : "secondary"}>
                        {document.status}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">
                        {document.ingressDispatch?.processingStrategy ?? "unknown"}
                      </Badge>
                      <Badge variant="secondary">
                        target {document.ingressDispatch?.dispatchTarget ?? "n/a"}
                      </Badge>
                      <Badge variant="secondary">
                        routing {formatPercent(document.ingressDispatch?.routingConfidence ?? null)}
                      </Badge>
                      <Badge variant="secondary">
                        table {document.ingressDispatch?.tableDensity ?? "n/a"}
                      </Badge>
                    </div>
                    {document.ingressDispatch?.reasons?.length ? (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                        {document.ingressDispatch.reasons.join(", ")}
                      </p>
                    ) : null}
                    {document.error ? (
                      <p className="mt-2 line-clamp-2 text-xs text-destructive">{document.error}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/admin/documents/${encodeURIComponent(document.id)}`}>
                          Open detail
                        </Link>
                      </Button>
                      {document.companySlug ? (
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/company-db?company=${encodeURIComponent(document.companySlug)}`}>
                            Inspect company
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium">Recent dispatch failures</div>
              {data.recentPdfDispatchFailures.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent PDF dispatch failures.</p>
              ) : (
                data.recentPdfDispatchFailures.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{entry.fileName ?? "unknown.pdf"}</div>
                        <div className="text-xs text-muted-foreground">
                          {entry.companyName} · {formatDate(entry.createdAt)}
                        </div>
                      </div>
                      <Badge variant="destructive">dispatch_failed</Badge>
                    </div>
                    {entry.error ? (
                      <p className="mt-2 line-clamp-2 text-xs text-destructive">{entry.error}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/admin/documents/${encodeURIComponent(entry.id)}`}>
                          Open detail
                        </Link>
                      </Button>
                      {entry.companySlug ? (
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/company-db?company=${encodeURIComponent(entry.companySlug)}`}>
                            Inspect company
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Document Failures / Processing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentDocuments
              .filter((document) => document.status === "failed" || document.status === "processing")
              .slice(0, 12)
              .map((document) => (
                <div key={document.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{document.fileName}</div>
                      <div className="text-xs text-muted-foreground">
                        {document.companyName} · {document.source} · {formatDate(document.createdAt)}
                      </div>
                    </div>
                    <Badge variant={document.status === "failed" ? "destructive" : "secondary"}>
                      {document.status}
                    </Badge>
                  </div>
                  {document.error ? (
                    <p className="mt-2 line-clamp-2 text-xs text-destructive">{document.error}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/admin/documents/${encodeURIComponent(document.id)}`}>
                        Open detail
                      </Link>
                    </Button>
                    {document.companySlug ? (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/company-db?company=${encodeURIComponent(document.companySlug)}`}>
                          Inspect company
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Users</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentUsers.map((user) => (
              <div key={user.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{user.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{user.companyCount} companies</div>
                  <div>{user.chatThreadCount} chats</div>
                  <div>{formatDate(user.createdAt)}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Connections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentConnections.slice(0, 12).map((connection) => (
              <div key={connection.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {connection.companyName} · {connection.provider}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {connection.syncFreshnessLabel} · updated {formatDate(connection.updatedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={getSyncFreshnessBadgeVariant(connection.syncFreshness)}>
                      {connection.syncFreshness.replaceAll("_", " ")}
                    </Badge>
                    <Badge variant={connection.lastError ? "destructive" : "secondary"}>
                      {connection.status}
                    </Badge>
                  </div>
                </div>
                {connection.lastError ? (
                  <p className="mt-2 line-clamp-2 text-xs text-destructive">{connection.lastError}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Platform Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.recentActivity.slice(0, 15).map((activity) => (
            <div key={activity.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{activity.action}</Badge>
                <span className="font-medium">{activity.entityType}</span>
                <span className="text-muted-foreground">{activity.companyName}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {(activity.userName || activity.userEmail || "system")} · {formatDate(activity.createdAt)}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
