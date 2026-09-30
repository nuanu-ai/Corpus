import { listUiOAuthProviders } from "@/lib/connectors/provider-registry";

export type OAuthProviderConfig = {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Separator used when serializing the scope query parameter. */
  scopeSeparator?: string;
  /** Extra query params to include in the authorization URL (e.g. access_type=offline for Google). */
  extraAuthParams?: Record<string, string>;
  /** Request encoding expected by the token endpoint. Defaults to form-urlencoded. */
  tokenRequestFormat?: "form" | "json";
};

export const oauthProviders: Record<string, OAuthProviderConfig> = {
  stripe: {
    authUrl: "https://connect.stripe.com/oauth/authorize",
    tokenUrl: "https://connect.stripe.com/oauth/token",
    scopes: ["read_write"],
    clientIdEnv: "STRIPE_CLIENT_ID",
    clientSecretEnv: "STRIPE_SECRET_KEY",
  },
  truelayer: {
    authUrl: "https://auth.truelayer.com/",
    tokenUrl: "https://auth.truelayer.com/connect/token",
    scopes: ["info", "accounts", "transactions", "balance", "offline_access"],
    clientIdEnv: "TRUELAYER_CLIENT_ID",
    clientSecretEnv: "TRUELAYER_CLIENT_SECRET",
  },
  paypal: {
    authUrl: "https://www.paypal.com/signin/authorize",
    tokenUrl: "https://api-m.paypal.com/v1/oauth2/token",
    scopes: ["openid", "https://uri.paypal.com/services/reporting/search/read"],
    clientIdEnv: "PAYPAL_CLIENT_ID",
    clientSecretEnv: "PAYPAL_CLIENT_SECRET",
  },
  shopify: {
    authUrl: "https://{shop}.myshopify.com/admin/oauth/authorize",
    tokenUrl: "https://{shop}.myshopify.com/admin/oauth/access_token",
    scopes: ["read_orders", "read_transactions", "read_shopify_payments_payouts"],
    clientIdEnv: "SHOPIFY_CLIENT_ID",
    clientSecretEnv: "SHOPIFY_CLIENT_SECRET",
  },
  google_ads: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/adwords"],
    clientIdEnv: "GOOGLE_ADS_CLIENT_ID",
    clientSecretEnv: "GOOGLE_ADS_CLIENT_SECRET",
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
    },
  },
  ga4: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    clientIdEnv: "GA4_CLIENT_ID",
    clientSecretEnv: "GA4_CLIENT_SECRET",
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
    },
  },
  google_search_console: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    clientIdEnv: "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
    },
  },
  meta_ads: {
    authUrl: "https://www.facebook.com/v18.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
    scopes: ["ads_read", "ads_management"],
    clientIdEnv: "META_ADS_CLIENT_ID",
    clientSecretEnv: "META_ADS_CLIENT_SECRET",
  },
  google_drive: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
    clientIdEnv: "GOOGLE_DRIVE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_DRIVE_CLIENT_SECRET",
    extraAuthParams: {
      access_type: "offline",
      prompt: "consent",
    },
  },
  slack: {
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: [
      "channels:read",
      "channels:history",
      "groups:read",
      "groups:history",
      "chat:write",
    ],
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
    scopeSeparator: ",",
  },
  jira: {
    authUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: [
      "read:jira-work",
      "write:jira-work",
      "read:jira-user",
      "offline_access",
    ],
    clientIdEnv: "JIRA_CLIENT_ID",
    clientSecretEnv: "JIRA_CLIENT_SECRET",
    extraAuthParams: {
      audience: "api.atlassian.com",
      prompt: "consent",
    },
    tokenRequestFormat: "json",
  },
};

export type OAuthProviderSlug = keyof typeof oauthProviders;

const UI_OAUTH_PROVIDER_SLUGS: ReadonlySet<string> = new Set(
  listUiOAuthProviders().map((provider) => provider.slug),
);

export const HIDDEN_RUNTIME_OAUTH_PROVIDER_SLUGS = [
  "stripe",
  "truelayer",
  "paypal",
  "slack",
  "jira",
] as const satisfies readonly OAuthProviderSlug[];

export function getOAuthProviderConfig(provider: string) {
  return oauthProviders[provider] ?? null;
}

export function listOAuthProviderConfigs(): Array<[OAuthProviderSlug, OAuthProviderConfig]> {
  return Object.entries(oauthProviders) as Array<[OAuthProviderSlug, OAuthProviderConfig]>;
}

export function isUiOAuthProvider(provider: string) {
  return UI_OAUTH_PROVIDER_SLUGS.has(provider);
}

export function listUiOAuthProviderConfigs(): Array<[OAuthProviderSlug, OAuthProviderConfig]> {
  return listOAuthProviderConfigs().filter(([slug]) => isUiOAuthProvider(slug));
}

export function listHiddenRuntimeOAuthProviderConfigs(): Array<
  [OAuthProviderSlug, OAuthProviderConfig]
> {
  return HIDDEN_RUNTIME_OAUTH_PROVIDER_SLUGS.map((slug) => [slug, oauthProviders[slug]]);
}

export function getAllowedOAuthProviderConfig(provider: string) {
  if (isUiOAuthProvider(provider)) {
    return getOAuthProviderConfig(provider);
  }

  if (
    (HIDDEN_RUNTIME_OAUTH_PROVIDER_SLUGS as readonly string[]).includes(provider)
  ) {
    return getOAuthProviderConfig(provider);
  }

  return null;
}
