import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { oauthProviders } from "./oauth-providers";

const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_PROVIDER_COOKIE = "oauth_provider";
export const OAUTH_SHOP_COOKIE = "oauth_shop";

function getSigningKey(): string {
  const key = process.env.OAUTH_STATE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!key) {
    throw new Error("OAUTH_STATE_SECRET or BETTER_AUTH_SECRET must be set");
  }
  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", getSigningKey())
    .update(payload)
    .digest("hex");
}

/**
 * Generate an OAuth state token and companion cookie value.
 *
 * Two state formats are supported:
 *   v1 (legacy): companyId.nonce.timestamp.signature   (4 parts)
 *   v2:         v2.companyId.threadId.nonce.timestamp.signature   (6 parts)
 *
 * v2 carries an optional onboarding-thread id so the callback can post a
 * system message back into the originating chat. The threadId is HMAC'd
 * along with the rest of the payload — tampering is rejected. An empty
 * threadId (no onboarding context) is allowed and encoded as a literal
 * "0" placeholder so the dot-split stays length-stable.
 *
 * New issuances default to v2. Legacy v1 tokens still verify so in-flight
 * OAuth flows from before this change don't break.
 */
export function generateOAuthState(
  companyId: string,
  options?: { threadId?: string | null }
): {
  state: string;
  cookieValue: string;
} {
  const nonce = randomBytes(32).toString("hex");
  const timestamp = Date.now().toString();
  const threadId = options?.threadId && options.threadId.length > 0
    ? options.threadId
    : "0";

  // payload = v2.companyId.threadId.nonce.timestamp
  const payload = `v2.${companyId}.${threadId}.${nonce}.${timestamp}`;
  const signature = sign(payload);
  const state = `${payload}.${signature}`;

  return { state, cookieValue: nonce };
}

/**
 * Validate an OAuth state token against the cookie nonce.
 * Returns the companyId (and optional threadId, v2 only) on success,
 * throws on failure.
 */
export function validateOAuthState(
  state: string,
  cookieValue: string
): { companyId: string; threadId: string | null } {
  const parts = state.split(".");

  // v1: companyId.nonce.timestamp.signature (4 parts) — legacy, supported for in-flight flows
  if (parts.length === 4) {
    const [companyId, nonce, timestamp, signature] = parts;
    verifyNonce(nonce, cookieValue);
    verifySignature(`${companyId}.${nonce}.${timestamp}`, signature);
    verifyTtl(timestamp);
    return { companyId, threadId: null };
  }

  // v2: v2.companyId.threadId.nonce.timestamp.signature (6 parts)
  if (parts.length === 6 && parts[0] === "v2") {
    const [, companyId, threadIdRaw, nonce, timestamp, signature] = parts;
    verifyNonce(nonce, cookieValue);
    verifySignature(`v2.${companyId}.${threadIdRaw}.${nonce}.${timestamp}`, signature);
    verifyTtl(timestamp);
    return {
      companyId,
      threadId: threadIdRaw === "0" ? null : threadIdRaw,
    };
  }

  throw new Error("Invalid OAuth state format");
}

function verifyNonce(nonce: string, cookieValue: string): void {
  const nonceBuf = Buffer.from(nonce);
  const cookieBuf = Buffer.from(cookieValue);
  if (nonceBuf.length !== cookieBuf.length || !timingSafeEqual(nonceBuf, cookieBuf)) {
    throw new Error("OAuth state nonce mismatch");
  }
}

function verifySignature(payload: string, signature: string): void {
  const expectedSignature = sign(payload);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error("OAuth state signature invalid");
  }
}

function verifyTtl(timestamp: string): void {
  const stateTime = parseInt(timestamp, 10);
  if (isNaN(stateTime) || Date.now() - stateTime > STATE_TTL_MS) {
    throw new Error("OAuth state expired");
  }
}

/**
 * Exchange an authorization code for tokens from the provider's token endpoint.
 */
export async function exchangeCodeForTokens(
  provider: string,
  code: string,
  options?: { shop?: string }
): Promise<Record<string, unknown>> {
  const config = oauthProviders[provider];
  if (!config) {
    throw new Error(`Unknown OAuth provider: ${provider}`);
  }

  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];

  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing OAuth credentials for ${provider}: ${config.clientIdEnv} and/or ${config.clientSecretEnv}`
    );
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/connections/oauth/callback`;

  const params = {
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  };

  // Substitute {shop} placeholder for Shopify
  let tokenUrl = config.tokenUrl;
  if (options?.shop) {
    tokenUrl = tokenUrl.replace("{shop}", options.shop);
  }

  const requestFormat = config.tokenRequestFormat ?? "form";
  const headers =
    requestFormat === "json"
      ? { "Content-Type": "application/json" }
      : { "Content-Type": "application/x-www-form-urlencoded" };
  const body =
    requestFormat === "json"
      ? JSON.stringify(params)
      : new URLSearchParams(params).toString();

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers,
    body,
  });

  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      `Token exchange failed (${response.status}): ${text.slice(0, 200)}`
    );
  }

  if (payload && "ok" in payload && payload.ok === false) {
    const providerError =
      typeof payload.error === "string" ? payload.error : "unknown_provider_error";
    throw new Error(`Token exchange failed (${provider}): ${providerError}`);
  }

  if (!payload) {
    throw new Error(`Token exchange failed (${provider}): invalid JSON response`);
  }

  return payload;
}
