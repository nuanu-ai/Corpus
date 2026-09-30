import { ApifyClient } from "apify-client";

import {
  hashLegalWatchContent,
  stableLegalWatchContentText,
  validateLegalWatchSourceFetchBoundary,
  type LegalWatchFetch,
} from "@/lib/routines/legal-watch/collector";
import { assertLegalWatchSafeHttpsUrl } from "@/lib/routines/legal-watch/url-safety";
import type { LegalWatchSourceProvider } from "@/lib/routines/legal-watch/providers/types";
import { normalizeRoutineSourceUrlPrefix } from "@/lib/routines/source-registry";
import type { RoutineSourceDefinition } from "@/lib/routines/source-registry";
import {
  isLegalWatchApifyEnabled,
  readLegalWatchApifyAllowedActorIds,
  readLegalWatchSourceProviderConfig,
} from "@/lib/routines/source-config";
import type { RoutineSourceFetchResult } from "@/lib/routines/types";

interface ApifyRunLike {
  id: string;
  status?: string;
  actId?: string;
  defaultDatasetId?: string;
  usageTotalUsd?: number;
  usageUsd?: unknown;
}

interface ApifyDatasetClientLike {
  listItems(options?: Record<string, unknown>): Promise<{
    items?: ApifyDatasetItem[];
    total?: number;
    count?: number;
    limit?: number;
    offset?: number;
  }>;
}

interface ApifyActorClientLike {
  call(input?: unknown, options?: Record<string, unknown>): Promise<ApifyRunLike>;
}

interface ApifyClientLike {
  actor(id: string): ApifyActorClientLike;
  dataset(id: string): ApifyDatasetClientLike;
}

interface ApifyDatasetItem {
  [key: string]: unknown;
}

export interface LegalWatchApifyFetchOptions {
  client?: ApifyClientLike;
  fetchImpl?: LegalWatchFetch;
  env?: NodeJS.ProcessEnv;
}

const APIFY_SUCCESS_STATUS = "SUCCEEDED";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const next = stringValue(value);
    if (next) return next;
  }
  return null;
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHttpsUrl(value: string): URL {
  return assertLegalWatchSafeHttpsUrl(value, "Legal Watch source");
}

function assertAllowedCanonicalUrl(source: RoutineSourceDefinition, canonicalUrl: string): void {
  const sourceUrl = parseHttpsUrl(source.url);
  const canonical = assertLegalWatchSafeHttpsUrl(canonicalUrl, "Legal Watch canonical URL");
  const prefixes = source.allowedUrlPrefixes?.length
    ? source.allowedUrlPrefixes
    : [sourceUrl.origin];
  const allowed = prefixes.some((prefix) => {
    const prefixUrl = assertLegalWatchSafeHttpsUrl(prefix, "Legal Watch allowed URL prefix");
    if (prefixUrl.origin !== canonical.origin) return false;
    const canonicalComparable = canonical.toString().endsWith("/")
      ? canonical.toString().slice(0, -1)
      : canonical.toString();
    const prefixComparable = prefixUrl.toString().endsWith("/")
      ? prefixUrl.toString().slice(0, -1)
      : prefixUrl.toString();
    return (
      canonicalComparable === prefixComparable ||
      canonical.toString().startsWith(normalizeRoutineSourceUrlPrefix(prefixUrl.toString()))
    );
  });
  if (!allowed) {
    throw new Error(
      `Legal Watch Apify result left allowed source prefixes: ${sourceUrl.origin} -> ${canonical.origin}`,
    );
  }
}

function readItemUrl(item: ApifyDatasetItem, source: RoutineSourceDefinition): string {
  const metadata = recordValue(item.metadata);
  return firstString(
    item.url,
    item.loadedUrl,
    item.canonicalUrl,
    item.pageUrl,
    metadata.url,
    metadata.loadedUrl,
    metadata.canonicalUrl,
    source.url,
  ) ?? source.url;
}

function readItemTitle(item: ApifyDatasetItem, source: RoutineSourceDefinition): string {
  const metadata = recordValue(item.metadata);
  return firstString(item.title, metadata.title, metadata.ogTitle, source.title) ?? source.title;
}

function readItemBody(item: ApifyDatasetItem): string | null {
  const metadata = recordValue(item.metadata);
  const markdown = firstString(item.markdown, item.text, item.content, metadata.markdown, metadata.text);
  if (markdown) return markdown;
  const html = firstString(item.html, metadata.html);
  return html ? stripHtml(html) : null;
}

