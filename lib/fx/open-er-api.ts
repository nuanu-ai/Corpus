const OPEN_ER_API_URL = "https://open.er-api.com/v6/latest/USD";

export interface FxQuote {
  quoteCurrency: string;
  rate: number;
}

type OpenErApiResponse = {
  result?: string;
  base_code?: string;
  rates?: Record<string, unknown>;
};

export async function fetchOpenExchangeRates(): Promise<FxQuote[]> {
  const response = await fetch(OPEN_ER_API_URL);

  if (!response.ok) {
    throw new Error(
      `Open ER API fetch failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  }

  const payload = (await response.json()) as OpenErApiResponse;
  if (payload.result !== "success" || payload.base_code !== "USD" || !payload.rates) {
    throw new Error("Open ER API returned an unexpected payload");
  }

  return Object.entries(payload.rates)
    .filter((entry): entry is [string, number] => {
      const [quoteCurrency, rawRate] = entry;
      return (
      quoteCurrency !== "USD" &&
      /^[A-Z]{3}$/.test(quoteCurrency) &&
      typeof rawRate === "number" &&
      Number.isFinite(rawRate) &&
      rawRate > 0
      );
    })
    .map(([quoteCurrency, rate]) => ({
      quoteCurrency,
      rate,
    }));
}

export function filterSupplementalFiatRates(
  rates: FxQuote[],
  excludedQuoteCurrencies: Iterable<string>,
): FxQuote[] {
  const excluded = new Set(
    Array.from(excludedQuoteCurrencies, (currency) => currency.toUpperCase()),
  );

  return rates.filter((rate) => !excluded.has(rate.quoteCurrency.toUpperCase()));
}
