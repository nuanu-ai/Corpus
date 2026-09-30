import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { isPublicApiRouteAtProxy } from "@/lib/api-route-security-manifest";

export async function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  const isAuthRoute = request.nextUrl.pathname.startsWith("/login");
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  const isPublicApi = isPublicApiRouteAtProxy(request.nextUrl.pathname);
  const isProtectedRoute =
    request.nextUrl.pathname.startsWith("/dashboard") ||
    request.nextUrl.pathname.startsWith("/documents") ||
    request.nextUrl.pathname.startsWith("/assistant") ||
    request.nextUrl.pathname.startsWith("/integrations") ||
    request.nextUrl.pathname.startsWith("/automations") ||
    request.nextUrl.pathname.startsWith("/onboarding") ||
    request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/settings") ||
    (isApiRoute && !isPublicApi);

  // Demo mode must be explicitly enabled; missing DATABASE_URL must not silently disable auth.
  const isDemo = process.env.CORPUS_DEMO_MODE === "true";

  // Allow Bearer-authenticated API requests through to the handler
  // (only for API routes — page routes always require session cookie)
  const hasAuthHeader =
    isApiRoute && request.headers.get("authorization")?.toLowerCase().startsWith("bearer ");

  if (isProtectedRoute && !sessionCookie && !hasAuthHeader && !isDemo) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isAuthRoute && sessionCookie) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isDemo && request.nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/documents/:path*",
    "/assistant/:path*",
    "/integrations/:path*",
    "/automations/:path*",
    "/onboarding/:path*",
    "/admin/:path*",
    "/settings/:path*",
    "/api/:path*",
    "/login",
  ],
};
