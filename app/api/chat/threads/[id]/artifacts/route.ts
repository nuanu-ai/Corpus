import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { chatArtifacts, chatThreads } from "@/lib/db/schema";
import {
  ensureConsultantThreadWorkspace,
  writeConsultantArtifactFile,
} from "@/lib/consultant/workspace";

const createArtifactSchema = z.object({
  title: z.string().trim().min(1).max(160),
  kind: z.string().trim().min(1).max(80),
  content: z.string().max(1_000_000),
  fileName: z.string().trim().min(1).max(180).optional(),
  mimeType: z.string().trim().min(1).max(120).optional(),
  uiMessageId: z.string().trim().min(1).max(120).optional(),
  destination: z.enum(["artifacts", "proposals", "exports"]).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const { id } = await params;

    const [thread] = await db
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.id, id),
          eq(chatThreads.companyId, companyId),
          eq(chatThreads.userId, userId),
        ),
      )
      .limit(1);

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const artifacts = await db
      .select({
        id: chatArtifacts.id,
        kind: chatArtifacts.kind,
        title: chatArtifacts.title,
        filePath: chatArtifacts.filePath,
        mimeType: chatArtifacts.mimeType,
        status: chatArtifacts.status,
        uiMessageId: chatArtifacts.uiMessageId,
        metadata: chatArtifacts.metadata,
        createdAt: chatArtifacts.createdAt,
        updatedAt: chatArtifacts.updatedAt,
      })
      .from(chatArtifacts)
      .where(
        and(
          eq(chatArtifacts.threadId, id),
          eq(chatArtifacts.companyId, companyId),
        ),
      )
      .orderBy(desc(chatArtifacts.createdAt));

    return NextResponse.json(
      artifacts.map((artifact) => ({
        ...artifact,
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
      })),
    );
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const { id } = await params;

    const body = await req.json().catch(() => null);
    const parsed = createArtifactSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid artifact payload" }, { status: 400 });
    }

    const [thread] = await db
      .select({
        id: chatThreads.id,
        title: chatThreads.title,
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

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    await ensureConsultantThreadWorkspace({
      companyId,
      threadId: thread.id,
      userId,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    });

    const file = await writeConsultantArtifactFile({
      companyId,
      threadId: thread.id,
      title: parsed.data.title,
      content: parsed.data.content,
      fileName: parsed.data.fileName,
      destination: parsed.data.destination,
    });

    const [artifact] = await db
      .insert(chatArtifacts)
      .values({
        threadId: thread.id,
        companyId,
        uiMessageId: parsed.data.uiMessageId,
        kind: parsed.data.kind,
        title: parsed.data.title,
        filePath: file.relativePath,
        mimeType: parsed.data.mimeType,
        status: parsed.data.destination === "proposals" ? "pending_approval" : "draft",
        metadata: {
          rootPath: file.rootPath,
          destination: parsed.data.destination ?? "artifacts",
        },
      })
      .returning({
        id: chatArtifacts.id,
        kind: chatArtifacts.kind,
        title: chatArtifacts.title,
        filePath: chatArtifacts.filePath,
        mimeType: chatArtifacts.mimeType,
        status: chatArtifacts.status,
        uiMessageId: chatArtifacts.uiMessageId,
        metadata: chatArtifacts.metadata,
        createdAt: chatArtifacts.createdAt,
        updatedAt: chatArtifacts.updatedAt,
      });

    return NextResponse.json(
      {
        ...artifact,
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
