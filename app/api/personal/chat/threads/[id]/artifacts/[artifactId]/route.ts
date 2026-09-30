import { basename } from "path";

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import {
  getSessionPersonalProjectContext,
  handleApiError,
} from "@/lib/api-auth";
import {
  readConsultantArtifactData,
  readConsultantArtifactFile,
} from "@/lib/consultant/workspace";
import { db } from "@/lib/db";
import { chatArtifacts, chatThreads } from "@/lib/db/schema";

const MAX_PREVIEW_CONTENT_CHARS = 200_000;

function isPreviewableArtifact(filePath: string, mimeType: string | null): boolean {
  const lowerPath = filePath.toLowerCase();
  const lowerMime = mimeType?.toLowerCase() ?? "";

  if (
    lowerMime.startsWith("text/") ||
    lowerMime.includes("json") ||
    lowerMime.includes("markdown")
  ) {
    return true;
  }

  return [".md", ".qmd", ".txt", ".json", ".csv", ".tsv"].some((extension) =>
    lowerPath.endsWith(extension),
  );
}

function buildDownloadDisposition(filePath: string): string {
  const fileName = basename(filePath);
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_");
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  try {
    const { projectId: companyId, userId } = await getSessionPersonalProjectContext();
    const { id, artifactId } = await params;

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

    const [artifact] = await db
      .select({
        id: chatArtifacts.id,
        kind: chatArtifacts.kind,
        title: chatArtifacts.title,
        filePath: chatArtifacts.filePath,
        mimeType: chatArtifacts.mimeType,
        status: chatArtifacts.status,
        metadata: chatArtifacts.metadata,
        createdAt: chatArtifacts.createdAt,
        updatedAt: chatArtifacts.updatedAt,
      })
      .from(chatArtifacts)
      .where(
        and(
          eq(chatArtifacts.id, artifactId),
          eq(chatArtifacts.threadId, id),
          eq(chatArtifacts.companyId, companyId),
        ),
      )
      .limit(1);

    if (!artifact) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    const download = req.nextUrl.searchParams.get("download") === "1";
    const previewable = isPreviewableArtifact(artifact.filePath, artifact.mimeType);

    if (download) {
      const file = await readConsultantArtifactData({
        companyId,
        threadId: id,
        relativePath: artifact.filePath,
      });

      return new NextResponse(new Uint8Array(file.content), {
        headers: {
          "Content-Type": artifact.mimeType ?? "application/octet-stream",
          "Content-Disposition": buildDownloadDisposition(artifact.filePath),
          "Cache-Control": "private, no-store",
        },
      });
    }

    if (!previewable) {
      return NextResponse.json({
        ...artifact,
        content: null,
        previewable: false,
        createdAt: artifact.createdAt.toISOString(),
        updatedAt: artifact.updatedAt.toISOString(),
      });
    }

    const file = await readConsultantArtifactFile({
      companyId,
      threadId: id,
      relativePath: artifact.filePath,
    });
    const content =
      file.content.length > MAX_PREVIEW_CONTENT_CHARS
        ? `${file.content.slice(0, MAX_PREVIEW_CONTENT_CHARS).trimEnd()}\n\n...[truncated; download the artifact for the full file]`
        : file.content;

    return NextResponse.json({
      ...artifact,
      content,
      truncated: content !== file.content,
      previewable: true,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
