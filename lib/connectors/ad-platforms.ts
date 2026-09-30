import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";
import { amountUsdIfUsd } from "@/lib/finance/amount-usd";

/** Common ad spend report row from any ad platform. */
export interface AdSpendReport {
  campaignId: string;
  campaignName: string;
  date: string; // YYYY-MM-DD
  spend: number; // in platform currency (major units)
  currency: string;
  impressions: number;
  clicks: number;
  conversions: number;
  platform: "google_ads" | "meta_ads" | "tiktok_ads";
}

export interface NormalizedAdTransaction {
  date: Date;
  amount: string;
  currency: string;
  amountUsd: string | null;
  description: string | null;
  merchantName: string | null;
  merchantMcc: string | null;
  sourceRef: string;
  type: "credit" | "debit";
  status: "pending" | "posted";
  metadata: Record<string, unknown>;
}

// ── Google Ads ────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AD_PLATFORM_TIMEOUT_MS = 15_000;
const AD_PLATFORM_PAGE_SIZE = 500;

function parseNumericString(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseMetaPagingCursor(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const paging =
    record.paging && typeof record.paging === "object" && !Array.isArray(record.paging)
      ? (record.paging as Record<string, unknown>)
      : null;
  const cursors =
    paging?.cursors && typeof paging.cursors === "object" && !Array.isArray(paging.cursors)
      ? (paging.cursors as Record<string, unknown>)
      : null;
  if (typeof cursors?.after === "string" && cursors.after.trim().length > 0) {
    return cursors.after.trim();
  }
  if (typeof paging?.next === "string" && paging.next.trim().length > 0) {
    try {
      const url = new URL(paging.next);
      const after = url.searchParams.get("after");
      return after?.trim() || null;
    } catch {
      return null;
    }
  }
  return null;
}

function parseTikTokTotalPages(payload: unknown): number {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return 1;
  }
  const record = payload as Record<string, unknown>;
  const data =
    record.data && typeof record.data === "object" && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : null;
  const pageInfo =
    (data?.page_info && typeof data.page_info === "object" && !Array.isArray(data.page_info)
      ? (data.page_info as Record<string, unknown>)
      : null) ??
    (data?.pageInfo && typeof data.pageInfo === "object" && !Array.isArray(data.pageInfo)
      ? (data.pageInfo as Record<string, unknown>)
      : null);
  const totalPages = pageInfo?.total_page ?? pageInfo?.totalPage;
  return typeof totalPages === "number" && Number.isFinite(totalPages) && totalPages > 0
    ? totalPages
    : 1;
}

/** Fetch Google Ads campaign spend report for a date range. */
export async function fetchGoogleAdsReport(
  accessToken: string,
  customerId: string,
  startDate: string,
  endDate: string
): Promise<AdSpendReport[]> {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new Error("Invalid date format — expected YYYY-MM-DD");
  }
  const query = `SELECT campaign.id, campaign.name, customer.currency_code, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`;

  const res = await fetchWithTimeoutAndRetry(
    `https://googleads.googleapis.com/v15/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
    { timeoutMs: AD_PLATFORM_TIMEOUT_MS, maxRetriesOn429: 1 }
  );
  if (!res.ok)
    throw new Error(`Google Ads report fetch failed (${res.status})`);
  const data = (await res.json()) as Array<{
    results: Array<{
      campaign: { id: string; name: string };
      segments: { date: string };
      metrics: {
        costMicros: string;
        impressions: string;
        clicks: string;
        conversions: string;
      };
    }>;
  }>;

  return data.flatMap((chunk) => (chunk.results || []).map((r) => ({
    campaignId: r.campaign.id,
    campaignName: r.campaign.name,
    date: r.segments.date,
    spend: parseNumericString(r.metrics.costMicros) / 1_000_000,
    currency:
      ((r as { customer?: { currencyCode?: string; currency_code?: string } }).customer?.currencyCode ||
        (r as { customer?: { currencyCode?: string; currency_code?: string } }).customer?.currency_code ||
        "USD"),
    impressions: parseNumericString(r.metrics.impressions),
    clicks: parseNumericString(r.metrics.clicks),
    conversions: parseNumericString(r.metrics.conversions),
    platform: "google_ads" as const,
  })));
}

// ── Meta Ads ──────────────────────────────────────────

/** Fetch Meta Ads campaign spend report for a date range. */
export async function fetchMetaAdsReport(
  accessToken: string,
  adAccountId: string,
  startDate: string,
  endDate: string
): Promise<AdSpendReport[]> {
  const rows: Array<{
    campaign_id: string;
    campaign_name: string;
    spend: string;
    impressions: string;
    clicks: string;
    date_start: string;
    account_currency?: string;
    actions?: Array<{ action_type: string; value: string }>;
  }> = [];
  let after: string | null = null;

  do {
    const params = new URLSearchParams({
      fields: "campaign_id,campaign_name,spend,impressions,clicks,actions,date_start,account_currency",
      time_range: JSON.stringify({ since: startDate, until: endDate }),
      level: "campaign",
      limit: String(AD_PLATFORM_PAGE_SIZE),
    });
    if (after) {
      params.set("after", after);
    }

    const res = await fetchWithTimeoutAndRetry(
      `https://graph.facebook.com/v18.0/act_${adAccountId}/insights?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { timeoutMs: AD_PLATFORM_TIMEOUT_MS, maxRetriesOn429: 1 }
    );
    if (!res.ok)
      throw new Error(`Meta Ads report fetch failed (${res.status})`);
    const data = (await res.json()) as {
      data: Array<{
        campaign_id: string;
        campaign_name: string;
        spend: string;
        impressions: string;
        clicks: string;
        date_start: string;
        account_currency?: string;
        actions?: Array<{ action_type: string; value: string }>;
      }>;
      paging?: { cursors?: { after?: string }; next?: string };
    };
    rows.push(...(data.data || []));
    after = parseMetaPagingCursor(data);
  } while (after);

  return rows.map((r) => {
    const conversions = r.actions?.find(
      (a) => a.action_type === "offsite_conversion"
    )?.value;
    return {
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      date: r.date_start,
      spend: parseNumericString(r.spend),
      currency: typeof r.account_currency === "string" && r.account_currency.trim().length > 0
        ? r.account_currency.trim().toUpperCase()
        : "USD",
      impressions: parseNumericString(r.impressions),
      clicks: parseNumericString(r.clicks),
      conversions: conversions ? parseNumericString(conversions) : 0,
      platform: "meta_ads" as const,
    };
  });
}