function readItemDate(item: ApifyDatasetItem): string | null {
  const metadata = recordValue(item.metadata);
  const raw = firstString(item.publishedAt, item.date, item.sourceDate, metadata.publishedAt, metadata.date);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeApifyError(error: unknown, env: NodeJS.ProcessEnv): string {
  const raw = error instanceof Error ? error.message : String(error);
  const token = env.APIFY_TOKEN?.trim();
  return token ? raw.replaceAll(token, "[redacted]") : raw;
}

function createApifyClient(env: NodeJS.ProcessEnv): ApifyClientLike {
  const token = env.APIFY_TOKEN?.trim();
  if (!isLegalWatchApifyEnabled(env)) {
    throw new Error("provider_not_configured: Legal Watch Apify provider is disabled");
  }
  if (!token) {
    throw new Error("provider_not_configured: APIFY_TOKEN is not configured");
  }
  return new ApifyClient({ token });
}

function buildWebsiteContentCrawlerInput(source: RoutineSourceDefinition, startUrl = source.url) {
  const providerConfig = readLegalWatchSourceProviderConfig(source);
  const apify = providerConfig.apify;
  return {
    startUrls: [{ url: startUrl }],
    crawlerType: apify.crawlerType,
    includeUrlGlobs: apify.includeUrlGlobs,
    excludeUrlGlobs: apify.excludeUrlGlobs,
    maxCrawlDepth: apify.includeUrlGlobs.length > 0 ? 1 : 0,
    maxCrawlPages: apify.maxPagesPerRun,
    maxResults: apify.maxPagesPerRun,
    useSitemaps: false,
    useLlmsTxt: false,
    respectRobotsTxtFile: apify.respectRobotsTxt,
    requestTimeoutSecs: apify.requestTimeoutSecs,
    initialConcurrency: 1,
    maxConcurrency: 1,
    saveMarkdown: true,
    saveHtml: false,
    saveHtmlAsFile: false,
    saveScreenshots: false,
    proxyConfiguration: { useApifyProxy: apify.useProxy },
  };
}

export async function fetchLegalWatchSourceViaApify(
  source: RoutineSourceDefinition,
  options?: LegalWatchApifyFetchOptions,
): Promise<RoutineSourceFetchResult> {
  parseHttpsUrl(source.url);
  const env = options?.env ?? process.env;
  const providerConfig = readLegalWatchSourceProviderConfig(source);
  const apify = providerConfig.apify;
  const allowedActors = readLegalWatchApifyAllowedActorIds(env);
  if (!allowedActors.includes(apify.actorId)) {
    throw new Error("provider_not_configured: apifyActorId is not allowlisted");
  }

  const client = options?.client ?? createApifyClient(env);
  const boundary = await validateLegalWatchSourceFetchBoundary(source, options?.fetchImpl);
  let run: ApifyRunLike;
  try {
    run = await client.actor(apify.actorId).call(buildWebsiteContentCrawlerInput(source, boundary.canonicalUrl), {
      waitSecs: apify.waitForFinishSecs,
      maxItems: apify.maxPagesPerRun,
      log: null,
    });
  } catch (error) {
    throw new Error(`Apify run failed for ${source.sourceKey}: ${sanitizeApifyError(error, env)}`);
  }

  if (run.status && run.status !== APIFY_SUCCESS_STATUS) {
    throw new Error(`Apify run failed for ${source.sourceKey}: status ${run.status}`);
  }
  if (!run.defaultDatasetId) {
    throw new Error(`Apify run failed for ${source.sourceKey}: missing default dataset`);
  }

  const dataset = await client.dataset(run.defaultDatasetId).listItems({
    limit: apify.maxPagesPerRun,
    clean: true,
  });
  const items = dataset.items ?? [];
  if (items.length === 0) {
    throw new Error(`Apify run failed for ${source.sourceKey}: empty dataset`);
  }

  const normalizedItems = items.map((item) => {
    const canonicalUrl = readItemUrl(item, source);
    assertAllowedCanonicalUrl(source, canonicalUrl);
    return {
      canonicalUrl,
      title: readItemTitle(item, source),
      body: readItemBody(item),
      sourceDate: readItemDate(item),
    };
  });
  const itemWithoutBody = normalizedItems.find((item) => !item.body);
  if (itemWithoutBody) {
    throw new Error(`Apify run failed for ${source.sourceKey}: missing text content`);
  }

  const primary = normalizedItems[0];
  const itemUrls = Array.from(new Set(normalizedItems.map((item) => item.canonicalUrl)));
  const itemTitles = Array.from(new Set(normalizedItems.map((item) => item.title)));
  const bodyText = normalizedItems
    .map((item) => `# ${item.title}\n\n${item.body}`)
    .join("\n\n---\n\n")
    .trim();
  const stableBodyText = stableLegalWatchContentText(bodyText);
  const fetchedAt = new Date().toISOString();

  return {
    sourceKey: source.sourceKey,
    canonicalUrl: primary.canonicalUrl,
    title: primary.title,
    sourceDate: primary.sourceDate,
    contentType: "text/markdown",
    contentHash: hashLegalWatchContent(stableBodyText),
    bodyText,
    rawSnapshot: {
      provider: "apify",
      sourceKey: source.sourceKey,
      url: source.url,
      responseUrl: primary.canonicalUrl,
      contentType: "text/markdown",
      actorId: apify.actorId,
      runId: run.id,
      datasetId: run.defaultDatasetId,
      itemCount: items.length,
      itemUrls,
      itemTitles,
      totalItems: dataset.total,
      crawlerType: apify.crawlerType,
      maxPagesPerRun: apify.maxPagesPerRun,
      usageTotalUsd: run.usageTotalUsd,
      stableTextLength: stableBodyText.length,
    },
    fetchedAt,
  };
}

export const apifyLegalWatchProvider: LegalWatchSourceProvider = {
  id: "apify",
  fetchSource: (source) => fetchLegalWatchSourceViaApify(source),
};
