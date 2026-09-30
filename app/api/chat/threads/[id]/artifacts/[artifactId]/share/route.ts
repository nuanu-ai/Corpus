import { and, eq } from "drizzle-orm";
import { basename } from "path";
import { NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { readConsultantArtifactData } from "@/lib/consultant/workspace";
import { createCompanyDocumentFromBytes } from "@/lib/documents/operations";
import { db } from "@/lib/db";
import { chatArtifacts, chatThreads, documents } from "@/lib/db/schema";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const { companyId, userId } = await getSessionCompanyContext();
    const { id: threadId, artifactId } = await params;

    const [thread] = await db
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(
        and(
          eq(chatThreads.id, threadId),
          eq(chatThreads.companyId, companyId),
          eq(chatThreads.userId, userId)
        )
      )
      .limit(1);

    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const [artifact] = await db
      .select({
        id: chatArtifacts.id,
        title: chatArtifacts.title,
        filePath: chatArtifacts.filePath,
        mimeType: chatArtifacts.mimeType,
        metadata: chatArtifacts.metadata,
      })
      .from(chatArtifacts)
      .where(
        and(
          eq(chatArtifacts.id, artifactId),
          eq(chatArtifacts.threadId, threadId),
          eq(chatArtifacts.companyId, companyId)
        )
      )
      .limit(1);

    if (!artifact) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const existingDocumentId =
      typeof artifact.metadata?.sharedDocumentId === "string"
        ? artifact.metadata.sharedDocumentId
        : null;

    if (existingDocumentId) {
      const [existingDocument] = await db
        .select({ id: documents.id, status: documents.status })
        .from(documents)
        .where(
          and(
            eq(documents.id, existingDocumentId),
            eq(documents.companyId, companyId)
          )
        )
        .limit(1);

      if (existingDocument) {
        return NextResponse.json({
          documentId: existingDocument.id,
          alreadyShared: true,
          status: existingDocument.status,
        });
      }
    }

    const artifactFile = await readConsultantArtifactData({
      companyId,
      threadId,
      relativePath: artifact.filePath,
    });

    const created = await createCompanyDocumentFromBytes({
      companyId,
      userId,
      fileName: basename(artifact.filePath),
      mimeType: artifact.mimeType,
      content: artifactFile.content,
      source: "codex_upload",
      ingressSource: "consultant_artifact",
      rawPayload: {
        artifactId,
        artifactTitle: artifact.title,
        threadId,
      },
    });

    await db
      .update(chatArtifacts)
      .set({
        metadata: {
          ...artifact.metadata,
          sharedDocumentId: created.documentId,
          sharedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chatArtifacts.id, artifactId),
          eq(chatArtifacts.threadId, threadId),
          eq(chatArtifacts.companyId, companyId)
        )
      );

    return NextResponse.json({
      documentId: created.documentId,
      status: created.status,
      fileName: created.fileName,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
