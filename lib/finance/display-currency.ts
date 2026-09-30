export interface DisplayCurrencyAccountLike {
  reportingCurrency?: string | null;
  currency?: string | null;
}

export function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3,5}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function resolveDisplayCurrency(input: {
  overviewCurrency?: unknown;
  accounts?: ReadonlyArray<DisplayCurrencyAccountLike> | null;
  fallback?: string | null;
}): string {
  const overviewCurrency = normalizeCurrencyCode(input.overviewCurrency);
  if (overviewCurrency) {
    return overviewCurrency;
  }

  const accounts = input.accounts ?? [];
  const reportingCurrency = accounts
    .map((account) => normalizeCurrencyCode(account.reportingCurrency))
    .find((value): value is string => Boolean(value));
  if (reportingCurrency) {
    return reportingCurrency;
  }

  const nativeCurrencies = accounts
    .map((account) => normalizeCurrencyCode(account.currency))
    .filter((value): value is string => Boolean(value));
  const uniqueNativeCurrencies = Array.from(new Set(nativeCurrencies));
  if (uniqueNativeCurrencies.length === 1) {
    return uniqueNativeCurrencies[0]!;
  }
  if (nativeCurrencies.length > 0) {
    return nativeCurrencies[0]!;
  }

  return normalizeCurrencyCode(input.fallback) ?? "USD";
}
