import { auth } from "./auth";
import {
  getPersonalTenantMembership,
  expandCompanyMembershipsWithAccessGraph,
  expandCompanyMembershipsWithImportedChildren,
  listCompanyMemberships,
  requireCompanyWithRole,
  resolveDirectCompanyDomainPolicy,
  normalizeCompanyDomainAccessLevel,
  type CompanyMembership,
  type CompanyDomainAccessLevel,
  type CompanyDomainAccessLevelMap,
} from "./db/tenant";
import { ensurePersonalProjectForUser } from "./personal-projects";
import { getDefaultCompanyMembershipForUser } from "./default-company-context";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  NoCompanyError,
  UnauthorizedError,
  MissingCompanyHeaderError,
  AmbiguousCompanyContextError,
  ForbiddenError,
  InvalidCompanySelectorError,
} from "./errors";
import { createHash } from "crypto";
import { db } from "./db";
import { apiKeys } from "./db/schema";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import {
  ACTIVE_COMPANY_COOKIE,
  ACTIVE_COMPANY_COOKIE_OPTIONS,
  getRequestedCompanyIdFromHeaders,
} from "./company-context";
import {
  expandApiKeyScopesForCurrentContract,
  hasApiKeySuperScope,
  normalizeApiKeyScopes,
  type ApiKeyScope,
} from "./api-key-scopes";
import {
  normalizeApiKeyAllowedCompanyIds,
  normalizeApiKeyCompanyScopeMode,
  type ApiKeyCompanyScopeMode,
} from "./api-key-company-scope";
import {
  normalizeApiKeyAccessPolicyVersion,
  type ApiKeyAccessPolicyVersion,
} from "./api-key-access-policy";
import {
  getAccessibleCompaniesForApiKey,
  resolveApiKeyCompanyId,
} from "./api-key-access-runtime";
import {
  logGuardrailEvent,
  resolveGuardrailRollout,
} from "./guardrails/safe-rollout";

export type AuthContext = {
  userId: string;
  companyId: string;
  role: string;
  authMethod: "session" | "api_key";
  apiKeyScopes?: ApiKeyScope[];
  apiKeyCompanyScopeMode?: ApiKeyCompanyScopeMode;
  apiKeyDefaultCompanyId?: string | null;
  apiKeyAllowedCompanyIds?: string[];
  apiKeyAccessPolicyVersion?: ApiKeyAccessPolicyVersion;
  companyAccessSource?: CompanyMembership["accessSource"];
  companyViaCompanyId?: string | null;
  companyViaCompanyName?: string | null;
  companyViaCompanySlug?: string | null;
  companyRelationshipId?: string | null;
  companyRelationshipType?: string | null;
  companyAllowedDomains?: string[] | null;
  companyDomainAccessLevels?: CompanyDomainAccessLevelMap | null;
  companyAllowedConnectorScopes?: string[] | null;
  companyDomainAccessSource?: CompanyMembership["domainAccessSource"];
  companyPathEdgeIds?: string[] | null;
};

export type ApiKeyAuthContext = {
  keyId: string;
  userId: string;
  scopes: ApiKeyScope[];
  companyScopeMode: ApiKeyCompanyScopeMode;
  accessPolicyVersion: ApiKeyAccessPolicyVersion;
  defaultCompanyId: string | null;
  allowedCompanyIds: string[];
};

export type PersonalProjectAuthContext = {
  userId: string;
  projectId: string;
  role: string;
  authMethod: "session";
};

// Re-export for consumers that import from api-auth
export {
  NoCompanyError,
  UnauthorizedError,
  MissingCompanyHeaderError,
  AmbiguousCompanyContextError,
  InvalidCompanySelectorError,
};

/**
 * Authenticate via API key (Bearer token).
 * Reads Authorization header, validates the key, and returns key metadata.
 * Debounced lastUsedAt update: only writes if null or >5 minutes old.
 */
