import { ensurePersonalProjectForUser } from "@/lib/personal-projects";
import {
  getPersonalTenantMembership,
  listCompanyMemberships,
  requireTenantMembership,
  type CompanyMembership,
  type TenantMembership,
} from "@/lib/db/tenant";

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string | null;
  role: string;
  projectKind: "company" | "personal";
  schemaPack: "company" | "person";
  projectDbPort: number;
  joinedAt: Date;
  settings: Record<string, unknown> | null;
}

function mapCompanyMembership(membership: CompanyMembership): ProjectSummary {
  return {
    id: membership.companyId,
    name: membership.companyName,
    slug: membership.companySlug,
    role: membership.role,
    projectKind: "company",
    schemaPack: "company",
    projectDbPort: membership.companyDbPort,
    joinedAt: membership.joinedAt,
    settings: membership.companySettings,
  };
}

function mapTenantMembership(membership: TenantMembership): ProjectSummary {
  return {
    id: membership.tenantId,
    name: membership.tenantName,
    slug: membership.tenantSlug,
    role: membership.role,
    projectKind: membership.tenantKind === "person" ? "personal" : "company",
    schemaPack: membership.schemaPack,
    projectDbPort: membership.tenantDbPort,
    joinedAt: membership.joinedAt,
    settings: membership.tenantSettings,
  };
}

export async function listProjectsForUser(input: {
  userId: string;
  name?: string | null;
  email?: string | null;
}): Promise<ProjectSummary[]> {
  await ensurePersonalProjectForUser(input);

  const [companyMemberships, personalMembership] = await Promise.all([
    listCompanyMemberships(input.userId),
    getPersonalTenantMembership(input.userId),
  ]);

  const projects = companyMemberships.map(mapCompanyMembership);
  if (personalMembership) {
    projects.unshift(mapTenantMembership(personalMembership));
  }

  return projects;
}

export async function requireProjectMembership(
  userId: string,
  projectId: string,
): Promise<{ projectId: string; role: string }> {
  const membership = await requireTenantMembership(userId, projectId);
  return { projectId: membership.tenantId, role: membership.role };
}
