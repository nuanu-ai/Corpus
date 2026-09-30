import { normalizeCurrencyCode } from "./display-currency";

export interface ResolvedTxnCurrency {
  /** Final ISO 4217 code that goes into canonical_txns / staging payloads. */
  currency: string;
  /**
   * True when the parsed source did not declare a currency and we fell back to
   * the company's reporting currency. Surface this in `metadata.currencyAssumed`
   * so dashboards / audits can mark these rows as inferred rather than authoritative.
   */
  assumed: boolean;
  /**
   * Where the final code came from: the source row, or the company default.
   */
  source: "parsed" | "company_reporting_currency";
}

/**
 * Resolve a parsed transaction currency to a concrete code.
 *
 * Behaviour:
 * - If the parsed value is a valid ISO-like code (3–5 letters), use it as-is.
 * - Otherwise fall back to `company.reportingCurrency` and mark `assumed=true`.
 *
 * Callers should write `metadata.currencyAssumed = true` (and ideally
 * `metadata.assumedFrom = "company_reporting_currency"`) onto the canonical /
 * staging row when `assumed` is true. Never default to "USD" silently inside
 * parsers — that was the source of the dashboard confusion where a file
 * without a declared currency ended up displayed as USD.
 */
export function resolveTxnCurrency(
  parsed: string | null | undefined,
  company: { reportingCurrency: string },
): ResolvedTxnCurrency {
  const normalized = normalizeCurrencyCode(parsed);
  if (normalized) {
    return { currency: normalized, assumed: false, source: "parsed" };
  }
  // Reporting currency is non-null in DB (default 'USD'). Defensive normalize anyway.
  const fallback = normalizeCurrencyCode(company.reportingCurrency) ?? "USD";
  return { currency: fallback, assumed: true, source: "company_reporting_currency" };
}