export async function getApiKeyContext(): Promise<ApiKeyAuthContext> {
  const hdrs = await headers();
  const authorization = hdrs.get("authorization");
  if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) throw new UnauthorizedError();

  const token = authorization.slice(7); // "bearer " is always 7 chars
  if (!token.startsWith("corpus_sk_")) throw new UnauthorizedError();

  const keyHash = createHash("sha256").update(token).digest("hex");

  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      userId: apiKeys.userId,
      scopes: apiKeys.scopes,
      companyScopeMode: apiKeys.companyScopeMode,
      apiKeyAccessPolicyVersion: apiKeys.apiKeyAccessPolicyVersion,
      defaultCompanyId: apiKeys.defaultCompanyId,
      allowedCompanyIds: apiKeys.allowedCompanyIds,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyHash, keyHash),
        eq(apiKeys.isRevoked, false),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date()))
      )
    )
    .limit(1);

  if (!rows.length) throw new UnauthorizedError();

  const key = rows[0];
  const normalizedScopes = normalizeApiKeyScopes(key.scopes);
  const resolvedScopes = expandApiKeyScopesForCurrentContract(normalizedScopes);
  const resolvedCompanyScopeMode = normalizeApiKeyCompanyScopeMode(key.companyScopeMode);
  const resolvedAccessPolicyVersion = normalizeApiKeyAccessPolicyVersion(
    key.apiKeyAccessPolicyVersion,
  );
  const resolvedDefaultCompanyId =
    typeof key.defaultCompanyId === "string" ? key.defaultCompanyId : null;
  const resolvedAllowedCompanyIds = normalizeApiKeyAllowedCompanyIds(key.allowedCompanyIds);

  // Debounced lastUsedAt update: only write if null or >5 minutes old
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const updatePatch: Partial<typeof apiKeys.$inferInsert> = {};
  if (
    Array.isArray(key.scopes) &&
    !hasApiKeySuperScope(normalizedScopes) &&
    resolvedScopes.length !== normalizedScopes.length
  ) {
    updatePatch.scopes = resolvedScopes;
  }
  if (!key.lastUsedAt || key.lastUsedAt < fiveMinutesAgo) {
    // Fire-and-forget; don't block the request
    updatePatch.lastUsedAt = now;
  }
  if (Object.keys(updatePatch).length > 0) {
    void Promise.resolve(
      db.update(apiKeys)
        .set(updatePatch)
        .where(eq(apiKeys.id, key.id)),
    ).catch((error) => {
      console.warn(
        `[api-auth] Failed to update api key metadata for key ${key.id}:`,
        error,
      );
    });
  }

  return {
    keyId: key.id,
    userId: key.userId,
    scopes: resolvedScopes,
    companyScopeMode: resolvedCompanyScopeMode,
    accessPolicyVersion: resolvedAccessPolicyVersion,
    defaultCompanyId: resolvedDefaultCompanyId,
    allowedCompanyIds: resolvedAllowedCompanyIds,
  };
}

export async function getApiKeyAccessibleCompanies(
  apiKey: ApiKeyAuthContext,
): Promise<CompanyMembership[]> {
  const memberships = await listCompanyMemberships(apiKey.userId);
  const scopedMemberships = getAccessibleCompaniesForApiKey(memberships, {
    companyScopeMode: apiKey.companyScopeMode,
    defaultCompanyId: apiKey.defaultCompanyId,
    allowedCompanyIds: apiKey.allowedCompanyIds,
  });

  switch (apiKey.accessPolicyVersion) {
    case "direct_only":
      return scopedMemberships.map((membership) => ({
        ...membership,
        accessSource: membership.accessSource ?? "direct",
      }));
    case "access_graph_v1":
      return expandCompanyMembershipsWithAccessGraph(scopedMemberships, {
        allowedConnectorScopes: apiKey.scopes,
      });
    case "legacy_imported_parent":
    default:
      return expandCompanyMembershipsWithImportedChildren(scopedMemberships);
  }
}

