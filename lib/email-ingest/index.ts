import {
  createHmac,
  createPublicKey,
  createVerify,
  randomBytes,
  timingSafeEqual,
} from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestAddress {
  companyId: string;
  token: string;
  full: string; // e.g. "a1b2c3d4e5f6@ingest.corpus.example"
}

export interface EmailValidation {
  valid: boolean;
  error?: string;
  token?: string;
}

export interface ParsedEmail {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  attachments: EmailAttachment[];
  spfResult: string;
  dkimResult: string;
  dmarcResult: string;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
}

export type EmailIngestSignatureStatus =
  | "not_configured"
  | "valid"
  | "missing"
  | "invalid"
  | "stale";

export interface EmailIngestSignatureResult {
  status: EmailIngestSignatureStatus;
  authenticated: boolean;
  provider: "sendgrid_inbound_parse_ecdsa" | "corpus_hmac_sha256";
  reason: string;
}

export interface SenderAllowlistResult {
  allowed: boolean;
  configured: boolean;
  senderEmail: string;
  reason: string;
  matchedEntry?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INGEST_DOMAIN = "ingest.corpus.example";
const RATE_LIMIT_PER_DAY = 50;

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".csv",
  ".xlsx",
  ".xls",
  ".png",
  ".jpg",
  ".jpeg",
  ".txt",
  ".md",
  ".html",
  ".htm",
  ".docx",
]);

// Regex: 12 hex chars @ingest.corpus.example
const INGEST_ADDRESS_REGEX = /^([a-f0-9]{12})@ingest\.corpus\.com$/i;
const EMAIL_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
const SENDGRID_SIGNATURE_HEADER = "x-twilio-email-event-webhook-signature";
const SENDGRID_TIMESTAMP_HEADER = "x-twilio-email-event-webhook-timestamp";

// ---------------------------------------------------------------------------
// Rate limiter state (in-memory)
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, number>();

function rateLimitKey(companyId: string): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
  return `${companyId}:${today}`;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/** Generate a unique ingest email address for a company. */
export function generateIngestAddress(companyId: string): IngestAddress {
  const token = randomBytes(6).toString("hex"); // 6 bytes = 12 hex chars
  const full = `${token}@${INGEST_DOMAIN}`;
  return { companyId, token, full };
}

/** Generate an ingest address whose token is not already assigned to another tenant. */
export async function generateUniqueIngestAddress(
  companyId: string,
  maxAttempts = 8,
): Promise<IngestAddress> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generateIngestAddress(companyId);
    const resolvedCompanyId = await resolveIngestCompany(candidate.token);
    if (!resolvedCompanyId || resolvedCompanyId === companyId) {
      return candidate;
    }
  }

  throw new Error("Failed to allocate a unique ingest address");
}

/** Parse a recipient email address to extract the ingest token. */
export function parseIngestAddress(
  email: string,
): { token: string } | null {
  const match = email.match(INGEST_ADDRESS_REGEX);
  if (!match) return null;
  return { token: match[1] };
}

/**
 * Validate that the email looks like a valid ingest address (format-only).
 * Use resolveIngestCompany() to look up the actual companyId from the token.
 */
export function validateIngestAddress(email: string): EmailValidation {
  const parsed = parseIngestAddress(email);
  if (!parsed) {
    return {
      valid: false,
      error: "Invalid ingest address format",
    };
  }

  return {
    valid: true,
    token: parsed.token,
  };
}

/** Look up the companyId for an ingest token by querying companies.settings. */
export async function resolveIngestCompany(token: string): Promise<string | null> {
  const { db } = await import("@/lib/db");
  const { companies } = await import("@/lib/db/schema");
  const { sql } = await import("drizzle-orm");

  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(sql`${companies.settings}->>'ingestToken' = ${token}`)
    .limit(1);

  return row?.id ?? null;
}

/**
 * Check SPF/DKIM/DMARC results from SendGrid headers.
 * Returns true if at least SPF or DKIM passes.
 */
export function validateEmailAuth(spf: string, dkim: string): boolean {
  const spfPasses = spf === "pass";
  const dkimPasses = dkim.includes("pass");
  return spfPasses || dkimPasses;
}

function safeCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) return false;
  return timingSafeEqual(aBuffer, bBuffer);
}

function normalizeSignature(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("sha256=") ? trimmed : `sha256=${trimmed}`;
}

function normalizeRawBody(rawBody: string | Buffer): Buffer {
  return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
}

function firstConfiguredEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

