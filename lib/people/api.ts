import { createHash } from "crypto";

import { eq } from "drizzle-orm";

import {
  queryAllEntities,
  readQmdFile,
  submitAgentCommit,
  submitCompanyDbCommit,
  submitCompanyDbDelete,
  type EntityResult,
} from "@/lib/company-db/client";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import { parseQmd, toQmd } from "@/lib/company-db/summary/qmd";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { listPendingSignalsForCompany } from "@/lib/communications/store";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";

import { buildPersonRecord, type PendingPeopleSignal } from "./crm";
import {
  archivePersonProfileQmd,
  isActivePersonLifecycle,
  mergePersonProfilesQmd,
} from "./profile-actions";

const MAX_PEOPLE = 400;
const MAX_SIGNALS = 200;

export class PeopleRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type PeopleCompanyContext = {
  companyId: string;
  companySlug: string;
  port: number;
  writeQueuePort: number;
  callerId: string;
  callerRole?: string;
};

type BuildPeoplePayloadInput = PeopleCompanyContext;

type UpdatePersonInput = {
  filePath?: unknown;
  action?: "update" | "archive" | "merge";
  targetFilePath?: unknown;
  description?: unknown;
  displayName?: unknown;
  role?: unknown;
  organization?: unknown;
  relatedCompanies?: unknown;
  analysisContext?: unknown;
  crmChannels?: unknown;
  nextAction?: unknown;
  owner?: unknown;
  actionRequired?: unknown;
};

type CreatePersonInput = {
  profileKind?: unknown;
  name?: unknown;
  displayName?: unknown;
  role?: unknown;
  organization?: unknown;
  relatedCompanies?: unknown;
  analysisContext?: unknown;
  description?: unknown;
  crmChannels?: unknown;
  nextAction?: unknown;
  owner?: unknown;
  actionRequired?: unknown;
};

export type CreatePersonResult = {
  success: true;
  commitSha: string | null;
  filePath: string;
  person: ReturnType<typeof buildPersonRecord>;
};

export type UpdatePersonResult =
  | {
      success: true;
      action: "archive";
      commitSha: string | null;
    }
  | {
      success: true;
      action: "merge";
      commitSha: string | null;
      targetFilePath: string;
    }
  | {
      success: true;
      action: "update";
      commitSha: string | null;
      person: ReturnType<typeof buildPersonRecord>;
    };

type DeletePersonResult = {
  success: true;
  action: "delete";
  commitSha: string | null;
  filePath: string;
};

function normalizePeoplePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.length < 3 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }
  const safePath = segments.join("/");
  if (
    !safePath.startsWith("people/contacts/") &&
    !safePath.startsWith("people/organizations/")
  ) {
    return null;
  }
  if (!safePath.endsWith(".qmd")) return null;
  return safePath;
}

function trimOrNull(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function trimStringMap(
  value: unknown,
  options?: { maxEntries?: number; maxKeyLength?: number; maxValueLength?: number },
): Record<string, string> {
  const maxEntries = options?.maxEntries ?? 12;
  const maxKeyLength = options?.maxKeyLength ?? 40;
  const maxValueLength = options?.maxValueLength ?? 240;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const next: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(next).length >= maxEntries) break;
    if (typeof rawValue !== "string") continue;
    const key = rawKey
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_ -]+/g, "")
      .replace(/\s+/g, "_");
    const normalizedValue = rawValue.trim();
    if (!key || !normalizedValue) continue;
    next[key.slice(0, maxKeyLength)] = normalizedValue.slice(0, maxValueLength);
  }

  return next;
}

function trimStringArray(value: unknown, maxEntries = 24, maxLength = 160): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/)
      : [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of source) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().slice(0, maxLength);
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
    if (next.length >= maxEntries) break;
  }
  return next;
}

function mapPendingSignals(
  signals: Awaited<ReturnType<typeof listPendingSignalsForCompany>>,
): PendingPeopleSignal[] {
  return signals.map((signal) => ({
    id: signal.id,
    title: signal.title,
    summary: signal.summary,
    targetDomain: signal.targetDomain,
    sourceLabel: signal.sourceLabel,
    structuredData: signal.structuredData,
    proposedFrontmatter: signal.proposedFrontmatter,
  }));
}

