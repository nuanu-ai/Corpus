import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { consumeInviteCode } from "@/lib/auth/invite-codes";

const handlers = toNextJsHandler(auth);

/**
 * Detect a sign-up request. BetterAuth's email-password sign-up endpoint is
 * `POST /api/auth/sign-up/email`; magic-link / OAuth flows take other paths.
 * We only gate the email-password path — the other flows aren't enabled today.
 */
function isSignUpRequest(url: URL): boolean {
  return /\/sign-up\/email\/?$/.test(url.pathname) || /\/sign-up\/?$/.test(url.pathname);
}

/**
 * Sign-up resolution policy:
 *  - No code present → public signup, tier='community' (BYOK).
 *    Lazy provisioning + missing-OpenAI-key gate keeps cost minimal even
 *    for casual signups; chat (Anthropic) is the residual shared cost.
 *  - Code present and valid → tier inherited from the code (for example,
 *    a managed deployment invite).
 *  - Code present but invalid / expired / exhausted → 403.
 */
async function handleSignUpWithInviteGate(request: Request): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    const cloned = request.clone();
    body = (await cloned.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Code can come from the body (POSTed by the sign-up form) or the query
  // string (?code=... when the user landed via a magic-link).
  const url = new URL(request.url);
  const codeFromBody = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
  const codeFromUrl = url.searchParams.get("code")?.trim() ?? "";
  const code = codeFromBody || codeFromUrl;

  let resolvedTier: "managed" | "community" = "community";
  if (code) {
    const result = await consumeInviteCode(code);
    if (!result.ok) {
      // 'missing' shouldn't fire here (we only call when code is non-empty),
      // but other reasons (unknown / expired / exhausted / invalid_tier) do.
      return Response.json(
        { error: result.message, reason: result.reason },
        { status: 403 },
      );
    }
    resolvedTier = result.tier;
  }

  // Inject the tier into the BetterAuth body so the user.create.after hook
  // sees it and routes provisioning correctly. Strip the inviteCode field —
  // BetterAuth would reject it as unknown.
  const { inviteCode: _stripped, ...rest } = body;
  void _stripped;
  const newBody = JSON.stringify({ ...rest, tier: resolvedTier });

  const newRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: newBody,
  });

  return handlers.POST(newRequest);
}

export const GET = handlers.GET;
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (isSignUpRequest(url)) {
    return handleSignUpWithInviteGate(request);
  }
  return handlers.POST(request);
}
export const PATCH = handlers.PATCH;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;

export function OPTIONS(request: Request) {
  const requestedHeaders =
    request.headers.get("access-control-request-headers") ??
    "Authorization, Content-Type";

  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": requestedHeaders,
      "Access-Control-Max-Age": "86400",
      Vary: "Access-Control-Request-Headers",
    },
  });
}
