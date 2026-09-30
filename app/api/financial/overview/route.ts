import { NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getFinancialOverview } from "@/lib/queries/financial-overview";

function clampMonths(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 24;
  return Math.min(Math.max(Math.trunc(parsed), 1), 60);
}

export async function GET(request: Request) {
  try {
    const auth = await getSessionCompanyContext();
    const url = new URL(request.url);
    const months = clampMonths(url.searchParams.get("months"));
    const overview = await getFinancialOverview(auth.companyId, {
      callerId: `dashboard-${auth.companyId}`,
      callerRole: auth.role,
      months,
    });

    return NextResponse.json(overview);
  } catch (err) {
    return handleApiError(err);
  }
}
