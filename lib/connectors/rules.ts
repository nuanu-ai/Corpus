import { parseQmd } from "@/lib/company-db/summary/qmd";
import { z } from "zod";

export const CONNECTOR_RULES_DIRECTORY = "operations/connectors";

export const CONNECTOR_RULE_TEMPLATE_PROVIDERS = [
  "slack",
  "google_ads",
  "meta_ads",
  "tiktok_ads",
  "linkedin_ads",
  "ga4",
  "google_search_console",
  "hubspot",
  "github",
  "vercel",
  "posthog",
  "linear",
  "notion",
  "google_drive",
  "custom_http",
  "custom_openapi",
  "custom_mcp",
] as const;

export type ConnectorRuleTemplateProvider =
  typeof CONNECTOR_RULE_TEMPLATE_PROVIDERS[number];

export const connectorRuleBaseFrontmatterSchema = z.object({
  provider: z.string().min(1),
  policy_mode: z.enum(["advisory", "mixed", "strict"]).optional(),
  notes: z.string().optional(),
});

const connectorRuleStringishSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => value.length > 0, "Expected a non-empty string value");

export type ConnectorRuleBaseFrontmatter = z.infer<
  typeof connectorRuleBaseFrontmatterSchema
>;

export const slackConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("slack"),
    workspace_ids: z.array(z.string()).optional(),
    allowed_channel_ids: z.array(z.string()).optional(),
    blocked_channel_ids: z.array(z.string()).optional(),
    default_channel_ids: z.array(z.string()).optional(),
    allow_posting: z.boolean().optional(),
    posting_requires_approval: z.boolean().optional(),
    strict_channel_scope: z.boolean().optional(),
  });

export type SlackConnectorRuleFrontmatter = z.infer<
  typeof slackConnectorRuleFrontmatterSchema
>;

export const googleAdsConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("google_ads"),
    account_ids: z.array(connectorRuleStringishSchema).optional(),
    default_account_id: connectorRuleStringishSchema.optional(),
    timezone: z.string().optional(),
    attribution_notes: z.string().optional(),
    strict_account_scope: z.boolean().optional(),
  });

export type GoogleAdsConnectorRuleFrontmatter = z.infer<
  typeof googleAdsConnectorRuleFrontmatterSchema
>;

export const metaAdsConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("meta_ads"),
    account_ids: z.array(connectorRuleStringishSchema).optional(),
    default_account_id: connectorRuleStringishSchema.optional(),
    timezone: z.string().optional(),
    attribution_notes: z.string().optional(),
    strict_account_scope: z.boolean().optional(),
  });

export type MetaAdsConnectorRuleFrontmatter = z.infer<
  typeof metaAdsConnectorRuleFrontmatterSchema
>;

export const tiktokAdsConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("tiktok_ads"),
    advertiser_ids: z.array(connectorRuleStringishSchema).optional(),
    default_advertiser_id: connectorRuleStringishSchema.optional(),
    timezone: z.string().optional(),
    attribution_notes: z.string().optional(),
    strict_account_scope: z.boolean().optional(),
  });

export type TiktokAdsConnectorRuleFrontmatter = z.infer<
  typeof tiktokAdsConnectorRuleFrontmatterSchema
>;

export const linkedinAdsConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("linkedin_ads"),
    account_ids: z.array(connectorRuleStringishSchema).optional(),
    campaign_ids: z.array(connectorRuleStringishSchema).optional(),
    default_account_id: connectorRuleStringishSchema.optional(),
    timezone: z.string().optional(),
    attribution_notes: z.string().optional(),
    strict_account_scope: z.boolean().optional(),
  });

export type LinkedinAdsConnectorRuleFrontmatter = z.infer<
  typeof linkedinAdsConnectorRuleFrontmatterSchema
>;

export const ga4ConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("ga4"),
    property_ids: z.array(connectorRuleStringishSchema).optional(),
    default_property_id: connectorRuleStringishSchema.optional(),
    timezone: z.string().optional(),
    report_notes: z.string().optional(),
    strict_property_scope: z.boolean().optional(),
  });

