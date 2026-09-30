import { createHash } from "node:crypto";

import {
  assertLegalWatchSafeHttpsUrl,
  assertLegalWatchSafeResolvedHttpsUrl,
} from "@/lib/routines/legal-watch/url-safety";
import { normalizeRoutineSourceUrlPrefix } from "@/lib/routines/source-registry";
import type { RoutineSourceFetchResult } from "@/lib/routines/types";

export interface LegalWatchSourceLike {
  sourceKey: string;
  title: string;
  url: string;
  fetchMode: string;
  allowedContentTypes?: string[];
  allowedUrlPrefixes?: string[];
}

export type LegalWatchFetch = typeof fetch;

const HTML_MAX_BYTES = 2 * 1024 * 1024;
const PDF_MAX_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const FETCH_ATTEMPT_COUNT = 2;
const FETCH_RETRY_DELAY_MS = 750;
const MAX_REDIRECT_HOPS = 5;
const RETRYABLE_HTTP_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);
const REDIRECT_HTTP_STATUSES = new Set([301, 302, 303, 307, 308]);
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type LegalWatchRequestProfile = "browser_navigation" | "same_origin_browser_fallback";

interface LegalWatchAttemptResult {
  response: Response;
  canonicalUrl: string;
  contentType: string;
  rawText: string;
  fetchedAt: string;
  attempt: number;
  redirectCount: number;
  requestProfile: LegalWatchRequestProfile;
  priorAttemptErrors: string[];
}

interface LegalWatchManualFetchResult {
  response: Response;
  canonicalUrl: string;
  redirectCount: number;
}

