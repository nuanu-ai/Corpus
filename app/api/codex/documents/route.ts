import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import { summarizeCodexPromotion } from "@/lib/codex-worker/promotion";
import { getEffectiveDocumentSource, getCodexSourceContext } from "@/lib/codex-worker/source-context";
import { summarizeCodexState } from "@/lib/codex-worker/status";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.read");
    const { companyId } = auth;
    const limitParam = req.nextUrl.searchParams.get("limit");
    const parsed = Number(limitParam);
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;

    const rows = await db
      .select({
        id: documents.id,
        fileName: documents.fileName,
        fileType: documents.fileType,
        fileSizeBytes: documents.fileSizeBytes,
        source: documents.source,
        status: documents.status,
        error: documents.error,
        confidenceScore: documents.confidenceScore,
        documentType: documents.documentType,
        createdAt: documents.createdAt,
        ocrResult: documents.ocrResult,
      })
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.source, "codex_upload"),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(limit);

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        fileName: row.fileName,
        fileType: row.fileType,
        fileSizeBytes: row.fileSizeBytes,
        source: getEffectiveDocumentSource(row.source, row.ocrResult),
        status: row.status,
        error: row.error,
        confidenceScore: row.confidenceScore,
        documentType: row.documentType,
        createdAt: row.createdAt,
        sourceContext: getCodexSourceContext(row.ocrResult),
        codex: summarizeCodexState(row.ocrResult ?? undefined),
        promotion: summarizeCodexPromotion(row.ocrResult ?? undefined),
      })),
    );
  } catch (err) {
    return handleApiError(err);
  }
}
