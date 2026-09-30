import { randomUUID } from "crypto";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { chatArtifacts } from "@/lib/db/schema";

import { listCodexChatArtifacts } from "./workspace";

type DbExecutor = Pick<typeof db, "select" | "insert" | "update">;

export async function syncCodexChatThreadArtifacts(input: {
  companyId: string;
  userId: string;
  threadId: string;
  uiMessageId?: string | null;
  executor?: DbExecutor;
}): Promise<void> {
  const executor = input.executor ?? db;
  const workspaceArtifacts = await listCodexChatArtifacts({
    companyId: input.companyId,
    userId: input.userId,
    threadId: input.threadId,
  });

  const existingArtifacts = await executor
    .select({
      id: chatArtifacts.id,
      filePath: chatArtifacts.filePath,
    })
    .from(chatArtifacts)
    .where(
      and(
        eq(chatArtifacts.threadId, input.threadId),
        eq(chatArtifacts.companyId, input.companyId),
        inArray(chatArtifacts.kind, ["codex_file", "codex_workspace_artifact"]),
      ),
    );

  const existingByPath = new Map(existingArtifacts.map((artifact) => [artifact.filePath, artifact.id]));
  const nextArtifactPaths = new Set(workspaceArtifacts.map((artifact) => artifact.filePath));

  for (const artifact of workspaceArtifacts) {
    const metadata = {
      sizeBytes: artifact.sizeBytes,
      modifiedAt: artifact.modifiedAt,
      fileName: artifact.fileName,
    } satisfies Record<string, unknown>;

    const existingId = existingByPath.get(artifact.filePath);
    if (existingId) {
      await executor
        .update(chatArtifacts)
        .set({
          title: artifact.title,
          mimeType: artifact.mimeType,
          status: "ready",
          uiMessageId: input.uiMessageId ?? null,
          metadata,
          updatedAt: new Date(),
        })
        .where(eq(chatArtifacts.id, existingId));
      continue;
    }

    await executor.insert(chatArtifacts).values({
      id: randomUUID(),
      threadId: input.threadId,
      companyId: input.companyId,
      uiMessageId: input.uiMessageId ?? null,
      kind: "codex_workspace_artifact",
      title: artifact.title,
      filePath: artifact.filePath,
      mimeType: artifact.mimeType,
      status: "ready",
      metadata,
    });
  }

  const missingArtifactIds = existingArtifacts
    .filter((artifact) => !nextArtifactPaths.has(artifact.filePath))
    .map((artifact) => artifact.id);

  if (missingArtifactIds.length > 0) {
    await executor
      .update(chatArtifacts)
      .set({
        status: "missing",
        updatedAt: new Date(),
      })
      .where(inArray(chatArtifacts.id, missingArtifactIds));
  }
}
