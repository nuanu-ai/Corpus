import { sql } from "drizzle-orm";

import { buildEffectiveDocumentSourceExpr } from "@/lib/codex-worker/source-context";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

type QueueCountsRow = {
  queued: number | null;
  running: number | null;
  googleDriveQueued: number | null;
  googleDriveRunning: number | null;
  oldestQueuedAt: string | null;
};

const codexStageExpr = sql<string>`coalesce(${documents.ocrResult} -> 'codex_preprocess' ->> 'stage', '')`;
const effectiveSourceExpr = buildEffectiveDocumentSourceExpr(documents.source, documents.ocrResult);

function normalizeCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function getCodexQueueStatus(companyId: string) {
  const [companyRows, globalRows] = await Promise.all([
    db
      .select({
        queued:
          sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::int`,
        running:
          sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} in ('artifactizing', 'running', 'persisting'))::int`,
        googleDriveQueued:
          sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${effectiveSourceExpr} = 'google_drive' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::int`,
        googleDriveRunning:
          sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${effectiveSourceExpr} = 'google_drive' and ${documents.status} = 'processing' and ${codexStageExpr} in ('artifactizing', 'running', 'persisting'))::int`,
        oldestQueuedAt:
          sql<string | null>`min(${documents.createdAt}) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::text`,
      })
      .from(documents)
      .where(sql`${documents.companyId} = ${companyId}`),
    db
      .select({
        queued:
          sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::int`,
        running:
          sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} in ('artifactizing', 'running', 'persisting'))::int`,
        googleDriveQueued:
          sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${effectiveSourceExpr} = 'google_drive' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::int`,
        googleDriveRunning:
          sql<number>`count(*) filter (where ${documents.source} = 'codex_upload' and ${effectiveSourceExpr} = 'google_drive' and ${documents.status} = 'processing' and ${codexStageExpr} in ('artifactizing', 'running', 'persisting'))::int`,
        oldestQueuedAt:
          sql<string | null>`min(${documents.createdAt}) filter (where ${documents.source} = 'codex_upload' and ${documents.status} = 'processing' and ${codexStageExpr} = 'queued')::text`,
      })
      .from(documents),
  ]);

  const company = (companyRows[0] ?? {}) as QueueCountsRow;
  const global = (globalRows[0] ?? {}) as QueueCountsRow;

  return {
    companyQueued: normalizeCount(company.queued),
    companyRunning: normalizeCount(company.running),
    companyOldestQueuedAt: company.oldestQueuedAt ?? null,
    companyByOrigin: {
      googleDrive: {
        queued: normalizeCount(company.googleDriveQueued),
        running: normalizeCount(company.googleDriveRunning),
      },
    },
    globalQueued: normalizeCount(global.queued),
    globalRunning: normalizeCount(global.running),
    globalOldestQueuedAt: global.oldestQueuedAt ?? null,
    globalByOrigin: {
      googleDrive: {
        queued: normalizeCount(global.googleDriveQueued),
        running: normalizeCount(global.googleDriveRunning),
      },
    },
  };
}
