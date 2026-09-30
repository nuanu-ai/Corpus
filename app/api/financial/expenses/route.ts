import { NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getFinancialOverview } from "@/lib/queries/financial-overview";
import { toLegacyExpenseBreakdown } from "@/lib/queries/financial-route-adapters";
import { applyFinancialWarningHeaders } from "@/lib/queries/financial-route-warnings";

/**
 * GET /api/financial/expenses
 *
 * Returns expense breakdown by category for the authenticated user's company.
 * Uses the unified finance overview path and synthesizes statement-level rows
 * when transaction categorization is unavailable.
 */
export async function GET() {
  try {
    const auth = await getSessionCompanyContext();
    const overview = await getFinancialOverview(auth.companyId, {
      callerId: auth.userId,
      callerRole: auth.role,
    });
    return applyFinancialWarningHeaders(
      NextResponse.json(toLegacyExpenseBreakdown(overview)),
      overview.warnings,
    );
  } catch (err) {
    return handleApiError(err);
  }
}
