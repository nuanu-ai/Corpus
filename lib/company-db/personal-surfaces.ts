import { eq } from "drizzle-orm";

import {
  getFolderSummary,
  getCompanyManagementSummary,
  queryAllEntities,
  readQmdFile,
  submitCompanyDbCommit,
  type CompanyDbRequestOptions,
  type SummaryResult,
} from "@/lib/company-db/client";
import { getTenantSlug } from "@/lib/company-db/tenant";
import { parseQmd, toQmd } from "@/lib/company-db/summary/qmd";
import { type DashboardCommitmentItem, buildDashboardCommitmentsFeed } from "@/lib/communications/commitments";
import { listPendingSignalsForCompany, type PendingSignalRow } from "@/lib/communications/store";
import { listCompanyMemberships } from "@/lib/db/tenant";
import { db } from "@/lib/db";
import { auditLog, companies } from "@/lib/db/schema";

export const PERSONAL_SUMMARY_DOMAINS = [
  "inbox",
  "today",
  "timeline",
  "workspaces",
  "commitments",
] as const;

export type PersonalSummaryDomain = (typeof PERSONAL_SUMMARY_DOMAINS)[number];

export interface PersonalSurfaceContext {
  tenantId: string;
  userId: string;
  role: string;
}

export interface PersonalLinkedWorkspace {
  companyId: string;
  companyName: string;
  companySlug: string | null;
  role: string;
  companyDbPort: number;
  summary: string | null;
  notePath: string;
  noteBody: string;
  waitingFors: string[];
  mirrorSummary: string | null;
  mirrorRefreshedAt: string | null;
  publishedFilePath: string | null;
  publishedAt: string | null;
}

export interface PersonalWorkspaceLinkSaveInput {
  context: PersonalSurfaceContext;
  companyId: string;
  noteBody?: string;
  waitingFors?: string[];
  refreshMirror?: boolean;
}

export interface PersonalWorkspaceLinkPublishInput {
  context: PersonalSurfaceContext;
  companyId: string;
  title?: string;
  noteBody?: string;
  waitingFors?: string[];
}

type WorkspaceMembership = Awaited<ReturnType<typeof listCompanyMemberships>>[number];

type PersonalWorkspaceLinkContext = {
  personalRequestOptions: CompanyDbRequestOptions;
  personalSlug: string;
  personalWriteQueuePort: number;
  membership: WorkspaceMembership & { companySlug: string };
  notePath: string;
  publishedFilePath: string;
};

export function isPersonalSummaryDomain(value: string): value is PersonalSummaryDomain {
  return PERSONAL_SUMMARY_DOMAINS.includes(value as PersonalSummaryDomain);
}

function normalizeWaitingFors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getWorkspaceNotePath(companySlug: string): string {
  return `workspaces/companies/${companySlug}.qmd`;
}

function getWorkspaceQualifiedId(companySlug: string): string {
  return `workspace-${companySlug}`;
}

function getWorkspacePublishedFilePath(personalSlug: string, companySlug: string): string {
  return `knowledge/linked-workspaces/${personalSlug}-${companySlug}.qmd`;
}

function parseWorkspaceLinkDocument(raw: string | null) {
  if (!raw) {
    return {
      noteBody: "",
      waitingFors: [] as string[],
      mirrorSummary: null as string | null,
      mirrorRefreshedAt: null as string | null,
      publishedFilePath: null as string | null,
      publishedAt: null as string | null,
    };
  }

  const parsed = parseQmd(raw);
  const frontmatter = parsed.frontmatter;

  return {
    noteBody: parsed.body?.trim() ?? "",
    waitingFors: normalizeWaitingFors(frontmatter.waiting_fors),
    mirrorSummary:
      typeof frontmatter.mirror_summary === "string" && frontmatter.mirror_summary.trim().length > 0
        ? frontmatter.mirror_summary.trim()
        : null,
    mirrorRefreshedAt:
      typeof frontmatter.mirror_refreshed_at === "string" && frontmatter.mirror_refreshed_at.trim().length > 0
        ? frontmatter.mirror_refreshed_at.trim()
        : null,
    publishedFilePath:
      typeof frontmatter.published_file_path === "string" && frontmatter.published_file_path.trim().length > 0
        ? frontmatter.published_file_path.trim()
        : null,
    publishedAt:
      typeof frontmatter.published_at === "string" && frontmatter.published_at.trim().length > 0
        ? frontmatter.published_at.trim()
        : null,
  };
}

