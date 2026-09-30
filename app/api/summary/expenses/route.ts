import { NextRequest, NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getFinancialOverview } from "@/lib/queries/financial-overview";
import { toLegacyExpenseBreakdown } from "@/lib/queries/financial-route-adapters";
import { applyFinancialWarningHeaders } from "@/lib/queries/financial-route-warnings";

export async function GET(request: NextRequest) {
  try {
    const auth = await getSessionCompanyContext();
    const monthParam = request.nextUrl.searchParams.get("month");
    let month: Date | undefined;
    if (monthParam) {
      const parsed = new Date(monthParam);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid month parameter" }, { status: 400 });
      }
      month = parsed;
    }

    const overview = await getFinancialOverview(auth.companyId, {
      callerId: auth.userId,
      callerRole: auth.role,
    });
    const expenses = toLegacyExpenseBreakdown(overview, month);
    return applyFinancialWarningHeaders(NextResponse.json(expenses), overview.warnings);
  } catch (err) {
    return handleApiError(err);
  }
}
