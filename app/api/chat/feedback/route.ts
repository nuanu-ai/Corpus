/**
 * POST /api/chat/feedback
 *
 * Records a thumbs-up/thumbs-down on an assistant message. Natural-key
 * upsert per `(threadId, uiMessageId, userId)` — flipping a thumb
 * replaces in place. `persona_slug` is read from the thread row so each
 * row carries the persona it belongs to without a runtime join later.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { chatFeedback, chatThreads } from "@/lib/db/schema";

const feedbackSchema = z.object({
  threadId: z.string().uuid(),
  uiMessageId: z.string().min(1).max(200),
  type: z.enum(["positive", "negative"]),
  comment: z.string().trim().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = feedbackSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid feedback payload" },
        { status: 400 },
      );
    }
    const { threadId, uiMessageId, type, comment } = parsed.data;

    // Ownership check + read persona_slug for denormalised analytics row.
    const [thread] = await db
      .select({
        id: chatThreads.id,
        personaSlug: chatThreads.personaSlug,
      })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.id, threadId),
          eq(chatThreads.companyId, companyId),
          eq(chatThreads.userId, userId),
        ),
      )
      .limit(1);
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const [row] = await db
      .insert(chatFeedback)
      .values({
        threadId,
        uiMessageId,
        companyId,
        userId,
        personaSlug: thread.personaSlug ?? "company",
        type,
        comment: comment ?? null,
      })
      .onConflictDoUpdate({
        target: [
          chatFeedback.threadId,
          chatFeedback.uiMessageId,
          chatFeedback.userId,
        ],
        set: {
          type,
          comment: comment ?? null,
          updatedAt: sql`now()`,
        },
      })
      .returning({
        id: chatFeedback.id,
        type: chatFeedback.type,
        updatedAt: chatFeedback.updatedAt,
      });

    if (!row) {
      return NextResponse.json(
        { error: "Failed to record feedback" },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      id: row.id,
      type: row.type,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
