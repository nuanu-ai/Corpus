import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { getSessionAuthContext, getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  DEFAULT_API_KEY_COMPANY_SCOPE_MODE,
  normalizeApiKeyAllowedCompanyIds,
  normalizeApiKeyCompanyScopeMode,
} from "@/lib/api-key-company-scope";
import {
  normalizeApiKeyAccessPolicyVersion,
} from "@/lib/api-key-access-policy";
import {
  API_KEY_SCOPES,
  DEFAULT_API_KEY_SCOPES,
  normalizeApiKeyScopes,
} from "@/lib/api-key-scopes";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { listCompanyMemberships } from "@/lib/db/tenant";
import { eq, and, desc } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { buildApiKeySetupAccessInfo } from "@/lib/api-key-setup";

const MAX_ACTIVE_KEYS = 25;

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error("ENCRYPTION_KEY is required");
  }
  return key;
}

/**
 * POST /api/api-keys — Create a new API key
 *
 * Returns the full plaintext key ONLY in this response.
 * The key is stored as a SHA-256 hash. New keys are also stored encrypted at rest
 * so the owner can reopen setup instructions later from Settings.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getSessionCompanyContext();
    const { userId } = auth;
    const memberships = await listCompanyMemberships(userId);
    const membershipIds = new Set(memberships.map((membership) => membership.companyId));

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { name, expiresAt, scopes } = body ?? {};
    const requestedCompanyScopeMode = normalizeApiKeyCompanyScopeMode(
      body.companyScopeMode,
    );
    const requestedAllowedCompanyIds = normalizeApiKeyAllowedCompanyIds(
      body.allowedCompanyIds,
    );
    const requestedDefaultCompanyId = stringOrNull(body.defaultCompanyId);
    const requestedAccessPolicyVersion = normalizeApiKeyAccessPolicyVersion(
      body.accessPolicyVersion,
    );

    // Validate name
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 },
      );
    }
    if (name.length > 100) {
      return NextResponse.json(
        { error: "Name must be 100 characters or fewer" },
        { status: 400 },
      );
    }

    // Validate expiresAt if provided
    let parsedExpiresAt: Date | null = null;
    if (expiresAt !== undefined && expiresAt !== null) {
      if (typeof expiresAt !== "string") {
        return NextResponse.json(
          { error: "expiresAt must be an ISO 8601 string" },
          { status: 400 },
        );
      }
      parsedExpiresAt = new Date(expiresAt);
      if (isNaN(parsedExpiresAt.getTime())) {
        return NextResponse.json(
          { error: "Invalid expiresAt date" },
          { status: 400 },
        );
      }
      if (parsedExpiresAt <= new Date()) {
        return NextResponse.json(
          { error: "expiresAt must be a future date" },
          { status: 400 },
        );
      }
    }

    if (scopes !== undefined && !Array.isArray(scopes)) {
      return NextResponse.json(
        { error: "scopes must be an array of strings" },
        { status: 400 },
      );
    }
    if (Array.isArray(scopes) && scopes.some((scope) => !API_KEY_SCOPES.includes(scope))) {
      return NextResponse.json(
        { error: "scopes contains unsupported values" },
        { status: 400 },
      );
    }
    if (Array.isArray(scopes) && scopes.length === 0) {
      return NextResponse.json(
        { error: "At least one scope is required" },
        { status: 400 },
      );
    }

    const invalidAllowedCompanyIds = requestedAllowedCompanyIds.filter(
      (companyId) => !membershipIds.has(companyId),
    );
    if (invalidAllowedCompanyIds.length > 0) {
      return NextResponse.json(
        { error: "allowedCompanyIds contains companies outside your access" },
        { status: 400 },
      );
    }

    if (
      requestedDefaultCompanyId &&
      !membershipIds.has(requestedDefaultCompanyId)
    ) {
      return NextResponse.json(
        { error: "defaultCompanyId must be one of your accessible companies" },
        { status: 400 },
      );
    }

    // Count non-revoked keys (includes expired — users should revoke expired keys to free slots)
    const activeKeys = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), eq(apiKeys.isRevoked, false)));

    if (activeKeys.length >= MAX_ACTIVE_KEYS) {
      return NextResponse.json(
        { error: "Maximum of 25 active API keys reached" },
        { status: 400 },
      );
    }

    // Generate key
    const randomHex = randomBytes(16).toString("hex"); // 32 hex chars
    const fullKey = `corpus_sk_${randomHex}`;
    const keyHash = createHash("sha256").update(fullKey).digest("hex");
    const keyPrefix = randomHex.slice(0, 8);
    const keyEncrypted = encrypt(fullKey, getEncryptionKey());

    const resolvedScopes = Array.isArray(scopes)
      ? normalizeApiKeyScopes(scopes)
      : [...DEFAULT_API_KEY_SCOPES];

    let companyScopeMode = requestedCompanyScopeMode;
    let defaultCompanyId: string | null = requestedDefaultCompanyId;
    let allowedCompanyIds: string[] = [];

    switch (companyScopeMode) {
      case "single_company": {
        defaultCompanyId = requestedDefaultCompanyId ?? auth.companyId;
        if (!defaultCompanyId || !membershipIds.has(defaultCompanyId)) {
          return NextResponse.json(
            { error: "single_company keys require an accessible defaultCompanyId" },
            { status: 400 },
          );
        }
        allowedCompanyIds = [defaultCompanyId];
        break;
      }
      case "selected_companies": {
        if (requestedAllowedCompanyIds.length === 0) {
          return NextResponse.json(
            { error: "selected_companies keys require allowedCompanyIds" },
            { status: 400 },
          );
        }
        allowedCompanyIds = requestedAllowedCompanyIds;
        defaultCompanyId =
          requestedDefaultCompanyId ??
          (allowedCompanyIds.includes(auth.companyId)
            ? auth.companyId
            : allowedCompanyIds[0]);
        if (!defaultCompanyId || !allowedCompanyIds.includes(defaultCompanyId)) {
          return NextResponse.json(
            {
              error:
                "defaultCompanyId must be included in allowedCompanyIds for selected_companies keys",
            },
            { status: 400 },
          );
        }
        break;
      }
      case "all_user_companies": {
        if (requestedAllowedCompanyIds.length > 0) {
          return NextResponse.json(
            { error: "allowedCompanyIds is not supported for all_user_companies keys" },
            { status: 400 },
          );
        }
        defaultCompanyId = requestedDefaultCompanyId ?? auth.companyId;
        allowedCompanyIds = [];
        break;
      }
      default: {
        companyScopeMode = DEFAULT_API_KEY_COMPANY_SCOPE_MODE;
        defaultCompanyId = auth.companyId;
        allowedCompanyIds = [auth.companyId];
      }
    }

    // Insert
    const [inserted] = await db
      .insert(apiKeys)
      .values({
        userId,
        name: name.trim(),
        keyHash,
        keyPrefix,
        keyEncrypted,
        scopes: resolvedScopes,
        companyScopeMode,
        apiKeyAccessPolicyVersion: requestedAccessPolicyVersion,
        defaultCompanyId,
        allowedCompanyIds,
        expiresAt: parsedExpiresAt,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        keyEncrypted: apiKeys.keyEncrypted,
        scopes: apiKeys.scopes,
        companyScopeMode: apiKeys.companyScopeMode,
        apiKeyAccessPolicyVersion: apiKeys.apiKeyAccessPolicyVersion,
        defaultCompanyId: apiKeys.defaultCompanyId,
        allowedCompanyIds: apiKeys.allowedCompanyIds,
        createdAt: apiKeys.createdAt,
        expiresAt: apiKeys.expiresAt,
      });

    const access = await buildApiKeySetupAccessInfo(req, {
      defaultCompanyId: inserted.defaultCompanyId,
      companyScopeMode: inserted.companyScopeMode,
      accessPolicyVersion: normalizeApiKeyAccessPolicyVersion(
        inserted.apiKeyAccessPolicyVersion,
      ),
      allowedCompanyIds: inserted.allowedCompanyIds ?? [],
    });

    return NextResponse.json(
      {
        id: inserted.id,
        name: inserted.name,
        key: fullKey,
        keyPrefix: inserted.keyPrefix,
        scopes: normalizeApiKeyScopes(inserted.scopes),
        companyScopeMode: inserted.companyScopeMode,
        accessPolicyVersion: normalizeApiKeyAccessPolicyVersion(inserted.apiKeyAccessPolicyVersion),
        defaultCompanyId: inserted.defaultCompanyId,
        allowedCompanyIds: inserted.allowedCompanyIds ?? [],
        canRevealSecret: Boolean(inserted.keyEncrypted),
        createdAt: inserted.createdAt,
        expiresAt: inserted.expiresAt,
        access,
      },
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * GET /api/api-keys — List all API keys for the current user
 *
 * Returns metadata only; never returns the full key or keyHash.
 */
export async function GET() {
  try {
    const { userId } = await getSessionAuthContext();

    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        companyScopeMode: apiKeys.companyScopeMode,
        apiKeyAccessPolicyVersion: apiKeys.apiKeyAccessPolicyVersion,
        defaultCompanyId: apiKeys.defaultCompanyId,
        allowedCompanyIds: apiKeys.allowedCompanyIds,
        keyEncrypted: apiKeys.keyEncrypted,
        createdAt: apiKeys.createdAt,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt,
        isRevoked: apiKeys.isRevoked,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt));

    return NextResponse.json(
      keys.map((key) => ({
        ...key,
        scopes: normalizeApiKeyScopes(key.scopes),
        companyScopeMode: normalizeApiKeyCompanyScopeMode(key.companyScopeMode),
        accessPolicyVersion: normalizeApiKeyAccessPolicyVersion(key.apiKeyAccessPolicyVersion),
        defaultCompanyId:
          typeof key.defaultCompanyId === "string" ? key.defaultCompanyId : null,
        allowedCompanyIds: normalizeApiKeyAllowedCompanyIds(key.allowedCompanyIds),
        canRevealSecret: Boolean(key.keyEncrypted),
      })),
    );
  } catch (err) {
    return handleApiError(err);
  }
}
