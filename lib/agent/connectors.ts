import { and, desc, eq } from "drizzle-orm";

import {
  executeBambooHrAction,
} from "@/lib/connectors/bamboohr";
import {
  executeConfluenceAction,
} from "@/lib/connectors/confluence";
import {
  executeCustomHttpAction,
} from "@/lib/connectors/custom-http";
import {
  executeCustomMcpAction,
} from "@/lib/connectors/custom-mcp";
import {
  executeCustomOpenApiAction,
} from "@/lib/connectors/custom-openapi";
import {
  executeDynamicsBcAction,
} from "@/lib/connectors/dynamics-bc";
import {
  executeGa4Action,
} from "@/lib/connectors/ga4";
import {
  executeGoogleAdsAction,
} from "@/lib/connectors/google-ads";
import {
  executeGoogleSearchConsoleAction,
} from "@/lib/connectors/google-search-console";
import {
  executeGithubAction,
} from "@/lib/connectors/github";
import {
  executeHubspotAction,
} from "@/lib/connectors/hubspot";
import {
  executeLinkedinAdsAction,
} from "@/lib/connectors/linkedin-ads";
import {
  executeVercelAction,
} from "@/lib/connectors/vercel";
import {
  executeConnectorHubAction,
  getConnectorHubCatalog,
} from "@/lib/connectors/hub";
import { ConnectorHubError } from "@/lib/connectors/hub-errors";
import {
  executeLinkedInMcpAction,
} from "@/lib/connectors/linkedin-mcp";
import {
  executeLinearAction,
} from "@/lib/connectors/linear";
import {
  executeMetaAdsAction,
} from "@/lib/connectors/meta-ads";
import {
  executeMetabaseAction,
} from "@/lib/connectors/metabase";
import {
  executeMsGraphAction,
} from "@/lib/connectors/ms-graph";
import {
  executeNotionAction,
} from "@/lib/connectors/notion";
import {
  executePayhawkAction,
} from "@/lib/connectors/payhawk";
import {
  executePosthogAction,
} from "@/lib/connectors/posthog";
import {
  executeTiktokAdsAction,
} from "@/lib/connectors/tiktok-ads";
import {
  coerceGoogleDriveConnectionMetadata,
  downloadDriveFile,
  getDriveItemMetadata,
  getGoogleDriveRootSelection,
  isDriveItemWithinRoot,
  listDriveFiles,
  listDriveFolder,
  listFolderFilesRecursive,
  listDriveRoot,
  listSharedWithMe,
} from "@/lib/connectors/google-drive";
import {
  getGoogleDriveAccessTokenForConnection,
  resolveGoogleDriveConnection,
} from "@/lib/connectors/google-drive-auth";
import {
  queueGoogleDriveImportSelection,
  type GoogleDriveImportFileRequest,
  type GoogleDriveImportFolderSelection,
} from "@/lib/connectors/google-drive-import";
import { genericSearch, fetchRecordById } from "@/lib/connectors/odoo";
import { withOdooClient } from "@/lib/connectors/odoo-mcp-client";
import {
  coerceTelegramConnectionMetadata,
  createTelegramClient,
  getTelegramErrorMessage,
  listTelegramDialogs,
} from "@/lib/connectors/telegram";
import {
  executeZendeskAction,
} from "@/lib/connectors/zendesk";
import {
  getConnectionCredentials,
  getLatestConnectionCredentialsByProvider,
  listConnections,
} from "@/lib/connections";
import {
  filterConnectorProvidersByScopes,
  getConnectorCapabilities,
  getConnectorProviderDefinition,
} from "@/lib/connectors/provider-registry";
import {
  type CustomHttpConnectorRuleFrontmatter,
  type CustomMcpConnectorRuleFrontmatter,
  type CustomOpenApiConnectorRuleFrontmatter,
  type GithubConnectorRuleFrontmatter,
  type Ga4ConnectorRuleFrontmatter,
  getConnectorRuleFilePath,
  type GoogleAdsConnectorRuleFrontmatter,
  type GoogleSearchConsoleConnectorRuleFrontmatter,
  type LinkedinAdsConnectorRuleFrontmatter,
  type LinearConnectorRuleFrontmatter,
  parseConnectorRuleFile,
  type GoogleDriveConnectorRuleFrontmatter,
  type HubspotConnectorRuleFrontmatter,
  type MetaAdsConnectorRuleFrontmatter,
  type NotionConnectorRuleFrontmatter,
  type ConnectorRuleSummary,
  type ParsedConnectorRuleDocument,
  type PosthogConnectorRuleFrontmatter,
  type SlackConnectorRuleFrontmatter,
  type TiktokAdsConnectorRuleFrontmatter,
  type VercelConnectorRuleFrontmatter,
} from "@/lib/connectors/rules";
import { readQmdFile } from "@/lib/company-db/client";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { db } from "@/lib/db";
import { communicationMessages, companies } from "@/lib/db/schema";

type LocalConnectorActionDefinition = {
  name: string;
  description: string;
  aliases?: readonly string[];
  chatReadOnly?: boolean;
};

type LocalConnectorDefinition = {
  provider: string;
  actions: readonly LocalConnectorActionDefinition[];
  includeInChatReadSurface?: boolean;
};

const LOCAL_CONNECTOR_DEFINITIONS: readonly LocalConnectorDefinition[] = [
  {
    provider: "google_ads",
    actions: [
      {
        name: "list_accessible_customers",
        description: "List accessible Google Ads customers for the connected account.",
        aliases: ["list_customers"],
      },
      {
        name: "get_customer",
        description: "Fetch one Google Ads customer summary by customer id.",
        aliases: ["get_account", "get_customer_summary"],
      },
      {
        name: "list_campaigns",
        description: "List Google Ads campaigns for one customer.",
      },
      {
        name: "get_campaign",
        description: "Fetch one Google Ads campaign by id within one customer.",
      },
      {
        name: "list_campaign_metrics",
        description: "List Google Ads campaign metrics over a bounded date range.",
        aliases: ["list_metrics"],
      },
    ],
  },
  {
    provider: "linkedin_ads",
    actions: [
      {
        name: "list_accounts",
        description: "List accessible LinkedIn Ads accounts for the connected token.",
        aliases: ["get_accounts", "list_ad_accounts"],
      },
      {
        name: "get_account",
        description: "Fetch one LinkedIn Ads account summary by account id.",
        aliases: ["get_ad_account"],
      },
      {
        name: "list_campaigns",
        description: "List LinkedIn Ads campaigns for one account.",
      },
      {
        name: "get_campaign",
        description: "Fetch one LinkedIn Ads campaign by id.",
      },
      {
        name: "query_analytics",
        description: "Read bounded LinkedIn Ads analytics for one account or campaign.",
        aliases: ["get_account_analytics", "get_campaign_analytics", "list_metrics"],
      },
    ],
  },
  {
    provider: "meta_ads",
    actions: [
      {
        name: "list_ad_accounts",
        description: "List accessible Meta Ads ad accounts.",
        aliases: ["list_accounts"],
      },
      {
        name: "list_campaigns",
        description: "List campaigns for one Meta Ads ad account.",
      },
      {
        name: "get_campaign",
        description: "Fetch one Meta Ads campaign by id.",
      },
      {
        name: "get_account_insights",
        description: "Read bounded account-level Meta Ads insights for one ad account.",
        aliases: ["list_insights"],
      },
      {
        name: "get_campaign_insights",
        description: "Read bounded campaign-level Meta Ads insights for one ad account.",
        aliases: ["list_campaign_insights"],
      },
    ],
  },
  {
    provider: "tiktok_ads",
    actions: [
      {
        name: "list_advertisers",
        description: "List accessible TikTok Ads advertisers.",
        aliases: ["list_accounts"],
      },
      {
        name: "list_campaigns",
        description: "List campaigns for one TikTok Ads advertiser.",
      },
      {
        name: "get_campaign",
        description: "Fetch one TikTok Ads campaign by id.",
      },
      {
        name: "get_account_insights",
        description: "Read bounded account-level TikTok Ads insights for one advertiser.",
        aliases: ["list_insights"],
      },
      {
        name: "get_campaign_insights",
        description: "Read bounded campaign-level TikTok Ads insights for one advertiser.",
        aliases: ["list_campaign_insights"],
      },
    ],
  },
  {
    provider: "ga4",
    actions: [
      {
        name: "list_properties",
        description: "List accessible GA4 properties for the connected Google Analytics account.",
        aliases: ["get_properties"],
      },
      {
        name: "get_property",
        description: "Fetch one GA4 property summary by property id.",
        aliases: ["get_property_by_id"],
      },
      {
        name: "run_report",
        description: "Run a bounded GA4 report for one property using selected dimensions and metrics.",
        aliases: ["get_report", "run_query"],
      },
      {
        name: "list_dimensions_metrics",
        description: "List available GA4 dimensions and metrics for one property.",
        aliases: ["list_schema"],
      },
    ],
  },
  {
    provider: "google_search_console",
    actions: [
      {
        name: "list_sites",
        description: "List Search Console sites accessible to the connected Google account.",
        aliases: ["get_properties"],
      },
      {
        name: "get_site",
        description: "Fetch one Search Console site summary by site URL.",
        aliases: ["get_property"],
      },
      {
        name: "query_search_analytics",
        description: "Run a bounded Search Console search analytics query for one site.",
        aliases: ["get_report", "list_search_analytics"],
      },
      {
        name: "list_sitemaps",
        description: "List sitemaps for one Search Console site.",
      },
    ],
  },
  {
    provider: "hubspot",
    actions: [
      {
        name: "list_portals",
        description: "Return the connected HubSpot portal summary.",
        aliases: ["get_portals"],
      },
      {
        name: "list_contacts",
        description: "List HubSpot contacts with bounded pagination.",
        aliases: ["get_contacts"],
      },
      {
        name: "search_contacts",
        description: "Search HubSpot contacts by free-text query.",
      },
      {
        name: "list_companies",
        description: "List HubSpot companies with bounded pagination.",
        aliases: ["get_companies"],
      },
      {
        name: "list_deals",
        description: "List HubSpot deals with bounded pagination.",
        aliases: ["get_deals"],
      },
      {
        name: "get_deal",
        description: "Fetch one HubSpot deal by id.",
      },
    ],
  },
  {
    provider: "custom_http",
    actions: [
      {
        name: "list_actions",
        description: "List explicit read-only actions configured for the selected custom HTTP connector.",
        aliases: ["get_actions"],
      },
      {
        name: "call_action",
        description: "Run one explicit read-only action on the selected custom HTTP connector.",
        aliases: ["invoke", "run_action"],
      },
    ],
  },
  {
    provider: "custom_openapi",
    actions: [
      {
        name: "list_actions",
        description: "List imported read-only actions generated from the selected custom OpenAPI spec.",
        aliases: ["get_actions"],
      },
      {
        name: "call_action",
        description: "Run one imported read-only action on the selected custom OpenAPI connector.",
        aliases: ["invoke", "run_action"],
      },
    ],
  },
  {
    provider: "custom_mcp",
    actions: [
      {
        name: "list_tools",
        description: "List explicit read-only tools allowlisted for the selected custom MCP connector. Requires connectionId.",
        aliases: ["get_tools"],
      },
      {
        name: "call_tool",
        description: "Run one allowlisted read-only tool on the selected custom MCP connector. Requires connectionId and an exact tool name.",
        aliases: ["invoke", "run_tool"],
      },
    ],
  },
  {
    provider: "github",
    actions: [
      {
        name: "list_repos",
        description: "List accessible GitHub repositories with pagination and optional visibility filters.",
        aliases: ["get_repos"],
      },
      {
        name: "get_repo",
        description: "Fetch one GitHub repository by owner/name or full name.",
      },
      {
        name: "list_issues",
        description: "List GitHub issues for one repository.",
      },
      {
        name: "list_pull_requests",
        description: "List GitHub pull requests for one repository.",
        aliases: ["get_pull_requests", "list_prs"],
      },
      {
        name: "list_commits",
        description: "List GitHub commits for one repository.",
      },
      {
        name: "list_workflow_runs",
        description: "List GitHub Actions workflow runs for one repository.",
      },
    ],
  },
  {
    provider: "vercel",
    actions: [
      {
        name: "list_teams",
        description: "List Vercel teams accessible to the connected token.",
      },
      {
        name: "list_projects",
        description: "List Vercel projects, optionally scoped to one team.",
        aliases: ["get_projects"],
      },
      {
        name: "get_project",
        description: "Fetch one Vercel project by ID or project name.",
        aliases: ["get_project_by_id"],
      },
      {
        name: "list_deployments",
        description: "List Vercel deployments, optionally scoped to one project or target environment.",
        aliases: ["get_deployments"],
      },
      {
        name: "get_deployment",
        description: "Fetch one Vercel deployment by ID or deployment URL.",
      },
      {
        name: "get_build_logs",
        description: "Fetch build event logs for one Vercel deployment.",
      },
      {
        name: "get_runtime_logs",
        description: "Fetch runtime logs for one Vercel deployment within a project.",
      },
      {
        name: "list_domains",
        description: "List Vercel domains globally or for one project.",
        aliases: ["get_domains"],
      },
    ],
  },
  {
    provider: "linear",
    actions: [
      {
        name: "list_teams",
        description: "List Linear teams accessible to the connected workspace token.",
      },
      {
        name: "list_projects",
        description: "List Linear projects globally or within one team.",
        aliases: ["get_projects"],
      },
      {
        name: "list_issues",
        description: "List Linear issues globally or within one team or project.",
        aliases: ["get_issues"],
      },
      {
        name: "get_issue",
        description: "Fetch one Linear issue by id.",
      },
      {
        name: "list_issue_comments",
        description: "List comments for one Linear issue.",
        aliases: ["get_comments"],
      },
      {
        name: "list_cycles",
        description: "List Linear cycles globally or within one team.",
        aliases: ["get_cycles"],
      },
      {
        name: "list_users",
        description: "List users in the connected Linear workspace.",
        aliases: ["get_users"],
      },
    ],
  },
  {
    provider: "notion",
    actions: [
      {
        name: "search_content",
        description: "Search Notion pages and data sources within the connected workspace.",
        aliases: ["search"],
      },
      {
        name: "list_pages",
        description: "List pages the connected Notion integration can access.",
      },
      {
        name: "get_page",
        description: "Fetch one Notion page by id.",
      },
      {
        name: "list_data_sources",
        description: "List data sources the connected Notion integration can access.",
        aliases: ["list_databases"],
      },
      {
        name: "get_data_source",
        description: "Fetch one Notion data source by id.",
        aliases: ["get_database"],
      },
      {
        name: "query_data_source",
        description: "Run a bounded query against one Notion data source.",
        aliases: ["query_database"],
      },
    ],
  },
  {
    provider: "posthog",
    actions: [
      {
        name: "list_organizations",
        description: "List PostHog organizations accessible to the connected token.",
      },
      {
        name: "list_projects",
        description: "List PostHog projects inside one organization.",
        aliases: ["get_projects"],
      },
      {
        name: "get_project",
        description: "Fetch one PostHog project by id.",
      },
      {
        name: "list_environments",
        description: "List PostHog environments inside one project.",
      },
      {
        name: "list_dashboards",
        description: "List PostHog dashboards for one environment.",
        aliases: ["get_dashboards"],
      },
      {
        name: "get_dashboard",
        description: "Fetch one PostHog dashboard by id.",
      },
      {
        name: "list_insights",
        description: "List PostHog insights for one environment.",
        aliases: ["get_insights"],
      },
      {
        name: "get_insight",
        description: "Fetch one PostHog insight by id.",
      },
      {
        name: "list_feature_flags",
        description: "List PostHog feature flags for one project.",
        aliases: ["get_flags"],
      },
      {
        name: "get_feature_flag",
        description: "Fetch one PostHog feature flag by id.",
      },
      {
        name: "run_query",
        description: "Run one bounded PostHog analytics query against a project.",
        aliases: ["search"],
      },
    ],
  },
  {
    provider: "telegram",
    actions: [
      {
        name: "list_chats",
        description: "List Telegram chats with pagination and optional filtering.",
      },
      {
        name: "get_recent_messages",
        description: "Read recent synced Telegram messages for a selected chat.",
      },
    ],
  },
  {
    provider: "google_drive",
    actions: [
      {
        name: "list_files",
        description: "Browse root, folders, shared-with-me, or search Google Drive files. Pass a `query` field to search by filename. The model often calls this with the action name `search_files`; that alias resolves here.",
        aliases: ["search_files", "search"],
      },
      {
        name: "get_file_metadata",
        description: "Fetch metadata for one Google Drive file or folder.",
      },
      {
        name: "download_file",
        description: "Download one Google Drive file through the connected account.",
      },
      {
        name: "import_selection",
        description: "Queue selected Google Drive files or folders for document import.",
        chatReadOnly: false,
      },
    ],
  },
  {
    provider: "odoo",
    includeInChatReadSurface: false,
    actions: [
      {
        name: "search_records",
        description: "Search Odoo records by model and domain.",
        chatReadOnly: false,
      },
      {
        name: "get_record",
        description: "Fetch one Odoo record by model and record id.",
        chatReadOnly: false,
      },
    ],
  },
  {
    provider: "bamboohr",
    actions: [
      {
        name: "list_employees",
        description: "Fetch a compact employee report from BambooHR.",
        aliases: ["get_employee_list"],
      },
      {
        name: "get_employee",
        description: "Fetch one BambooHR employee profile by id.",
      },
      {
        name: "list_directory",
        description: "Read the BambooHR employee directory.",
        aliases: ["get_employee_directory", "get_employees"],
      },
      {
        name: "list_departments",
        description: "Summarize BambooHR departments from employee records.",
        aliases: ["get_departments"],
      },
      {
        name: "get_org_structure",
        description: "Read reporting lines and organization structure from BambooHR employee records.",
        aliases: ["get_company_structure"],
      },
      {
        name: "list_whos_out",
        description: "List people currently out or scheduled out in BambooHR.",
        aliases: ["get_whos_out"],
      },
      {
        name: "list_time_off_requests",
        description: "List BambooHR time-off requests with optional date filters.",
        aliases: ["get_time_off", "get_time_off_requests"],
      },
    ],
  },
  {
    provider: "confluence",
    actions: [
      {
        name: "list_spaces",
        description: "List accessible Confluence spaces with optional pagination.",
        aliases: ["get_spaces"],
      },
      {
        name: "list_pages",
        description: "List Confluence pages globally or within one space.",
        aliases: ["get_pages"],
      },
      {
        name: "get_page",
        description: "Fetch one Confluence page by id with body content.",
        aliases: ["get_page_by_id"],
      },
      {
        name: "search_content",
        description: "Search Confluence content using a typed query surface.",
        aliases: ["search_pages"],
      },
    ],
  },
  {
    provider: "ms_graph",
    actions: [
      {
        name: "get_organization",
        description: "Fetch tenant organization metadata from Microsoft Graph.",
      },
      {
        name: "list_users",
        description: "List users from Microsoft Graph with optional filtering.",
        aliases: ["get_users"],
      },
      {
        name: "get_user",
        description: "Fetch one Microsoft Graph user by id or principal name.",
      },
      {
        name: "list_groups",
        description: "List Microsoft Graph groups with optional filtering.",
        aliases: ["get_groups"],
      },
      {
        name: "list_group_members",
        description: "List members for one Microsoft Graph group with optional transitive expansion.",
        aliases: ["list_group_users"],
      },
      {
        name: "list_calendar_events",
        description: "List calendar events for one Microsoft Graph user over a date window.",
      },
      {
        name: "get_online_meeting",
        description: "Fetch one Microsoft Teams online meeting by id for a specific user.",
      },
    ],
  },
  {
    provider: "dynamics_bc",
    actions: [
      {
        name: "list_companies",
        description: "List Business Central companies in the connected environment.",
      },
      {
        name: "list_customers",
        description: "List Business Central customers for a selected company.",
      },
      {
        name: "list_bank_accounts",
        description: "List Business Central bank accounts for a selected company.",
      },
      {
        name: "list_vendors",
        description: "List Business Central vendors for a selected company.",
      },
      {
        name: "list_sales_invoices",
        description: "List Business Central sales invoices for a selected company.",
      },
      {
        name: "get_sales_invoice",
        description: "Fetch one Business Central sales invoice by id.",
      },
      {
        name: "list_sales_invoice_lines",
        description: "List line items for a Business Central sales invoice.",
      },
      {
        name: "list_purchase_invoices",
        description: "List Business Central purchase invoices for a selected company.",
      },
      {
        name: "get_purchase_invoice",
        description: "Fetch one Business Central purchase invoice by id.",
      },
      {
        name: "list_purchase_invoice_lines",
        description: "List line items for a Business Central purchase invoice.",
      },
      {
        name: "list_vendor_payment_journals",
        description: "List Business Central vendor payment journals for a selected company.",
      },
      {
        name: "list_vendor_payments",
        description: "List Business Central vendor payments with optional journal and posting-date filters.",
      },
      {
        name: "get_vendor_payment",
        description: "Fetch one Business Central vendor payment by id.",
      },
      {
        name: "list_customer_payment_journals",
        description: "List Business Central customer payment journals for a selected company.",
      },
      {
        name: "list_customer_payments",
        description: "List Business Central customer payments with optional journal and posting-date filters.",
      },
      {
        name: "get_customer_payment",
        description: "Fetch one Business Central customer payment by id.",
      },
      {
        name: "list_journals",
        description: "List Business Central journals for a selected company.",
      },
      {
        name: "list_journal_lines",
        description: "List lines inside one Business Central journal.",
      },
      {
        name: "list_general_ledger_entries",
        description: "List Business Central general ledger entries with optional posting-date filters.",
        aliases: ["get_general_ledger_entries", "list_general_ledger"],
      },
    ],
  },
  {
    provider: "payhawk",
    actions: [
      {
        name: "list_fund_accounts",
        description: "List Payhawk fund accounts for the connected account.",
        aliases: ["get_account_balance", "get_account_info"],
      },
      {
        name: "list_expenses",
        description: "List Payhawk expenses with optional pagination and filters.",
        aliases: ["get_expenses", "list_transactions"],
      },
      {
        name: "get_expense",
        description: "Fetch one Payhawk expense by id.",
      },
      {
        name: "get_expense_workflow",
        description: "Fetch approval workflow details for one Payhawk expense.",
      },
      {
        name: "get_bank_statement",
        description: "Fetch bank statement data for a Payhawk fund account.",
      },
      {
        name: "get_resource",
        description: "Fetch a documented Payhawk resource path via GET when a typed action is not available yet.",
      },
    ],
  },
  {
    provider: "zendesk",
    actions: [
      {
        name: "list_tickets",
        description: "List Zendesk tickets with optional search filters.",
      },
      {
        name: "get_ticket",
        description: "Fetch one Zendesk ticket by id.",
      },
      {
        name: "get_ticket_comments",
        description: "Fetch comments for one Zendesk ticket.",
        aliases: ["get_comments"],
      },
      {
        name: "get_ticket_audits",
        description: "Fetch audit trail entries for one Zendesk ticket.",
      },
      {
        name: "list_users",
        description: "List or search Zendesk users.",
      },
      {
        name: "list_organizations",
        description: "List or search Zendesk organizations.",
        aliases: ["get_organization"],
      },
      {
        name: "list_views",
        description: "List Zendesk ticket views.",
      },
      {
        name: "list_macros",
        description: "List Zendesk ticket macros.",
      },
      {
        name: "list_help_center_categories",
        description: "List Zendesk Help Center categories.",
      },
      {
        name: "list_help_center_sections",
        description: "List Zendesk Help Center sections.",
      },
      {
        name: "list_help_center_articles",
        description: "List Zendesk Help Center articles.",
      },
    ],
  },
  {
    provider: "linkedin_mcp",
    actions: [
      {
        name: "list_tools",
        description: "List tools exposed by the connected LinkedIn MCP server.",
      },
      {
        name: "call_tool",
        description: "Invoke one tool on the connected LinkedIn MCP server.",
        chatReadOnly: false,
      },
    ],
  },
  {
    provider: "metabase",
    actions: [
      {
        name: "list_collections",
        description: "List accessible Metabase collections with bounded pagination.",
      },
      {
        name: "get_collection",
        description: "Fetch one Metabase collection by id and optionally include bounded items.",
        aliases: ["get_collection_by_id"],
      },
      {
        name: "list_dashboards",
        description: "List Metabase dashboards with optional collection filtering.",
      },
      {
        name: "get_dashboard",
        description: "Fetch one Metabase dashboard by id.",
        aliases: ["get_dashboard_by_id"],
      },
      {
        name: "list_cards",
        description: "List Metabase saved questions with optional collection and database filters.",
        aliases: ["list_questions"],
      },
      {
        name: "get_card",
        description: "Fetch one Metabase saved question by id.",
        aliases: ["get_question"],
      },
      {
        name: "list_databases",
        description: "List databases known to the connected Metabase workspace.",
      },
      {
        name: "search_content",
        description: "Search Metabase collections, dashboards, and saved questions.",
        aliases: ["search"],
      },
    ],
  },
];

