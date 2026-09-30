import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { landingLeads } from "@/lib/db/schema";
import { getPlatformAdminSession } from "@/lib/platform-admin";

export async function GET() {
  try {
    const session = await getPlatformAdminSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const leads = await db
      .select({
        id: landingLeads.id,
        intent: landingLeads.intent,
        plan: landingLeads.plan,
        email: landingLeads.email,
        name: landingLeads.name,
        companyName: landingLeads.companyName,
        message: landingLeads.message,
        locale: landingLeads.locale,
        path: landingLeads.path,
        referrer: landingLeads.referrer,
        utmSource: landingLeads.utmSource,
        utmMedium: landingLeads.utmMedium,
        utmCampaign: landingLeads.utmCampaign,
        createdAt: landingLeads.createdAt,
      })
      .from(landingLeads)
      .orderBy(desc(landingLeads.createdAt))
      .limit(200);

    return NextResponse.json({ leads }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
