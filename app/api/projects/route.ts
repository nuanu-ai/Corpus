import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { getSessionAuthContext, handleApiError } from "@/lib/api-auth";
import {
  ACTIVE_COMPANY_COOKIE,
  getRequestedCompanyIdFromHeaders,
} from "@/lib/company-context";
import {
  ACTIVE_PROJECT_COOKIE,
  getRequestedProjectIdFromHeaders,
} from "@/lib/project-context";
import { getDefaultCompanyIdForUser } from "@/lib/default-company-context";
import { listProjectsForUser } from "@/lib/projects";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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

    return NextResponse.json(
      {
        projects: projects.map((project) => ({
          id: project.id,
          name: project.name,
          slug: project.slug,
          role: project.role,
          projectKind: project.projectKind,
          schemaPack: project.schemaPack,
          projectDbPort: project.projectDbPort,
          joinedAt: project.joinedAt,
        })),
        activeProjectId,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Vary": "Cookie",
        },
      },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
