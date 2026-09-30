import type { CompanyMembership } from "@/lib/db/tenant";
import type { ApiKeyCompanyScopeMode } from "@/lib/api-key-company-scope";

export type ApiKeyAccessDescriptor = {
  companyScopeMode: ApiKeyCompanyScopeMode;
  defaultCompanyId: string | null;
  allowedCompanyIds: string[];
};

export function getAccessibleCompaniesForApiKey(
  memberships: CompanyMembership[],
  access: ApiKeyAccessDescriptor,
): CompanyMembership[] {
  switch (access.companyScopeMode) {
    case "all_user_companies":
      return memberships;
    case "selected_companies": {
      const allowed = new Set(access.allowedCompanyIds);
      return memberships.filter((membership) => allowed.has(membership.companyId));
    }
    case "single_company":
    default: {
      if (access.defaultCompanyId) {
        return memberships.filter(
          (membership) => membership.companyId === access.defaultCompanyId,
        );
      }

      if (access.allowedCompanyIds.length > 0) {
        const allowed = new Set(access.allowedCompanyIds);
        return memberships.filter((membership) => allowed.has(membership.companyId));
      }

      // Legacy keys without an explicit company scope no longer receive blanket tenant access.
      return memberships.length === 1 ? memberships : [];
    }
  }
}

export function resolveApiKeyCompanyId(
  requestedCompanyId: string | null,
  accessibleCompanies: CompanyMembership[],
  access: ApiKeyAccessDescriptor,
): string | null {
  if (requestedCompanyId) {
    const match = findAccessibleCompanyByReference(accessibleCompanies, requestedCompanyId);
    return match?.companyId ?? null;
  }

  if (access.defaultCompanyId) {
    const match = accessibleCompanies.find(
      (company) => company.companyId === access.defaultCompanyId,
    );
    if (match) return match.companyId;
  }

  if (accessibleCompanies.length === 1) {
    return accessibleCompanies[0].companyId;
  }

  return null;
}

function findAccessibleCompanyByReference(
  accessibleCompanies: CompanyMembership[],
  requestedCompanyRef: string,
): CompanyMembership | null {
  const normalizedRef = normalizeCompanyReference(requestedCompanyRef);
  if (!normalizedRef) return null;

  return (
    accessibleCompanies.find((company) => company.companyId === requestedCompanyRef) ??
    accessibleCompanies.find((company) => normalizeCompanyReference(company.companySlug) === normalizedRef) ??
    accessibleCompanies.find((company) => normalizeCompanyReference(company.companyName) === normalizedRef) ??
    null
  );
}

function normalizeCompanyReference(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}
