import { and, desc, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { queryAllEntities } from "@/lib/company-db/client";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { buildDashboardCommitmentsFeed } from "@/lib/communications/commitments";
import { coerceTelegramConnectionMetadata } from "@/lib/connectors/telegram";
import { db } from "@/lib/db";
import { companies, connections } from "@/lib/db/schema";

export async function GET() {
  try {
    const auth = await getSessionCompanyContext();

    const [companyRow, telegramConnection] = await Promise.all([
      db
        .select({ companyDbPort: companies.companyDbPort })
        .from(companies)
        .where(eq(companies.id, auth.companyId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({
          id: connections.id,
          metadata: connections.metadata,
        })
        .from(connections)
        .where(
          and(
            eq(connections.companyId, auth.companyId),
            eq(connections.provider, "telegram"),
            ne(connections.status, "disconnected"),
          ),
        )
        .orderBy(desc(connections.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    const companySlug = await getCompanySlug(auth.companyId);
    const port = companyRow?.companyDbPort ?? 3100;

    const records = await queryAllEntities(
      {
        domain: "communications",
        type: "communication_signal",
        view: "summary",
      },
      {
        companySlug,
        callerId: auth.userId,
        callerRole: auth.role,
        port,
      },
    );

    const telegramMetadata = telegramConnection
      ? coerceTelegramConnectionMetadata(telegramConnection.metadata)
      : { phone: "", syncedChats: [] };
    const enabledChatCount = telegramMetadata.syncedChats.filter(
      (chat) => chat.enabled,
    ).length;
    const items = buildDashboardCommitmentsFeed(records, {
      provider: "telegram",
      limit: 120,
    });

    return NextResponse.json({
      data: items,
      count: items.length,
      telegramConnected: Boolean(telegramConnection),
      enabledChatCount,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
