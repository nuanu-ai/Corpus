import { createHash, createHmac, timingSafeEqual } from "crypto";

export const INTERNAL_AUTH_VERSION = "v1";
export const DEFAULT_INTERNAL_AUTH_MAX_SKEW_MS = 5 * 60 * 1000;

export const INTERNAL_AUTH_HEADERS = {
  serviceId: "x-internal-service-id",
  version: "x-internal-auth-version",
  timestamp: "x-internal-auth-timestamp",
  bodySha256: "x-internal-auth-body-sha256",
  signature: "x-internal-auth-signature",
  companySlug: "x-company-slug",
  callerId: "x-caller-id",
  callerRole: "x-caller-role",
} as const;

export type InternalServiceSecretMap = Record<string, string>;

type HeaderCarrier =
  | Headers
  | Record<string, string | string[] | undefined>
  | Record<string, unknown>;

export interface InternalAuthClaims {
  serviceId: string;
  method: string;
  path: string;
  timestamp: string;
  companySlug?: string | null;
  callerId?: string | null;
  callerRole?: string | null;
  bodySha256?: string | null;
}

export interface BuildSignedInternalHeadersInput {
  serviceId: string;
  serviceSecret: string;
  method: string;
  path: string;
  body?: unknown;
  timestamp?: string;
  companySlug?: string | null;
  callerId?: string | null;
  callerRole?: string | null;
}

export interface VerifySignedInternalRequestInput {
  headers: HeaderCarrier;
  serviceSecrets: InternalServiceSecretMap;
  method: string;
  path: string;
  body?: unknown;
  maxSkewMs?: number;
}

export interface VerifiedInternalRequest {
  serviceId: string;
  callerId: string | null;
  callerRole: string | null;
  companySlug: string | null;
  authenticatedVia: "internal_service";
}

function readHeader(headers: HeaderCarrier, name: string): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  const direct = headers[name];
  if (Array.isArray(direct)) return direct[0];
  if (typeof direct === "string") return direct;

  const lower = headers[name.toLowerCase()];
  if (Array.isArray(lower)) return lower[0];
  if (typeof lower === "string") return lower;

  return undefined;
}

function normalizePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeClaimValue(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function safeCompareHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function hashInternalBody(body: unknown): string {
  const hash = createHash("sha256");

  if (body === null || body === undefined) {
    hash.update("");
    return hash.digest("hex");
  }

  if (typeof body === "string") {
    hash.update(body);
    return hash.digest("hex");
  }

  if (Buffer.isBuffer(body)) {
    hash.update(body);
    return hash.digest("hex");
  }

  if (body instanceof Uint8Array) {
    hash.update(body);
    return hash.digest("hex");
  }

  hash.update(JSON.stringify(body));
  return hash.digest("hex");
}

function canonicalizeClaims(claims: InternalAuthClaims): string {
  return [
    INTERNAL_AUTH_VERSION,
    claims.serviceId.trim(),
    claims.timestamp.trim(),
    claims.method.toUpperCase(),
    normalizePath(claims.path),
    normalizeClaimValue(claims.companySlug),
    normalizeClaimValue(claims.callerId),
    normalizeClaimValue(claims.callerRole),
    normalizeClaimValue(claims.bodySha256),
  ].join("\n");
}

export function signInternalAuthClaims(
  claims: InternalAuthClaims,
  serviceSecret: string,
): string {
  return createHmac("sha256", serviceSecret)
    .update(canonicalizeClaims(claims))
    .digest("hex");
}

export function buildSignedInternalHeaders(
  input: BuildSignedInternalHeadersInput,
): Record<string, string> {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const bodySha256 = hashInternalBody(input.body);
  const claims: InternalAuthClaims = {
    serviceId: input.serviceId,
    method: input.method,
    path: input.path,
    timestamp,
    companySlug: input.companySlug,
    callerId: input.callerId,
    callerRole: input.callerRole,
    bodySha256,
  };

  return {
    [INTERNAL_AUTH_HEADERS.serviceId]: input.serviceId,
    [INTERNAL_AUTH_HEADERS.version]: INTERNAL_AUTH_VERSION,
    [INTERNAL_AUTH_HEADERS.timestamp]: timestamp,
    [INTERNAL_AUTH_HEADERS.bodySha256]: bodySha256,
    [INTERNAL_AUTH_HEADERS.signature]: signInternalAuthClaims(claims, input.serviceSecret),
    ...(input.companySlug ? { [INTERNAL_AUTH_HEADERS.companySlug]: input.companySlug } : {}),
    ...(input.callerId ? { [INTERNAL_AUTH_HEADERS.callerId]: input.callerId } : {}),
    ...(input.callerRole ? { [INTERNAL_AUTH_HEADERS.callerRole]: input.callerRole } : {}),
  };
}

export function verifySignedInternalRequest(
  input: VerifySignedInternalRequestInput,
): VerifiedInternalRequest | null {
  const serviceId = readHeader(input.headers, INTERNAL_AUTH_HEADERS.serviceId)?.trim();
  const version = readHeader(input.headers, INTERNAL_AUTH_HEADERS.version)?.trim();
  const timestamp = readHeader(input.headers, INTERNAL_AUTH_HEADERS.timestamp)?.trim();
  const bodySha256 = readHeader(input.headers, INTERNAL_AUTH_HEADERS.bodySha256)?.trim() ?? "";
  const signature = readHeader(input.headers, INTERNAL_AUTH_HEADERS.signature)?.trim();
  const companySlug = readHeader(input.headers, INTERNAL_AUTH_HEADERS.companySlug)?.trim() ?? null;
  const callerId = readHeader(input.headers, INTERNAL_AUTH_HEADERS.callerId)?.trim() ?? null;
  const callerRole = readHeader(input.headers, INTERNAL_AUTH_HEADERS.callerRole)?.trim() ?? null;

  if (!serviceId || !version || !timestamp || !signature) {
    return null;
  }
  if (version !== INTERNAL_AUTH_VERSION) {
    return null;
  }

  const secret = input.serviceSecrets[serviceId];
  if (!secret) {
    return null;
  }

  const parsedTimestamp = Date.parse(timestamp);
  if (!Number.isFinite(parsedTimestamp)) {
    return null;
  }

  const maxSkewMs = input.maxSkewMs ?? DEFAULT_INTERNAL_AUTH_MAX_SKEW_MS;
  if (Math.abs(Date.now() - parsedTimestamp) > maxSkewMs) {
    return null;
  }

  if (input.body !== undefined && hashInternalBody(input.body) !== bodySha256) {
    return null;
  }

  const expected = signInternalAuthClaims(
    {
      serviceId,
      method: input.method,
      path: input.path,
      timestamp,
      companySlug,
      callerId,
      callerRole,
      bodySha256,
    },
    secret,
  );

  if (!safeCompareHex(signature, expected)) {
    return null;
  }

  return {
    serviceId,
    callerId,
    callerRole,
    companySlug,
    authenticatedVia: "internal_service",
  };
}

export function parseInternalServiceSecrets(
  jsonValue?: string | null,
  currentService?: { serviceId?: string | null; serviceSecret?: string | null },
): InternalServiceSecretMap {
  const secrets: InternalServiceSecretMap = {};

  if (jsonValue?.trim()) {
    const parsed = JSON.parse(jsonValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("COMPANY_DB_INTERNAL_SERVICE_SECRETS must be a JSON object");
    }

    for (const [serviceId, secret] of Object.entries(parsed)) {
      if (typeof secret !== "string" || secret.trim().length === 0) {
        throw new Error(`Invalid internal service secret for ${serviceId}`);
      }
      secrets[serviceId] = secret.trim();
    }
  }

  if (currentService?.serviceId && currentService.serviceSecret) {
    secrets[currentService.serviceId] = currentService.serviceSecret;
  }

  return secrets;
}

export function hasInternalServiceSecrets(
  serviceSecrets: InternalServiceSecretMap,
): boolean {
  return Object.values(serviceSecrets).some((secret) => secret.trim().length > 0);
}

export function getFirstInternalServiceSecret(
  serviceSecrets: InternalServiceSecretMap,
): string {
  return Object.values(serviceSecrets).find((secret) => secret.trim().length > 0) ?? "";
}
