import { createHash, timingSafeEqual } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { getPlaidClient } from "@/lib/connectors/plaid";

type PlaidWebhookVerificationClient = ReturnType<typeof getPlaidClient>;

type PlaidWebhookVerificationKey = {
  alg?: string | null;
  crv?: string | null;
  kid?: string | null;
  kty?: string | null;
  use?: string | null;
  x?: string | null;
  y?: string | null;
};

type PlaidWebhookVerificationResponse = {
  data?: {
    key?: PlaidWebhookVerificationKey | null;
  };
};

const PLAID_WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

const verificationKeyCache = new Map<string, PlaidWebhookVerificationKey>();

export function resetPlaidWebhookVerificationKeyCache(): void {
  verificationKeyCache.clear();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

async function fetchVerificationKey(
  kid: string,
  client: PlaidWebhookVerificationClient = getPlaidClient()
): Promise<PlaidWebhookVerificationKey | null> {
  const cachedKey = verificationKeyCache.get(kid);
  if (cachedKey) {
    return cachedKey;
  }

  let response: PlaidWebhookVerificationResponse;
  try {
    response = (await client.webhookVerificationKeyGet({
      key_id: kid,
    })) as PlaidWebhookVerificationResponse;
  } catch {
    return null;
  }

  const key = response.data?.key ?? null;

  if (!key) {
    return null;
  }

  verificationKeyCache.set(kid, key);
  return key;
}

/**
 * Verify a Plaid webhook signature using the official JWT/JWK flow.
 */
export async function verifyPlaidWebhookSignature(
  rawBody: string,
  signedJwt: string | null | undefined,
  options: {
    client?: PlaidWebhookVerificationClient;
    now?: Date;
  } = {}
): Promise<boolean> {
  if (!signedJwt) {
    return false;
  }

  let header: { alg?: string; kid?: string };
  try {
    header = decodeProtectedHeader(signedJwt);
  } catch {
    return false;
  }

  if (header.alg !== "ES256") {
    return false;
  }

  if (!header.kid) {
    return false;
  }

  const verificationKey = await fetchVerificationKey(
    header.kid,
    options.client
  );
  if (!verificationKey) {
    return false;
  }

  if (
    (verificationKey.alg && verificationKey.alg !== "ES256") ||
    (verificationKey.kty && verificationKey.kty !== "EC") ||
    (verificationKey.crv && verificationKey.crv !== "P-256") ||
    (verificationKey.use && verificationKey.use !== "sig") ||
    (verificationKey.kid && verificationKey.kid !== header.kid)
  ) {
    return false;
  }

  let payload: Record<string, unknown>;
  try {
    const publicKey = await importJWK(
      {
        alg: verificationKey.alg ?? undefined,
        crv: verificationKey.crv ?? undefined,
        kid: verificationKey.kid ?? undefined,
        kty: verificationKey.kty ?? undefined,
        use: verificationKey.use ?? undefined,
        x: verificationKey.x ?? undefined,
        y: verificationKey.y ?? undefined,
      },
      "ES256"
    );
    const verified = await jwtVerify(signedJwt, publicKey, {
      algorithms: ["ES256"],
    });
    payload = verified.payload as Record<string, unknown>;
  } catch {
    return false;
  }

  const issuedAt = payload.iat;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) {
    return false;
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - issuedAt) > PLAID_WEBHOOK_MAX_AGE_SECONDS) {
    return false;
  }

  const claimedHash = payload.request_body_sha256;
  if (typeof claimedHash !== "string" || !claimedHash) {
    return false;
  }

  const computedHash = sha256Hex(rawBody);
  return constantTimeEqualHex(
    computedHash.toLowerCase(),
    claimedHash.toLowerCase()
  );
}
