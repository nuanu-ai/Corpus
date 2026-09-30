import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import {
  buildDocumentIngressEvent,
  buildSimplifiedNarrativeShadowEvent,
} from "@/lib/inngest/document-ingress-events";
import { enqueueOutboxEvent } from "@/lib/outbox";
import { eq, and, sql } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
const STUCK_THRESHOLD_MINUTES = 10;
const CODEX_STALE_CLAIM_THRESHOLD_MINUTES = 15;
const MAX_RETRY_BATCH = 50;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function getCronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value ? value : null;
}

async function releaseStaleCodexClaims(): Promise<number> {
  const rows = await db.execute<{ released_count: number | string }>(sql`
    WITH stale AS (
      SELECT id
      FROM documents
      WHERE source = 'codex_upload'
        AND status = 'processing'
        AND COALESCE(ocr_result -> 'codex_preprocess' ->> 'stage', 'queued')
          IN ('artifactizing', 'running', 'persisting')
        AND COALESCE(
          (ocr_result -> 'codex_preprocess' ->> 'last_heartbeat_at')::timestamptz,
          created_at
        ) < now() - (${CODEX_STALE_CLAIM_THRESHOLD_MINUTES}::text || ' minutes')::interval
      ORDER BY created_at ASC
      LIMIT ${MAX_RETRY_BATCH}
      FOR UPDATE SKIP LOCKED
    ),
    released AS (
      UPDATE documents d
      SET
        processing_stage = 'received',
        error = NULL,
        ocr_result = jsonb_set(
          COALESCE(d.ocr_result, '{}'::jsonb),
          '{codex_preprocess}',
          (
            COALESCE(d.ocr_result -> 'codex_preprocess', '{}'::jsonb)
            || jsonb_build_object(
              'source_mode', 'codex_worker',
              'stage', 'queued',
              'updated_at', now(),
              'error', NULL,
              'recovered_at', now(),
              'recovery_reason', 'stale_claim_heartbeat'
            )
          )
          - 'worker_id'
          - 'claim_expires_at'
          - 'last_heartbeat_at'
          - 'artifact_manifest_path'
          - 'artifact_count'
          - 'unit_count'
          - 'import_root_path'
          - 'index_file_path'
          - 'bundle_storage_key',
          true
        )
      FROM stale
      WHERE d.id = stale.id
      RETURNING d.id
    )
    SELECT COUNT(*)::int AS released_count
    FROM released
  `);

  const value = rows[0]?.released_count;
  return typeof value === "number" ? value : Number(value ?? 0);
}

/**
 * POST /api/cron/retry-stuck-documents
 *
 * Finds documents stuck in "processing" for longer than STUCK_THRESHOLD_MINUTES
 * and re-sends Inngest events to reprocess them. This covers the case where
 * inngest.send() failed silently after document was persisted.
 *
 * Protected by CRON_SECRET header.
 */