export async function getApiKeyAgentContext(): Promise<{
  apiKey: ApiKeyAuthContext;
  companies: CompanyMembership[];
}> {
  const apiKey = await getApiKeyContext();
  const companies = await getApiKeyAccessibleCompanies(apiKey);
  return { apiKey, companies };
}

export async function getApiKeyCompanyContext(): Promise<{
  apiKey: ApiKeyAuthContext;
  companies: CompanyMembership[];
  membership: CompanyMembership;
}> {
  const hdrs = await headers();
  const requestedCompanyId = getRequestedCompanyIdFromHeaders(hdrs);
  const { apiKey, companies } = await getApiKeyAgentContext();
  if (companies.length === 0) {
    throw new NoCompanyError();
  }

  const companyId = resolveApiKeyCompanyId(requestedCompanyId, companies, {
    companyScopeMode: apiKey.companyScopeMode,
    defaultCompanyId: apiKey.defaultCompanyId,
    allowedCompanyIds: apiKey.allowedCompanyIds,
  });

  if (!companyId) {
    if (requestedCompanyId) {
      throw new ForbiddenError(
        "API key does not grant access to the requested company",
      );
    }
    throw new AmbiguousCompanyContextError();
  }

  const membership = companies.find((company) => company.companyId === companyId);
  if (!membership) {
    throw new ForbiddenError(
      "API key does not grant access to the requested company",
    );
  }

  return { apiKey, companies, membership };
}

/**
 * Session-only auth for key management endpoints.
 * API keys must NOT be able to manage other API keys.
 */
export async function getSessionAuthContext(): Promise<{ userId: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new UnauthorizedError();
  return { userId: session.user.id };
}

async function resolveSessionCompanyContext(
  hdrs: Awaited<ReturnType<typeof headers>>,
  userId: string,
): Promise<AuthContext> {
  const headerCompanyId = hdrs.get("x-company-id")?.trim() || null;
  const requestedCompanyId = getRequestedCompanyIdFromHeaders(hdrs);

  let companyId: string;
  let role: string;
  try {
    const membership = requestedCompanyId
      ? await requireCompanyWithRole(userId, requestedCompanyId)
      : (await getDefaultCompanyMembershipForUser(userId)) ??
        (await requireCompanyWithRole(userId));
    companyId = membership.companyId;
    role = membership.role;
  } catch (err) {
    if (!(err instanceof UnauthorizedError) || !requestedCompanyId) {
      throw err;
    }
    const tenantFailClosedGuardrail = resolveGuardrailRollout({
      key: "tenant_fail_closed",
      companyId: requestedCompanyId,
    });
    logGuardrailEvent({
      decision: tenantFailClosedGuardrail,
      action: tenantFailClosedGuardrail.shouldEnforce
        ? "blocked_invalid_company_selector"
        : "would_block_invalid_company_selector",
      reason: headerCompanyId
        ? "invalid_x_company_id"
        : "stale_active_company_cookie",
      details: {
        authMethod: "session",
        explicitHeader: Boolean(headerCompanyId),
      },
    });

    if (tenantFailClosedGuardrail.shouldEnforce) {
      throw new InvalidCompanySelectorError(headerCompanyId ? "header" : "cookie");
    }

    const membership =
      (await getDefaultCompanyMembershipForUser(userId)) ??
      (await requireCompanyWithRole(userId));
    companyId = membership.companyId;
    role = membership.role;
  }

  const domainPolicy = await resolveDirectCompanyDomainPolicy(userId, companyId, role);

  return {
    userId,
    companyId,
    role,
    authMethod: "session",
    companyAccessSource: "direct",
    companyAllowedDomains: domainPolicy.allowedDomains,
    companyDomainAccessLevels: domainPolicy.accessLevels ?? null,
    companyDomainAccessSource: domainPolicy.source,
  };
}

