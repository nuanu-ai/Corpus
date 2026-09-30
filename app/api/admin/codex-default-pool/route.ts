import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-auth";
import {
  isCodexWorkerPool,
  resolveDefaultCodexWorkerPool,
} from "@/lib/codex-worker/pool";
import { db } from "@/lib/db";
import { platformSettings } from "@/lib/db/schema";
import { getPlatformAdminSession } from "@/lib/platform-admin";

const CODEX_ROUTING_PLATFORM_SETTINGS_KEY = "codex_routing";

export async function GET() {
  try {
    const session = await getPlatformAdminSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const pool = await resolveDefaultCodexWorkerPool();
    return NextResponse.json({ pool });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getPlatformAdminSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { pool?: string }
      | null;

    if (!isCodexWorkerPool(body?.pool ?? null)) {
      return NextResponse.json({ error: "pool must be 'chatgpt' or 'api_key'" }, { status: 400 });
    }

    const pool = body!.pool;

    await db
      .insert(platformSettings)
      .values({
        key: CODEX_ROUTING_PLATFORM_SETTINGS_KEY,
        value: { defaultPool: pool },
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: {
          value: { defaultPool: pool },
          updatedAt: new Date(),
        },
      });

    await db.execute(sql`
      update companies
      set
        settings = jsonb_set(
          coalesce(settings, '{}'::jsonb),
          '{codexWorkerPool}',
          to_jsonb(${pool}::text),
          true
        ),
        updated_at = now()
    `);

    return NextResponse.json({
      success: true,
      pool,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
