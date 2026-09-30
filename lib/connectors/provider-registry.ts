import type { ApiKeyScope } from "@/lib/api-key-scopes";

export type ConnectorProviderCategory =
  | "payments"
  | "banking"
  | "commerce"
  | "accounting"
  | "ads"
  | "storage_documents"
  | "analytics"
  | "people_support"
  | "collaboration"
  | "custom_integrations";

export type ConnectorProviderMaturity =
  | "available"
  | "beta"
  | "internal"
  | "coming_soon"
  | "custom_only"
  | "deprecated";

export type ConnectorIntegrationStatus = "available" | "coming-soon";

export type ConnectorSetupKind =
  | "oauth"
  | "api_key"
  | "manual_workflow"
  | "custom_bridge"
  | "coming_soon";

export type ConnectorSurface =
  | "agent_connectors"
  | "hub_legacy"
  | "synced_data_only"
  | "none";

export type ConnectorProviderDefinition = {
  slug: string;
  label: string;
  description: string;
  category: ConnectorProviderCategory;
  maturity: ConnectorProviderMaturity;
  integrationStatus: ConnectorIntegrationStatus;
  setupKind: ConnectorSetupKind;
  visibleInIntegrations: boolean;
  capabilities: readonly string[];
  surface: ConnectorSurface;
  useScopesAnyOf: readonly ApiKeyScope[];
  extraActionScopesAllOf?: Readonly<Record<string, readonly ApiKeyScope[]>>;
  usesOAuthInUi: boolean;
  expectedSyncIntervalMs?: number | null;
};

export const CONNECTOR_CATEGORY_METADATA = {
  payments: { label: "Payments" },
  banking: { label: "Banking" },
  commerce: { label: "Commerce" },
  accounting: { label: "Accounting" },
  ads: { label: "Ads" },
  storage_documents: { label: "Storage & Documents" },
  analytics: { label: "Analytics" },
  people_support: { label: "People & Support" },
  collaboration: { label: "Collaboration" },
  custom_integrations: { label: "Custom Integrations" },
} as const satisfies Record<
  ConnectorProviderCategory,
  { label: string }
>;

const CONNECTOR_CATEGORY_ORDER: readonly ConnectorProviderCategory[] = [
  "payments",
  "banking",
  "commerce",
  "accounting",
  "ads",
  "storage_documents",
  "analytics",
  "people_support",
  "collaboration",
  "custom_integrations",
];

