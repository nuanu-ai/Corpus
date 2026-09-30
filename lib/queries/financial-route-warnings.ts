import { NextResponse } from "next/server";

export function applyFinancialWarningHeaders(
  response: NextResponse,
  warnings: string[],
): NextResponse {
  const uniqueWarnings = Array.from(new Set(warnings.filter(Boolean)));
  if (uniqueWarnings.length === 0) {
    return response;
  }

  response.headers.set("X-CORPUS-Warning-Count", String(uniqueWarnings.length));
  response.headers.set("X-CORPUS-Warnings", uniqueWarnings.join(" | "));
  return response;
}
