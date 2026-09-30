// Pure helpers for v2 tool output renderers.
//
// Ported from app/dashboard/_components/chat-panel.tsx (~lines 555-635).
// Do NOT duplicate helpers already in _lib/normalizers.ts — import from there.

import { isRecord, toNumber, toText } from "./normalizers";

/**
 * Build a list of metadata strings to render under a Company-DB result card.
 * Ported 1:1 from chat-panel.tsx `buildCompanyDbResultMeta` (~line 618).
 */
export function buildCompanyDbResultMeta(
  result: Record<string, unknown>,
): string[] {
  const meta = [
    toText(result.documentKind) ?? toText(result.report_type),
    toText(result.periodLabel) ??
      toText(result.period_label) ??
      toText(result.period_key) ??
      toText(result.period),
    toText(result.currency),
    toText(result.confidence),
    result.requiresReview === true ? "review required" : null,
    toText(result.status),
  ].filter((value): value is string => Boolean(value));

  const lineItemCount = toNumber(result.line_item_count);
  if (lineItemCount !== null) {
    meta.push(`${lineItemCount} rows`);
  }

  return meta;
}

/**
 * Format a currency amount using Intl.NumberFormat. Falls back to a plain
 * number + ISO code if the currency code is not recognized.
 * Ported from chat-panel.tsx `formatCurrencyAmount` (~line 574).
 */
export function formatCurrencyAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)} ${currency}`;
  }
}

/**
 * Render a human-readable "1 USD = 14,500.00 IDR" line.
 * Ported from chat-panel.tsx `formatFxRate` (~line 590).
 */
export function formatFxRate(
  rate: number,
  fromCurrency: string,
  toCurrency: string,
): string {
  return `1 ${fromCurrency} = ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(rate)} ${toCurrency}`;
}

/**
 * Cap hits shown on a company_db_result card — mirrors legacy MAX_TOOL_RESULT_PREVIEW.
 */
export const MAX_COMPANY_DB_RESULT_PREVIEW = 5;

/**
 * Extract up to N string items from an unknown array field. Used for
 * `highlights` and `risks` on Company-DB result hits.
 */
export function extractStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toText(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);
}

/**
 * Filter an unknown array to only the records (Record<string, unknown>).
 */
export function filterRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
