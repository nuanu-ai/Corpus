import { NextRequest, NextResponse } from "next/server";
import { makeSignature } from "better-auth/crypto";
import { auth } from "@/lib/auth";
import { verifyEmbedApiKeyTicket } from "@/lib/embed-api-key-ticket";
import {
  getEmbedCompatibleCookieAttributes,
  resolveTrustedAppBaseUrl,
} from "@/lib/embed-config";
import { ACTIVE_COMPANY_COOKIE, ACTIVE_COMPANY_COOKIE_OPTIONS } from "@/lib/company-context";
import { consumeSingleUseTicket } from "@/lib/single-use-ticket-store";
import { checkTicketRedemptionRateLimit } from "@/lib/ticket-redemption-rate-limit";

const EMBED_RETURN_URL_COOKIE = "corpus-return-url";
const EMBED_RETURN_ACTIVE_COOKIE = "corpus-return-active";

function invalidEmbedTicketResponse() {
  return NextResponse.json({ error: "Invalid embed ticket" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  if (!checkTicketRedemptionRateLimit(request, "embed_api_key")) {
    return NextResponse.json({ error: "Too many redemption attempts" }, { status: 429 });
  }

  const ticket = request.nextUrl.searchParams.get("ticket");
  if (!ticket) {
    return NextResponse.json({ error: "Missing ticket" }, { status: 400 });
  }

  let payload: ReturnType<typeof verifyEmbedApiKeyTicket> | null = null;
  try {
    payload = verifyEmbedApiKeyTicket(ticket);
    const consumed = await consumeSingleUseTicket({
      namespace: "embed_api_key",
      id: payload.jti,
    });
    if (!consumed) {
      return invalidEmbedTicketResponse();
    }
  } catch {
    return invalidEmbedTicketResponse();
  }
  if (!payload) {
    return invalidEmbedTicketResponse();
  }

  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.findUserById(payload.userId);
  if (!user) {
    return invalidEmbedTicketResponse();
  }

  const session = await ctx.internalAdapter.createSession(payload.userId);
  const signedToken = `${session.token}.${await makeSignature(session.token, ctx.secret)}`;
  const redirectBase = resolveTrustedAppBaseUrl(request.nextUrl.origin);
  const redirectUrl = new URL(payload.targetPath || "/embed/chat", redirectBase);
  if (payload.companyId && redirectUrl.pathname === "/embed/chat" && !redirectUrl.searchParams.has("companyId")) {
    redirectUrl.searchParams.set("companyId", payload.companyId);
  }

  const response = NextResponse.redirect(redirectUrl);
  const cookie = ctx.authCookies.sessionToken;
  const embedCookieAttributes = getEmbedCompatibleCookieAttributes();
  response.cookies.set(cookie.name, signedToken, {
    domain: cookie.attributes.domain || undefined,
    httpOnly: cookie.attributes.httpOnly ?? true,
    maxAge: ctx.sessionConfig.expiresIn,
    path: cookie.attributes.path || "/",
    sameSite: embedCookieAttributes.sameSite,
    secure: embedCookieAttributes.secure,
  });
  if (payload.companyId) {
    response.cookies.set(ACTIVE_COMPANY_COOKIE, payload.companyId, ACTIVE_COMPANY_COOKIE_OPTIONS);
  }
  if (payload.returnUrl) {
    response.cookies.set(EMBED_RETURN_URL_COOKIE, payload.returnUrl, {
      path: "/",
      httpOnly: false,
      maxAge: 60 * 60 * 12,
      sameSite: embedCookieAttributes.sameSite,
      secure: embedCookieAttributes.secure,
    });
    response.cookies.set(EMBED_RETURN_ACTIVE_COOKIE, "1", {
      path: "/",
      httpOnly: false,
      maxAge: 60 * 60,
      sameSite: embedCookieAttributes.sameSite,
      secure: embedCookieAttributes.secure,
    });
  } else {
    response.cookies.delete(EMBED_RETURN_URL_COOKIE);
    response.cookies.delete(EMBED_RETURN_ACTIVE_COOKIE);
  }
  return response;
}
