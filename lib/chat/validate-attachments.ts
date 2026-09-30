/**
 * Anthropic's API rejects images whose base64-encoded payload exceeds
 * 5 MiB (5,242,880 bytes). The limit is on the **base64 string length**,
 * not the decoded binary — a 3.95 MB binary photo encodes to ~5.27 MB of
 * base64 and gets rejected even though the binary itself is well under
 * 5 MB. iPhone camera photos (HEIC, JPEG) routinely cross this line and
 * the failure surfaces silently — the request returns 200 but the SSE
 * channel emits an error event the mobile UI does not render.
 *
 * Pre-flight messages: walk the parts, look for `data:image/...;base64,XXX`
 * encoded payloads (assistant-ui inline images and file-style attachments
 * both end up here), and if any exceeds the limit, downscale via sharp
 * until both the binary AND its base64 form fit. The original part is
 * mutated in place.
 */
import sharp from "sharp";

/**
 * Threshold on the **base64 string length**, not the decoded binary —
 * matches Anthropic's actual enforcement.
 */
export const ANTHROPIC_BASE64_LIMIT_BYTES = 5 * 1024 * 1024;
/** Aim a bit below the limit so transport / JSON-escape overhead has room. */
const COMPRESS_TARGET_BASE64_BYTES = 4.5 * 1024 * 1024;
const RESIZE_STAGES: Array<{ width: number; quality: number }> = [
  { width: 2048, quality: 85 },
  { width: 1600, quality: 80 },
  { width: 1280, quality: 75 },
  { width: 1024, quality: 70 },
  { width: 768, quality: 65 },
];

const DATA_URL_RE = /^data:image\/([^;,]+)(?:;[^,]+)*;base64,([A-Za-z0-9+/=]+)/;
const PROBE_KEYS = ["image", "url", "data", "source"] as const;

/** Approximate base64 length when re-encoding a binary blob: 4 chars per 3 bytes, padded to 4. */
function expectedBase64Length(binaryBytes: number): number {
  return Math.ceil(binaryBytes / 3) * 4;
}

async function compressImageToJpeg(buffer: Buffer): Promise<Buffer | null> {
  for (const stage of RESIZE_STAGES) {
    try {
      const out = await sharp(buffer)
        .rotate()
        .resize({ width: stage.width, withoutEnlargement: true })
        .jpeg({ quality: stage.quality, mozjpeg: true })
        .toBuffer();
      if (expectedBase64Length(out.byteLength) <= COMPRESS_TARGET_BASE64_BYTES) {
        return out;
      }
    } catch (err) {
      console.warn(`[chat] sharp compression stage failed (width=${stage.width})`, err);
      return null;
    }
  }
  return null;
}

/**
 * Walks `messages[*].parts[*]` looking for oversized base64-encoded image
 * data URLs. Each oversized payload is rewritten in place to a downscaled
 * JPEG. Returns a summary of what was rewritten so the route can log it.
 *
 * Comparison is done on the **base64 string length** because that is what
 * Anthropic actually limits.
 */
export async function compressOversizedImages(
  messages: ReadonlyArray<{ parts: unknown[] }>,
): Promise<{ rewritten: number; failures: number; originalBase64Bytes: number; compressedBase64Bytes: number }> {
  let rewritten = 0;
  let failures = 0;
  let originalBase64Bytes = 0;
  let compressedBase64Bytes = 0;

  for (const message of messages) {
    const parts = message.parts ?? [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const partRecord = part as Record<string, unknown>;
      for (const key of PROBE_KEYS) {
        const value = partRecord[key];
        if (typeof value !== "string") continue;
        const match = value.match(DATA_URL_RE);
        if (!match) continue;
        const base64 = match[2];
        const base64Bytes = base64.length;
        if (base64Bytes <= ANTHROPIC_BASE64_LIMIT_BYTES) continue;

        const buffer = Buffer.from(base64, "base64");
        const compressed = await compressImageToJpeg(buffer);
        originalBase64Bytes += base64Bytes;
        if (!compressed) {
          failures += 1;
          continue;
        }
        const newBase64 = compressed.toString("base64");
        partRecord[key] = `data:image/jpeg;base64,${newBase64}`;
        // After re-encoding to JPEG, keep the canonical mediaType in sync so
        // sanitizeFileLikePart (and Anthropic) see a consistent type.
        if (typeof partRecord.mediaType === "string") {
          partRecord.mediaType = "image/jpeg";
        }
        compressedBase64Bytes += newBase64.length;
        rewritten += 1;
      }
    }
  }

  return { rewritten, failures, originalBase64Bytes, compressedBase64Bytes };
}