export const CONNECTOR_PROVIDER_REGISTRY = [
  {
    slug: "stripe",
    label: "Stripe",
    description: "Payment processing and subscriptions.",
    category: "payments",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs", "webhooks"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: false,
    expectedSyncIntervalMs: 15 * 60 * 1000,
  },
  {
    slug: "paypal",
    label: "PayPal",
    description: "Online payments and transfers.",
    category: "payments",
    maturity: "coming_soon",
    integrationStatus: "coming-soon",
    setupKind: "coming_soon",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs", "webhooks"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: false,
    expectedSyncIntervalMs: 4 * 60 * 60 * 1000,
  },
  {
    slug: "paddle",
    label: "Paddle",
    description: "SaaS billing and payments.",
    category: "payments",
    maturity: "coming_soon",
    integrationStatus: "coming-soon",
    setupKind: "coming_soon",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: false,
  },
  {
    slug: "mercury",
    label: "Mercury",
    description: "Business banking for startups.",
    category: "banking",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs", "webhooks"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: false,
    expectedSyncIntervalMs: 15 * 60 * 1000,
  },
  {
    slug: "wise",
    label: "Wise",
    description: "International transfers and accounts.",
    category: "banking",
    maturity: "coming_soon",
    integrationStatus: "coming-soon",
    setupKind: "coming_soon",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: false,
  },
  {
    slug: "plaid",
    label: "Plaid",
    description: "Bank account aggregation.",
    category: "banking",
    maturity: "beta",
    integrationStatus: "coming-soon",
    setupKind: "oauth",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs", "webhooks"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: true,
    expectedSyncIntervalMs: 6 * 60 * 60 * 1000,
  },
  {
    slug: "truelayer",
    label: "TrueLayer",
    description: "Open banking accounts, balances, and transactions.",
    category: "banking",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "oauth",
    visibleInIntegrations: false,
    capabilities: ["sync_jobs", "webhooks"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: true,
    expectedSyncIntervalMs: 6 * 60 * 60 * 1000,
  },
  {
    slug: "shopify",
    label: "Shopify",
    description: "E-commerce platform.",
    category: "commerce",
    maturity: "beta",
    integrationStatus: "coming-soon",
    setupKind: "oauth",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs", "webhooks"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: true,
    expectedSyncIntervalMs: 24 * 60 * 60 * 1000,
  },
  {
    slug: "gumroad",
    label: "Gumroad",
    description: "Digital product sales.",
    category: "commerce",
    maturity: "coming_soon",
    integrationStatus: "coming-soon",
    setupKind: "coming_soon",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: false,
  },
  {
    slug: "rutter",
    label: "Rutter",
    description: "Commerce and accounting data normalization bridge.",
    category: "commerce",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "oauth",
    visibleInIntegrations: false,
    capabilities: ["sync_jobs", "webhooks"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: true,
    expectedSyncIntervalMs: 24 * 60 * 60 * 1000,
  },
  {
    slug: "quickbooks",
    label: "QuickBooks",
    description: "Small business accounting.",
    category: "accounting",
    maturity: "coming_soon",
    integrationStatus: "coming-soon",
    setupKind: "coming_soon",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs", "live_query"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: false,
  },
  {
    slug: "xero",
    label: "Xero",
    description: "Cloud accounting software.",
    category: "accounting",
    maturity: "coming_soon",
    integrationStatus: "coming-soon",
    setupKind: "coming_soon",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs", "live_query"],
    surface: "none",
    useScopesAnyOf: [],
    usesOAuthInUi: false,
  },
  {
    slug: "odoo",
    label: "Odoo",
    description: "Query connected Odoo records through the server-side connector.",
    category: "accounting",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query", "synced_data"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.odoo"],
    usesOAuthInUi: false,
    expectedSyncIntervalMs: 24 * 60 * 60 * 1000,
  },
  {
    slug: "google_ads",
    label: "Google Ads",
    description: "Read accessible Google Ads accounts and campaign performance metrics.",
    category: "ads",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "oauth",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs", "metrics_time_series", "live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.google_ads"],
    usesOAuthInUi: true,
    expectedSyncIntervalMs: 24 * 60 * 60 * 1000,
  },
  {
    slug: "meta_ads",
    label: "Meta Ads",
    description: "Read accessible Meta ad accounts and campaign performance metrics.",
    category: "ads",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "oauth",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs", "metrics_time_series", "live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.meta_ads"],
    usesOAuthInUi: true,
    expectedSyncIntervalMs: 24 * 60 * 60 * 1000,
  },
  {
    slug: "tiktok_ads",
    label: "TikTok Ads",
    description: "Read configured TikTok advertiser metrics and campaign performance.",
    category: "ads",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["sync_jobs", "metrics_time_series", "live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.tiktok_ads"],
    usesOAuthInUi: false,
    expectedSyncIntervalMs: 24 * 60 * 60 * 1000,
  },
  {
    slug: "linkedin_ads",
    label: "LinkedIn Ads",
    description: "Read LinkedIn ad accounts, campaigns, and bounded analytics from a connected marketing token.",
    category: "ads",
    maturity: "beta",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["metrics_time_series", "live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.linkedin_ads"],
    usesOAuthInUi: false,
    expectedSyncIntervalMs: 24 * 60 * 60 * 1000,
  },
  {
    slug: "ga4",
    label: "Google Analytics 4",
    description: "Read accessible GA4 properties, reporting dimensions, metrics, and bounded analytics reports.",
    category: "analytics",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "oauth",
    visibleInIntegrations: true,
    capabilities: ["live_query", "metrics_time_series"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.ga4"],
    usesOAuthInUi: true,
  },
  {
    slug: "google_search_console",
    label: "Google Search Console",
    description: "Read sites, search analytics, and sitemap health from the connected Search Console account.",
    category: "analytics",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "oauth",
    visibleInIntegrations: true,
    capabilities: ["live_query", "metrics_time_series"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.google_search_console"],
    usesOAuthInUi: true,
  },
  {
    slug: "google_drive",
    label: "Google Drive",
    description: "Browse connected Google Drive folders/files and queue imports through the document pipeline.",
    category: "storage_documents",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "oauth",
    visibleInIntegrations: true,
    capabilities: ["live_browse", "import_selection", "watched_folders"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.google_drive"],
    extraActionScopesAllOf: {
      import_selection: ["documents.write"],
    },
    usesOAuthInUi: true,
    expectedSyncIntervalMs: 24 * 60 * 60 * 1000,
  },
  {
    slug: "metabase",
    label: "Metabase",
    description: "Browse collections, dashboards, saved questions, and databases from the connected Metabase workspace.",
    category: "analytics",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.metabase"],
    usesOAuthInUi: false,
  },
  {
    slug: "posthog",
    label: "PostHog",
    description: "Browse organizations, projects, dashboards, insights, feature flags, and query results from the connected PostHog workspace.",
    category: "analytics",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query", "metrics_time_series"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.posthog"],
    usesOAuthInUi: false,
  },
  {
    slug: "hubspot",
    label: "HubSpot",
    description: "Read portal, contact, company, and deal data from the connected HubSpot workspace.",
    category: "analytics",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.hubspot"],
    usesOAuthInUi: false,
  },
  {
    slug: "bamboohr",
    label: "BambooHR",
    description: "Browse employee and directory data through the connected BambooHR account.",
    category: "people_support",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.bamboohr"],
    usesOAuthInUi: false,
  },
  {
    slug: "confluence",
    label: "Confluence",
    description: "Browse spaces, pages, and search results from the connected Confluence workspace.",
    category: "people_support",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.confluence"],
    usesOAuthInUi: false,
  },
  {
    slug: "ms_graph",
    label: "Microsoft Graph",
    description: "Browse Microsoft Entra directory and organization data via Microsoft Graph.",
    category: "people_support",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.ms_graph"],
    usesOAuthInUi: false,
  },
  {
    slug: "dynamics_bc",
    label: "Dynamics 365 BC",
    description: "Read companies and accounting entities from Dynamics 365 Business Central.",
    category: "people_support",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.dynamics_bc"],
    usesOAuthInUi: false,
    expectedSyncIntervalMs: 24 * 60 * 60 * 1000,
  },
  {
    slug: "payhawk",
    label: "Payhawk",
    description: "Read expenses, approvals, fund accounts, and bank statement data from the connected Payhawk account.",
    category: "people_support",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.payhawk"],
    usesOAuthInUi: false,
  },
  {
    slug: "zendesk",
    label: "Zendesk",
    description: "Browse tickets and users from the connected Zendesk workspace.",
    category: "people_support",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.zendesk"],
    usesOAuthInUi: false,
  },
  {
    slug: "linkedin_mcp",
    label: "LinkedIn MCP",
    description: "Bridge to a custom remote LinkedIn MCP server.",
    category: "people_support",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "custom_bridge",
    visibleInIntegrations: true,
    capabilities: ["mcp_bridge"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.linkedin_mcp"],
    usesOAuthInUi: false,
  },
  {
    slug: "custom_http",
    label: "Custom HTTP API",
    description: "Company-specific read-only REST or JSON API with explicit allowlisted actions.",
    category: "custom_integrations",
    maturity: "beta",
    integrationStatus: "available",
    setupKind: "manual_workflow",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.custom_http"],
    usesOAuthInUi: false,
  },
  {
    slug: "custom_openapi",
    label: "Custom OpenAPI",
    description: "Import read-only GET operations from a company OpenAPI spec and expose them through the connector plane.",
    category: "custom_integrations",
    maturity: "beta",
    integrationStatus: "available",
    setupKind: "manual_workflow",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.custom_openapi"],
    usesOAuthInUi: false,
  },
  {
    slug: "custom_mcp",
    label: "Custom MCP",
    description: "Bridge to a company-specific remote MCP endpoint with an explicit read-only tool allowlist.",
    category: "custom_integrations",
    maturity: "beta",
    integrationStatus: "available",
    setupKind: "custom_bridge",
    visibleInIntegrations: true,
    capabilities: ["mcp_bridge"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.custom_mcp"],
    usesOAuthInUi: false,
  },
  {
    slug: "github",
    label: "GitHub",
    description: "Read repositories, issues, pull requests, commits, and workflow runs from the connected GitHub account.",
    category: "collaboration",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.github"],
    usesOAuthInUi: false,
  },
  {
    slug: "vercel",
    label: "Vercel",
    description: "Read teams, projects, deployments, domains, and logs from the connected Vercel account.",
    category: "collaboration",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.vercel"],
    usesOAuthInUi: false,
  },
  {
    slug: "linear",
    label: "Linear",
    description: "Read teams, projects, issues, comments, cycles, and users from the connected Linear workspace.",
    category: "collaboration",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.linear"],
    usesOAuthInUi: false,
  },
  {
    slug: "notion",
    label: "Notion",
    description: "Read pages, data sources, and search results from the connected Notion workspace.",
    category: "collaboration",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["live_query"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.notion"],
    usesOAuthInUi: false,
  },
  {
    slug: "slack",
    label: "Slack",
    description: "Workspace channels, message history, and posting through the connector hub.",
    category: "collaboration",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["hub_actions", "synced_data"],
    surface: "hub_legacy",
    useScopesAnyOf: ["connectors.use.slack", "connectors.hub"],
    usesOAuthInUi: false,
  },
  {
    slug: "jira",
    label: "Jira",
    description: "Projects, issues, and comments through the connector hub.",
    category: "collaboration",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "api_key",
    visibleInIntegrations: true,
    capabilities: ["hub_actions", "synced_data"],
    surface: "hub_legacy",
    useScopesAnyOf: ["connectors.use.jira", "connectors.hub"],
    usesOAuthInUi: false,
  },
  {
    slug: "email_ingest",
    label: "Email Forwarding",
    description: "Synced inbound email data available in communications and Company-DB.",
    category: "collaboration",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "manual_workflow",
    visibleInIntegrations: true,
    capabilities: ["synced_data"],
    surface: "synced_data_only",
    useScopesAnyOf: [],
    usesOAuthInUi: false,
  },
  {
    slug: "telegram",
    label: "Telegram",
    description: "Browse connected Telegram chats and read synced message history.",
    category: "collaboration",
    maturity: "available",
    integrationStatus: "available",
    setupKind: "manual_workflow",
    visibleInIntegrations: true,
    capabilities: ["live_list_chats", "synced_messages"],
    surface: "agent_connectors",
    useScopesAnyOf: ["connectors.use.telegram"],
    usesOAuthInUi: false,
    expectedSyncIntervalMs: 60 * 60 * 1000,
  },
] as const satisfies readonly ConnectorProviderDefinition[];

export type RegisteredConnectorProviderSlug =
  typeof CONNECTOR_PROVIDER_REGISTRY[number]["slug"];

const PROVIDER_DEFINITION_BY_SLUG: ReadonlyMap<string, ConnectorProviderDefinition> = new Map(
  CONNECTOR_PROVIDER_REGISTRY.map((provider) => [provider.slug, provider]),
);

export function getConnectorProviderDefinition(providerSlug: string) {
  return PROVIDER_DEFINITION_BY_SLUG.get(providerSlug) ?? null;
}

export function getConnectorCapabilities(providerSlug: string): readonly string[] {
  return getConnectorProviderDefinition(providerSlug)?.capabilities ?? ["synced_data"];
}

export function getConnectorUseScopes(providerSlug: string): readonly ApiKeyScope[] {
  return getConnectorProviderDefinition(providerSlug)?.useScopesAnyOf ?? [];
}

export function isConnectorProviderAllowedByScopes(
  providerSlug: string,
  allowedConnectorScopes: readonly string[] | null | undefined,
): boolean {
  if (!allowedConnectorScopes) return true;

  const allowedScopes = new Set(allowedConnectorScopes);
  return getConnectorUseScopes(providerSlug).some((scope) => allowedScopes.has(scope));
}

export function filterConnectorProvidersByScopes<T extends { provider: string }>(
  entries: readonly T[],
  allowedConnectorScopes: readonly string[] | null | undefined,
): T[] {
  if (!allowedConnectorScopes) return [...entries];
  return entries.filter((entry) =>
    isConnectorProviderAllowedByScopes(entry.provider, allowedConnectorScopes),
  );
}

export function getConnectorExtraActionScopes(
  providerSlug: string,
  action: string,
): readonly ApiKeyScope[] {
  const definition = getConnectorProviderDefinition(providerSlug);
  if (!definition?.extraActionScopesAllOf) return [];
  return definition.extraActionScopesAllOf[action] ?? [];
}

export function getConnectorExpectedSyncIntervalMs(providerSlug: string): number | null {
  return getConnectorProviderDefinition(providerSlug)?.expectedSyncIntervalMs ?? null;
}

export function listVisibleIntegrationProviders() {
  return CONNECTOR_PROVIDER_REGISTRY.filter((provider) => provider.visibleInIntegrations);
}

export function listUiOAuthProviders() {
  return listVisibleIntegrationProviders().filter(
    (provider) => provider.usesOAuthInUi && provider.integrationStatus === "available",
  );
}

export function listConnectionEnabledProviders() {
  return CONNECTOR_PROVIDER_REGISTRY.filter(
    (provider) => provider.setupKind !== "coming_soon",
  );
}

export function listIntegrationProviderCategories() {
  return CONNECTOR_CATEGORY_ORDER.map((category) => ({
    key: category,
    label: CONNECTOR_CATEGORY_METADATA[category].label,
    providers: listVisibleIntegrationProviders().filter(
      (provider) => provider.category === category,
    ),
  })).filter((category) => category.providers.length > 0);
}
