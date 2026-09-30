import { NextRequest, NextResponse } from "next/server";

import {
  getApiKeyAgentContext,
  handleApiError,
  requireGrantedApiKeyScope,
} from "@/lib/api-auth";
import {
  cancelReportJobForUser,
  getReportJobByIdForUser,
  listReportJobArtifactsForUser,
} from "@/lib/report-jobs/store";
import { filterReportJobAccessibleCompanies } from "@/lib/report-jobs/access";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { apiKey, companies } = await getApiKeyAgentContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
    requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");

    const { id } = await context.params;
    const accessibleCompanyIds = filterReportJobAccessibleCompanies(companies).map(
      (membership) => membership.companyId,
    );
    const job = await getReportJobByIdForUser({
      jobId: id,
      userId: apiKey.userId,
      accessibleCompanyIds,
    });

    if (!job) {
      return NextResponse.json({ error: "Report job not found" }, { status: 404 });
    }

    const artifacts = await listReportJobArtifactsForUser({
      jobId: id,
      userId: apiKey.userId,
      accessibleCompanyIds,
    });

    return NextResponse.json({ job, artifacts });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { apiKey, companies } = await getApiKeyAgentContext();
    requireGrantedApiKeyScope(apiKey.scopes, "companies.read");
    requireGrantedApiKeyScope(apiKey.scopes, "company_db.read");

    const { id } = await context.params;
    const accessibleCompanyIds = filterReportJobAccessibleCompanies(companies).map(
      (membership) => membership.companyId,
    );
    const job = await cancelReportJobForUser({
      jobId: id,
      userId: apiKey.userId,
      accessibleCompanyIds,
    });

    if (!job) {
      return NextResponse.json(
        { error: "Report job not found or can no longer be cancelled" },
        { status: 404 },
      );
    }

    return NextResponse.json({ job });
  } catch (err) {
    return handleApiError(err);
  }
}
