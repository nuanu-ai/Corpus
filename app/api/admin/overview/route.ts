import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-auth";
import { getCodexAuthHealth } from "@/lib/admin/codex-auth-health";
import { getLlmObservabilityOverview } from "@/lib/admin/llm-observability";
import { getRuntimeProcessKeyExposure } from "@/lib/admin/runtime-processes";
import { getAdminUserActivityOverview } from "@/lib/admin/user-activity";
import {
  getCodexWorkerPoolFromCompanySettings,
  resolveDefaultCodexWorkerPool,
} from "@/lib/codex-worker/pool";
import {
  buildEffectiveDocumentSourceExpr,
  getEffectiveDocumentSource,
} from "@/lib/codex-worker/source-context";
import { db } from "@/lib/db";
import {
  auditLog,
  chatRuns,
  chatThreads,
  communicationMessages,
  companies,
  companyMembers,
  connections,
  documents,
  pendingSignals,
  reportConfigs,
  stagingRecords,
  users,
} from "@/lib/db/schema";
import { summarizeIngressDispatchState } from "@/lib/inngest/ingress-dispatch-state";
import { coerceCountedLabels } from "@/lib/inngest/pdf-canary-analytics";
import {
  coerceGoogleDriveConnectionMetadata,
  hasGoogleDriveActiveAutoImport,
} from "@/lib/connectors/google-drive";
import { describeConnectionSyncFreshness, type ConnectionSyncFreshnessState } from "@/lib/connectors/sync-health";
import { getPlatformAdminDiagnostics, getPlatformAdminSession } from "@/lib/platform-admin";

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function computeCodexRatePerHour(completed6h: number, completed24h: number): number | null {
  if (completed6h > 0) return completed6h / 6;
  if (completed24h > 0) return completed24h / 24;
  return null;
}

