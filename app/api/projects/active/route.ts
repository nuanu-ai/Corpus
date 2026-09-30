import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { getSessionAuthContext, handleApiError } from "@/lib/api-auth";
import {
  ACTIVE_COMPANY_COOKIE,
  ACTIVE_COMPANY_COOKIE_OPTIONS,
  getRequestedCompanyIdFromHeaders,
} from "@/lib/company-context";
import {
  ACTIVE_PROJECT_COOKIE,
  ACTIVE_PROJECT_COOKIE_OPTIONS,
  getRequestedProjectIdFromHeaders,
} from "@/lib/project-context";
import { getDefaultCompanyIdForUser } from "@/lib/default-company-context";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { listProjectsForUser, requireProjectMembership } from "@/lib/projects";

async function resolveActiveProjectId(
  hdrs: Pick<Headers, "get">,
  userId: string,
  projects: Array<{ id: string; projectKind: "company" | "personal" }>,
): Promise<string | null> {
  const requestedProjectId = getRequestedProjectIdFromHeaders(hdrs);
  if (requestedProjectId && projects.some((project) => project.id === requestedProjectId)) {
    return requestedProjectId;
  }

  const requestedCompanyId = getRequestedCompanyIdFromHeaders(hdrs);
  if (
    requestedCompanyId &&
    projects.some((project) => project.projectKind === "company" && project.id === requestedCompanyId)
  ) {
    return requestedCompanyId;
  }

  const defaultCompanyId = await getDefaultCompanyIdForUser(userId);
  if (
    defaultCompanyId &&
    projects.some((project) => project.projectKind === "company" && project.id === defaultCompanyId)
  ) {
    return defaultCompanyId;
  }

  const firstCompany = projects.find((project) => project.projectKind === "company");
  return firstCompany?.id ?? projects[0]?.id ?? null;
}

export async function GET() {
  try {
    const { userId } = await getSessionAuthContext();
    const hdrs = await headers();
    const [user] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const projects = await listProjectsForUser({
      userId,
      name: user?.name ?? null,
      email: user?.email ?? null,
    });
    const activeProjectId = await resolveActiveProjectId(hdrs, userId, projects);
    const activeProject =
      projects.find((project) => project.id === activeProjectId) ?? null;

    return NextResponse.json({
      activeProjectId,
      activeProjectKind: activeProject?.projectKind ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: Request) {
  try {
    const { userId } = await getSessionAuthContext();

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    await requireProjectMembership(userId, projectId);

    const [user] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const projects = await listProjectsForUser({
      userId,
      name: user?.name ?? null,
      email: user?.email ?? null,
    });
    const project = projects.find((item) => item.id === projectId);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const response = NextResponse.json({
      status: "ok",
      activeProjectId: projectId,
      activeProjectKind: project.projectKind,
    });
    response.cookies.set(ACTIVE_PROJECT_COOKIE, projectId, ACTIVE_PROJECT_COOKIE_OPTIONS);
    if (project.projectKind === "company") {
      response.cookies.set(ACTIVE_COMPANY_COOKIE, projectId, ACTIVE_COMPANY_COOKIE_OPTIONS);
    }
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE() {
  try {
    await getSessionAuthContext();
    const response = NextResponse.json({ status: "ok" });
    response.cookies.set(ACTIVE_PROJECT_COOKIE, "", {
      ...ACTIVE_PROJECT_COOKIE_OPTIONS,
      maxAge: 0,
    });
    return response;
  } catch (err) {
    return handleApiError(err);
  }
}