export type Ga4ConnectorRuleFrontmatter = z.infer<
  typeof ga4ConnectorRuleFrontmatterSchema
>;

export const googleSearchConsoleConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("google_search_console"),
    site_urls: z.array(z.string()).optional(),
    default_site_url: z.string().optional(),
    search_type_notes: z.string().optional(),
    strict_site_scope: z.boolean().optional(),
  });

export type GoogleSearchConsoleConnectorRuleFrontmatter = z.infer<
  typeof googleSearchConsoleConnectorRuleFrontmatterSchema
>;

export const hubspotConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("hubspot"),
    portal_ids: z.array(connectorRuleStringishSchema).optional(),
    allowed_pipeline_ids: z.array(connectorRuleStringishSchema).optional(),
    default_pipeline_ids: z.array(connectorRuleStringishSchema).optional(),
    crm_notes: z.string().optional(),
    strict_deal_scope: z.boolean().optional(),
  });

export type HubspotConnectorRuleFrontmatter = z.infer<
  typeof hubspotConnectorRuleFrontmatterSchema
>;

export const githubConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("github"),
    allowed_orgs: z.array(z.string()).optional(),
    allowed_repos: z.array(z.string()).optional(),
    default_repos: z.array(z.string()).optional(),
    blocked_repos: z.array(z.string()).optional(),
    prod_sensitive_repos: z.array(z.string()).optional(),
    write_policy: z.enum(["deny", "approval", "allow"]).optional(),
    strict_repo_scope: z.boolean().optional(),
  });

export type GithubConnectorRuleFrontmatter = z.infer<
  typeof githubConnectorRuleFrontmatterSchema
>;

export const vercelConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("vercel"),
    allowed_teams: z.array(z.string()).optional(),
    allowed_projects: z.array(z.string()).optional(),
    production_projects: z.array(z.string()).optional(),
    preview_allowed: z.boolean().optional(),
    log_access_policy: z.enum(["deny", "restricted", "allow"]).optional(),
    strict_project_scope: z.boolean().optional(),
  });

export type VercelConnectorRuleFrontmatter = z.infer<
  typeof vercelConnectorRuleFrontmatterSchema
>;

export const posthogConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("posthog"),
    project_ids: z.array(connectorRuleStringishSchema).optional(),
    default_project_id: connectorRuleStringishSchema.optional(),
    canonical_dashboard_ids: z.array(connectorRuleStringishSchema).optional(),
    timezone: z.string().optional(),
    metric_naming_notes: z.string().optional(),
    strict_project_scope: z.boolean().optional(),
  });

export type PosthogConnectorRuleFrontmatter = z.infer<
  typeof posthogConnectorRuleFrontmatterSchema
>;

export const linearConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("linear"),
    allowed_team_ids: z.array(connectorRuleStringishSchema).optional(),
    allowed_project_ids: z.array(connectorRuleStringishSchema).optional(),
    default_team_ids: z.array(connectorRuleStringishSchema).optional(),
    default_project_ids: z.array(connectorRuleStringishSchema).optional(),
    issue_status_notes: z.string().optional(),
    strict_scope: z.boolean().optional(),
  });

export type LinearConnectorRuleFrontmatter = z.infer<
  typeof linearConnectorRuleFrontmatterSchema
>;

export const notionConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("notion"),
    workspace_ids: z.array(connectorRuleStringishSchema).optional(),
    allowed_page_ids: z.array(connectorRuleStringishSchema).optional(),
    allowed_data_source_ids: z.array(connectorRuleStringishSchema).optional(),
    default_page_ids: z.array(connectorRuleStringishSchema).optional(),
    default_data_source_ids: z.array(connectorRuleStringishSchema).optional(),
    strict_content_scope: z.boolean().optional(),
  });

export type NotionConnectorRuleFrontmatter = z.infer<
  typeof notionConnectorRuleFrontmatterSchema
>;

export const googleDriveConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("google_drive"),
    connection_ids: z.array(z.string()).optional(),
    root_paths: z.array(z.string()).optional(),
    allowed_folder_ids: z.array(z.string()).optional(),
    blocked_folder_ids: z.array(z.string()).optional(),
    default_folder_ids: z.array(z.string()).optional(),
    import_requires_approval: z.boolean().optional(),
    strict_root_scope: z.boolean().optional(),
  });

