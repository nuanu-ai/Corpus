/**
 * CoinGecko free API fetcher for cryptocurrency prices.
 *
 * Fetches current USD prices for supported cryptocurrencies
 * and converts them to USD-based rates (USD/CRYPTO = 1/price).
 */

const SUPPORTED_CRYPTO = new Map([
  ["BTC", "bitcoin"],
  ["ETH", "ethereum"],
  ["USDT", "tether"],
  ["USDC", "usd-coin"],
  ["SOL", "solana"],
]);

const COINGECKO_API_URL = "https://api.coingecko.com/api/v3/simple/price";

/**
 * Fetch current crypto prices from CoinGecko (free API, no key needed).
 * Returns USD-based rates for supported cryptocurrencies.
 *
 * Rate format: 1 USD = X crypto (i.e., rate = 1/price).
 * For example, if BTC price is $67,000, then USD/BTC = 1/67000 ≈ 0.0000149.
 */
export async function fetchCryptoRates(): Promise<
  Array<{ quoteCurrency: string; rate: number }>
> {
  const ids = Array.from(SUPPORTED_CRYPTO.values()).join(",");
  const url = `${COINGECKO_API_URL}?ids=${ids}&vs_currencies=usd`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `CoinGecko rate fetch failed (${response.status}): ${(await response.text()).slice(0, 200)}`
    );
  }

  const data = (await response.json()) as Record<
    string,
    { usd: number }
  >;

  const rates: Array<{ quoteCurrency: string; rate: number }> = [];

  for (const [symbol, geckoId] of SUPPORTED_CRYPTO) {
    const entry = data[geckoId];
    if (entry && entry.usd > 0) {
      // USD/CRYPTO = 1 / price_in_usd
      rates.push({
        quoteCurrency: symbol,
        rate: 1 / entry.usd,
      });
    }
  }

  return rates;
}
