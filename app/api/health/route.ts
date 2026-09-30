import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const COMPANY_DB_BASE =
  process.env.COMPANY_DB_REST_URL ?? "http://localhost:3100";

export async function GET() {
  const services: Record<string, "ok" | "unreachable"> = {
    database: "unreachable",
    companyDb: "unreachable",
  };

  // Check database connection
  try {
    await db.execute(sql`SELECT 1`);
    services.database = "ok";
  } catch {
    // leave as "unreachable"
  }

  // Check Company-DB health
  try {
    const res = await fetch(`${COMPANY_DB_BASE}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      services.companyDb = "ok";
    }
  } catch {
    // leave as "unreachable"
  }

  const allOk = Object.values(services).every((s) => s === "ok");

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      services,
    },
    { status: allOk ? 200 : 503 },
  );
}