/**
 * Session-only auth with company membership resolution.
 * Use for browser-managed admin/lifecycle routes that must not accept API keys.
 */
export async function getSessionCompanyContext(): Promise<AuthContext> {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session?.user) throw new UnauthorizedError();
  return resolveSessionCompanyContext(hdrs, session.user.id);
}

/**
 * Session-only auth for personal project routes.
 * Personal routes are intentionally not exposed through API keys in the first rollout.
 */
export async function getSessionPersonalProjectContext(): Promise<PersonalProjectAuthContext> {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session?.user) throw new UnauthorizedError();

  let membership = await getPersonalTenantMembership(session.user.id);
  if (!membership) {
    await ensurePersonalProjectForUser({
      userId: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
    });
    membership = await getPersonalTenantMembership(session.user.id);
  }
  if (!membership) {
    throw new Error("Personal project not found");
  }

  return {
    userId: session.user.id,
    projectId: membership.tenantId,
    role: membership.role,
    authMethod: "session",
  };
}

/**
 * Unified auth context: tries session cookie first, then API key.
 * API keys resolve tenant membership from their explicit company-scope policy.
 */
export async function getAuthContext(): Promise<AuthContext> {
  const hdrs = await headers();
  const requestedCompanyId = getRequestedCompanyIdFromHeaders(hdrs);

  // 1. Try session cookie first
  const session = await auth.api.getSession({ headers: hdrs });
  if (session?.user) {
    return resolveSessionCompanyContext(hdrs, session.user.id);
  }

  // 2. No session — try API key
  const authorization = hdrs.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const apiKey = await getApiKeyContext();
    const companies = await getApiKeyAccessibleCompanies(apiKey);
    if (companies.length === 0) {
      throw new NoCompanyError();
    }
    const companyId = resolveApiKeyCompanyId(requestedCompanyId, companies, {
      companyScopeMode: apiKey.companyScopeMode,
      defaultCompanyId: apiKey.defaultCompanyId,
      allowedCompanyIds: apiKey.allowedCompanyIds,
    });

    if (!companyId) {
      if (requestedCompanyId) {
        throw new ForbiddenError(
          "API key does not grant access to the requested company",
        );
      }
      throw new AmbiguousCompanyContextError();
    }

    const membership = companies.find((company) => company.companyId === companyId);
    if (!membership) {
      throw new ForbiddenError(
        "API key does not grant access to the requested company",
      );
    }

    return {
      userId: apiKey.userId,
      companyId: membership.companyId,
      role: membership.role,
      authMethod: "api_key",
      apiKeyScopes: apiKey.scopes,
      apiKeyCompanyScopeMode: apiKey.companyScopeMode,
      apiKeyAccessPolicyVersion: apiKey.accessPolicyVersion,
      apiKeyDefaultCompanyId: apiKey.defaultCompanyId,
      apiKeyAllowedCompanyIds: apiKey.allowedCompanyIds,
      companyAccessSource: membership.accessSource ?? "direct",
      companyViaCompanyId: membership.viaCompanyId ?? null,
      companyViaCompanyName: membership.viaCompanyName ?? null,
      companyViaCompanySlug: membership.viaCompanySlug ?? null,
      companyRelationshipId: membership.relationshipId ?? null,
      companyRelationshipType: membership.relationshipType ?? null,
      companyAllowedDomains: membership.allowedDomains ?? null,
      companyDomainAccessLevels: membership.domainAccessLevels ?? null,
      companyAllowedConnectorScopes: membership.allowedConnectorScopes ?? null,
      companyDomainAccessSource: membership.domainAccessSource ?? null,
      companyPathEdgeIds: membership.pathEdgeIds ?? null,
    };
  }

  // 3. Neither session nor bearer token
  throw new UnauthorizedError();
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (err instanceof NoCompanyError) {
    return NextResponse.json({ error: "No company found" }, { status: 403 });
  }
  if (err instanceof MissingCompanyHeaderError) {
    return NextResponse.json(
      { error: "x-company-id header required for API key auth" },
      { status: 400 }
    );
  }
  if (err instanceof AmbiguousCompanyContextError) {
    return NextResponse.json(
      { error: err.message },
      { status: 400 },
    );
  }
  if (err instanceof InvalidCompanySelectorError) {
    const response = NextResponse.json(
      {
        error: err.message,
        code: err.code,
        selectorSource: err.selectorSource,
      },
      {
        status: 403,
        headers: {
          "X-CORPUS-Recoverable": "invalid-active-company-selector",
        },
      },
    );
    if (err.selectorSource === "cookie") {
      response.cookies.set(ACTIVE_COMPANY_COOKIE, "", {
        ...ACTIVE_COMPANY_COOKIE_OPTIONS,
        maxAge: 0,
      });
    }
    return response;
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }

  // Stale Server Action POSTs from old browser tabs hit our API with
  // `application/json` instead of `multipart/form-data` and Next.js
  // throws TypeError("Content-Type was not …"). It's not actionable —
  // the user just needs to refresh — and floods nextjs-error.log.
  // Surface it as a 415 with a hint and skip the noisy stack trace.
  if (
    err instanceof TypeError &&
    typeof err.message === "string" &&
    err.message.includes("Content-Type was not")
  ) {
    return NextResponse.json(
      {
        error:
          "Stale Server Action — please refresh the page and try again.",
      },
      { status: 415 },
    );
  }

  console.error("Unhandled API error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export function requireApiKeyScope(auth: AuthContext, scope: ApiKeyScope): void {
  if (auth.authMethod !== "api_key") return;
  const scopes = auth.apiKeyScopes ?? [];
  requireGrantedApiKeyScope(scopes, scope);
}

