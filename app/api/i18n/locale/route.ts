import { NextResponse } from "next/server";

import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  isAppLocale,
} from "@/lib/i18n/config";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | { locale?: string | null }
    | null;

  const locale = payload?.locale;
  if (!isAppLocale(locale)) {
    return NextResponse.json(
      { error: "Invalid locale" },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ ok: true, locale });
  response.cookies.set(LOCALE_COOKIE_NAME, locale, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
