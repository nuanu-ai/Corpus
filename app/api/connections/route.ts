import { NextResponse } from "next/server";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { listConnections, createConnection } from "@/lib/connections";
import { registerConnector } from "@/lib/connections/register-connector";
import { ConnectorHubError } from "@/lib/connectors/hub-errors";
import {
  getBambooHrCredentials,
  validateBambooHrConnection,
} from "@/lib/connectors/bamboohr";
import {
  getConfluenceCredentials,
  validateConfluenceConnection,
} from "@/lib/connectors/confluence";
import {
  getCustomHttpCredentials,
  validateCustomHttpConnection,
} from "@/lib/connectors/custom-http";
import {
  getCustomMcpCredentials,
  validateCustomMcpConnection,
} from "@/lib/connectors/custom-mcp";
import {
  validateCustomOpenApiConnection,
} from "@/lib/connectors/custom-openapi";
import {
  getDynamicsBcCredentials,
  validateDynamicsBcConnection,
} from "@/lib/connectors/dynamics-bc";
import { validateOdooConnection } from "@/lib/connectors/odoo-validate";
import {
  getGa4Credentials,
  validateGa4Connection,
} from "@/lib/connectors/ga4";
import {
  getGoogleAdsCredentials,
  validateGoogleAdsConnection,
} from "@/lib/connectors/google-ads";
import {
  getGoogleSearchConsoleCredentials,
  validateGoogleSearchConsoleConnection,
} from "@/lib/connectors/google-search-console";
import {
  getGithubCredentials,
  validateGithubConnection,
} from "@/lib/connectors/github";
import {
  getHubspotCredentials,
  validateHubspotConnection,
} from "@/lib/connectors/hubspot";
import {
  getLinkedinAdsCredentials,
  validateLinkedinAdsConnection,
} from "@/lib/connectors/linkedin-ads";
import {
  getLinearCredentials,
  validateLinearConnection,
} from "@/lib/connectors/linear";
import {
  getMetaAdsCredentials,
  validateMetaAdsConnection,
} from "@/lib/connectors/meta-ads";
import {
  getNotionCredentials,
  validateNotionConnection,
} from "@/lib/connectors/notion";
import {
  getVercelCredentials,
  validateVercelConnection,
} from "@/lib/connectors/vercel";
import { normalizeJiraSiteUrl, resolveJiraApiTokenConnectionMetadata } from "@/lib/connectors/jira-hub";
import {
  getLinkedInMcpCredentials,
  validateLinkedInMcpConnection,
} from "@/lib/connectors/linkedin-mcp";
import {
  getMetabaseCredentials,
  validateMetabaseConnection,
} from "@/lib/connectors/metabase";
import {
  getPosthogCredentials,
  validatePosthogConnection,
} from "@/lib/connectors/posthog";
import {
  getTiktokAdsCredentials,
  validateTiktokAdsConnection,
} from "@/lib/connectors/tiktok-ads";
import { validateMsGraphConnection } from "@/lib/connectors/ms-graph";
import { getPayhawkCredentials, validatePayhawkConnection } from "@/lib/connectors/payhawk";
import { resolveSlackConnectionMetadata } from "@/lib/connectors/slack-hub";
import { validateStripeApiKey } from "@/lib/connectors/stripe-validate";
import {
  getZendeskCredentials,
  validateZendeskConnection,
} from "@/lib/connectors/zendesk";
import { inngest } from "@/lib/inngest";
import { listConnectionEnabledProviders } from "@/lib/connectors/provider-registry";

type ConnectionHandlerContext = {
  credentials: Record<string, unknown>;
  externalAccountId?: string;
};

type ConnectionValidationResult = {
  externalAccountId?: string | null;
  metadata?: Record<string, unknown>;
};

type ConnectionHandlerResult = ConnectionValidationResult & {
  credentials?: Record<string, unknown>;
  errorResponse?: ReturnType<typeof NextResponse.json>;
};

type ConnectionProviderHandler = (
  context: ConnectionHandlerContext,
) => Promise<ConnectionHandlerResult>;

function buildConnectionErrorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function createValidatedConnectionHandler<
  TCredentials extends Record<string, unknown>,