function buildWorkspaceLinkDocument(input: {
  companyId: string;
  companyName: string;
  companySlug: string;
  role: string;
  noteBody: string;
  waitingFors: string[];
  mirrorSummary: string | null;
  mirrorRefreshedAt: string | null;
  publishedFilePath?: string | null;
  publishedAt?: string | null;
}): string {
  const now = new Date().toISOString();
  return toQmd(
    {
      id: getWorkspaceQualifiedId(input.companySlug),
      type: "workspace",
      title: input.companyName,
      link_kind: "linked_company_workspace",
      company_id: input.companyId,
      company_slug: input.companySlug,
      company_name: input.companyName,
      personal_role: input.role,
      waiting_fors: input.waitingFors,
      mirror_source_path: "governance/company/_summary.qmd",
      mirror_summary: input.mirrorSummary,
      mirror_refreshed_at: input.mirrorRefreshedAt,
      published_file_path: input.publishedFilePath ?? null,
      published_at: input.publishedAt ?? null,
      visibility: "private",
      updated_at: now,
    },
    input.noteBody,
  );
}

function buildPublishedWorkspaceBody(noteBody: string, waitingFors: string[]): string {
  return [
    noteBody,
    waitingFors.length > 0
      ? `## Waiting Fors\n${waitingFors.map((item) => `- ${item}`).join("\n")}`
      : "",
  ]
    .filter((section) => section.trim().length > 0)
    .join("\n\n");
}

function parsePublishedWorkspaceDocument(raw: string | null) {
  if (!raw) {
    return null;
  }

  const parsed = parseQmd(raw);
  const frontmatter = parsed.frontmatter;

  return {
    title: typeof frontmatter.title === "string" ? frontmatter.title.trim() : "",
    body: parsed.body?.trim() ?? "",
    waitingFors: normalizeWaitingFors(frontmatter.waiting_fors),
    publishedAt:
      typeof frontmatter.published_at === "string" && frontmatter.published_at.trim().length > 0
        ? frontmatter.published_at.trim()
        : null,
    sourcePersonalTenantSlug:
      typeof frontmatter.source_personal_tenant_slug === "string"
        ? frontmatter.source_personal_tenant_slug.trim()
        : null,
    sourcePersonalWorkspacePath:
      typeof frontmatter.source_personal_workspace_path === "string"
        ? frontmatter.source_personal_workspace_path.trim()
        : null,
    sourceCompanyId:
      typeof frontmatter.source_company_id === "string" ? frontmatter.source_company_id.trim() : null,
    sourceCompanySlug:
      typeof frontmatter.source_company_slug === "string" ? frontmatter.source_company_slug.trim() : null,
  };
}

async function recordPersonalWorkspaceAudit(input: {
  companyId: string;
  userId: string;
  action: string;
  entityId?: string | null;
  newValue: Record<string, unknown>;
}) {
  await db
    .insert(auditLog)
    .values({
      companyId: input.companyId,
      userId: input.userId,
      action: input.action,
      entityType: "workspace",
      entityId: input.entityId ?? null,
      newValue: input.newValue,
    })
    .catch((error) => {
      console.warn("[personal-workspaces] failed to record audit event", error);
    });
}

