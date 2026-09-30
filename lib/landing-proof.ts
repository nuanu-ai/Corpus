import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import type { LandingIconName } from "@/lib/landing-copy";

export type LandingCustomerProof = {
  companyCount: number;
  companyCountText: string;
  companies: Array<{
    name: string;
    icon: LandingIconName;
  }>;
};

const PUBLIC_COMPANY_COUNT_FALLBACK = 0;

const FEATURED_COMPANIES: LandingCustomerProof["companies"] = [
  { name: "Example Holdings", icon: "compass" },
  { name: "Project Northstar", icon: "droplet" },
  { name: "Project Beacon", icon: "leaf" },
];

function formatCompanyCount(count: number): string {
  return `${Math.max(0, count)}`;
}

function isProductionLikeCount(count: number): boolean {
  return count >= 0;
}

export async function getLandingCustomerProof(): Promise<LandingCustomerProof> {
  let companyCount = PUBLIC_COMPANY_COUNT_FALLBACK;

  if (process.env.DATABASE_URL) {
    try {
      const [row] = await db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(companies)
        .where(
          and(
            eq(companies.tenantKind, "company"),
            sql`
              not (
                lower(coalesce(${companies.name}, '')) like any (array[
                  '%codex%',
                  '%smoke%',
                  '%debug%',
                  '%prompt%',
                  '%locale check%',
                  '%test cfo%'
                ])
                or lower(coalesce(${companies.slug}, '')) like any (array[
                  '%codex%',
                  '%smoke%',
                  '%debug%',
                  '%prompt%',
                  '%locale-check%',
                  '%test-cfo%'
                ])
                or coalesce(${companies.settings}->>'mockDesign', 'false') = 'true'
              )
            `,
          ),
        );

      const liveCount = Number(row?.count ?? 0);
      if (Number.isFinite(liveCount) && isProductionLikeCount(liveCount)) {
        companyCount = liveCount;
      }
    } catch (error) {
      console.error("[landing] failed to load customer proof", error);
    }
  }

  return {
    companyCount,
    companyCountText: formatCompanyCount(companyCount),
    companies: FEATURED_COMPANIES,
  };
}