function sortPeopleRecords<T extends { actionRequired: boolean; lastInteraction: string | null; name: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (a.actionRequired !== b.actionRequired) {
      return a.actionRequired ? -1 : 1;
    }
    const aTime = a.lastInteraction ? new Date(a.lastInteraction).getTime() : 0;
    const bTime = b.lastInteraction ? new Date(b.lastInteraction).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.name.localeCompare(b.name);
  });
}

function buildEntityResultFromFrontmatter(
  filePath: string,
  frontmatter: Record<string, unknown>,
): EntityResult {
  return {
    qualifiedId:
      typeof frontmatter.id === "string" && frontmatter.id.trim()
        ? frontmatter.id
        : filePath,
    type:
      typeof frontmatter.type === "string" && frontmatter.type.trim()
        ? frontmatter.type
        : "contact_profile",
    domain: "people",
    filePath,
    frontmatter,
    title:
      typeof frontmatter.title === "string" && frontmatter.title.trim()
        ? frontmatter.title
        : null,
    status:
      typeof frontmatter.status === "string" && frontmatter.status.trim()
        ? frontmatter.status
        : null,
    createdAt:
      typeof frontmatter.created_at === "string" ? frontmatter.created_at : null,
    updatedAt:
      typeof frontmatter.updated_at === "string" ? frontmatter.updated_at : null,
  };
}

function slugify(value: string, fallback: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (normalized) return normalized;
  return `${fallback}-${createHash("sha1").update(value || fallback).digest("hex").slice(0, 8)}`;
}

async function loadPersonEntities(
  companySlug: string,
  port: number,
  callerId: string,
  callerRole: string | undefined,
) {
  const entities = await queryAllEntities(
    {
      domain: "people",
      view: "summary",
    },
    {
      companySlug,
      callerId,
      callerRole,
      port,
    },
  );

  return entities
    .filter((entity) =>
      entity.filePath.startsWith("people/contacts/") ||
      entity.filePath.startsWith("people/organizations/"),
    )
    .filter((entity) => !entity.filePath.endsWith("/_summary.qmd"))
    .slice(0, MAX_PEOPLE);
}

async function readPendingSignals(companyId: string) {
  return mapPendingSignals(await listPendingSignalsForCompany(companyId, MAX_SIGNALS));
}

async function refreshPeopleSummaries(context: PeopleCompanyContext) {
  await refreshSummaryTargets({
    companySlug: context.companySlug,
    port: context.port,
    writeQueuePort: context.writeQueuePort,
    domains: ["people"],
    reason: "manual_edit",
  }).catch(() => null);
}

export async function resolvePeopleCompanyContext(input: {
  companyId: string;
  callerId: string;
  callerRole?: string;
}): Promise<PeopleCompanyContext> {
  const companySlug = await getCompanySlug(input.companyId);
  const [company] = await db
    .select({ companyDbPort: companies.companyDbPort })
    .from(companies)
    .where(eq(companies.id, input.companyId));

  const port = company?.companyDbPort ?? 3100;
  return {
    companyId: input.companyId,
    companySlug,
    port,
    writeQueuePort: port + 1,
    callerId: input.callerId,
    callerRole: input.callerRole,
  };
}

export async function buildPeoplePayload(input: BuildPeoplePayloadInput) {
  const [entities, pendingSignals] = await Promise.all([
    loadPersonEntities(
      input.companySlug,
      input.port,
      input.callerId,
      input.callerRole,
    ),
    readPendingSignals(input.companyId),
  ]);

  const people = (
    await Promise.all(
      entities.map(async (entity) => {
        const raw = await readQmdFile(entity.filePath, {
          companySlug: input.companySlug,
          callerId: input.callerId,
          callerRole: input.callerRole,
          port: input.port,
        });
        if (!raw) return null;
        return buildPersonRecord(entity, raw, pendingSignals);
      }),
    )
  ).filter((row): row is NonNullable<typeof row> => row !== null);

  const sorted = sortPeopleRecords(people.filter((row) => isActivePersonLifecycle(row.crmStatus)));
  const resourceCount = entities.filter(
    (entity) =>
      entity.filePath.startsWith("people/resources/") ||
      entity.filePath === "people/_index.qmd",
  ).length;
  return {
    data: sorted,
    count: sorted.length,
    actionCount: sorted.filter((row) => row.actionRequired).length,
    pendingSignalCount: pendingSignals.length,
    resourceCount,
  };
}

