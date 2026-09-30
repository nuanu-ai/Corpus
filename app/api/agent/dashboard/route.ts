import { NextResponse } from "next/server";

import { getApiKeyCompanyContext, handleApiError, requireGrantedApiKeyScope } from "@/lib/api-auth";
import { getCompanyManagementSummary } from "@/lib/company-db/client";
import { listConnections } from "@/lib/connections";
import { documents } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { and, count, eq, notInArray, sql } from "drizzle-orm";
import {
  shouldRunSimplifiedNarrativeShadow,
  shouldUsePostIngressDispatch,
} from "@/lib/inngest/document-ingress-events";
import { coerceCountedLabels } from "@/lib/inngest/pdf-canary-analytics";

export async function GET() {
  try {
    const { apiKey, membership } = await getApiKeyCompanyContext();
    requireGrantedApiKeyScope(apiKey.scopes, "dashboard.read");

    const ingressDispatchStageExpr = sql<string | null>`nullif(${documents.ocrResult} -> 'ingress_dispatch' ->> 'stage', '')`;
    const pdfCanaryEnabled = shouldUsePostIngressDispatch({
      companyId: membership.companyId,
      fileType: "pdf",
    });
    const shadowNarrativeEnabled = shouldRunSimplifiedNarrativeShadow({
      companyId: membership.companyId,
      fileType: "pdf",
    });

    const [
      documentCounts,
      connections,
      pdfCanarySummaryRows,
      topEscalationReasonRows,
      topFailureErrorRows,
      topDispatchFailureErrorRows,
      shadowNarrativeSummaryRows,
      topShadowSkipReasonRows,
      topShadowFailureErrorRows,
      shadowComparisonRows,
    ] = await Promise.all([
      db
        .select({
          total: count(),
          processing: sql<number>`count(*) filter (where ${documents.status} = 'processing')::int`,
          failed: sql<number>`count(*) filter (where ${documents.status} = 'failed')::int`,
          completed: sql<number>`count(*) filter (where ${documents.status} = 'completed')::int`,
        })
        .from(documents)
        .where(
          and(
            eq(documents.companyId, membership.companyId),
            notInArray(documents.status, ["deleted"]),
          ),
        ),
      listConnections(membership.companyId),
      db
        .select({
          observed: count(),
          simplified:
            sql<number>`count(*) filter (where coalesce(${documents.ocrResult} -> 'ingress_dispatch' ->> 'processing_strategy', '') = 'simplified_narrative')::int`,
          escalated:
            sql<number>`count(*) filter (where coalesce(${documents.ocrResult} -> 'ingress_dispatch' ->> 'dispatch_target', '') = 'codex_worker')::int`,
          failed:
            sql<number>`count(*) filter (where ${documents.status} = 'failed' or coalesce(${documents.ocrResult} -> 'ingress_dispatch' ->> 'stage', '') = 'failed')::int`,
        })
        .from(documents)
        .where(
          and(
            eq(documents.companyId, membership.companyId),
            eq(documents.fileType, "pdf"),
            notInArray(documents.status, ["deleted"]),
            sql`${ingressDispatchStageExpr} is not null`,
            sql`${documents.createdAt} >= now() - interval '24 hours'`,
          ),
        ),
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
          where d.company_id = ${membership.companyId}
            and d.file_type = 'pdf'
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
          where d.company_id = ${membership.companyId}
            and d.file_type = 'pdf'
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
        where a.company_id = ${membership.companyId}
          and a.action = 'document_ingress_dispatch_failed'
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
        where a.company_id = ${membership.companyId}
          and a.created_at >= now() - interval '24 hours'
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
        where a.company_id = ${membership.companyId}
          and a.created_at >= now() - interval '24 hours'
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
        where a.company_id = ${membership.companyId}
          and a.created_at >= now() - interval '24 hours'
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
          where a.company_id = ${membership.companyId}
            and a.created_at >= now() - interval '24 hours'
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
          left join documents d
            on d.id::text = shadow.document_id::text
           and d.company_id = ${membership.companyId}
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
    ]);

    if (!membership.companySlug) {
      return NextResponse.json(
        { error: "Resolved company is missing a slug" },
        { status: 500 },
      );
    }

    const summary = await getCompanyManagementSummary({
      companySlug: membership.companySlug,
      port: membership.companyDbPort,
    });
    const pdfCanarySummary = pdfCanarySummaryRows[0] ?? {
      observed: 0,
      simplified: 0,
      escalated: 0,
      failed: 0,
    };
    const topEscalationReasons = coerceCountedLabels(topEscalationReasonRows);
    const topFailureErrors = coerceCountedLabels(topFailureErrorRows);
    const topDispatchFailureErrors = coerceCountedLabels(topDispatchFailureErrorRows);
    const shadowNarrativeSummary = shadowNarrativeSummaryRows[0] ?? {
      observed: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
    };
    const shadowComparisonSummary = shadowComparisonRows[0] ?? {
      evaluated: 0,
      unresolved: 0,
      agree_simplified_safe: 0,
      agree_hard_path_needed: 0,
      potential_false_safe: 0,
      potential_narrative_miss: 0,
      shadow_failed: 0,
    };
    const topShadowSkipReasons = coerceCountedLabels(topShadowSkipReasonRows);
    const topShadowFailureErrors = coerceCountedLabels(topShadowFailureErrorRows);

    return NextResponse.json({
      company: {
        id: membership.companyId,
        name: membership.companyName,
        slug: membership.companySlug,
        role: membership.role,
        companyDbPort: membership.companyDbPort,
      },
      dashboard: {
        managementSummary: summary,
        documentCount: documentCounts[0]?.total ?? 0,
        documentPipeline: {
          processingCount: documentCounts[0]?.processing ?? 0,
          failedCount: documentCounts[0]?.failed ?? 0,
          completedCount: documentCounts[0]?.completed ?? 0,
          pdfCanary24h: {
            enabled: pdfCanaryEnabled,
            observed: Number(pdfCanarySummary.observed ?? 0),
            simplified: Number(pdfCanarySummary.simplified ?? 0),
            escalated: Number(pdfCanarySummary.escalated ?? 0),
            failed: Number(pdfCanarySummary.failed ?? 0),
            topEscalationReasons,
            topFailureErrors,
            topDispatchFailureErrors,
          },
          shadowNarrative24h: {
            enabled: shadowNarrativeEnabled,
            observed: Number(shadowNarrativeSummary.observed ?? 0),
            completed: Number(shadowNarrativeSummary.completed ?? 0),
            skipped: Number(shadowNarrativeSummary.skipped ?? 0),
            failed: Number(shadowNarrativeSummary.failed ?? 0),
            topSkipReasons: topShadowSkipReasons,
            topFailureErrors: topShadowFailureErrors,
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
        connectionCount: connections.length,
        connections: connections.map((connection) => ({
          id: connection.id,
          provider: connection.provider,
          status: connection.status,
          lastSyncAt: connection.lastSyncAt,
          lastError: connection.lastError,
          metadata: connection.metadata,
        })),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
