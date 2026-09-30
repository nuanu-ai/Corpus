import { NextRequest, NextResponse } from "next/server";

import {
  getApiKeyAgentContext,
  handleApiError,
  requireGrantedApiKeyScope,
  type ApiKeyAuthContext,
  type AuthContext,
} from "@/lib/api-auth";
import { resolveApiKeyCompanyId } from "@/lib/api-key-access-runtime";
import type { CompanyMembership } from "@/lib/db/tenant";
import {
  createPlannedReportJob,
  listReportJobsForUser,
  queueReportJob,
} from "@/lib/report-jobs/store";
import {
  filterReportJobAccessibleCompanies,
  requireReportJobInheritedAccess,
} from "@/lib/report-jobs/access";
import { requireRoutineDomainAccess, type RoutineAccessLevel } from "@/lib/routines/api-access";
import { getCompanyRoutine, getRoutineRun } from "@/lib/routines/store";
import {
  reportOutputFormatSchema,
  reportStrictnessSchema,
} from "@/lib/report-jobs/types";

function parseRequestedCompanyId(body: Record<string, unknown>): string | null {
  if (typeof body.company_id === "string" && body.company_id.length > 0) return body.company_id;
  if (typeof body.companyId === "string" && body.companyId.length > 0) return body.companyId;
  return null;
}

function parseRequestedRoutineId(body: Record<string, unknown>): string | null {
  if (typeof body.routine_id === "string" && body.routine_id.length > 0) {
    return body.routine_id;
  }
  if (typeof body.routineId === "string" && body.routineId.length > 0) {
    return body.routineId;
  }
  return null;
}

function parseRequestedRoutineRunId(body: Record<string, unknown>): string | null {
  if (
    typeof body.routine_run_id === "string" &&
    body.routine_run_id.length > 0
  ) {
    return body.routine_run_id;
  }
  if (typeof body.routineRunId === "string" && body.routineRunId.length > 0) {
    return body.routineRunId;
  }
  return null;
}

function resolveCompanyIdForRoutineRunFilter(input: {
  companyId: string | null;
  routineId: string | null;
  routineRunId: string | null;
  defaultCompanyId: string | null;
  reportJobCompanies: Array<{ companyId: string }>;
}): { companyId: string | null; error?: Response } {
  if (!input.routineId && !input.routineRunId) return { companyId: input.companyId };
  if (input.companyId) return { companyId: input.companyId };

  if (input.defaultCompanyId) {
    const defaultCompany = input.reportJobCompanies.find(
      (company) => company.companyId === input.defaultCompanyId,
    );
    if (defaultCompany) return { companyId: defaultCompany.companyId };
  }

  if (input.reportJobCompanies.length === 1) {
    return { companyId: input.reportJobCompanies[0].companyId };
  }

  return {
    companyId: null,
    error: NextResponse.json(
      { error: "company_id is required when filtering by routine_run_id" },
      { status: 400 },
    ),
  };
}

function buildApiKeyRoutineAuthContext(
  apiKey: ApiKeyAuthContext,
  membership: CompanyMembership,
): AuthContext {
  return {
    userId: apiKey.userId,
    companyId: membership.companyId,
    role: membership.role,
    authMethod: "api_key",
    apiKeyScopes: apiKey.scopes,
    apiKeyCompanyScopeMode: apiKey.companyScopeMode,
    apiKeyDefaultCompanyId: apiKey.defaultCompanyId,
    apiKeyAllowedCompanyIds: apiKey.allowedCompanyIds,
    apiKeyAccessPolicyVersion: apiKey.accessPolicyVersion,
    companyAccessSource: membership.accessSource,
    companyViaCompanyId: membership.viaCompanyId ?? null,
    companyViaCompanyName: membership.viaCompanyName ?? null,
    companyViaCompanySlug: membership.viaCompanySlug ?? null,
    companyRelationshipId: membership.relationshipId ?? null,
    companyRelationshipType: membership.relationshipType ?? null,
    companyAllowedDomains: membership.allowedDomains ?? null,
    companyDomainAccessLevels: membership.domainAccessLevels ?? null,
    companyAllowedConnectorScopes: membership.allowedConnectorScopes ?? null,
    companyDomainAccessSource: membership.domainAccessSource,
    companyPathEdgeIds: membership.pathEdgeIds ?? null,
  };
}

async function resolveRoutineRunIdForReportJob(input: {
  apiKey: ApiKeyAuthContext;
  membership: CompanyMembership | null;
  routineId: string | null;
  routineRunId: string | null;
  accessLevel: RoutineAccessLevel;
}): Promise<{ routineRunId: string | null; error?: Response }> {
  if (!input.routineRunId && !input.routineId) return { routineRunId: null };
  if (!input.routineRunId || !input.routineId) {
    return {
      routineRunId: null,
      error: NextResponse.json(
        { error: "routine_id and routine_run_id must be provided together" },
        { status: 400 },
      ),
    };
  }
  if (!input.membership) {
    return {
      routineRunId: null,
      error: NextResponse.json(
        { error: "company_id is required when filtering by routine_run_id" },
        { status: 400 },
      ),
    };
  }

  const routine = await getCompanyRoutine(input.membership.companyId, input.routineId);
  if (!routine) {
    return {
      routineRunId: null,
      error: NextResponse.json({ error: "Routine not found" }, { status: 404 }),
    };
  }
  requireRoutineDomainAccess(
    buildApiKeyRoutineAuthContext(input.apiKey, input.membership),
    routine,
    input.accessLevel,
  );

  const run = await getRoutineRun({
    companyId: input.membership.companyId,
    routineId: input.routineId,
    runId: input.routineRunId,
  });
  if (!run) {
    return {
      routineRunId: null,
      error: NextResponse.json(
        { error: "routine_run_id is not accessible for this company and routine" },
        { status: 404 },
      ),
    };
  }

  return { routineRunId: run.id };
}