export async function POST(req: NextRequest) {
  const cronSecret = getCronSecret();
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    const cronHeader = req.headers.get("x-cron-secret");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const isAuthorized =
      (bearerToken !== null && safeCompare(bearerToken, cronSecret)) ||
      (cronHeader !== null && safeCompare(cronHeader, cronSecret));
    if (!isAuthorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const cutoff = new Date(
    Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000,
  ).toISOString();

  const stuckDocs = await db.execute<{
    id: string;
    company_id: string;
    file_type: string;
    file_name: string;
    source: string;
    retry_kind: "processing" | "redownload_failed";
    storage_url: string | null;
    connection_id: string | null;
    drive_file_id: string | null;
    mime_type: string | null;
    txn_count: number;
    staging_count: number;
  }>(sql`
    WITH raw_event_state AS (
      SELECT DISTINCT ON (company_id, source_event_id)
        company_id,
        source_event_id AS document_id,
        processed_at AS last_processed_at,
        connection_id::text AS connection_id,
        raw_payload->>'driveFileId' AS drive_file_id,
        raw_payload->>'mimeType' AS mime_type
      FROM raw_events
      ORDER BY company_id, source_event_id, received_at DESC
    ),
    stuck AS (
      SELECT
        d.id,
        d.company_id,
        d.file_type,
        d.file_name,
        d.source,
        'processing'::text AS retry_kind,
        d.storage_url,
        d.created_at
      FROM documents d
      LEFT JOIN raw_event_state rs
        ON rs.company_id = d.company_id
       AND rs.document_id = d.id::text
      WHERE d.status = 'processing'
        AND d.created_at < ${cutoff}
        AND d.source <> 'codex_upload'
        AND (rs.last_processed_at IS NULL OR rs.last_processed_at < ${cutoff})
      ORDER BY d.created_at ASC
      LIMIT ${MAX_RETRY_BATCH}
    ),
    failed_redownload AS (
      SELECT
        d.id,
        d.company_id,
        d.file_type,
        d.file_name,
        d.source,
        'redownload_failed'::text AS retry_kind,
        d.storage_url,
        d.created_at
      FROM documents d
      LEFT JOIN raw_event_state rs
        ON rs.company_id = d.company_id
       AND rs.document_id = d.id::text
      WHERE d.status = 'failed'
        AND d.created_at < ${cutoff}
        AND (
          d.error LIKE 'Storage file not found for key:%'
          OR d.error LIKE 'Failed to parse URL from %'
        )
        AND rs.drive_file_id IS NOT NULL
        AND rs.mime_type IS NOT NULL
        AND (rs.last_processed_at IS NULL OR rs.last_processed_at < ${cutoff})
      ORDER BY d.created_at ASC
      LIMIT ${MAX_RETRY_BATCH}
    ),
    candidates AS (
      SELECT * FROM stuck
      UNION ALL
      SELECT * FROM failed_redownload
    ),
    txn_counts AS (
      SELECT
        re.source_event_id AS document_id,
        COUNT(*)::int AS txn_count
      FROM canonical_txns ct
      INNER JOIN raw_events re ON re.id = ct.raw_event_id
      WHERE ct.status <> 'superseded'
      GROUP BY re.source_event_id
    ),
    staging_counts AS (
      SELECT
        payload->>'documentId' AS document_id,
        COUNT(*)::int AS staging_count
      FROM staging_records
      WHERE payload ? 'documentId'
      GROUP BY payload->>'documentId'
    )
    SELECT
      s.id,
      s.company_id,
      s.file_type,
      s.file_name,
      s.source,
      s.retry_kind,
      s.storage_url,
      rs.drive_file_id,
      rs.connection_id,
      rs.mime_type,
      COALESCE(tx.txn_count, 0) AS txn_count,
      COALESCE(sc.staging_count, 0) AS staging_count
    FROM candidates s
    LEFT JOIN raw_event_state rs
      ON rs.company_id = s.company_id
     AND rs.document_id = s.id::text
    LEFT JOIN txn_counts tx
      ON tx.document_id = s.id::text
    LEFT JOIN staging_counts sc
      ON sc.document_id = s.id::text
    ORDER BY s.created_at ASC
  `);

  let uploadRetried = 0;
  let downloadRetried = 0;
  let failed = 0;
  let markedFailed = 0;
  let skippedUnsafe = 0;

  for (const doc of stuckDocs) {
    try {
      const storageUrl = doc.storage_url?.trim() ?? "";

      // Avoid duplicate transaction inserts or destructive redownload resets
      // when a prior run already wrote canonical transactions.
      if (Number(doc.txn_count ?? 0) > 0) {
        skippedUnsafe++;
        continue;
      }

      if (
        doc.retry_kind === "redownload_failed" ||
        storageUrl.length === 0
      ) {
        if (
          doc.drive_file_id &&
          doc.mime_type
        ) {
          await db.transaction(async (tx) => {
            if (doc.retry_kind === "redownload_failed") {
              await tx
                .update(documents)
                .set({
                  source: "google_drive",
                  status: "processing",
                  error: null,
                  storageUrl: "",
                  sha256: "",
                  fileSizeBytes: 0,
                  ocrResult: null,
                })
                .where(
                  and(
                    eq(documents.id, doc.id),
                    eq(documents.companyId, doc.company_id),
                  ),
                );
            }

            await enqueueOutboxEvent(tx, {
              name: "document/gdrive-download",
              data: {
                documentId: doc.id,
                companyId: doc.company_id,
                connectionId: doc.connection_id ?? undefined,
                fileId: doc.drive_file_id,
                fileName: doc.file_name,
                mimeType: doc.mime_type,
                fileType: doc.file_type,
              },
            });
            await tx.execute(sql`
              UPDATE raw_events
              SET processed_at = now()
              WHERE company_id = ${doc.company_id}::uuid
                AND source_event_id = ${doc.id}
            `);
          });
          downloadRetried++;
          continue;
        }

        await db
          .update(documents)
          .set({
            status: "failed",
            error: "Missing storage reference for retry",
          })
          .where(
            and(
              eq(documents.id, doc.id),
              eq(documents.companyId, doc.company_id),
            ),
          );
        markedFailed++;
        continue;
      }

      await db.transaction(async (tx) => {
        await enqueueOutboxEvent(
          tx,
          buildDocumentIngressEvent({
            documentId: doc.id,
            companyId: doc.company_id,
            fileType: doc.file_type,
            storageKey: storageUrl,
          }),
        );
        const shadowEvent = buildSimplifiedNarrativeShadowEvent({
          documentId: doc.id,
          companyId: doc.company_id,
          fileType: doc.file_type,
          storageKey: storageUrl,
        });
        if (shadowEvent) {
          await enqueueOutboxEvent(tx, shadowEvent);
        }
        await tx.execute(sql`
          UPDATE raw_events
          SET processed_at = now()
          WHERE company_id = ${doc.company_id}::uuid
            AND source_event_id = ${doc.id}
        `);
      });
      uploadRetried++;
    } catch (err) {
      console.error(`[retry-stuck] Failed to re-send event for ${doc.id}:`, err);
      failed++;
    }
  }

  const codexClaimsReleased = await releaseStaleCodexClaims();

  return NextResponse.json({
    status: "ok",
    stuckFound: stuckDocs.length,
    uploadRetried,
    downloadRetried,
    failed,
    markedFailed,
    skippedUnsafe,
    codexClaimsReleased,
  });
}
