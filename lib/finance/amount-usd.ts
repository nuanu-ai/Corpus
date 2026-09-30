export function amountUsdIfUsd(amount: string, currency: string): string | null {
  return currency.trim().toUpperCase() === "USD" ? amount : null;
}
