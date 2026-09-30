import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getSessionCompanyContext, handleApiError } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { chatRuns, chatThreads } from '@/lib/db/schema';
import { CODEX_CHAT_EXECUTOR } from '@/lib/codex-chat/types';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const { id } = await params;

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
          eq(chatRuns.threadId, id),
          eq(chatRuns.companyId, companyId),
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
