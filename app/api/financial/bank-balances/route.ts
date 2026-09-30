import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { queryEntitiesWithCount } from "@/lib/company-db/client";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { selectLatestBankBalanceSnapshot } from "@/lib/queries/bank-balance-snapshot";

/**
 * GET /api/financial/bank-balances
 *
 * Returns the latest uploaded bank-balance snapshot from Company-DB.
 * Source documents are CFO daily bank balance workbooks, promoted through
 * the same staging/write-queue path as other Company-DB artifacts.
 */
export async function GET() {
  try {
    const auth = await getSessionCompanyContext();
    const [company] = await db
      .select({
        slug: companies.slug,
        companyDbPort: companies.companyDbPort,
      })
      .from(companies)
      .where(eq(companies.id, auth.companyId))
      .limit(1);

    if (!company?.slug) {
      return NextResponse.json({ snapshot: null, snapshotCount: 0 });
    }

    const result = await queryEntitiesWithCount(
      {
        domain: "finance",
        type: "bank_balance_snapshot",
        limit: 100,
        view: "full",
      },
      {
        companySlug: company.slug,
        port: company.companyDbPort ?? 3100,
        callerId: `dashboard-${auth.userId}`,
        callerRole: auth.role,
      },
    ).catch(() => ({ data: [], count: 0 }));

    return NextResponse.json(selectLatestBankBalanceSnapshot(result.data));
  } catch (err) {
    return handleApiError(err);
  }
}
