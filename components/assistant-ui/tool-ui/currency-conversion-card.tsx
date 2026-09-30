"use client";

// Inline renderer for tool results carrying `action: "currency_conversion"`.
// Ported from app/dashboard/_components/chat-panel.tsx renderCompanyDbToolPreview
// (~line 772). Re-implemented as a standalone component so this module does
// not import from dashboard/_components.

import { useLocale } from "next-intl";

import { getAppCopy } from "@/lib/i18n/copy";

import { toNumber, toText } from "@/app/assistant/_lib/normalizers";
import {
  formatCurrencyAmount,
  formatFxRate,
} from "@/app/assistant/_lib/tool-output-utils";

export interface CurrencyConversionCardProps {
  result: Record<string, unknown>;
}

export function CurrencyConversionCard({ result }: CurrencyConversionCardProps) {
  const locale = useLocale();
  const copy = getAppCopy(locale).chat.v2.tool.currencyConversion;

  const errorText = toText(result.error);
  const amount = toNumber(result.amount);
  const convertedAmount = toNumber(result.convertedAmount);
  const fxRate = toNumber(result.fxRate);
  const fromCurrency = toText(result.fromCurrency) ?? "N/A";
  const toCurrency = toText(result.toCurrency) ?? "N/A";
  const rateDate = toText(result.rateDate);
  const message = toText(result.message);
  const verified = result.verified === true;
  const hasConversion =
    amount !== null && convertedAmount !== null && fxRate !== null;

  const statusText = errorText
    ? copy.statusError
    : verified
      ? copy.statusVerified
      : copy.statusUnavailable;

  return (
    <details
      open={Boolean(errorText) || Boolean(message) || hasConversion}
      className="my-2 min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-foreground"
    >
      <summary className="cursor-pointer list-none break-words font-medium [overflow-wrap:anywhere]">
        {copy.title}
        <span className="ml-2 text-muted-foreground">{statusText}</span>
      </summary>

      <div className="mt-3 space-y-3">
        {errorText ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
            {errorText}
          </div>
        ) : (
          <>
            {amount !== null && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {copy.sourceAmount}
                  </div>
                  <div className="mt-1 font-medium text-foreground">
                    {formatCurrencyAmount(amount, fromCurrency)}
                  </div>
                  <div className="mt-1 text-muted-foreground">{fromCurrency}</div>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {copy.convertedAmount}
                  </div>
                  <div className="mt-1 font-medium text-foreground">
                    {convertedAmount !== null
                      ? formatCurrencyAmount(convertedAmount, toCurrency)
                      : copy.unavailable}
                  </div>
                  <div className="mt-1 text-muted-foreground">{toCurrency}</div>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 space-y-1">
              {fxRate !== null ? (
                <div className="text-muted-foreground">
                  {formatFxRate(fxRate, fromCurrency, toCurrency)}
                </div>
              ) : (
                <div className="text-muted-foreground">{copy.noRate}</div>
              )}
              {rateDate && (
                <div className="text-muted-foreground">
                  {copy.rateDateFormat.replace("{date}", rateDate)}
                </div>
              )}
              <div
                className={
                  verified
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-amber-700 dark:text-amber-300"
                }
              >
                {verified ? copy.verifiedNote : copy.unavailableNote}
              </div>
            </div>

            {message && (
              <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 text-muted-foreground">
                {message}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
