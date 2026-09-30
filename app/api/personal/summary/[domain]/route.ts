import { NextResponse } from "next/server";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import {
  isPersonalSummaryDomain,
  loadPersonalSurfaceSummary,
} from "@/lib/company-db/personal-surfaces";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ domain: string }> },
) {
  try {
    const auth = await getSessionPersonalProjectContext();
    const { domain } = await params;

    if (!isPersonalSummaryDomain(domain)) {
      return NextResponse.json({ error: "Unknown personal summary domain" }, { status: 404 });
    }

    const summary = await loadPersonalSurfaceSummary(domain, {
      tenantId: auth.projectId,
      userId: auth.userId,
      role: auth.role,
    });

    return NextResponse.json(
      {
        domain,
        summary: summary
          ? {
              path: summary.path,
              body: summary.body,
              frontmatter: summary.frontmatter,
            }
          : null,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          Vary: "Cookie",
        },
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