const LOCAL_CONNECTOR_CHAT_ACTIONS = Object.fromEntries(
  LOCAL_CONNECTOR_DEFINITIONS.flatMap((definition) => {
    if (definition.includeInChatReadSurface === false) {
      return [];
    }
    return [
      [
        definition.provider,
        definition.actions
          .filter((action) => action.chatReadOnly !== false)
          .map((action) => action.name),
      ],
    ];
  }),
) as Record<string, readonly string[]>;

export const READ_ONLY_CHAT_CONNECTOR_ACTIONS: Record<string, readonly string[]> = {
  ...LOCAL_CONNECTOR_CHAT_ACTIONS,
  slack: [
    "list_channels",
    "list_users",
    "search_all",
    "list_files",
    "get_message_reactions",
    "get_channel_info",
    "list_channel_members",
    "get_channel_history",
    "get_thread_replies",
  ],
  jira: [
    "list_projects",
    "search_issues",
    "get_issue",
    "list_issue_comments",
  ],
};

const CONNECTOR_ACTION_ALIASES = Object.fromEntries(
  LOCAL_CONNECTOR_DEFINITIONS.map((definition) => [
    definition.provider,
    Object.fromEntries(
      definition.actions.flatMap((action) =>
        (action.aliases ?? []).map((alias) => [alias, action.name] as const),
      ),
    ),
  ]),
) as Record<string, Record<string, string>>;

export type AgentConnectorCatalogEntry = {
  provider: string;
  label: string;
  description: string;
  capabilities: readonly string[];
  actions: readonly { name: string; description: string }[];
  surface: "agent_connectors" | "hub_legacy";
  ruleFilePath: string;
};

type ConnectorCompanyContext = {
  companyId: string;
  companySlug: string;
  companyDbPort: number;
};

type ConnectorRuleLoadResult = {
  document: ParsedConnectorRuleDocument | null;
  summary: ConnectorRuleSummary;
};

type ConnectorActionResult = {
  status: number;
  body: Record<string, unknown>;
};

function getRequiredProviderDefinition(provider: string) {
  const definition = getConnectorProviderDefinition(provider);
  if (!definition) {
    throw new Error(`Missing connector provider definition for ${provider}`);
  }
  return definition;
}

function buildCatalogEntry(
  provider: string,
  actions: readonly { name: string; description: string }[],
  surface: AgentConnectorCatalogEntry["surface"] = "agent_connectors",
): AgentConnectorCatalogEntry {
  const definition = getRequiredProviderDefinition(provider);
  return {
    provider,
    label: definition.label,
    description: definition.description,
    capabilities: getConnectorCapabilities(provider),
    actions,
    surface,
    ruleFilePath: getConnectorRuleFilePath(provider),
  };
}

function normalizeIdSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function normalizeRepoSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
}

function normalizeComparableSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
}

function normalizeScalarSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function resolveRequestedConnectionIdFromPayload(
  input: Record<string, unknown>,
): string | null {
  return typeof input.connectionId === "string" && input.connectionId.trim().length > 0
    ? input.connectionId.trim()
    : null;
}

function normalizeAdAccountSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => value.replace(/^act_/i, "").trim())
      .filter((value) => value.length > 0),
  );
}

function normalizeLinkedinAdsIdSet(
  values: string[] | undefined,
  kind: "account" | "campaign",
): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) =>
        kind === "account"
          ? value.replace(/^urn:li:sponsoredAccount:/i, "").trim()
          : value.replace(/^urn:li:sponsoredCampaign:/i, "").trim(),
      )
      .filter((value) => value.length > 0),
  );
}

function normalizeNotionIdSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => normalizeNotionId(value))
      .filter((value): value is string => Boolean(value)),
  );
}

function resolveRepoFullNameFromPayload(input: Record<string, unknown>): string | null {
  const fullNameCandidate = [
    input.fullName,
    input.repoFullName,
    input.repository,
  ].find((value) => typeof value === "string" && value.trim().length > 0);

  if (typeof fullNameCandidate === "string") {
    const normalized = fullNameCandidate.trim();
    if (normalized.includes("/")) {
      return normalized.toLowerCase();
    }
  }

  const owner =
    typeof input.owner === "string" && input.owner.trim().length > 0
      ? input.owner.trim()
      : null;
  const repo =
    typeof input.repo === "string" && input.repo.trim().length > 0
      ? input.repo.trim()
      : typeof input.name === "string" && input.name.trim().length > 0
        ? input.name.trim()
        : null;

  if (!owner || !repo) {
    return null;
  }

  return `${owner}/${repo}`.toLowerCase();
}

function extractRepoFullNameFromResult(item: unknown): string | null {
  if (!isRecord(item)) return null;
  if (typeof item.full_name === "string" && item.full_name.trim().length > 0) {
    return item.full_name.trim().toLowerCase();
  }
  const owner =
    isRecord(item.owner) && typeof item.owner.login === "string"
      ? item.owner.login.trim()
      : null;
  const repo =
    typeof item.name === "string" && item.name.trim().length > 0
      ? item.name.trim()
      : null;

  if (!owner || !repo) {
    return null;
  }

  return `${owner}/${repo}`.toLowerCase();
}

