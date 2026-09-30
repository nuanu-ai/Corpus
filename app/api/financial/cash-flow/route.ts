import { NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getFinancialOverview } from "@/lib/queries/financial-overview";
import { toLegacyCashFlowSummary } from "@/lib/queries/financial-route-adapters";
import { applyFinancialWarningHeaders } from "@/lib/queries/financial-route-warnings";

/**
 * GET /api/financial/cash-flow
 *
 * Returns monthly cash flow (inflows/outflows/net) for the last 12 months.
 * Uses the unified finance overview path.
 */
export async function GET() {
  try {
    const auth = await getSessionCompanyContext();
    const overview = await getFinancialOverview(auth.companyId, {
      callerId: auth.userId,
      callerRole: auth.role,
    });
    return applyFinancialWarningHeaders(
      NextResponse.json(toLegacyCashFlowSummary(overview)),
      overview.warnings,
    );
  } catch (err) {
    return handleApiError(err);
  }
}
