import { db } from "@/lib/db";
import { fxRates } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

/**
 * Get the exchange rate for a currency pair on a given date.
 * Looks up the fx_rates table for the closest available rate (within 5 days).
 * Returns null if no rate is found.
 */
export async function getRate(
  from: string,
  to: string,
  date: Date
): Promise<number | null> {
  // Same currency: trivial case
  if (from.toUpperCase() === to.toUpperCase()) return 1.0;

  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  if (fromUpper === "USD") {
    // USD → XXX: query for quoteCurrency = toUpper, return rate directly
    const row = await findClosestRate(toUpper, date);
    return row ? Number(row.rate) : null;
  }

  if (toUpper === "USD") {
    // XXX → USD: query for quoteCurrency = fromUpper, return 1/rate
    const row = await findClosestRate(fromUpper, date);
    return row ? 1 / Number(row.rate) : null;
  }

  // Cross-rate: neither is USD, do two lookups
  // USD/FROM and USD/TO, then TO/FROM = (USD/TO) / (USD/FROM)
  // But we want FROM → TO, so: rate = (USD/TO) / (USD/FROM)
  // Which is equivalent to: amount_in_FROM * (1/USD_FROM) * USD_TO
  // Wait, let's think carefully:
  //   We store USD/XXX rates (how many XXX per 1 USD).
  //   FROM → USD = 1 / (USD/FROM)
  //   USD → TO = USD/TO
  //   FROM → TO = (1 / USD_FROM) * USD_TO = USD_TO / USD_FROM
  const [fromRow, toRow] = await Promise.all([
    findClosestRate(fromUpper, date),
    findClosestRate(toUpper, date),
  ]);

  if (!fromRow || !toRow) return null;

  const usdPerFrom = Number(fromRow.rate); // USD/FROM
  const usdPerTo = Number(toRow.rate); // USD/TO

  // FROM → TO = USD/TO / USD/FROM
  return usdPerTo / usdPerFrom;
}

/**
 * Find the closest FX rate for a given quote currency relative to a date.
 * Only considers rates within 5 days of the target date.
 */
async function findClosestRate(quoteCurrency: string, date: Date) {
  const fiveDaysInSeconds = 5 * 24 * 60 * 60;
  const targetTimestamp = sql`${date.toISOString()}::timestamptz`;

  const rows = await db
    .select({
      rate: fxRates.rate,
      rateDate: fxRates.rateDate,
    })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.baseCurrency, "USD"),
        eq(fxRates.quoteCurrency, quoteCurrency),
        sql`ABS(EXTRACT(EPOCH FROM ${fxRates.rateDate} - ${targetTimestamp})) < ${fiveDaysInSeconds}`
      )
    )
    .orderBy(
      sql`ABS(EXTRACT(EPOCH FROM ${fxRates.rateDate} - ${targetTimestamp}))`
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Convert an amount from one currency to USD.
 * Returns null for non-USD amounts when no rate is available, so callers do
 * not accidentally treat the source amount as a trusted USD amount.
 */
export async function convertToUsd(
  amount: number,
  currency: string,
  date: Date
): Promise<{ amountUsd: number | null; fxRate: number | null }> {
  if (currency.toUpperCase() === "USD") {
    return { amountUsd: amount, fxRate: null };
  }

  const rate = await getRate(currency, "USD", date);

  if (rate === null) {
    return { amountUsd: null, fxRate: null };
  }

  return { amountUsd: amount * rate, fxRate: rate };
}
