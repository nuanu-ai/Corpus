import { NextRequest, NextResponse } from "next/server";
import { NoCompanyError, getApiKeyAgentContext, handleApiError } from "@/lib/api-auth";
import { resolveApiKeyCompanyId } from "@/lib/api-key-access-runtime";
import { issueEmbedApiKeyTicket, verifyEmbedApiKeyTicket } from "@/lib/embed-api-key-ticket";
import { auth } from "@/lib/auth";
import { listCompanyMemberships } from "@/lib/db/tenant";
import {
  resolveTrustedAppBaseUrl,
  sanitizeEmbedReturnUrl,
  sanitizeEmbedTargetPath,
} from "@/lib/embed-config";
import { ForbiddenError } from "@/lib/errors";
import { registerSingleUseTicket } from "@/lib/single-use-ticket-store";

function normalizeAuthUserId(value: unknown): string | null {
  const candidate =
    typeof value === "object" &&
    value !== null &&
    "user" in (value as Record<string, unknown>) &&
    typeof (value as { user?: unknown }).user === "object" &&
    (value as { user: unknown }).user !== null
      ? (value as { user: Record<string, unknown> }).user
      : (value as Record<string, unknown> | null);
  const userId = candidate?.id;
  return typeof userId === "string" && userId.trim().length > 0
    ? userId.trim()
    : null;
}

async function resolveActingUserId(
  actingUserEmail: string,
  companyId: string,
): Promise<string | null> {
  const ctx = await auth.$context;
  const actingUser = await ctx.internalAdapter.findUserByEmail(actingUserEmail);
  const actingUserId = normalizeAuthUserId(actingUser);
  if (!actingUserId) {
    return null;
  }

  const memberships = await listCompanyMemberships(actingUserId);
  return memberships.some((membership) => membership.companyId === companyId)
    ? actingUserId
    : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedCompanyId =
      typeof body?.companyId === "string" && body.companyId.trim().length > 0
        ? body.companyId.trim()
        : null;
    const targetPath = sanitizeEmbedTargetPath(
      typeof body?.targetPath === "string" ? body.targetPath : null,
    ) ?? "/embed/chat";
    const returnUrl = sanitizeEmbedReturnUrl(
      typeof body?.returnUrl === "string" ? body.returnUrl : null,
    );
    const actingUserEmailCandidate =
      typeof body?.actorEmail === "string" && body.actorEmail.trim().length > 0
        ? body.actorEmail
        : typeof body?.actingUserEmail === "string" && body.actingUserEmail.trim().length > 0
          ? body.actingUserEmail
          : null;
    const actingUserEmail = actingUserEmailCandidate?.trim().toLowerCase() ?? null;

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
      throw new ForbiddenError("API key does not grant access to the requested company");
    }
    if (!actingUserEmail) {
      return NextResponse.json(
        { error: "actorEmail is required for browser handoff" },
        { status: 400 },
      );
    }

    const handoffUserId = await resolveActingUserId(actingUserEmail, companyId);
    if (!handoffUserId) {
      return NextResponse.json(
        {
          error:
            "The acting user must have an Corpus account with access to the requested company",
        },
        { status: 403 },
      );
    }

    const ticket = issueEmbedApiKeyTicket({
      userId: handoffUserId,
      companyId,
      targetPath,
      returnUrl,
    });
    const payload = verifyEmbedApiKeyTicket(ticket);
    await registerSingleUseTicket({
      namespace: "embed_api_key",
      id: payload.jti,
      expiresAt: new Date(payload.exp * 1000),
    });

    const appUrl = resolveTrustedAppBaseUrl(request.nextUrl.origin);
    const redeemUrl = new URL("/api/embed/redeem-api-key-ticket", appUrl);
    redeemUrl.searchParams.set("ticket", ticket);

    return NextResponse.json({
      ok: true,
      redeemUrl: redeemUrl.toString(),
      companyId,
      targetPath,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
