import { eq, and, inArray } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { getConnectionCredentials } from "@/lib/connections";
import {
  fetchGoogleAdsReport,
  fetchMetaAdsReport,
  fetchTikTokAdsReport,
  normalizeAdSpend,
} from "@/lib/connectors/ad-platforms";
import type { AdSpendReport } from "@/lib/connectors/ad-platforms";
import { db } from "@/lib/db";
import { connections, rawEvents, canonicalTxns } from "@/lib/db/schema";
import { buildCanonicalTxnWriteValues } from "@/lib/canonical-txns";

const AD_PROVIDERS = ["google_ads", "meta_ads", "tiktok_ads"] as const;

/**
 * Fetch yesterday's ad spend report for a connection using the appropriate API.
 */
async function fetchReportForConnection(
  provider: string,
  accessToken: string,
  externalAccountId: string,
  startDate: string,
  endDate: string
): Promise<AdSpendReport[]> {
  switch (provider) {
    case "google_ads":
      return fetchGoogleAdsReport(
        accessToken,
        externalAccountId,
        startDate,
        endDate
      );
    case "meta_ads":
      return fetchMetaAdsReport(
        accessToken,
        externalAccountId,
        startDate,
        endDate
      );
    case "tiktok_ads":
      return fetchTikTokAdsReport(
        accessToken,
        externalAccountId,
        startDate,
        endDate
      );
    default:
      throw new Error(`Unknown ad provider: ${provider}`);
  }
}

/**
 * Insert raw events and canonical transactions for a list of ad spend reports.
 */
async function insertAdSpendRows(
  reports: AdSpendReport[],
  companyId: string,
  connectionId: string,
  provider: string
): Promise<number> {
  let added = 0;

  for (const report of reports) {
    const idempotencyKey = `${provider}:${report.campaignId}:${report.date}`;

    const inserted = await db.transaction(async (tx) => {
      const [rawRow] = await tx
        .insert(rawEvents)
        .values({
          companyId,
          connectionId,
          sourceEventId: `${report.campaignId}:${report.date}`,
          idempotencyKey,
          source: provider,
          eventType: "ad_spend",
          rawPayload: report as unknown as Record<string, unknown>,
        })
        .onConflictDoNothing()
        .returning({ id: rawEvents.id });

      if (!rawRow) return false;

      const normalized = normalizeAdSpend(report);
      await tx.insert(canonicalTxns).values(await buildCanonicalTxnWriteValues({
        companyId,
        rawEventId: rawRow.id,
        connectionId,
        date: normalized.date,
        amount: normalized.amount,
        currency: normalized.currency,
        description: normalized.description,
        merchantName: normalized.merchantName,
        merchantMcc: normalized.merchantMcc,
        sourceRef: normalized.sourceRef,
        type: normalized.type,
        status: normalized.status,
        metadata: normalized.metadata,
      }));
      return true;
    });

    if (inserted) {
      added++;
    }
  }

  return added;
}

/**
 * Daily batch sync for all ad platforms.
 * Runs at 6am UTC every day. Fetches yesterday's spend data for all active
 * Google Ads, Meta Ads, and TikTok Ads connections.
 */
export const adSpendDailySync = inngest.createFunction(
  { id: "ad-spend-daily-sync" },
  { cron: "0 6 * * *" },
  async ({ step }) => {
    // Step 1: Get all active ad connections
    const activeConnections = await step.run(
      "list-active-ad-connections",
      async () => {
        return db
          .select({
            id: connections.id,
            companyId: connections.companyId,
            provider: connections.provider,
          })
          .from(connections)
          .where(
            and(
              inArray(connections.provider, [...AD_PROVIDERS]),
              eq(connections.status, "active")
            )
          );
      }
    );

    if (activeConnections.length === 0) {
      return { triggered: 0 };
    }

    // Step 2: Fan out sync events for each connection
    await step.sendEvent(
      "trigger-ad-syncs",
      activeConnections.map((conn) => ({
        name: "ads/sync.requested" as const,
        data: {
          connectionId: conn.id,
          companyId: conn.companyId,
        },
      }))
    );

    return { triggered: activeConnections.length };
  }
);

/**
 * Event-triggered sync for a single ad platform connection.
 * Triggered by initial connection or on-demand sync requests.
 * Uses a 30-day lookback for initial sync, 1-day for recurring.
 */
export const adSpendSync = inngest.createFunction(
  {
    id: "ad-spend-sync",
    concurrency: [{ key: "event.data.connectionId", limit: 1 }],
  },
  [
    { event: "connection/google_ads.connected" },
    { event: "connection/meta_ads.connected" },
    { event: "connection/tiktok_ads.connected" },
    { event: "ads/sync.requested" },
  ],
  async ({ event, step }) => {
    const { connectionId, companyId } = event.data as {
      connectionId: string;
      companyId: string;
    };

    // Step 1: Get credentials
    const connection = await step.run("get-credentials", async () => {
      const conn = await getConnectionCredentials(connectionId, companyId);
      if (!conn) throw new Error(`Connection ${connectionId} not found`);
      return conn;
    });

    // Step 2: Determine date range
    // Initial sync (no lastSyncAt) → 30-day lookback; recurring → yesterday only
    const { startDate, endDate } = await step.run(
      "compute-date-range",
      async () => {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const isInitialSync = !connection.lastSyncAt;

        const lookbackDays = isInitialSync ? 30 : 1;
        const start = new Date(
          now.getTime() - lookbackDays * 24 * 60 * 60 * 1000
        );

        return {
          startDate: start.toISOString().split("T")[0],
          endDate: yesterday.toISOString().split("T")[0],
        };
      }
    );

    // Step 3: Fetch report and insert transactions
    const result = await step.run("sync-ad-spend", async () => {
      const credentials = connection.credentials as Record<string, unknown>;
      const accessToken =
        (credentials.access_token as string) ||
        (credentials.apiKey as string) ||
        "";
      const externalAccountId = connection.externalAccountId || "";

      if (!accessToken)
        throw new Error("Missing access token / API key for ad platform");

      const reports = await fetchReportForConnection(
        connection.provider,
        accessToken,
        externalAccountId,
        startDate,
        endDate
      );

      const added = await insertAdSpendRows(
        reports,
        companyId,
        connectionId,
        connection.provider
      );

      return { added, totalReports: reports.length };
    });

    // Step 4: Update lastSyncAt
    await step.run("update-sync-timestamp", async () => {
      await db
        .update(connections)
        .set({
          lastSyncAt: new Date(),
          errorCount: 0,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(connections.id, connectionId),
            eq(connections.companyId, companyId)
          )
        );
    });

    return {
      connectionId,
      companyId,
      provider: connection.provider,
      transactionsAdded: result.added,
      totalReports: result.totalReports,
    };
  }
);
