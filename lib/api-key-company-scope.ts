export const API_KEY_COMPANY_SCOPE_MODES = [
  "single_company",
  "selected_companies",
  "all_user_companies",
] as const;

export type ApiKeyCompanyScopeMode =
  (typeof API_KEY_COMPANY_SCOPE_MODES)[number];

export const DEFAULT_API_KEY_COMPANY_SCOPE_MODE: ApiKeyCompanyScopeMode =
  "single_company";

export const API_KEY_COMPANY_SCOPE_MODE_LABELS: Record<
  ApiKeyCompanyScopeMode,
  string
> = {
  single_company: "Single company",
  selected_companies: "Selected companies",
  all_user_companies: "All accessible companies",
};

export function isApiKeyCompanyScopeMode(
  value: unknown,
): value is ApiKeyCompanyScopeMode {
  return (
    typeof value === "string" &&
    (API_KEY_COMPANY_SCOPE_MODES as readonly string[]).includes(value)
  );
}

export function normalizeApiKeyCompanyScopeMode(
  value: unknown,
): ApiKeyCompanyScopeMode {
  return isApiKeyCompanyScopeMode(value)
    ? value
    : DEFAULT_API_KEY_COMPANY_SCOPE_MODE;
}

export function normalizeApiKeyAllowedCompanyIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (companyId): companyId is string =>
          typeof companyId === "string" && companyId.trim().length > 0,
      ),
    ),
  );
}
