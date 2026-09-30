import { getIntlLocale, normalizeAppLocale, type AppLocale } from "@/lib/i18n/config";

function resolveLocale(locale: AppLocale | string | null | undefined): string {
  return getIntlLocale(normalizeAppLocale(locale));
}

export function formatCurrency(
  locale: AppLocale | string | null | undefined,
  value: number | null | undefined,
  currency: string,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number; notation?: "standard" | "compact" },
): string {
  if (value === null || value === undefined) return "--";

  return new Intl.NumberFormat(resolveLocale(locale), {
    style: "currency",
    currency,
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 0,
    notation: options?.notation ?? "standard",
  }).format(value);
}

export function formatPeriodLabel(
  locale: AppLocale | string | null | undefined,
  period: string | null,
): string {
  if (!period) {
    switch (normalizeAppLocale(locale)) {
      case "ru":
        return "Неизвестный период";
      case "id":
        return "Periode tidak diketahui";
      default:
        return "Unknown period";
    }
  }

  const monthMatch = period.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const date = new Date(
      Date.UTC(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1),
    );
    return new Intl.DateTimeFormat(resolveLocale(locale), {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  }

  const quarterMatch = period.match(/^(\d{4})-q([1-4])$/i);
  if (quarterMatch) {
    return `Q${quarterMatch[2]} ${quarterMatch[1]}`;
  }

  return period;
}

export function formatShortDate(
  locale: AppLocale | string | null | undefined,
  value: string | Date,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(resolveLocale(locale), {
    dateStyle: "medium",
  }).format(date);
}

export function pickPluralWord(
  locale: AppLocale | string | null | undefined,
  count: number,
  forms: {
    one: string;
    few?: string;
    many?: string;
    other?: string;
  },
): string {
  const category = new Intl.PluralRules(resolveLocale(locale)).select(count);

  switch (category) {
    case "one":
      return forms.one;
    case "few":
      return forms.few ?? forms.other ?? forms.many ?? forms.one;
    case "many":
      return forms.many ?? forms.other ?? forms.few ?? forms.one;
    default:
      return forms.other ?? forms.many ?? forms.few ?? forms.one;
  }
}
