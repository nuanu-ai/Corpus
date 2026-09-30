import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { fxRates } from "@/lib/db/schema";

/**
 * Daily cron that fetches FX rates from ECB (16:15 CET = 15:15 UTC)
 * and CoinGecko, then stores them in the fx_rates table.
 */
export const fetchFxRatesCron = inngest.createFunction(
  { id: "fetch-fx-rates-daily" },
  { cron: "15 15 * * *" }, // 15:15 UTC = 16:15 CET (after ECB publishes)
  async ({ step }) => {
    // Step 1: Fetch ECB rates (fiat currencies)
    const ecbRates = await step.run("fetch-ecb-rates", async () => {
      const { fetchEcbRates, convertToUsdBase } = await import("@/lib/fx/ecb");
      const eurRates = await fetchEcbRates();
      return convertToUsdBase(eurRates);
    });

    // Step 2: Fetch supplemental fiat rates for currencies ECB does not cover (for example RUB).
    const supplementalFiatRates = await step.run("fetch-supplemental-fiat-rates", async () => {
      try {
        const { fetchOpenExchangeRates, filterSupplementalFiatRates } = await import("@/lib/fx/open-er-api");
        const openRates = await fetchOpenExchangeRates();
        return filterSupplementalFiatRates(openRates, ecbRates.map((rate) => rate.quoteCurrency));
      } catch (error) {
        console.warn("Supplemental FX fetch failed; continuing with ECB + crypto only", error);
        return [];
      }
    });

    // Step 3: Fetch crypto rates from CoinGecko
    const cryptoRates = await step.run("fetch-crypto-rates", async () => {
      const { fetchCryptoRates } = await import("@/lib/fx/coingecko");
      return fetchCryptoRates();
    });

    // Step 4: Store all rates in the database
    const stored = await step.run("store-rates", async () => {
      const now = new Date();
      let count = 0;

      for (const rate of ecbRates) {
        await db.insert(fxRates).values({
          baseCurrency: "USD",
          quoteCurrency: rate.quoteCurrency,
          rate: String(rate.rate),
          source: "ecb",
          rateDate: now,
        });
        count++;
      }

      for (const rate of supplementalFiatRates) {
        await db.insert(fxRates).values({
          baseCurrency: "USD",
          quoteCurrency: rate.quoteCurrency,
          rate: String(rate.rate),
          source: "open_er_api",
          rateDate: now,
        });
        count++;
      }

      for (const rate of cryptoRates) {
        await db.insert(fxRates).values({
          baseCurrency: "USD",
          quoteCurrency: rate.quoteCurrency,
          rate: String(rate.rate),
          source: "coingecko",
          rateDate: now,
        });
        count++;
      }

      return count;
    });

    return { ratesStored: stored };
  }
);
