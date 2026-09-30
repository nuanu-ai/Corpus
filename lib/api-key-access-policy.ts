export const API_KEY_ACCESS_POLICY_VERSIONS = [
  "legacy_imported_parent",
  "access_graph_v1",
  "direct_only",
] as const;

export type ApiKeyAccessPolicyVersion =
  (typeof API_KEY_ACCESS_POLICY_VERSIONS)[number];

export const DEFAULT_API_KEY_ACCESS_POLICY_VERSION: ApiKeyAccessPolicyVersion =
  "legacy_imported_parent";

export const API_KEY_ACCESS_POLICY_VERSION_LABELS: Record<
  ApiKeyAccessPolicyVersion,
  string
> = {
  access_graph_v1: "Direct + approved linked companies",
  direct_only: "Direct companies only",
  legacy_imported_parent: "Legacy imported children",
};

export function normalizeApiKeyAccessPolicyVersion(
  value: unknown,
): ApiKeyAccessPolicyVersion {
  return typeof value === "string" &&
    (API_KEY_ACCESS_POLICY_VERSIONS as readonly string[]).includes(value)
    ? (value as ApiKeyAccessPolicyVersion)
    : DEFAULT_API_KEY_ACCESS_POLICY_VERSION;
}
