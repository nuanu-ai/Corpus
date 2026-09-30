import { NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getAccountBalances } from "@/lib/queries/financial-summary";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { attachReportingBalances } from "@/lib/fx/reporting-balances";
import { applyFinancialWarningHeaders } from "@/lib/queries/financial-route-warnings";

/**
 * GET /api/financial/accounts
 *
 * Returns account balances across all connections for the authenticated
 * user's company. Queries PG canonical_txns directly.
 */
export async function GET() {
  try {
    const auth = await getSessionCompanyContext();
    const { companyId } = auth;
    const [data, companyRow] = await Promise.all([
      getAccountBalances(companyId),
      db
        .select({ reportingCurrency: companies.reportingCurrency })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    const reportingCurrency = companyRow?.reportingCurrency ?? "USD";
    const balancesWithReporting = await attachReportingBalances(data, reportingCurrency);
    const untrustedBalanceCount = balancesWithReporting.filter((row) => !row.balanceUsdTrusted).length;

    return applyFinancialWarningHeaders(
      NextResponse.json(
        balancesWithReporting.map((row) => ({
        connectionId: row.connectionId,
        provider: row.provider,
        currency: row.currency,
        balance: row.nativeBalance,
        nativeBalance: row.nativeBalance,
        balanceUsd: row.balanceUsd,
        balanceUsdTrusted: row.balanceUsdTrusted,
        untrustedTxnCount: row.untrustedTxnCount,
        reportingCurrency: row.reportingCurrency,
        reportingRate: row.reportingRate,
        reportingBalance: row.reportingBalance,
        lastSyncAt: row.lastSyncAt,
        })),
      ),
      untrustedBalanceCount > 0
        ? [
            `${untrustedBalanceCount} account balance${
              untrustedBalanceCount === 1 ? "" : "s"
            } excluded from ${reportingCurrency} totals until FX rates are available`,
          ]
        : [],
    );
  } catch (err) {
    return handleApiError(err);
  }
}
