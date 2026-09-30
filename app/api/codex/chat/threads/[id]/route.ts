import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { ensureExecutorThreadWorkspace } from "@/lib/chat-runtime/workspace";
import { syncCodexChatThreadArtifacts } from "@/lib/codex-chat/artifacts";
import {
  buildChatThreadResponse,
  loadThreadApprovals,
  loadThreadAttachments,
  loadThreadArtifacts,
  loadNormalizedThreadMessages,
} from "@/lib/consultant/store";
import { getCodexChatAuthProfileById } from "@/lib/codex-chat/auth-store";
import { CODEX_CHAT_EXECUTOR } from "@/lib/codex-chat/types";
import { db } from "@/lib/db";
import { chatThreads } from "@/lib/db/schema";

// DATA-3 / MISS-4: only server-trusted, whitelisted keys may be patched.
// 'messages' is intentionally excluded — wholesale client replacement is a
// history-tamper vector; the codex runner writes messages directly via DB.
// 'runtimeMetadata' is merged path-by-path (server-side jsonb_set) so only
// the whitelisted sub-keys below are written; unknown keys are stripped by
// zod before the query runs.
const PATCHABLE_RUNTIME_METADATA_KEYS = ["workspaceRoot"] as const;
type PatchableRuntimeMetadataKey = (typeof PATCHABLE_RUNTIME_METADATA_KEYS)[number];

const updateThreadSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    // NOTE: 'messages' removed — client must not full-replace thread message
    // history. The codex runner patches messages directly via DB writes.
    authProfileId: z.string().uuid().optional().nullable(),
    // Only the whitelisted sub-keys are accepted; unknown keys are stripped.
    runtimeMetadata: z
      .object({
        workspaceRoot: z.string().trim().max(1024).optional(),
      })
      .optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.authProfileId !== undefined ||
      data.runtimeMetadata !== undefined,
    {
      message: "At least one field is required",
    },
  );

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const { id } = await params;

    const [row] = await db
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
          eq(chatThreads.id, id),
          eq(chatThreads.companyId, companyId),
          eq(chatThreads.userId, userId),
          eq(chatThreads.executor, CODEX_CHAT_EXECUTOR),
        ),
      )
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    await syncCodexChatThreadArtifacts({
      companyId,
      userId,
      threadId: row.id,
    }).catch((error) => {
      console.error("Failed to sync Codex thread artifacts:", error);
    });

    const [messageMap, attachmentMap, artifactMap, approvalMap] = await Promise.all([
      loadNormalizedThreadMessages([row.id]),
      loadThreadAttachments([row.id]),
      loadThreadArtifacts([row.id]),
      loadThreadApprovals([row.id]),
    ]);

    return NextResponse.json(
      buildChatThreadResponse(
        row,
        messageMap.get(row.id),
        attachmentMap.get(row.id) ?? [],
        artifactMap.get(row.id) ?? [],
        approvalMap.get(row.id) ?? [],
      ),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const { id } = await params;

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const parsed = updateThreadSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    if (parsed.data.authProfileId !== undefined && parsed.data.authProfileId !== null) {
      const profile = await getCodexChatAuthProfileById({
        companyId,
        userId,
        profileId: parsed.data.authProfileId,
      });
      if (!profile) {
        return NextResponse.json(
          { error: "Codex auth profile not found for this company" },
          { status: 404 },
        );
      }
    }

    // DATA-3 / MISS-4: build a safe set-clause.
    // 'messages' is excluded — the codex runner owns that column via direct DB writes.
    // 'runtimeMetadata' is written key-by-key via jsonb_set so concurrent writers
    // on disjoint sub-paths both survive (no stale-read clobber).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nextValues: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (parsed.data.title !== undefined) {
      nextValues.title = parsed.data.title;
    }
    if (parsed.data.authProfileId !== undefined) {
      nextValues.authProfileId = parsed.data.authProfileId ?? null;
    }
    if (parsed.data.runtimeMetadata !== undefined) {
      // Build a chain of jsonb_set calls — one per whitelisted key supplied.
      // Unknown keys are already stripped by zod above.
      const patchKeys = Object.entries(parsed.data.runtimeMetadata).filter(
        ([k]) => (PATCHABLE_RUNTIME_METADATA_KEYS as readonly string[]).includes(k),
      ) as [PatchableRuntimeMetadataKey, string | undefined][];

      if (patchKeys.length > 0) {
        let expr = sql`COALESCE(${chatThreads.runtimeMetadata}, '{}'::jsonb)`;
        for (const [key, value] of patchKeys) {
          expr = sql`jsonb_set(${expr}, ${`{${key}}`}::text[], ${JSON.stringify(value)}::jsonb, true)`;
        }
        nextValues.runtimeMetadata = expr;
      }
    }

    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(chatThreads)
        .set(nextValues)
        .where(
          and(
            eq(chatThreads.id, id),
            eq(chatThreads.companyId, companyId),
            eq(chatThreads.userId, userId),
            eq(chatThreads.executor, CODEX_CHAT_EXECUTOR),
          ),
        )
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

      return updated;
    });

    if (!row) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

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
      console.error("Failed to refresh Codex workspace:", error);
    });

    const [messageMap, attachmentMap, artifactMap, approvalMap] = await Promise.all([
      loadNormalizedThreadMessages([row.id]),
      loadThreadAttachments([row.id]),
      loadThreadArtifacts([row.id]),
      loadThreadApprovals([row.id]),
    ]);

    return NextResponse.json(
      buildChatThreadResponse(
        row,
        messageMap.get(row.id),
        attachmentMap.get(row.id) ?? [],
        artifactMap.get(row.id) ?? [],
        approvalMap.get(row.id) ?? [],
      ),
    );
  } catch (err) {
    return handleApiError(err);
  }
}
