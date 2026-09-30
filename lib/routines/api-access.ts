import {
  requireCompanyDbDomainAccess,
  type AuthContext,
} from "@/lib/api-auth";
import { ForbiddenError } from "@/lib/errors";
import { hasApiKeySuperScope, type ApiKeyScope } from "@/lib/api-key-scopes";
import { LEGAL_WATCH_BKPM_TEMPLATE_KEY, type RoutineStatus } from "@/lib/routines/types";

export interface RoutineAccessTarget {
  domain: string;
  templateKey?: string | null;
  slug?: string | null;
  reviewPolicy?: unknown;
}

export type RoutineAccessLevel = "read" | "write" | "review" | "admin";

function truthyEnv(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function companyAllowlistIncludes(companyId: string): boolean {
  const values = (process.env.LEGAL_WATCH_COMPANY_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.includes("*") || values.includes(companyId);
}

function isLegalWatchTarget(target: RoutineAccessTarget): boolean {
  return (
    target.templateKey === LEGAL_WATCH_BKPM_TEMPLATE_KEY ||
    target.slug === "legal-watch-bkpm"
  );
}

function requireRoutineApiKeyScope(auth: AuthContext, level: RoutineAccessLevel): void {
  if (auth.authMethod !== "api_key") return;
  const scopes = new Set(auth.apiKeyScopes ?? []);
  if (hasApiKeySuperScope(auth.apiKeyScopes ?? [])) return;
  const requiredScope: ApiKeyScope =
    level === "read"
      ? "routines.read"
      : level === "review"
        ? "routines.review"
        : "routines.write";
  const allowedScopes: ApiKeyScope[] =
    level === "read"
      ? ["routines.read", "routines.write", "routines.review"]
      : level === "review"
        ? ["routines.review"]
        : ["routines.write"];
  if (allowedScopes.some((scope) => scopes.has(scope))) return;
  throw new ForbiddenError(`API key scope ${requiredScope} is required for routine ${level} access`);
}

export function isLegalWatchEnabledForCompany(companyId: string): boolean {
  if (truthyEnv(process.env.LEGAL_WATCH_ENABLED)) return true;
  if (companyAllowlistIncludes(companyId)) return true;
  if (process.env.NODE_ENV !== "production" && process.env.LEGAL_WATCH_ENABLED !== "0") {
    return true;
  }
  return false;
}

export function requireRoutineRolloutEnabled(
  auth: AuthContext,
  target: RoutineAccessTarget,
): void {
  if (!isLegalWatchTarget(target)) return;
  if (isLegalWatchEnabledForCompany(auth.companyId)) return;
  throw new ForbiddenError("Legal Watch is not enabled for this company");
}

export function requireRoutineDomainAccess(
  auth: AuthContext,
  target: RoutineAccessTarget,
  level: RoutineAccessLevel = "read",
): void {
  requireRoutineRolloutEnabled(auth, target);
  requireRoutineApiKeyScope(auth, level);
  const domainLevel = level === "read" ? "read" : level === "admin" ? "admin" : "write";
  requireCompanyDbDomainAccess(auth, target.domain, domainLevel);
}

export function requireRoutineReviewAccess(
  auth: AuthContext,
  target: RoutineAccessTarget,
): void {
  requireRoutineDomainAccess(auth, target, "review");
}

export function requireRoutinePolicyAdmin(auth: AuthContext): void {
  requireRoutineApiKeyScope(auth, "write");
  if (!["owner", "admin"].includes(auth.role)) {
    throw new ForbiddenError("Routine policy updates require company owner or admin access");
  }
}

export function canRunRoutineNow(status: RoutineStatus | string): boolean {
  return status === "active" || status === "paused";
}

export function canReadRoutine(auth: AuthContext, target: RoutineAccessTarget): boolean {
  try {
    requireRoutineDomainAccess(auth, target, "read");
    return true;
  } catch (error) {
    if (error instanceof ForbiddenError) return false;
    throw error;
  }
}