>(options: {
  normalize?: (credentials: Record<string, unknown>) => TCredentials | null;
  invalidCredentialsMessage: string;
  missingCredentialsMessage: string;
  validate: (credentials: TCredentials) => Promise<ConnectionValidationResult>;
  validationErrorMessage: string;
  prepareCredentialsForStorage?: (credentials: TCredentials) => Record<string, unknown>;
  prepareCredentialsForValidation?: (credentials: TCredentials) => TCredentials;
}): ConnectionProviderHandler {
  return async ({ credentials, externalAccountId }) => {
    let normalized = credentials as TCredentials | null;

    if (options.normalize) {
      try {
        normalized = options.normalize(credentials);
      } catch (err) {
        return {
          errorResponse: buildConnectionErrorResponse(
            err instanceof Error ? err.message : options.invalidCredentialsMessage,
          ),
        };
      }
    }

    if (!normalized) {
      return {
        errorResponse: buildConnectionErrorResponse(options.missingCredentialsMessage),
      };
    }

    const credentialsForValidation = options.prepareCredentialsForValidation
      ? options.prepareCredentialsForValidation(normalized)
      : normalized;
    const credentialsForStorage = options.prepareCredentialsForStorage
      ? options.prepareCredentialsForStorage(normalized)
      : (normalized as Record<string, unknown>);

    try {
      const validation = await options.validate(credentialsForValidation);
      return {
        credentials: credentialsForStorage,
        externalAccountId: validation.externalAccountId ?? externalAccountId,
        metadata: validation.metadata,
      };
    } catch (err) {
      return {
        errorResponse: buildConnectionErrorResponse(
          err instanceof Error ? err.message : options.validationErrorMessage,
        ),
      };
    }
  };
}

const CONNECTION_PROVIDER_HANDLERS: Partial<
  Record<string, ConnectionProviderHandler>
