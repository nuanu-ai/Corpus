import { sql } from "drizzle-orm";

import type { db as appDb } from "@/lib/db";

type Db = typeof appDb;
const COMPANY_NAME_SEPARATOR = " || ";
const COMPANY_NAME_SEPARATOR_SQL = sql.raw(`'${COMPANY_NAME_SEPARATOR}'`);

function toCount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toUsd(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function parseCompanyNames(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(COMPANY_NAME_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export async function getAdminUserActivityOverview(db: Db) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [userRows, actionRows, llmUserRows] = await Promise.all([
    db.execute<{
      user_id: string | null;
      name: string | null;
      email: string | null;
      company_count: number | string | null;
      company_names: string | null;
      thread_count: number | string | null;
      chat_run_count: number | string | null;
      session_count_24h: number | string | null;
      audit_action_count_24h: number | string | null;
      chat_run_count_24h: number | string | null;
      llm_usage_event_count_24h: number | string | null;
      last_session_at: string | null;
      last_chat_at: string | null;
      last_audit_at: string | null;
      last_llm_at: string | null;
      last_active_at: string | null;
    }>(sql`
      select
        u.id as user_id,
        u.name,
        u.email,
        count(distinct cm.company_id)::int as company_count,
        nullif(string_agg(distinct cc.name, ${COMPANY_NAME_SEPARATOR_SQL}), '') as company_names,
        count(distinct ct.id)::int as thread_count,
        count(distinct cr.id)::int as chat_run_count,
        count(distinct s.id) filter (where s.updated_at >= ${since})::int as session_count_24h,
        count(distinct al.id) filter (where al.created_at >= ${since})::int as audit_action_count_24h,
        count(distinct cr.id) filter (where cr.created_at >= ${since})::int as chat_run_count_24h,
        count(distinct le.id) filter (where le.created_at >= ${since})::int as llm_usage_event_count_24h,
        max(s.updated_at)::text as last_session_at,
        max(cr.created_at)::text as last_chat_at,
        max(al.created_at)::text as last_audit_at,
        max(le.created_at)::text as last_llm_at,
        greatest(
          coalesce(max(s.updated_at), to_timestamp(0)),
          coalesce(max(cr.created_at), to_timestamp(0)),
          coalesce(max(al.created_at), to_timestamp(0)),
          coalesce(max(le.created_at), to_timestamp(0))
        )::text as last_active_at
      from users u
      left join company_members cm on cm.user_id = u.id
      left join companies cc on cc.id = cm.company_id
      left join sessions s on s.user_id = u.id
      left join chat_threads ct on ct.user_id = u.id
      left join chat_runs cr on cr.metadata ->> 'userId' = u.id
      left join audit_log al on al.user_id = u.id
      left join llm_usage_events le on le.user_id = u.id
      group by u.id, u.name, u.email
      order by greatest(
        coalesce(max(s.updated_at), to_timestamp(0)),
        coalesce(max(cr.created_at), to_timestamp(0)),
        coalesce(max(al.created_at), to_timestamp(0)),
        coalesce(max(le.created_at), to_timestamp(0))
      ) desc,
      u.email asc
      limit 80
    `),
    db.execute<{
      created_at: string | null;
      company_id: string | null;
      company_name: string | null;
      user_id: string | null;
      user_email: string | null;
      action: string | null;
      entity_type: string | null;
      entity_id: string | null;
      detail: string | null;
      source: string | null;
    }>(sql`
      with recent_actions as (
        select
          al.created_at,
          al.company_id,
          c.name as company_name,
          al.user_id,
          u.email as user_email,
          al.action,
          al.entity_type,
          coalesce(al.entity_id::text, '') as entity_id,
          nullif(trim(coalesce(al.new_value::text, '')), '') as detail,
          'audit_log'::text as source
        from audit_log al
        left join companies c on c.id = al.company_id
        left join users u on u.id = al.user_id
        where al.created_at >= ${since}

        union all

        select
          cr.created_at,
          cr.company_id,
          c.name as company_name,
          cr.metadata ->> 'userId' as user_id,
          u.email as user_email,
          'chat.run'::text as action,
          'chat_run'::text as entity_type,
          cr.id::text as entity_id,
          nullif(trim(coalesce(cr.summary, cr.metadata ->> 'latestUserPromptSummary', '')), '') as detail,
          'chat_runs'::text as source
        from chat_runs cr
        left join companies c on c.id = cr.company_id
        left join users u on u.id = cr.metadata ->> 'userId'
        where cr.created_at >= ${since}

        union all

        select
          s.created_at,
          null::uuid as company_id,
          null::text as company_name,
          s.user_id,
          u.email as user_email,
          'auth.session_started'::text as action,
          'session'::text as entity_type,
          s.id::text as entity_id,
          null::text as detail,
          'sessions'::text as source
        from sessions s
        left join users u on u.id = s.user_id
        where s.created_at >= ${since}

        union all

        select
          le.created_at,
          le.company_id,
          c.name as company_name,
          le.user_id,
          u.email as user_email,
          concat('llm.', le.subsystem, '.', le.operation) as action,
          'llm_usage_event'::text as entity_type,
          le.id::text as entity_id,
          concat_ws(
            ' · ',
            concat(le.provider, '/', le.model),
            nullif(le.reference_id, ''),
            case
              when le.estimated_cost_usd is null then null
              else concat('$', to_char(le.estimated_cost_usd, 'FM999999990.0000'))
            end
          ) as detail,
          'llm_usage_events'::text as source
        from llm_usage_events le
        left join companies c on c.id = le.company_id
        left join users u on u.id = le.user_id
        where le.created_at >= ${since}
      )
      select *
      from recent_actions
      order by created_at desc
      limit 60
    `),
    db.execute<{
      user_id: string | null;
      anthropic_run_count_24h: number | string | null;
      anthropic_input_tokens_24h: number | string | null;
      anthropic_output_tokens_24h: number | string | null;
      anthropic_estimated_cost_usd_24h: number | string | null;
      llm_run_count_24h: number | string | null;
      llm_input_tokens_24h: number | string | null;
      llm_output_tokens_24h: number | string | null;
      llm_estimated_cost_usd_24h: number | string | null;
    }>(sql`
      select
        le.user_id,
        count(*) filter (where le.provider = 'anthropic')::int as anthropic_run_count_24h,
        coalesce(sum(le.input_tokens) filter (where le.provider = 'anthropic'), 0)::int as anthropic_input_tokens_24h,
        coalesce(sum(le.output_tokens) filter (where le.provider = 'anthropic'), 0)::int as anthropic_output_tokens_24h,
        coalesce(sum(coalesce(le.estimated_cost_usd, 0)) filter (where le.provider = 'anthropic'), 0)::numeric as anthropic_estimated_cost_usd_24h,
        count(*)::int as llm_run_count_24h,
        coalesce(sum(le.input_tokens), 0)::int as llm_input_tokens_24h,
        coalesce(sum(le.output_tokens), 0)::int as llm_output_tokens_24h,
        coalesce(sum(coalesce(le.estimated_cost_usd, 0)), 0)::numeric as llm_estimated_cost_usd_24h
      from llm_usage_events le
      where le.created_at >= ${since}
      group by le.user_id
    `),
  ]);

  const llmByUserId = new Map(
    llmUserRows.map((row) => [
      row.user_id ?? "unknown",
      {
        anthropicRunCount24h: toCount(row.anthropic_run_count_24h),
        anthropicInputTokens24h: toCount(row.anthropic_input_tokens_24h),
        anthropicOutputTokens24h: toCount(row.anthropic_output_tokens_24h),
        anthropicEstimatedCostUsd24h: toUsd(row.anthropic_estimated_cost_usd_24h),
        llmRunCount24h: toCount(row.llm_run_count_24h),
        llmInputTokens24h: toCount(row.llm_input_tokens_24h),
        llmOutputTokens24h: toCount(row.llm_output_tokens_24h),
        llmEstimatedCostUsd24h: toUsd(row.llm_estimated_cost_usd_24h),
      },
    ]),
  );

  return {
    users: userRows.map((row) => ({
      ...(llmByUserId.get(row.user_id ?? "unknown") ?? {
        anthropicRunCount24h: 0,
        anthropicInputTokens24h: 0,
        anthropicOutputTokens24h: 0,
        anthropicEstimatedCostUsd24h: 0,
        llmRunCount24h: 0,
        llmInputTokens24h: 0,
        llmOutputTokens24h: 0,
        llmEstimatedCostUsd24h: 0,
      }),
      userId: row.user_id ?? "unknown",
      name: row.name ?? "Unknown user",
      email: row.email ?? "unknown",
      companyCount: toCount(row.company_count),
      companyNames: parseCompanyNames(row.company_names),
      threadCount: toCount(row.thread_count),
      chatRunCount: toCount(row.chat_run_count),
      sessionCount24h: toCount(row.session_count_24h),
      auditActionCount24h: toCount(row.audit_action_count_24h),
      chatRunCount24h: toCount(row.chat_run_count_24h),
      llmUsageEventCount24h: toCount(row.llm_usage_event_count_24h),
      lastSessionAt: row.last_session_at,
      lastChatAt: row.last_chat_at,
      lastAuditAt: row.last_audit_at,
      lastLlmAt: row.last_llm_at,
      lastActiveAt: row.last_active_at,
    })),
    recentActions24h: actionRows.map((row) => ({
      createdAt: row.created_at,
      companyId: row.company_id,
      companyName: row.company_name,
      userId: row.user_id,
      userEmail: row.user_email,
      action: row.action ?? "unknown",
      entityType: row.entity_type ?? "unknown",
      entityId: row.entity_id ?? "",
      detail: row.detail,
      source: row.source ?? "unknown",
    })),
  };
}
