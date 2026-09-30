export interface ProviderSetupInfo {
  instructions: string[];
  docsUrl: string;
  docsLabel: string;
}

export const PROVIDER_SETUP_INFO_BY_SLUG: Record<string, ProviderSetupInfo> = {
  stripe: {
    instructions: [
      "Log in to your Stripe Dashboard",
      "Go to Developers → API keys",
      "Copy your Secret key (starts with sk_live_) or create a Restricted key with read permissions",
    ],
    docsUrl: "https://docs.stripe.com/keys",
    docsLabel: "Stripe API Keys docs",
  },
  mercury: {
    instructions: [
      "Log in to your Mercury account",
      "Go to Settings → Developer",
      "Create a new API token with read access",
    ],
    docsUrl: "https://docs.mercury.com/reference/getting-started",
    docsLabel: "Mercury API docs",
  },
  odoo: {
    instructions: [
      "Go to your ODOO Portal (e.g. https://your-host/odoo-instance)",
      "Log in with your Odoo credentials",
      "Copy the API Token from your Dashboard",
      "Paste the Portal URL and Token below",
    ],
    docsUrl: "https://github.com/undergnarly/odoo-portal",
    docsLabel: "ODOO Portal docs",
  },
  google_ads: {
    instructions: [
      "Connect Google Ads with OAuth using a Google user that can access the required ad accounts",
      "Make sure Corpus runtime has a valid Google Ads developer token configured",
      "After connecting, use connector rules to narrow access to approved customer accounts",
      "If one Google Ads account should be canonical, capture it in connector rules as the default account",
    ],
    docsUrl: "https://developers.google.com/google-ads/api/docs/oauth/overview",
    docsLabel: "Google Ads OAuth docs",
  },
  meta_ads: {
    instructions: [
      "Connect Meta Ads with OAuth using a user that can read the required Facebook ad accounts",
      "Grant the app read access to advertising data during the OAuth flow",
      "After connecting, use connector rules to narrow access to approved ad accounts",
      "If one Meta account should be canonical, capture it in connector rules as the default account",
    ],
    docsUrl: "https://developers.facebook.com/docs/marketing-api/get-started",
    docsLabel: "Meta Marketing API docs",
  },
  tiktok_ads: {
    instructions: [
      "Create or copy a TikTok Ads access token with read access to the advertiser you want agents to inspect",
      "Copy the advertiser ID for the connected account",
      "Paste the token and advertiser ID below",
      "Use connector rules to narrow access to approved advertisers and capture any attribution or timezone notes",
    ],
    docsUrl: "https://business-api.tiktok.com/portal/docs?id=1738373164382209",
    docsLabel: "TikTok Ads API docs",
  },
  linkedin_ads: {
    instructions: [
      "Create or reuse a LinkedIn developer application with access to the Marketing Developer Platform and Campaign Manager data you need",
      "Generate or copy a valid OAuth access token for the LinkedIn member who can read the target ad accounts",
      "Paste the access token below and optionally add a default ad account id plus API version override",
      "Use connector rules to narrow access to approved LinkedIn ad accounts and document attribution or timezone notes",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting",
    docsLabel: "LinkedIn Ads reporting docs",
  },
  ga4: {
    instructions: [
      "Connect Google Analytics 4 with OAuth using a Google user that can access the required GA4 properties",
      "Grant read access to Analytics during the OAuth flow",
      "After connecting, use connector rules to narrow access to approved property ids and set a default property",
      "Capture timezone or attribution notes in connector rules when one property should be treated as canonical",
    ],
    docsUrl: "https://developers.google.com/analytics/devguides/reporting/data/v1",
    docsLabel: "GA4 Data API docs",
  },
  google_search_console: {
    instructions: [
      "Connect Google Search Console with OAuth using a Google user that can access the required verified sites",
      "Grant read access to Search Console during the OAuth flow",
      "After connecting, use connector rules to narrow access to approved site URLs and set a default site",
      "Capture any search-type or reporting notes in connector rules if one property should be canonical",
    ],
    docsUrl: "https://developers.google.com/webmaster-tools/v1/quickstart/quickstart-js",
    docsLabel: "Google Search Console API docs",
  },
  hubspot: {
    instructions: [
      "Create or reuse a HubSpot private app with read access to CRM objects you want agents to inspect",
      "Copy the private app access token",
      "Paste the token below and optionally add a custom API base URL for a regional or proxied deployment",
      "Use connector rules to document canonical portal and deal-pipeline context for the company",
    ],
    docsUrl: "https://developers.hubspot.com/docs/api/private-apps",
    docsLabel: "HubSpot private app docs",
  },
  github: {
    instructions: [
      "Open GitHub Developer Settings for the account or bot that should back the connector",
      "Create a classic or fine-grained personal access token with read access to the repositories you want agents to inspect",
      "Paste the token below and optionally add a GitHub Enterprise API base URL",
      "Use connector rules to narrow access to approved organizations or repositories",
    ],
    docsUrl: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens",
    docsLabel: "GitHub personal access token docs",
  },
  vercel: {
    instructions: [
      "Open Vercel account settings and create a personal access token with read access to the teams and projects you want agents to inspect",
      "Paste the token below",
      "Optionally add a default team ID or slug if the connector should stay scoped to one Vercel team by default",
      "Use connector rules to narrow access to approved teams, projects, preview environments, and logs",
    ],
    docsUrl: "https://vercel.com/docs/rest-api#using-the-rest-api/authentication",
    docsLabel: "Vercel REST API auth docs",
  },
  linear: {
    instructions: [
      "Open Linear settings and create a personal API key for the workspace the agent should inspect",
      "Paste the API key below",
      "Use connector rules to narrow access to approved teams and projects",
      "Capture team/project defaults in the connector rules if one workspace should be treated as canonical",
    ],
    docsUrl: "https://linear.app/developers/graphql",
    docsLabel: "Linear GraphQL API docs",
  },
  notion: {
    instructions: [
      "Create or reuse a Notion internal integration and copy its integration token",
      "Share the target pages or data sources with that integration inside Notion",
      "Paste the token below",
      "Use connector rules to narrow access to approved pages and data sources",
    ],
    docsUrl: "https://developers.notion.com/reference/intro",
    docsLabel: "Notion API docs",
  },
  slack: {
    instructions: [
      "Open your Slack workspace app settings",
      "Install or reinstall the app into the target workspace",
      "Copy the Bot User OAuth Token from OAuth & Permissions",
      "Paste the bot token below (usually starts with xoxb-)",
    ],
    docsUrl: "https://api.slack.com/authentication/oauth-v2",
    docsLabel: "Slack OAuth and token docs",
  },
  jira: {
    instructions: [
      "Open your Atlassian account security settings",
      "Create an API token for the user account that should access Jira",
      "Copy your Jira site URL (for example https://example.atlassian.net)",
      "Paste the site URL, account email, and API token below",
    ],
    docsUrl: "https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/",
    docsLabel: "Atlassian API token docs",
  },
  bamboohr: {
    instructions: [
      "Open BambooHR API key management for the target account",
      "Create or copy an API key with read access to the employee data you need",
      "Use your BambooHR subdomain without the full URL",
      "Paste the subdomain and API key below",
    ],
    docsUrl: "https://documentation.bamboohr.com/docs/getting-started",
    docsLabel: "BambooHR API docs",
  },
  confluence: {
    instructions: [
      "Open your Atlassian account security settings and create an API token",
      "Copy your Confluence site URL without a page path, for example https://example.atlassian.net",
      "Use the email address for the Atlassian account that should access Confluence",
      "Paste the site URL, account email, and API token below",
    ],
    docsUrl: "https://developer.atlassian.com/cloud/confluence/basic-auth-for-rest-apis/",
    docsLabel: "Confluence basic auth docs",
  },
  ms_graph: {
    instructions: [
      "Create or reuse an Entra app registration for server-to-server access",
      "Grant Microsoft Graph application permissions and admin-consent them",
      "Copy the tenant ID, client ID, and client secret",
      "Paste those values below",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/graph/auth/",
    docsLabel: "Microsoft Graph auth docs",
  },
  dynamics_bc: {
    instructions: [
      "Create or reuse an Entra app registration that can access Business Central APIs",
      "Grant Business Central application access and note the environment name",
      "Copy the tenant ID, client ID, and client secret",
      "Optionally set a default company ID if the agent should target one company by default",
    ],
    docsUrl: "https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/",
    docsLabel: "Business Central API docs",
  },
  payhawk: {
    instructions: [
      "Create an API key in Payhawk for read-only server access",
      "Paste the API key below and add the target Payhawk account ID when you have it",
      "Leave Base URL empty unless Payhawk gave you a custom API hostname",
      "Use documented endpoint paths when calling the connector from agents",
    ],
    docsUrl: "https://developers.payhawk.com/",
    docsLabel: "Payhawk developer docs",
  },
  zendesk: {
    instructions: [
      "Enable API token access in Zendesk admin settings",
      "Create an API token for the account the agent should use",
      "Copy the Zendesk subdomain and account email",
      "Paste the subdomain, email, and API token below",
    ],
    docsUrl: "https://developer.zendesk.com/api-reference/introduction/security-and-auth/",
    docsLabel: "Zendesk auth docs",
  },
  linkedin_mcp: {
    instructions: [
      "Deploy or identify the remote MCP server that fronts LinkedIn functionality",
      "Copy the MCP endpoint URL",
      "Paste a bearer token only if that MCP server requires it",
      "After connecting, agents can discover tools and call them through the bridge",
    ],
    docsUrl: "https://modelcontextprotocol.io/",
    docsLabel: "MCP overview",
  },
  custom_http: {
    instructions: [
      "Choose the company API base URL and a narrow set of read-only endpoints to expose",
      "Define allowlisted path prefixes plus explicit action definitions as JSON",
      "Set auth mode to none, bearer, header, or query and provide the matching token fields",
      "Optionally add a probe path if Corpus should verify the API by making a live request during setup",
    ],
    docsUrl: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods",
    docsLabel: "HTTP methods reference",
  },
  custom_openapi: {
    instructions: [
      "Provide a JSON OpenAPI spec URL that Corpus can fetch from the server runtime",
      "List the allowed read-only operationIds that should become exposed actions",
      "Optionally override the base URL if the spec server differs from the live API host",
      "Use the same auth mode fields you would use for custom HTTP if the imported operations require authentication",
    ],
    docsUrl: "https://spec.openapis.org/oas/latest.html",
    docsLabel: "OpenAPI specification",
  },
  custom_mcp: {
    instructions: [
      "Provide the remote MCP endpoint URL for the company-specific server",
      "Define an explicit JSON allowlist of tools with read or write classification before connecting",
      "Only tools classified as read and allow=true are available through bearer-safe connector access",
      "Optionally provide a bearer token if the remote MCP server requires it",
    ],
    docsUrl: "https://modelcontextprotocol.io/",
    docsLabel: "MCP overview",
  },
  metabase: {
    instructions: [
      "Open Metabase admin settings and create an API key for the account or group that should back the connector",
      "Copy the Metabase base URL, for example https://metabase.example.com or your reverse-proxy URL",
      "Paste the base URL and API key below",
      "If Metabase sits behind mTLS or a client-certificate gateway, Corpus runtime also needs that network access before validation will succeed",
      "For mTLS deployments, place the client cert and key on the Corpus server and set METABASE_CERT_PATH plus METABASE_KEY_PATH in runtime env",
    ],
    docsUrl: "https://www.metabase.com/docs/latest/people-and-groups/api-keys",
    docsLabel: "Metabase API key docs",
  },
  posthog: {
    instructions: [
      "Open your PostHog instance and create a personal API key with read access to organizations, projects, dashboards, insights, feature flags, and query APIs",
      "Copy the PostHog app base URL for your region or self-hosted deployment, for example https://us.posthog.com or https://eu.posthog.com",
      "Paste the base URL and API key below",
      "If the company should default to one PostHog organization, project, or environment, capture that in connector rules or optional setup metadata after connect",
    ],
    docsUrl: "https://posthog.com/docs/api",
    docsLabel: "PostHog API docs",
  },
  email_ingest: {
    instructions: [
      "Open the connector to reveal your private ingest address",
      "Forward documents or threaded emails with attachments to that address",
      "Only supported attachments will be queued into the document pipeline",
      "Regenerate the address if it leaks or you want to rotate it",
    ],
    docsUrl: "https://docs.sendgrid.com/for-developers/parsing-email/inbound-email",
    docsLabel: "Inbound email parsing reference",
  },
  telegram: {
    instructions: [
      "Open the connector and enter the phone number for the Telegram account you want to ingest",
      "Approve the login code in Telegram, and enter your 2FA password if the account requires it",
      "After authentication, select the chats that should flow into communications synthesis",
      "Use Manage later to change selected chats or trigger a manual sync",
    ],
    docsUrl: "https://core.telegram.org/api",
    docsLabel: "Telegram API reference",
  },
};

export function getProviderSetupInfo(providerSlug?: string | null) {
  if (!providerSlug) return null;
  return PROVIDER_SETUP_INFO_BY_SLUG[providerSlug] ?? null;
}
