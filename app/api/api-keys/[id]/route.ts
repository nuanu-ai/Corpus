import { NextResponse } from "next/server";
import { getSessionAuthContext, handleApiError } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  normalizeApiKeyAllowedCompanyIds,
  normalizeApiKeyCompanyScopeMode,
} from "@/lib/api-key-company-scope";
import { normalizeApiKeyAccessPolicyVersion } from "@/lib/api-key-access-policy";
import { normalizeApiKeyScopes } from "@/lib/api-key-scopes";
import { buildApiKeySetupAccessInfo } from "@/lib/api-key-setup";

/**
 * DELETE /api/api-keys/[id] — Revoke an API key
 *
 * Soft-deletes the key by setting isRevoked = true.
 * Only the key owner (via session auth) can revoke their own keys.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await getSessionAuthContext();
    const { id } = await params;

    const result = await db
      .update(apiKeys)
      .set({ isRevoked: true })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.userId, userId),
          eq(apiKeys.isRevoked, false),
        ),
      )
      .returning({ id: apiKeys.id });

    if (result.length === 0) {
      return NextResponse.json(
        { error: "API key not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * GET /api/api-keys/[id] — Return metadata + setup info for one API key.
 *
 * Does not return the plaintext secret. Use /reveal for that.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await getSessionAuthContext();
    const { id } = await params;

    const rows = await db
      .select({
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
        lastUsedAt: apiKeys.lastUsedAt,
        isRevoked: apiKeys.isRevoked,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));

    const key = rows[0];
    if (!key) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    const companyScopeMode = normalizeApiKeyCompanyScopeMode(key.companyScopeMode);
    const accessPolicyVersion = normalizeApiKeyAccessPolicyVersion(key.apiKeyAccessPolicyVersion);
    const allowedCompanyIds = normalizeApiKeyAllowedCompanyIds(key.allowedCompanyIds);
    const access = await buildApiKeySetupAccessInfo(request, {
      defaultCompanyId:
        typeof key.defaultCompanyId === "string" ? key.defaultCompanyId : null,
      companyScopeMode,
      accessPolicyVersion,
      allowedCompanyIds,
    });

    return NextResponse.json({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      scopes: normalizeApiKeyScopes(key.scopes),
      companyScopeMode,
      accessPolicyVersion,
      defaultCompanyId:
        typeof key.defaultCompanyId === "string" ? key.defaultCompanyId : null,
      allowedCompanyIds,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      lastUsedAt: key.lastUsedAt,
      isRevoked: key.isRevoked,
      canRevealSecret: Boolean(key.keyEncrypted),
      access,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
