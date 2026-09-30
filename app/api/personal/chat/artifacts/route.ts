import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import {
  getSessionPersonalProjectContext,
  handleApiError,
} from "@/lib/api-auth";
import { db } from "@/lib/db";
import { chatArtifacts, chatThreads } from "@/lib/db/schema";

export async function GET() {
  try {
    const { projectId, userId } = await getSessionPersonalProjectContext();

    const artifacts = await db
      .select({
        id: chatArtifacts.id,
        threadId: chatArtifacts.threadId,
        threadTitle: chatThreads.title,
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
      .innerJoin(chatThreads, eq(chatArtifacts.threadId, chatThreads.id))
      .where(
        and(
          eq(chatArtifacts.companyId, projectId),
          eq(chatThreads.companyId, projectId),
          eq(chatThreads.userId, userId),
        ),
      )
      .orderBy(desc(chatArtifacts.createdAt))
      .limit(500);

    return NextResponse.json(
      artifacts.map((artifact) => ({
        ...artifact,
        threadTitle: artifact.threadTitle ?? "Chat thread",
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
      })),
    );
  } catch (err) {
    return handleApiError(err);
  }
}
