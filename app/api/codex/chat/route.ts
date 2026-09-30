import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { join } from 'path';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getSessionCompanyContext, handleApiError } from '@/lib/api-auth';
import {
  buildChatThreadResponse,
  loadThreadApprovals,
  loadThreadAttachments,
  loadThreadArtifacts,
  loadNormalizedThreadMessages,
  syncNormalizedThreadMessages,
} from '@/lib/consultant/store';
import {
  extractMessageText,
  normalizeStoredMessages,
  uiMessageSchema,
  type ConsultantUIMessage,
} from '@/lib/consultant/messages';
import {
  getCodexChatAuthProfileById,
  getLatestCodexChatAuthProfile,
} from '@/lib/codex-chat/auth-store';
import { CODEX_CHAT_EXECUTOR } from '@/lib/codex-chat/types';
import { db } from '@/lib/db';
import { chatRuns, chatThreads } from '@/lib/db/schema';

const createRunSchema = z.object({
  threadId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(100_000),
  model: z.string().trim().min(1).max(200).optional().nullable(),
});

const RUN_SCRIPT_PATH = join(process.cwd(), 'scripts', 'codex-chat-runner.ts');
const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function spawnCodexChatRun(runId: string): void {
  // REL-9: 'error' handler prevents an unhandled process-level error when
  // npx/tsx is missing. NOTE: this detached-spawn path may be obsoleted by
  // the feat/telegram-orchestrator in-process runner (task #21 / Phase E).
  // Keep the fix minimal — the in-process runner simply won't call this function.
  const child = spawn(NPX_BIN, ['tsx', RUN_SCRIPT_PATH, '--run-id', runId], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.on('error', (err) => {
    console.error(`[codex-chat] spawnCodexChatRun failed for runId=${runId}:`, err);
    db.update(chatRuns)
      .set({ status: 'failed', completedAt: new Date() })
      .where(eq(chatRuns.id, runId))
      .catch((dbErr) => {
        console.error(`[codex-chat] failed to mark run failed for runId=${runId}:`, dbErr);
      });
  });
  child.unref();
}

function buildUserMessage(prompt: string): ConsultantUIMessage {
  return {
    id: randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: prompt }],
  };
}

