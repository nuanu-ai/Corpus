export const APP_LOCALES = ["en", "ru", "id"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";
export const LOCALE_COOKIE_NAME = "corpus-locale";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === "en" || value === "ru" || value === "id";
}

export function normalizeAppLocale(value: string | null | undefined): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_LOCALE;
}

export function getIntlLocale(locale: AppLocale | string | null | undefined): string {
  switch (normalizeAppLocale(locale)) {
    case "ru":
      return "ru-RU";
    case "id":
      return "id-ID";
    default:
      return "en-US";
  }
}

export function resolveLocaleFromAcceptLanguage(
  headerValue: string | null | undefined,
): AppLocale {
  if (!headerValue) return DEFAULT_LOCALE;

  const candidates = headerValue
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === "ru" || candidate.startsWith("ru-")) return "ru";
    if (candidate === "id" || candidate.startsWith("id-")) return "id";
    if (candidate === "en" || candidate.startsWith("en-")) return "en";
  }

  return DEFAULT_LOCALE;
}
