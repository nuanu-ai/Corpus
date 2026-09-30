import { NextRequest, NextResponse } from "next/server";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import { listDocumentsForCompany } from "@/lib/documents/operations";

export async function GET(req: NextRequest) {
  try {
    const auth = await getSessionPersonalProjectContext();
    const limitParam = req.nextUrl.searchParams.get("limit");
    const offsetParam = req.nextUrl.searchParams.get("offset");
    const parsedLimit = Number(limitParam);
    const parsedOffset = Number(offsetParam);
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (req.nextUrl ? req.nextUrl.origin : new URL(req.url).origin);

    const result = await listDocumentsForCompany({
      companyId: auth.projectId,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
      offset: Number.isFinite(parsedOffset) ? parsedOffset : 0,
      baseUrl,
      downloadPathPrefix: "/api/personal/documents",
    });

    return NextResponse.json(result.documents, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