function resolveProjectIdentifierFromPayload(input: Record<string, unknown>): string | null {
  const candidate = [
    input.projectId,
    input.idOrName,
    input.project,
    input.name,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string" ? candidate.trim().toLowerCase() : null;
}

function resolvePosthogProjectIdFromPayload(input: Record<string, unknown>): string | null {
  const candidate = [
    input.projectId,
    input.idOrName,
    input.project,
    input.project_id,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string" ? candidate.trim() : null;
}

function resolveTeamIdentifierFromPayload(input: Record<string, unknown>): string | null {
  const candidate = [
    input.teamId,
    input.accountId,
    input.slug,
    input.teamSlug,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string" ? candidate.trim().toLowerCase() : null;
}

function extractVercelTeamIdentifiers(item: unknown): string[] {
  if (!isRecord(item)) return [];
  const candidates = [
    item.id,
    item.slug,
    item.name,
    item.teamId,
    item.accountId,
  ];
  return candidates
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
}

function extractVercelProjectIdentifiers(item: unknown): string[] {
  if (!isRecord(item)) return [];
  const candidates = [
    item.id,
    item.name,
    item.projectId,
    item.projectName,
  ];
  return candidates
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
}

function extractPosthogProjectId(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const candidate = [
    item.id,
    item.projectId,
    item.project_id,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string" ? candidate.trim() : null;
}

function resolveGoogleAdsCustomerIdFromPayload(input: Record<string, unknown>): string | null {
  const candidate = [
    input.customerId,
    input.customer_id,
    input.accountId,
    input.account_id,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string" ? candidate.replace(/\D+/g, "").trim() : null;
}

function extractGoogleAdsCustomerId(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const candidate = [item.customerId, item.customer_id, item.id].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return typeof candidate === "string" ? candidate.replace(/\D+/g, "").trim() : null;
}

function resolveMetaAdAccountIdFromPayload(input: Record<string, unknown>): string | null {
  const candidate = [
    input.adAccountId,
    input.accountId,
    input.account_id,
    input.defaultAdAccountId,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string" ? candidate.replace(/^act_/i, "").trim() : null;
}

function extractMetaAdAccountId(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const candidate = [item.id, item.rawId, item.accountId].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return typeof candidate === "string" ? candidate.replace(/^act_/i, "").trim() : null;
}

function resolveTiktokAdvertiserIdFromPayload(input: Record<string, unknown>): string | null {
  const candidate = [input.advertiserId, input.accountId, input.account_id].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return typeof candidate === "string" ? candidate.trim() : null;
}

function extractTiktokAdvertiserId(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const candidate = [item.advertiserId, item.advertiser_id, item.id].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return typeof candidate === "string" ? candidate.trim() : null;
}

function resolveLinkedinAdsAccountIdFromPayload(input: Record<string, unknown>): string | null {
  const candidate = [
    input.accountId,
    input.account_id,
    input.adAccountId,
    input.ad_account_id,
    input.defaultAccountId,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string"
    ? candidate.replace(/^urn:li:sponsoredAccount:/i, "").trim()
    : null;
}

function extractLinkedinAdsAccountId(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const candidate = [item.accountId, item.account_id, item.id].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return typeof candidate === "string"
    ? candidate.replace(/^urn:li:sponsoredAccount:/i, "").trim()
    : null;
}

function resolveLinkedinAdsCampaignIdFromPayload(input: Record<string, unknown>): string | null {
  const candidate = [
    input.campaignId,
    input.campaign_id,
    input.id,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string"
    ? candidate.replace(/^urn:li:sponsoredCampaign:/i, "").trim()
    : null;
}

function extractLinkedinAdsCampaignId(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const candidate = [item.campaignId, item.campaign_id, item.id].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return typeof candidate === "string"
    ? candidate.replace(/^urn:li:sponsoredCampaign:/i, "").trim()
    : null;
}

function resolveGa4PropertyIdFromPayload(input: Record<string, unknown>): string | null {
  const candidate = [
    input.propertyId,
    input.property_id,
    input.id,
    input.defaultPropertyId,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string" ? candidate.replace(/\D+/g, "").trim() : null;
}

function extractGa4PropertyId(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const candidate = [item.propertyId, item.property_id, item.id].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return typeof candidate === "string" ? candidate.replace(/\D+/g, "").trim() : null;
}

function normalizeGoogleSearchConsoleSiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("sc-domain:")) {
    return trimmed.toLowerCase();
  }

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "/") {
      return `${url.origin.toLowerCase()}/`;
    }
    return `${url.origin.toLowerCase()}${pathname}/`;
  } catch {
    return trimmed;
  }
}

function normalizeGoogleSearchConsoleSiteSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => normalizeGoogleSearchConsoleSiteUrl(value))
      .filter((value) => value.length > 0),
  );
}

function resolveGoogleSearchConsoleSiteUrlFromPayload(
  input: Record<string, unknown>,
): string | null {
  const candidate = [
    input.siteUrl,
    input.propertyUrl,
    input.defaultSiteUrl,
    input.defaultPropertyUrl,
    input.url,
    input.site,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string"
    ? normalizeGoogleSearchConsoleSiteUrl(candidate)
    : null;
}

function extractGoogleSearchConsoleSiteUrl(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const candidate = [item.siteUrl, item.propertyUrl, item.url, item.id].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return typeof candidate === "string"
    ? normalizeGoogleSearchConsoleSiteUrl(candidate)
    : null;
}

function normalizeHubspotPipelineSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function extractHubspotPortalId(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const candidate = [item.portalId, item.portal_id, item.id].find(
    (value) =>
      (typeof value === "string" && value.trim().length > 0) ||
      (typeof value === "number" && Number.isFinite(value)),
  );
  return typeof candidate === "number"
    ? String(candidate)
    : typeof candidate === "string"
      ? candidate.trim()
      : null;
}

function resolveHubspotPortalIdFromPayload(
  input: Record<string, unknown>,
): string | null {
  const candidate = [
    input.portalId,
    input.portal_id,
    input.accountId,
    input.defaultPortalId,
  ].find(
    (value) =>
      (typeof value === "string" && value.trim().length > 0) ||
      (typeof value === "number" && Number.isFinite(value)),
  );
  return typeof candidate === "number"
    ? String(candidate)
    : typeof candidate === "string"
      ? candidate.trim()
      : null;
}

function extractHubspotPipelineId(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const candidate =
    typeof item.pipeline === "string" && item.pipeline.trim().length > 0
      ? item.pipeline.trim()
      : null;
  return candidate;
}

function resolveHubspotPipelineIdFromPayload(
  input: Record<string, unknown>,
): string | null {
  const candidate = [
    input.pipelineId,
    input.pipeline_id,
    input.pipeline,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string" ? candidate.trim() : null;
}

function normalizeNotionId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/-/g, "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function resolveLinearTeamIdFromPayload(input: Record<string, unknown>): string | null {
  const candidate = [
    input.teamId,
    input.team_id,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string" ? candidate.trim() : null;
}

function resolveLinearProjectIdFromPayload(input: Record<string, unknown>): string | null {
  const candidate = [
    input.projectId,
    input.project_id,
  ].find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof candidate === "string" ? candidate.trim() : null;
}

function extractLinearTeamId(item: unknown): string | null {
  if (!isRecord(item)) return null;
  if (typeof item.id === "string" && item.id.trim().length > 0) {
    return item.id.trim();
  }
  const team = isRecord(item.team) ? item.team : null;
  return team && typeof team.id === "string" && team.id.trim().length > 0
    ? team.id.trim()
    : null;
}

function extractLinearProjectId(item: unknown): string | null {
  if (!isRecord(item)) return null;
  if (typeof item.projectId === "string" && item.projectId.trim().length > 0) {
    return item.projectId.trim();
  }
  if (typeof item.id === "string" && item.id.trim().length > 0 && typeof item.slug === "string") {
    return item.id.trim();
  }
  const project = isRecord(item.project) ? item.project : null;
  return project && typeof project.id === "string" && project.id.trim().length > 0
    ? project.id.trim()
    : null;
}

function resolveNotionPageIdFromPayload(input: Record<string, unknown>): string | null {
  return normalizeNotionId(
    [
      input.pageId,
      input.page_id,
      input.id,
    ].find((value) => typeof value === "string" && value.trim().length > 0) as string | undefined,
  );
}

function resolveNotionDataSourceIdFromPayload(input: Record<string, unknown>): string | null {
  return normalizeNotionId(
    [
      input.dataSourceId,
      input.data_source_id,
      input.databaseId,
      input.database_id,
      input.id,
    ].find((value) => typeof value === "string" && value.trim().length > 0) as string | undefined,
  );
}

function extractNotionId(item: unknown): string | null {
  if (!isRecord(item) || typeof item.id !== "string") return null;
  return normalizeNotionId(item.id);
}

function getRecordPayload(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function buildRuleViolation(
  provider: string,
  action: string,
  message: string,
  details?: Record<string, unknown>,
): ConnectorActionResult {
  return {
    status: 403,
    body: {
      error: message,
      code: "connector_rule_violation",
      provider,
      action,
      ...(details ? { details } : {}),
    },
  };
}

async function resolveConnectorCompanyContext(input: {
  companyId: string;
  companySlug?: string | null;
  companyDbPort?: number | null;
}): Promise<ConnectorCompanyContext> {
  if (
    typeof input.companySlug === "string" &&
    input.companySlug.trim().length > 0 &&
    typeof input.companyDbPort === "number"
  ) {
    return {
      companyId: input.companyId,
      companySlug: input.companySlug.trim(),
      companyDbPort: input.companyDbPort,
    };
  }

  const selected = await db
    .select({
      slug: companies.slug,
      companyDbPort: companies.companyDbPort,
    })
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1);

  const company = selected[0] ?? null;
  const companySlug =
    input.companySlug?.trim() ||
    (typeof company?.slug === "string" && company.slug.trim().length > 0
      ? company.slug.trim()
      : await getCompanySlug(input.companyId));

  return {
    companyId: input.companyId,
    companySlug,
    companyDbPort: input.companyDbPort ?? company?.companyDbPort ?? 3100,
  };
}

async function loadConnectorRuleDocument(
  provider: string,
  context: ConnectorCompanyContext,
  options?: { throwOnInvalid?: boolean },
): Promise<ConnectorRuleLoadResult> {
  const path = getConnectorRuleFilePath(provider);
  const raw = await readQmdFile(path, {
    companySlug: context.companySlug,
    callerId: `connector-rules-${context.companySlug}`,
    port: context.companyDbPort,
  });

  if (raw === null) {
    return {
      document: null,
      summary: {
        path,
        exists: false,
        provider,
        policyMode: "advisory",
        strict: false,
        notes: null,
        restrictionSummary: {},
      },
    };
  }

  try {
    const document = parseConnectorRuleFile(provider, raw, path);
    return {
      document,
      summary: document.summary,
    };
  } catch (error) {
    if (options?.throwOnInvalid) {
      throw new ConnectorHubError(
        error instanceof Error ? error.message : `Invalid connector rule file: ${path}`,
        {
          status: 500,
          code: "invalid_connector_rule_file",
          details: { provider, path },
        },
      );
    }

    return {
      document: null,
      summary: {
        path,
        exists: true,
        provider,
        policyMode: "advisory",
        strict: false,
        notes: null,
        restrictionSummary: {},
        error: error instanceof Error ? error.message : `Invalid connector rule file: ${path}`,
      },
    };
  }
}

const DEFAULT_TELEGRAM_CHAT_PAGE_SIZE = 50;
const MAX_TELEGRAM_CHAT_PAGE_SIZE = 200;
const DEFAULT_TELEGRAM_MESSAGE_PAGE_SIZE = 20;
const MAX_TELEGRAM_MESSAGE_PAGE_SIZE = 100;
const DYNAMICS_BC_EXHAUSTIVE_PAGE_SIZE = 200;
const MAX_CONNECTOR_PAGINATION_PAGES = 10_000;

function normalizePageSize(
  value: unknown,
  defaults: { defaultValue: number; maxValue: number },
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return defaults.defaultValue;
  }
  return Math.min(Math.max(value, 1), defaults.maxValue);
}

function normalizeOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return 0;
  }
  return Math.max(value, 0);
}

function normalizePageOffset(page: unknown, pageSize: number): number {
  if (typeof page !== "number" || !Number.isInteger(page) || page <= 1) {
    return 0;
  }
  return (page - 1) * pageSize;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function shouldAutoTraverseConnectorPages(
  provider: string,
  action: string,
  payload: unknown,
) {
  if (!action.startsWith("list_")) return false;
  if (!isRecord(payload)) return true;
  return payload.fetchAll !== false;
}

function getInitialTraversalPayload(
  provider: string,
  action: string,
  input: unknown,
) {
  if (!shouldAutoTraverseConnectorPages(provider, action, input)) {
    return input;
  }

  const payload = isRecord(input) ? { ...input } : {};
  if (provider === "dynamics_bc" && payload.top === undefined) {
    payload.top = DYNAMICS_BC_EXHAUSTIVE_PAGE_SIZE;
  }
  return payload;
}

function getPrimaryCollectionKey(body: Record<string, unknown>) {
  const preferredKeys = [
    "properties",
    "sites",
    "sitemaps",
    "portals",
    "teams",
    "projects",
    "cycles",
    "organizations",
    "environments",
    "deployments",
    "domains",
    "accounts",
    "adAccounts",
    "advertisers",
    "repos",
    "issues",
    "pullRequests",
    "commits",
    "workflowRuns",
    "events",
    "logs",
    "featureFlags",
    "insights",
    "campaigns",
    "contacts",
    "companies",
    "deals",
    "comments",
    "expenses",
    "fundAccounts",
    "generalLedgerEntries",
    "salesInvoices",
    "purchaseInvoices",
    "vendorPayments",
    "customerPayments",
    "vendorPaymentJournals",
    "customerPaymentJournals",
    "customers",
    "vendors",
    "bankAccounts",
    "journals",
    "journalLines",
    "collections",
    "dashboards",
    "cards",
    "databases",
    "tickets",
    "users",
    "organizations",
    "views",
    "macros",
    "categories",
    "sections",
    "articles",
    "spaces",
    "pages",
    "dataSources",
    "results",
    "files",
    "items",
  ];

  for (const key of preferredKeys) {
    if (Array.isArray(body[key])) return key;
  }

  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) return key;
  }

  return null;
}

function mergeConnectorCollection(
  current: unknown[],
  next: unknown[],
) {
  const merged = [...current];
  const seenIds = new Set(
    current
      .map((item) =>
        isRecord(item) && (typeof item.id === "string" || typeof item.id === "number")
          ? String(item.id)
          : null,
      )
      .filter((value): value is string => Boolean(value)),
  );

  for (const item of next) {
    const itemId =
      isRecord(item) && (typeof item.id === "string" || typeof item.id === "number")
        ? String(item.id)
        : null;
    if (itemId && seenIds.has(itemId)) continue;
    if (itemId) seenIds.add(itemId);
    merged.push(item);
  }

  return merged;
}

function buildNextConnectorPagePayload(
  payload: Record<string, unknown>,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  if (
    (typeof body.nextCursor === "string" && body.nextCursor.trim().length > 0) ||
    (typeof body.nextCursor === "number" && Number.isFinite(body.nextCursor))
  ) {
    return { ...payload, from: body.nextCursor };
  }
  if (typeof body.nextPage === "number" && Number.isFinite(body.nextPage)) {
    return { ...payload, page: body.nextPage };
  }
  if (typeof body.nextSkip === "number" && Number.isFinite(body.nextSkip)) {
    return { ...payload, skip: body.nextSkip };
  }
  if (typeof body.nextOffset === "number" && Number.isFinite(body.nextOffset)) {
    return { ...payload, offset: body.nextOffset };
  }
  if (
    (typeof body.nextAfter === "string" && body.nextAfter.trim().length > 0) ||
    (typeof body.nextAfter === "number" && Number.isFinite(body.nextAfter))
  ) {
    return { ...payload, after: body.nextAfter };
  }
  if (typeof body.nextStartRow === "number" && Number.isFinite(body.nextStartRow)) {
    return { ...payload, startRow: body.nextStartRow };
  }
  if (typeof body.nextPageToken === "string" && body.nextPageToken.trim().length > 0) {
    return { ...payload, pageToken: body.nextPageToken };
  }
  return null;
}

async function exhaustConnectorPages(
  connection: NonNullable<Awaited<ReturnType<typeof getLatestConnectionCredentialsByProvider>>>,
  provider: string,
  action: string,
  payload: unknown,
  firstResult: { status: number; body: Record<string, unknown> },
  executor: (
    connection: NonNullable<Awaited<ReturnType<typeof getLatestConnectionCredentialsByProvider>>>,
    action: string,
    input: unknown,
  ) => Promise<{ status: number; body: Record<string, unknown> }>,
) {
  if (!shouldAutoTraverseConnectorPages(provider, action, payload)) {
    return firstResult;
  }
  if (firstResult.status >= 400) {
    return firstResult;
  }

  const collectionKey = getPrimaryCollectionKey(firstResult.body);
  if (!collectionKey || !Array.isArray(firstResult.body[collectionKey])) {
    return firstResult;
  }

  let pageCount = 1;
  let mergedBody = { ...firstResult.body };
  let mergedCollection = [...(mergedBody[collectionKey] as unknown[])];
  let nextPayload = buildNextConnectorPagePayload(
    isRecord(payload) ? payload : {},
    mergedBody,
  );
  const seenCursors = new Set<string>();

  while (
    mergedBody.hasMore === true &&
    nextPayload &&
    pageCount < MAX_CONNECTOR_PAGINATION_PAGES
  ) {
    const cursorKey = JSON.stringify({
      from: nextPayload.from ?? null,
      page: nextPayload.page ?? null,
      skip: nextPayload.skip ?? null,
      offset: nextPayload.offset ?? null,
      after: nextPayload.after ?? null,
      startRow: nextPayload.startRow ?? null,
      pageToken: nextPayload.pageToken ?? null,
    });
    if (seenCursors.has(cursorKey)) {
      break;
    }
    seenCursors.add(cursorKey);

    const nextResult = await executor(connection, action, nextPayload);
    if (nextResult.status >= 400) {
      return nextResult;
    }

    const nextCollection = Array.isArray(nextResult.body[collectionKey])
      ? (nextResult.body[collectionKey] as unknown[])
      : [];
    mergedCollection = mergeConnectorCollection(mergedCollection, nextCollection);
    mergedBody = {
      ...nextResult.body,
      [collectionKey]: mergedCollection,
    };
    pageCount += 1;
    nextPayload = buildNextConnectorPagePayload(nextPayload, nextResult.body);
  }

  if (pageCount === 1) {
    return firstResult;
  }

  return {
    status: firstResult.status,
    body: {
      ...mergedBody,
      count: mergedCollection.length,
      returnedCount: mergedCollection.length,
      totalCount:
        typeof mergedBody.totalCount === "number" ? mergedCollection.length : mergedBody.totalCount,
      hasMore: mergedBody.hasMore === true && nextPayload !== null,
      nextSkip:
        mergedBody.hasMore === true && nextPayload && typeof nextPayload.skip === "number"
          ? nextPayload.skip
          : null,
      nextOffset:
        mergedBody.hasMore === true && nextPayload && typeof nextPayload.offset === "number"
          ? nextPayload.offset
          : null,
      nextPage:
        mergedBody.hasMore === true && nextPayload && typeof nextPayload.page === "number"
          ? nextPayload.page
          : null,
      nextLink:
        mergedBody.hasMore === true && typeof mergedBody.nextLink === "string"
          ? mergedBody.nextLink
          : null,
      pageTraversalMode: "exhaustive",
      fetchedPages: pageCount,
    },
  };
}

function applySlackRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "slack") {
    return result;
  }

  const slackRules = rules.frontmatter as SlackConnectorRuleFrontmatter;
  const allowedChannels = normalizeIdSet(slackRules.allowed_channel_ids);
  const blockedChannels = normalizeIdSet(slackRules.blocked_channel_ids);
  if (action !== "list_channels" || !Array.isArray(result.body.channels)) {
    return result;
  }

  return {
    ...result,
    body: {
      ...result.body,
      channels: result.body.channels.filter((channel) => {
        const channelId =
          channel && typeof channel === "object" && typeof channel.id === "string"
            ? channel.id
            : null;
        if (!channelId) return false;
        if (blockedChannels.has(channelId)) return false;
        if (allowedChannels.size > 0 && !allowedChannels.has(channelId)) return false;
        return true;
      }),
    },
  };
}

function applyGithubRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "github") {
    return result;
  }

  const githubRules = rules.frontmatter as GithubConnectorRuleFrontmatter;
  const allowedRepos = normalizeRepoSet(githubRules.allowed_repos);
  const blockedRepos = normalizeRepoSet(githubRules.blocked_repos);
  if (action !== "list_repos" || !Array.isArray(result.body.repos)) {
    return result;
  }

  const repos = result.body.repos.filter((repo) => {
    const fullName = extractRepoFullNameFromResult(repo);
    if (!fullName) return false;
    if (blockedRepos.has(fullName)) return false;
    if (allowedRepos.size > 0 && !allowedRepos.has(fullName)) return false;
    return true;
  });

  return {
    ...result,
    body: {
      ...result.body,
      repos,
      count: repos.length,
      returnedCount: repos.length,
    },
  };
}

function applyGoogleAdsRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "google_ads") {
    return result;
  }

  const googleAdsRules = rules.frontmatter as GoogleAdsConnectorRuleFrontmatter;
  const allowedAccounts = normalizeScalarSet(googleAdsRules.account_ids);

  if (action === "list_accessible_customers" && Array.isArray(result.body.customers)) {
    const customers = result.body.customers.filter((customer) => {
      if (allowedAccounts.size === 0) return true;
      const customerId = extractGoogleAdsCustomerId(customer);
      return customerId ? allowedAccounts.has(customerId) : false;
    });
    return {
      ...result,
      body: {
        ...result.body,
        customers,
        count: customers.length,
        returnedCount: customers.length,
      },
    };
  }

  if (action === "get_customer" && isRecord(result.body.customer) && allowedAccounts.size > 0) {
    const customerId = extractGoogleAdsCustomerId(result.body.customer);
    if (customerId && !allowedAccounts.has(customerId)) {
      return buildRuleViolation(
        "google_ads",
        action,
        "Google Ads customer is outside the allowed connector scope.",
        { path: rules.path, customerId },
      );
    }
  }

  return result;
}

function applyLinkedinAdsRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "linkedin_ads") {
    return result;
  }

  const linkedinAdsRules = rules.frontmatter as LinkedinAdsConnectorRuleFrontmatter;
  const allowedAccounts = normalizeLinkedinAdsIdSet(
    linkedinAdsRules.account_ids,
    "account",
  );
  const allowedCampaigns = normalizeLinkedinAdsIdSet(
    linkedinAdsRules.campaign_ids,
    "campaign",
  );

  if (action === "list_accounts" && Array.isArray(result.body.accounts)) {
    const accounts = result.body.accounts.filter((account) => {
      if (allowedAccounts.size === 0) return true;
      const accountId = extractLinkedinAdsAccountId(account);
      return accountId ? allowedAccounts.has(accountId) : false;
    });
    return {
      ...result,
      body: {
        ...result.body,
        accounts,
        count: accounts.length,
        returnedCount: accounts.length,
      },
    };
  }

  if (action === "list_campaigns" && Array.isArray(result.body.campaigns)) {
    const campaigns = result.body.campaigns.filter((campaign) => {
      const campaignId = extractLinkedinAdsCampaignId(campaign);
      const accountId = isRecord(campaign)
        ? extractLinkedinAdsAccountId(campaign)
        : null;
      if (allowedAccounts.size > 0 && (!accountId || !allowedAccounts.has(accountId))) {
        return false;
      }
      if (allowedCampaigns.size > 0 && (!campaignId || !allowedCampaigns.has(campaignId))) {
        return false;
      }
      return true;
    });
    return {
      ...result,
      body: {
        ...result.body,
        campaigns,
        count: campaigns.length,
        returnedCount: campaigns.length,
      },
    };
  }

  if (action === "get_account" && isRecord(result.body.account) && allowedAccounts.size > 0) {
    const accountId = extractLinkedinAdsAccountId(result.body.account);
    if (accountId && !allowedAccounts.has(accountId)) {
      return buildRuleViolation(
        "linkedin_ads",
        action,
        "LinkedIn Ads account is outside the allowed connector scope.",
        { path: rules.path, accountId },
      );
    }
  }

  if (
    ["get_campaign", "query_analytics"].includes(action) &&
    allowedCampaigns.size > 0
  ) {
    const campaignId =
      typeof result.body.campaignId === "string"
        ? result.body.campaignId
        : isRecord(result.body.campaign)
          ? extractLinkedinAdsCampaignId(result.body.campaign)
          : null;
    if (campaignId && !allowedCampaigns.has(campaignId)) {
      return buildRuleViolation(
        "linkedin_ads",
        action,
        "LinkedIn Ads campaign is outside the allowed connector scope.",
        { path: rules.path, campaignId },
      );
    }
  }

  return result;
}

function applyMetaAdsRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "meta_ads") {
    return result;
  }

  const metaAdsRules = rules.frontmatter as MetaAdsConnectorRuleFrontmatter;
  const allowedAccounts = normalizeAdAccountSet(metaAdsRules.account_ids);

  if (action === "list_ad_accounts" && Array.isArray(result.body.adAccounts)) {
    const adAccounts = result.body.adAccounts.filter((account) => {
      if (allowedAccounts.size === 0) return true;
      const accountId = extractMetaAdAccountId(account);
      return accountId ? allowedAccounts.has(accountId) : false;
    });
    return {
      ...result,
      body: {
        ...result.body,
        adAccounts,
        count: adAccounts.length,
        returnedCount: adAccounts.length,
      },
    };
  }

  return result;
}

function applyTiktokAdsRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "tiktok_ads") {
    return result;
  }

  const tiktokAdsRules = rules.frontmatter as TiktokAdsConnectorRuleFrontmatter;
  const allowedAdvertisers = normalizeScalarSet(tiktokAdsRules.advertiser_ids);

  if (action === "list_advertisers" && Array.isArray(result.body.advertisers)) {
    const advertisers = result.body.advertisers.filter((advertiser) => {
      if (allowedAdvertisers.size === 0) return true;
      const advertiserId = extractTiktokAdvertiserId(advertiser);
      return advertiserId ? allowedAdvertisers.has(advertiserId) : false;
    });
    return {
      ...result,
      body: {
        ...result.body,
        advertisers,
        count: advertisers.length,
        returnedCount: advertisers.length,
      },
    };
  }

  return result;
}

function applyGa4RuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "ga4") {
    return result;
  }

  const ga4Rules = rules.frontmatter as Ga4ConnectorRuleFrontmatter;
  const allowedProperties = normalizeScalarSet(ga4Rules.property_ids);

  if (action === "list_properties" && Array.isArray(result.body.properties)) {
    const properties = result.body.properties.filter((property) => {
      if (allowedProperties.size === 0) return true;
      const propertyId = extractGa4PropertyId(property);
      return propertyId ? allowedProperties.has(propertyId) : false;
    });
    return {
      ...result,
      body: {
        ...result.body,
        properties,
        count: properties.length,
        returnedCount: properties.length,
      },
    };
  }

  if (
    ["get_property", "run_report", "list_dimensions_metrics"].includes(action) &&
    allowedProperties.size > 0 &&
    typeof result.body.propertyId === "string" &&
    !allowedProperties.has(result.body.propertyId)
  ) {
    return buildRuleViolation(
      "ga4",
      action,
      "GA4 property is outside the allowed connector scope.",
      { path: rules.path, propertyId: result.body.propertyId },
    );
  }

  return result;
}

function applyGoogleSearchConsoleRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "google_search_console") {
    return result;
  }

  const gscRules = rules.frontmatter as GoogleSearchConsoleConnectorRuleFrontmatter;
  const allowedSites = normalizeGoogleSearchConsoleSiteSet(gscRules.site_urls);

  if (action === "list_sites" && Array.isArray(result.body.sites)) {
    const sites = result.body.sites.filter((site) => {
      if (allowedSites.size === 0) return true;
      const siteUrl = extractGoogleSearchConsoleSiteUrl(site);
      return siteUrl ? allowedSites.has(siteUrl) : false;
    });
    return {
      ...result,
      body: {
        ...result.body,
        sites,
        count: sites.length,
        returnedCount: sites.length,
      },
    };
  }

  if (
    ["get_site", "query_search_analytics", "list_sitemaps"].includes(action) &&
    allowedSites.size > 0 &&
    typeof result.body.siteUrl === "string" &&
    !allowedSites.has(normalizeGoogleSearchConsoleSiteUrl(result.body.siteUrl))
  ) {
    return buildRuleViolation(
      "google_search_console",
      action,
      "Google Search Console site is outside the allowed connector scope.",
      { path: rules.path, siteUrl: result.body.siteUrl },
    );
  }

  return result;
}

function applyHubspotRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "hubspot") {
    return result;
  }

  const hubspotRules = rules.frontmatter as HubspotConnectorRuleFrontmatter;
  const allowedPortals = normalizeScalarSet(hubspotRules.portal_ids);
  const allowedPipelines = normalizeHubspotPipelineSet(hubspotRules.allowed_pipeline_ids);

  if (action === "list_portals" && Array.isArray(result.body.portals)) {
    const portals = result.body.portals.filter((portal) => {
      if (allowedPortals.size === 0) return true;
      const portalId = extractHubspotPortalId(portal);
      return portalId ? allowedPortals.has(portalId) : false;
    });
    return {
      ...result,
      body: {
        ...result.body,
        portals,
        count: portals.length,
        returnedCount: portals.length,
      },
    };
  }

  if (action === "list_deals" && Array.isArray(result.body.deals) && allowedPipelines.size > 0) {
    const deals = result.body.deals.filter((deal) => {
      const pipelineId = extractHubspotPipelineId(deal);
      return pipelineId ? allowedPipelines.has(pipelineId) : false;
    });
    return {
      ...result,
      body: {
        ...result.body,
        deals,
        count: deals.length,
        returnedCount: deals.length,
      },
    };
  }

  if (
    action === "get_deal" &&
    isRecord(result.body.deal) &&
    allowedPipelines.size > 0
  ) {
    const pipelineId = extractHubspotPipelineId(result.body.deal);
    if (pipelineId && !allowedPipelines.has(pipelineId)) {
      return buildRuleViolation(
        "hubspot",
        action,
        "HubSpot deal is outside the allowed connector scope.",
        { path: rules.path, dealId: result.body.dealId ?? null, pipelineId },
      );
    }
  }

  return result;
}

function applyVercelRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "vercel") {
    return result;
  }

  const vercelRules = rules.frontmatter as VercelConnectorRuleFrontmatter;
  const allowedTeams = normalizeComparableSet(vercelRules.allowed_teams);
  const allowedProjects = normalizeComparableSet(vercelRules.allowed_projects);

  if (action === "list_teams" && Array.isArray(result.body.teams)) {
    const teams = result.body.teams.filter((team) => {
      if (allowedTeams.size === 0) return true;
      const identifiers = extractVercelTeamIdentifiers(team);
      return identifiers.some((identifier) => allowedTeams.has(identifier));
    });
    return {
      ...result,
      body: {
        ...result.body,
        teams,
        count: teams.length,
        returnedCount: teams.length,
      },
    };
  }

  if (action === "list_projects" && Array.isArray(result.body.projects)) {
    const projects = result.body.projects.filter((project) => {
      const teamIdentifiers = extractVercelTeamIdentifiers(project);
      const projectIdentifiers = extractVercelProjectIdentifiers(project);
      if (
        allowedTeams.size > 0 &&
        !teamIdentifiers.some((identifier) => allowedTeams.has(identifier))
      ) {
        return false;
      }
      if (
        allowedProjects.size > 0 &&
        !projectIdentifiers.some((identifier) => allowedProjects.has(identifier))
      ) {
        return false;
      }
      return true;
    });
    return {
      ...result,
      body: {
        ...result.body,
        projects,
        count: projects.length,
        returnedCount: projects.length,
      },
    };
  }

  return result;
}

function applyPosthogRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "posthog") {
    return result;
  }

  const posthogRules = rules.frontmatter as PosthogConnectorRuleFrontmatter;
  const allowedProjects = normalizeScalarSet(posthogRules.project_ids);

  if (action !== "list_projects" || !Array.isArray(result.body.projects)) {
    return result;
  }

  const projects = result.body.projects.filter((project) => {
    if (allowedProjects.size === 0) return true;
    const projectId = extractPosthogProjectId(project);
    return projectId ? allowedProjects.has(projectId) : false;
  });

  return {
    ...result,
    body: {
      ...result.body,
      projects,
      count: projects.length,
      returnedCount: projects.length,
    },
  };
}

function applyLinearRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "linear") {
    return result;
  }

  const linearRules = rules.frontmatter as LinearConnectorRuleFrontmatter;
  const allowedTeams = normalizeScalarSet(linearRules.allowed_team_ids);
  const allowedProjects = normalizeScalarSet(linearRules.allowed_project_ids);

  if (action === "list_teams" && Array.isArray(result.body.teams)) {
    const teams = result.body.teams.filter((team) => {
      if (allowedTeams.size === 0) return true;
      const teamId = extractLinearTeamId(team);
      return teamId ? allowedTeams.has(teamId) : false;
    });
    return {
      ...result,
      body: {
        ...result.body,
        teams,
        count: teams.length,
        returnedCount: teams.length,
      },
    };
  }

  if (action === "list_projects" && Array.isArray(result.body.projects)) {
    const projects = result.body.projects.filter((project) => {
      const projectId = extractLinearProjectId(project);
      const teamNodes =
        isRecord(project) &&
        isRecord(project.teams) &&
        Array.isArray(project.teams.nodes)
          ? project.teams.nodes
          : [];
      if (allowedProjects.size > 0 && (!projectId || !allowedProjects.has(projectId))) {
        return false;
      }
      if (allowedTeams.size > 0) {
        const teamIds = teamNodes
          .map((team) => extractLinearTeamId(team))
          .filter((value): value is string => Boolean(value));
        return teamIds.some((teamId) => allowedTeams.has(teamId));
      }
      return true;
    });
    return {
      ...result,
      body: {
        ...result.body,
        projects,
        count: projects.length,
        returnedCount: projects.length,
      },
    };
  }

  if (action === "list_issues" && Array.isArray(result.body.issues)) {
    const issues = result.body.issues.filter((issue) => {
      const projectId = extractLinearProjectId(issue);
      const teamId = extractLinearTeamId(issue);
      if (allowedProjects.size > 0 && (!projectId || !allowedProjects.has(projectId))) {
        return false;
      }
      if (allowedTeams.size > 0 && (!teamId || !allowedTeams.has(teamId))) {
        return false;
      }
      return true;
    });
    return {
      ...result,
      body: {
        ...result.body,
        issues,
        count: issues.length,
        returnedCount: issues.length,
      },
    };
  }

  if (action === "list_cycles" && Array.isArray(result.body.cycles)) {
    const cycles = result.body.cycles.filter((cycle) => {
      if (allowedTeams.size === 0) return true;
      const teamId = extractLinearTeamId(cycle);
      return teamId ? allowedTeams.has(teamId) : false;
    });
    return {
      ...result,
      body: {
        ...result.body,
        cycles,
        count: cycles.length,
        returnedCount: cycles.length,
      },
    };
  }

  if (action === "get_issue" && isRecord(result.body.issue)) {
    const projectId = extractLinearProjectId(result.body.issue);
    const teamId = extractLinearTeamId(result.body.issue);
    if (
      (allowedProjects.size > 0 && (!projectId || !allowedProjects.has(projectId))) ||
      (allowedTeams.size > 0 && (!teamId || !allowedTeams.has(teamId)))
    ) {
      return buildRuleViolation(
        "linear",
        action,
        "Linear issue is outside the allowed connector scope.",
        { path: rules.path, issueId: result.body.issueId ?? null },
      );
    }
  }

  if (action === "list_issue_comments") {
    const projectId =
      typeof result.body.projectId === "string" ? result.body.projectId : null;
    const teamId =
      typeof result.body.teamId === "string" ? result.body.teamId : null;
    if (
      (allowedProjects.size > 0 && (!projectId || !allowedProjects.has(projectId))) ||
      (allowedTeams.size > 0 && (!teamId || !allowedTeams.has(teamId)))
    ) {
      return buildRuleViolation(
        "linear",
        action,
        "Linear issue comments are outside the allowed connector scope.",
        { path: rules.path, issueId: result.body.issueId ?? null },
      );
    }
  }

  return result;
}

function applyNotionRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "notion") {
    return result;
  }

  const notionRules = rules.frontmatter as NotionConnectorRuleFrontmatter;
  const allowedPages = normalizeNotionIdSet(notionRules.allowed_page_ids);
  const allowedDataSources = normalizeNotionIdSet(notionRules.allowed_data_source_ids);

  const filterContent = (items: unknown[]) =>
    items.filter((item) => {
      if (!isRecord(item)) return false;
      const itemId = extractNotionId(item);
      const objectType = typeof item.object === "string" ? item.object : null;
      if (objectType === "page") {
        return allowedPages.size === 0 || (itemId ? allowedPages.has(itemId) : false);
      }
      if (objectType === "data_source") {
        return (
          allowedDataSources.size === 0 ||
          (itemId ? allowedDataSources.has(itemId) : false)
        );
      }
      return allowedPages.size === 0 && allowedDataSources.size === 0;
    });

  if (action === "search_content" && Array.isArray(result.body.results)) {
    const results = filterContent(result.body.results);
    return {
      ...result,
      body: {
        ...result.body,
        results,
        count: results.length,
        returnedCount: results.length,
      },
    };
  }

  if (action === "list_pages" && Array.isArray(result.body.pages)) {
    const pages = filterContent(result.body.pages);
    return {
      ...result,
      body: {
        ...result.body,
        pages,
        count: pages.length,
        returnedCount: pages.length,
      },
    };
  }

  if (action === "list_data_sources" && Array.isArray(result.body.dataSources)) {
    const dataSources = filterContent(result.body.dataSources);
    return {
      ...result,
      body: {
        ...result.body,
        dataSources,
        count: dataSources.length,
        returnedCount: dataSources.length,
      },
    };
  }

  if (action === "query_data_source" && Array.isArray(result.body.results)) {
    const results = filterContent(result.body.results);
    return {
      ...result,
      body: {
        ...result.body,
        results,
        count: results.length,
        returnedCount: results.length,
      },
    };
  }

  if (
    action === "get_page" &&
    allowedPages.size > 0 &&
    typeof result.body.normalizedPageId === "string" &&
    !allowedPages.has(result.body.normalizedPageId)
  ) {
    return buildRuleViolation(
      "notion",
      action,
      "Notion page is outside the allowed connector scope.",
      { path: rules.path, pageId: result.body.pageId ?? null },
    );
  }

  if (
    action === "get_data_source" &&
    allowedDataSources.size > 0 &&
    typeof result.body.normalizedDataSourceId === "string" &&
    !allowedDataSources.has(result.body.normalizedDataSourceId)
  ) {
    return buildRuleViolation(
      "notion",
      action,
      "Notion data source is outside the allowed connector scope.",
      { path: rules.path, dataSourceId: result.body.dataSourceId ?? null },
    );
  }

  return result;
}