async function resolvePersonalWorkspaceLinkContext(
  context: PersonalSurfaceContext,
  companyId: string,
): Promise<PersonalWorkspaceLinkContext> {
  const [personalRequestOptions, memberships, personalSlug] = await Promise.all([
    getPersonalCompanyDbRequestOptions(context),
    listCompanyMemberships(context.userId),
    getTenantSlug(context.tenantId),
  ]);

  const membership = memberships.find((item) => item.companyId === companyId);
  if (!membership) {
    throw new Error("Workspace is not linked to this personal project");
  }

  const companySlug = membership.companySlug ?? (await getTenantSlug(membership.companyId));
  const notePath = getWorkspaceNotePath(companySlug);

  return {
    personalRequestOptions,
    personalSlug,
    personalWriteQueuePort: (personalRequestOptions.port ?? 3100) + 1,
    membership: {
      ...membership,
      companySlug,
    },
    notePath,
    publishedFilePath: getWorkspacePublishedFilePath(personalSlug, companySlug),
  };
}

export async function getPersonalCompanyDbRequestOptions(
  context: PersonalSurfaceContext,
): Promise<CompanyDbRequestOptions> {
  const [tenant, tenantSlug] = await Promise.all([
    db
      .select({ companyDbPort: companies.companyDbPort })
      .from(companies)
      .where(eq(companies.id, context.tenantId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    getTenantSlug(context.tenantId),
  ]);

  return {
    companySlug: tenantSlug,
    callerId: context.userId,
    callerRole: context.role,
    port: tenant?.companyDbPort ?? 3100,
  };
}

export async function loadPersonalSurfaceSummary(
  domain: PersonalSummaryDomain,
  context: PersonalSurfaceContext,
): Promise<SummaryResult | null> {
  const requestOptions = await getPersonalCompanyDbRequestOptions(context);
  return getFolderSummary(domain, requestOptions);
}

export async function loadPersonalCommitmentsFeed(
  context: PersonalSurfaceContext,
  limit?: number,
): Promise<DashboardCommitmentItem[]> {
  const requestOptions = await getPersonalCompanyDbRequestOptions(context);
  const records = await queryAllEntities(
    {
      domain: "communications",
      type: "communication_signal",
      view: "summary",
    },
    requestOptions,
  );

  return buildDashboardCommitmentsFeed(
    records,
    typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? { limit } : undefined,
  );
}

export async function loadPersonalPendingSignals(
  tenantId: string,
  limit = 50,
): Promise<PendingSignalRow[]> {
  return listPendingSignalsForCompany(tenantId, limit);
}

export async function loadPersonalLinkedWorkspaces(
  context: PersonalSurfaceContext,
): Promise<PersonalLinkedWorkspace[]> {
  const [memberships, personalRequestOptions] = await Promise.all([
    listCompanyMemberships(context.userId),
    getPersonalCompanyDbRequestOptions(context),
  ]);

  return Promise.all(
    memberships.map(async (membership) => {
      const resolvedSlug =
        membership.companySlug ?? (await getTenantSlug(membership.companyId));
      const notePath = getWorkspaceNotePath(resolvedSlug);
      let summary: string | null = null;
      try {
        summary = await getCompanyManagementSummary({
          companySlug: resolvedSlug,
          callerId: context.userId,
          callerRole: membership.role,
          port: membership.companyDbPort,
        });
      } catch {
        summary = null;
      }

      const workspaceLink = parseWorkspaceLinkDocument(
        await readQmdFile(notePath, personalRequestOptions).catch(() => null),
      );

      return {
        companyId: membership.companyId,
        companyName: membership.companyName,
        companySlug: resolvedSlug,
        role: membership.role,
        companyDbPort: membership.companyDbPort,
        summary,
        notePath,
        noteBody: workspaceLink.noteBody,
        waitingFors: workspaceLink.waitingFors,
        mirrorSummary: workspaceLink.mirrorSummary,
        mirrorRefreshedAt: workspaceLink.mirrorRefreshedAt,
        publishedFilePath: workspaceLink.publishedFilePath,
        publishedAt: workspaceLink.publishedAt,
      };
    }),
  );
}

export async function savePersonalWorkspaceLink(
  input: PersonalWorkspaceLinkSaveInput,
): Promise<{
  notePath: string;
  mirrorRefreshedAt: string | null;
  mirrorUpdated: boolean;
  mirrorWarning: string | null;
}> {
  const resolved = await resolvePersonalWorkspaceLinkContext(input.context, input.companyId);
  const existingRaw = await readQmdFile(resolved.notePath, resolved.personalRequestOptions).catch(() => null);
  const existing = parseWorkspaceLinkDocument(existingRaw);
  const noteBody =
    typeof input.noteBody === "string" ? input.noteBody.trim() : existing.noteBody;
  const waitingFors = Array.isArray(input.waitingFors)
    ? input.waitingFors.map((item) => item.trim()).filter(Boolean)
    : existing.waitingFors;
  let mirrorUpdated = false;
  let mirrorWarning: string | null = null;
  let mirrorSummary = existing.mirrorSummary;
  let mirrorRefreshedAt = existing.mirrorRefreshedAt;

  if (input.refreshMirror) {
    try {
      const refreshedSummary = normalizeOptionalText(
        await getCompanyManagementSummary({
          companySlug: resolved.membership.companySlug,
          callerId: input.context.userId,
          callerRole: resolved.membership.role,
          port: resolved.membership.companyDbPort,
        }),
      );
      mirrorUpdated = refreshedSummary !== existing.mirrorSummary;
      mirrorSummary = refreshedSummary;
      if (mirrorUpdated && mirrorSummary) {
        mirrorRefreshedAt = new Date().toISOString();
      }
    } catch (error) {
      mirrorWarning = "Live company mirror refresh failed; keeping the last cached summary.";
      console.warn("[personal-workspaces] mirror refresh failed", error);
      await recordPersonalWorkspaceAudit({
        companyId: input.context.tenantId,
        userId: input.context.userId,
        action: "personal_workspace_mirror_refresh_failed",
        entityId: null,
        newValue: {
          sourceCompanyId: resolved.membership.companyId,
          sourceCompanySlug: resolved.membership.companySlug,
          notePath: resolved.notePath,
          error: error instanceof Error ? error.message : "Unknown mirror refresh error",
        },
      });
    }
  }

  const noteChanged = noteBody !== existing.noteBody;
  const waitingForsChanged = !arraysEqual(waitingFors, existing.waitingFors);
  const shouldCommit = existingRaw === null || noteChanged || waitingForsChanged || mirrorUpdated;

  if (shouldCommit) {
    const content = buildWorkspaceLinkDocument({
      companyId: resolved.membership.companyId,
      companyName: resolved.membership.companyName,
      companySlug: resolved.membership.companySlug,
      role: resolved.membership.role,
      noteBody,
      waitingFors,
      mirrorSummary,
      mirrorRefreshedAt,
      publishedFilePath: existing.publishedFilePath,
      publishedAt: existing.publishedAt,
    });

    await submitCompanyDbCommit(
      resolved.personalSlug,
      {
        domain: "workspaces",
        filePath: resolved.notePath,
        content,
        commitMessage: `workspaces(linked): ${resolved.membership.companyName}`,
        metadata: {
          source: "personal-workspaces",
          companyId: resolved.membership.companyId,
          companySlug: resolved.membership.companySlug,
          actorUserId: input.context.userId,
        },
      },
      resolved.personalWriteQueuePort,
    );
  }

  return {
    notePath: resolved.notePath,
    mirrorRefreshedAt,
    mirrorUpdated,
    mirrorWarning,
  };
}

export async function publishPersonalWorkspaceLink(
  input: PersonalWorkspaceLinkPublishInput,
): Promise<{
  filePath: string;
  companyId: string;
  companySlug: string;
}> {
  const resolved = await resolvePersonalWorkspaceLinkContext(input.context, input.companyId);
  const existingRaw = await readQmdFile(resolved.notePath, resolved.personalRequestOptions).catch(() => null);
  const existing = parseWorkspaceLinkDocument(existingRaw);
  const noteBody = typeof input.noteBody === "string" ? input.noteBody.trim() : existing.noteBody;
  const waitingFors =
    Array.isArray(input.waitingFors)
      ? input.waitingFors.map((item) => item.trim()).filter(Boolean)
      : existing.waitingFors;

  if (!noteBody && waitingFors.length === 0) {
    throw new Error("Workspace note is empty; nothing to publish");
  }

  if (!new Set(["owner", "admin"]).has(resolved.membership.role)) {
    throw new Error("Publishing to the company workspace requires owner or admin access");
  }

  const title =
    typeof input.title === "string" && input.title.trim().length > 0
      ? input.title.trim()
      : `${resolved.membership.companyName} workspace note`;
  const publishedBody = buildPublishedWorkspaceBody(noteBody, waitingFors);
  const companyRequestOptions: CompanyDbRequestOptions = {
    companySlug: resolved.membership.companySlug,
    callerId: input.context.userId,
    callerRole: resolved.membership.role,
    port: resolved.membership.companyDbPort,
  };
  const existingPublished = parsePublishedWorkspaceDocument(
    await readQmdFile(resolved.publishedFilePath, companyRequestOptions).catch(() => null),
  );
  const reuseExistingPublish =
    existingPublished !== null &&
    existingPublished.title === title &&
    existingPublished.body === publishedBody &&
    arraysEqual(existingPublished.waitingFors, waitingFors) &&
    existingPublished.sourcePersonalTenantSlug === resolved.personalSlug &&
    existingPublished.sourcePersonalWorkspacePath === resolved.notePath &&
    existingPublished.sourceCompanyId === resolved.membership.companyId &&
    existingPublished.sourceCompanySlug === resolved.membership.companySlug;
  const publishedAt =
    reuseExistingPublish && existingPublished?.publishedAt
      ? existingPublished.publishedAt
      : new Date().toISOString();
  const content = toQmd(
    {
      id: `note-${resolved.personalSlug}-${resolved.membership.companySlug}`,
      type: "note",
      title,
      source: "personal-workspace-publish",
      source_personal_tenant_slug: resolved.personalSlug,
      source_personal_workspace_path: resolved.notePath,
      source_company_id: resolved.membership.companyId,
      source_company_slug: resolved.membership.companySlug,
      published_at: publishedAt,
      waiting_fors: waitingFors,
      actor_user_id: input.context.userId,
      visibility: "internal",
    },
    publishedBody,
  );

  if (!reuseExistingPublish) {
    await submitCompanyDbCommit(
      resolved.membership.companySlug,
      {
        domain: "knowledge",
        filePath: resolved.publishedFilePath,
        content,
        commitMessage: `knowledge(linked-workspace): ${title}`,
        metadata: {
          source: "personal-workspace-publish",
          personalTenantId: input.context.tenantId,
          personalTenantSlug: resolved.personalSlug,
          sourceWorkspacePath: resolved.notePath,
          actorUserId: input.context.userId,
        },
      },
      resolved.membership.companyDbPort + 1,
    );
  }

  const nextPersonalRaw = buildWorkspaceLinkDocument({
    companyId: resolved.membership.companyId,
    companyName: resolved.membership.companyName,
    companySlug: resolved.membership.companySlug,
    role: resolved.membership.role,
    noteBody,
    waitingFors,
    mirrorSummary: existing.mirrorSummary,
    mirrorRefreshedAt: existing.mirrorRefreshedAt,
    publishedFilePath: resolved.publishedFilePath,
    publishedAt,
  });

  const personalPublishChanged =
    existingRaw === null ||
    noteBody !== existing.noteBody ||
    !arraysEqual(waitingFors, existing.waitingFors) ||
    existing.publishedFilePath !== resolved.publishedFilePath ||
    existing.publishedAt !== publishedAt;

  if (personalPublishChanged) {
    await submitCompanyDbCommit(
      resolved.personalSlug,
      {
        domain: "workspaces",
        filePath: resolved.notePath,
        content: nextPersonalRaw,
        commitMessage: `workspaces(publish): ${resolved.membership.companyName}`,
        metadata: {
          source: "personal-workspace-publish",
          companyId: resolved.membership.companyId,
          companySlug: resolved.membership.companySlug,
          actorUserId: input.context.userId,
          publishedFilePath: resolved.publishedFilePath,
        },
      },
      resolved.personalWriteQueuePort,
    );
  }

  return {
    filePath: resolved.publishedFilePath,
    companyId: resolved.membership.companyId,
    companySlug: resolved.membership.companySlug,
  };
}