const COMPANY_DOMAIN_ACCESS_LEVEL_RANK: Record<CompanyDomainAccessLevel, number> = {
  metadata: 0,
  read: 1,
  file: 2,
  write: 3,
  admin: 4,
};

function domainAccessLevelForAuth(
  levels: CompanyDomainAccessLevelMap | null | undefined,
  domain: string,
): CompanyDomainAccessLevel | null {
  if (!levels) return null;
  return levels[domain] ?? levels["*"] ?? null;
}

function hasGrantedCompanyDomainAccessLevel(
  grantedLevel: CompanyDomainAccessLevel | null,
  requiredLevel: CompanyDomainAccessLevel,
): boolean {
  return Boolean(
    grantedLevel &&
    COMPANY_DOMAIN_ACCESS_LEVEL_RANK[grantedLevel] >=
      COMPANY_DOMAIN_ACCESS_LEVEL_RANK[requiredLevel],
  );
}

export function requireCompanyDomainAccess(
  auth: AuthContext,
  requestedDomain: string | null | undefined,
  requiredAccessLevel: CompanyDomainAccessLevel = "read",
): void {
  const restrictedDomains = Array.isArray(auth.companyAllowedDomains)
    ? auth.companyAllowedDomains
    : null;
  const accessLevels = auth.companyDomainAccessLevels ?? null;
  if (!restrictedDomains && !accessLevels) return;

  const domain = requestedDomain?.trim().toLowerCase() ?? "";
  const requiredLevel = normalizeCompanyDomainAccessLevel(requiredAccessLevel);
  if (!domain) {
    const wildcardLevel = domainAccessLevelForAuth(accessLevels, "*");
    if (
      !restrictedDomains &&
      hasGrantedCompanyDomainAccessLevel(wildcardLevel, requiredLevel)
    ) {
      return;
    }
    if (auth.companyAccessSource === "inherited") {
      throw new ForbiddenError(
        "Inherited company access requires an explicit Company-DB domain",
      );
    }
    throw new ForbiddenError(
      "Restricted company access requires an explicit Company-DB domain",
    );
  }

  if (restrictedDomains) {
    const allowedDomains = new Set(restrictedDomains);
    if (!allowedDomains.has(domain)) {
      if (auth.companyAccessSource === "inherited") {
        throw new ForbiddenError(
          `Inherited access to this company does not include ${domain} domain`,
        );
      }
      throw new ForbiddenError(
        `Company access to this company does not include ${domain} domain`,
      );
    }
  }

  const grantedLevel = domainAccessLevelForAuth(accessLevels, domain);
  if (auth.companyAccessSource === "inherited" && !accessLevels) {
    throw new ForbiddenError(
      `Inherited access to ${domain} domain does not include ${requiredLevel} level`,
    );
  }
  if (accessLevels && !grantedLevel) {
    if (auth.companyAccessSource === "inherited") {
      throw new ForbiddenError(
        `Inherited access to this company does not include ${domain} domain`,
      );
    }
    throw new ForbiddenError(
      `Company access to this company does not include ${domain} domain`,
    );
  }
  if (
    grantedLevel &&
    !hasGrantedCompanyDomainAccessLevel(grantedLevel, requiredLevel)
  ) {
    if (auth.companyAccessSource === "inherited") {
      throw new ForbiddenError(
        `Inherited access to ${domain} domain does not include ${requiredLevel} level`,
      );
    }
    throw new ForbiddenError(
      `Company access to ${domain} domain does not include ${requiredLevel} level`,
    );
  }
}