function enforceConnectorRulesBeforeDispatch(
  provider: string,
  action: string,
  payload: unknown,
  rules: ParsedConnectorRuleDocument | null,
): ConnectorActionResult | null {
  if (!rules) return null;

  const input = getRecordPayload(payload);

  if (provider === "slack" && rules.frontmatter.provider === "slack") {
    const slackRules = rules.frontmatter as SlackConnectorRuleFrontmatter;
    const allowedChannels = normalizeIdSet(slackRules.allowed_channel_ids);
    const blockedChannels = normalizeIdSet(slackRules.blocked_channel_ids);
    const scopedChannel =
      typeof input.channel === "string" && input.channel.trim().length > 0
        ? input.channel.trim()
        : null;

    if (scopedChannel && blockedChannels.has(scopedChannel)) {
      return buildRuleViolation(provider, action, "Slack action targets a blocked channel.", {
        path: rules.path,
        channel: scopedChannel,
      });
    }

    if (scopedChannel && allowedChannels.size > 0 && !allowedChannels.has(scopedChannel)) {
      return buildRuleViolation(provider, action, "Slack action targets a channel outside the allowed scope.", {
        path: rules.path,
        channel: scopedChannel,
      });
    }

    if (
      action === "search_all" &&
      slackRules.strict_channel_scope === true &&
      allowedChannels.size > 0
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Slack search_all is disabled when strict channel scope is enabled because results cannot be constrained to the allowed channels.",
        { path: rules.path },
      );
    }

    if (action === "post_message") {
      if (slackRules.allow_posting === false) {
        return buildRuleViolation(provider, action, "Slack posting is disabled by connector rules.", {
          path: rules.path,
        });
      }
      if (slackRules.posting_requires_approval === true) {
        return buildRuleViolation(
          provider,
          action,
          "Slack posting requires approval according to connector rules.",
          { path: rules.path },
        );
      }
    }
  }

  if (provider === "github" && rules.frontmatter.provider === "github") {
    const githubRules = rules.frontmatter as GithubConnectorRuleFrontmatter;
    const allowedRepos = normalizeRepoSet(githubRules.allowed_repos);
    const blockedRepos = normalizeRepoSet(githubRules.blocked_repos);
    const scopedRepo = resolveRepoFullNameFromPayload(input);

    if (scopedRepo && blockedRepos.has(scopedRepo)) {
      return buildRuleViolation(provider, action, "GitHub action targets a blocked repository.", {
        path: rules.path,
        repo: scopedRepo,
      });
    }

    if (scopedRepo && allowedRepos.size > 0 && !allowedRepos.has(scopedRepo)) {
      return buildRuleViolation(
        provider,
        action,
        "GitHub action targets a repository outside the allowed scope.",
        {
          path: rules.path,
          repo: scopedRepo,
        },
      );
    }

    if (
      action === "list_repos" &&
      githubRules.strict_repo_scope === true &&
      allowedRepos.size === 0 &&
      blockedRepos.size === 0
    ) {
      return buildRuleViolation(
        provider,
        action,
        "GitHub strict repo scope is enabled but no allowed or blocked repositories are configured.",
        { path: rules.path },
      );
    }
  }

  if (provider === "google_ads" && rules.frontmatter.provider === "google_ads") {
    const googleAdsRules = rules.frontmatter as GoogleAdsConnectorRuleFrontmatter;
    const allowedAccounts = normalizeScalarSet(googleAdsRules.account_ids);
    const scopedCustomerId = resolveGoogleAdsCustomerIdFromPayload(input);

    if (scopedCustomerId && allowedAccounts.size > 0 && !allowedAccounts.has(scopedCustomerId)) {
      return buildRuleViolation(
        provider,
        action,
        "Google Ads action targets a customer outside the allowed scope.",
        { path: rules.path, customerId: scopedCustomerId },
      );
    }

    if (
      googleAdsRules.strict_account_scope === true &&
      allowedAccounts.size > 0 &&
      ["get_customer", "list_campaigns", "get_campaign", "list_campaign_metrics"].includes(action) &&
      !scopedCustomerId &&
      !(typeof googleAdsRules.default_account_id === "string" && googleAdsRules.default_account_id.trim().length > 0)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Google Ads strict account scope requires an explicit allowed customer or a configured default account.",
        { path: rules.path },
      );
    }
  }

  if (provider === "linkedin_ads" && rules.frontmatter.provider === "linkedin_ads") {
    const linkedinAdsRules = rules.frontmatter as LinkedinAdsConnectorRuleFrontmatter;
    const allowedAccounts = normalizeLinkedinAdsIdSet(
      linkedinAdsRules.account_ids,
      "account",
    );
    const allowedCampaigns = normalizeLinkedinAdsIdSet(
      linkedinAdsRules.campaign_ids,
      "campaign",
    );
    const scopedAccountId = resolveLinkedinAdsAccountIdFromPayload(input);
    const scopedCampaignId = resolveLinkedinAdsCampaignIdFromPayload(input);

    if (scopedAccountId && allowedAccounts.size > 0 && !allowedAccounts.has(scopedAccountId)) {
      return buildRuleViolation(
        provider,
        action,
        "LinkedIn Ads action targets an account outside the allowed scope.",
        { path: rules.path, accountId: scopedAccountId },
      );
    }

    if (scopedCampaignId && allowedCampaigns.size > 0 && !allowedCampaigns.has(scopedCampaignId)) {
      return buildRuleViolation(
        provider,
        action,
        "LinkedIn Ads action targets a campaign outside the allowed scope.",
        { path: rules.path, campaignId: scopedCampaignId },
      );
    }

    if (
      linkedinAdsRules.strict_account_scope === true &&
      allowedAccounts.size > 0 &&
      ["get_account", "list_campaigns", "get_campaign", "query_analytics"].includes(action) &&
      !scopedAccountId &&
      !(typeof linkedinAdsRules.default_account_id === "string" && linkedinAdsRules.default_account_id.trim().length > 0)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "LinkedIn Ads strict account scope requires an explicit allowed account or a configured default account.",
        { path: rules.path },
      );
    }
  }

  if (provider === "meta_ads" && rules.frontmatter.provider === "meta_ads") {
    const metaAdsRules = rules.frontmatter as MetaAdsConnectorRuleFrontmatter;
    const allowedAccounts = normalizeAdAccountSet(metaAdsRules.account_ids);
    const scopedAdAccountId = resolveMetaAdAccountIdFromPayload(input);

    if (scopedAdAccountId && allowedAccounts.size > 0 && !allowedAccounts.has(scopedAdAccountId)) {
      return buildRuleViolation(
        provider,
        action,
        "Meta Ads action targets an ad account outside the allowed scope.",
        { path: rules.path, adAccountId: scopedAdAccountId },
      );
    }

    if (
      metaAdsRules.strict_account_scope === true &&
      allowedAccounts.size > 0 &&
      ["list_campaigns", "get_campaign", "get_account_insights", "get_campaign_insights"].includes(action) &&
      !scopedAdAccountId &&
      !(typeof metaAdsRules.default_account_id === "string" && metaAdsRules.default_account_id.trim().length > 0)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Meta Ads strict account scope requires an explicit allowed ad account or a configured default account.",
        { path: rules.path },
      );
    }
  }

  if (provider === "tiktok_ads" && rules.frontmatter.provider === "tiktok_ads") {
    const tiktokAdsRules = rules.frontmatter as TiktokAdsConnectorRuleFrontmatter;
    const allowedAdvertisers = normalizeScalarSet(tiktokAdsRules.advertiser_ids);
    const scopedAdvertiserId = resolveTiktokAdvertiserIdFromPayload(input);

    if (
      scopedAdvertiserId &&
      allowedAdvertisers.size > 0 &&
      !allowedAdvertisers.has(scopedAdvertiserId)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "TikTok Ads action targets an advertiser outside the allowed scope.",
        { path: rules.path, advertiserId: scopedAdvertiserId },
      );
    }

    if (
      tiktokAdsRules.strict_account_scope === true &&
      allowedAdvertisers.size > 0 &&
      ["list_campaigns", "get_campaign", "get_account_insights", "get_campaign_insights"].includes(action) &&
      !scopedAdvertiserId &&
      !(typeof tiktokAdsRules.default_advertiser_id === "string" && tiktokAdsRules.default_advertiser_id.trim().length > 0)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "TikTok Ads strict account scope requires an explicit allowed advertiser or a configured default advertiser.",
        { path: rules.path },
      );
    }
  }

  if (provider === "ga4" && rules.frontmatter.provider === "ga4") {
    const ga4Rules = rules.frontmatter as Ga4ConnectorRuleFrontmatter;
    const allowedProperties = normalizeScalarSet(ga4Rules.property_ids);
    const scopedPropertyId = resolveGa4PropertyIdFromPayload(input);

    if (scopedPropertyId && allowedProperties.size > 0 && !allowedProperties.has(scopedPropertyId)) {
      return buildRuleViolation(
        provider,
        action,
        "GA4 action targets a property outside the allowed scope.",
        { path: rules.path, propertyId: scopedPropertyId },
      );
    }

    if (
      ga4Rules.strict_property_scope === true &&
      allowedProperties.size > 0 &&
      ["get_property", "run_report", "list_dimensions_metrics"].includes(action) &&
      !scopedPropertyId &&
      !(
        typeof ga4Rules.default_property_id === "string" &&
        ga4Rules.default_property_id.trim().length > 0
      )
    ) {
      return buildRuleViolation(
        provider,
        action,
        "GA4 strict property scope requires an explicit allowed property or a configured default property.",
        { path: rules.path },
      );
    }
  }

  if (
    provider === "google_search_console" &&
    rules.frontmatter.provider === "google_search_console"
  ) {
    const gscRules = rules.frontmatter as GoogleSearchConsoleConnectorRuleFrontmatter;
    const allowedSites = normalizeGoogleSearchConsoleSiteSet(gscRules.site_urls);
    const scopedSiteUrl = resolveGoogleSearchConsoleSiteUrlFromPayload(input);

    if (scopedSiteUrl && allowedSites.size > 0 && !allowedSites.has(scopedSiteUrl)) {
      return buildRuleViolation(
        provider,
        action,
        "Google Search Console action targets a site outside the allowed scope.",
        { path: rules.path, siteUrl: scopedSiteUrl },
      );
    }

    if (
      gscRules.strict_site_scope === true &&
      allowedSites.size > 0 &&
      ["get_site", "query_search_analytics", "list_sitemaps"].includes(action) &&
      !scopedSiteUrl &&
      !(typeof gscRules.default_site_url === "string" && gscRules.default_site_url.trim().length > 0)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Google Search Console strict site scope requires an explicit allowed site or a configured default site.",
        { path: rules.path },
      );
    }
  }

  if (provider === "ga4" && rules.frontmatter.provider === "ga4") {
    const ga4Rules = rules.frontmatter as Ga4ConnectorRuleFrontmatter;
    const allowedProperties = normalizeScalarSet(ga4Rules.property_ids);
    const scopedPropertyId = resolveGa4PropertyIdFromPayload(input);

    if (scopedPropertyId && allowedProperties.size > 0 && !allowedProperties.has(scopedPropertyId)) {
      return buildRuleViolation(
        provider,
        action,
        "GA4 action targets a property outside the allowed scope.",
        { path: rules.path, propertyId: scopedPropertyId },
      );
    }

    if (
      ga4Rules.strict_property_scope === true &&
      allowedProperties.size > 0 &&
      ["get_property", "run_report", "list_dimensions_metrics"].includes(action) &&
      !scopedPropertyId &&
      !(typeof ga4Rules.default_property_id === "string" && ga4Rules.default_property_id.trim().length > 0)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "GA4 strict property scope requires an explicit allowed property or a configured default property.",
        { path: rules.path },
      );
    }
  }

  if (provider === "hubspot" && rules.frontmatter.provider === "hubspot") {
    const hubspotRules = rules.frontmatter as HubspotConnectorRuleFrontmatter;
    const allowedPortals = normalizeScalarSet(hubspotRules.portal_ids);
    const allowedPipelines = normalizeHubspotPipelineSet(hubspotRules.allowed_pipeline_ids);
    const scopedPortalId = resolveHubspotPortalIdFromPayload(input);
    const scopedPipelineId = resolveHubspotPipelineIdFromPayload(input);

    if (scopedPortalId && allowedPortals.size > 0 && !allowedPortals.has(scopedPortalId)) {
      return buildRuleViolation(
        provider,
        action,
        "HubSpot action targets a portal outside the allowed scope.",
        { path: rules.path, portalId: scopedPortalId },
      );
    }

    if (
      scopedPipelineId &&
      allowedPipelines.size > 0 &&
      !allowedPipelines.has(scopedPipelineId)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "HubSpot action targets a deal pipeline outside the allowed scope.",
        { path: rules.path, pipelineId: scopedPipelineId },
      );
    }
  }

  if (provider === "vercel" && rules.frontmatter.provider === "vercel") {
    const vercelRules = rules.frontmatter as VercelConnectorRuleFrontmatter;
    const allowedTeams = normalizeComparableSet(vercelRules.allowed_teams);
    const allowedProjects = normalizeComparableSet(vercelRules.allowed_projects);
    const productionProjects = normalizeComparableSet(vercelRules.production_projects);
    const scopedTeam = resolveTeamIdentifierFromPayload(input);
    const scopedProject = resolveProjectIdentifierFromPayload(input);
    const target =
      typeof input.target === "string" && input.target.trim().length > 0
        ? input.target.trim().toLowerCase()
        : typeof input.environment === "string" && input.environment.trim().length > 0
          ? input.environment.trim().toLowerCase()
          : null;

    if (scopedTeam && allowedTeams.size > 0 && !allowedTeams.has(scopedTeam)) {
      return buildRuleViolation(
        provider,
        action,
        "Vercel action targets a team outside the allowed scope.",
        { path: rules.path, team: scopedTeam },
      );
    }

    if (scopedProject && allowedProjects.size > 0 && !allowedProjects.has(scopedProject)) {
      return buildRuleViolation(
        provider,
        action,
        "Vercel action targets a project outside the allowed scope.",
        { path: rules.path, project: scopedProject },
      );
    }

    if (
      vercelRules.strict_project_scope === true &&
      allowedProjects.size > 0 &&
      ["list_deployments", "get_deployment", "get_build_logs", "get_runtime_logs", "list_domains"].includes(action) &&
      !scopedProject
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Vercel strict project scope requires an explicit allowed project for this action.",
        { path: rules.path },
      );
    }

    if (
      vercelRules.preview_allowed === false &&
      target &&
      ["preview", "staging"].includes(target)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Vercel preview access is disabled by connector rules.",
        { path: rules.path, target },
      );
    }

    if (vercelRules.log_access_policy === "deny" && ["get_build_logs", "get_runtime_logs"].includes(action)) {
      return buildRuleViolation(
        provider,
        action,
        "Vercel log access is disabled by connector rules.",
        { path: rules.path },
      );
    }

    if (
      vercelRules.log_access_policy === "restricted" &&
      ["get_build_logs", "get_runtime_logs"].includes(action) &&
      !scopedProject &&
      (allowedProjects.size > 0 || productionProjects.size > 0)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Vercel log access requires an explicit project when restricted logging is enabled.",
        { path: rules.path },
      );
    }
  }

  if (provider === "posthog" && rules.frontmatter.provider === "posthog") {
    const posthogRules = rules.frontmatter as PosthogConnectorRuleFrontmatter;
    const allowedProjects = normalizeScalarSet(posthogRules.project_ids);
    const scopedProject = resolvePosthogProjectIdFromPayload(input);

    if (scopedProject && allowedProjects.size > 0 && !allowedProjects.has(scopedProject)) {
      return buildRuleViolation(
        provider,
        action,
        "PostHog action targets a project outside the allowed scope.",
        { path: rules.path, projectId: scopedProject },
      );
    }

    if (
      posthogRules.strict_project_scope === true &&
      allowedProjects.size > 0 &&
      [
        "get_project",
        "list_environments",
        "list_dashboards",
        "get_dashboard",
        "list_insights",
        "get_insight",
        "list_feature_flags",
        "get_feature_flag",
        "run_query",
      ].includes(action) &&
      !scopedProject
    ) {
      return buildRuleViolation(
        provider,
        action,
        "PostHog strict project scope requires an explicit allowed project for this action.",
        { path: rules.path },
      );
    }
  }

  if (provider === "linear" && rules.frontmatter.provider === "linear") {
    const linearRules = rules.frontmatter as LinearConnectorRuleFrontmatter;
    const allowedTeams = normalizeScalarSet(linearRules.allowed_team_ids);
    const allowedProjects = normalizeScalarSet(linearRules.allowed_project_ids);
    const scopedTeam = resolveLinearTeamIdFromPayload(input);
    const scopedProject = resolveLinearProjectIdFromPayload(input);

    if (scopedTeam && allowedTeams.size > 0 && !allowedTeams.has(scopedTeam)) {
      return buildRuleViolation(
        provider,
        action,
        "Linear action targets a team outside the allowed scope.",
        { path: rules.path, teamId: scopedTeam },
      );
    }

    if (scopedProject && allowedProjects.size > 0 && !allowedProjects.has(scopedProject)) {
      return buildRuleViolation(
        provider,
        action,
        "Linear action targets a project outside the allowed scope.",
        { path: rules.path, projectId: scopedProject },
      );
    }

    if (
      linearRules.strict_scope === true &&
      allowedTeams.size > 0 &&
      ["list_issues", "list_cycles"].includes(action) &&
      !scopedTeam &&
      !scopedProject
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Linear strict scope requires an explicit allowed team or project for this action.",
        { path: rules.path },
      );
    }
  }

  if (provider === "notion" && rules.frontmatter.provider === "notion") {
    const notionRules = rules.frontmatter as NotionConnectorRuleFrontmatter;
    const allowedPages = normalizeNotionIdSet(notionRules.allowed_page_ids);
    const allowedDataSources = normalizeNotionIdSet(notionRules.allowed_data_source_ids);
    const scopedPage = resolveNotionPageIdFromPayload(input);
    const scopedDataSource = resolveNotionDataSourceIdFromPayload(input);

    if (scopedPage && allowedPages.size > 0 && !allowedPages.has(scopedPage)) {
      return buildRuleViolation(
        provider,
        action,
        "Notion action targets a page outside the allowed scope.",
        { path: rules.path, pageId: scopedPage },
      );
    }

    if (
      scopedDataSource &&
      allowedDataSources.size > 0 &&
      !allowedDataSources.has(scopedDataSource)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Notion action targets a data source outside the allowed scope.",
        { path: rules.path, dataSourceId: scopedDataSource },
      );
    }
  }

  if (provider === "google_drive" && rules.frontmatter.provider === "google_drive") {
    const driveRules = rules.frontmatter as GoogleDriveConnectorRuleFrontmatter;
    const allowedConnections = normalizeIdSet(driveRules.connection_ids);
    const allowedFolders = normalizeIdSet(driveRules.allowed_folder_ids);
    const blockedFolders = normalizeIdSet(driveRules.blocked_folder_ids);
    const requestedConnectionId =
      typeof input.connectionId === "string" && input.connectionId.trim().length > 0
        ? input.connectionId.trim()
        : null;
    const requestedFolderId =
      typeof input.folderId === "string" && input.folderId.trim().length > 0
        ? input.folderId.trim()
        : null;
    const requestedView =
      typeof input.view === "string" && input.view.trim().length > 0
        ? input.view.trim()
        : null;

    if (
      requestedConnectionId &&
      allowedConnections.size > 0 &&
      !allowedConnections.has(requestedConnectionId)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Google Drive action targets a connection outside the allowed connector scope.",
        { path: rules.path, connectionId: requestedConnectionId },
      );
    }

    if (
      requestedView === "sharedWithMe" &&
      (driveRules.strict_root_scope === true ||
        allowedConnections.size > 0 ||
        allowedFolders.size > 0 ||
        blockedFolders.size > 0)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Google Drive shared-with-me browsing is disabled by connector rules.",
        { path: rules.path },
      );
    }

    if (requestedFolderId && blockedFolders.has(requestedFolderId)) {
      return buildRuleViolation(provider, action, "Google Drive action targets a blocked folder.", {
        path: rules.path,
        folderId: requestedFolderId,
      });
    }

    if (requestedFolderId && allowedFolders.size > 0 && !allowedFolders.has(requestedFolderId)) {
      return buildRuleViolation(
        provider,
        action,
        "Google Drive action targets a folder outside the allowed scope.",
        { path: rules.path, folderId: requestedFolderId },
      );
    }

    if (action === "import_selection" && driveRules.import_requires_approval === true) {
      return buildRuleViolation(
        provider,
        action,
        "Google Drive imports require approval according to connector rules.",
        { path: rules.path },
      );
    }
  }

  if (provider === "custom_http" && rules.frontmatter.provider === "custom_http") {
    const customRules = rules.frontmatter as CustomHttpConnectorRuleFrontmatter;
    const allowedConnections = normalizeIdSet(customRules.allowed_connection_ids);
    const allowedActionNames = normalizeComparableSet(customRules.allowed_action_names);
    const requestedConnectionId = resolveRequestedConnectionIdFromPayload(input);
    const requestedActionName =
      typeof input.actionName === "string" && input.actionName.trim().length > 0
        ? input.actionName.trim().toLowerCase()
        : typeof input.name === "string" && input.name.trim().length > 0
          ? input.name.trim().toLowerCase()
          : null;

    if (
      requestedConnectionId &&
      allowedConnections.size > 0 &&
      !allowedConnections.has(requestedConnectionId)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Custom HTTP action targets a connection outside the allowed scope.",
        { path: rules.path, connectionId: requestedConnectionId },
      );
    }

    if (
      action === "call_action" &&
      requestedActionName &&
      allowedActionNames.size > 0 &&
      !allowedActionNames.has(requestedActionName)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Custom HTTP action targets an operation outside the allowed scope.",
        { path: rules.path, actionName: requestedActionName },
      );
    }
  }

  if (provider === "custom_openapi" && rules.frontmatter.provider === "custom_openapi") {
    const customRules = rules.frontmatter as CustomOpenApiConnectorRuleFrontmatter;
    const allowedConnections = normalizeIdSet(customRules.allowed_connection_ids);
    const allowedActionNames = normalizeComparableSet(customRules.allowed_action_names);
    const requestedConnectionId = resolveRequestedConnectionIdFromPayload(input);
    const requestedActionName =
      typeof input.actionName === "string" && input.actionName.trim().length > 0
        ? input.actionName.trim().toLowerCase()
        : typeof input.name === "string" && input.name.trim().length > 0
          ? input.name.trim().toLowerCase()
          : null;

    if (
      requestedConnectionId &&
      allowedConnections.size > 0 &&
      !allowedConnections.has(requestedConnectionId)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Custom OpenAPI action targets a connection outside the allowed scope.",
        { path: rules.path, connectionId: requestedConnectionId },
      );
    }

    if (
      action === "call_action" &&
      requestedActionName &&
      allowedActionNames.size > 0 &&
      !allowedActionNames.has(requestedActionName)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Custom OpenAPI action targets an operation outside the allowed scope.",
        { path: rules.path, actionName: requestedActionName },
      );
    }
  }

  if (provider === "custom_mcp" && rules.frontmatter.provider === "custom_mcp") {
    const customRules = rules.frontmatter as CustomMcpConnectorRuleFrontmatter;
    const allowedConnections = normalizeIdSet(customRules.allowed_connection_ids);
    const allowedToolNames = normalizeComparableSet(customRules.allowed_tool_names);
    const requestedConnectionId = resolveRequestedConnectionIdFromPayload(input);
    const requestedToolName =
      typeof input.toolName === "string" && input.toolName.trim().length > 0
        ? input.toolName.trim().toLowerCase()
        : null;

    if (
      requestedConnectionId &&
      allowedConnections.size > 0 &&
      !allowedConnections.has(requestedConnectionId)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Custom MCP action targets a connection outside the allowed scope.",
        { path: rules.path, connectionId: requestedConnectionId },
      );
    }

    if (
      action === "call_tool" &&
      requestedToolName &&
      allowedToolNames.size > 0 &&
      !allowedToolNames.has(requestedToolName)
    ) {
      return buildRuleViolation(
        provider,
        action,
        "Custom MCP action targets a tool outside the allowed scope.",
        { path: rules.path, toolName: requestedToolName },
      );
    }
  }

  return null;
}

