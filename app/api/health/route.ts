import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { isNotNull, ne, or } from "drizzle-orm";
import { isCompanyDbReady } from "@/lib/company-db/readiness";

export async function GET() {
  const services: Record<string, "ok" | "unreachable" | "idle"> = {
    database: "unreachable", companyDb: "unreachable",
  };
  try {
    const tenants = await db.select({ slug: companies.slug, port: companies.companyDbPort }).from(companies)
      .where(or(isNotNull(companies.slug), ne(companies.provisioningStatus, "pending")));
    services.database = "ok";
    const readiness = await Promise.all(tenants.map(({ slug, port }) =>
      slug ? isCompanyDbReady(port, slug) : Promise.resolve(false),
    ));
    services.companyDb = tenants.length === 0 ? "idle"
      : readiness.every(Boolean) ? "ok" : "unreachable";
  } catch { /* database remains unreachable */ }
  const healthy = Object.values(services).every((status) => status !== "unreachable");
  return NextResponse.json({ status: healthy ? "ok" : "degraded", services }, {
    status: healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