// ── TikTok Ads ────────────────────────────────────────

/** Fetch TikTok Ads campaign spend report for a date range. */
export async function fetchTikTokAdsReport(
  accessToken: string,
  advertiserId: string,
  startDate: string,
  endDate: string
): Promise<AdSpendReport[]> {
  const rows: Array<{
    dimensions: { campaign_id: string; stat_time_day: string };
    metrics: {
      campaign_name: string;
      spend: string;
      impressions: string;
      clicks: string;
      conversion: string;
      currency?: string;
    };
  }> = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetchWithTimeoutAndRetry(
      "https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/",
      {
        method: "POST",
        headers: {
          "Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          advertiser_id: advertiserId,
          report_type: "BASIC",
          dimensions: ["campaign_id", "stat_time_day"],
          metrics: [
            "campaign_name",
            "spend",
            "impressions",
            "clicks",
            "conversion",
            "currency",
          ],
          data_level: "AUCTION_CAMPAIGN",
          start_date: startDate,
          end_date: endDate,
          page,
          page_size: AD_PLATFORM_PAGE_SIZE,
        }),
      },
      { timeoutMs: AD_PLATFORM_TIMEOUT_MS, maxRetriesOn429: 1 }
    );
    if (!res.ok)
      throw new Error(`TikTok Ads report fetch failed (${res.status})`);
    const data = (await res.json()) as {
      data: {
        list: Array<{
          dimensions: { campaign_id: string; stat_time_day: string };
          metrics: {
            campaign_name: string;
            spend: string;
            impressions: string;
            clicks: string;
            conversion: string;
            currency?: string;
          };
        }>;
        page_info?: { total_page?: number };
        pageInfo?: { totalPage?: number };
      };
    };
    rows.push(...(data.data?.list || []));
    totalPages = parseTikTokTotalPages(data);
    page += 1;
  } while (page <= totalPages);

  return rows.map((r) => ({
    campaignId: r.dimensions.campaign_id,
    campaignName: r.metrics.campaign_name,
    date: r.dimensions.stat_time_day.split(" ")[0], // "2026-02-15 00:00:00" → "2026-02-15"
    spend: parseNumericString(r.metrics.spend),
    currency:
      typeof r.metrics.currency === "string" && r.metrics.currency.trim().length > 0
        ? r.metrics.currency.trim().toUpperCase()
        : "USD",
    impressions: parseNumericString(r.metrics.impressions),
    clicks: parseNumericString(r.metrics.clicks),
    conversions: parseNumericString(r.metrics.conversion),
    platform: "tiktok_ads" as const,
  }));
}

// ── Shared normalizer ─────────────────────────────────

/** Normalize an ad spend report row into a canonical transaction. */
export function normalizeAdSpend(
  report: AdSpendReport
): NormalizedAdTransaction {
  const platformNames: Record<string, string> = {
    google_ads: "Google Ads",
    meta_ads: "Meta Ads",
    tiktok_ads: "TikTok Ads",
  };

  return {
    date: new Date(report.date),
    amount: String(report.spend),
    currency: report.currency.toUpperCase(),
    amountUsd: amountUsdIfUsd(String(report.spend), report.currency),
    description: `${platformNames[report.platform] || report.platform} — ${report.campaignName}`,
    merchantName: platformNames[report.platform] || report.platform,
    merchantMcc: "7311", // Advertising services MCC
    sourceRef: `${report.platform}:${report.campaignId}:${report.date}`,
    type: "debit", // ad spend is always an expense
    status: "posted",
    metadata: {
      campaignId: report.campaignId,
      campaignName: report.campaignName,
      impressions: report.impressions,
      clicks: report.clicks,
      conversions: report.conversions,
      platform: report.platform,
      cpc: report.clicks > 0 ? report.spend / report.clicks : null,
      cpm:
        report.impressions > 0
          ? (report.spend / report.impressions) * 1000
          : null,
    },
  };
}
