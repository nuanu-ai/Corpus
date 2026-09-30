import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import { reprocessDocumentForCompany } from "@/lib/documents/operations";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.write");
    const { id } = await params;

    const result = await reprocessDocumentForCompany({
      companyId: auth.companyId,
      userId: auth.userId,
      role: auth.role,
      documentId: id,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Document not found") {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
      if (
        error.message === "Document is already processing" ||
        error.message === "Original file is not available for reprocessing"
      ) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
    }
    return handleApiError(error);
  }
}