export function getEmailIngestWebhookSigningSecret(): string | null {
  return firstConfiguredEnv(
    "EMAIL_INGEST_WEBHOOK_SIGNING_SECRET",
    "CORPUS_EMAIL_INGEST_WEBHOOK_SIGNING_SECRET",
  );
}

export function getSendGridInboundParsePublicKey(): string | null {
  return firstConfiguredEnv(
    "SENDGRID_INBOUND_PARSE_PUBLIC_KEY",
    "CORPUS_SENDGRID_INBOUND_PARSE_PUBLIC_KEY",
    "SENDGRID_EMAIL_INGEST_PUBLIC_KEY",
    "SENDGRID_WEBHOOK_PUBLIC_KEY",
  );
}

export function hasSendGridInboundParseSignatureHeaders(
  headers: Pick<Headers, "get">,
): boolean {
  return Boolean(
    headers.get(SENDGRID_SIGNATURE_HEADER) ||
      headers.get(SENDGRID_TIMESTAMP_HEADER),
  );
}

function verifySendGridInboundParseSignature(input: {
  headers: Pick<Headers, "get">;
  rawBody: string | Buffer;
  publicKey?: string | null;
}): EmailIngestSignatureResult {
  const provider = "sendgrid_inbound_parse_ecdsa" as const;
  const publicKey = input.publicKey ?? getSendGridInboundParsePublicKey();
  if (!publicKey) {
    return {
      status: "not_configured",
      authenticated: false,
      provider,
      reason: "sendgrid_public_key_not_configured",
    };
  }

  const signature = input.headers.get(SENDGRID_SIGNATURE_HEADER)?.trim();
  const timestamp = input.headers.get(SENDGRID_TIMESTAMP_HEADER)?.trim();
  if (!signature || !timestamp) {
    return {
      status: "missing",
      authenticated: false,
      provider,
      reason: "sendgrid_signature_headers_missing",
    };
  }

  try {
    const key = publicKey.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(publicKey)
      : createPublicKey({
          key: Buffer.from(publicKey, "base64"),
          format: "der",
          type: "spki",
        });
    const verifier = createVerify("sha256");
    verifier.update(Buffer.from(timestamp));
    verifier.update(normalizeRawBody(input.rawBody));
    verifier.end();

    const authenticated = verifier.verify(key, Buffer.from(signature, "base64"));
    return authenticated
      ? {
          status: "valid",
          authenticated: true,
          provider,
          reason: "sendgrid_signature_verified",
        }
      : {
          status: "invalid",
          authenticated: false,
          provider,
          reason: "sendgrid_signature_mismatch",
        };
  } catch {
    return {
      status: "invalid",
      authenticated: false,
      provider,
      reason: "sendgrid_signature_verification_error",
    };
  }
}

function verifyCorpusHmacSignature(input: {
  headers: Pick<Headers, "get">;
  rawBody: string | Buffer;
  secret?: string | null;
  now?: Date;
}): EmailIngestSignatureResult {
  const provider = "corpus_hmac_sha256" as const;
  const secret = input.secret ?? getEmailIngestWebhookSigningSecret();
  if (!secret) {
    return {
      status: "not_configured",
      authenticated: false,
      provider,
      reason: "signing_secret_not_configured",
    };
  }

  const signature = normalizeSignature(
    input.headers.get("x-corpus-email-ingest-signature"),
  );
  if (!signature) {
    return {
      status: "missing",
      authenticated: false,
      provider,
      reason: "signature_header_missing",
    };
  }

  const timestamp = input.headers.get("x-corpus-email-ingest-timestamp")?.trim() ?? "";
  if (timestamp) {
    const timestampMs = Number.parseInt(timestamp, 10);
    const nowMs = input.now?.getTime() ?? Date.now();
    if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > EMAIL_SIGNATURE_MAX_AGE_MS) {
      return {
        status: "stale",
        authenticated: false,
        provider,
        reason: "signature_timestamp_stale",
      };
    }
  }

  const body = normalizeRawBody(input.rawBody);
  const signedPayload = timestamp
    ? Buffer.concat([Buffer.from(`${timestamp}.`), body])
    : body;
  const expected = `sha256=${createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex")}`;

  if (!safeCompare(signature, expected)) {
    return {
      status: "invalid",
      authenticated: false,
      provider,
      reason: "signature_mismatch",
    };
  }

  return {
    status: "valid",
    authenticated: true,
    provider,
    reason: "signature_verified",
  };
}