export type GoogleDriveConnectorRuleFrontmatter = z.infer<
  typeof googleDriveConnectorRuleFrontmatterSchema
>;

export const customHttpConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("custom_http"),
    allowed_connection_ids: z.array(z.string()).optional(),
    allowed_action_names: z.array(connectorRuleStringishSchema).optional(),
    strict_connection_scope: z.boolean().optional(),
  });

export type CustomHttpConnectorRuleFrontmatter = z.infer<
  typeof customHttpConnectorRuleFrontmatterSchema
>;

export const customOpenApiConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("custom_openapi"),
    allowed_connection_ids: z.array(z.string()).optional(),
    allowed_action_names: z.array(connectorRuleStringishSchema).optional(),
    strict_connection_scope: z.boolean().optional(),
  });

export type CustomOpenApiConnectorRuleFrontmatter = z.infer<
  typeof customOpenApiConnectorRuleFrontmatterSchema
>;

export const customMcpConnectorRuleFrontmatterSchema =
  connectorRuleBaseFrontmatterSchema.extend({
    provider: z.literal("custom_mcp"),
    allowed_connection_ids: z.array(z.string()).optional(),
    allowed_tool_names: z.array(connectorRuleStringishSchema).optional(),
    strict_connection_scope: z.boolean().optional(),
  });

export type CustomMcpConnectorRuleFrontmatter = z.infer<
  typeof customMcpConnectorRuleFrontmatterSchema
>;

export type ConnectorRuleFrontmatter =
  | SlackConnectorRuleFrontmatter
  | GoogleAdsConnectorRuleFrontmatter
  | MetaAdsConnectorRuleFrontmatter
  | TiktokAdsConnectorRuleFrontmatter
  | LinkedinAdsConnectorRuleFrontmatter
  | Ga4ConnectorRuleFrontmatter
  | GoogleSearchConsoleConnectorRuleFrontmatter
  | HubspotConnectorRuleFrontmatter
  | GithubConnectorRuleFrontmatter
  | VercelConnectorRuleFrontmatter
  | PosthogConnectorRuleFrontmatter
  | LinearConnectorRuleFrontmatter
  | NotionConnectorRuleFrontmatter
  | GoogleDriveConnectorRuleFrontmatter
  | CustomHttpConnectorRuleFrontmatter
  | CustomOpenApiConnectorRuleFrontmatter
  | CustomMcpConnectorRuleFrontmatter
  | ConnectorRuleBaseFrontmatter;

export interface ConnectorRuleSummary {
  path: string;
  exists: boolean;
  provider: string;
  policyMode: "advisory" | "mixed" | "strict";
  strict: boolean;
  notes: string | null;
  restrictionSummary: Record<string, number | boolean | string | null>;
  error?: string;
}

export interface ParsedConnectorRuleDocument {
  path: string;
  raw: string;
  body: string;
  frontmatter: ConnectorRuleFrontmatter;
  summary: ConnectorRuleSummary;
}

export function getConnectorRuleFrontmatterSchema(
  provider: string,
) {
  switch (provider) {
    case "slack":
      return slackConnectorRuleFrontmatterSchema;
    case "google_ads":
      return googleAdsConnectorRuleFrontmatterSchema;
    case "meta_ads":
      return metaAdsConnectorRuleFrontmatterSchema;
    case "tiktok_ads":
      return tiktokAdsConnectorRuleFrontmatterSchema;
    case "linkedin_ads":
      return linkedinAdsConnectorRuleFrontmatterSchema;
    case "ga4":
      return ga4ConnectorRuleFrontmatterSchema;
    case "google_search_console":
      return googleSearchConsoleConnectorRuleFrontmatterSchema;
    case "hubspot":
      return hubspotConnectorRuleFrontmatterSchema;
    case "github":
      return githubConnectorRuleFrontmatterSchema;
    case "vercel":
      return vercelConnectorRuleFrontmatterSchema;
    case "posthog":
      return posthogConnectorRuleFrontmatterSchema;
    case "linear":
      return linearConnectorRuleFrontmatterSchema;
    case "notion":
      return notionConnectorRuleFrontmatterSchema;
    case "google_drive":
      return googleDriveConnectorRuleFrontmatterSchema;
    case "custom_http":
      return customHttpConnectorRuleFrontmatterSchema;
    case "custom_openapi":
      return customOpenApiConnectorRuleFrontmatterSchema;
    case "custom_mcp":
      return customMcpConnectorRuleFrontmatterSchema;
    default:
      return connectorRuleBaseFrontmatterSchema;
  }
}

