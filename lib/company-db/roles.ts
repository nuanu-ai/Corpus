export const APP_COMPANY_DB_ROLES = [
  "owner",
  "admin",
  "member",
  "viewer",
  "cfo_agent",
  "external_accountant",
  "investor_view",
  "partner_agent",
] as const;

export type AppCompanyDbRole = (typeof APP_COMPANY_DB_ROLES)[number];

/**
 * Map app-level membership roles to explicit Company-DB roles.
 *
 * Security rule:
 * - missing role means internal service default -> `cfo_agent`
 * - unknown role means least-privilege external fallback -> `viewer`
 */
export function toCompanyDbRole(appRole: string | undefined): AppCompanyDbRole {
  if (!appRole) return "cfo_agent";

  switch (appRole) {
    case "owner":
    case "admin":
    case "member":
    case "viewer":
    case "external_accountant":
    case "investor_view":
    case "partner_agent":
    case "cfo_agent":
      return appRole;
    default:
      return "viewer";
  }
}
