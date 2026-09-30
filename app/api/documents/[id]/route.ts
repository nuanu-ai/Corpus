import { NextRequest, NextResponse } from "next/server";

import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import { deleteDocumentForCompany } from "@/lib/documents/operations";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.write");
    const { id } = await params;
    const result = await deleteDocumentForCompany({
      companyId: auth.companyId,
      userId: auth.userId,
      role: auth.role,
      documentId: id,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === "Document not found") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    return handleApiError(error);
  }
}
