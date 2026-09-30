import { getEmbedCompatibleCookieAttributes } from "./embed-config";

const embedCookieAttributes = getEmbedCompatibleCookieAttributes();

export const ACTIVE_COMPANY_COOKIE = "active-company-id";
export const COMPANIES_CHANGED_EVENT = "corpus:companies-changed";

export interface CompaniesChangedDetail {
  activeCompanyId?: string | null;
  company?: {
    id: string;
    name: string;
    role: string;
  } | null;
}

export const ACTIVE_COMPANY_COOKIE_OPTIONS = {
  path: "/",
  sameSite: embedCookieAttributes.sameSite,
  httpOnly: true,
  secure: embedCookieAttributes.secure,
  maxAge: 60 * 60 * 24 * 180, // 180 days
};

export function extractCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const target = `${name}=`;
  const parts = cookieHeader.split(";");
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part.startsWith(target)) continue;
    const value = part.slice(target.length);
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function getRequestedCompanyIdFromHeaders(
  hdrs: Pick<Headers, "get">,
): string | null {
  const headerCompanyId = hdrs.get("x-company-id")?.trim();
  if (headerCompanyId) return headerCompanyId;

  const cookieCompanyId = extractCookieValue(
    hdrs.get("cookie"),
    ACTIVE_COMPANY_COOKIE,
  )?.trim();

  return cookieCompanyId || null;
}
