import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { validateOAuthState, exchangeCodeForTokens, OAUTH_STATE_COOKIE, OAUTH_PROVIDER_COOKIE, OAUTH_SHOP_COOKIE } from "@/lib/oauth";
import {
  getAllowedOAuthProviderConfig,
  type OAuthProviderSlug,
} from "@/lib/oauth-providers";
import { createConnection } from "@/lib/connections";
import { inngest } from "@/lib/inngest";
import { getSessionCompanyContext } from "@/lib/api-auth";
import { tokenExpiresAtFromExpiresIn } from "@/lib/connectors/oauth-token-metadata";

type OAuthCallbackEnrichment = {
  externalAccountId?: string;
  metadata?: Record<string, unknown>;
};

type OAuthCallbackEnricher = (
  tokenResponse: Record<string, unknown>,
) => Promise<OAuthCallbackEnrichment>;

const OAUTH_CALLBACK_ENRICHERS: Partial<
  Record<OAuthProviderSlug, OAuthCallbackEnricher>
> = {
  slack: async (tokenResponse) => {
    const { resolveSlackConnectionMetadata } = await import("@/lib/connectors/slack-hub");
    const resolved = await resolveSlackConnectionMetadata(tokenResponse);
    return {
      externalAccountId: resolved.externalAccountId,
      metadata: resolved.metadata,
    };
  },
  jira: async (tokenResponse) => {
    const { resolveJiraConnectionMetadata } = await import("@/lib/connectors/jira-hub");
    const resolved = await resolveJiraConnectionMetadata(tokenResponse);
    return {
      externalAccountId: resolved.externalAccountId,
      metadata: resolved.metadata,
    };
  },
  google_ads: async (tokenResponse) => {
    const { validateGoogleAdsConnection } = await import("@/lib/connectors/google-ads");
    const resolved = await validateGoogleAdsConnection(tokenResponse);
    return {
      externalAccountId: resolved.externalAccountId,
      metadata: resolved.metadata,
    };
  },
  ga4: async (tokenResponse) => {
    const { validateGa4Connection } = await import("@/lib/connectors/ga4");
    const resolved = await validateGa4Connection(tokenResponse);
    return {
      externalAccountId: resolved.externalAccountId,
      metadata: resolved.metadata,
    };
  },
  google_search_console: async (tokenResponse) => {
    const { validateGoogleSearchConsoleConnection } = await import(
      "@/lib/connectors/google-search-console"
    );
    const resolved = await validateGoogleSearchConsoleConnection(tokenResponse);
    return {
      externalAccountId: resolved.externalAccountId,
      metadata: resolved.metadata,
    };
  },
  meta_ads: async (tokenResponse) => {
    const { validateMetaAdsConnection } = await import("@/lib/connectors/meta-ads");
    const resolved = await validateMetaAdsConnection(tokenResponse);
    return {
      externalAccountId: resolved.externalAccountId,
      metadata: resolved.metadata,
    };
  },
};

/**
 * Best-effort parse of a v2 OAuth state string to extract the threadId.
 * No HMAC verification — used only on error paths where the state may be
 * untrusted/expired. Returns null if the state is missing or malformed.
 *
 * v2 format: v2.companyId.threadId.nonce.timestamp.signature (6 dot-parts)
 * threadId encoded as "0" means no onboarding context → returns null.
 */
function parseThreadIdFromState(state: string | null | undefined): string | null {
  if (!state) return null;
  const parts = state.split(".");
  if (parts.length === 6 && parts[0] === "v2") {
    const threadIdRaw = parts[2];
    return threadIdRaw && threadIdRaw !== "0" ? threadIdRaw : null;
  }
  return null;
}