export function getConnectorRuleFilePath(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    throw new Error(`Invalid connector rule provider slug: ${provider}`);
  }
  return `${CONNECTOR_RULES_DIRECTORY}/${normalized}.qmd`;
}

const CONNECTOR_RULE_TEMPLATES: Record<ConnectorRuleTemplateProvider, string> = {
  slack: `---
provider: slack
policy_mode: mixed
workspace_ids: []
allowed_channel_ids: []
blocked_channel_ids: []
default_channel_ids: []
allow_posting: false
posting_requires_approval: true
strict_channel_scope: false
notes: ""
---

# Slack Connector Rules

## Scope

- List the canonical workspaces and channels agents may use.
- Explain any blocked channels or high-sensitivity channels.

## Guidance

- Define where agents should search first.
- Explain when posting is allowed versus approval-gated.
`,
  google_ads: `---
provider: google_ads
policy_mode: mixed
account_ids: []
default_account_id: ""
timezone: ""
attribution_notes: ""
strict_account_scope: false
notes: ""
---

# Google Ads Connector Rules

## Scope

- List the approved Google Ads customer accounts agents may inspect.
- Mark the default account for routine performance reviews.

## Guidance

- Document timezone and attribution expectations for campaign reporting.
- Note any accounts, campaigns, or MCC hierarchies agents must avoid.
`,
  meta_ads: `---
provider: meta_ads
policy_mode: mixed
account_ids: []
default_account_id: ""
timezone: ""
attribution_notes: ""
strict_account_scope: false
notes: ""
---

# Meta Ads Connector Rules

## Scope

- List the approved Meta ad accounts agents may inspect.
- Mark the default account for routine performance reviews.

## Guidance

- Document attribution windows, timezone expectations, and account naming conventions.
- Note any accounts or campaigns agents must avoid or treat as sensitive.
`,
  tiktok_ads: `---
provider: tiktok_ads
policy_mode: mixed
advertiser_ids: []
default_advertiser_id: ""
timezone: ""
attribution_notes: ""
strict_account_scope: false
notes: ""
---

# TikTok Ads Connector Rules

## Scope

- List the approved TikTok advertisers agents may inspect.
- Mark the default advertiser for routine performance reviews.

## Guidance

- Document timezone, attribution, and naming expectations for campaign reporting.
- Note any advertisers or campaigns agents must avoid or treat as sensitive.
`,
  linkedin_ads: `---
provider: linkedin_ads
policy_mode: mixed
account_ids: []
campaign_ids: []
default_account_id: ""
timezone: ""
attribution_notes: ""
strict_account_scope: false
notes: ""
---

# LinkedIn Ads Connector Rules

## Scope

- List the approved LinkedIn ad accounts agents may inspect.
- Optionally list approved campaign ids when one account contains sensitive campaigns.
- Mark the default account for routine performance reviews.

## Guidance

- Document timezone, attribution, and reporting caveats for LinkedIn Ads analytics.
- Note any campaigns, business units, or lead-gen surfaces agents must avoid or treat as sensitive.
`,
  ga4: `---
provider: ga4
policy_mode: mixed
property_ids: []
default_property_id: ""
timezone: ""
report_notes: ""
strict_property_scope: false
notes: ""
---

# GA4 Connector Rules

## Scope

- List the approved GA4 properties agents may inspect.
- Mark the default property for routine reporting.

## Guidance

- Document reporting timezone, attribution, and metric caveats.
- Note any properties or reports that should be treated as canonical.
`,
  google_search_console: `---
provider: google_search_console
policy_mode: mixed
site_urls: []
default_site_url: ""
search_type_notes: ""
strict_site_scope: false
notes: ""
---

# Google Search Console Connector Rules

## Scope

- List the approved verified sites agents may inspect.
- Mark the default site for routine search analytics reviews.

## Guidance

- Document search type expectations, device filters, and reporting caveats.
- Note any properties or site variants agents must avoid.
`,
  hubspot: `---
provider: hubspot
policy_mode: advisory
portal_ids: []
allowed_pipeline_ids: []
default_pipeline_ids: []
crm_notes: ""
strict_deal_scope: false
notes: ""
---

# HubSpot Connector Rules

## Scope

- Document the canonical HubSpot portal and any deal pipelines agents may use.
- Note whether contacts, companies, or deals should be treated as the main source of truth.

## Guidance

- Explain lifecycle stages, pipeline semantics, and naming conventions.
- Note any sensitive pipelines, lifecycle states, or CRM caveats agents must respect.
`,
  github: `---
provider: github
policy_mode: mixed
allowed_orgs: []
allowed_repos: []
default_repos: []
blocked_repos: []
prod_sensitive_repos: []
write_policy: approval
strict_repo_scope: false
notes: ""
---

# GitHub Connector Rules

## Scope

- List the organizations and repositories agents may inspect.
- Identify blocked or production-sensitive repositories.

## Guidance

- Explain which repositories are canonical for product or platform work.
- Note any branch or deployment sensitivity the agent should respect.
`,
  vercel: `---
provider: vercel
policy_mode: mixed
allowed_teams: []
allowed_projects: []
production_projects: []
preview_allowed: true
log_access_policy: restricted
strict_project_scope: false
notes: ""
---

# Vercel Connector Rules

## Scope

- List the allowed Vercel teams and projects.
- Mark which projects are production-critical.

## Guidance

- Explain when preview deployments are acceptable.
- Explain how logs and deployment actions should be handled.
`,
  posthog: `---
provider: posthog
policy_mode: mixed
project_ids: []
default_project_id: ""
canonical_dashboard_ids: []
timezone: ""
metric_naming_notes: ""
strict_project_scope: false
notes: ""
---

# PostHog Connector Rules

## Scope

- List the PostHog projects agents may use.
- Mark the default project and canonical dashboards.

## Guidance

- Document timezone and attribution assumptions.
- Explain any event-name conventions or metrics caveats.
`,
  linear: `---
provider: linear
policy_mode: mixed
allowed_team_ids: []
allowed_project_ids: []
default_team_ids: []
default_project_ids: []
issue_status_notes: ""
strict_scope: false
notes: ""
---

# Linear Connector Rules

## Scope

- List the Linear teams and projects agents may inspect.
- Identify the default team or project for roadmap and issue work.

## Guidance

- Explain how the company uses issue states, priorities, and cycles.
- Note any projects or teams agents must avoid or treat as read-only.
`,
  notion: `---
provider: notion
policy_mode: mixed
workspace_ids: []
allowed_page_ids: []
allowed_data_source_ids: []
default_page_ids: []
default_data_source_ids: []
strict_content_scope: false
notes: ""
---

# Notion Connector Rules

## Scope

- List the approved Notion workspaces, pages, and data sources agents may use.
- Mark the default pages or data sources that act as the source of truth.

## Guidance

- Explain naming conventions, archive policy, and where agents should search first.
- Note any private spaces, executive pages, or sensitive data sources agents must avoid.
`,
  google_drive: `---
provider: google_drive
policy_mode: strict
connection_ids: []
root_paths: []
allowed_folder_ids: []
blocked_folder_ids: []
default_folder_ids: []
import_requires_approval: false
strict_root_scope: true
notes: ""
---

# Google Drive Connector Rules

## Scope

- List the approved Drive connections and roots.
- Explain any blocked folders or import restrictions.

## Guidance

- Describe naming conventions and where agents should search first.
- Explain whether imports require approval for certain folders.
`,
  custom_http: `---
provider: custom_http
policy_mode: strict
allowed_connection_ids: []
allowed_action_names: []
strict_connection_scope: true
notes: ""
---

# Custom HTTP Connector Rules

## Scope

- List the specific custom HTTP connections agents may use.
- List the action names that are approved for routine access.

## Guidance

- Custom HTTP access should stay read-only and connection-specific.
- Explain which internal APIs are canonical and which ones agents must avoid.
`,
  custom_openapi: `---
provider: custom_openapi
policy_mode: strict
allowed_connection_ids: []
allowed_action_names: []
strict_connection_scope: true
notes: ""
---

# Custom OpenAPI Connector Rules

## Scope

- List the specific OpenAPI-backed connections agents may use.
- List the imported action names that are approved for routine access.

## Guidance

- Explain which imported operations are canonical for the company.
- Note any specs, environments, or generated actions agents must avoid.
`,
  custom_mcp: `---
provider: custom_mcp
policy_mode: strict
allowed_connection_ids: []
allowed_tool_names: []
strict_connection_scope: true
notes: ""
---

# Custom MCP Connector Rules

## Scope

- List the specific custom MCP connections agents may use.
- List the allowlisted MCP tool names that are safe for routine read access.

## Guidance

- Explain which MCP server is canonical for the company.
- Note any tools that require human approval or must stay completely blocked.
- Document the source system's date, currency, pagination, and partial-result semantics.
- Keep accounting evidence separate from operational metrics and never present a partial dataset as a complete total.
`,
};

