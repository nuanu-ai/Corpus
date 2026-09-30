import { NextRequest, NextResponse } from "next/server";

import {
  getApiKeyAgentContext,
  handleApiError,
  requireGrantedApiKeyScope,
} from "@/lib/api-auth";
import { filterReportJobAccessibleCompanies } from "@/lib/report-jobs/access";
import { getReportJobArtifactByIdForUser } from "@/lib/report-jobs/store";

function buildDownloadDisposition(fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, "_");
  const encodedFileName = encodeURIComponent(fileName)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName}`;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; artifactId: string }> },
) {
  try {
    const { apiKey, companies } = await getApiKeyAgentContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
    requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");

    const { id, artifactId } = await context.params;
    const artifact = await getReportJobArtifactByIdForUser({
      artifactId,
      jobId: id,
      userId: apiKey.userId,
      accessibleCompanyIds: filterReportJobAccessibleCompanies(companies).map(
        (membership) => membership.companyId,
      ),
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
  } catch (err) {
    return handleApiError(err);
  }
}
