import { NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getFinancialOverview } from "@/lib/queries/financial-overview";
import { toLegacyPnLRoutePayload } from "@/lib/queries/financial-route-adapters";
import { applyFinancialWarningHeaders } from "@/lib/queries/financial-route-warnings";

/**
 * GET /api/financial/pnl
 *
 * Returns the P&L summary (revenue, expenses, netProfit, month-over-month changes)
 * for the authenticated user's company. Uses the unified finance overview path.
 */
export async function GET() {
  try {
    const auth = await getSessionCompanyContext();
    const data = await getFinancialOverview(auth.companyId, {
      callerId: auth.userId,
      callerRole: auth.role,
    });
    return applyFinancialWarningHeaders(
      NextResponse.json(toLegacyPnLRoutePayload(data)),
      data.warnings,
    );
  } catch (err) {
    return handleApiError(err);
  }
}