export function getConnectorRuleTemplate(provider: ConnectorRuleTemplateProvider) {
  const template = CONNECTOR_RULE_TEMPLATES[provider];
  if (!template) {
    throw new Error(`No connector rule template for provider: ${provider}`);
  }
  return template;
}

export function getDefaultConnectorRuleTemplate(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (
    (CONNECTOR_RULE_TEMPLATE_PROVIDERS as readonly string[]).includes(normalized)
  ) {
    return getConnectorRuleTemplate(normalized as ConnectorRuleTemplateProvider);
  }

  return `---
provider: ${normalized}
policy_mode: advisory
notes: ""
---

# ${normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())} Connector Rules

## Scope

- Describe what this connector may access for the company.
- List any accounts, projects, channels, folders, or environments that matter.

## Guidance

- Explain where the agent should look first.
- Document approval requirements or other operational constraints.
`;
}

function count(values: readonly unknown[] | undefined): number {
  return Array.isArray(values) ? values.length : 0;
}

function summarizeRestrictionCounts(
  frontmatter: ConnectorRuleFrontmatter,
): Record<string, number | boolean | string | null> {
  switch (frontmatter.provider) {
    case "slack": {
      const slack = frontmatter as SlackConnectorRuleFrontmatter;
      return {
        workspaceCount: count(slack.workspace_ids),
        allowedChannelCount: count(slack.allowed_channel_ids),
        blockedChannelCount: count(slack.blocked_channel_ids),
        defaultChannelCount: count(slack.default_channel_ids),
        allowPosting: slack.allow_posting ?? false,
        postingRequiresApproval: slack.posting_requires_approval ?? false,
      };
    }
    case "google_ads": {
      const googleAds = frontmatter as GoogleAdsConnectorRuleFrontmatter;
      return {
        accountCount: count(googleAds.account_ids),
        defaultAccountId: googleAds.default_account_id ?? null,
        timezone: googleAds.timezone ?? null,
        attributionNotes: googleAds.attribution_notes ?? null,
      };
    }
    case "meta_ads": {
      const metaAds = frontmatter as MetaAdsConnectorRuleFrontmatter;
      return {
        accountCount: count(metaAds.account_ids),
        defaultAccountId: metaAds.default_account_id ?? null,
        timezone: metaAds.timezone ?? null,
        attributionNotes: metaAds.attribution_notes ?? null,
      };
    }
    case "tiktok_ads": {
      const tiktokAds = frontmatter as TiktokAdsConnectorRuleFrontmatter;
      return {
        advertiserCount: count(tiktokAds.advertiser_ids),
        defaultAdvertiserId: tiktokAds.default_advertiser_id ?? null,
        timezone: tiktokAds.timezone ?? null,
        attributionNotes: tiktokAds.attribution_notes ?? null,
      };
    }
    case "linkedin_ads": {
      const linkedinAds = frontmatter as LinkedinAdsConnectorRuleFrontmatter;
      return {
        accountCount: count(linkedinAds.account_ids),
        campaignCount: count(linkedinAds.campaign_ids),
        defaultAccountId: linkedinAds.default_account_id ?? null,
        timezone: linkedinAds.timezone ?? null,
        attributionNotes: linkedinAds.attribution_notes ?? null,
      };
    }
    case "ga4": {
      const ga4 = frontmatter as Ga4ConnectorRuleFrontmatter;
      return {
        propertyCount: count(ga4.property_ids),
        defaultPropertyId: ga4.default_property_id ?? null,
        timezone: ga4.timezone ?? null,
        reportNotes: ga4.report_notes ?? null,
      };
    }
    case "google_search_console": {
      const gsc = frontmatter as GoogleSearchConsoleConnectorRuleFrontmatter;
      return {
        siteCount: count(gsc.site_urls),
        defaultSiteUrl: gsc.default_site_url ?? null,
        searchTypeNotes: gsc.search_type_notes ?? null,
      };
    }
    case "hubspot": {
      const hubspot = frontmatter as HubspotConnectorRuleFrontmatter;
      return {
        portalCount: count(hubspot.portal_ids),
        allowedPipelineCount: count(hubspot.allowed_pipeline_ids),
        defaultPipelineCount: count(hubspot.default_pipeline_ids),
        crmNotes: hubspot.crm_notes ?? null,
      };
    }
    case "github": {
      const github = frontmatter as GithubConnectorRuleFrontmatter;
      return {
        allowedOrgCount: count(github.allowed_orgs),
        allowedRepoCount: count(github.allowed_repos),
        blockedRepoCount: count(github.blocked_repos),
        defaultRepoCount: count(github.default_repos),
        prodSensitiveRepoCount: count(github.prod_sensitive_repos),
        writePolicy: github.write_policy ?? null,
      };
    }
    case "vercel": {
      const vercel = frontmatter as VercelConnectorRuleFrontmatter;
      return {
        allowedTeamCount: count(vercel.allowed_teams),
        allowedProjectCount: count(vercel.allowed_projects),
        productionProjectCount: count(vercel.production_projects),
        previewAllowed: vercel.preview_allowed ?? true,
        logAccessPolicy: vercel.log_access_policy ?? null,
      };
    }
    case "posthog": {
      const posthog = frontmatter as PosthogConnectorRuleFrontmatter;
      return {
        projectCount: count(posthog.project_ids),
        canonicalDashboardCount: count(posthog.canonical_dashboard_ids),
        defaultProjectId: posthog.default_project_id ?? null,
        timezone: posthog.timezone ?? null,
      };
    }
    case "linear": {
      const linear = frontmatter as LinearConnectorRuleFrontmatter;
      return {
        allowedTeamCount: count(linear.allowed_team_ids),
        allowedProjectCount: count(linear.allowed_project_ids),
        defaultTeamCount: count(linear.default_team_ids),
        defaultProjectCount: count(linear.default_project_ids),
        issueStatusNotes: linear.issue_status_notes ?? null,
      };
    }
    case "notion": {
      const notion = frontmatter as NotionConnectorRuleFrontmatter;
      return {
        workspaceCount: count(notion.workspace_ids),
        allowedPageCount: count(notion.allowed_page_ids),
        allowedDataSourceCount: count(notion.allowed_data_source_ids),
        defaultPageCount: count(notion.default_page_ids),
        defaultDataSourceCount: count(notion.default_data_source_ids),
      };
    }
    case "google_drive": {
      const drive = frontmatter as GoogleDriveConnectorRuleFrontmatter;
      return {
        connectionCount: count(drive.connection_ids),
        rootPathCount: count(drive.root_paths),
        allowedFolderCount: count(drive.allowed_folder_ids),
        blockedFolderCount: count(drive.blocked_folder_ids),
        defaultFolderCount: count(drive.default_folder_ids),
        importRequiresApproval: drive.import_requires_approval ?? false,
      };
    }
    case "custom_http": {
      const customHttp = frontmatter as CustomHttpConnectorRuleFrontmatter;
      return {
        connectionCount: count(customHttp.allowed_connection_ids),
        allowedActionCount: count(customHttp.allowed_action_names),
      };
    }
    case "custom_openapi": {
      const customOpenApi = frontmatter as CustomOpenApiConnectorRuleFrontmatter;
      return {
        connectionCount: count(customOpenApi.allowed_connection_ids),
        allowedActionCount: count(customOpenApi.allowed_action_names),
      };
    }
    case "custom_mcp": {
      const customMcp = frontmatter as CustomMcpConnectorRuleFrontmatter;
      return {
        connectionCount: count(customMcp.allowed_connection_ids),
        allowedToolCount: count(customMcp.allowed_tool_names),
      };
    }
    default:
      return {};
  }
}