> = {
  stripe: async ({ credentials, externalAccountId }) => {
    const apiKey =
      typeof credentials.apiKey === "string" ? credentials.apiKey.trim() : "";

    if (!apiKey) {
      return {
        errorResponse: buildConnectionErrorResponse(
          "apiKey is required for Stripe",
        ),
      };
    }

    try {
      const validation = await validateStripeApiKey(apiKey);
      return {
        credentials: {
          ...credentials,
          apiKey,
        },
        externalAccountId: validation.accountId ?? externalAccountId,
      };
    } catch (err) {
      return {
        errorResponse: buildConnectionErrorResponse(
          err instanceof Error ? err.message : "Invalid Stripe API key",
        ),
      };
    }
  },
  google_ads: createValidatedConnectionHandler({
    normalize: getGoogleAdsCredentials,
    invalidCredentialsMessage: "Invalid Google Ads credentials",
    missingCredentialsMessage:
      "Google Ads requires an OAuth access token and a developer token (or GOOGLE_ADS_DEVELOPER_TOKEN in env).",
    validate: validateGoogleAdsConnection,
    validationErrorMessage: "Could not validate Google Ads credentials",
  }),
  meta_ads: createValidatedConnectionHandler({
    normalize: getMetaAdsCredentials,
    invalidCredentialsMessage: "Invalid Meta Ads credentials",
    missingCredentialsMessage: "token is required for Meta Ads",
    validate: validateMetaAdsConnection,
    validationErrorMessage: "Could not validate Meta Ads credentials",
  }),
  tiktok_ads: createValidatedConnectionHandler({
    normalize: getTiktokAdsCredentials,
    invalidCredentialsMessage: "Invalid TikTok Ads credentials",
    missingCredentialsMessage: "token is required for TikTok Ads",
    validate: validateTiktokAdsConnection,
    validationErrorMessage: "Could not validate TikTok Ads credentials",
  }),
  linkedin_ads: createValidatedConnectionHandler({
    normalize: getLinkedinAdsCredentials,
    invalidCredentialsMessage: "Invalid LinkedIn Ads credentials",
    missingCredentialsMessage: "token is required for LinkedIn Ads",
    validate: validateLinkedinAdsConnection,
    validationErrorMessage: "Could not validate LinkedIn Ads credentials",
  }),
  ga4: createValidatedConnectionHandler({
    normalize: getGa4Credentials,
    invalidCredentialsMessage: "Invalid GA4 credentials",
    missingCredentialsMessage: "token is required for GA4",
    validate: validateGa4Connection,
    validationErrorMessage: "Could not validate GA4 credentials",
  }),
  google_search_console: createValidatedConnectionHandler({
    normalize: getGoogleSearchConsoleCredentials,
    invalidCredentialsMessage: "Invalid Google Search Console credentials",
    missingCredentialsMessage: "token is required for Google Search Console",
    validate: validateGoogleSearchConsoleConnection,
    validationErrorMessage: "Could not validate Google Search Console credentials",
  }),
  hubspot: createValidatedConnectionHandler({
    normalize: getHubspotCredentials,
    invalidCredentialsMessage: "Invalid HubSpot credentials",
    missingCredentialsMessage: "token is required for HubSpot",
    validate: validateHubspotConnection,
    validationErrorMessage: "Could not validate HubSpot token",
  }),
  custom_http: createValidatedConnectionHandler({
    normalize: getCustomHttpCredentials,
    invalidCredentialsMessage: "Invalid custom HTTP connector config",
    missingCredentialsMessage: "baseUrl and actions are required for custom_http",
    validate: validateCustomHttpConnection,
    validationErrorMessage: "Could not validate custom HTTP connector",
  }),
  custom_openapi: async ({ credentials, externalAccountId }) => {
    try {
      const validation = await validateCustomOpenApiConnection(credentials);
      return {
        credentials: validation.credentials as Record<string, unknown>,
        externalAccountId: validation.externalAccountId ?? externalAccountId,
        metadata: validation.metadata,
      };
    } catch (err) {
      return {
        errorResponse: buildConnectionErrorResponse(
          err instanceof Error ? err.message : "Could not validate custom OpenAPI connector",
        ),
      };
    }
  },
  custom_mcp: createValidatedConnectionHandler({
    normalize: getCustomMcpCredentials,
    invalidCredentialsMessage: "Invalid custom MCP connector config",
    missingCredentialsMessage: "serverUrl and allowedTools are required for custom_mcp",
    validate: validateCustomMcpConnection,
    validationErrorMessage: "Could not validate custom MCP connector",
  }),
  github: createValidatedConnectionHandler({
    normalize: getGithubCredentials,
    invalidCredentialsMessage: "Invalid GitHub credentials",
    missingCredentialsMessage: "token is required for GitHub",
    validate: validateGithubConnection,
    validationErrorMessage: "Could not validate GitHub token",
  }),
  vercel: createValidatedConnectionHandler({
    normalize: getVercelCredentials,
    invalidCredentialsMessage: "Invalid Vercel credentials",
    missingCredentialsMessage: "token is required for Vercel",
    validate: validateVercelConnection,
    validationErrorMessage: "Could not validate Vercel token",
  }),
  linear: createValidatedConnectionHandler({
    normalize: getLinearCredentials,
    invalidCredentialsMessage: "Invalid Linear credentials",
    missingCredentialsMessage: "token is required for Linear",
    validate: validateLinearConnection,
    validationErrorMessage: "Could not validate Linear token",
  }),
  notion: createValidatedConnectionHandler({
    normalize: getNotionCredentials,
    invalidCredentialsMessage: "Invalid Notion credentials",
    missingCredentialsMessage: "token is required for Notion",
    validate: validateNotionConnection,
    validationErrorMessage: "Could not validate Notion token",
  }),
  posthog: createValidatedConnectionHandler({
    normalize: getPosthogCredentials,
    invalidCredentialsMessage: "Invalid PostHog credentials",
    missingCredentialsMessage: "baseUrl and token are required for PostHog",
    validate: validatePosthogConnection,
    validationErrorMessage: "Could not validate PostHog token",
  }),
  bamboohr: createValidatedConnectionHandler({
    normalize: getBambooHrCredentials,
    invalidCredentialsMessage: "Invalid BambooHR credentials",
    missingCredentialsMessage: "subdomain and apiKey are required for BambooHR",
    validate: validateBambooHrConnection,
    validationErrorMessage: "Could not validate BambooHR credentials",
  }),
  confluence: createValidatedConnectionHandler({
    normalize: getConfluenceCredentials,
    invalidCredentialsMessage: "Invalid Confluence credentials",
    missingCredentialsMessage: "siteUrl, email, and apiToken are required for Confluence",
    validate: validateConfluenceConnection,
    validationErrorMessage: "Could not validate Confluence credentials",
    prepareCredentialsForStorage: (credentials) => ({
      ...credentials,
      authMode: "api_token",
    }),
  }),
  ms_graph: async ({ credentials, externalAccountId }) => {
    const tenantId =
      typeof credentials.tenantId === "string" ? credentials.tenantId.trim() : "";
    const clientId =
      typeof credentials.clientId === "string" ? credentials.clientId.trim() : "";
    const clientSecret =
      typeof credentials.clientSecret === "string" ? credentials.clientSecret.trim() : "";

    if (!tenantId || !clientId || !clientSecret) {
      return {
        errorResponse: buildConnectionErrorResponse(
          "tenantId, clientId, and clientSecret are required for Microsoft Graph",
        ),
      };
    }

    const normalizedCredentials = { tenantId, clientId, clientSecret };

    try {
      const validation = await validateMsGraphConnection(normalizedCredentials);
      return {
        credentials: normalizedCredentials,
        externalAccountId: validation.externalAccountId ?? externalAccountId,
        metadata: validation.metadata,
      };
    } catch (err) {
      return {
        errorResponse: buildConnectionErrorResponse(
          err instanceof Error
            ? err.message
            : "Could not validate Microsoft Graph credentials",
        ),
      };
    }
  },
  dynamics_bc: createValidatedConnectionHandler({
    normalize: getDynamicsBcCredentials,
    invalidCredentialsMessage: "Invalid Dynamics 365 Business Central credentials",
    missingCredentialsMessage:
      "tenantId, clientId, clientSecret, and environmentName are required for Dynamics 365 Business Central",
    validate: validateDynamicsBcConnection,
    validationErrorMessage: "Could not validate Dynamics 365 Business Central credentials",
  }),
  payhawk: createValidatedConnectionHandler({
    normalize: getPayhawkCredentials,
    invalidCredentialsMessage: "Invalid Payhawk credentials",
    missingCredentialsMessage: "apiKey is required for Payhawk",
    validate: validatePayhawkConnection,
    validationErrorMessage: "Could not validate Payhawk credentials",
  }),
  zendesk: createValidatedConnectionHandler({
    normalize: getZendeskCredentials,
    invalidCredentialsMessage: "Invalid Zendesk credentials",
    missingCredentialsMessage: "subdomain, email, and apiToken are required for Zendesk",
    validate: validateZendeskConnection,
    validationErrorMessage: "Could not validate Zendesk credentials",
  }),
  linkedin_mcp: createValidatedConnectionHandler({
    normalize: getLinkedInMcpCredentials,
    invalidCredentialsMessage: "Invalid LinkedIn MCP credentials",
    missingCredentialsMessage: "serverUrl is required for LinkedIn MCP",
    validate: validateLinkedInMcpConnection,
    validationErrorMessage: "Could not validate LinkedIn MCP connection",
  }),
  metabase: createValidatedConnectionHandler({
    normalize: getMetabaseCredentials,
    invalidCredentialsMessage: "Invalid Metabase credentials",
    missingCredentialsMessage: "baseUrl and apiKey are required for Metabase",
    validate: validateMetabaseConnection,
    validationErrorMessage: "Could not validate Metabase credentials",
  }),
  slack: async ({ credentials, externalAccountId }) => {
    const token =
      typeof credentials.token === "string"
        ? credentials.token.trim()
        : typeof credentials.botToken === "string"
          ? credentials.botToken.trim()
          : typeof credentials.access_token === "string"
            ? credentials.access_token.trim()
            : typeof credentials.apiKey === "string"
              ? credentials.apiKey.trim()
              : "";

    if (!token) {
      return {
        errorResponse: buildConnectionErrorResponse(
          "token is required (Slack Bot User OAuth Token, usually xoxb-...)",
        ),
      };
    }

    const normalizedCredentials = {
      access_token: token,
      authMode: "manual_bot_token",
    };

    try {
      const validation = await resolveSlackConnectionMetadata(normalizedCredentials);
      return {
        credentials: normalizedCredentials,
        externalAccountId: validation.externalAccountId ?? externalAccountId,
        metadata: {
          ...validation.metadata,
          authMode: "manual_bot_token",
        },
      };
    } catch (err) {
      return {
        errorResponse: buildConnectionErrorResponse(
          err instanceof Error ? err.message : "Could not validate Slack bot token",
          err instanceof ConnectorHubError ? err.status : 400,
        ),
      };
    }
  },
  jira: async ({ credentials, externalAccountId }) => {
    const siteUrlRaw = typeof credentials.siteUrl === "string" ? credentials.siteUrl.trim() : "";
    const email = typeof credentials.email === "string" ? credentials.email.trim() : "";
    const apiToken =
      typeof credentials.apiToken === "string"
        ? credentials.apiToken.trim()
        : typeof credentials.token === "string"
          ? credentials.token.trim()
          : "";

    if (!siteUrlRaw) {
      return {
        errorResponse: buildConnectionErrorResponse(
          "siteUrl is required (for example https://example.atlassian.net)",
        ),
      };
    }
    if (!email) {
      return {
        errorResponse: buildConnectionErrorResponse(
          "email is required for Jira API token auth",
        ),
      };
    }
    if (!apiToken) {
      return {
        errorResponse: buildConnectionErrorResponse(
          "apiToken is required for Jira API token auth",
        ),
      };
    }

    let siteUrl: string;
    try {
      siteUrl = normalizeJiraSiteUrl(siteUrlRaw);
    } catch {
      return {
        errorResponse: buildConnectionErrorResponse(
          "siteUrl must be a valid http(s) URL",
        ),
      };
    }

    const normalizedCredentials = {
      siteUrl,
      email,
      apiToken,
      authMode: "api_token",
    };

    try {
      const validation = await resolveJiraApiTokenConnectionMetadata({
        siteUrl,
        email,
        apiToken,
      });
      return {
        credentials: normalizedCredentials,
        externalAccountId: validation.externalAccountId ?? externalAccountId,
        metadata: validation.metadata,
      };
    } catch (err) {
      return {
        errorResponse: buildConnectionErrorResponse(
          err instanceof Error ? err.message : "Could not validate Jira API token",
          err instanceof ConnectorHubError ? err.status : 400,
        ),
      };
    }
  },
  odoo: async ({ credentials, externalAccountId }) => {
    const portalUrl =
      typeof credentials.portalUrl === "string" ? credentials.portalUrl.trim() : "";
    const token = typeof credentials.token === "string" ? credentials.token.trim() : "";

    if (!portalUrl || !portalUrl.startsWith("http")) {
      return {
        errorResponse: buildConnectionErrorResponse(
          "portalUrl is required and must be a valid URL",
        ),
      };
    }
    if (!token || token.length < 8) {
      return {
        errorResponse: buildConnectionErrorResponse(
          "token is required (API token from ODOO Portal)",
        ),
      };
    }

    try {
      const validation = await validateOdooConnection(portalUrl, token);
      if (!validation.valid) {
        return {
          errorResponse: buildConnectionErrorResponse(
            validation.error || "Could not connect to Odoo Portal",
          ),
        };
      }
    } catch (err) {
      return {
        errorResponse: buildConnectionErrorResponse(
          err instanceof Error ? err.message : "Odoo validation failed",
        ),
      };
    }

    return {
      credentials: {
        portalUrl,
        token,
      },
      externalAccountId,
    };
  },
};

