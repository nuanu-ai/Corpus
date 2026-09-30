import { CONNECTOR_PROVIDER_REGISTRY } from "@/lib/connectors/provider-registry";

export const API_KEY_SUPER_SCOPE = "*" as const;

export const API_KEY_SCOPES = [
  API_KEY_SUPER_SCOPE,
  "companies.read",
  "companies.create",
  "companies.members.read",
  "companies.members.manage",
  "profile.read",
  "profile.write",
  "settings.read",
  "settings.write",
  "dashboard.read",
  "people.read",
  "people.write",
  "routines.read",
  "routines.write",
  "routines.review",
  "company_db.read",
  "company_db.file",
  "company_db.mcp",
  "connectors.read",
  "connectors.use.google_ads",
  "connectors.use.meta_ads",
  "connectors.use.tiktok_ads",
  "connectors.use.linkedin_ads",
  "connectors.use.ga4",
  "connectors.use.google_search_console",
  "connectors.use.hubspot",
  "connectors.use.custom_http",
  "connectors.use.custom_openapi",
  "connectors.use.custom_mcp",
  "connectors.use.github",
  "connectors.use.vercel",
  "connectors.use.linear",
  "connectors.use.notion",
  "connectors.use.slack",
  "connectors.use.jira",
  "connectors.use.telegram",
  "connectors.use.odoo",
  "connectors.use.google_drive",
  "connectors.use.bamboohr",
  "connectors.use.confluence",
  "connectors.use.ms_graph",
  "connectors.use.dynamics_bc",
  "connectors.use.payhawk",
  "connectors.use.zendesk",
  "connectors.use.linkedin_mcp",
  "connectors.use.metabase",
  "connectors.use.posthog",
  "connectors.hub",
  "documents.read",
  "documents.write",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function hasApiKeySuperScope(scopes: readonly string[]): boolean {
  return scopes.includes(API_KEY_SUPER_SCOPE);
}

function isConnectorUseScope(scope: string): scope is ApiKeyScope {
  return scope.startsWith("connectors.use.");
}

export const CONNECTOR_USE_API_KEY_SCOPES: ApiKeyScope[] = Array.from(
  new Set(
    CONNECTOR_PROVIDER_REGISTRY.flatMap((provider) =>
      provider.useScopesAnyOf.filter(isConnectorUseScope),
    ),
  ),
);

export const CONNECTOR_OPERATOR_API_KEY_SCOPES: ApiKeyScope[] = Array.from(
  new Set<ApiKeyScope>([...CONNECTOR_USE_API_KEY_SCOPES, "connectors.hub"]),
);

const CONNECTOR_USE_SCOPE_LABELS = Object.fromEntries(
  CONNECTOR_PROVIDER_REGISTRY.flatMap((provider) =>
    provider.useScopesAnyOf
      .filter(isConnectorUseScope)
      .map((scope) => [scope, `Connectors Use ${provider.label}`]),
  ),
) as Record<string, string>;

export const DEFAULT_API_KEY_SCOPES: ApiKeyScope[] = [
  "companies.read",
  "profile.read",
  "dashboard.read",
  "people.read",
  "routines.read",
  "routines.write",
  "company_db.read",
  "company_db.file",
  "company_db.mcp",
  "connectors.read",
  "connectors.hub",
  "documents.read",
  "documents.write",
];

/**
 * Compatibility fallback for legacy keys created before scoped access existed.
 * Keep this narrow: official external agent surfaces only.
 */
export const LEGACY_API_KEY_SCOPES: ApiKeyScope[] = [
  "company_db.read",
  "company_db.file",
  "company_db.mcp",
  "connectors.hub",
  "documents.read",
  "documents.write",
];

const EXTERNAL_AGENT_DOCUMENT_SCOPE_TRIGGERS: ApiKeyScope[] = [
  "company_db.file",
  "company_db.mcp",
  "connectors.hub",
];

export const EXTERNAL_AGENT_DOCUMENT_SCOPES: ApiKeyScope[] = [
  "documents.read",
  "documents.write",
];

const EXTERNAL_AGENT_ROUTINE_READ_SCOPE_TRIGGERS: ApiKeyScope[] = [
  "company_db.read",
  "company_db.file",
  "company_db.mcp",
];

const EXTERNAL_AGENT_ROUTINE_READ_SCOPES: ApiKeyScope[] = [
  "routines.read",
];

export const API_KEY_SCOPE_LABELS = {
  [API_KEY_SUPER_SCOPE]: "Full Access",
  "companies.read": "Companies Read",
  "companies.create": "Companies Create",
  "companies.members.read": "Company Members Read",
  "companies.members.manage": "Company Members Manage",
  "profile.read": "Profile Read",
  "profile.write": "Profile Write",
  "settings.read": "Settings Read",
  "settings.write": "Settings Write",
  "dashboard.read": "Dashboard Read",
  "people.read": "People Read",
  "people.write": "People Write",
  "routines.read": "Routines Read",
  "routines.write": "Routines Write",
  "routines.review": "Routines Review",
  "company_db.read": "Company-DB Read",
  "company_db.file": "Company-DB File",
  "company_db.mcp": "Company-DB MCP",
  "connectors.read": "Connectors Read",
  ...CONNECTOR_USE_SCOPE_LABELS,
  "connectors.hub": "Connectors Hub",
  "documents.read": "Documents Read",
  "documents.write": "Documents Write",
} as Record<ApiKeyScope, string>;

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === "string" && (API_KEY_SCOPES as readonly string[]).includes(value);
}

export function normalizeApiKeyScopes(value: unknown): ApiKeyScope[] {
  if (value == null) {
    return [...LEGACY_API_KEY_SCOPES];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const unique = Array.from(new Set(value.filter(isApiKeyScope)));
  if (hasApiKeySuperScope(unique)) return [API_KEY_SUPER_SCOPE];
  return unique;
}

export function expandApiKeyScopesForCurrentContract(
  scopes: ApiKeyScope[],
): ApiKeyScope[] {
  if (hasApiKeySuperScope(scopes)) {
    return [...API_KEY_SCOPES];
  }
  const hasExternalAgentSurface = EXTERNAL_AGENT_DOCUMENT_SCOPE_TRIGGERS.some((scope) =>
    scopes.includes(scope),
  );
  const hasRoutineReadSurface = EXTERNAL_AGENT_ROUTINE_READ_SCOPE_TRIGGERS.some((scope) =>
    scopes.includes(scope),
  );
  return Array.from(new Set([
    ...scopes,
    ...(hasExternalAgentSurface ? EXTERNAL_AGENT_DOCUMENT_SCOPES : []),
    ...(hasRoutineReadSurface ? EXTERNAL_AGENT_ROUTINE_READ_SCOPES : []),
  ]));
}