function detectStrictMode(frontmatter: ConnectorRuleFrontmatter): boolean {
  if (frontmatter.policy_mode === "strict") return true;
  switch (frontmatter.provider) {
    case "slack":
      return (frontmatter as SlackConnectorRuleFrontmatter).strict_channel_scope === true;
    case "google_ads":
      return (frontmatter as GoogleAdsConnectorRuleFrontmatter).strict_account_scope === true;
    case "meta_ads":
      return (frontmatter as MetaAdsConnectorRuleFrontmatter).strict_account_scope === true;
    case "tiktok_ads":
      return (frontmatter as TiktokAdsConnectorRuleFrontmatter).strict_account_scope === true;
    case "linkedin_ads":
      return (frontmatter as LinkedinAdsConnectorRuleFrontmatter).strict_account_scope === true;
    case "ga4":
      return (frontmatter as Ga4ConnectorRuleFrontmatter).strict_property_scope === true;
    case "google_search_console":
      return (
        frontmatter as GoogleSearchConsoleConnectorRuleFrontmatter
      ).strict_site_scope === true;
    case "hubspot":
      return (frontmatter as HubspotConnectorRuleFrontmatter).strict_deal_scope === true;
    case "github":
      return (frontmatter as GithubConnectorRuleFrontmatter).strict_repo_scope === true;
    case "vercel":
      return (frontmatter as VercelConnectorRuleFrontmatter).strict_project_scope === true;
    case "posthog":
      return (frontmatter as PosthogConnectorRuleFrontmatter).strict_project_scope === true;
    case "linear":
      return (frontmatter as LinearConnectorRuleFrontmatter).strict_scope === true;
    case "notion":
      return (frontmatter as NotionConnectorRuleFrontmatter).strict_content_scope === true;
    case "google_drive":
      return (frontmatter as GoogleDriveConnectorRuleFrontmatter).strict_root_scope === true;
    case "custom_http":
      return (
        frontmatter as CustomHttpConnectorRuleFrontmatter
      ).strict_connection_scope === true;
    case "custom_openapi":
      return (
        frontmatter as CustomOpenApiConnectorRuleFrontmatter
      ).strict_connection_scope === true;
    case "custom_mcp":
      return (
        frontmatter as CustomMcpConnectorRuleFrontmatter
      ).strict_connection_scope === true;
    default:
      return false;
  }
}

export function buildConnectorRuleSummary(
  provider: string,
  frontmatter: ConnectorRuleFrontmatter,
  path: string,
): ConnectorRuleSummary {
  return {
    path,
    exists: true,
    provider,
    policyMode: frontmatter.policy_mode ?? "advisory",
    strict: detectStrictMode(frontmatter),
    notes: typeof frontmatter.notes === "string" ? frontmatter.notes : null,
    restrictionSummary: summarizeRestrictionCounts(frontmatter),
  };
}

export function parseConnectorRuleFile(
  provider: string,
  raw: string,
  path = getConnectorRuleFilePath(provider),
): ParsedConnectorRuleDocument {
  const parsed = parseQmd(raw);
  const schema = getConnectorRuleFrontmatterSchema(provider);
  const result = schema.safeParse(parsed.frontmatter);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "frontmatter"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid connector rule file ${path}: ${issues}`);
  }

  return {
    path,
    raw,
    body: parsed.body,
    frontmatter: result.data,
    summary: buildConnectorRuleSummary(provider, result.data, path),
  };
}