export async function GET() {
  try {
    const { companyId } = await getSessionCompanyContext();
    const rows = await listConnections(companyId);
    return NextResponse.json(rows);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    const { companyId } = await getSessionCompanyContext();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { provider, credentials, externalAccountId, scopes } = body;

    if (!provider || typeof provider !== "string" || !credentials || typeof credentials !== "object") {
      return NextResponse.json(
        { error: "provider (string) and credentials (object) are required" },
        { status: 400 }
      );
    }

    const allowedProviders: ReadonlySet<string> = new Set(
      listConnectionEnabledProviders().map((definition) => definition.slug),
    );
    if (!allowedProviders.has(provider)) {
      return NextResponse.json(
        { error: `Unsupported provider: ${provider}` },
        { status: 400 }
      );
    }

    let resolvedCredentials = credentials as Record<string, unknown>;
    let resolvedMetadata: Record<string, unknown> | undefined;

    let resolvedExternalAccountId = externalAccountId as string | undefined;

    const providerHandler = CONNECTION_PROVIDER_HANDLERS[provider];
    if (providerHandler) {
      const handled = await providerHandler({
        credentials: resolvedCredentials,
        externalAccountId: resolvedExternalAccountId,
      });
      if (handled.errorResponse) {
        return handled.errorResponse;
      }
      if (handled.credentials) {
        resolvedCredentials = handled.credentials;
      }
      resolvedExternalAccountId = handled.externalAccountId ?? resolvedExternalAccountId;
      if (handled.metadata) {
        resolvedMetadata = handled.metadata;
      }
    }

    // Create the encrypted connection row
    const connection = await createConnection(companyId, provider, resolvedCredentials, {
      externalAccountId: resolvedExternalAccountId,
      scopes: scopes as string[] | undefined,
      metadata: resolvedMetadata,
    });

    // Create a connector_registrations row so the webhook ingest pipeline can route events.
    // For Stripe, pass null for webhookSecret — Stripe signs webhooks with its own
    // endpoint secret (STRIPE_WEBHOOK_SECRET env var), resolved at ingest time.
    try {
      await registerConnector(companyId, provider, {
        accountId: resolvedExternalAccountId || connection.id,
        webhookSecret: provider === "stripe" ? null : undefined,
      });
    } catch (err) {
      // Non-fatal — log but don't fail the connection creation
      console.error("Failed to create connector registration:", err);
    }

    // Trigger initial sync via Inngest (provider-specific)
    try {
      await inngest.send({
        name: `connection/${provider}.connected`,
        data: {
          connectionId: connection.id,
          companyId,
        },
      });
    } catch (err) {
      // Non-fatal — sync can be triggered later
      console.error("Failed to trigger initial sync:", err);
    }

    return NextResponse.json(connection, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
