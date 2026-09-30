import {
  buildSignedInternalHeaders,
  parseInternalServiceSecrets,
} from "@/packages/company-db/src/internal-auth";

type HeaderMap = Record<string, string>;

interface BaseInternalHeadersInput {
  method: string;
  path: string;
  body?: unknown;
  contentType?: string | null;
}

interface RestInternalHeadersInput extends BaseInternalHeadersInput {
  companySlug: string;
  callerId: string;
  callerRole: string;
}

interface UrlBackedInternalHeadersInput extends Omit<BaseInternalHeadersInput, "path"> {
  url: string | URL;
}

interface UrlBackedRestInternalHeadersInput extends Omit<RestInternalHeadersInput, "path"> {
  url: string | URL;
}

function getInternalServiceId(): string {
  return process.env.COMPANY_DB_INTERNAL_SERVICE_ID?.trim() || "corpus-app";
}

function getCurrentServiceSecret(): string {
  const serviceId = getInternalServiceId();
  const serviceSecrets = parseInternalServiceSecrets(
    process.env.COMPANY_DB_INTERNAL_SERVICE_SECRETS,
    {
      serviceId,
      serviceSecret: process.env.COMPANY_DB_INTERNAL_SERVICE_SECRET,
    },
  );

  const configured = serviceSecrets[serviceId]?.trim() ?? "";
  if (configured) {
    return configured;
  }

  const allowInsecureDevSecret =
    process.env.NODE_ENV !== "production" &&
    process.env.COMPANY_DB_ALLOW_INSECURE_DEV_SECRET === "true";

  if (allowInsecureDevSecret) {
    return "dev-internal-service-secret";
  }

  return "";
}

function toRequestPath(url: string | URL): string {
  const resolved = typeof url === "string" ? new URL(url) : url;
  return `${resolved.pathname}${resolved.search}`;
}

export function isCompanyDbInternalAuthConfigured(): boolean {
  return Boolean(getCurrentServiceSecret());
}

export function getCompanyDbWriteIntentToken(): string {
  const serviceSecret = getCurrentServiceSecret();
  if (!serviceSecret) {
    throw new Error("Company-DB internal auth is not configured");
  }
  return serviceSecret;
}

function withContentType(headers: HeaderMap, contentType?: string | null): HeaderMap {
  if (!contentType) return headers;
  return {
    ...headers,
    "Content-Type": contentType,
  };
}

export function buildCompanyDbRestHeaders(
  input: RestInternalHeadersInput,
): HeaderMap {
  const internalServiceSecret = getCurrentServiceSecret();
  if (!internalServiceSecret) {
    throw new Error("Company-DB internal auth is not configured");
  }

  return withContentType(
    buildSignedInternalHeaders({
      serviceId: getInternalServiceId(),
      serviceSecret: internalServiceSecret,
      method: input.method,
      path: input.path,
      body: input.body,
      companySlug: input.companySlug,
      callerId: input.callerId,
      callerRole: input.callerRole,
    }),
    input.contentType ?? "application/json",
  );
}

export function buildCompanyDbQueueHeaders(
  input: BaseInternalHeadersInput,
): HeaderMap {
  const internalServiceSecret = getCurrentServiceSecret();
  if (!internalServiceSecret) {
    throw new Error("Company-DB internal auth is not configured");
  }

  return withContentType(
    buildSignedInternalHeaders({
      serviceId: getInternalServiceId(),
      serviceSecret: internalServiceSecret,
      method: input.method,
      path: input.path,
      body: input.body,
    }),
    input.contentType ?? "application/json",
  );
}

export function buildCompanyDbRestHeadersForUrl(
  input: UrlBackedRestInternalHeadersInput,
): HeaderMap {
  return buildCompanyDbRestHeaders({
    ...input,
    path: toRequestPath(input.url),
  });
}

export function buildCompanyDbQueueHeadersForUrl(
  input: UrlBackedInternalHeadersInput,
): HeaderMap {
  return buildCompanyDbQueueHeaders({
    ...input,
    path: toRequestPath(input.url),
  });
}
