import { fetchWithTimeoutAndRetry } from "@/lib/connectors/http";

const PAYPAL_API_BASE =
  process.env.PAYPAL_ENV === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";

const PAYPAL_TIMEOUT_MS = 15_000;

let cachedAccessToken: { value: string; expiresAtMs: number } | null = null;

async function getPayPalAccessToken(): Promise<string | null> {
  if (cachedAccessToken && cachedAccessToken.expiresAtMs > Date.now() + 30_000) {
    return cachedAccessToken.value;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  let response: Response;
  try {
    response = await fetchWithTimeoutAndRetry(
      `${PAYPAL_API_BASE}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
        }),
      },
      {
        timeoutMs: PAYPAL_TIMEOUT_MS,
        maxRetriesOn429: 1,
      },
    );
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    return null;
  }

  const expiresInSeconds = Math.max(0, data.expires_in ?? 0);
  cachedAccessToken = {
    value: data.access_token,
    expiresAtMs: Date.now() + Math.max(60, expiresInSeconds - 60) * 1000,
  };

  return data.access_token;
}

export function resetPayPalWebhookVerificationCache(): void {
  cachedAccessToken = null;
}

export async function verifyPayPalWebhookSignature(
  rawBody: string,
  headers: {
    transmissionId: string | null;
    transmissionTime: string | null;
    transmissionSig: string | null;
    authAlgo: string | null;
    certUrl: string | null;
  },
  webhookId = process.env.PAYPAL_WEBHOOK_ID
): Promise<boolean> {
  if (!webhookId) return false;
  if (
    !headers.transmissionId ||
    !headers.transmissionTime ||
    !headers.transmissionSig ||
    !headers.authAlgo ||
    !headers.certUrl
  ) {
    return false;
  }

  let webhookEvent: Record<string, unknown>;
  try {
    webhookEvent = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return false;
  }

  const accessToken = await getPayPalAccessToken();
  if (!accessToken) {
    return false;
  }

  let response: Response;
  try {
    response = await fetchWithTimeoutAndRetry(
      `${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transmission_id: headers.transmissionId,
          transmission_time: headers.transmissionTime,
          transmission_sig: headers.transmissionSig,
          cert_url: headers.certUrl,
          auth_algo: headers.authAlgo,
          webhook_id: webhookId,
          webhook_event: webhookEvent,
        }),
      },
      {
        timeoutMs: PAYPAL_TIMEOUT_MS,
        maxRetriesOn429: 1,
      },
    );
  } catch {
    return false;
  }

  if (!response.ok) {
    return false;
  }

  const data = (await response.json()) as {
    verification_status?: string;
  };

  return data.verification_status === "SUCCESS";
}
