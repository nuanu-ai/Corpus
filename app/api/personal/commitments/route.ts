import { NextRequest, NextResponse } from "next/server";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import {
  loadPersonalCommitmentsFeed,
  loadPersonalSurfaceSummary,
} from "@/lib/company-db/personal-surfaces";

export async function GET(req: NextRequest) {
  try {
    const auth = await getSessionPersonalProjectContext();
    const limitParam = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;
    const context = {
      tenantId: auth.projectId,
      userId: auth.userId,
      role: auth.role,
    };

    const [summary, items] = await Promise.all([
      loadPersonalSurfaceSummary("commitments", context),
      loadPersonalCommitmentsFeed(context, limit),
    ]);

    return NextResponse.json(
      {
        data: items,
        count: items.length,
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
