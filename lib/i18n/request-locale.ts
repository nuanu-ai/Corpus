import { cookies, headers } from "next/headers";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  isAppLocale,
  resolveLocaleFromAcceptLanguage,
  type AppLocale,
} from "@/lib/i18n/config";

export async function getRequestLocaleValue(): Promise<AppLocale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (isAppLocale(cookieLocale)) return cookieLocale;

  const requestHeaders = await headers();
  const headerLocale = resolveLocaleFromAcceptLanguage(
    requestHeaders.get("accept-language"),
  );
  return headerLocale ?? DEFAULT_LOCALE;
}
