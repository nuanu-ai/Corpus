import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, handleApiError, requireApiKeyScope } from "@/lib/api-auth";
import { listDocumentsForCompany } from "@/lib/documents/operations";
import { resolveAgentSafeDocumentLimit } from "@/lib/company-db/agent-safe-defaults";

/**
 * GET /api/documents?limit=50
 *
 * Returns the list of documents for the authenticated user's company,
 * ordered by createdAt DESC unless attentionFirst=1 is requested.
 * Queries PG documents table directly.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthContext();
    requireApiKeyScope(auth, "documents.read");
    const { companyId } = auth;

    const limitParam = req.nextUrl.searchParams.get("limit");
    const offsetParam = req.nextUrl.searchParams.get("offset");
    const attentionFirstParam = req.nextUrl.searchParams.get("attentionFirst");
    const parsed = Number(limitParam);
    const parsedOffset = Number(offsetParam);
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (req.nextUrl ? req.nextUrl.origin : new URL(req.url).origin);
    const result = await listDocumentsForCompany({
      companyId,
      limit: resolveAgentSafeDocumentLimit(
        auth.authMethod,
        Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
      ),
      offset: Number.isFinite(parsedOffset) ? parsedOffset : 0,
      attentionFirst: attentionFirstParam === "1" || attentionFirstParam === "true",
      baseUrl,
    });

    return NextResponse.json(result.documents);
  } catch (err) {
    return handleApiError(err);
  }
}
