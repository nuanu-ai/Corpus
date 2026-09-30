import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { handleApiError } from "@/lib/api-auth";
import { buildCompanyDbRestHeadersForUrl, isCompanyDbInternalAuthConfigured } from "@/lib/company-db/internal-service-auth";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { requireAdminCompanyAccess } from "@/lib/platform-admin";

const COMPANY_DB_HOST = process.env.COMPANY_DB_HOST ?? "localhost";
const COMPANY_DB_REPO = process.env.COMPANY_DB_REPO ?? "/data/companies";

function toCompanyDbRole(appRole: string | undefined): string {
  if (!appRole) return "cfo_agent";
  switch (appRole) {
    case "owner":
    case "external_accountant":
    case "investor_view":
    case "partner_agent":
    case "cfo_agent":
      return appRole;
    default:
      return "cfo_agent";
  }
}

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

function toFileResponse(content: string, filePath: string, download: boolean): NextResponse {
  if (!download) {
    return NextResponse.json({
      path: filePath,
      content,
    });
  }
  const fileName = filePath.split("/").pop() ?? "file.qmd";
  return new NextResponse(content, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
    },
  });
}

function toUpstreamErrorResponse(
  upstreamStatus: number,
  bodyText: string | null,
): NextResponse {
  if (!bodyText) {
    return NextResponse.json(
      { error: "Company-DB request failed" },
      { status: upstreamStatus },
    );
  }
  try {
    const parsed = JSON.parse(bodyText) as { error?: string };
    return NextResponse.json(
      { error: parsed.error ?? "Company-DB request failed" },
      { status: upstreamStatus },
    );
  } catch {
    return NextResponse.json(
      { error: bodyText || "Company-DB request failed" },
      { status: upstreamStatus },
    );
  }
}

async function readFileFromRepoFallback(
  slug: string,
  filePath: string,
): Promise<string | null> {
  const repoBase = resolve(/* turbopackIgnore: true */ COMPANY_DB_REPO);
  const repoRoot = resolve(repoBase, slug);
  const repoFromBase = relative(repoBase, repoRoot);
  if (repoFromBase.startsWith("..") || isAbsolute(repoFromBase)) {
    return null;
  }
  const absolutePath = resolve(repoRoot, filePath);
  const fileFromRepo = relative(repoRoot, absolutePath);
  if (fileFromRepo.startsWith("..") || isAbsolute(fileFromRepo)) {
    return null;
  }

  try {
    return await readFile(/* turbopackIgnore: true */ absolutePath, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * GET /api/admin/company-db/[slug]/file?path=finance/.../x.qmd[&download=1]
 *
 * Authenticated proxy to tenant Company-DB raw file endpoint.
 * - `download=1` returns attachment response
 * - default returns JSON `{ path, content }` for UI preview
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isCompanyDbInternalAuthConfigured()) {
      return NextResponse.json(
        { error: "Company-DB internal auth is not configured" },
        { status: 503 },
      );
    }

    const { slug } = await params;
    const { companyDbPort, role } = await requireAdminCompanyAccess({
      userId: session.user.id,
      email: session.user.email,
      slug,
    });

    const path = normalizeRelativeFilePath(req.nextUrl.searchParams.get("path") ?? "");
    const download = isTruthy(req.nextUrl.searchParams.get("download"));
    if (!path) {
      return NextResponse.json(
        { error: "Missing required query parameter: path" },
        { status: 400 },
      );
    }

    const upstreamUrl = new URL(`http://${COMPANY_DB_HOST}:${companyDbPort}/api/v1/file`);
    upstreamUrl.searchParams.set("path", path);
    if (download) {
      upstreamUrl.searchParams.set("download", "1");
    }

    let upstream: Response | null = null;
    let upstreamBody: string | null = null;
    try {
      upstream = await fetch(upstreamUrl, {
        method: "GET",
        headers: buildCompanyDbRestHeadersForUrl({
          url: upstreamUrl,
          method: "GET",
          companySlug: slug,
          callerId: session.user.id,
          callerRole: toCompanyDbRole(role),
        }),
        cache: "no-store",
      });
    } catch {
      upstream = null;
    }

    if (upstream) {
      upstreamBody = await upstream.text();
      if (upstream.ok) {
        if (download) {
          const responseHeaders = new Headers();
          responseHeaders.set(
            "content-type",
            upstream.headers.get("content-type") ?? "text/plain; charset=utf-8",
          );
          const contentDisposition = upstream.headers.get("content-disposition");
          if (contentDisposition) {
            responseHeaders.set("content-disposition", contentDisposition);
          }
          return new NextResponse(upstreamBody, {
            status: 200,
            headers: responseHeaders,
          });
        }

        return NextResponse.json({
          path,
          content: upstreamBody,
        });
      }

      // Backward-compat: some deployed Company-DB builds don't expose /api/v1/file.
      // In that case (or file 404), try local repo read fallback.
      if (upstream.status !== 404) {
        return toUpstreamErrorResponse(upstream.status, upstreamBody);
      }
    }

    const fallbackContent = await readFileFromRepoFallback(slug, path);
    if (fallbackContent !== null) {
      return toFileResponse(fallbackContent, path, download);
    }

    if (!upstream) {
      return NextResponse.json(
        { error: "Company-DB is unavailable" },
        { status: 502 },
      );
    }
    return toUpstreamErrorResponse(upstream.status, upstreamBody);
  } catch (err) {
    return handleApiError(err);
  }
}