export const requireCompanyDbDomainAccess = requireCompanyDomainAccess;

export function requireCompanyDbMcpAccess(auth: AuthContext): void {
  const restrictedDomains =
    Array.isArray(auth.companyAllowedDomains) || Boolean(auth.companyDomainAccessLevels);
  if (!restrictedDomains) return;
  if (
    !Array.isArray(auth.companyAllowedDomains) &&
    hasGrantedCompanyDomainAccessLevel(
      domainAccessLevelForAuth(auth.companyDomainAccessLevels, "*"),
      "admin",
    )
  ) {
    return;
  }

  if (auth.companyAccessSource === "inherited") {
    throw new ForbiddenError(
      "Inherited Company-DB MCP access is blocked until a domain-scoped MCP contract exists",
    );
  }
  throw new ForbiddenError(
    "Restricted Company-DB MCP access is blocked until a domain-scoped MCP contract exists",
  );
}

export function requireInheritedConnectorAccess(
  membership: CompanyMembership,
  acceptedScopes?: readonly ApiKeyScope[],
): void {
  if (membership.accessSource !== "inherited") return;

  const allowedScopes = new Set(membership.allowedConnectorScopes ?? []);
  if (acceptedScopes && acceptedScopes.length > 0) {
    if (acceptedScopes.some((scope) => allowedScopes.has(scope))) return;
    throw new ForbiddenError(
      `Inherited access to this company does not include connector scope: ${acceptedScopes.join(", ")}`,
    );
  }

  if (allowedScopes.size === 0) {
    throw new ForbiddenError(
      "Inherited access to this company does not include connector access",
    );
  }
}

export function requireGrantedApiKeyScope(
  scopes: ApiKeyScope[],
  scope: ApiKeyScope,
): void {
  if (hasApiKeySuperScope(scopes)) return;
  if (!scopes.includes(scope)) {
    throw new ForbiddenError(`API key missing required scope: ${scope}`);
  }
}

export function requireOneOfGrantedApiKeyScopes(
  scopes: ApiKeyScope[],
  acceptedScopes: ApiKeyScope[],
): void {
  if (hasApiKeySuperScope(scopes)) return;
  if (acceptedScopes.some((scope) => scopes.includes(scope))) {
    return;
  }
  throw new ForbiddenError(
    `API key missing required scope. Accepted scopes: ${acceptedScopes.join(", ")}`,
  );
}