async function readPersonRecord(
  context: PeopleCompanyContext,
  filePath: string,
): Promise<string | null> {
  return readQmdFile(filePath, {
    companySlug: context.companySlug,
    callerId: context.callerId,
    callerRole: context.callerRole,
    port: context.port,
  });
}

async function ensureUniquePeoplePath(
  context: PeopleCompanyContext,
  profileKind: "contact" | "organization",
  name: string,
): Promise<string> {
  const baseSlug = slugify(name, profileKind);
  const prefix = profileKind === "contact" ? "people/contacts" : "people/organizations";
  const candidate = `${prefix}/${baseSlug}.qmd`;
  const existing = await readPersonRecord(context, candidate);
  if (!existing) return candidate;

  const suffix = createHash("sha1")
    .update(`${name}:${Date.now()}`)
    .digest("hex")
    .slice(0, 8);
  return `${prefix}/${baseSlug}-${suffix}.qmd`;
}

function buildManualProfileQmd(input: {
  profileKind: "contact" | "organization";
  name: string;
  filePath: string;
  displayName: string | null;
  role: string | null;
  organization: string | null;
  relatedCompanies: string[];
  analysisContext: string | null;
  description: string | null;
  crmChannels: Record<string, string>;
  nextAction: string | null;
  owner: string | null;
  actionRequired: boolean;
  updatedBy: string;
}): string {
  const now = new Date().toISOString();
  const slug = input.filePath.split("/").pop()?.replace(/\.qmd$/, "") ?? slugify(input.name, input.profileKind);

  const frontmatter: Record<string, unknown> =
    input.profileKind === "contact"
      ? {
          id: `people-contact-${slug}`,
          type: "contact_profile",
          title: input.name,
          name: input.name,
          display_name: input.displayName ?? input.name,
          role: input.role,
          organization: input.organization,
          related_companies: input.relatedCompanies,
          analysis_context: input.analysisContext,
          channels: {},
          crm_channels: input.crmChannels,
          tags: [],
          first_seen: now,
          last_interaction: null,
          interaction_count: 0,
          overall_confidence: "1",
          source_message_ids: [],
          crm_description: input.description,
          action_required: input.actionRequired,
          next_action: input.nextAction,
          owner: input.owner,
          crm_updated_by: input.updatedBy,
          crm_updated_at: now,
          crm_status: "active",
          merged_into: null,
          created_at: now,
          updated_at: now,
        }
      : {
          id: `organization-${slug}`,
          type: "organization_profile",
          title: input.name,
          name: input.name,
          display_name: input.displayName ?? input.name,
          role: input.role,
          domains: [],
          crm_channels: input.crmChannels,
          relationship_since: now,
          last_interaction: null,
          overall_confidence: "1",
          source_message_ids: [],
          crm_description: input.description,
          action_required: input.actionRequired,
          next_action: input.nextAction,
          owner: input.owner,
          crm_updated_by: input.updatedBy,
          crm_updated_at: now,
          crm_status: "active",
          merged_into: null,
          created_at: now,
          updated_at: now,
        };

  const body = ["## Summary", input.description ?? "Manual CRM profile."].join("\n");
  return toQmd(frontmatter, body);
}

