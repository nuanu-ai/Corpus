import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import { getAllowedOAuthProviderConfig } from "@/lib/oauth-providers";
import { generateOAuthState, OAUTH_STATE_COOKIE, OAUTH_PROVIDER_COOKIE, OAUTH_SHOP_COOKIE } from "@/lib/oauth";

export async function GET(request: Request) {
  try {
    const { companyId } = await getSessionCompanyContext();

    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");

    const config = provider ? getAllowedOAuthProviderConfig(provider) : null;
    if (!provider || !config) {
      return NextResponse.json(
        { error: "Invalid or missing provider" },
        { status: 400 }
      );
    }
    const clientId = process.env[config.clientIdEnv];

    if (!clientId) {
      return NextResponse.json(
        { error: "Provider not configured" },
        { status: 500 }
      );
    }

    // Shopify requires a shop domain (e.g. "my-store")
    const shop = url.searchParams.get("shop");
    if (provider === "shopify" && !shop) {
      return NextResponse.json(
        { error: "Missing required 'shop' parameter for Shopify" },
        { status: 400 }
      );
    }
    if (shop && !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(shop)) {
      return NextResponse.json(
        { error: "Invalid shop domain format" },
        { status: 400 }
      );
    }

    // Optional onboarding thread id — when present, the callback redirects
    // back to /onboarding (with the result encoded in the query) instead
    // of the integrations page, and the OAuth state HMAC includes it so
    // tampering is rejected. See lib/oauth.ts v2 encoder.
    const threadId = url.searchParams.get("thread_id") || null;
    const { state, cookieValue } = generateOAuthState(companyId, { threadId });

    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/connections/oauth/callback`;
    const scopeSeparator = config.scopeSeparator ?? " ";

    const authParams = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      scope: config.scopes.join(scopeSeparator),
      redirect_uri: redirectUri,
      state,
      ...(config.extraAuthParams ?? {}),
    });

    // Substitute {shop} placeholder for Shopify
    let baseAuthUrl = config.authUrl;
    if (shop) {
      baseAuthUrl = baseAuthUrl.replace("{shop}", shop);
    }

    const authUrl = `${baseAuthUrl}?${authParams.toString()}`;

    // Set state nonce cookie
    const cookieStore = await cookies();
    cookieStore.set(OAUTH_STATE_COOKIE, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 300, // 5 minutes
    });

    // Set provider cookie so callback knows which provider to use
    cookieStore.set(OAUTH_PROVIDER_COOKIE, provider, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 300,
    });

    // Set shop cookie for Shopify so callback can substitute {shop} in tokenUrl
    if (shop) {
      cookieStore.set(OAUTH_SHOP_COOKIE, shop, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 300,
      });
    }

    return NextResponse.redirect(authUrl);
  } catch (err) {
    return handleApiError(err);
  }
}