function attachConnectorRuleSummary(
  result: ConnectorActionResult,
  summary: ConnectorRuleSummary,
): ConnectorActionResult {
  return {
    ...result,
    body: {
      ...result.body,
      connectorRule: summary,
    },
  };
}

function applyCustomHttpRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "custom_http") {
    return result;
  }

  const customRules = rules.frontmatter as CustomHttpConnectorRuleFrontmatter;
  const allowedActionNames = normalizeComparableSet(customRules.allowed_action_names);
  if (action !== "list_actions" || !Array.isArray(result.body.actions) || allowedActionNames.size === 0) {
    return result;
  }

  const actions = result.body.actions.filter((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string") return false;
    return allowedActionNames.has(entry.name.trim().toLowerCase());
  });

  return {
    ...result,
    body: {
      ...result.body,
      actions,
      count: actions.length,
      returnedCount: actions.length,
    },
  };
}

function applyCustomOpenApiRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "custom_openapi") {
    return result;
  }

  const customRules = rules.frontmatter as CustomOpenApiConnectorRuleFrontmatter;
  const allowedActionNames = normalizeComparableSet(customRules.allowed_action_names);
  if (action !== "list_actions" || !Array.isArray(result.body.actions) || allowedActionNames.size === 0) {
    return result;
  }

  const actions = result.body.actions.filter((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string") return false;
    return allowedActionNames.has(entry.name.trim().toLowerCase());
  });

  return {
    ...result,
    body: {
      ...result.body,
      actions,
      count: actions.length,
      returnedCount: actions.length,
    },
  };
}

function applyCustomMcpRuleFilter(
  action: string,
  result: ConnectorActionResult,
  rules: ParsedConnectorRuleDocument,
): ConnectorActionResult {
  if (rules.frontmatter.provider !== "custom_mcp") {
    return result;
  }

  const customRules = rules.frontmatter as CustomMcpConnectorRuleFrontmatter;
  const allowedToolNames = normalizeComparableSet(customRules.allowed_tool_names);
  if (action !== "list_tools" || !Array.isArray(result.body.tools) || allowedToolNames.size === 0) {
    return result;
  }

  const tools = result.body.tools.filter((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string") return false;
    return allowedToolNames.has(entry.name.trim().toLowerCase());
  });

  return {
    ...result,
    body: {
      ...result.body,
      tools,
      count: tools.length,
      returnedCount: tools.length,
    },
  };
}

function applyConnectorRuleDefaultsToPayload(
  provider: string,
  payload: unknown,
  rules: ParsedConnectorRuleDocument | null,
) {
  if (!rules || !isRecord(payload)) {
    return payload;
  }

  if (provider === "google_ads" && rules.frontmatter.provider === "google_ads") {
    const googleAdsRules = rules.frontmatter as GoogleAdsConnectorRuleFrontmatter;
    const defaultAccountId =
      typeof googleAdsRules.default_account_id === "string"
        ? googleAdsRules.default_account_id.trim()
        : "";
    if (defaultAccountId && !resolveGoogleAdsCustomerIdFromPayload(payload)) {
      return { ...payload, customerId: defaultAccountId };
    }
  }

  if (provider === "linkedin_ads" && rules.frontmatter.provider === "linkedin_ads") {
    const linkedinAdsRules = rules.frontmatter as LinkedinAdsConnectorRuleFrontmatter;
    const defaultAccountId =
      typeof linkedinAdsRules.default_account_id === "string"
        ? linkedinAdsRules.default_account_id.trim()
        : "";
    if (defaultAccountId && !resolveLinkedinAdsAccountIdFromPayload(payload)) {
      return { ...payload, accountId: defaultAccountId };
    }
  }

  if (provider === "meta_ads" && rules.frontmatter.provider === "meta_ads") {
    const metaAdsRules = rules.frontmatter as MetaAdsConnectorRuleFrontmatter;
    const defaultAccountId =
      typeof metaAdsRules.default_account_id === "string"
        ? metaAdsRules.default_account_id.trim()
        : "";
    if (defaultAccountId && !resolveMetaAdAccountIdFromPayload(payload)) {
      return { ...payload, adAccountId: defaultAccountId };
    }
  }

  if (provider === "tiktok_ads" && rules.frontmatter.provider === "tiktok_ads") {
    const tiktokAdsRules = rules.frontmatter as TiktokAdsConnectorRuleFrontmatter;
    const defaultAdvertiserId =
      typeof tiktokAdsRules.default_advertiser_id === "string"
        ? tiktokAdsRules.default_advertiser_id.trim()
        : "";
    if (defaultAdvertiserId && !resolveTiktokAdvertiserIdFromPayload(payload)) {
      return { ...payload, advertiserId: defaultAdvertiserId };
    }
  }

  if (provider === "ga4" && rules.frontmatter.provider === "ga4") {
    const ga4Rules = rules.frontmatter as Ga4ConnectorRuleFrontmatter;
    const defaultPropertyId =
      typeof ga4Rules.default_property_id === "string"
        ? ga4Rules.default_property_id.trim()
        : "";
    if (defaultPropertyId && !resolveGa4PropertyIdFromPayload(payload)) {
      return { ...payload, propertyId: defaultPropertyId };
    }
  }

  if (
    provider === "google_search_console" &&
    rules.frontmatter.provider === "google_search_console"
  ) {
    const gscRules = rules.frontmatter as GoogleSearchConsoleConnectorRuleFrontmatter;
    const defaultSiteUrl =
      typeof gscRules.default_site_url === "string"
        ? gscRules.default_site_url.trim()
        : "";
    if (defaultSiteUrl && !resolveGoogleSearchConsoleSiteUrlFromPayload(payload)) {
      return { ...payload, siteUrl: defaultSiteUrl };
    }
  }

  return payload;
}

export function isConnectorHubError(err: unknown): err is ConnectorHubError {
  return err instanceof ConnectorHubError;
}

export function summarizeConnectorMetadata(
  provider: string,
  metadata: Record<string, unknown> | null | undefined,
) {
  if (provider === "telegram") {
    const normalized = coerceTelegramConnectionMetadata(metadata ?? {});
    const enabledChatCount = normalized.syncedChats.filter((chat) => chat.enabled).length;
    return {
      phone: normalized.phone,
      totalChats: normalized.syncedChats.length,
      enabledChatCount,
    };
  }

  if (provider === "google_drive") {
    const normalized = coerceGoogleDriveConnectionMetadata(metadata ?? {});
    return {
      connectionLabel: normalized.connectionLabel ?? null,
      rootFolderId: normalized.rootFolderId ?? null,
      rootDriveId: normalized.rootDriveId ?? null,
      rootBrowseMode: normalized.rootBrowseMode ?? null,
      rootPath: normalized.rootPath ?? null,
      watchedFolders: normalized.watchedFolders.map((folder) => ({
        folderId: folder.folderId,
        name: folder.name,
        enabled: folder.enabled,
        driveId: folder.driveId ?? null,
        path: folder.path ?? null,
      })),
      autoImportFrequency: normalized.autoImportFrequency,
      autoImportLastRunAt: normalized.autoImportLastRunAt ?? null,
      autoImportLastQueued: normalized.autoImportLastQueued ?? 0,
      autoImportLastSkipped: normalized.autoImportLastSkipped ?? 0,
      autoImportLastError: normalized.autoImportLastError ?? null,
    };
  }

  if (provider === "odoo") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    const syncModels = Array.isArray(source.syncModels)
      ? source.syncModels.filter((value): value is string => typeof value === "string")
      : [];
    return {
      syncModels,
      lastSyncAt:
        source.lastSyncAt && typeof source.lastSyncAt === "object"
          ? source.lastSyncAt
          : {},
    };
  }

  if (provider === "bamboohr") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      subdomain: typeof source.subdomain === "string" ? source.subdomain : null,
    };
  }

  if (provider === "confluence") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      siteUrl: typeof source.siteUrl === "string" ? source.siteUrl : null,
      siteName: typeof source.siteName === "string" ? source.siteName : null,
      currentUserEmail:
        typeof source.currentUserEmail === "string" ? source.currentUserEmail : null,
    };
  }

  if (provider === "ms_graph") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      tenantId: typeof source.tenantId === "string" ? source.tenantId : null,
      organizationName:
        typeof source.organizationName === "string" ? source.organizationName : null,
    };
  }

  if (provider === "dynamics_bc") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      environmentName:
        typeof source.environmentName === "string" ? source.environmentName : null,
      companyName: typeof source.companyName === "string" ? source.companyName : null,
      companyId: typeof source.companyId === "string" ? source.companyId : null,
    };
  }

  if (provider === "payhawk") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      authMode: typeof source.authMode === "string" ? source.authMode : null,
    };
  }

  if (provider === "zendesk") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      subdomain: typeof source.subdomain === "string" ? source.subdomain : null,
      currentUserEmail:
        typeof source.currentUserEmail === "string" ? source.currentUserEmail : null,
      currentUserName:
        typeof source.currentUserName === "string" ? source.currentUserName : null,
    };
  }

  if (provider === "linkedin_mcp") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      serverUrl: typeof source.serverUrl === "string" ? source.serverUrl : null,
      toolCount: typeof source.toolCount === "number" ? source.toolCount : 0,
    };
  }

  if (provider === "google_ads") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      accessibleCustomerCount:
        typeof source.accessibleCustomerCount === "number"
          ? source.accessibleCustomerCount
          : 0,
      defaultCustomerId:
        typeof source.defaultCustomerId === "string" ? source.defaultCustomerId : null,
      defaultCustomerName:
        typeof source.defaultCustomerName === "string" ? source.defaultCustomerName : null,
      defaultCustomerCurrencyCode:
        typeof source.defaultCustomerCurrencyCode === "string"
          ? source.defaultCustomerCurrencyCode
          : null,
    };
  }

  if (provider === "linkedin_ads") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      apiVersion: typeof source.apiVersion === "string" ? source.apiVersion : null,
      accessibleAccountCount:
        typeof source.accessibleAccountCount === "number"
          ? source.accessibleAccountCount
          : 0,
      defaultAccountId:
        typeof source.defaultAccountId === "string" ? source.defaultAccountId : null,
      defaultAccountName:
        typeof source.defaultAccountName === "string" ? source.defaultAccountName : null,
      defaultAccountCurrency:
        typeof source.defaultAccountCurrency === "string" ? source.defaultAccountCurrency : null,
    };
  }

  if (provider === "meta_ads") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      accessibleAdAccountCount:
        typeof source.accessibleAdAccountCount === "number"
          ? source.accessibleAdAccountCount
          : 0,
      defaultAdAccountId:
        typeof source.defaultAdAccountId === "string" ? source.defaultAdAccountId : null,
      defaultAdAccountName:
        typeof source.defaultAdAccountName === "string"
          ? source.defaultAdAccountName
          : null,
      defaultAdAccountCurrency:
        typeof source.defaultAdAccountCurrency === "string"
          ? source.defaultAdAccountCurrency
          : null,
    };
  }

  if (provider === "tiktok_ads") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      accessibleAdvertiserCount:
        typeof source.accessibleAdvertiserCount === "number"
          ? source.accessibleAdvertiserCount
          : 0,
      defaultAdvertiserId:
        typeof source.defaultAdvertiserId === "string"
          ? source.defaultAdvertiserId
          : null,
      defaultAdvertiserName:
        typeof source.defaultAdvertiserName === "string"
          ? source.defaultAdvertiserName
          : null,
      defaultAdvertiserCurrency:
        typeof source.defaultAdvertiserCurrency === "string"
          ? source.defaultAdvertiserCurrency
          : null,
    };
  }

  if (provider === "ga4") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      adminBaseUrl:
        typeof source.adminBaseUrl === "string" ? source.adminBaseUrl : null,
      dataBaseUrl:
        typeof source.dataBaseUrl === "string" ? source.dataBaseUrl : null,
      accessiblePropertyCount:
        typeof source.accessiblePropertyCount === "number"
          ? source.accessiblePropertyCount
          : 0,
      defaultPropertyId:
        typeof source.defaultPropertyId === "string"
          ? source.defaultPropertyId
          : null,
      defaultPropertyDisplayName:
        typeof source.defaultPropertyDisplayName === "string"
          ? source.defaultPropertyDisplayName
          : null,
      defaultPropertyCurrencyCode:
        typeof source.defaultPropertyCurrencyCode === "string"
          ? source.defaultPropertyCurrencyCode
          : null,
      defaultPropertyTimeZone:
        typeof source.defaultPropertyTimeZone === "string"
          ? source.defaultPropertyTimeZone
          : null,
    };
  }

  if (provider === "google_search_console") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      accessibleSiteCount:
        typeof source.accessibleSiteCount === "number"
          ? source.accessibleSiteCount
          : 0,
      defaultSiteUrl:
        typeof source.defaultSiteUrl === "string" ? source.defaultSiteUrl : null,
      defaultSitePermissionLevel:
        typeof source.defaultSitePermissionLevel === "string"
          ? source.defaultSitePermissionLevel
          : null,
    };
  }

  if (provider === "hubspot") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      portalId: typeof source.portalId === "string" ? source.portalId : null,
      portalName: typeof source.portalName === "string" ? source.portalName : null,
      portalTimeZone:
        typeof source.portalTimeZone === "string" ? source.portalTimeZone : null,
      portalUtcOffset:
        typeof source.portalUtcOffset === "number" ? source.portalUtcOffset : null,
      portalDomain:
        typeof source.portalDomain === "string" ? source.portalDomain : null,
    };
  }

  if (provider === "custom_http") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      connectionLabel:
        typeof source.connectionLabel === "string" ? source.connectionLabel : null,
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      actionCount:
        typeof source.actionCount === "number" ? source.actionCount : 0,
      validationMode:
        typeof source.validationMode === "string" ? source.validationMode : null,
    };
  }

  if (provider === "custom_openapi") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      connectionLabel:
        typeof source.connectionLabel === "string" ? source.connectionLabel : null,
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      importedFromSpecUrl:
        typeof source.importedFromSpecUrl === "string"
          ? source.importedFromSpecUrl
          : null,
      importedOperationCount:
        typeof source.importedOperationCount === "number"
          ? source.importedOperationCount
          : 0,
    };
  }

  if (provider === "custom_mcp") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      connectionLabel:
        typeof source.connectionLabel === "string" ? source.connectionLabel : null,
      serverUrl: typeof source.serverUrl === "string" ? source.serverUrl : null,
      allowedToolCount:
        typeof source.allowedToolCount === "number" ? source.allowedToolCount : 0,
      discoveredToolCount:
        typeof source.discoveredToolCount === "number"
          ? source.discoveredToolCount
          : 0,
    };
  }

  if (provider === "github") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      login: typeof source.login === "string" ? source.login : null,
      name: typeof source.name === "string" ? source.name : null,
      webUrl: typeof source.webUrl === "string" ? source.webUrl : null,
    };
  }

  if (provider === "vercel") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      username: typeof source.username === "string" ? source.username : null,
      email: typeof source.email === "string" ? source.email : null,
      accessibleTeamCount:
        typeof source.accessibleTeamCount === "number"
          ? source.accessibleTeamCount
          : 0,
      defaultTeamId:
        typeof source.defaultTeamId === "string" ? source.defaultTeamId : null,
      defaultTeamSlug:
        typeof source.defaultTeamSlug === "string" ? source.defaultTeamSlug : null,
    };
  }

  if (provider === "linear") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      viewerId: typeof source.viewerId === "string" ? source.viewerId : null,
      viewerName: typeof source.viewerName === "string" ? source.viewerName : null,
      viewerEmail:
        typeof source.viewerEmail === "string" ? source.viewerEmail : null,
      accessibleTeamCount:
        typeof source.accessibleTeamCount === "number"
          ? source.accessibleTeamCount
          : 0,
      defaultTeamId:
        typeof source.defaultTeamId === "string" ? source.defaultTeamId : null,
      defaultProjectId:
        typeof source.defaultProjectId === "string" ? source.defaultProjectId : null,
    };
  }

  if (provider === "notion") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      botId: typeof source.botId === "string" ? source.botId : null,
      botName: typeof source.botName === "string" ? source.botName : null,
      workspaceId:
        typeof source.workspaceId === "string" ? source.workspaceId : null,
      workspaceName:
        typeof source.workspaceName === "string" ? source.workspaceName : null,
    };
  }

  if (provider === "posthog") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      organizationCount:
        typeof source.organizationCount === "number" ? source.organizationCount : 0,
      projectCount:
        typeof source.projectCount === "number" ? source.projectCount : 0,
      defaultOrganizationId:
        typeof source.defaultOrganizationId === "string"
          ? source.defaultOrganizationId
          : null,
      defaultProjectId:
        typeof source.defaultProjectId === "string" ? source.defaultProjectId : null,
      defaultEnvironmentId:
        typeof source.defaultEnvironmentId === "string"
          ? source.defaultEnvironmentId
          : null,
    };
  }

  if (provider === "metabase") {
    const source =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>)
        : {};
    return {
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : null,
      authMode: typeof source.authMode === "string" ? source.authMode : null,
      accessibleCollectionCount:
        typeof source.accessibleCollectionCount === "number"
          ? source.accessibleCollectionCount
          : 0,
    };
  }

  return metadata ?? {};
}