export async function createPersonProfile(
  context: PeopleCompanyContext,
  body: CreatePersonInput,
): Promise<CreatePersonResult> {
  const profileKind = body.profileKind === "organization" ? "organization" : "contact";
  const name = trimOrNull(body.name, 160);
  if (!name) {
    throw new PeopleRequestError(400, "name is required");
  }

  const displayName = trimOrNull(body.displayName, 160);
  const role = trimOrNull(body.role, 160);
  const organization = trimOrNull(body.organization, 160);
  const relatedCompanies = trimStringArray(body.relatedCompanies);
  const analysisContext = trimOrNull(body.analysisContext, 2000);
  const description = trimOrNull(body.description, 2000);
  const crmChannels = trimStringMap(body.crmChannels);
  const nextAction = trimOrNull(body.nextAction, 240);
  const owner = trimOrNull(body.owner, 120);
  const actionRequired = body.actionRequired === true;

  const filePath = await ensureUniquePeoplePath(context, profileKind, name);
  const content = buildManualProfileQmd({
    profileKind,
    name,
    filePath,
    displayName,
    role,
    organization,
    relatedCompanies,
    analysisContext,
    description,
    crmChannels,
    nextAction,
    owner,
    actionRequired,
    updatedBy: context.callerId,
  });

  const commit = await submitCompanyDbCommit(
    context.companySlug,
    {
      domain: "people",
      filePath,
      content,
      commitMessage: `people: create ${profileKind} ${name}`,
      metadata: {
        source: "people-crm",
        action: "create",
        filePath,
        updatedBy: context.callerId,
      },
    },
    context.writeQueuePort,
  );

  await refreshPeopleSummaries(context);

  const record = buildPersonRecord(
    buildEntityResultFromFrontmatter(filePath, parseQmd(content).frontmatter),
    content,
    await readPendingSignals(context.companyId),
  );

  return {
    success: true,
    commitSha: commit.commitSha,
    filePath,
    person: record,
  };
}

