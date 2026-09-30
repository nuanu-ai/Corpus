import { createHmac, timingSafeEqual } from "crypto";

/** Verify HMAC-SHA256 signature. Returns true only when the signature is valid. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string | undefined,
  encoding: "hex" | "base64" = "hex"
): boolean {
  if (!secret) {
    return false;
  }
  if (!signature) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(rawBody)
    .digest(encoding);
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