export function getAgentConnectorCatalog(): AgentConnectorCatalogEntry[] {
  const hubCatalog = getConnectorHubCatalog();
  const entries: AgentConnectorCatalogEntry[] = hubCatalog.map((entry) => ({
    provider: entry.provider,
    label: getRequiredProviderDefinition(entry.provider).label,
    description: getRequiredProviderDefinition(entry.provider).description,
    capabilities: getConnectorCapabilities(entry.provider),
    actions: entry.actions,
    surface: "hub_legacy",
    ruleFilePath: getConnectorRuleFilePath(entry.provider),
  }));

  entries.push(
    ...LOCAL_CONNECTOR_DEFINITIONS.map((definition) =>
      buildCatalogEntry(
        definition.provider,
        definition.actions.map((action) => ({
          name: action.name,
          description: action.description,
        })),
      ),
    ),
    buildCatalogEntry("email_ingest", []),
  );

  return entries;
}

export function listSupportedConnectorActions(provider: string): string[] {
  const entry = getAgentConnectorCatalog().find((item) => item.provider === provider);
  return entry ? entry.actions.map((action) => action.name) : [];
}

export function resolveConnectorAction(provider: string, action: string) {
  const normalizedProvider = provider.trim();
  const normalizedAction = action.trim().toLowerCase();
  const aliases = CONNECTOR_ACTION_ALIASES[normalizedProvider] ?? {};
  const resolvedAction = aliases[normalizedAction] ?? normalizedAction;

  return {
    requestedAction: normalizedAction,
    resolvedAction,
    aliasUsed: resolvedAction !== normalizedAction ? normalizedAction : null,
    supportedActions: listSupportedConnectorActions(normalizedProvider),
  };
}

export async function listAgentConnectors(input: {
  companyId: string;
  companySlug?: string | null;
  companyDbPort?: number | null;
  allowedConnectorScopes?: readonly string[] | null;
}) {
  const context = await resolveConnectorCompanyContext(input);
  const connections = filterConnectorProvidersByScopes(
    await listConnections(input.companyId),
    input.allowedConnectorScopes,
  );
  const catalog = filterConnectorProvidersByScopes(
    getAgentConnectorCatalog(),
    input.allowedConnectorScopes,
  );
  const hubCatalog = filterConnectorProvidersByScopes(
    getConnectorHubCatalog(),
    input.allowedConnectorScopes,
  );
  const providers = new Set<string>([
    ...connections.map((connection) => connection.provider),
    ...hubCatalog.map((entry) => entry.provider),
  ]);
  const ruleEntries = await Promise.all(
    Array.from(providers).map(async (provider) => [
      provider,
      await loadConnectorRuleDocument(provider, context),
    ] as const),
  );
  const ruleSummaryByProvider = new Map(ruleEntries);

  return {
    connectors: connections.map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      status: connection.status,
      lastSyncAt: connection.lastSyncAt,
      lastError: connection.lastError,
      metadata: summarizeConnectorMetadata(connection.provider, connection.metadata),
      capabilities: getConnectorCapabilities(connection.provider),
      rules:
        ruleSummaryByProvider.get(connection.provider)?.summary ?? {
          path: getConnectorRuleFilePath(connection.provider),
          exists: false,
          provider: connection.provider,
          policyMode: "advisory",
          strict: false,
          notes: null,
          restrictionSummary: {},
        },
    })),
    catalog: catalog.map((entry) => ({
      ...entry,
      rules:
        ruleSummaryByProvider.get(entry.provider)?.summary ?? {
          path: entry.ruleFilePath,
          exists: false,
          provider: entry.provider,
          policyMode: "advisory",
          strict: false,
          notes: null,
          restrictionSummary: {},
        },
    })),
    hubCatalog,
  };
}

async function resolveRequestedGoogleDriveId(
  accessToken: string,
  folderId?: string,
  driveId?: string,
): Promise<string | undefined> {
  if (driveId || !folderId || folderId === "root") {
    return driveId;
  }

  const metadata = await getDriveItemMetadata(accessToken, folderId);
  return metadata.driveId ?? undefined;
}

