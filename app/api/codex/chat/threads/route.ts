import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { ensureExecutorThreadWorkspace } from "@/lib/chat-runtime/workspace";
import {
  buildChatThreadResponse,
  loadThreadApprovals,
  loadThreadAttachments,
  loadThreadArtifacts,
  loadNormalizedThreadMessages,
  syncNormalizedThreadMessages,
} from "@/lib/consultant/store";
import {
  MAX_CONSULTANT_THREAD_HISTORY_MESSAGES,
  uiMessageSchema,
} from "@/lib/consultant/messages";
import {
  getCodexChatAuthProfileById,
  getLatestCodexChatAuthProfile,
} from "@/lib/codex-chat/auth-store";
import { CODEX_CHAT_EXECUTOR } from "@/lib/codex-chat/types";
import { getCodexChatThreadWorkspacePath } from "@/lib/codex-chat/workspace";
import { db } from "@/lib/db";
import { chatThreads } from "@/lib/db/schema";

const createThreadSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  messages: z
    .array(uiMessageSchema)
    .max(MAX_CONSULTANT_THREAD_HISTORY_MESSAGES)
    .optional(),
  authProfileId: z.string().uuid().optional().nullable(),
  runtimeMetadata: z.record(z.string(), z.any()).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const summaryOnly = req.nextUrl.searchParams.get("summary") === "1";

    const baseQuery = db
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
          eq(chatThreads.companyId, companyId),
          eq(chatThreads.userId, userId),
          eq(chatThreads.executor, CODEX_CHAT_EXECUTOR),
        ),
      )
      .orderBy(desc(chatThreads.updatedAt))
      .limit(20);

    const rows = await baseQuery;
    const threadIds = rows.map((row) => row.id);
    const [attachmentMap, artifactMap, approvalMap] = await Promise.all([
      loadThreadAttachments(threadIds),
      loadThreadArtifacts(threadIds),
      loadThreadApprovals(threadIds),
    ]);

    if (summaryOnly) {
      return NextResponse.json(
        rows.map((row) =>
          buildChatThreadResponse(row, [], attachmentMap.get(row.id) ?? [], artifactMap.get(row.id) ?? [], approvalMap.get(row.id) ?? []),
        ),
      );
    }

    const messageMap = await loadNormalizedThreadMessages(threadIds);
    return NextResponse.json(
      rows.map((row) =>
        buildChatThreadResponse(
          row,
          messageMap.get(row.id),
          attachmentMap.get(row.id) ?? [],
          artifactMap.get(row.id) ?? [],
          approvalMap.get(row.id) ?? [],
        ),
      ),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();

    let rawBody: unknown = {};
    try {
      rawBody = await req.json();
    } catch {
      rawBody = {};
    }

    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createThreadSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const title = parsed.data.title ?? "New Codex task";
    const messages = parsed.data.messages ?? [];
    const authProfile = parsed.data.authProfileId
      ? await getCodexChatAuthProfileById({
          companyId,
          userId,
          profileId: parsed.data.authProfileId,
        })
      : await getLatestCodexChatAuthProfile({ companyId, userId });

    if (!authProfile || authProfile.status !== "ready") {
      return NextResponse.json(
        { error: "Codex auth must be configured before creating Codex threads" },
        { status: 409 },
      );
    }

    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(chatThreads)
        .values({
          companyId,
          userId,
          executor: CODEX_CHAT_EXECUTOR,
          authProfileId: authProfile?.id ?? null,
          workspaceRoot: null,
          runtimeMetadata: parsed.data.runtimeMetadata ?? {},
          title,
          messages,
        })
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

      const workspaceRoot = getCodexChatThreadWorkspacePath(companyId, userId, created.id);
      const [updated] = await tx
        .update(chatThreads)
        .set({
          workspaceRoot,
          updatedAt: new Date(),
        })
        .where(eq(chatThreads.id, created.id))
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
        threadId: updated.id,
        companyId,
        userId,
        messages,
      });

      return updated;
    });

    await ensureExecutorThreadWorkspace({
      executor: CODEX_CHAT_EXECUTOR,
      companyId,
      threadId: row.id,
      userId,
      title: row.title,
      authProfileId: row.authProfileId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }).catch((error) => {
      console.error("Failed to initialize Codex workspace:", error);
    });

    return NextResponse.json(buildChatThreadResponse(row, undefined, [], [], []), {
      status: 201,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