export async function GET(req: NextRequest) {
  try {
    const { apiKey, companies } = await getApiKeyAgentContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
    requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");

    const url = new URL(req.url);
    const requestedCompanyId = url.searchParams.get("company_id");
    const requestedRoutineId =
      url.searchParams.get("routine_id") ?? url.searchParams.get("routineId");
    const requestedRoutineRunId =
      url.searchParams.get("routine_run_id") ?? url.searchParams.get("routineRunId");
    const limitParam = Number(url.searchParams.get("limit") ?? "20");
    const reportJobCompanies = filterReportJobAccessibleCompanies(companies);
    let companyId: string | null = null;
    if (requestedCompanyId) {
      const membership =
        companies.find((company) => company.companyId === requestedCompanyId) ?? null;
      if (!membership) {
        return NextResponse.json(
          { error: "company_id is required or not accessible for this key" },
          { status: 400 },
        );
      }
      requireReportJobInheritedAccess(membership);
      companyId = membership.companyId;
    }
    const routineRunCompany = resolveCompanyIdForRoutineRunFilter({
      companyId,
      routineId: requestedRoutineId,
      routineRunId: requestedRoutineRunId,
      defaultCompanyId: apiKey.defaultCompanyId,
      reportJobCompanies,
    });
    if (routineRunCompany.error) return routineRunCompany.error;
    companyId = routineRunCompany.companyId;
    const routineRunMembership = companyId
      ? reportJobCompanies.find((company) => company.companyId === companyId) ?? null
      : null;

    const routineRun = await resolveRoutineRunIdForReportJob({
      apiKey,
      membership: routineRunMembership,
      routineId: requestedRoutineId,
      routineRunId: requestedRoutineRunId,
      accessLevel: "read",
    });
    if (routineRun.error) return routineRun.error;

    const jobs = await listReportJobsForUser({
      userId: apiKey.userId,
      accessibleCompanyIds: reportJobCompanies.map((membership) => membership.companyId),
      companyId,
      routineRunId: routineRun.routineRunId,
      limit: Number.isFinite(limitParam) ? limitParam : 20,
    });

    return NextResponse.json({
      jobs,
      companyScopeMode: apiKey.companyScopeMode,
      defaultCompanyId: apiKey.defaultCompanyId,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, companies } = await getApiKeyAgentContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
    requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (typeof body.request !== "string" || body.request.trim().length === 0) {
      return NextResponse.json({ error: "request is required" }, { status: 400 });
    }

    const companyId = resolveApiKeyCompanyId(parseRequestedCompanyId(body), companies, {
      companyScopeMode: apiKey.companyScopeMode,
      defaultCompanyId: apiKey.defaultCompanyId,
      allowedCompanyIds: apiKey.allowedCompanyIds,
    });
    if (!companyId) {
      return NextResponse.json(
        { error: "company_id is required or not accessible for this key" },
        { status: 400 },
      );
    }
    const membership =
      companies.find((company) => company.companyId === companyId) ?? null;
    if (!membership) {
      return NextResponse.json(
        { error: "company_id is required or not accessible for this key" },
        { status: 400 },
      );
    }
    requireReportJobInheritedAccess(membership);
    const routineRun = await resolveRoutineRunIdForReportJob({
      apiKey,
      membership,
      routineId: parseRequestedRoutineId(body),
      routineRunId: parseRequestedRoutineRunId(body),
      accessLevel: "write",
    });
    if (routineRun.error) return routineRun.error;

    const outputFormat =
      body.output_format !== undefined
        ? reportOutputFormatSchema.safeParse(body.output_format)
        : reportOutputFormatSchema.safeParse(body.outputFormat);
    if (
      (body.output_format !== undefined || body.outputFormat !== undefined) &&
      !outputFormat.success
    ) {
      return NextResponse.json(
        { error: "output_format must be one of markdown, docx, xlsx" },
        { status: 400 },
      );
    }

    const strictness =
      body.strictness !== undefined
        ? reportStrictnessSchema.safeParse(body.strictness)
        : { success: true as const, data: undefined };
    if (body.strictness !== undefined && !strictness.success) {
      return NextResponse.json(
        { error: "strictness must be one of standard or strict" },
        { status: 400 },
      );
    }

    const created = await createPlannedReportJob({
      companyId,
      requestedByUserId: apiKey.userId,
      routineRunId: routineRun.routineRunId,
      request: body.request,
      outputFormat: outputFormat.success ? outputFormat.data : undefined,
      strictness: strictness.success ? strictness.data : undefined,
      executionContext: {
        surface: "agent_rest",
        companyScopeMode: apiKey.companyScopeMode,
        allowedCompanyIds: apiKey.allowedCompanyIds,
        companyAccessSource: membership.accessSource ?? "direct",
        viaCompanyId: membership.viaCompanyId ?? null,
        allowedDomains: membership.allowedDomains ?? null,
        domainAccessLevels: membership.domainAccessLevels ?? null,
        domainAccessSource: membership.domainAccessSource ?? null,
        allowedConnectorScopes: membership.allowedConnectorScopes ?? null,
      },
    });

    let job = created.job;
    if (job.status === "planned") {
      const queued = await queueReportJob(job.id);
      if (queued) {
        job = queued;
      }
    }

    return NextResponse.json(
      {
        job,
        reusedExistingJob: created.reusedExistingJob,
      },
      { status: created.reusedExistingJob ? 200 : 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
