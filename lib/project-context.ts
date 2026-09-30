import { getEmbedCompatibleCookieAttributes } from "./embed-config";
import { extractCookieValue } from "./company-context";

const embedCookieAttributes = getEmbedCompatibleCookieAttributes();

export const ACTIVE_PROJECT_COOKIE = "active-project-id";
export const PROJECTS_CHANGED_EVENT = "corpus:projects-changed";

export interface ProjectsChangedDetail {
  activeProjectId?: string | null;
  project?: {
    id: string;
    name: string;
    role: string;
    projectKind: "company" | "personal";
  } | null;
}

export const ACTIVE_PROJECT_COOKIE_OPTIONS = {
  path: "/",
  sameSite: embedCookieAttributes.sameSite,
  httpOnly: true,
  secure: embedCookieAttributes.secure,
  maxAge: 60 * 60 * 24 * 180,
};

export function getRequestedProjectIdFromHeaders(
  hdrs: Pick<Headers, "get">,
): string | null {
  const headerProjectId = hdrs.get("x-project-id")?.trim();
  if (headerProjectId) return headerProjectId;

  const cookieProjectId = extractCookieValue(
    hdrs.get("cookie"),
    ACTIVE_PROJECT_COOKIE,
  )?.trim();

  return cookieProjectId || null;
}
