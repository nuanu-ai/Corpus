import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-auth";
import { getPlatformAdminSession } from "@/lib/platform-admin";

export async function POST() {
  try {
    const session = await getPlatformAdminSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json(
        { error: "CRON_SECRET is not configured" },
        { status: 500 }
      );
    }

    const baseUrl = process.env.INTERNAL_APP_URL ?? "http://127.0.0.1:3000";
    const response = await fetch(`${baseUrl}/api/cron/retry-stuck-documents`, {
      method: "POST",
      headers: {
        "x-cron-secret": cronSecret,
      },
      cache: "no-store",
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            typeof payload.error === "string"
              ? payload.error
              : `Retry request failed (${response.status})`,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(payload);
  } catch (err) {
    return handleApiError(err);
  }
}
