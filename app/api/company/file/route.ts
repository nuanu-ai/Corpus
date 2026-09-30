import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAuthContext, handleApiError, requireApiKeyScope, requireCompanyDbDomainAccess } from "@/lib/api-auth";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { toCompanyDbRole } from "@/lib/company-db/roles";
import { buildCompanyDbRestHeadersForUrl, isCompanyDbInternalAuthConfigured } from "@/lib/company-db/internal-service-auth";
import { truncateAgentFilePreview } from "@/lib/company-db/agent-safe-defaults";
import { DEFAULT_COMPANY_DB_REST_PORT as DEFAULT_REST_PORT } from "@/lib/company-db/port-config";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";

const COMPANY_DB_HOST = process.env.COMPANY_DB_HOST ?? "localhost";

function isTruthy(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeRelativeFilePath(rawPath: string): string {
  const normalized = rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return "";
  }
  return segments.join("/");
}

function inferCompanyDbDomainFromFilePath(filePath: string): string | null {
  const segments = filePath.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  if (segments[0] === "entities" && segments.length >= 3) {
    return segments[2].toLowerCase();
  }

  return segments[0].toLowerCase();
}

/**
 * GET /api/company/file?path=finance/.../x.qmd[&download=1]
 *
 * Authenticated proxy to tenant Company-DB raw file endpoint.
 * Supports either session auth or bearer API key auth (`x-company-id` required).
 */
export async function GET(req: NextRequest) {
  try {
    if (!isCompanyDbInternalAuthConfigured()) {
      return NextResponse.json(
        { error: "Company-DB internal auth is not configured" },
        { status: 503 },
      );
    }

    const auth = await getAuthContext();
    requireApiKeyScope(auth, "company_db.file");
    const companySlug = await getCompanySlug(auth.companyId);

    const [company] = await db
      .select({ companyDbPort: companies.companyDbPort })
      .from(companies)
      .where(eq(companies.id, auth.companyId));

    const filePath = normalizeRelativeFilePath(
      req.nextUrl.searchParams.get("path") ?? "",
    );
    const download = isTruthy(req.nextUrl.searchParams.get("download"));
    const full = isTruthy(req.nextUrl.searchParams.get("full"));
    const requestedMaxChars = req.nextUrl.searchParams.has("maxChars")
      ? Number(req.nextUrl.searchParams.get("maxChars"))
      : undefined;

    if (!filePath) {
      return NextResponse.json(
        { error: "Missing required query parameter: path" },
        { status: 400 },
      );
    }
    requireCompanyDbDomainAccess(auth, inferCompanyDbDomainFromFilePath(filePath), "file");

    const port = company?.companyDbPort ?? DEFAULT_REST_PORT;
    const upstreamUrl = new URL(`http://${COMPANY_DB_HOST}:${port}/api/v1/file`);
    upstreamUrl.searchParams.set("path", filePath);
    if (download) {
      upstreamUrl.searchParams.set("download", "1");
    }

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: "GET",
        headers: buildCompanyDbRestHeadersForUrl({
          url: upstreamUrl,
          method: "GET",
          companySlug,
          callerId: auth.userId,
          callerRole: toCompanyDbRole(auth.role),
        }),
        cache: "no-store",
      });
    } catch {
      return NextResponse.json(
        { error: "Company-DB file endpoint is unavailable" },
        { status: 502 },
      );
    }

    const upstreamBody = await upstream.text();
    if (!upstream.ok) {
      try {
        const parsed = JSON.parse(upstreamBody) as { error?: string };
        return NextResponse.json(
          { error: parsed.error ?? "Company-DB file request failed" },
          { status: upstream.status },
        );
      } catch {
        return NextResponse.json(
          { error: upstreamBody || "Company-DB file request failed" },
          { status: upstream.status },
        );
      }
    }

    const preview = truncateAgentFilePreview(upstreamBody, auth.authMethod, {
      full: download || full,
      maxChars: requestedMaxChars,
    });

    const headers = new Headers();
    headers.set(
      "content-type",
      upstream.headers.get("content-type") ?? "text/plain; charset=utf-8",
    );

    const contentDisposition = upstream.headers.get("content-disposition");
    if (contentDisposition) {
      headers.set("content-disposition", contentDisposition);
    }
    headers.set("x-corpus-original-length", String(preview.originalLength));
    headers.set("x-corpus-returned-length", String(preview.returnedLength));
    headers.set("x-corpus-truncated", preview.truncated ? "1" : "0");

    return new NextResponse(preview.content, {
      status: 200,
      headers,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
