import { getRate } from "@/lib/fx";

type NativeBalanceLike = {
  currency: string;
  nativeBalance: number;
};

export type ReportingBalanceResult<T extends NativeBalanceLike> = T & {
  reportingCurrency: string;
  reportingRate: number | null;
  reportingBalance: number | null;
};

export async function attachReportingBalances<T extends NativeBalanceLike>(
  rows: T[],
  reportingCurrency: string,
  asOfDate: Date = new Date(),
): Promise<Array<ReportingBalanceResult<T>>> {
  const normalizedReportingCurrency = reportingCurrency.toUpperCase();
  const uniqueCurrenciesNeedingFx = Array.from(
    new Set(
      rows
        .map((row) => row.currency.toUpperCase())
        .filter((currency) => currency !== normalizedReportingCurrency),
    ),
  );

  const rateEntries = await Promise.all(
    uniqueCurrenciesNeedingFx.map(async (currency) => {
      const rate = await getRate(currency, normalizedReportingCurrency, asOfDate).catch(() => null);
      return [currency, rate] as const;
    }),
  );

  const rateByCurrency = new Map<string, number | null>(rateEntries);

  return rows.map((row) => {
    const normalizedCurrency = row.currency.toUpperCase();
    if (normalizedCurrency === normalizedReportingCurrency) {
      return {
        ...row,
        reportingCurrency: normalizedReportingCurrency,
        reportingRate: 1,
        reportingBalance: row.nativeBalance,
      };
    }

    const reportingRate = rateByCurrency.get(normalizedCurrency) ?? null;
    return {
      ...row,
      reportingCurrency: normalizedReportingCurrency,
      reportingRate,
      reportingBalance:
        reportingRate === null
          ? null
          : Number((row.nativeBalance * reportingRate).toFixed(2)),
    };
  });
}