export async function GET(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const errorRedirect = `${appUrl}/integrations?error=oauth_failed`;

  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Provider denied access or user cancelled
    if (error) {
      const cookieStore = await cookies();
      const providerCookie = cookieStore.get(OAUTH_PROVIDER_COOKIE)?.value;
      const earlyThreadId = parseThreadIdFromState(state);
      if (earlyThreadId && providerCookie) {
        return NextResponse.redirect(
          `${appUrl}/assistant?onboarding_oauth=${encodeURIComponent(providerCookie)}:error`
        );
      }
      return NextResponse.redirect(
        `${appUrl}/integrations?error=oauth_denied`
      );
    }

    if (!code || !state) {
      const cookieStore2 = await cookies();
      const providerCookie2 = cookieStore2.get(OAUTH_PROVIDER_COOKIE)?.value;
      const earlyThreadId2 = parseThreadIdFromState(state);
      if (earlyThreadId2 && providerCookie2) {
        return NextResponse.redirect(
          `${appUrl}/assistant?onboarding_oauth=${encodeURIComponent(providerCookie2)}:error`
        );
      }
      return NextResponse.redirect(errorRedirect);
    }

    const cookieStore = await cookies();
    const stateCookie = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
    const providerCookie = cookieStore.get(OAUTH_PROVIDER_COOKIE)?.value;

    if (!stateCookie || !providerCookie) {
      return NextResponse.redirect(errorRedirect);
    }

    // Validate the provider exists
    const config = getAllowedOAuthProviderConfig(providerCookie);
    if (!config) {
      return NextResponse.redirect(errorRedirect);
    }

    // Validate state token against cookie nonce. v2 state also carries
    // an onboarding threadId so we can redirect back into the chat.
    const { companyId, threadId } = validateOAuthState(state, stateCookie);

    // Validate session matches — prevent CSRF/token fixation
    const authContext = await getSessionCompanyContext();
    if (authContext.companyId !== companyId) {
      return NextResponse.redirect(errorRedirect);
    }

    // Read shop cookie for Shopify
    const shopCookie = cookieStore.get(OAUTH_SHOP_COOKIE)?.value;

    // Exchange code for tokens
    const tokenResponse = await exchangeCodeForTokens(providerCookie, code, {
      shop: shopCookie,
    });

    // Determine externalAccountId based on provider
    let externalAccountId =
      shopCookie || // Shopify: shop domain
      (tokenResponse.stripe_user_id as string) ||
      (tokenResponse.account_id as string) ||
      undefined;
    const metadata: Record<string, unknown> = {};
    const tokenExpiresAt = tokenExpiresAtFromExpiresIn(tokenResponse.expires_in);
    if (tokenExpiresAt) {
      metadata.tokenExpiresAt = tokenExpiresAt;
    }

    const enricher = OAUTH_CALLBACK_ENRICHERS[providerCookie as OAuthProviderSlug];
    if (enricher) {
      const enriched = await enricher(tokenResponse as Record<string, unknown>);
      externalAccountId = enriched.externalAccountId ?? externalAccountId;
      if (enriched.metadata) {
        Object.assign(metadata, enriched.metadata);
      }
    }

    // Store the connection with encrypted credentials
    const connection = await createConnection(companyId, providerCookie, tokenResponse, {
      externalAccountId,
      scopes: config.scopes,
      metadata,
    });

    // Trigger initial sync for the new connection (dynamic per provider)
    await inngest.send({
      name: `connection/${providerCookie}.connected`,
      data: {
        connectionId: connection.id,
        companyId,
      },
    });

    // Clean up cookies
    cookieStore.delete(OAUTH_STATE_COOKIE);
    cookieStore.delete(OAUTH_PROVIDER_COOKIE);
    cookieStore.delete(OAUTH_SHOP_COOKIE);

    // Onboarding callback bridge: if this OAuth flow originated from the
    // chat-first onboarding surface, bump the per-company onboarding
    // counter and bounce the user back to /onboarding with a one-line
    // result query the chat picks up.
    if (threadId) {
      try {
        const { handleOnboardingConnectorLinked } = await import(
          "@/lib/onboarding/context"
        );
        await handleOnboardingConnectorLinked({
          companyId,
          provider: providerCookie,
        });
      } catch (err) {
        console.error("[oauth-callback] onboarding handler failed", err);
      }
      return NextResponse.redirect(
        `${appUrl}/assistant?onboarding_oauth=${encodeURIComponent(providerCookie)}:success`,
      );
    }

    return NextResponse.redirect(`${appUrl}/integrations`);
  } catch {
    // Clean up cookies on error too
    let catchProviderCookie: string | undefined;
    try {
      const cookieStore = await cookies();
      catchProviderCookie = cookieStore.get(OAUTH_PROVIDER_COOKIE)?.value;
      cookieStore.delete(OAUTH_STATE_COOKIE);
      cookieStore.delete(OAUTH_PROVIDER_COOKIE);
      cookieStore.delete(OAUTH_SHOP_COOKIE);
    } catch {
      // ignore cookie cleanup errors
    }

    // Best-effort: if we can tell this was an onboarding flow, send the
    // error back to the chat surface instead of /integrations.
    const catchState = (() => {
      try {
        return new URL(request.url).searchParams.get("state");
      } catch {
        return null;
      }
    })();
    const catchThreadId = parseThreadIdFromState(catchState);
    if (catchThreadId && catchProviderCookie) {
      return NextResponse.redirect(
        `${appUrl}/assistant?onboarding_oauth=${encodeURIComponent(catchProviderCookie)}:error`
      );
    }

    return NextResponse.redirect(errorRedirect);
  }
}
