import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { getSessionCompanyContext, handleApiError } from "@/lib/api-auth";
import {
  queryAllEntities,
  readQmdFile,
  submitAgentCommit,
  submitCompanyDbCommit,
  submitCompanyDbDelete,
  type EntityResult,
} from "@/lib/company-db/client";
import { refreshSummaryTargets } from "@/lib/company-db/summary/materializer";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { parseQmd, toQmd } from "@/lib/company-db/summary/qmd";
import { listPendingSignalsForCompany } from "@/lib/communications/store";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import {
  buildPeoplePayload as buildPeoplePayloadFromApi,
  createPersonProfile,
  PeopleRequestError,
  resolvePeopleCompanyContext as resolvePeopleCompanyContextFromApi,
} from "@/lib/people/api";
import { buildPersonRecord, type PendingPeopleSignal } from "@/lib/people/crm";
import {
  archivePersonProfileQmd,
  isActivePersonLifecycle,
  mergePersonProfilesQmd,
} from "@/lib/people/profile-actions";

const MAX_PEOPLE = 400;
const MAX_SIGNALS = 200;

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
    const key = rawKey.trim().toLowerCase().replace(/[^a-z0-9_ -]+/g, "").replace(/\s+/g, "_");
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

async function resolveCompanyContext(companyId: string) {
  const companySlug = await getCompanySlug(companyId);
  const [company] = await db
    .select({ companyDbPort: companies.companyDbPort })
    .from(companies)
    .where(eq(companies.id, companyId));

  const port = company?.companyDbPort ?? 3100;
  return {
    companySlug,
    port,
    writeQueuePort: port + 1,
  };
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

async function buildPeoplePayload(input: {
  companyId: string;
  companySlug: string;
  port: number;
  callerId: string;
  callerRole: string | undefined;
}) {
  const [entities, pendingSignals] = await Promise.all([
    loadPersonEntities(
      input.companySlug,
      input.port,
      input.callerId,
      input.callerRole,
    ),
    listPendingSignalsForCompany(input.companyId, MAX_SIGNALS),
  ]);

  const mappedSignals = mapPendingSignals(pendingSignals);
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
        return buildPersonRecord(entity, raw, mappedSignals);
      }),
    )
  ).filter((row): row is NonNullable<typeof row> => row !== null);

  const sorted = sortPeopleRecords(people.filter((row) => isActivePersonLifecycle(row.crmStatus)));
  return {
    data: sorted,
    count: sorted.length,
    actionCount: sorted.filter((row) => row.actionRequired).length,
  };
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

