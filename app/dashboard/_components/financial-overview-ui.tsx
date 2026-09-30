"use client";

import { useLocale } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPeriodLabel } from "@/lib/i18n/format";
import type { FinancialOverview } from "@/lib/queries/financial-overview";

export function formatFinancialAmount(
  value: number | null | undefined,
  currency: string,
  locale: string,
  options?: { maximumFractionDigits?: number },
): string {
  return formatCurrency(locale, value, currency, {
    minimumFractionDigits: 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 0,
  });
}

export function formatFinancialCompactAmount(
  value: number | null | undefined,
  currency: string,
  locale: string,
  options?: { maximumFractionDigits?: number },
): string {
  if (value === null || value === undefined) return "--";

  const abs = Math.abs(value);
  if (abs < 1_000) {
    return formatFinancialAmount(value, currency, locale, options);
  }

  return formatCurrency(locale, value, currency, {
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 1,
  });
}

export function formatFinancialAxis(value: number, currency: string, locale: string): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${currency} ${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    return `${currency} ${(value / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${currency} ${(value / 1_000).toFixed(0)}k`;
  }
  return formatFinancialAmount(value, currency, locale);
}

export function formatFinancialPeriod(period: string | null, locale: string): string {
  return formatPeriodLabel(locale, period);
}

export function formatDashboardWindowLabel(months: number, locale: string): string {
  if (months === 1) {
    if (locale === "ru") return "последний месяц";
    if (locale === "id") return "1 bulan terakhir";
    return "last month";
  }

  if (months === 60) {
    if (locale === "ru") return "последние 5 лет";
    if (locale === "id") return "5 tahun terakhir";
    return "last 5 years";
  }

  if (locale === "ru") return `последние ${months} мес.`;
  if (locale === "id") return `${months} bulan terakhir`;
  return `last ${months} months`;
}

export function formatSelectedWindowHint(months: number, locale: string): string {
  const windowLabel = formatDashboardWindowLabel(months, locale);
  if (locale === "ru") return `По выбранному окну: ${windowLabel}`;
  if (locale === "id") return `Dalam rentang terpilih: ${windowLabel}`;
  return `Across selected window: ${windowLabel}`;
}

export function formatLatestInWindowHint(
  period: string | null,
  months: number,
  locale: string,
): string {
  const periodLabel = formatFinancialPeriod(period, locale);
  if (locale === "ru") {
    return `Последняя точка в выбранном окне: ${periodLabel}`;
  }
  if (locale === "id") {
    return `Titik terbaru dalam rentang terpilih: ${periodLabel}`;
  }
  return `Latest point in selected window: ${periodLabel}`;
}

export function formatChangeAcrossWindowHint(months: number, locale: string): string {
  const windowLabel = formatDashboardWindowLabel(months, locale);
  if (locale === "ru") return `Изменение за ${windowLabel}`;
  if (locale === "id") return `Perubahan selama ${windowLabel}`;
  return `Change across ${windowLabel}`;
}

export function formatLiveSnapshotHint(locale: string): string {
  if (locale === "ru") return "Live snapshot, не зависит от периода дашборда";
  if (locale === "id") return "Snapshot live, tidak mengikuti periode dashboard";
  return "Live snapshot, not affected by dashboard period";
}

export function sumFinancialValues(values: Array<number | null | undefined>): number | null {
  let hasValue = false;
  let total = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    hasValue = true;
    total += value;
  }

  return hasValue ? total : null;
}

export function averageFinancialValues(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    total += value;
    count += 1;
  }

  return count > 0 ? total / count : null;
}

export function deltaFinancialValues(
  latest: number | null | undefined,
  earliest: number | null | undefined,
): number | null {
  if (
    typeof latest !== "number" ||
    !Number.isFinite(latest) ||
    typeof earliest !== "number" ||
    !Number.isFinite(earliest)
  ) {
    return null;
  }

  return latest - earliest;
}

export interface FinancialIndicatorItem {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "negative";
}

function getQualityBadgeLabel(
  quality: FinancialOverview["quality"],
  locale: string,
): string {
  switch (quality) {
    case "verified":
      return locale === "ru" ? "Подтверждено" : locale === "id" ? "Terverifikasi" : "Verified";
    case "partial":
      return locale === "ru" ? "Частично" : locale === "id" ? "Parsial" : "Partial";
    case "estimated":
      return locale === "ru" ? "Оценка" : locale === "id" ? "Estimasi" : "Estimated";
    default:
      return locale === "ru" ? "Нет данных" : locale === "id" ? "Tidak ada data" : "No data";
  }
}

function getQualityVariant(
  quality: FinancialOverview["quality"],
): "default" | "secondary" | "destructive" | "outline" {
  switch (quality) {
    case "verified":
      return "default";
    case "partial":
      return "secondary";
    case "estimated":
      return "outline";
    default:
      return "destructive";
  }
}

export function FinancialOverviewMeta({
  overview,
  months,
}: {
  overview: FinancialOverview;
  months?: number;
}) {
  const locale = useLocale();
  const latestVerifiedLabel =
    locale === "ru"
      ? "Последний подтверждённый период"
      : locale === "id"
        ? "Periode terverifikasi terbaru"
        : "Latest verified period";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">{overview.sourceLabel}</Badge>
      <Badge variant="outline">
        {overview.provenance.seriesSource === "statements"
          ? locale === "ru"
            ? "Стейтменты"
            : locale === "id"
              ? "Laporan"
              : "Statements"
          : overview.provenance.seriesSource === "transactions"
            ? locale === "ru"
              ? "Транзакции"
              : locale === "id"
                ? "Transaksi"
                : "Transactions"
            : overview.provenance.seriesSource === "mixed"
              ? locale === "ru"
                ? "Смешанный источник"
                : locale === "id"
                  ? "Sumber campuran"
                  : "Mixed source"
              : locale === "ru"
                ? "Без источника"
                : locale === "id"
                  ? "Tanpa sumber"
                  : "No source"}
      </Badge>
      <Badge variant={getQualityVariant(overview.quality)}>
        {getQualityBadgeLabel(overview.quality, locale)}
      </Badge>
      {typeof months === "number" ? (
        <Badge variant="secondary">
          {locale === "ru"
            ? `Окно: ${formatDashboardWindowLabel(months, locale)}`
            : locale === "id"
              ? `Rentang: ${formatDashboardWindowLabel(months, locale)}`
              : `Window: ${formatDashboardWindowLabel(months, locale)}`}
        </Badge>
      ) : null}
      <Badge variant="secondary">
        {latestVerifiedLabel}: {formatFinancialPeriod(overview.sourcePeriod, locale)}
      </Badge>
      {overview.warnings.map((warning) => (
        <Badge
          key={warning}
          variant="outline"
          className="max-w-full whitespace-normal break-words text-muted-foreground"
        >
          {warning}
        </Badge>
      ))}
    </div>
  );
}

export function FinancialIndicatorGrid({
  title,
  items,
}: {
  title: string;
  items: FinancialIndicatorItem[];
}) {
  const visibleItems = items.filter((item) => item.value.trim().length > 0);
  if (visibleItems.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground font-medium">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((item) => (
            <div key={item.label} className="min-w-0 rounded-lg border border-border/70 bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p
                className={`break-words text-lg leading-tight font-semibold ${
                  item.tone === "positive"
                    ? "text-green-500"
                    : item.tone === "negative"
                      ? "text-red-500"
                      : "text-foreground"
                }`}
              >
                {item.value}
              </p>
              {item.hint ? <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p> : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
