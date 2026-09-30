import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { chatThreads } from "@/lib/db/schema";
import {
  isPersonaSlug,
  resolvePersonaSlug,
  type PersonaSlug,
} from "@/lib/ai/personas";
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

const createThreadSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  messages: z
    .array(uiMessageSchema)
    .max(MAX_CONSULTANT_THREAD_HISTORY_MESSAGES)
    .optional(),
  personaSlug: z
    .string()
    .trim()
    .refine(isPersonaSlug, { message: "Unknown personaSlug" })
    .optional(),
});

/**
 * GET /api/chat/threads
 *
 * Returns authenticated user's chat threads for the active company.
 */
export async function GET(req: NextRequest) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const summaryOnly = req.nextUrl.searchParams.get("summary") === "1";
    // Optional ?persona=cfo filter — only return threads for that persona.
    // Unknown / missing param → no filter (legacy behaviour preserved).
    const personaParam = req.nextUrl.searchParams.get("persona");
    const personaFilter: PersonaSlug | null =
      personaParam && isPersonaSlug(personaParam) ? personaParam : null;

    const buildBaseWhere = () => {
      const conditions = [
        eq(chatThreads.companyId, companyId),
        eq(chatThreads.userId, userId),
      ];
      if (personaFilter) {
        conditions.push(eq(chatThreads.personaSlug, personaFilter));
      }
      return and(...conditions);
    };

    if (summaryOnly) {
      const rows = await db
        .select({
          id: chatThreads.id,
          title: chatThreads.title,
          createdAt: chatThreads.createdAt,
          updatedAt: chatThreads.updatedAt,
        })
        .from(chatThreads)
        .where(buildBaseWhere())
        .orderBy(desc(chatThreads.updatedAt))
        .limit(20);

      const threadIds = rows.map((row) => row.id);
      const [attachmentMap, artifactMap, approvalMap] = await Promise.all([
        loadThreadAttachments(threadIds),
        loadThreadArtifacts(threadIds),
        loadThreadApprovals(threadIds),
      ]);

      return NextResponse.json(
        rows.map((row) =>
          ({
            id: row.id,
            title: row.title,
            messages: [],
            attachments: attachmentMap.get(row.id) ?? [],
            artifacts: artifactMap.get(row.id) ?? [],
            approvals: approvalMap.get(row.id) ?? [],
            updatedAt: row.updatedAt.toISOString(),
            createdAt: row.createdAt.toISOString(),
          }),
        ),
      );
    }

    const rows = await db
      .select({
        id: chatThreads.id,
        title: chatThreads.title,
        messages: chatThreads.messages,
        createdAt: chatThreads.createdAt,
        updatedAt: chatThreads.updatedAt,
      })
      .from(chatThreads)
      .where(buildBaseWhere())
      .orderBy(desc(chatThreads.updatedAt))
      .limit(20);

    const threadIds = rows.map((row) => row.id);
    const [messageMap, attachmentMap, artifactMap, approvalMap] = await Promise.all([
      loadNormalizedThreadMessages(threadIds),
      loadThreadAttachments(threadIds),
      loadThreadArtifacts(threadIds),
      loadThreadApprovals(threadIds),
    ]);

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

/**
 * POST /api/chat/threads
 *
 * Creates a new chat thread for the authenticated user/company.
 */
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
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const parsed = createThreadSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload: title/messages are malformed" },
        { status: 400 },
      );
    }

    const title = parsed.data.title ?? "New chat";
    const messages = parsed.data.messages ?? [];
    const personaSlug = resolvePersonaSlug(parsed.data.personaSlug, "company");

    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(chatThreads)
        .values({
          companyId,
          userId,
          title,
          messages,
          personaSlug,
        })
        .returning({
          id: chatThreads.id,
          title: chatThreads.title,
          messages: chatThreads.messages,
          createdAt: chatThreads.createdAt,
          updatedAt: chatThreads.updatedAt,
        });

      await syncNormalizedThreadMessages(tx, {
        threadId: created.id,
        companyId,
        userId,
        messages,
      });

      return created;
    });

    await ensureConsultantThreadWorkspace({
      companyId,
      threadId: row.id,
      userId,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }).catch((error) => {
      console.error("Failed to initialize consultant workspace:", error);
    });

    return NextResponse.json(buildChatThreadResponse(row, undefined, [], [], []), {
      status: 201,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