export async function updatePersonProfile(
  context: PeopleCompanyContext,
  body: UpdatePersonInput,
): Promise<UpdatePersonResult> {
  const action = body.action ?? "update";
  const filePath = normalizePeoplePath(body.filePath);
  if (!filePath) {
    throw new PeopleRequestError(400, "Valid people filePath is required");
  }

  const raw = await readPersonRecord(context, filePath);
  if (!raw) {
    throw new PeopleRequestError(404, "Profile not found");
  }

  if (action === "archive") {
    const content = archivePersonProfileQmd(raw, { updatedBy: context.callerId });
    const commit = await submitCompanyDbCommit(
      context.companySlug,
      {
        domain: "people",
        filePath,
        content,
        commitMessage: `people: archive ${filePath}`,
        metadata: {
          source: "people-crm",
          filePath,
          updatedBy: context.callerId,
          action,
        },
      },
      context.writeQueuePort,
    );

    await refreshPeopleSummaries(context);
    return {
      success: true,
      action,
      commitSha: commit.commitSha,
    };
  }

  if (action === "merge") {
    const targetFilePath = normalizePeoplePath(body.targetFilePath);
    if (!targetFilePath || targetFilePath === filePath) {
      throw new PeopleRequestError(400, "A different merge target is required");
    }

    const targetRaw = await readPersonRecord(context, targetFilePath);
    if (!targetRaw) {
      throw new PeopleRequestError(404, "Merge target not found");
    }

    if (
      normalizePeoplePath(filePath)?.split("/")[1] !==
      normalizePeoplePath(targetFilePath)?.split("/")[1]
    ) {
      throw new PeopleRequestError(
        400,
        "Contacts can only merge into contacts, and organizations into organizations",
      );
    }

    const sourceParsed = parseQmd(raw);
    const targetParsed = parseQmd(targetRaw);
    const merged = mergePersonProfilesQmd({
      sourceRawQmd: raw,
      targetRawQmd: targetRaw,
      targetFilePath,
      updatedBy: context.callerId,
    });

    const commit = await submitAgentCommit(
      context.companySlug,
      {
        agentId: "consultant-agent",
        domain: "people",
        files: [
          { path: targetFilePath, content: merged.targetContent },
          { path: filePath, content: merged.sourceContent },
        ],
        commitMessage: `people: merge ${String(sourceParsed.frontmatter.title ?? sourceParsed.frontmatter.name ?? filePath)} into ${String(targetParsed.frontmatter.title ?? targetParsed.frontmatter.name ?? targetFilePath)}`,
        metadata: {
          source: "people-crm",
          action,
          sourceFilePath: filePath,
          targetFilePath,
          updatedBy: context.callerId,
        },
      },
      context.writeQueuePort,
    );

    await refreshPeopleSummaries(context);
    return {
      success: true,
      action,
      commitSha: commit.commitSha,
      targetFilePath,
    };
  }

  const parsed = parseQmd(raw);
  const frontmatter = { ...parsed.frontmatter };

  const description = trimOrNull(body.description, 2000);
  const displayName = trimOrNull(body.displayName, 160);
  const role = trimOrNull(body.role, 160);
  const organization = trimOrNull(body.organization, 160);
  const relatedCompanies = trimStringArray(body.relatedCompanies);
  const analysisContext = trimOrNull(body.analysisContext, 2000);
  const crmChannels = trimStringMap(body.crmChannels);
  const nextAction = trimOrNull(body.nextAction, 240);
  const owner = trimOrNull(body.owner, 120);
  const actionRequired =
    typeof body.actionRequired === "boolean"
      ? body.actionRequired
      : frontmatter.action_required === true;

  if (description) {
    frontmatter.crm_description = description;
  } else {
    delete frontmatter.crm_description;
  }

  if (displayName) {
    frontmatter.display_name = displayName;
  } else {
    delete frontmatter.display_name;
  }

  if (role) {
    frontmatter.role = role;
  } else {
    delete frontmatter.role;
  }

  if (organization) {
    frontmatter.organization = organization;
  } else {
    delete frontmatter.organization;
  }

  if (relatedCompanies.length > 0) {
    frontmatter.related_companies = relatedCompanies;
  } else {
    delete frontmatter.related_companies;
  }

  if (analysisContext) {
    frontmatter.analysis_context = analysisContext;
  } else {
    delete frontmatter.analysis_context;
  }

  if (Object.keys(crmChannels).length > 0) {
    frontmatter.crm_channels = crmChannels;
  } else {
    delete frontmatter.crm_channels;
  }

  if (nextAction) {
    frontmatter.next_action = nextAction;
  } else {
    delete frontmatter.next_action;
  }

  if (owner) {
    frontmatter.owner = owner;
  } else {
    delete frontmatter.owner;
  }

  frontmatter.action_required = actionRequired;
  frontmatter.crm_updated_by = context.callerId;
  frontmatter.crm_updated_at = new Date().toISOString();
  frontmatter.updated_at = new Date().toISOString();

  const content = toQmd(frontmatter, parsed.body);
  const commitMessage = `people: update crm ${String(frontmatter.title ?? frontmatter.name ?? filePath)}`;
  const commit = await submitCompanyDbCommit(
    context.companySlug,
    {
      domain: "people",
      filePath,
      content,
      commitMessage,
      metadata: {
        source: "people-crm",
        filePath,
        updatedBy: context.callerId,
      },
    },
    context.writeQueuePort,
  );

  await refreshPeopleSummaries(context);

  const entity = buildEntityResultFromFrontmatter(filePath, frontmatter);
  const record = buildPersonRecord(entity, content, await readPendingSignals(context.companyId));

  return {
    success: true,
    action: "update",
    commitSha: commit.commitSha,
    person: record,
  };
}

export async function deletePersonProfile(
  context: PeopleCompanyContext,
  body: { filePath?: unknown },
): Promise<DeletePersonResult> {
  const filePath = normalizePeoplePath(body.filePath);
  if (!filePath) {
    throw new PeopleRequestError(400, "Valid people filePath is required");
  }

  const raw = await readPersonRecord(context, filePath);
  if (!raw) {
    throw new PeopleRequestError(404, "Profile not found");
  }

  const commit = await submitCompanyDbDelete(
    context.companySlug,
    {
      domain: "people",
      filePaths: [filePath],
      commitMessage: `people: delete ${filePath}`,
      metadata: {
        source: "people-crm",
        action: "delete",
        filePath,
        updatedBy: context.callerId,
      },
    },
    context.writeQueuePort,
  );

  await refreshPeopleSummaries(context);

  return {
    success: true,
    action: "delete",
    commitSha: commit.commitSha,
    filePath,
  };
}
