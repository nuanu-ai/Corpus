import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-auth";
import { isCodexWorkerPool } from "@/lib/codex-worker/pool";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { getPlatformAdminSession } from "@/lib/platform-admin";

export async function PATCH(request: Request) {
  try {
    const session = await getPlatformAdminSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { companyId?: string; pool?: string }
      | null;

    const companyId = typeof body?.companyId === "string" ? body.companyId.trim() : "";
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    if (!isCodexWorkerPool(body?.pool ?? null)) {
      return NextResponse.json({ error: "pool must be 'chatgpt' or 'api_key'" }, { status: 400 });
    }
    const pool = body?.pool;
    const [company] = await db
      .select({ id: companies.id, settings: companies.settings })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // DATA-3: path-scoped write — only touch settings.codexWorkerPool.
    await db
      .update(companies)
      .set({
        settings: sql`
          jsonb_set(
            COALESCE(${companies.settings}, '{}'::jsonb),
            '{codexWorkerPool}',
            ${JSON.stringify(pool)}::jsonb,
            true
          )
        `,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));

    return NextResponse.json({
      success: true,
      companyId,
      pool,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
