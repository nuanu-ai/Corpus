import type { CompanyMembership } from "@/lib/db/tenant";
import { ForbiddenError } from "@/lib/errors";
import type { ReportJobRecord } from "@/lib/report-jobs/types";

const REPORT_JOB_COMPANY_DB_DOMAIN = "finance";
const REPORT_JOB_COMPANY_DB_LEVEL = "read";
const REPORT_JOB_CONNECTOR_SCOPE = "connectors.use.odoo";
const DOMAIN_ACCESS_LEVELS = ["metadata", "read", "file", "write", "admin"] as const;
type DomainAccessLevel = typeof DOMAIN_ACCESS_LEVELS[number];
const INVALID_EXECUTION_ACCESS_SNAPSHOT =
  "Report-job execution requires a valid access snapshot";

function invalidExecutionAccessSnapshot(): ForbiddenError {
  return new ForbiddenError(INVALID_EXECUTION_ACCESS_SNAPSHOT);
}

function normalizedSet(values: readonly string[] | null | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function domainAccessLevelsFromContext(
  value: unknown,
): Record<string, DomainAccessLevel> | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidExecutionAccessSnapshot();
  }

  const levels: Record<string, DomainAccessLevel> = {};
  for (const [domain, level] of Object.entries(value)) {
    const normalizedDomain = domain.trim().toLowerCase();
    if (
      !normalizedDomain ||
      typeof level !== "string" ||
      !DOMAIN_ACCESS_LEVELS.includes(level as DomainAccessLevel)
    ) {
      throw invalidExecutionAccessSnapshot();
    }
    levels[normalizedDomain] = level as DomainAccessLevel;
  }
  return levels;
}

function financeDomainAccessLevel(
  membership: Pick<CompanyMembership, "domainAccessLevels">,
): DomainAccessLevel | null {
  return (
    membership.domainAccessLevels?.[REPORT_JOB_COMPANY_DB_DOMAIN] ??
    membership.domainAccessLevels?.["*"] ??
    null
  );
}

function hasRestrictedCompanyDomainPolicy(
  membership: Pick<CompanyMembership, "allowedDomains" | "domainAccessLevels">,
): boolean {
  return Array.isArray(membership.allowedDomains) || Boolean(membership.domainAccessLevels);
}

export function hasReportJobAccess(membership: CompanyMembership): boolean {
  if (Array.isArray(membership.allowedDomains)) {
    const allowedDomains = normalizedSet(membership.allowedDomains);
    if (!allowedDomains.has(REPORT_JOB_COMPANY_DB_DOMAIN)) return false;
  }
  const financeLevel = financeDomainAccessLevel(membership);
  if (membership.domainAccessLevels && !financeLevel) return false;
  if (financeLevel === "metadata") return false;

  if (membership.accessSource !== "inherited") return true;

  const allowedConnectorScopes = normalizedSet(membership.allowedConnectorScopes);
  return allowedConnectorScopes.has(REPORT_JOB_CONNECTOR_SCOPE);
}

export function requireReportJobAccess(membership: CompanyMembership): void {
  if (Array.isArray(membership.allowedDomains)) {
    const allowedDomains = normalizedSet(membership.allowedDomains);
    if (!allowedDomains.has(REPORT_JOB_COMPANY_DB_DOMAIN)) {
      if (membership.accessSource === "inherited") {
        throw new ForbiddenError(
          "Inherited report-job access requires finance Company-DB domain",
        );
      }
      throw new ForbiddenError(
        "Report-job access requires finance Company-DB domain",
      );
    }
  }

  const financeLevel = financeDomainAccessLevel(membership);
  if (membership.domainAccessLevels && !financeLevel) {
    throw new ForbiddenError(
      "Report-job access requires finance Company-DB domain",
    );
  }
  if (financeLevel === "metadata") {
    throw new ForbiddenError(
      `Report-job access requires ${REPORT_JOB_COMPANY_DB_LEVEL} finance Company-DB level`,
    );
  }

  if (membership.accessSource !== "inherited") return;

  const allowedConnectorScopes = normalizedSet(membership.allowedConnectorScopes);
  if (!allowedConnectorScopes.has(REPORT_JOB_CONNECTOR_SCOPE)) {
    throw new ForbiddenError(
      "Inherited report-job access requires Odoo connector scope",
    );
  }
}

export const hasReportJobInheritedAccess = hasReportJobAccess;
export const requireReportJobInheritedAccess = requireReportJobAccess;

export function filterReportJobAccessibleCompanies(
  memberships: CompanyMembership[],
): CompanyMembership[] {
  return memberships.filter(hasReportJobAccess);
}

function hasSnapshotField(
  context: Record<string, unknown>,
  field: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(context, field);
}

function arrayFromContext(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw invalidExecutionAccessSnapshot();
  }

  return value.map((item) => {
    if (typeof item !== "string") {
      throw invalidExecutionAccessSnapshot();
    }
    const normalized = item.trim().toLowerCase();
    if (!normalized) {
      throw invalidExecutionAccessSnapshot();
    }
    return normalized;
  });
}

function nullableArrayFromContext(value: unknown): string[] | null {
  if (value === null) return null;
  return arrayFromContext(value);
}

function accessSourceFromContext(
  value: unknown,
): NonNullable<CompanyMembership["accessSource"]> | null {
  if (
    value === "direct" ||
    value === "api_key_parent" ||
    value === "inherited"
  ) {
    return value;
  }
  return null;
}

export function requireReportJobExecutionAccess(
  job: Pick<ReportJobRecord, "executionContext">,
): void {
  const context = job.executionContext;
  if (
    !context ||
    typeof context !== "object" ||
    Array.isArray(context) ||
    !hasSnapshotField(context, "companyAccessSource") ||
    !hasSnapshotField(context, "allowedDomains") ||
    !hasSnapshotField(context, "domainAccessLevels") ||
    !hasSnapshotField(context, "allowedConnectorScopes")
  ) {
    throw invalidExecutionAccessSnapshot();
  }

  const accessSource = accessSourceFromContext(context.companyAccessSource);
  if (!accessSource) {
    throw invalidExecutionAccessSnapshot();
  }

  const domainAccessLevels = domainAccessLevelsFromContext(
    context.domainAccessLevels,
  );
  const allowedDomains = nullableArrayFromContext(context.allowedDomains);
  const allowedConnectorScopes =
    context.allowedConnectorScopes === null
      ? []
      : arrayFromContext(context.allowedConnectorScopes);
  const inheritedSnapshot = accessSource === "inherited";
  if (!allowedDomains && !domainAccessLevels && !inheritedSnapshot) {
    return;
  }

  const membership: CompanyMembership = {
    companyId: "report-job-execution",
    companyName: "Report job execution",
    companySlug: null,
    companyDbPort: 3100,
    companySettings: null,
    role: "viewer",
    joinedAt: new Date(0),
    accessSource,
    allowedDomains: allowedDomains ?? (inheritedSnapshot ? [] : null),
    domainAccessLevels,
    allowedConnectorScopes,
  };

  if (!hasRestrictedCompanyDomainPolicy(membership)) return;
  requireReportJobAccess(membership);
}