export function evaluateEmailIngestSignature(input: {
  headers: Pick<Headers, "get">;
  rawBody: string | Buffer;
  secret?: string | null;
  sendGridPublicKey?: string | null;
  now?: Date;
}): EmailIngestSignatureResult {
  const sendGridConfigured = Boolean(
    input.sendGridPublicKey ?? getSendGridInboundParsePublicKey(),
  );
  if (sendGridConfigured || hasSendGridInboundParseSignatureHeaders(input.headers)) {
    return verifySendGridInboundParseSignature({
      headers: input.headers,
      rawBody: input.rawBody,
      publicKey: input.sendGridPublicKey,
    });
  }

  return verifyCorpusHmacSignature(input);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeEmailAddress(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const angleMatch = trimmed.match(/<([^<>@\s]+@[^<>\s]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim().toLowerCase();
  const directMatch = trimmed.match(/([^\s<>]+@[^\s<>]+)/);
  return (directMatch?.[1] ?? trimmed).trim().toLowerCase();
}

function normalizeAllowlistEntries(settings?: Record<string, unknown> | null): {
  allowAll: boolean;
  entries: string[];
} {
  const root = asRecord(settings);
  const emailIngest = asRecord(root.emailIngest);
  const allowAll =
    emailIngest.allowAllSenders === true ||
    emailIngest.allowAll === true ||
    root.emailIngestAllowAllSenders === true;
  const entries = [
    ...asStringArray(emailIngest.allowedSenders),
    ...asStringArray(emailIngest.senderAllowlist),
    ...asStringArray(emailIngest.allowedSenderDomains),
    ...asStringArray(root.emailIngestSenderAllowlist),
    ...asStringArray(root.emailSenderAllowlist),
  ]
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return {
    allowAll,
    entries: Array.from(new Set(entries)),
  };
}

function senderMatchesEntry(senderEmail: string, entry: string): boolean {
  if (entry === "*") return true;
  if (entry.includes("@") && !entry.startsWith("@")) {
    return senderEmail === normalizeEmailAddress(entry);
  }

  const senderDomain = senderEmail.split("@")[1] ?? "";
  const domain = entry.startsWith("@") ? entry.slice(1) : entry;
  return senderDomain === domain;
}

export function evaluateSenderAllowlist(
  senderEmail: string,
  _companyId: string,
  settings?: Record<string, unknown> | null,
): SenderAllowlistResult {
  const normalizedSender = normalizeEmailAddress(senderEmail);
  const { allowAll, entries } = normalizeAllowlistEntries(settings);

  if (allowAll) {
    return {
      allowed: true,
      configured: true,
      senderEmail: normalizedSender,
      reason: "allow_all_senders_enabled",
    };
  }

  if (entries.length === 0) {
    return {
      allowed: true,
      configured: false,
      senderEmail: normalizedSender,
      reason: "sender_allowlist_not_configured",
    };
  }

  const matchedEntry = entries.find((entry) =>
    senderMatchesEntry(normalizedSender, entry),
  );
  if (matchedEntry) {
    return {
      allowed: true,
      configured: true,
      senderEmail: normalizedSender,
      matchedEntry,
      reason: "sender_allowlist_match",
    };
  }

  return {
    allowed: false,
    configured: true,
    senderEmail: normalizedSender,
    reason: "sender_not_allowlisted",
  };
}

/** Check sender email against company allowlist. */
export function checkSenderAllowlist(
  senderEmail: string,
  companyId: string,
  settings?: Record<string, unknown> | null,
): boolean {
  return evaluateSenderAllowlist(senderEmail, companyId, settings).allowed;
}

/**
 * Rate limit check. Returns true if under limit.
 * Simple in-memory rate limiter for now. 50 emails/day per company.
 */
export function checkRateLimit(companyId: string): boolean {
  const key = rateLimitKey(companyId);
  const current = rateLimitMap.get(key) ?? 0;

  if (current >= RATE_LIMIT_PER_DAY) {
    return false;
  }

  rateLimitMap.set(key, current + 1);
  return true;
}

/** Reset rate limits (for testing). */
export function resetRateLimits(): void {
  rateLimitMap.clear();
}

/** Extract file extension from filename. */
export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

/** Check if attachment is a supported file type for document processing. */
export function isSupportedAttachmentType(
  filename: string,
  _contentType: string,
): boolean {
  const ext = getFileExtension(filename);
  return SUPPORTED_EXTENSIONS.has(ext);
}
