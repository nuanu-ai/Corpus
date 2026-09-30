/**
 * ECB (European Central Bank) daily exchange rate fetcher.
 *
 * ECB publishes rates daily at ~16:00 CET relative to EUR.
 * We parse the XML feed and convert to USD-based rates for storage.
 */

const ECB_DAILY_URL =
  "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/**
 * Fetch daily exchange rates from the European Central Bank.
 * Returns rates relative to EUR (e.g., EUR/USD = 1.08 means 1 EUR = 1.08 USD).
 */
export async function fetchEcbRates(): Promise<
  Array<{ quoteCurrency: string; rate: number }>
> {
  const response = await fetch(ECB_DAILY_URL);

  if (!response.ok) {
    throw new Error(
      `ECB rate fetch failed (${response.status}): ${(await response.text()).slice(0, 200)}`
    );
  }

  const xml = await response.text();

  // Parse using regex — ECB XML format is stable and simple.
  // Recent feeds use single quotes, older samples use double quotes.
  const ratePattern = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]\s*\/>/g;
  const rates: Array<{ quoteCurrency: string; rate: number }> = [];

  let match: RegExpExecArray | null;
  while ((match = ratePattern.exec(xml)) !== null) {
    rates.push({
      quoteCurrency: match[1],
      rate: parseFloat(match[2]),
    });
  }

  return rates;
}

/**
 * Convert ECB EUR-based rates to USD-based rates for storage.
 *
 * Since ECB gives EUR/XXX rates (how many XXX per 1 EUR), we need to
 * convert to USD/XXX rates (how many XXX per 1 USD).
 *
 * Formula: USD/XXX = EUR/XXX / EUR/USD
 *
 * Also adds USD/EUR = 1 / EUR/USD so we can look up EUR conversions too.
 */
export function convertToUsdBase(
  ecbRates: Array<{ quoteCurrency: string; rate: number }>
): Array<{ quoteCurrency: string; rate: number }> {
  // Find the EUR/USD rate in the ECB data
  const eurUsdEntry = ecbRates.find((r) => r.quoteCurrency === "USD");
  if (!eurUsdEntry) {
    // USD not in ECB list — cannot convert
    return [];
  }

  const eurUsd = eurUsdEntry.rate; // e.g., 1.0856

  const usdBased: Array<{ quoteCurrency: string; rate: number }> = [];

  for (const r of ecbRates) {
    // Skip USD — we don't need USD/USD
    if (r.quoteCurrency === "USD") continue;

    // USD/XXX = EUR/XXX / EUR/USD
    usdBased.push({
      quoteCurrency: r.quoteCurrency,
      rate: r.rate / eurUsd,
    });
  }

  // Add USD/EUR = 1 / EUR/USD
  usdBased.push({
    quoteCurrency: "EUR",
    rate: 1 / eurUsd,
  });

  return usdBased;
}
