import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

export type MicrosoftServicePrincipalCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

const MICROSOFT_AUTH_TIMEOUT_MS = 15_000;
const MICROSOFT_TOKEN_SKEW_MS = 60_000;

interface MicrosoftTokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

const microsoftTokenCache = new Map<string, MicrosoftTokenCacheEntry>();

function normalizeCredential(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getMicrosoftServicePrincipalCredentials(
  credentials: Record<string, unknown>,
): MicrosoftServicePrincipalCredentials | null {
  const tenantId = normalizeCredential(credentials.tenantId);
  const clientId = normalizeCredential(credentials.clientId);
  const clientSecret = normalizeCredential(credentials.clientSecret);

  if (!tenantId || !clientId || !clientSecret) {
    return null;
  }

  return {
    tenantId,
    clientId,
    clientSecret,
  };
}

export async function getMicrosoftAccessToken(
  credentials: MicrosoftServicePrincipalCredentials,
  scope: string,
): Promise<string> {
  const cacheKey = [
    credentials.tenantId,
    credentials.clientId,
    scope,
    credentials.clientSecret,
  ].join("|");
  const cached = microsoftTokenCache.get(cacheKey);
  if (cached && cached.expiresAt - MICROSOFT_TOKEN_SKEW_MS > Date.now()) {
    return cached.accessToken;
  }

  const tokenUrl = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`,
  );

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    scope,
  });

  const response = await fetchWithTimeoutAndRetry(
    tokenUrl,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      cache: "no-store",
    },
    {
      timeoutMs: MICROSOFT_AUTH_TIMEOUT_MS,
      maxRetriesOn429: 1,
    },
  );

  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const providerError =
      typeof payload?.error_description === "string"
        ? payload.error_description
        : typeof payload?.error === "string"
          ? payload.error
          : `Token request failed (${response.status})`;
    throw new Error(providerError);
  }

  const accessToken = payload?.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Microsoft token response did not include access_token");
  }

  const expiresIn = payload?.expires_in;
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) {
    microsoftTokenCache.set(cacheKey, {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
    });
  } else {
    microsoftTokenCache.delete(cacheKey);
  }

  return accessToken;
}

export function clearMicrosoftAccessTokenCache(): void {
  microsoftTokenCache.clear();
}
