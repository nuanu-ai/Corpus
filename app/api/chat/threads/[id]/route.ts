import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { chatThreads } from "@/lib/db/schema";
import {
  MAX_CONSULTANT_THREAD_HISTORY_MESSAGES,
  uiMessageSchema,
} from "@/lib/consultant/messages";
import {
  buildChatThreadResponse,
  loadThreadApprovals,
  loadThreadAttachments,
  loadThreadArtifacts,
  loadNormalizedThreadMessages,
  syncNormalizedThreadMessages,
} from "@/lib/consultant/store";
import { ensureConsultantThreadWorkspace } from "@/lib/consultant/workspace";

const updateThreadSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    messages: z
      .array(uiMessageSchema)
      .max(MAX_CONSULTANT_THREAD_HISTORY_MESSAGES)
      .optional(),
  })
  .refine((data) => data.title !== undefined || data.messages !== undefined, {
    message: "Either title or messages is required",
  });

/**
 * GET /api/chat/threads/:id
 */
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
        ),
      )
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

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

/**
 * PATCH /api/chat/threads/:id
 */
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
      return NextResponse.json(
        { error: "Invalid payload" },
        { status: 400 },
      );
    }

    const parsed = updateThreadSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload: title/messages are malformed" },
        { status: 400 },
      );
    }

    const nextValues: {
      title?: string;
      messages?: Array<Record<string, unknown>>;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };

    if (parsed.data.title !== undefined) {
      nextValues.title = parsed.data.title;
    }
    if (parsed.data.messages !== undefined) {
      nextValues.messages = parsed.data.messages as Array<Record<string, unknown>>;
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
          ),
        )
        .returning({
          id: chatThreads.id,
          title: chatThreads.title,
          messages: chatThreads.messages,
          createdAt: chatThreads.createdAt,
          updatedAt: chatThreads.updatedAt,
        });

      if (updated && parsed.data.messages !== undefined) {
        await syncNormalizedThreadMessages(tx, {
          threadId: updated.id,
          companyId,
          userId,
          messages: parsed.data.messages,
        });
      }

      return updated;
    });

    if (!row) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    await ensureConsultantThreadWorkspace({
      companyId,
      threadId: row.id,
      userId,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }).catch((error) => {
      console.error("Failed to refresh consultant workspace:", error);
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

/**
 * DELETE /api/chat/threads/:id
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const { id } = await params;

    const deleted = await db
      .delete(chatThreads)
      .where(
        and(
          eq(chatThreads.id, id),
          eq(chatThreads.companyId, companyId),
          eq(chatThreads.userId, userId),
        ),
      )
      .returning({ id: chatThreads.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
}