function roundMetric(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function roundCurrencyMetric(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function toCount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countConfiguredCanaryCompanies(value: string | undefined): number {
  if (!value) return 0;
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ).size;
}

function resolveRecentConnectionExpectedInterval(
  provider: string,
  metadata: Record<string, unknown> | null,
): number | null | undefined {
  if (provider !== "google_drive") return undefined;

  const driveMetadata = coerceGoogleDriveConnectionMetadata(metadata);
  return hasGoogleDriveActiveAutoImport(driveMetadata) ? undefined : null;
}

function getRecentConnectionAttentionRank(connection: {
  status: string;
  lastError: string | null;
  syncFreshness: ConnectionSyncFreshnessState;
}): number {
  if (connection.lastError || connection.status === "error" || connection.status === "expired") {
    return 0;
  }
  if (connection.syncFreshness === "stale" || connection.syncFreshness === "never_synced") {
    return 1;
  }
  if (connection.status !== "active") {
    return 2;
  }
  if (connection.syncFreshness === "connected") {
    return 3;
  }
  if (connection.syncFreshness === "healthy") {
    return 4;
  }
  return 5;
}

interface SubsystemUsageSummary {
  subsystem: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

function summarizeTrackedSubsystemUsage(
  rows: Array<{
    subsystem: string;
    runCount: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  }>,
): Map<string, SubsystemUsageSummary> {
  const summary = new Map<string, SubsystemUsageSummary>();
  for (const row of rows) {
    const current = summary.get(row.subsystem) ?? {
      subsystem: row.subsystem,
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    };
    current.runCount += toCount(row.runCount);
    current.inputTokens += toCount(row.inputTokens);
    current.outputTokens += toCount(row.outputTokens);
    current.estimatedCostUsd = roundCurrencyMetric(
      current.estimatedCostUsd + Number(row.estimatedCostUsd ?? 0),
    ) ?? 0;
    summary.set(row.subsystem, current);
  }
  return summary;
}

async function safeSection<T>(
  label: string,
  fn: () => Promise<T>,
  fallback: T,
  degradedSections?: string[],
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[admin-overview] ${label} failed`, error);
    if (degradedSections && !degradedSections.includes(label)) {
      degradedSections.push(label);
    }
    return fallback;
  }
}

export async function GET() {
  try {
    const session = await getPlatformAdminSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const degradedSections: string[] = [];

    const codexStageExpr = sql<string>`coalesce(${documents.ocrResult} -> 'codex_preprocess' ->> 'stage', 'queued')`;
    const codexCompletedAtExpr = sql<string | null>`nullif(${documents.ocrResult} -> 'codex_preprocess' ->> 'completed_at', '')`;
    const codexWorkerIdExpr = sql<string | null>`nullif(${documents.ocrResult} -> 'codex_preprocess' ->> 'worker_id', '')`;
    const codexPoolExpr = sql<string>`coalesce(${documents.ocrResult} -> 'codex_preprocess' ->> 'pool', 'chatgpt')`;
    const effectiveSourceExpr = buildEffectiveDocumentSourceExpr(
      documents.source,
      documents.ocrResult,
    );
    const ingressDispatchStageExpr = sql<string | null>`nullif(${documents.ocrResult} -> 'ingress_dispatch' ->> 'stage', '')`;
    const ingressDispatchStrategyExpr = sql<string | null>`nullif(${documents.ocrResult} -> 'ingress_dispatch' ->> 'processing_strategy', '')`;
    const ingressDispatchTargetExpr = sql<string | null>`nullif(${documents.ocrResult} -> 'ingress_dispatch' ->> 'dispatch_target', '')`;
    const ingressDispatchRoutingConfidenceExpr = sql<string | null>`nullif(${documents.ocrResult} -> 'ingress_dispatch' ->> 'routing_confidence', '')`;
    const ingressDispatchExtractionConfidenceExpr = sql<string | null>`nullif(${documents.ocrResult} -> 'ingress_dispatch' ->> 'extraction_confidence', '')`;
    const codexWorkerSlotExpr = sql<string | null>`
      case
        when ${codexWorkerIdExpr} is null then null
        when ${codexWorkerIdExpr} ~ '^codex-worker-[0-9]+' then coalesce(substring(${codexWorkerIdExpr} from '^codex-worker-[0-9]+'), ${codexWorkerIdExpr})
        else ${codexWorkerIdExpr}
      end
    `;
    const codexWorkerPoolSlotExpr = sql<string | null>`
      case
        when ${codexWorkerSlotExpr} is null then null
        else ${codexPoolExpr} || ':' || ${codexWorkerSlotExpr}
      end
    `;
    const configuredCodexWorkersChatgpt = parsePositiveInt(
      process.env.CODEX_WORKER_INSTANCES_CHATGPT ?? process.env.CODEX_WORKER_INSTANCES,
      4,
    );
    const configuredCodexWorkersApiKey = parsePositiveInt(
      process.env.CODEX_WORKER_INSTANCES_API_KEY,
      0,
    );
    const configuredCodexWorkersChatgptEffective = configuredCodexWorkersChatgpt;
    const pdfCanaryEnabled =
      process.env.INGEST_PRECODEX_TRIAGE_V1 === "true" &&
      process.env.INGEST_PRECODEX_PDF_V1 === "true";
    const shadowNarrativeEnabled =
      process.env.INGEST_SIMPLIFIED_NARRATIVE_SHADOW_V1 === "true" && !pdfCanaryEnabled;
    const configuredCanaryCompanyCount = countConfiguredCanaryCompanies(
      process.env.INGEST_CANARY_COMPANY_IDS,
    );
    const defaultCodexPool = await resolveDefaultCodexWorkerPool();
    const codexAuth = await safeSection(
      "codex-auth-health",
      () => getCodexAuthHealth(process.env),
      {
        chatgpt: {
          requestedWorkers: 0,
          effectiveWorkers: 0,
          configuredSlots: 0,
          readySlots: 0,
          degraded: false,
          authMode: "chatgpt",
          codeHome: null,
          ready: false,
          reason: "auth check unavailable",
          unsafeSharedToken: false,
          lastReadyAt: null,
          lastFailureAt: null,
          slots: [],
        },
        apiKey: {
          requestedWorkers: 0,
          authMode: "api_key",
          codeHome: null,
          ready: false,
          reason: "auth check unavailable",
          lastReadyAt: null,
          lastFailureAt: null,
        },
      },
      degradedSections,
    );

    const [
      totalUsers,
      totalCompanies,
      totalMembers,
      totalConnections,
      activeConnections,
    ] = await safeSection(
      "core-counts",
      async () => Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(users),
        db.select({ count: sql<number>`count(*)::int` }).from(companies),
        db.select({ count: sql<number>`count(*)::int` }).from(companyMembers),
        db.select({ count: sql<number>`count(*)::int` }).from(connections),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(connections)
          .where(eq(connections.status, "active")),
      ]),
      [[{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }], [{ count: 0 }]] as [
        Array<{ count: number }>,
        Array<{ count: number }>,
        Array<{ count: number }>,
        Array<{ count: number }>,
        Array<{ count: number }>,
      ],
      degradedSections,
    );

    const [
      docStatusRows,
      stagingRows,
      chatRunRows,
      signalRows,
      commRows,
    ] = await safeSection(
      "status-counts",
      async () => Promise.all([
        db
          .select({
            status: documents.status,
            count: sql<number>`count(*)::int`,
          })
          .from(documents)
          .groupBy(documents.status),
        db
          .select({
            status: stagingRecords.status,
            count: sql<number>`count(*)::int`,
          })
          .from(stagingRecords)
          .groupBy(stagingRecords.status),
        db
          .select({
            status: chatRuns.status,
            count: sql<number>`count(*)::int`,
          })
          .from(chatRuns)
          .groupBy(chatRuns.status),
        db
          .select({
            status: pendingSignals.status,
            count: sql<number>`count(*)::int`,
          })
          .from(pendingSignals)
          .groupBy(pendingSignals.status),
        db
          .select({
            status: communicationMessages.processingStatus,
            count: sql<number>`count(*)::int`,
          })
          .from(communicationMessages)
          .groupBy(communicationMessages.processingStatus),
      ]),
      [[], [], [], [], []] as [
        Array<{ status: string; count: number }>,
        Array<{ status: string; count: number }>,
        Array<{ status: string; count: number }>,
        Array<{ status: string; count: number }>,
        Array<{ status: string; count: number }>,
      ],
      degradedSections,
    );

    const [
      connectionErrorCount,
      stuckProcessingCount,
      codexQueueTotals,
      codexQueueByCompany,
      ingressDispatchTotals,
    ] = await safeSection(
      "queue-and-ingress",
      async () => Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(connections)
          .where(sql`${connections.lastError} is not null and ${connections.lastError} <> ''`),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(documents)
          .where(
            and(
              eq(documents.status, "processing"),
              sql`${documents.createdAt} < now() - interval '30 minutes'`
            )
          ),
        db
          .select({
            queued: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::int`,
            running: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} in ('artifactizing', 'running', 'persisting'))::int`,
            googleDriveQueued: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${effectiveSourceExpr} = 'google_drive' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::int`,
            googleDriveRunning: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${effectiveSourceExpr} = 'google_drive' and ${documents.status} = 'processing' and ${codexStageExpr} in ('artifactizing', 'running', 'persisting'))::int`,
            completed6h: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'completed' and coalesce((${codexCompletedAtExpr})::timestamptz, to_timestamp(0)) >= now() - interval '6 hours')::int`,
            completed24h: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'completed' and coalesce((${codexCompletedAtExpr})::timestamptz, to_timestamp(0)) >= now() - interval '24 hours')::int`,
            googleDriveCompleted24h: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${effectiveSourceExpr} = 'google_drive' and ${documents.status} = 'completed' and coalesce((${codexCompletedAtExpr})::timestamptz, to_timestamp(0)) >= now() - interval '24 hours')::int`,
            activeWorkers: sql<number>`count(distinct ${codexWorkerPoolSlotExpr}) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} in ('artifactizing', 'running', 'persisting'))::int`,
            activeWorkersChatgpt: sql<number>`count(distinct ${codexWorkerSlotExpr}) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} in ('artifactizing', 'running', 'persisting') and ${codexPoolExpr} = 'chatgpt')::int`,
            activeWorkersApiKey: sql<number>`count(distinct ${codexWorkerSlotExpr}) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} in ('artifactizing', 'running', 'persisting') and ${codexPoolExpr} = 'api_key')::int`,
            oldestQueuedAt: sql<string | null>`min(${documents.createdAt}) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::text`,
          })
          .from(documents),
        db
          .select({
            companyId: companies.id,
            companyName: companies.name,
            companySlug: companies.slug,
            companySettings: companies.settings,
            queued: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::int`,
            running: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} in ('artifactizing', 'running', 'persisting'))::int`,
            googleDriveQueued: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${effectiveSourceExpr} = 'google_drive' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::int`,
            googleDriveRunning: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${effectiveSourceExpr} = 'google_drive' and ${documents.status} = 'processing' and ${codexStageExpr} in ('artifactizing', 'running', 'persisting'))::int`,
            completed6h: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'completed' and coalesce((${codexCompletedAtExpr})::timestamptz, to_timestamp(0)) >= now() - interval '6 hours')::int`,
            completed24h: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'completed' and coalesce((${codexCompletedAtExpr})::timestamptz, to_timestamp(0)) >= now() - interval '24 hours')::int`,
            googleDriveCompleted24h: sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${effectiveSourceExpr} = 'google_drive' and ${documents.status} = 'completed' and coalesce((${codexCompletedAtExpr})::timestamptz, to_timestamp(0)) >= now() - interval '24 hours')::int`,
            oldestQueuedAt: sql<string | null>`min(${documents.createdAt}) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::text`,
            lastCompletedAt: sql<string | null>`max(coalesce((${codexCompletedAtExpr})::timestamptz, null)) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'completed')::text`,
          })
          .from(companies)
          .leftJoin(documents, eq(documents.companyId, companies.id))
          .groupBy(companies.id, companies.name, companies.slug, companies.settings)
          .having(sql`count(*) filter (where ${documents.source} = 'codex_upload') > 0`),
        db
          .select({
            pdf24h: sql<number>`count(*) filter (where ${documents.fileType} = 'pdf' and ${ingressDispatchStageExpr} is not null and ${documents.createdAt} >= now() - interval '24 hours')::int`,
            processing24h: sql<number>`count(*) filter (where ${documents.fileType} = 'pdf' and ${ingressDispatchStageExpr} is not null and ${documents.createdAt} >= now() - interval '24 hours' and ${documents.status} = 'processing')::int`,
            completed24h: sql<number>`count(*) filter (where ${documents.fileType} = 'pdf' and ${ingressDispatchStageExpr} is not null and ${documents.createdAt} >= now() - interval '24 hours' and ${documents.status} = 'completed')::int`,
            failed24h: sql<number>`count(*) filter (where ${documents.fileType} = 'pdf' and ${ingressDispatchStageExpr} is not null and ${documents.createdAt} >= now() - interval '24 hours' and ${documents.status} = 'failed')::int`,
            simplified24h: sql<number>`count(*) filter (where ${documents.fileType} = 'pdf' and ${ingressDispatchStageExpr} is not null and ${documents.createdAt} >= now() - interval '24 hours' and ${ingressDispatchStrategyExpr} = 'simplified_narrative')::int`,
            escalated24h: sql<number>`count(*) filter (where ${documents.fileType} = 'pdf' and ${ingressDispatchStageExpr} is not null and ${documents.createdAt} >= now() - interval '24 hours' and ${ingressDispatchTargetExpr} = 'codex_worker')::int`,
            escalatedFinance24h: sql<number>`count(*) filter (where ${documents.fileType} = 'pdf' and ${ingressDispatchStageExpr} is not null and ${documents.createdAt} >= now() - interval '24 hours' and ${ingressDispatchStrategyExpr} = 'codex_finance')::int`,
            escalatedOcr24h: sql<number>`count(*) filter (where ${documents.fileType} = 'pdf' and ${ingressDispatchStageExpr} is not null and ${documents.createdAt} >= now() - interval '24 hours' and ${ingressDispatchStrategyExpr} = 'codex_ocr')::int`,
            escalatedAmbiguous24h: sql<number>`count(*) filter (where ${documents.fileType} = 'pdf' and ${ingressDispatchStageExpr} is not null and ${documents.createdAt} >= now() - interval '24 hours' and ${ingressDispatchStrategyExpr} = 'codex_ambiguous')::int`,
            avgSimplifiedRoutingConfidence24h: sql<number | null>`avg((${ingressDispatchRoutingConfidenceExpr})::numeric) filter (where ${documents.fileType} = 'pdf' and ${ingressDispatchStageExpr} is not null and ${documents.createdAt} >= now() - interval '24 hours' and ${ingressDispatchStrategyExpr} = 'simplified_narrative')::float`,
            avgSimplifiedExtractionConfidence24h: sql<number | null>`avg((${ingressDispatchExtractionConfidenceExpr})::numeric) filter (where ${documents.fileType} = 'pdf' and ${ingressDispatchStageExpr} is not null and ${documents.createdAt} >= now() - interval '24 hours' and ${ingressDispatchStrategyExpr} = 'simplified_narrative')::float`,
          })
          .from(documents),
      ]),
      [
        [{ count: 0 }],
        [{ count: 0 }],
        [{
          queued: 0,
          running: 0,
          googleDriveQueued: 0,
          googleDriveRunning: 0,
          completed6h: 0,
          completed24h: 0,
          googleDriveCompleted24h: 0,
          activeWorkers: 0,
          activeWorkersChatgpt: 0,
          activeWorkersApiKey: 0,
          oldestQueuedAt: null,
        }],
        [],
        [{
          pdf24h: 0,
          processing24h: 0,
          completed24h: 0,
          failed24h: 0,
          simplified24h: 0,
          escalated24h: 0,
          escalatedFinance24h: 0,
          escalatedOcr24h: 0,
          escalatedAmbiguous24h: 0,
          avgSimplifiedRoutingConfidence24h: null,
          avgSimplifiedExtractionConfidence24h: null,
        }],
      ] as [
        Array<{ count: number }>,
        Array<{ count: number }>,
        Array<{
          queued: number;
          running: number;
          completed6h: number;
          completed24h: number;
          activeWorkers: number;
          activeWorkersChatgpt: number;
          activeWorkersApiKey: number;
          googleDriveQueued: number;
          googleDriveRunning: number;
          googleDriveCompleted24h: number;
          oldestQueuedAt: string | null;
        }>,
        Array<{
          companyId: string;
          companyName: string;
          companySlug: string | null;
          companySettings: Record<string, unknown> | null;
          queued: number;
          running: number;
          googleDriveQueued: number;
          googleDriveRunning: number;
          completed6h: number;
          completed24h: number;
          googleDriveCompleted24h: number;
          oldestQueuedAt: string | null;
          lastCompletedAt: string | null;
        }>,
        Array<{
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
        }>,
      ],
      degradedSections,
    );

    const [
      recentUsers,
      recentCompanies,
      recentDocuments,
    ] = await safeSection(
      "recent-entities",
      async () => Promise.all([
        db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            createdAt: users.createdAt,
          })
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(20),
        db
          .select({
            id: companies.id,
            name: companies.name,
            slug: companies.slug,
            createdAt: companies.createdAt,
            updatedAt: companies.updatedAt,
          })
          .from(companies)
          .orderBy(desc(companies.createdAt))
          .limit(20),
        db
          .select({
            id: documents.id,
            fileName: documents.fileName,
            source: documents.source,
            ocrResult: documents.ocrResult,
            status: documents.status,
            error: documents.error,
            createdAt: documents.createdAt,
            companyId: companies.id,
            companyName: companies.name,
            companySlug: companies.slug,
          })
          .from(documents)
          .innerJoin(companies, eq(companies.id, documents.companyId))
          .where(ne(documents.status, "deleted"))
          .orderBy(desc(documents.createdAt))
          .limit(30),
      ]),
      [[], [], []] as [
        Array<{ id: string; name: string | null; email: string; createdAt: Date }>,
        Array<{ id: string; name: string; slug: string | null; createdAt: Date; updatedAt: Date }>,
        Array<{
          id: string;
          fileName: string;
          source: string;
          ocrResult: Record<string, unknown> | null;
          status: string;
          error: string | null;
          createdAt: Date;
          companyId: string;
          companyName: string;
          companySlug: string | null;
        }>,
      ],
      degradedSections,
    );

    const [
      recentPdfCanaryDocuments,
      recentPdfDispatchFailures,
      recentConnections,
      recentActivity,
    ] = await safeSection(
      "recent-activity",
      async () => Promise.all([
      db
        .select({
          id: documents.id,
          fileName: documents.fileName,
          fileType: documents.fileType,
          source: documents.source,
          status: documents.status,
          error: documents.error,
          createdAt: documents.createdAt,
          companyId: companies.id,
          companyName: companies.name,
          companySlug: companies.slug,
          ocrResult: documents.ocrResult,
        })
        .from(documents)
        .innerJoin(companies, eq(companies.id, documents.companyId))
        .where(
          and(
            eq(documents.fileType, "pdf"),
            sql`${ingressDispatchStageExpr} is not null`,
            ne(documents.status, "deleted"),
            sql`${documents.createdAt} >= now() - interval '24 hours'`,
          ),
        )
        .orderBy(desc(documents.createdAt))
        .limit(200),
      db
        .select({
          id: auditLog.id,
          createdAt: auditLog.createdAt,
          companyName: companies.name,
          companySlug: companies.slug,
          fileName: sql<string | null>`nullif(${auditLog.newValue} ->> 'fileName', '')`,
          error: sql<string | null>`nullif(${auditLog.newValue} ->> 'error', '')`,
        })
        .from(auditLog)
        .innerJoin(companies, eq(companies.id, auditLog.companyId))
        .where(
          and(
            eq(auditLog.action, "document_ingress_dispatch_failed"),
            sql`${auditLog.createdAt} >= now() - interval '24 hours'`,
            sql`coalesce(${auditLog.newValue} ->> 'fileType', '') = 'pdf'`,
          ),
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(50),
      db
        .select({
          id: connections.id,
          provider: connections.provider,
          status: connections.status,
          lastSyncAt: connections.lastSyncAt,
          lastError: connections.lastError,
          errorCount: connections.errorCount,
          createdAt: connections.createdAt,
          updatedAt: connections.updatedAt,
          metadata: connections.metadata,
          companyId: companies.id,
          companyName: companies.name,
          companySlug: companies.slug,
        })
        .from(connections)
        .innerJoin(companies, eq(companies.id, connections.companyId))
        .orderBy(desc(connections.updatedAt))
        .limit(100),
      db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          entityType: auditLog.entityType,
          entityId: auditLog.entityId,
          createdAt: auditLog.createdAt,
          companyName: companies.name,
          companySlug: companies.slug,
          userName: users.name,
          userEmail: users.email,
        })
        .from(auditLog)
        .innerJoin(companies, eq(companies.id, auditLog.companyId))
        .leftJoin(users, eq(users.id, auditLog.userId))
        .orderBy(desc(auditLog.createdAt))
        .limit(30),
      ]),
      [[], [], [], []] as [
        Array<{
          id: string;
          fileName: string;
          fileType: string;
          source: string;
          status: string;
          error: string | null;
          createdAt: Date;
          companyId: string;
          companyName: string;
          companySlug: string | null;
          ocrResult: Record<string, unknown> | null;
        }>,
        Array<{
          id: string;
          createdAt: Date;
          companyName: string;
          companySlug: string | null;
          fileName: string | null;
          error: string | null;
        }>,
        Array<{
          id: string;
          provider: string;
          status: string;
          lastSyncAt: Date | null;
          lastError: string | null;
          errorCount: number;
          createdAt: Date;
          updatedAt: Date;
          metadata: Record<string, unknown> | null;
          companyId: string;
          companyName: string;
          companySlug: string | null;
        }>,
        Array<{
          id: string;
          action: string;
          entityType: string;
          entityId: string | null;
          createdAt: Date;
          companyName: string;
          companySlug: string | null;
          userName: string | null;
          userEmail: string | null;
        }>,
      ],
      degradedSections,
    );

    const [
      topEscalationReasonRows24h,
      topFailureErrorRows24h,
      topDispatchFailureErrorRows24h,
      shadowNarrativeSummaryRows24h,
      topShadowSkipReasonRows24h,
      topShadowFailureErrorRows24h,
      shadowComparisonRows24h,
      recentShadowMismatchRows24h,
    ] = await safeSection(
      "ingress-shadow-analytics",
      async () => Promise.all([
        db.execute<{ label: string | null; count: number | string | null }>(sql`
          select escalated.label, count(*)::int as count
          from (
            select distinct d.id, nullif(trim(reason.value), '') as label
            from documents d
            cross join lateral jsonb_array_elements_text(
              case
                when jsonb_typeof(d.ocr_result -> 'ingress_dispatch' -> 'reasons') = 'array'
                  then d.ocr_result -> 'ingress_dispatch' -> 'reasons'
                else '[]'::jsonb
              end
            ) as reason(value)
            where d.file_type = 'pdf'
              and d.status <> 'deleted'
              and d.created_at >= now() - interval '24 hours'
              and nullif(d.ocr_result -> 'ingress_dispatch' ->> 'stage', '') is not null
              and coalesce(d.ocr_result -> 'ingress_dispatch' ->> 'dispatch_target', '') = 'codex_worker'
          ) escalated
          where escalated.label is not null
          group by escalated.label
          order by count desc, escalated.label asc
          limit 5
        `),
        db.execute<{ label: string | null; count: number | string | null }>(sql`
          select failures.label, count(*)::int as count
          from (
            select coalesce(
              nullif(d.ocr_result -> 'ingress_dispatch' ->> 'error', ''),
              nullif(d.error, '')
            ) as label
            from documents d
            where d.file_type = 'pdf'
              and d.status <> 'deleted'
              and d.created_at >= now() - interval '24 hours'
              and nullif(d.ocr_result -> 'ingress_dispatch' ->> 'stage', '') is not null
              and (
                d.status = 'failed'
                or coalesce(d.ocr_result -> 'ingress_dispatch' ->> 'stage', '') = 'failed'
              )
          ) failures
          where nullif(trim(failures.label), '') is not null
          group by failures.label
          order by count desc, failures.label asc
          limit 5
        `),
        db.execute<{ label: string | null; count: number | string | null }>(sql`
          select nullif(trim(a.new_value ->> 'error'), '') as label, count(*)::int as count
          from audit_log a
          where a.action = 'document_ingress_dispatch_failed'
            and a.created_at >= now() - interval '24 hours'
            and coalesce(a.new_value ->> 'fileType', '') = 'pdf'
            and nullif(trim(a.new_value ->> 'error'), '') is not null
          group by label
          order by count desc, label asc
          limit 5
        `),
        db.execute<{
          observed: number | string | null;
          completed: number | string | null;
          skipped: number | string | null;
          failed: number | string | null;
        }>(sql`
          select
            count(*)::int as observed,
            count(*) filter (where a.action = 'document_simplified_narrative_shadow_completed')::int as completed,
            count(*) filter (where a.action = 'document_simplified_narrative_shadow_skipped')::int as skipped,
            count(*) filter (where a.action = 'document_simplified_narrative_shadow_failed')::int as failed
          from audit_log a
          where a.created_at >= now() - interval '24 hours'
            and a.action in (
              'document_simplified_narrative_shadow_completed',
              'document_simplified_narrative_shadow_skipped',
              'document_simplified_narrative_shadow_failed'
            )
            and coalesce(a.new_value ->> 'fileType', '') = 'pdf'
        `),
        db.execute<{ label: string | null; count: number | string | null }>(sql`
          select nullif(trim(a.new_value ->> 'reason'), '') as label, count(*)::int as count
          from audit_log a
          where a.created_at >= now() - interval '24 hours'
            and a.action = 'document_simplified_narrative_shadow_skipped'
            and coalesce(a.new_value ->> 'fileType', '') = 'pdf'
            and nullif(trim(a.new_value ->> 'reason'), '') is not null
          group by label
          order by count desc, label asc
          limit 5
        `),
        db.execute<{ label: string | null; count: number | string | null }>(sql`
          select nullif(trim(a.new_value ->> 'error'), '') as label, count(*)::int as count
          from audit_log a
          where a.created_at >= now() - interval '24 hours'
            and a.action = 'document_simplified_narrative_shadow_failed'
            and coalesce(a.new_value ->> 'fileType', '') = 'pdf'
            and nullif(trim(a.new_value ->> 'error'), '') is not null
          group by label
          order by count desc, label asc
          limit 5
        `),
        db.execute<{
          evaluated: number | string | null;
          unresolved: number | string | null;
          agree_simplified_safe: number | string | null;
          agree_hard_path_needed: number | string | null;
          potential_false_safe: number | string | null;
          potential_narrative_miss: number | string | null;
          shadow_failed: number | string | null;
        }>(sql`
          with latest_shadow as (
            select distinct on (a.entity_id)
              a.entity_id as document_id,
              a.action
            from audit_log a
            where a.created_at >= now() - interval '24 hours'
              and a.action in (
                'document_simplified_narrative_shadow_completed',
                'document_simplified_narrative_shadow_skipped',
                'document_simplified_narrative_shadow_failed'
              )
              and coalesce(a.new_value ->> 'fileType', '') = 'pdf'
              and a.entity_id is not null
            order by a.entity_id, a.created_at desc, a.id desc
          ),
          comparison as (
            select
              shadow.document_id,
              shadow.action,
              case
                when coalesce(d.ocr_result -> 'codex_promotion' ->> 'stage', '') <> 'completed' then 'unresolved'
                when exists (
                  select 1
                  from jsonb_array_elements_text(
                    case
                      when jsonb_typeof(d.ocr_result -> 'codex_promotion' -> 'promoted_domains') = 'array'
                        then d.ocr_result -> 'codex_promotion' -> 'promoted_domains'
                      else '[]'::jsonb
                    end
                  ) as domain(value)
                  where domain.value in ('finance', 'banking')
                ) then 'financial_like'
                when coalesce(d.ocr_result -> 'codex_promotion' -> 'classification' ->> 'document_kind', '') = 'financial' then 'financial_like'
                when coalesce(d.ocr_result -> 'codex_promotion' -> 'classification' ->> 'document_kind', '') = 'non_financial' then 'narrative_like'
                when jsonb_array_length(
                  case
                    when jsonb_typeof(d.ocr_result -> 'codex_promotion' -> 'promoted_domains') = 'array'
                      then d.ocr_result -> 'codex_promotion' -> 'promoted_domains'
                    else '[]'::jsonb
                  end
                ) > 0 then 'narrative_like'
                else 'unresolved'
              end as authoritative_bucket
            from latest_shadow shadow
            left join documents d on d.id::text = shadow.document_id::text
        )
        select
          count(*) filter (where authoritative_bucket <> 'unresolved' and action <> 'document_simplified_narrative_shadow_failed')::int as evaluated,
          count(*) filter (where authoritative_bucket = 'unresolved' and action <> 'document_simplified_narrative_shadow_failed')::int as unresolved,
          count(*) filter (where action = 'document_simplified_narrative_shadow_completed' and authoritative_bucket = 'narrative_like')::int as agree_simplified_safe,
          count(*) filter (where action = 'document_simplified_narrative_shadow_skipped' and authoritative_bucket = 'financial_like')::int as agree_hard_path_needed,
          count(*) filter (where action = 'document_simplified_narrative_shadow_completed' and authoritative_bucket = 'financial_like')::int as potential_false_safe,
          count(*) filter (where action = 'document_simplified_narrative_shadow_skipped' and authoritative_bucket = 'narrative_like')::int as potential_narrative_miss,
          count(*) filter (where action = 'document_simplified_narrative_shadow_failed')::int as shadow_failed
          from comparison
        `),
        db.execute<{
          document_id: string | null;
          file_name: string | null;
          company_name: string | null;
          company_slug: string | null;
          shadow_created_at: string | null;
          mismatch_type: string | null;
          shadow_action: string | null;
          shadow_reason: string | null;
          shadow_processing_strategy: string | null;
          authoritative_bucket: string | null;
          authoritative_document_kind: string | null;
          document_status: string | null;
        }>(sql`
          with latest_shadow as (
            select distinct on (a.entity_id)
              a.entity_id as document_id,
              a.created_at as shadow_created_at,
              a.action,
              nullif(trim(a.new_value ->> 'reason'), '') as shadow_reason,
              nullif(trim(a.new_value ->> 'processingStrategy'), '') as shadow_processing_strategy
            from audit_log a
            where a.created_at >= now() - interval '24 hours'
              and a.action in (
                'document_simplified_narrative_shadow_completed',
                'document_simplified_narrative_shadow_skipped',
                'document_simplified_narrative_shadow_failed'
              )
              and coalesce(a.new_value ->> 'fileType', '') = 'pdf'
              and a.entity_id is not null
            order by a.entity_id, a.created_at desc, a.id desc
          ),
          comparison as (
            select
              shadow.document_id,
              shadow.shadow_created_at,
              shadow.action as shadow_action,
              shadow.shadow_reason,
              shadow.shadow_processing_strategy,
              d.file_name,
              d.status as document_status,
              c.name as company_name,
              c.slug as company_slug,
              case
                when coalesce(d.ocr_result -> 'codex_promotion' ->> 'stage', '') <> 'completed' then 'unresolved'
                when exists (
                  select 1
                  from jsonb_array_elements_text(
                    case
                      when jsonb_typeof(d.ocr_result -> 'codex_promotion' -> 'promoted_domains') = 'array'
                        then d.ocr_result -> 'codex_promotion' -> 'promoted_domains'
                      else '[]'::jsonb
                    end
                  ) as domain(value)
                  where domain.value in ('finance', 'banking')
                ) then 'financial_like'
                when coalesce(d.ocr_result -> 'codex_promotion' -> 'classification' ->> 'document_kind', '') = 'financial' then 'financial_like'
                when coalesce(d.ocr_result -> 'codex_promotion' -> 'classification' ->> 'document_kind', '') = 'non_financial' then 'narrative_like'
                when jsonb_array_length(
                  case
                    when jsonb_typeof(d.ocr_result -> 'codex_promotion' -> 'promoted_domains') = 'array'
                      then d.ocr_result -> 'codex_promotion' -> 'promoted_domains'
                    else '[]'::jsonb
                  end
                ) > 0 then 'narrative_like'
                else 'unresolved'
              end as authoritative_bucket,
              nullif(d.ocr_result -> 'codex_promotion' -> 'classification' ->> 'document_kind', '') as authoritative_document_kind
            from latest_shadow shadow
            left join documents d on d.id::text = shadow.document_id::text
            left join companies c on c.id = d.company_id
          )
          select
            document_id,
            file_name,
            company_name,
            company_slug,
            shadow_created_at::text,
            case
              when shadow_action = 'document_simplified_narrative_shadow_completed' and authoritative_bucket = 'financial_like'
                then 'potential_false_safe'
              when shadow_action = 'document_simplified_narrative_shadow_skipped' and authoritative_bucket = 'narrative_like'
                then 'potential_narrative_miss'
              else null
            end as mismatch_type,
            shadow_action,
            shadow_reason,
            shadow_processing_strategy,
            authoritative_bucket,
            authoritative_document_kind,
            document_status
          from comparison
          where (
            shadow_action = 'document_simplified_narrative_shadow_completed'
            and authoritative_bucket = 'financial_like'
          ) or (
            shadow_action = 'document_simplified_narrative_shadow_skipped'
            and authoritative_bucket = 'narrative_like'
          )
          order by shadow_created_at desc nulls last, document_id asc
          limit 12
        `),
      ]),
      [[], [], [], [], [], [], [], []] as [
        Array<{ label: string | null; count: number | string | null }>,
        Array<{ label: string | null; count: number | string | null }>,
        Array<{ label: string | null; count: number | string | null }>,
        Array<{
          observed: number | string | null;
          completed: number | string | null;
          skipped: number | string | null;
          failed: number | string | null;
        }>,
        Array<{ label: string | null; count: number | string | null }>,
        Array<{ label: string | null; count: number | string | null }>,
        Array<{
          evaluated: number | string | null;
          unresolved: number | string | null;
          agree_simplified_safe: number | string | null;
          agree_hard_path_needed: number | string | null;
          potential_false_safe: number | string | null;
          potential_narrative_miss: number | string | null;
          shadow_failed: number | string | null;
        }>,
        Array<{
          document_id: string | null;
          file_name: string | null;
          company_name: string | null;
          company_slug: string | null;
          shadow_created_at: string | null;
          mismatch_type: string | null;
          shadow_action: string | null;
          shadow_reason: string | null;
          shadow_processing_strategy: string | null;
          authoritative_bucket: string | null;
          authoritative_document_kind: string | null;
          document_status: string | null;
        }>,
      ],
      degradedSections,
    );

    const recentUserIds = recentUsers.map((user) => user.id);
    const recentCompanyIds = recentCompanies.map((company) => company.id);

    const [
      userMembershipCounts,
      userThreadCounts,
      companyMemberCounts,
      companyConnectionCounts,
      companyDocumentStats,
      processingStuckByCompany,
    ] = await safeSection(
      "recent-entity-rollups",
      async () => Promise.all([
      recentUserIds.length
        ? db
            .select({
              userId: companyMembers.userId,
              count: sql<number>`count(*)::int`,
            })
            .from(companyMembers)
            .where(inArray(companyMembers.userId, recentUserIds))
            .groupBy(companyMembers.userId)
        : Promise.resolve([]),
      recentUserIds.length
        ? db
            .select({
              userId: chatThreads.userId,
              count: sql<number>`count(*)::int`,
            })
            .from(chatThreads)
            .where(inArray(chatThreads.userId, recentUserIds))
            .groupBy(chatThreads.userId)
        : Promise.resolve([]),
      recentCompanyIds.length
        ? db
            .select({
              companyId: companyMembers.companyId,
              count: sql<number>`count(*)::int`,
            })
            .from(companyMembers)
            .where(inArray(companyMembers.companyId, recentCompanyIds))
            .groupBy(companyMembers.companyId)
        : Promise.resolve([]),
      recentCompanyIds.length
        ? db
            .select({
              companyId: connections.companyId,
              count: sql<number>`count(*)::int`,
            })
            .from(connections)
            .where(inArray(connections.companyId, recentCompanyIds))
            .groupBy(connections.companyId)
        : Promise.resolve([]),
      recentCompanyIds.length
        ? db
            .select({
              companyId: documents.companyId,
              total: sql<number>`count(*)::int`,
              processing: sql<number>`count(*) filter (where ${documents.status} = 'processing')::int`,
              failed: sql<number>`count(*) filter (where ${documents.status} = 'failed')::int`,
              completed: sql<number>`count(*) filter (where ${documents.status} = 'completed')::int`,
              lastDocumentAt: sql<string | null>`max(${documents.createdAt})::text`,
            })
            .from(documents)
            .where(inArray(documents.companyId, recentCompanyIds))
            .groupBy(documents.companyId)
        : Promise.resolve([]),
      recentCompanyIds.length
        ? db
            .select({
              companyId: documents.companyId,
              count: sql<number>`count(*)::int`,
            })
            .from(documents)
            .where(
              and(
                inArray(documents.companyId, recentCompanyIds),
                eq(documents.status, "processing"),
                sql`${documents.createdAt} < now() - interval '30 minutes'`
              )
            )
            .groupBy(documents.companyId)
        : Promise.resolve([]),
      ]),
      [[], [], [], [], [], []] as [
        Array<{ userId: string; count: number }>,
        Array<{ userId: string; count: number }>,
        Array<{ companyId: string; count: number }>,
        Array<{ companyId: string; count: number }>,
        Array<{
          companyId: string;
          total: number;
          processing: number;
          failed: number;
          completed: number;
          lastDocumentAt: string | null;
        }>,
        Array<{ companyId: string; count: number }>,
      ],
      degradedSections,
    );

    const [
      corpusChatUsageRows24h,
      corpusChatTopUsers24h,
      corpusChatByModel24h,
      reportConfigUsageRows24h,
      reportConfigTopCompanies24h,
      postCodexDocumentRows24h,
    ] = await safeSection(
      "llm-observability",
      async () => Promise.all([
        db.execute<{
          total_runs: number | string | null;
          completed_runs: number | string | null;
          failed_runs: number | string | null;
          unique_users: number | string | null;
          unique_companies: number | string | null;
          input_tokens: number | string | null;
          output_tokens: number | string | null;
          total_tokens: number | string | null;
          estimated_cost_usd: number | string | null;
        }>(sql`
          select
            count(*)::int as total_runs,
            count(*) filter (where ${chatRuns.status} = 'completed')::int as completed_runs,
            count(*) filter (where ${chatRuns.status} = 'failed')::int as failed_runs,
            count(distinct ${chatThreads.userId})::int as unique_users,
            count(distinct ${chatRuns.companyId})::int as unique_companies,
            coalesce(sum(coalesce((${chatRuns.metadata} -> 'usage' ->> 'inputTokens')::bigint, 0)), 0)::bigint as input_tokens,
            coalesce(sum(coalesce((${chatRuns.metadata} -> 'usage' ->> 'outputTokens')::bigint, 0)), 0)::bigint as output_tokens,
            coalesce(sum(coalesce((${chatRuns.metadata} -> 'usage' ->> 'totalTokens')::bigint, 0)), 0)::bigint as total_tokens,
            coalesce(sum(coalesce((${chatRuns.metadata} ->> 'estimatedCostUsd')::numeric, 0)), 0)::float as estimated_cost_usd
          from ${chatRuns}
          inner join ${chatThreads} on ${chatThreads.id} = ${chatRuns.threadId}
          where ${chatRuns.createdAt} >= now() - interval '24 hours'
        `),
        db.execute<{
          user_id: string | null;
          name: string | null;
          email: string | null;
          run_count: number | string | null;
          company_count: number | string | null;
          total_tokens: number | string | null;
          estimated_cost_usd: number | string | null;
          last_run_at: string | null;
        }>(sql`
          select
            ${chatThreads.userId} as user_id,
            ${users.name} as name,
            ${users.email} as email,
            count(*)::int as run_count,
            count(distinct ${chatRuns.companyId})::int as company_count,
            coalesce(sum(coalesce((${chatRuns.metadata} -> 'usage' ->> 'totalTokens')::bigint, 0)), 0)::bigint as total_tokens,
            coalesce(sum(coalesce((${chatRuns.metadata} ->> 'estimatedCostUsd')::numeric, 0)), 0)::float as estimated_cost_usd,
            max(${chatRuns.createdAt})::text as last_run_at
          from ${chatRuns}
          inner join ${chatThreads} on ${chatThreads.id} = ${chatRuns.threadId}
          inner join ${users} on ${users.id} = ${chatThreads.userId}
          where ${chatRuns.createdAt} >= now() - interval '24 hours'
          group by ${chatThreads.userId}, ${users.name}, ${users.email}
          order by total_tokens desc, run_count desc, email asc
          limit 12
        `),
        db.execute<{
          provider: string | null;
          model: string | null;
          run_count: number | string | null;
          total_tokens: number | string | null;
          estimated_cost_usd: number | string | null;
        }>(sql`
          select
            ${chatRuns.provider} as provider,
            ${chatRuns.model} as model,
            count(*)::int as run_count,
            coalesce(sum(coalesce((${chatRuns.metadata} -> 'usage' ->> 'totalTokens')::bigint, 0)), 0)::bigint as total_tokens,
            coalesce(sum(coalesce((${chatRuns.metadata} ->> 'estimatedCostUsd')::numeric, 0)), 0)::float as estimated_cost_usd
          from ${chatRuns}
          where ${chatRuns.createdAt} >= now() - interval '24 hours'
          group by ${chatRuns.provider}, ${chatRuns.model}
          order by total_tokens desc, run_count desc, model asc nulls last
          limit 12
        `),
        db.execute<{
          new_configs: number | string | null;
          active_companies: number | string | null;
          total_usage_count: number | string | null;
        }>(sql`
          select
            count(*)::int as new_configs,
            count(distinct ${reportConfigs.companyId})::int as active_companies,
            coalesce(sum(${reportConfigs.usageCount}), 0)::int as total_usage_count
          from ${reportConfigs}
          where ${reportConfigs.createdAt} >= now() - interval '24 hours'
        `),
        db.execute<{
          company_id: string | null;
          company_name: string | null;
          config_count: number | string | null;
        }>(sql`
          select
            ${companies.id} as company_id,
            ${companies.name} as company_name,
            count(*)::int as config_count
          from ${reportConfigs}
          inner join ${companies} on ${companies.id} = ${reportConfigs.companyId}
          where ${reportConfigs.createdAt} >= now() - interval '24 hours'
          group by ${companies.id}, ${companies.name}
          order by config_count desc, company_name asc
          limit 8
        `),
        db.execute<{
          total: number | string | null;
          completed: number | string | null;
          failed: number | string | null;
          needs_review: number | string | null;
          extracted_txns: number | string | null;
        }>(sql`
          select
            count(*)::int as total,
            count(*) filter (where ${documents.status} = 'completed')::int as completed,
            count(*) filter (where ${documents.status} = 'failed')::int as failed,
            count(*) filter (
              where coalesce((${documents.ocrResult} -> 'clarification' ->> 'requires_review')::boolean, false)
                 or coalesce((${documents.ocrResult} -> 'review' ->> 'requires_review')::boolean, false)
            )::int as needs_review,
            coalesce(sum(coalesce(${documents.extractedTxnCount}, 0)), 0)::int as extracted_txns
          from ${documents}
          where ${documents.createdAt} >= now() - interval '24 hours'
            and ${documents.source} = 'codex_upload'
            and ${documents.status} <> 'deleted'
        `),
      ]),
      [
        [{
          total_runs: 0,
          completed_runs: 0,
          failed_runs: 0,
          unique_users: 0,
          unique_companies: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
        }],
        [],
        [],
        [{
          new_configs: 0,
          active_companies: 0,
          total_usage_count: 0,
        }],
        [],
        [{
          total: 0,
          completed: 0,
          failed: 0,
          needs_review: 0,
          extracted_txns: 0,
        }],
      ] as [
        Array<{
          total_runs: number | string | null;
          completed_runs: number | string | null;
          failed_runs: number | string | null;
          unique_users: number | string | null;
          unique_companies: number | string | null;
          input_tokens: number | string | null;
          output_tokens: number | string | null;
          total_tokens: number | string | null;
          estimated_cost_usd: number | string | null;
        }>,
        Array<{
          user_id: string | null;
          name: string | null;
          email: string | null;
          run_count: number | string | null;
          company_count: number | string | null;
          total_tokens: number | string | null;
          estimated_cost_usd: number | string | null;
          last_run_at: string | null;
        }>,
        Array<{
          provider: string | null;
          model: string | null;
          run_count: number | string | null;
          total_tokens: number | string | null;
          estimated_cost_usd: number | string | null;
        }>,
        Array<{
          new_configs: number | string | null;
          active_companies: number | string | null;
          total_usage_count: number | string | null;
        }>,
        Array<{
          company_id: string | null;
          company_name: string | null;
          config_count: number | string | null;
        }>,
        Array<{
          total: number | string | null;
          completed: number | string | null;
          failed: number | string | null;
          needs_review: number | string | null;
          extracted_txns: number | string | null;
        }>,
      ],
      degradedSections,
    );

    const trackedLlmObservability = await safeSection(
      "tracked-llm-usage-events",
      async () => getLlmObservabilityOverview(db),
      {
        trackedUsageBySubsystem24h: [],
        topCompanies24h: [],
        topUsers24h: [],
        topSystemActors24h: [],
        topReferences24h: [],
        recentEvents24h: [],
        communicationsProxy24h: [],
      },
      degradedSections,
    );

    const adminUserActivity = await safeSection(
      "admin-user-activity",
      async () => getAdminUserActivityOverview(db),
      {
        users: [],
        recentActions24h: [],
      },
      degradedSections,
    );

    const processKeyExposure = await safeSection(
      "runtime-process-key-exposure",
      async () => getRuntimeProcessKeyExposure(),
      {
        available: false,
        groups: [],
        anthropicProcessCount: 0,
        openAiProcessCount: 0,
        codexProcessCount: 0,
      },
      degradedSections,
    );

    const docStatus = Object.fromEntries(docStatusRows.map((row) => [row.status, row.count]));
    const stagingStatus = Object.fromEntries(stagingRows.map((row) => [row.status, row.count]));
    const chatRunStatus = Object.fromEntries(chatRunRows.map((row) => [row.status, row.count]));
    const signalStatus = Object.fromEntries(signalRows.map((row) => [row.status, row.count]));
    const communicationStatus = Object.fromEntries(commRows.map((row) => [row.status, row.count]));

    const userMembershipMap = new Map(userMembershipCounts.map((row) => [row.userId, row.count]));
    const userThreadMap = new Map(userThreadCounts.map((row) => [row.userId, row.count]));
    const companyMemberMap = new Map(companyMemberCounts.map((row) => [row.companyId, row.count]));
    const companyConnectionMap = new Map(companyConnectionCounts.map((row) => [row.companyId, row.count]));
    const companyDocumentMap = new Map(companyDocumentStats.map((row) => [row.companyId, row]));
    const companyStuckMap = new Map(processingStuckByCompany.map((row) => [row.companyId, row.count]));
    const codexTotals = codexQueueTotals[0] ?? {
      queued: 0,
      running: 0,
      completed6h: 0,
      completed24h: 0,
      activeWorkers: 0,
      activeWorkersChatgpt: 0,
      activeWorkersApiKey: 0,
      oldestQueuedAt: null,
    };
    const ingressDispatchSummary = ingressDispatchTotals[0] ?? {
      pdf24h: 0,
      processing24h: 0,
      completed24h: 0,
      failed24h: 0,
      simplified24h: 0,
      escalated24h: 0,
      escalatedFinance24h: 0,
      escalatedOcr24h: 0,
      escalatedAmbiguous24h: 0,
      avgSimplifiedRoutingConfidence24h: null,
      avgSimplifiedExtractionConfidence24h: null,
    };
    const codexRatePerHour = computeCodexRatePerHour(
      codexTotals.completed6h ?? 0,
      codexTotals.completed24h ?? 0,
    );
    const topEscalationReasons24h = coerceCountedLabels(topEscalationReasonRows24h);
    const topFailureErrors24h = coerceCountedLabels(topFailureErrorRows24h);
    const topDispatchFailureErrors24h = coerceCountedLabels(topDispatchFailureErrorRows24h);
    const shadowNarrativeSummary = shadowNarrativeSummaryRows24h[0] ?? {
      observed: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
    };
    const shadowComparisonSummary = shadowComparisonRows24h[0] ?? {
      evaluated: 0,
      unresolved: 0,
      agree_simplified_safe: 0,
      agree_hard_path_needed: 0,
      potential_false_safe: 0,
      potential_narrative_miss: 0,
      shadow_failed: 0,
    };
    const topShadowSkipReasons24h = coerceCountedLabels(topShadowSkipReasonRows24h);
    const topShadowFailureErrors24h = coerceCountedLabels(topShadowFailureErrorRows24h);
    const corpusChatUsage24h = corpusChatUsageRows24h[0] ?? {
      total_runs: 0,
      completed_runs: 0,
      failed_runs: 0,
      unique_users: 0,
      unique_companies: 0,
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
    };
    const reportConfigUsage24h = reportConfigUsageRows24h[0] ?? {
      new_configs: 0,
      active_companies: 0,
      total_usage_count: 0,
    };
    const postCodexDocumentFlow24h = postCodexDocumentRows24h[0] ?? {
      total: 0,
      completed: 0,
      failed: 0,
      needs_review: 0,
      extracted_txns: 0,
    };
    const runtimeDiagnostics = getPlatformAdminDiagnostics();
    const trackedSubsystemUsage = summarizeTrackedSubsystemUsage(
      trackedLlmObservability.trackedUsageBySubsystem24h,
    );
    const trackedChatUsage = trackedSubsystemUsage.get("chat_consultant") ?? {
      subsystem: "chat_consultant",
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    };
    const trackedReportConfigUsage = trackedSubsystemUsage.get("report_config_generation") ?? {
      subsystem: "report_config_generation",
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    };
    const trackedCommunicationsUsage = trackedSubsystemUsage.get("communications_synthesis") ?? {
      subsystem: "communications_synthesis",
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    };
    const trackedCategorizationUsage = trackedSubsystemUsage.get("transaction_categorization") ?? {
      subsystem: "transaction_categorization",
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    };
    const repeatedReportConfigInitialLoops24h = trackedLlmObservability.topReferences24h
      .filter(
        (entry) =>
          entry.subsystem === "report_config_generation" &&
          entry.operation === "initial_generation" &&
          entry.runCount > 1,
      )
      .slice(0, 20);

    const codexQueueEtaRows = [...codexQueueByCompany]
      .filter((row) => (row.queued ?? 0) > 0)
      .sort((left, right) => {
        const leftTime = left.oldestQueuedAt ? new Date(left.oldestQueuedAt).getTime() : Number.POSITIVE_INFINITY;
        const rightTime = right.oldestQueuedAt ? new Date(right.oldestQueuedAt).getTime() : Number.POSITIVE_INFINITY;
        if (leftTime !== rightTime) return leftTime - rightTime;
        return (left.companyName ?? "").localeCompare(right.companyName ?? "");
      });

    let queuedAhead = 0;
    const codexEtaMap = new Map<string, number | null>();
    for (const row of codexQueueEtaRows) {
      const companyEta =
        codexRatePerHour && codexRatePerHour > 0
          ? roundMetric((queuedAhead + (row.queued ?? 0) + (row.running ?? 0)) / codexRatePerHour)
          : null;
      codexEtaMap.set(row.companyId, companyEta);
      queuedAhead += row.queued ?? 0;
    }

    const codexQueueByCompanyView = [...codexQueueByCompany]
      .filter((row) => (row.queued ?? 0) > 0 || (row.running ?? 0) > 0 || (row.completed24h ?? 0) > 0)
      .map((row) => ({
        companyId: row.companyId,
        companyName: row.companyName,
        companySlug: row.companySlug,
        targetPool: getCodexWorkerPoolFromCompanySettings(
          (row.companySettings as Record<string, unknown> | null | undefined) ?? undefined,
        ),
        queued: row.queued ?? 0,
        running: row.running ?? 0,
        byOrigin: {
          googleDrive: {
            queued: row.googleDriveQueued ?? 0,
            running: row.googleDriveRunning ?? 0,
            completed24h: row.googleDriveCompleted24h ?? 0,
          },
        },
        completed24h: row.completed24h ?? 0,
        completed6h: row.completed6h ?? 0,
        oldestQueuedAt: row.oldestQueuedAt ?? null,
        lastCompletedAt: row.lastCompletedAt ?? null,
        approxEtaHours:
          row.queued && row.queued > 0
            ? (codexEtaMap.get(row.companyId) ?? null)
            : row.running && row.running > 0
              ? 0
              : null,
      }))
      .sort((left, right) => {
        if (right.queued !== left.queued) return right.queued - left.queued;
        if (right.running !== left.running) return right.running - left.running;
        const leftTime = left.oldestQueuedAt ? new Date(left.oldestQueuedAt).getTime() : Number.POSITIVE_INFINITY;
        const rightTime = right.oldestQueuedAt ? new Date(right.oldestQueuedAt).getTime() : Number.POSITIVE_INFINITY;
        return leftTime - rightTime;
      });

    const recentConnectionView = recentConnections
      .map((connection) => {
        const freshness = describeConnectionSyncFreshness({
          provider: connection.provider,
          lastSyncAt: connection.lastSyncAt,
          createdAt: connection.createdAt,
          expectedIntervalMs: resolveRecentConnectionExpectedInterval(
            connection.provider,
            connection.metadata,
          ),
        });

        return {
          id: connection.id,
          provider: connection.provider,
          status: connection.status,
          lastSyncAt: connection.lastSyncAt,
          lastError: connection.lastError,
          errorCount: connection.errorCount,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
          companyId: connection.companyId,
          companyName: connection.companyName,
          companySlug: connection.companySlug,
          syncFreshness: freshness.state,
          syncFreshnessLabel: freshness.message,
          expectedSyncIntervalLabel: freshness.expectedIntervalLabel,
        };
      })
      .sort((left, right) => {
        const rankDelta =
          getRecentConnectionAttentionRank(left) - getRecentConnectionAttentionRank(right);
        if (rankDelta !== 0) return rankDelta;
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      })
      .slice(0, 30);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      actor: {
        email: session.user.email,
        name: session.user.name,
      },
      summary: {
        users: totalUsers[0]?.count ?? 0,
        companies: totalCompanies[0]?.count ?? 0,
        memberships: totalMembers[0]?.count ?? 0,
        runtimeDiagnostics: {
          platformAdminEnvConfiguredCount: runtimeDiagnostics.envConfiguredCount,
          platformAdminFallbackActive: runtimeDiagnostics.usesFallback,
          platformAdminEffectiveCount: runtimeDiagnostics.effectiveCount,
          anthropicApiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
          codexOpenAiKeyConfigured: Boolean(
            process.env.CODEX_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(),
          ),
          codexAuth,
          processKeyExposure,
        },
        degradedSections,
        connections: totalConnections[0]?.count ?? 0,
        activeConnections: activeConnections[0]?.count ?? 0,
        connectionErrors: connectionErrorCount[0]?.count ?? 0,
        documents: {
          processing: docStatus.processing ?? 0,
          failed: docStatus.failed ?? 0,
          completed: docStatus.completed ?? 0,
          deleted: docStatus.deleted ?? 0,
          stuckProcessing: stuckProcessingCount[0]?.count ?? 0,
        },
        staging: {
          pending: stagingStatus.pending ?? 0,
          processing: stagingStatus.processing ?? 0,
          failed: stagingStatus.failed ?? 0,
          committed: stagingStatus.committed ?? 0,
        },
        chatRuns: {
          queued: chatRunStatus.queued ?? 0,
          running: chatRunStatus.running ?? 0,
          failed: chatRunStatus.failed ?? 0,
          completed: chatRunStatus.completed ?? 0,
        },
        corpusChatUsage24h: {
          totalRuns: toCount(corpusChatUsage24h.total_runs),
          completedRuns: toCount(corpusChatUsage24h.completed_runs),
          failedRuns: toCount(corpusChatUsage24h.failed_runs),
          uniqueUsers: toCount(corpusChatUsage24h.unique_users),
          uniqueCompanies: toCount(corpusChatUsage24h.unique_companies),
          inputTokens: toCount(corpusChatUsage24h.input_tokens),
          outputTokens: toCount(corpusChatUsage24h.output_tokens),
          totalTokens: toCount(corpusChatUsage24h.total_tokens),
          estimatedCostUsd: roundCurrencyMetric(Number(corpusChatUsage24h.estimated_cost_usd ?? 0)),
        },
        anthropicAttribution: {
          anthropicApiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
          trackedChat24h: {
            totalRuns: trackedChatUsage.runCount || toCount(corpusChatUsage24h.total_runs),
            inputTokens: trackedChatUsage.inputTokens || toCount(corpusChatUsage24h.input_tokens),
            outputTokens: trackedChatUsage.outputTokens || toCount(corpusChatUsage24h.output_tokens),
            totalTokens:
              (trackedChatUsage.inputTokens + trackedChatUsage.outputTokens) ||
              toCount(corpusChatUsage24h.total_tokens),
            estimatedCostUsd:
              roundCurrencyMetric(
                trackedChatUsage.estimatedCostUsd || Number(corpusChatUsage24h.estimated_cost_usd ?? 0),
              ),
          },
          structuredReportConfig24h: {
            newConfigs: toCount(reportConfigUsage24h.new_configs),
            activeCompanies: toCount(reportConfigUsage24h.active_companies),
            totalUsageCount: toCount(reportConfigUsage24h.total_usage_count),
            trackedRuns: trackedReportConfigUsage.runCount,
            trackedInputTokens: trackedReportConfigUsage.inputTokens,
            trackedOutputTokens: trackedReportConfigUsage.outputTokens,
            trackedEstimatedCostUsd: roundCurrencyMetric(trackedReportConfigUsage.estimatedCostUsd),
            topCompanies: reportConfigTopCompanies24h.map((row) => ({
              companyId: row.company_id ?? "unknown",
              companyName: row.company_name ?? "Unknown company",
              configCount: toCount(row.config_count),
            })),
          },
          postCodexDocumentFlow24h: {
            total: toCount(postCodexDocumentFlow24h.total),
            completed: toCount(postCodexDocumentFlow24h.completed),
            failed: toCount(postCodexDocumentFlow24h.failed),
            needsReview: toCount(postCodexDocumentFlow24h.needs_review),
            extractedTransactions: toCount(postCodexDocumentFlow24h.extracted_txns),
            anthropicInPath: false,
            path: "codex_promotion+reconciliation",
          },
          trackedUsageBySubsystem24h: trackedLlmObservability.trackedUsageBySubsystem24h,
          topTrackedCompanies24h: trackedLlmObservability.topCompanies24h,
          topTrackedUsers24h: trackedLlmObservability.topUsers24h,
          topSystemActors24h: trackedLlmObservability.topSystemActors24h,
          topTrackedReferences24h: trackedLlmObservability.topReferences24h,
          repeatedReportConfigInitialLoops24h,
          recentTrackedEvents24h: trackedLlmObservability.recentEvents24h,
          communicationsSynthesis24h: {
            trackedRuns: trackedCommunicationsUsage.runCount,
            trackedInputTokens: trackedCommunicationsUsage.inputTokens,
            trackedOutputTokens: trackedCommunicationsUsage.outputTokens,
            trackedEstimatedCostUsd: roundCurrencyMetric(trackedCommunicationsUsage.estimatedCostUsd),
            proxyCompanies: trackedLlmObservability.communicationsProxy24h,
          },
          transactionCategorization24h: {
            trackedRuns: trackedCategorizationUsage.runCount,
            trackedInputTokens: trackedCategorizationUsage.inputTokens,
            trackedOutputTokens: trackedCategorizationUsage.outputTokens,
            trackedEstimatedCostUsd: roundCurrencyMetric(trackedCategorizationUsage.estimatedCostUsd),
          },
          capablePaths: [
            {
              subsystem: "chat_consultant",
              label: "Corpus chat",
              codePath: "app/api/chat/route.ts",
              tracked: true,
              runCount24h: trackedChatUsage.runCount,
              estimatedCostUsd24h: roundCurrencyMetric(trackedChatUsage.estimatedCostUsd),
            },
            {
              subsystem: "report_config_generation",
              label: "Structured report config generation",
              codePath: "lib/document-parsers/report-parser.ts",
              tracked: true,
              runCount24h: trackedReportConfigUsage.runCount,
              estimatedCostUsd24h: roundCurrencyMetric(trackedReportConfigUsage.estimatedCostUsd),
            },
            {
              subsystem: "communications_synthesis",
              label: "Communications synthesis",
              codePath: "lib/communications/process-pending.ts",
              tracked: true,
              runCount24h: trackedCommunicationsUsage.runCount,
              estimatedCostUsd24h: roundCurrencyMetric(trackedCommunicationsUsage.estimatedCostUsd),
            },
            {
              subsystem: "transaction_categorization",
              label: "Transaction categorization fallback",
              codePath: "lib/categorization/claude-engine.ts",
              tracked: true,
              runCount24h: trackedCategorizationUsage.runCount,
              estimatedCostUsd24h: roundCurrencyMetric(trackedCategorizationUsage.estimatedCostUsd),
            },
          ],
          untrackedPotentialConsumers: {
            communicationsSynthesis: false,
            transactionCategorization: false,
          },
        },
        communications: {
          pending: communicationStatus.pending ?? 0,
          processed: communicationStatus.processed ?? 0,
          failed: communicationStatus.failed ?? 0,
        },
        signals: {
          pending: signalStatus.pending ?? 0,
          approved: signalStatus.approved ?? 0,
          rejected: signalStatus.rejected ?? 0,
        },
        codexQueue: {
          defaultPool: defaultCodexPool,
          configuredWorkers: configuredCodexWorkersChatgptEffective + configuredCodexWorkersApiKey,
          configuredWorkersChatgpt: configuredCodexWorkersChatgptEffective,
          configuredWorkersApiKey: configuredCodexWorkersApiKey,
          activeWorkers: codexTotals.activeWorkers ?? 0,
          activeWorkersChatgpt: codexTotals.activeWorkersChatgpt ?? 0,
          activeWorkersApiKey: codexTotals.activeWorkersApiKey ?? 0,
          queued: codexTotals.queued ?? 0,
          running: codexTotals.running ?? 0,
          byOrigin: {
            googleDrive: {
              queued: codexTotals.googleDriveQueued ?? 0,
              running: codexTotals.googleDriveRunning ?? 0,
              completed24h: codexTotals.googleDriveCompleted24h ?? 0,
            },
          },
          completed6h: codexTotals.completed6h ?? 0,
          completed24h: codexTotals.completed24h ?? 0,
          throughputPerHour: roundMetric(codexRatePerHour),
          approxEtaHours:
            codexRatePerHour && codexRatePerHour > 0
              ? roundMetric((codexTotals.queued ?? 0) / codexRatePerHour)
              : null,
          oldestQueuedAt: codexTotals.oldestQueuedAt ?? null,
        },
        ingressDispatch: {
          pdfCanaryEnabled,
          configuredCanaryCompanyCount,
          pdf24h: ingressDispatchSummary.pdf24h ?? 0,
          processing24h: ingressDispatchSummary.processing24h ?? 0,
          completed24h: ingressDispatchSummary.completed24h ?? 0,
          failed24h: ingressDispatchSummary.failed24h ?? 0,
          simplified24h: ingressDispatchSummary.simplified24h ?? 0,
          escalated24h: ingressDispatchSummary.escalated24h ?? 0,
          escalatedFinance24h: ingressDispatchSummary.escalatedFinance24h ?? 0,
          escalatedOcr24h: ingressDispatchSummary.escalatedOcr24h ?? 0,
          escalatedAmbiguous24h: ingressDispatchSummary.escalatedAmbiguous24h ?? 0,
          avgSimplifiedRoutingConfidence24h: roundMetric(
            ingressDispatchSummary.avgSimplifiedRoutingConfidence24h ?? null,
          ),
          avgSimplifiedExtractionConfidence24h: roundMetric(
            ingressDispatchSummary.avgSimplifiedExtractionConfidence24h ?? null,
          ),
          topEscalationReasons24h,
          topFailureErrors24h,
          topDispatchFailureErrors24h,
          shadowNarrative24h: {
            enabled: shadowNarrativeEnabled,
            observed: Number(shadowNarrativeSummary.observed ?? 0),
            completed: Number(shadowNarrativeSummary.completed ?? 0),
            skipped: Number(shadowNarrativeSummary.skipped ?? 0),
            failed: Number(shadowNarrativeSummary.failed ?? 0),
            topSkipReasons: topShadowSkipReasons24h,
            topFailureErrors: topShadowFailureErrors24h,
            comparison: {
              evaluated: Number(shadowComparisonSummary.evaluated ?? 0),
              unresolved: Number(shadowComparisonSummary.unresolved ?? 0),
              agreeSimplifiedSafe: Number(shadowComparisonSummary.agree_simplified_safe ?? 0),
              agreeHardPathNeeded: Number(shadowComparisonSummary.agree_hard_path_needed ?? 0),
              potentialFalseSafe: Number(shadowComparisonSummary.potential_false_safe ?? 0),
              potentialNarrativeMiss: Number(shadowComparisonSummary.potential_narrative_miss ?? 0),
              shadowFailed: Number(shadowComparisonSummary.shadow_failed ?? 0),
            },
          },
        },
      },
      corpusChatTopUsers24h: corpusChatTopUsers24h.map((row) => ({
        userId: row.user_id ?? "unknown",
        name: row.name ?? "Unknown user",
        email: row.email ?? "unknown@example.com",
        runCount: toCount(row.run_count),
        companyCount: toCount(row.company_count),
        totalTokens: toCount(row.total_tokens),
        estimatedCostUsd: roundCurrencyMetric(Number(row.estimated_cost_usd ?? 0)) ?? 0,
        lastRunAt: row.last_run_at ?? null,
      })),
      corpusChatByModel24h: corpusChatByModel24h.map((row) => ({
        provider: row.provider ?? "unknown",
        model: row.model ?? "unknown",
        runCount: toCount(row.run_count),
        totalTokens: toCount(row.total_tokens),
        estimatedCostUsd: roundCurrencyMetric(Number(row.estimated_cost_usd ?? 0)) ?? 0,
      })),
      corpusUsers: adminUserActivity.users,
      corpusRecentUserActions24h: adminUserActivity.recentActions24h,
      codexQueueByCompany: codexQueueByCompanyView,
      recentUsers: recentUsers.map((user) => ({
        ...user,
        companyCount: userMembershipMap.get(user.id) ?? 0,
        chatThreadCount: userThreadMap.get(user.id) ?? 0,
      })),
      recentCompanies: recentCompanies.map((company) => {
        const documentStats = companyDocumentMap.get(company.id);
        return {
          ...company,
          memberCount: companyMemberMap.get(company.id) ?? 0,
          connectionCount: companyConnectionMap.get(company.id) ?? 0,
          documentCount: documentStats?.total ?? 0,
          processingCount: documentStats?.processing ?? 0,
          failedCount: documentStats?.failed ?? 0,
          completedCount: documentStats?.completed ?? 0,
          stuckProcessingCount: companyStuckMap.get(company.id) ?? 0,
          lastDocumentAt: documentStats?.lastDocumentAt ?? null,
        };
      }),
      recentDocuments: recentDocuments.map((document) => ({
        id: document.id,
        fileName: document.fileName,
        source: getEffectiveDocumentSource(document.source, document.ocrResult),
        status: document.status,
        error: document.error,
        createdAt: document.createdAt,
        companyId: document.companyId,
        companyName: document.companyName,
        companySlug: document.companySlug,
      })),
      recentPdfCanaryDocuments: recentPdfCanaryDocuments.slice(0, 12).map((document) => ({
        id: document.id,
        fileName: document.fileName,
        fileType: document.fileType,
        source: getEffectiveDocumentSource(document.source, document.ocrResult),
        status: document.status,
        error: document.error,
        createdAt: document.createdAt,
        companyId: document.companyId,
        companyName: document.companyName,
        companySlug: document.companySlug,
        ingressDispatch: summarizeIngressDispatchState(document.ocrResult),
      })),
      recentPdfDispatchFailures: recentPdfDispatchFailures,
      recentShadowComparisonMismatches: recentShadowMismatchRows24h
        .filter((row) => row.document_id && row.mismatch_type)
        .map((row) => ({
          documentId: row.document_id as string,
          fileName: row.file_name ?? "unknown.pdf",
          companyName: row.company_name ?? "Unknown company",
          companySlug: row.company_slug ?? null,
          observedAt: row.shadow_created_at ?? null,
          mismatchType: row.mismatch_type as "potential_false_safe" | "potential_narrative_miss",
          shadowAction: row.shadow_action ?? null,
          shadowReason: row.shadow_reason ?? null,
          shadowProcessingStrategy: row.shadow_processing_strategy ?? null,
          authoritativeBucket: row.authoritative_bucket ?? null,
          authoritativeDocumentKind: row.authoritative_document_kind ?? null,
          documentStatus: row.document_status ?? null,
        })),
      recentConnections: recentConnectionView,
      recentActivity,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