export function hashLegalWatchContent(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function textFromHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromHtml(value: string, fallback: string): string {
  const match = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || fallback;
}

export function stableLegalWatchContentText(value: string): string {
  return value
    .replace(/\bDownloaded\s+\d+\b/gi, "Downloaded <count>")
    .replace(/\bViewed\s+\d+\b/gi, "Viewed <count>")
    .replace(/\bJumlah dilihat\s+\d+\b/gi, "Jumlah dilihat <count>")
    .replace(/\bJumlah diDownload\s+\d+\b/gi, "Jumlah diDownload <count>")
    .replace(
      /\bStatistik Pengunjung\s+online\s+[\d.]+\s+Hari ini\s+[\d.]+\s+Kemarin\s+[\d.]+\s+Minggu Ini\s+[\d.]+\s+Minggu Lalu\s+[\d.]+\s+Bulan Ini\s+[\d.]+\s+Bulan Lalu\s+[\d.]+\s+Total Pengunjung\s+[\d.]+/gi,
      "Statistik Pengunjung <counts>",
    )
    .replace(/\bHalaman ini telah diakses\s+\d+\s+kali\b/gi, "Halaman ini telah diakses <count> kali")
    .replace(/\btelah diakses\s+\d+\s+kali\b/gi, "telah diakses <count> kali")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHttpsUrl(value: string): URL {
  return assertLegalWatchSafeHttpsUrl(value, "Legal Watch source");
}

function assertAllowedSourceUrl(source: LegalWatchSourceLike, sourceUrl: URL, canonicalUrl: string): URL {
  const canonical = assertLegalWatchSafeHttpsUrl(canonicalUrl, "Legal Watch canonical URL");
  if (canonical.origin !== sourceUrl.origin) {
    const allowed = (source.allowedUrlPrefixes ?? []).some((prefix) => {
      const prefixUrl = assertLegalWatchSafeHttpsUrl(prefix, "Legal Watch allowed URL prefix");
      if (prefixUrl.origin !== canonical.origin) return false;
      return canonical.toString().startsWith(normalizeRoutineSourceUrlPrefix(prefixUrl.toString()));
    });
    if (!allowed) {
      throw new Error(
        `Legal Watch redirect left registered source origin: ${sourceUrl.origin} -> ${canonical.origin}`,
      );
    }
  }
  return canonical;
}

function assertExpectedContentType(source: LegalWatchSourceLike, contentType: string): void {
  if (source.allowedContentTypes?.some((allowed) => contentType.includes(allowed))) {
    return;
  }
  if (source.fetchMode === "http_pdf" && !contentType.includes("application/pdf")) {
    throw new Error(`Expected PDF Legal Watch content for ${source.sourceKey}, got ${contentType}`);
  }
  if (
    source.fetchMode === "http_html" &&
    !contentType.includes("text/html") &&
    !contentType.includes("text/plain")
  ) {
    throw new Error(`Expected HTML Legal Watch content for ${source.sourceKey}, got ${contentType}`);
  }
}

function maxBytesForSource(source: LegalWatchSourceLike): number {
  return source.fetchMode === "http_pdf" ? PDF_MAX_BYTES : HTML_MAX_BYTES;
}

function requestProfileForAttempt(attempt: number): LegalWatchRequestProfile {
  return attempt > 1 ? "same_origin_browser_fallback" : "browser_navigation";
}

function buildFetchHeaders(
  source: LegalWatchSourceLike,
  sourceUrl: URL,
  requestProfile: LegalWatchRequestProfile,
): HeadersInit {
  const headers: Record<string, string> = {
    accept:
      source.fetchMode === "http_pdf"
        ? "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
    "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": requestProfile === "same_origin_browser_fallback" ? "same-origin" : "none",
    "upgrade-insecure-requests": "1",
    "user-agent": BROWSER_USER_AGENT,
  };

  if (requestProfile === "same_origin_browser_fallback") {
    headers.referer = `${sourceUrl.origin}/`;
  }

  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeHttpFailure(source: LegalWatchSourceLike, response: Response): string {
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  return `HTTP ${response.status}${statusText} for ${source.sourceKey} at ${response.url || source.url}`;
}

function buildFetchFailureMessage(source: LegalWatchSourceLike, attemptErrors: string[]): string {
  return `Fetch failed for ${source.sourceKey} after ${attemptErrors.length} attempt${
    attemptErrors.length === 1 ? "" : "s"
  } (${source.url}): ${attemptErrors.join("; ")}`;
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function resolveRedirectUrl(input: {
  source: LegalWatchSourceLike;
  sourceUrl: URL;
  currentUrl: URL;
  response: Response;
  redirectCount: number;
}): URL {
  if (input.redirectCount >= MAX_REDIRECT_HOPS) {
    throw new Error(`Legal Watch redirect limit exceeded for ${input.source.sourceKey}`);
  }
  const location = input.response.headers.get("location");
  if (!location) {
    throw new Error(`Legal Watch redirect missing Location header for ${input.source.sourceKey}`);
  }
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(location, input.currentUrl);
  } catch {
    throw new Error(`Legal Watch redirect URL must be a valid URL for ${input.source.sourceKey}`);
  }
  const nextUrl = assertLegalWatchSafeHttpsUrl(
    redirectUrl.toString(),
    "Legal Watch redirect URL",
  );
  return assertAllowedSourceUrl(input.source, input.sourceUrl, nextUrl.toString());
}

async function fetchLegalWatchResponseWithManualRedirects(input: {
  source: LegalWatchSourceLike;
  sourceUrl: URL;
  fetchImpl: LegalWatchFetch;
  signal: AbortSignal;
  requestProfile: LegalWatchRequestProfile;
}): Promise<LegalWatchManualFetchResult> {
  let currentUrl = input.sourceUrl;
  let redirectCount = 0;

  for (;;) {
    if (input.fetchImpl === fetch) {
      currentUrl = await assertLegalWatchSafeResolvedHttpsUrl(
        currentUrl,
        "Legal Watch fetch URL",
      );
    }
    const response = await input.fetchImpl(currentUrl.toString(), {
      signal: input.signal,
      redirect: "manual",
      headers: buildFetchHeaders(input.source, input.sourceUrl, input.requestProfile),
    });

    if (!REDIRECT_HTTP_STATUSES.has(response.status)) {
      return {
        response,
        canonicalUrl: currentUrl.toString(),
        redirectCount,
      };
    }

    const nextUrl = resolveRedirectUrl({
      source: input.source,
      sourceUrl: input.sourceUrl,
      currentUrl,
      response,
      redirectCount,
    });
    await cancelResponseBody(response);
    currentUrl = nextUrl;
    redirectCount += 1;
  }
}

async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  sourceKey: string,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`Legal Watch source ${sourceKey} exceeds max bytes (${contentLength} > ${maxBytes})`);
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`Legal Watch source ${sourceKey} exceeds max bytes (${maxBytes})`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Legal Watch source ${sourceKey} exceeds max bytes (${maxBytes})`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(body);
}

async function fetchLegalWatchSourceAttempt(input: {
  source: LegalWatchSourceLike;
  sourceUrl: URL;
  fetchImpl: LegalWatchFetch;
  attempt: number;
  priorAttemptErrors: string[];
}): Promise<
  | { ok: true; result: LegalWatchAttemptResult }
  | { ok: false; retryable: boolean; message: string }
> {
  const requestProfile = requestProfileForAttempt(input.attempt);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  let canonicalUrl: string;
  let redirectCount = 0;
  try {
    const fetchResult = await fetchLegalWatchResponseWithManualRedirects({
      source: input.source,
      sourceUrl: input.sourceUrl,
      fetchImpl: input.fetchImpl,
      signal: abortController.signal,
      requestProfile,
    });
    response = fetchResult.response;
    canonicalUrl = fetchResult.canonicalUrl;
    redirectCount = fetchResult.redirectCount;
  } catch (error) {
    clearTimeout(timeout);
    if (abortController.signal.aborted) {
      return {
        ok: false,
        retryable: true,
        message: `timed out after ${FETCH_TIMEOUT_MS}ms for ${input.source.sourceKey} at ${input.source.url}`,
      };
    }
    if (error instanceof Error && error.message.startsWith("Legal Watch ")) {
      throw error;
    }
    return {
      ok: false,
      retryable: true,
      message: `network error for ${input.source.sourceKey} at ${input.source.url}: ${errorMessage(error)}`,
    };
  }

  const fetchedAt = new Date().toISOString();
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  try {
    if (!response.ok) {
      await cancelResponseBody(response);
      return {
        ok: false,
        retryable: RETRYABLE_HTTP_STATUSES.has(response.status),
        message: describeHttpFailure(input.source, response),
      };
    }
    assertAllowedSourceUrl(input.source, input.sourceUrl, canonicalUrl);
    assertExpectedContentType(input.source, contentType);
    const rawText = await readResponseTextWithLimit(
      response,
      maxBytesForSource(input.source),
      input.source.sourceKey,
    );
    return {
      ok: true,
      result: {
        response,
        canonicalUrl,
        contentType,
        rawText,
        fetchedAt,
        attempt: input.attempt,
        redirectCount,
        requestProfile,
        priorAttemptErrors: [...input.priorAttemptErrors],
      },
    };
  } catch (error) {
    if (abortController.signal.aborted) {
      return {
        ok: false,
        retryable: true,
        message: `timed out after ${FETCH_TIMEOUT_MS}ms while reading ${input.source.sourceKey} at ${canonicalUrl}`,
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateLegalWatchSourceFetchBoundary(
  source: LegalWatchSourceLike,
  fetchImpl: LegalWatchFetch = fetch,
): Promise<{ canonicalUrl: string; redirectCount: number }> {
  const sourceUrl = parseHttpsUrl(source.url);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

  try {
    const result = await fetchLegalWatchResponseWithManualRedirects({
      source,
      sourceUrl,
      fetchImpl,
      signal: abortController.signal,
      requestProfile: "browser_navigation",
    });
    await cancelResponseBody(result.response);
    return {
      canonicalUrl: result.canonicalUrl,
      redirectCount: result.redirectCount,
    };
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(
        `timed out after ${FETCH_TIMEOUT_MS}ms while validating Legal Watch source boundary for ${source.sourceKey} at ${source.url}`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchLegalWatchSource(
  source: LegalWatchSourceLike,
  fetchImpl: LegalWatchFetch = fetch,
): Promise<RoutineSourceFetchResult> {
  const sourceUrl = parseHttpsUrl(source.url);
  const attemptErrors: string[] = [];

  let attemptResult: LegalWatchAttemptResult | null = null;
  for (let attempt = 1; attempt <= FETCH_ATTEMPT_COUNT; attempt += 1) {
    if (attempt > 1) {
      await sleep(FETCH_RETRY_DELAY_MS);
    }
    const result = await fetchLegalWatchSourceAttempt({
      source,
      sourceUrl,
      fetchImpl,
      attempt,
      priorAttemptErrors: attemptErrors,
    });
    if (result.ok) {
      attemptResult = result.result;
      break;
    }
    attemptErrors.push(`attempt ${attempt}/${FETCH_ATTEMPT_COUNT}: ${result.message}`);
    if (!result.retryable || attempt === FETCH_ATTEMPT_COUNT) {
      break;
    }
  }

  if (!attemptResult) {
    throw new Error(buildFetchFailureMessage(source, attemptErrors));
  }

  const { response, canonicalUrl, contentType, rawText, fetchedAt } = attemptResult;
  const bodyText = contentType.includes("html") ? textFromHtml(rawText) : rawText.trim();
  const title = contentType.includes("html") ? titleFromHtml(rawText, source.title) : source.title;
  const stableBodyText = stableLegalWatchContentText(bodyText);
  const contentHash = hashLegalWatchContent(stableBodyText);
  const lastModified = response.headers.get("last-modified");

  return {
    sourceKey: source.sourceKey,
    canonicalUrl,
    title,
    sourceDate: lastModified ? new Date(lastModified).toISOString() : null,
    contentType,
    contentHash,
    bodyText,
    rawSnapshot: {
      provider: "native",
      sourceKey: source.sourceKey,
      url: source.url,
      responseUrl: canonicalUrl,
      contentType,
      etag: response.headers.get("etag"),
      lastModified,
      byteLength: rawText.length,
      stableTextLength: stableBodyText.length,
      fetchAttemptCount: attemptResult.attempt,
      redirectCount: attemptResult.redirectCount,
      requestProfile: attemptResult.requestProfile,
      priorAttemptErrors: attemptResult.priorAttemptErrors,
    },
    fetchedAt,
  };
}

export function classifyLegalWatchChange(input: {
  previousContentHash: string | null;
  nextContentHash: string;
}): "new" | "changed" | "unchanged" {
  if (!input.previousContentHash) return "new";
  if (input.previousContentHash === input.nextContentHash) return "unchanged";
  return "changed";
}