async function runTelegramAction(
  companyId: string,
  action: string,
  input: unknown,
) {
  const connection = await getLatestConnectionCredentialsByProvider(companyId, "telegram");
  if (!connection) {
    return {
      status: 404,
      body: { error: "telegram is not connected for this company" },
    };
  }

  const metadata = coerceTelegramConnectionMetadata(connection.metadata);

  if (action === "list_chats") {
    const session = typeof connection.credentials.session === "string"
      ? connection.credentials.session
      : "";
    if (!session) {
      return {
        status: 400,
        body: { error: "Telegram session is missing" },
      };
    }

    const payload =
      input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const limit = normalizePageSize(payload.limit, {
      defaultValue: DEFAULT_TELEGRAM_CHAT_PAGE_SIZE,
      maxValue: MAX_TELEGRAM_CHAT_PAGE_SIZE,
    });
    const offset = normalizeOffset(payload.offset);
    const query =
      typeof payload.query === "string" && payload.query.trim().length > 0
        ? payload.query.trim().toLowerCase()
        : null;
    const enabledOnly = payload.enabledOnly === true;

    let client;
    try {
      client = createTelegramClient(session);
      await client.connect();
      const dialogs = await listTelegramDialogs(client);
      const enabledByChatId = new Map(
        metadata.syncedChats.map((chat) => [chat.chatId, chat]),
      );
      const chats = dialogs
        .map((dialog) => {
          const configured = enabledByChatId.get(dialog.chatId);
          return {
            ...dialog,
            enabled: configured?.enabled ?? false,
            lastSyncedMessageId: configured?.lastSyncedMessageId ?? 0,
          };
        })
        .filter((dialog) => {
          if (enabledOnly && !dialog.enabled) {
            return false;
          }
          if (query && !dialog.title.toLowerCase().includes(query)) {
            return false;
          }
          return true;
        });
      const pagedChats = chats.slice(offset, offset + limit);

      return {
        status: 200,
        body: {
          provider: "telegram",
          action,
          phone: metadata.phone,
          totalChats: chats.length,
          returnedChats: pagedChats.length,
          limit,
          offset,
          nextOffset: offset + pagedChats.length < chats.length ? offset + pagedChats.length : null,
          hasMore: offset + pagedChats.length < chats.length,
          query,
          enabledOnly,
          chats: pagedChats,
        },
      };
    } catch (err) {
      return {
        status: 502,
        body: { error: getTelegramErrorMessage(err) },
      };
    } finally {
      await client?.disconnect().catch(() => {});
    }
  }

  if (action === "get_recent_messages") {
    const payload =
      input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const chatId =
      typeof payload.chatId === "string" && payload.chatId.trim().length > 0
        ? payload.chatId.trim()
        : null;
    const limit = normalizePageSize(payload.limit, {
      defaultValue: DEFAULT_TELEGRAM_MESSAGE_PAGE_SIZE,
      maxValue: MAX_TELEGRAM_MESSAGE_PAGE_SIZE,
    });
    const offset = normalizeOffset(payload.offset);

    if (!chatId) {
      return {
        status: 400,
        body: { error: "input.chatId is required" },
      };
    }

    const rows = await db
      .select({
        id: communicationMessages.id,
        providerMessageId: communicationMessages.providerMessageId,
        providerChatId: communicationMessages.providerChatId,
        providerThreadId: communicationMessages.providerThreadId,
        senderName: communicationMessages.senderName,
        senderAddress: communicationMessages.senderAddress,
        content: communicationMessages.content,
        receivedAt: communicationMessages.receivedAt,
      })
      .from(communicationMessages)
      .where(
        and(
          eq(communicationMessages.companyId, companyId),
          eq(communicationMessages.provider, "telegram"),
          eq(communicationMessages.providerChatId, chatId),
        ),
      )
      .orderBy(desc(communicationMessages.receivedAt))
      .offset(offset)
      .limit(limit + 1);

    const messages = rows.slice(0, limit);
    const hasMore = rows.length > limit;

    return {
      status: 200,
      body: {
        provider: "telegram",
        action,
        chatId,
        count: messages.length,
        returnedMessages: messages.length,
        limit,
        offset,
        nextOffset: hasMore ? offset + messages.length : null,
        hasMore,
        messages,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported telegram action: ${action}` },
  };
}

async function runOdooAction(
  companyId: string,
  action: string,
  input: unknown,
) {
  try {
    const connection = await getLatestConnectionCredentialsByProvider(companyId, "odoo");
    if (!connection) {
      return {
        status: 404,
        body: { error: "odoo is not connected for this company" },
      };
    }

    const portalUrl = connection.credentials.portalUrl;
    const token = connection.credentials.token;
    if (typeof portalUrl !== "string" || typeof token !== "string") {
      return {
        status: 400,
        body: { error: "Odoo credentials are incomplete" },
      };
    }

    const payload =
      input && typeof input === "object" ? (input as Record<string, unknown>) : {};

    if (action === "search_records") {
      const model =
        typeof payload.model === "string" && payload.model.trim().length > 0
          ? payload.model.trim()
          : null;
      const domain = Array.isArray(payload.domain) ? payload.domain : null;
      const fields = Array.isArray(payload.fields)
        ? payload.fields.filter((value): value is string => typeof value === "string")
        : undefined;
      const limit =
        typeof payload.limit === "number" && Number.isInteger(payload.limit)
          ? Math.max(payload.limit, 1)
          : undefined;
      const offset =
        typeof payload.offset === "number" && Number.isInteger(payload.offset)
          ? Math.max(payload.offset, 0)
          : undefined;

      if (!model || !domain) {
        return {
          status: 400,
          body: { error: "input.model and input.domain are required" },
        };
      }

      const results = await withOdooClient(portalUrl, token, async (client) =>
        genericSearch(client.executeMethod.bind(client), {
          model,
          domain,
          fields,
          limit,
          offset,
        }),
      );

      return {
        status: 200,
        body: {
          provider: "odoo",
          action,
          model,
          count: results.length,
          ...(typeof limit === "number" ? { limit } : {}),
          ...(typeof offset === "number" ? { offset } : {}),
          hasMore: typeof limit === "number" ? results.length === limit : false,
          nextOffset:
            typeof limit === "number" && results.length === limit
              ? (offset ?? 0) + results.length
              : null,
          results,
        },
      };
    }

    if (action === "get_record") {
      const model =
        typeof payload.model === "string" && payload.model.trim().length > 0
          ? payload.model.trim()
          : null;
      const recordId =
        typeof payload.recordId === "number" && Number.isInteger(payload.recordId)
          ? payload.recordId
          : null;

      if (!model || recordId === null) {
        return {
          status: 400,
          body: { error: "input.model and input.recordId are required" },
        };
      }

      const record = await withOdooClient(portalUrl, token, async (client) =>
        fetchRecordById(client.executeMethod.bind(client), model, recordId),
      );

      return {
        status: 200,
        body: {
          provider: "odoo",
          action,
          model,
          recordId,
          found: Boolean(record),
          record,
        },
      };
    }

    return {
      status: 400,
      body: { error: `Unsupported odoo action: ${action}` },
    };
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim().length > 0
        ? err.message
        : "Odoo request failed";
    return {
      status: 502,
      body: { error: message },
    };
  }
}

async function runGoogleDriveAction(
  companyId: string,
  action: string,
  input: unknown,
) {
  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const connectionId =
    typeof payload.connectionId === "string" && payload.connectionId.trim().length > 0
      ? payload.connectionId.trim()
      : undefined;
  const pageSize =
    typeof payload.pageSize === "number" && Number.isInteger(payload.pageSize)
      ? Math.max(payload.pageSize, 1)
      : 20;
  const connection = await resolveGoogleDriveConnection(companyId, { connectionId });
  const accessToken = await getGoogleDriveAccessTokenForConnection(connection);
  const metadata = coerceGoogleDriveConnectionMetadata(connection.metadata);
  const root = getGoogleDriveRootSelection(metadata);

  if (action === "list_files") {
    const query =
      typeof payload.query === "string" && payload.query.trim().length > 0
        ? payload.query.trim()
        : undefined;
    const folderId =
      typeof payload.folderId === "string" && payload.folderId.trim().length > 0
        ? payload.folderId.trim()
        : undefined;
    const driveId =
      typeof payload.driveId === "string" && payload.driveId.trim().length > 0
        ? payload.driveId.trim()
        : undefined;
    const pageToken =
      typeof payload.pageToken === "string" && payload.pageToken.trim().length > 0
        ? payload.pageToken.trim()
        : undefined;
    const view = payload.view === "sharedWithMe" ? "sharedWithMe" : undefined;
    const effectiveDriveId =
      view === "sharedWithMe"
        ? undefined
        : await resolveRequestedGoogleDriveId(accessToken, folderId, driveId);

    if (root) {
      if (view === "sharedWithMe") {
        return {
          status: 400,
          body: {
            provider: "google_drive",
            action,
            connectionId: connection.id,
            error:
              "Shared with me view is unavailable after a company root folder is configured.",
          },
        };
      }

      const requestedFolderId = folderId ?? root.folderId;
      const requestedDriveId = effectiveDriveId ?? root.driveId;

      if (requestedFolderId !== root.folderId) {
        const allowed = await isDriveItemWithinRoot(
          accessToken,
          requestedFolderId,
          root,
        );
        if (!allowed) {
          return {
            status: 400,
            body: {
              provider: "google_drive",
              action,
              connectionId: connection.id,
              error:
                "Requested folder is outside the configured Google Drive root for this connection.",
            },
          };
        }
      }

      const result = query
        ? await (async () => {
            const explicitOffset = normalizeOffset(payload.offset);
            const offset =
              explicitOffset > 0
                ? explicitOffset
                : normalizePageOffset(payload.page, pageSize);
            const files = (await listFolderFilesRecursive(accessToken, requestedFolderId, {
              driveId: root.isSharedDriveRoot
                ? root.driveId
                : requestedDriveId ?? undefined,
              rootPath: root.path ?? undefined,
            }))
              .filter((file) =>
                file.name.toLowerCase().includes(query.toLowerCase()),
              )
              .sort((a, b) =>
                (a.path ?? a.name).localeCompare(b.path ?? b.name, undefined, {
                  numeric: true,
                  sensitivity: "base",
                }),
              );
            const pagedFiles = files.slice(offset, offset + pageSize);
            const nextOffset =
              offset + pagedFiles.length < files.length ? offset + pagedFiles.length : null;

            return {
              files: pagedFiles,
              count: files.length,
              returnedCount: pagedFiles.length,
              pageSize,
              offset,
              hasMore: nextOffset !== null,
              nextOffset,
              nextPageToken: undefined,
            };
          })()
        : await listDriveFolder(
            accessToken,
            root.isSharedDriveRoot && requestedFolderId === root.folderId
              ? "root"
              : requestedFolderId,
            {
              pageToken,
              pageSize,
              driveId: root.isSharedDriveRoot
                ? root.driveId
                : requestedDriveId ?? undefined,
            },
          );

      return {
        status: 200,
        body: {
          provider: "google_drive",
          action,
          connectionId: connection.id,
          root,
          ...result,
        },
      };
    }

    const result = query
      ? await listDriveFiles(accessToken, {
          query,
          pageToken,
          pageSize,
          driveId: effectiveDriveId,
        })
      : view === "sharedWithMe"
        ? await listSharedWithMe(accessToken, {
            pageToken,
            pageSize,
          })
      : folderId || driveId
        ? await listDriveFolder(accessToken, folderId ?? "root", {
            pageToken,
            pageSize,
            driveId: effectiveDriveId,
          })
        : await listDriveRoot(accessToken, {
            pageToken,
            pageSize,
          });

    return {
      status: 200,
      body: {
        provider: "google_drive",
        action,
        connectionId: connection.id,
        root: null,
        ...result,
      },
    };
  }

  if (action === "get_file_metadata") {
    const fileId =
      typeof payload.fileId === "string" && payload.fileId.trim().length > 0
        ? payload.fileId.trim()
        : "";
    if (!fileId) {
      return {
        status: 400,
        body: { error: "input.fileId is required" },
      };
    }

    if (root) {
      const allowed = await isDriveItemWithinRoot(accessToken, fileId, root);
      if (!allowed) {
        return {
          status: 400,
          body: {
            provider: "google_drive",
            action,
            connectionId: connection.id,
            fileId,
            error:
              "Requested file is outside the configured Google Drive root for this connection.",
          },
        };
      }
    }

    const metadata = await getDriveItemMetadata(accessToken, fileId);

    return {
      status: 200,
      body: {
        provider: "google_drive",
        action,
        connectionId: connection.id,
        fileId,
        root,
        metadata,
      },
    };
  }

  if (action === "download_file") {
    const fileId =
      typeof payload.fileId === "string" && payload.fileId.trim().length > 0
        ? payload.fileId.trim()
        : "";
    const fileName =
      typeof payload.fileName === "string" && payload.fileName.trim().length > 0
        ? payload.fileName.trim()
        : "";
    const mimeType =
      typeof payload.mimeType === "string" && payload.mimeType.trim().length > 0
        ? payload.mimeType.trim()
        : "";

    if (!fileId || !fileName || !mimeType) {
      return {
        status: 400,
        body: { error: "input.fileId, input.fileName, and input.mimeType are required" },
      };
    }

    if (root) {
      const allowed = await isDriveItemWithinRoot(accessToken, fileId, root);
      if (!allowed) {
        return {
          status: 400,
          body: {
            provider: "google_drive",
            action,
            connectionId: connection.id,
            fileId,
            error:
              "Requested file is outside the configured Google Drive root for this connection.",
          },
        };
      }
    }

    let downloaded;
    try {
      downloaded = await downloadDriveFile(accessToken, fileId, mimeType, fileName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Drive download failed";
      return {
        status: 502,
        body: {
          provider: "google_drive",
          action,
          fileId,
          error: message,
        },
      };
    }
    const isTextLike =
      downloaded.mimeType.startsWith("text/") ||
      downloaded.mimeType === "application/json" ||
      downloaded.mimeType === "application/xml" ||
      downloaded.mimeType === "application/javascript";

    return {
      status: 200,
      body: {
        provider: "google_drive",
        action,
        connectionId: connection.id,
        root,
        fileId,
        fileName: downloaded.fileName,
        mimeType: downloaded.mimeType,
        sizeBytes: downloaded.buffer.byteLength,
        encoding: isTextLike ? "utf8" : "base64",
        content: isTextLike
          ? downloaded.buffer.toString("utf8")
          : downloaded.buffer.toString("base64"),
      },
    };
  }

  if (action === "import_selection") {
    const explicitFiles = Array.isArray(payload.files)
      ? payload.files.filter(
          (file): file is GoogleDriveImportFileRequest =>
            Boolean(
              file &&
                typeof file === "object" &&
                typeof (file as { fileId?: unknown }).fileId === "string" &&
                typeof (file as { fileName?: unknown }).fileName === "string" &&
                typeof (file as { mimeType?: unknown }).mimeType === "string",
            ),
        )
      : [];
    const folderSelections = Array.isArray(payload.folderSelections)
      ? payload.folderSelections.filter(
          (selection): selection is GoogleDriveImportFolderSelection =>
            Boolean(
              selection &&
                typeof selection === "object" &&
                typeof (selection as { folderId?: unknown }).folderId === "string",
            ),
        )
      : [];

    if (explicitFiles.length === 0 && folderSelections.length === 0) {
      return {
        status: 400,
        body: { error: "input.files or input.folderSelections is required" },
      };
    }

    if (!root) {
      return {
        status: 400,
        body: {
          provider: "google_drive",
          action,
          connectionId: connection.id,
          error:
            "Select a Google Drive company root folder before importing documents.",
        },
      };
    }

    for (const file of explicitFiles) {
      const allowed = await isDriveItemWithinRoot(accessToken, file.fileId, root);
      if (!allowed) {
        return {
          status: 400,
          body: {
            provider: "google_drive",
            action,
            connectionId: connection.id,
            error:
              "Selected files must stay within the configured Google Drive root for this connection.",
          },
        };
      }
    }

    for (const selection of folderSelections) {
      const allowed = await isDriveItemWithinRoot(accessToken, selection.folderId, root);
      if (!allowed) {
        return {
          status: 400,
          body: {
            provider: "google_drive",
            action,
            connectionId: connection.id,
            error:
              "Selected folders must stay within the configured Google Drive root for this connection.",
          },
        };
      }
    }

    const result = await queueGoogleDriveImportSelection({
      companyId,
      accessToken,
      explicitFiles,
      folderSelections,
      connectionId: connection.id,
      ingressSource: "google_drive",
      rootPath: metadata.rootPath ?? undefined,
      connectionLabel: metadata.connectionLabel ?? undefined,
    });

    return {
      status: 200,
      body: {
        provider: "google_drive",
        action,
        connectionId: connection.id,
        root,
        ...result,
      },
    };
  }

  return {
    status: 400,
    body: { error: `Unsupported google_drive action: ${action}` },
  };
}

async function runLiveProviderAction(
  companyId: string,
  provider: string,
  action: string,
  input: unknown,
  executor: (connection: NonNullable<Awaited<ReturnType<typeof getLatestConnectionCredentialsByProvider>>>, action: string, input: unknown) => Promise<{ status: number; body: Record<string, unknown> }>,
  options?: { requireConnectionId?: boolean },
) {
  try {
    const payload =
      input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const requestedConnectionId = resolveRequestedConnectionIdFromPayload(payload);

    if (options?.requireConnectionId === true && !requestedConnectionId) {
      return {
        status: 400,
        body: {
          error: `${provider} actions require an explicit connectionId`,
          provider,
          action,
        },
      };
    }

    const connection = requestedConnectionId
      ? await getConnectionCredentials(requestedConnectionId, companyId)
      : await getLatestConnectionCredentialsByProvider(companyId, provider);
    if (!connection) {
      return {
        status: 404,
        body: { error: `${provider} is not connected for this company` },
      };
    }
    const connectionProvider =
      typeof connection.provider === "string" && connection.provider.trim().length > 0
        ? connection.provider
        : provider;
    const connectionStatus =
      typeof connection.status === "string" && connection.status.trim().length > 0
        ? connection.status
        : "active";
    if (
      requestedConnectionId &&
      (connectionProvider !== provider || connectionStatus === "disconnected")
    ) {
      return {
        status: 404,
        body: { error: `${provider} connection ${requestedConnectionId} was not found for this company` },
      };
    }

    const initialPayload = getInitialTraversalPayload(provider, action, input);
    const firstResult = await executor(connection, action, initialPayload);
    return await exhaustConnectorPages(
      connection,
      provider,
      action,
      initialPayload,
      firstResult,
      executor,
    );
  } catch (err) {
    const message =
      err instanceof Error && err.message.trim().length > 0
        ? err.message
        : `${provider} request failed`;
    return {
      status: 502,
      body: { error: message },
    };
  }
}

export async function runAgentConnectorAction(input: {
  companyId: string;
  provider: string;
  action: string;
  payload: unknown;
  companySlug?: string | null;
  companyDbPort?: number | null;
}) {
  const resolved = resolveConnectorAction(input.provider, input.action);
  const action = resolved.resolvedAction;

  if (
    resolved.supportedActions.length > 0 &&
    !resolved.supportedActions.includes(action)
  ) {
    return {
      status: 400,
      body: {
        error: `Unsupported ${input.provider} action: ${input.action}`,
        provider: input.provider,
        requestedAction: input.action,
        supportedActions: resolved.supportedActions,
      },
    };
  }

  const context = await resolveConnectorCompanyContext(input);
  const rules = await loadConnectorRuleDocument(input.provider, context, {
    throwOnInvalid: true,
  });
  const normalizedPayload = applyConnectorRuleDefaultsToPayload(
    input.provider,
    input.payload,
    rules.document,
  );
  const ruleViolation = enforceConnectorRulesBeforeDispatch(
    input.provider,
    action,
    normalizedPayload,
    rules.document,
  );
  if (ruleViolation) {
    return attachConnectorRuleSummary(ruleViolation, rules.summary);
  }

  let result: ConnectorActionResult;

  switch (input.provider) {
    case "google_ads":
      result = await runLiveProviderAction(
        input.companyId,
        "google_ads",
        action,
        normalizedPayload,
        executeGoogleAdsAction,
      );
      break;
    case "linkedin_ads":
      result = await runLiveProviderAction(
        input.companyId,
        "linkedin_ads",
        action,
        normalizedPayload,
        executeLinkedinAdsAction,
      );
      break;
    case "meta_ads":
      result = await runLiveProviderAction(
        input.companyId,
        "meta_ads",
        action,
        normalizedPayload,
        executeMetaAdsAction,
      );
      break;
    case "tiktok_ads":
      result = await runLiveProviderAction(
        input.companyId,
        "tiktok_ads",
        action,
        normalizedPayload,
        executeTiktokAdsAction,
      );
      break;
    case "ga4":
      result = await runLiveProviderAction(
        input.companyId,
        "ga4",
        action,
        normalizedPayload,
        executeGa4Action,
      );
      break;
    case "google_search_console":
      result = await runLiveProviderAction(
        input.companyId,
        "google_search_console",
        action,
        normalizedPayload,
        executeGoogleSearchConsoleAction,
      );
      break;
    case "hubspot":
      result = await runLiveProviderAction(
        input.companyId,
        "hubspot",
        action,
        normalizedPayload,
        executeHubspotAction,
      );
      break;
    case "custom_http":
      result = await runLiveProviderAction(
        input.companyId,
        "custom_http",
        action,
        normalizedPayload,
        executeCustomHttpAction,
        { requireConnectionId: true },
      );
      break;
    case "custom_openapi":
      result = await runLiveProviderAction(
        input.companyId,
        "custom_openapi",
        action,
        normalizedPayload,
        executeCustomOpenApiAction,
        { requireConnectionId: true },
      );
      break;
    case "custom_mcp":
      result = await runLiveProviderAction(
        input.companyId,
        "custom_mcp",
        action,
        normalizedPayload,
        executeCustomMcpAction,
        { requireConnectionId: true },
      );
      break;
    case "github":
      result = await runLiveProviderAction(
        input.companyId,
        "github",
        action,
        normalizedPayload,
        executeGithubAction,
      );
      break;
    case "vercel":
      result = await runLiveProviderAction(
        input.companyId,
        "vercel",
        action,
        normalizedPayload,
        executeVercelAction,
      );
      break;
    case "linear":
      result = await runLiveProviderAction(
        input.companyId,
        "linear",
        action,
        normalizedPayload,
        executeLinearAction,
      );
      break;
    case "notion":
      result = await runLiveProviderAction(
        input.companyId,
        "notion",
        action,
        normalizedPayload,
        executeNotionAction,
      );
      break;
    case "posthog":
      result = await runLiveProviderAction(
        input.companyId,
        "posthog",
        action,
        normalizedPayload,
        executePosthogAction,
      );
      break;
    case "telegram":
      result = await runTelegramAction(input.companyId, action, input.payload);
      break;
    case "odoo":
      result = await runOdooAction(input.companyId, action, input.payload);
      break;
    case "google_drive":
      result = await runGoogleDriveAction(input.companyId, action, input.payload);
      break;
    case "bamboohr":
      result = await runLiveProviderAction(
        input.companyId,
        "bamboohr",
        action,
        input.payload,
        executeBambooHrAction,
      );
      break;
    case "confluence":
      result = await runLiveProviderAction(
        input.companyId,
        "confluence",
        action,
        input.payload,
        executeConfluenceAction,
      );
      break;
    case "ms_graph":
      result = await runLiveProviderAction(
        input.companyId,
        "ms_graph",
        action,
        input.payload,
        executeMsGraphAction,
      );
      break;
    case "dynamics_bc":
      result = await runLiveProviderAction(
        input.companyId,
        "dynamics_bc",
        action,
        input.payload,
        executeDynamicsBcAction,
      );
      break;
    case "payhawk":
      result = await runLiveProviderAction(
        input.companyId,
        "payhawk",
        action,
        input.payload,
        executePayhawkAction,
      );
      break;
    case "zendesk":
      result = await runLiveProviderAction(
        input.companyId,
        "zendesk",
        action,
        input.payload,
        executeZendeskAction,
      );
      break;
    case "linkedin_mcp":
      result = await runLiveProviderAction(
        input.companyId,
        "linkedin_mcp",
        action,
        input.payload,
        executeLinkedInMcpAction,
      );
      break;
    case "metabase":
      result = await runLiveProviderAction(
        input.companyId,
        "metabase",
        action,
        input.payload,
        executeMetabaseAction,
      );
      break;
    default:
      result = {
        status: 400,
        body: { error: `Unsupported connector provider: ${input.provider}` },
      };
      break;
  }

  if (rules.document) {
    result =
      input.provider === "slack"
        ? applySlackRuleFilter(action, result, rules.document)
        : input.provider === "google_ads"
          ? applyGoogleAdsRuleFilter(action, result, rules.document)
          : input.provider === "linkedin_ads"
            ? applyLinkedinAdsRuleFilter(action, result, rules.document)
          : input.provider === "meta_ads"
            ? applyMetaAdsRuleFilter(action, result, rules.document)
            : input.provider === "tiktok_ads"
              ? applyTiktokAdsRuleFilter(action, result, rules.document)
              : input.provider === "ga4"
                ? applyGa4RuleFilter(action, result, rules.document)
                : input.provider === "google_search_console"
                  ? applyGoogleSearchConsoleRuleFilter(action, result, rules.document)
                  : input.provider === "hubspot"
                    ? applyHubspotRuleFilter(action, result, rules.document)
                    : input.provider === "github"
                      ? applyGithubRuleFilter(action, result, rules.document)
                      : input.provider === "vercel"
                        ? applyVercelRuleFilter(action, result, rules.document)
                        : input.provider === "linear"
                          ? applyLinearRuleFilter(action, result, rules.document)
                          : input.provider === "notion"
                            ? applyNotionRuleFilter(action, result, rules.document)
                            : input.provider === "posthog"
                              ? applyPosthogRuleFilter(action, result, rules.document)
                              : input.provider === "custom_http"
                                ? applyCustomHttpRuleFilter(action, result, rules.document)
                                : input.provider === "custom_openapi"
                                  ? applyCustomOpenApiRuleFilter(action, result, rules.document)
                                  : input.provider === "custom_mcp"
                                    ? applyCustomMcpRuleFilter(action, result, rules.document)
                              : result;
  }

  return attachConnectorRuleSummary(result, rules.summary);
}

export async function runHubConnectorAction(
  companyId: string,
  body: Record<string, unknown>,
  contextOverrides?: { companySlug?: string | null; companyDbPort?: number | null },
) {
  const provider =
    typeof body.provider === "string" && body.provider.trim().length > 0
      ? body.provider.trim()
      : null;
  const action =
    typeof body.action === "string" && body.action.trim().length > 0
      ? body.action.trim()
      : null;

  if (provider && action) {
    const context = await resolveConnectorCompanyContext({
      companyId,
      companySlug: contextOverrides?.companySlug,
      companyDbPort: contextOverrides?.companyDbPort,
    });
    const rules = await loadConnectorRuleDocument(provider, context, {
      throwOnInvalid: true,
    });
    const ruleViolation = enforceConnectorRulesBeforeDispatch(
      provider,
      action,
      body.input,
      rules.document,
    );
    if (ruleViolation) {
      throw new ConnectorHubError(
        typeof ruleViolation.body.error === "string"
          ? ruleViolation.body.error
          : `Connector action blocked by rules for ${provider}.${action}`,
        {
          status: ruleViolation.status,
          code:
            typeof ruleViolation.body.code === "string"
              ? ruleViolation.body.code
              : "connector_rule_violation",
          details: ruleViolation.body.details,
        },
      );
    }
  }

  return executeConnectorHubAction(companyId, body);
}
