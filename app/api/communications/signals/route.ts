import { NextRequest, NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { listPendingSignalsForCompany } from "@/lib/communications/store";

export async function GET(req: NextRequest) {
  try {
    const auth = await getSessionCompanyContext();
    const limitParam = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    const signals = await listPendingSignalsForCompany(auth.companyId, limit);
    return NextResponse.json({
      data: signals,
      count: signals.length,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
