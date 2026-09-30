import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { markNotificationRead, markAllRead } from "@/lib/notifications";

export async function GET() {
  try {
    const auth = await getSessionCompanyContext();
    const { companyId } = auth;

    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.companyId, companyId),
          isNull(notifications.resolvedAt)
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    return NextResponse.json(rows);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const auth = await getSessionCompanyContext();
    const { companyId } = auth;
    const body = (await req.json()) as {
      notificationId?: string;
      markAll?: boolean;
    };

    if (body.markAll) {
      const count = await markAllRead(companyId);
      return NextResponse.json({ updated: count });
    }

    if (body.notificationId) {
      const success = await markNotificationRead(body.notificationId, companyId);
      if (!success) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "Missing notificationId or markAll" },
      { status: 400 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