export async function GET() {
  try {
    const auth = await getSessionCompanyContext();
    const context = await resolvePeopleCompanyContextFromApi({
      companyId: auth.companyId,
      callerId: auth.userId,
      callerRole: auth.role,
    });
    return NextResponse.json(await buildPeoplePayloadFromApi(context));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getSessionCompanyContext();
    const company = await resolveCompanyContext(auth.companyId);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const result = await createPersonProfile(
      {
        companyId: auth.companyId,
        companySlug: company.companySlug,
        port: company.port,
        writeQueuePort: company.writeQueuePort,
        callerId: auth.userId,
        callerRole: auth.role,
      },
      body,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PeopleRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await getSessionCompanyContext();
    const company = await resolveCompanyContext(auth.companyId);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const action = typeof body?.action === "string" ? body.action : "update";
    const filePath = normalizePeoplePath(body?.filePath);

    if (!filePath) {
      return NextResponse.json(
        { error: "Valid people filePath is required" },
        { status: 400 },
      );
    }

    const raw = await readQmdFile(filePath, {
      companySlug: company.companySlug,
      callerId: auth.userId,
      callerRole: auth.role,
      port: company.port,
    });
    if (!raw) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    if (action === "archive") {
      const content = archivePersonProfileQmd(raw, { updatedBy: auth.userId });
      const commit = await submitCompanyDbCommit(
        company.companySlug,
        {
          domain: "people",
          filePath,
          content,
          commitMessage: `people: archive ${filePath}`,
          metadata: {
            source: "people-crm",
            filePath,
            updatedBy: auth.userId,
            action,
          },
        },
        company.writeQueuePort,
      );

      await refreshSummaryTargets({
        companySlug: company.companySlug,
        port: company.port,
        writeQueuePort: company.writeQueuePort,
        domains: ["people"],
        reason: "manual_edit",
      }).catch(() => null);

      return NextResponse.json({
        success: true,
        action,
        commitSha: commit.commitSha,
      });
    }

    if (action === "merge") {
      const targetFilePath = normalizePeoplePath(body?.targetFilePath);
      if (!targetFilePath || targetFilePath === filePath) {
        return NextResponse.json(
          { error: "A different merge target is required" },
          { status: 400 },
        );
      }

      const targetRaw = await readQmdFile(targetFilePath, {
        companySlug: company.companySlug,
        callerId: auth.userId,
        callerRole: auth.role,
        port: company.port,
      });
      if (!targetRaw) {
        return NextResponse.json({ error: "Merge target not found" }, { status: 404 });
      }

      const sourceParsed = parseQmd(raw);
      const targetParsed = parseQmd(targetRaw);
      if (
        normalizePeoplePath(filePath)?.split("/")[1] !==
        normalizePeoplePath(targetFilePath)?.split("/")[1]
      ) {
        return NextResponse.json(
          { error: "Contacts can only merge into contacts, and organizations into organizations" },
          { status: 400 },
        );
      }

      const merged = mergePersonProfilesQmd({
        sourceRawQmd: raw,
        targetRawQmd: targetRaw,
        targetFilePath,
        updatedBy: auth.userId,
      });

      const commit = await submitAgentCommit(
        company.companySlug,
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
            updatedBy: auth.userId,
          },
        },
        company.writeQueuePort,
      );

      await refreshSummaryTargets({
        companySlug: company.companySlug,
        port: company.port,
        writeQueuePort: company.writeQueuePort,
        domains: ["people"],
        reason: "manual_edit",
      }).catch(() => null);

      return NextResponse.json({
        success: true,
        action,
        commitSha: commit.commitSha,
        targetFilePath,
      });
    }

    const parsed = parseQmd(raw);
    const frontmatter = { ...parsed.frontmatter };

    const description = trimOrNull(body?.description, 2000);
    const displayName = trimOrNull(body?.displayName, 160);
    const role = trimOrNull(body?.role, 160);
    const organization = trimOrNull(body?.organization, 160);
    const relatedCompanies = trimStringArray(body?.relatedCompanies);
    const analysisContext = trimOrNull(body?.analysisContext, 2000);
    const crmChannels = trimStringMap(body?.crmChannels);
    const nextAction = trimOrNull(body?.nextAction, 240);
    const owner = trimOrNull(body?.owner, 120);
    const actionRequired =
      typeof body?.actionRequired === "boolean"
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
    frontmatter.crm_updated_by = auth.userId;
    frontmatter.crm_updated_at = new Date().toISOString();
    frontmatter.updated_at = new Date().toISOString();

    const content = toQmd(frontmatter, parsed.body);
    const commitMessage = `people: update crm ${String(frontmatter.title ?? frontmatter.name ?? filePath)}`;

    const commit = await submitCompanyDbCommit(
      company.companySlug,
      {
        domain: "people",
        filePath,
        content,
        commitMessage,
        metadata: {
          source: "people-crm",
          filePath,
          updatedBy: auth.userId,
        },
      },
      company.writeQueuePort,
    );

    await refreshSummaryTargets({
      companySlug: company.companySlug,
      port: company.port,
      writeQueuePort: company.writeQueuePort,
      domains: ["people"],
      reason: "manual_edit",
    }).catch(() => null);

    const entity = buildEntityResultFromFrontmatter(filePath, frontmatter);

    const pendingSignals = await listPendingSignalsForCompany(auth.companyId, MAX_SIGNALS);
    const record = buildPersonRecord(entity, content, mapPendingSignals(pendingSignals));

    return NextResponse.json({
      success: true,
      commitSha: commit.commitSha,
      person: record,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await getSessionCompanyContext();
    const company = await resolveCompanyContext(auth.companyId);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const filePath = normalizePeoplePath(body?.filePath);

    if (!filePath) {
      return NextResponse.json(
        { error: "Valid people filePath is required" },
        { status: 400 },
      );
    }

    const raw = await readQmdFile(filePath, {
      companySlug: company.companySlug,
      callerId: auth.userId,
      callerRole: auth.role,
      port: company.port,
    });
    if (!raw) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const commit = await submitCompanyDbDelete(
      company.companySlug,
      {
        domain: "people",
        filePaths: [filePath],
        commitMessage: `people: delete ${filePath}`,
        metadata: {
          source: "people-crm",
          action: "delete",
          filePath,
          updatedBy: auth.userId,
        },
      },
      company.writeQueuePort,
    );

    await refreshSummaryTargets({
      companySlug: company.companySlug,
      port: company.port,
      writeQueuePort: company.writeQueuePort,
      domains: ["people"],
      reason: "manual_edit",
    }).catch(() => null);

    return NextResponse.json({
      success: true,
      action: "delete",
      commitSha: commit.commitSha,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
