import { NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getConnectionSummaries } from "@/lib/queries/accounts";
import { applyFinancialWarningHeaders } from "@/lib/queries/financial-route-warnings";

export async function GET() {
  try {
    const auth = await getSessionCompanyContext();
    const { companyId } = auth;
    const summaries = await getConnectionSummaries(companyId);
    const untrustedConnectionCount = summaries.filter((summary) => !summary.usdTotalsTrusted).length;
    const warnings =
      untrustedConnectionCount > 0
        ? [
            `${untrustedConnectionCount} account connection${
              untrustedConnectionCount === 1 ? "" : "s"
            } excluded from USD totals until FX rates are available`,
          ]
        : [];
    return applyFinancialWarningHeaders(NextResponse.json(summaries), warnings);
  } catch (err) {
    return handleApiError(err);
  }
}
