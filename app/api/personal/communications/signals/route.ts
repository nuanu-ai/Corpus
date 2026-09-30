import { NextRequest, NextResponse } from "next/server";

import { getSessionPersonalProjectContext, handleApiError } from "@/lib/api-auth";
import { loadPersonalPendingSignals } from "@/lib/company-db/personal-surfaces";

export async function GET(req: NextRequest) {
  try {
    const auth = await getSessionPersonalProjectContext();
    const limitParam = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "200", 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 200;
    const signals = await loadPersonalPendingSignals(auth.projectId, limit);

    return NextResponse.json(
      {
        data: signals,
        count: signals.length,
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