export async function POST(req: Request) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = createRunSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const [threadRow] = await db
      .select({
        id: chatThreads.id,
        executor: chatThreads.executor,
        authProfileId: chatThreads.authProfileId,
        workspaceRoot: chatThreads.workspaceRoot,
        runtimeMetadata: chatThreads.runtimeMetadata,
        title: chatThreads.title,
        messages: chatThreads.messages,
        createdAt: chatThreads.createdAt,
        updatedAt: chatThreads.updatedAt,
      })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.id, parsed.data.threadId),
          eq(chatThreads.companyId, companyId),
          eq(chatThreads.userId, userId),
          eq(chatThreads.executor, CODEX_CHAT_EXECUTOR),
        ),
      )
      .limit(1);

    if (!threadRow) {
      return NextResponse.json({ error: 'Codex thread not found' }, { status: 404 });
    }

    const authProfile = threadRow.authProfileId
      ? await getCodexChatAuthProfileById({
          companyId,
          userId,
          profileId: threadRow.authProfileId,
        })
      : await getLatestCodexChatAuthProfile({ companyId, userId });

    if (!authProfile || authProfile.status !== 'ready') {
      return NextResponse.json(
        { error: 'Codex auth must be configured before sending a Codex task' },
        { status: 409 },
      );
    }

    const activeRuns = await db
      .select({ id: chatRuns.id })
      .from(chatRuns)
      .where(
        and(
          eq(chatRuns.threadId, threadRow.id),
          inArray(chatRuns.status, ['queued', 'running']),
        ),
      )
      .limit(1);

    if (activeRuns.length > 0) {
      return NextResponse.json(
        { error: 'A Codex run is already active for this thread' },
        { status: 409 },
      );
    }

    const currentMessages = normalizeStoredMessages(threadRow.messages);
    const userMessage = buildUserMessage(parsed.data.prompt);
    const nextMessages = [...currentMessages, userMessage];
    const latestUserPromptSummary = extractMessageText(userMessage.parts).slice(0, 280);
    const requestedModel = parsed.data.model?.trim() || null;

    let chatRunId: string | null = null;
    const updatedThread = await db.transaction(async (tx) => {
      // DATA-3: path-scoped jsonb writes so a stale threadRow.runtimeMetadata
      // read can't clobber sibling keys (e.g. onboarding progress) written by
      // a concurrent request. Only the three keys this path owns are written.
      const nowIso = new Date().toISOString();
      const [updated] = await tx
        .update(chatThreads)
        .set({
          messages: nextMessages as Array<Record<string, unknown>>,
          updatedAt: new Date(),
          authProfileId: threadRow.authProfileId ?? authProfile.id,
          runtimeMetadata: sql`
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(${chatThreads.runtimeMetadata}, '{}'::jsonb),
                  '{lastRequestedModel}',
                  ${JSON.stringify(requestedModel)}::jsonb,
                  true
                ),
                '{lastRunStatus}',
                '"queued"'::jsonb,
                true
              ),
              '{lastUserPromptAt}',
              ${JSON.stringify(nowIso)}::jsonb,
              true
            )
          `,
        })
        .where(eq(chatThreads.id, threadRow.id))
        .returning({
          id: chatThreads.id,
          executor: chatThreads.executor,
          authProfileId: chatThreads.authProfileId,
          workspaceRoot: chatThreads.workspaceRoot,
          runtimeMetadata: chatThreads.runtimeMetadata,
          title: chatThreads.title,
          messages: chatThreads.messages,
          createdAt: chatThreads.createdAt,
          updatedAt: chatThreads.updatedAt,
        });

      await syncNormalizedThreadMessages(tx, {
        threadId: threadRow.id,
        companyId,
        userId,
        messages: nextMessages,
      });

      // DATA-1: onConflictDoNothing is the backstop when two concurrent requests
      // both pass the SELECT activeRuns check before the
      // chat_runs_active_thread_uniq partial index rejects the second insert.
      const [createdRun] = await tx
        .insert(chatRuns)
        .values({
          threadId: threadRow.id,
          companyId,
          uiMessageId: userMessage.id,
          provider: 'openai',
          model: requestedModel,
          executor: CODEX_CHAT_EXECUTOR,
          status: 'queued',
          summary: latestUserPromptSummary,
          metadata: {
            userId,
            authProfileId: authProfile.id,
            requestedModel,
            workspaceRoot: updated.workspaceRoot,
          },
        })
        .onConflictDoNothing()
        .returning({ id: chatRuns.id });

      chatRunId = createdRun?.id ?? null;
      return updated;
    });

    if (!chatRunId) {
      return NextResponse.json({ error: 'Failed to create Codex run' }, { status: 500 });
    }

    spawnCodexChatRun(chatRunId);

    const [messageMap, attachmentMap, artifactMap, approvalMap] = await Promise.all([
      loadNormalizedThreadMessages([updatedThread.id]),
      loadThreadAttachments([updatedThread.id]),
      loadThreadArtifacts([updatedThread.id]),
      loadThreadApprovals([updatedThread.id]),
    ]);

    return NextResponse.json(
      {
        ok: true,
        runId: chatRunId,
        thread: buildChatThreadResponse(
          updatedThread,
          messageMap.get(updatedThread.id),
          attachmentMap.get(updatedThread.id) ?? [],
          artifactMap.get(updatedThread.id) ?? [],
          approvalMap.get(updatedThread.id) ?? [],
        ),
      },
      { status: 202 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function GET(req: Request) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const url = new URL(req.url);
    const threadId = url.searchParams.get('threadId')?.trim() || null;

    const conditions = [eq(chatRuns.companyId, companyId)];
    if (threadId) {
      conditions.push(eq(chatRuns.threadId, threadId));
    }

    const rows = await db
      .select({
        id: chatRuns.id,
        threadId: chatRuns.threadId,
        uiMessageId: chatRuns.uiMessageId,
        provider: chatRuns.provider,
        model: chatRuns.model,
        executor: chatRuns.executor,
        status: chatRuns.status,
        summary: chatRuns.summary,
        metadata: chatRuns.metadata,
        startedAt: chatRuns.startedAt,
        completedAt: chatRuns.completedAt,
        createdAt: chatRuns.createdAt,
        updatedAt: chatRuns.updatedAt,
      })
      .from(chatRuns)
      .innerJoin(chatThreads, eq(chatThreads.id, chatRuns.threadId))
      .where(
        and(
          ...conditions,
          eq(chatThreads.userId, userId),
          eq(chatThreads.executor, CODEX_CHAT_EXECUTOR),
        ),
      )
      .orderBy(desc(chatRuns.createdAt))
      .limit(20);

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        threadId: row.threadId,
        uiMessageId: row.uiMessageId,
        provider: row.provider,
        model: row.model,
        executor: row.executor,
        status: row.status,
        summary: row.summary,
        metadata: row.metadata,
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    );
  } catch (err) {
    return handleApiError(err);
  }
}
