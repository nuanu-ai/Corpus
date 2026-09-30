import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError } from "@/lib/api-auth";
import {
  approveReportJobArtifact,
  rejectReportJobArtifact,
} from "@/lib/report-jobs/review";
import { getReportJobArtifactForRoutine } from "@/lib/report-jobs/store";
import {
  requireRoutineDomainAccess,
  requireRoutineReviewAccess,
} from "@/lib/routines/api-access";
import { getCompanyRoutine } from "@/lib/routines/store";

function buildDownloadDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_");
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ routineId: string; jobId: string; artifactId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId, jobId, artifactId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineDomainAccess(auth, routine, "read");

    const artifact = await getReportJobArtifactForRoutine({
      companyId: auth.companyId,
      routineId,
      jobId,
      artifactId,
    });
    if (!artifact) {
      return NextResponse.json({ error: "Report artifact not found" }, { status: 404 });
    }

    const metadata = artifact.metadata ?? {};
    const previewable = metadata.previewable === true;
    const download = req.nextUrl.searchParams.get("download") === "1";
    const textContent = typeof metadata.textContent === "string" ? metadata.textContent : null;
    const base64Content =
      typeof metadata.base64Content === "string" ? metadata.base64Content : null;

    if (download && textContent !== null) {
      return new NextResponse(textContent, {
        headers: {
          "Content-Type": artifact.mimeType ?? "text/plain; charset=utf-8",
          "Content-Disposition": buildDownloadDisposition(artifact.fileName),
          "Cache-Control": "private, no-store",
        },
      });
    }

    if (download && base64Content !== null) {
      return new NextResponse(Buffer.from(base64Content, "base64"), {
        headers: {
          "Content-Type": artifact.mimeType ?? "application/octet-stream",
          "Content-Disposition": buildDownloadDisposition(artifact.fileName),
          "Cache-Control": "private, no-store",
        },
      });
    }

    return NextResponse.json({
      ...artifact,
      previewable,
      content: previewable ? textContent : null,
      createdAt: artifact.createdAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function reviewConflictMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const isConflict =
    error.message.includes("already") ||
    error.message.includes("no longer pending") ||
    error.message.includes("claim was lost");
  return isConflict ? error.message : null;
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ routineId: string; jobId: string; artifactId: string }> },
) {
  try {
    const auth = await getAuthContext();
    const { routineId, jobId, artifactId } = await context.params;
    const routine = await getCompanyRoutine(auth.companyId, routineId);
    if (!routine) return NextResponse.json({ error: "Routine not found" }, { status: 404 });
    requireRoutineReviewAccess(auth, routine);

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";
    const reviewReason = typeof body.reviewReason === "string" ? body.reviewReason : null;

    if (action === "reject") {
      try {
        const artifact = await rejectReportJobArtifact({
          companyId: auth.companyId,
          routineId,
          jobId,
          artifactId,
          reviewedBy: auth.userId,
          reviewReason,
        });
        return NextResponse.json({ artifact, status: "rejected" });
      } catch (error) {
        const conflict = reviewConflictMessage(error);
        if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });
        throw error;
      }
    }

    if (action === "approve") {
      try {
        const result = await approveReportJobArtifact({
          companyId: auth.companyId,
          routineId,
          routineSlug: routine.slug,
          routineTitle: routine.title,
          routineDomain: routine.domain,
          jobId,
          artifactId,
          reviewedBy: auth.userId,
          reviewReason,
        });
        return NextResponse.json({
          artifact: result.artifact,
          status: "approved",
          commitSha: result.commitSha,
          publishedTargetDomain: result.publishedTargetDomain,
          publishedTargetPath: result.publishedTargetPath,
        });
      } catch (error) {
        const conflict = reviewConflictMessage(error);
        if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });
        throw error;
      }
    }

    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
