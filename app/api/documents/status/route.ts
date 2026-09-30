import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";

/**
 * GET /api/documents/status?documentId=<uuid>
 *
 * Returns the processing status of an uploaded document, including
 * extracted transaction count and confidence score when processing is complete.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.read");
    const { companyId } = auth;

    const documentId = req.nextUrl.searchParams.get("documentId");
    if (!documentId) {
      return NextResponse.json(
        { error: "documentId query parameter is required" },
        { status: 400 },
      );
    }

    const [doc] = await db
      .select({
        id: documents.id,
        fileName: documents.fileName,
        fileType: documents.fileType,
        status: documents.status,
        extractedTxnCount: documents.extractedTxnCount,
        confidenceScore: documents.confidenceScore,
        error: documents.error,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.companyId, companyId),
        ),
      );

    if (!doc) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(doc);
  } catch (err) {
    return handleApiError(err);
  }
}
