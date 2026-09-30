import type { NextRequest } from "next/server";
import type { ApiKeyCompanyScopeMode } from "@/lib/api-key-company-scope";
import type { ApiKeyAccessPolicyVersion } from "@/lib/api-key-access-policy";
import { getCompanySlug } from "@/lib/company-db/tenant";

export type ApiKeySetupAccessInfo = {
  baseUrl: string;
  companyId: string | null;
  companySlug: string | null;
  companyScopeMode: ApiKeyCompanyScopeMode;
  accessPolicyVersion: ApiKeyAccessPolicyVersion;
  allowedCompanyIds: string[];
  endpoints: {
    agentSession: string;
    agentCompanies: string;
    agentCompanyMembers: string;
    agentProfile: string;
    agentSettings: string;
    agentDashboard: string;
    agentPeople: string;
    agentConnectors: string;
    agentMcp: string;
    agentWorkflowResolve: string;
    query: string;
    search: string;
    entity: string;
    file: string;
    mcp: string;
    connectorsHub: string;
    connectorsHubLegacy: string;
    documents: string;
    documentsUpload: string;
    documentsBatchUpload: string;
    documentQuestions: string;
    documentQuestionsTemplate: string;
    routines: string;
    routineTemplates: string;
    routineDetailTemplate: string;
    routineManifestTemplate: string;
    routineRunTemplate: string;
    routineSourcesTemplate: string;
    routineSourceTemplate: string;
    routineSourceTestTemplate: string;
    routineCandidatesTemplate: string;
    routineCandidateTemplate: string;
  };
};

export function getApiKeySetupBaseUrl(req: Request | NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    ("nextUrl" in req && req.nextUrl ? req.nextUrl.origin : new URL(req.url).origin)
  );
}

export async function buildApiKeySetupAccessInfo(
  req: Request | NextRequest,
  input: {
    defaultCompanyId: string | null;
    companyScopeMode: ApiKeyCompanyScopeMode;
    accessPolicyVersion: ApiKeyAccessPolicyVersion;
    allowedCompanyIds: string[];
  },
): Promise<ApiKeySetupAccessInfo> {
  const baseUrl = getApiKeySetupBaseUrl(req);
  const companySlug = input.defaultCompanyId
    ? await getCompanySlug(input.defaultCompanyId)
    : null;

  return {
    baseUrl,
    companyId: input.defaultCompanyId,
    companySlug,
    companyScopeMode: input.companyScopeMode,
    accessPolicyVersion: input.accessPolicyVersion,
    allowedCompanyIds: input.allowedCompanyIds,
    endpoints: {
      agentSession: `${baseUrl}/api/agent/session`,
      agentCompanies: `${baseUrl}/api/agent/companies`,
      agentCompanyMembers: `${baseUrl}/api/agent/company-members`,
      agentProfile: `${baseUrl}/api/agent/profile`,
      agentSettings: `${baseUrl}/api/agent/settings`,
      agentDashboard: `${baseUrl}/api/agent/dashboard`,
      agentPeople: `${baseUrl}/api/agent/people`,
      agentConnectors: `${baseUrl}/api/agent/connectors`,
      agentMcp: `${baseUrl}/api/agent/mcp`,
      agentWorkflowResolve: `${baseUrl}/api/agent/workflow/resolve`,
      query: `${baseUrl}/api/company/query`,
      search: `${baseUrl}/api/company/search`,
      entity: `${baseUrl}/api/company/entity`,
      file: `${baseUrl}/api/company/file`,
      mcp: `${baseUrl}/api/company/mcp`,
      connectorsHub: `${baseUrl}/api/connectors/hub`,
      connectorsHubLegacy: `${baseUrl}/api/connectors/hub`,
      documents: `${baseUrl}/api/documents`,
      documentsUpload: `${baseUrl}/api/documents/upload`,
      documentsBatchUpload: `${baseUrl}/api/documents/batch-upload`,
      documentQuestions: `${baseUrl}/api/documents/questions`,
      documentQuestionsTemplate: `${baseUrl}/api/documents/{documentId}/clarifications`,
      routines: `${baseUrl}/api/routines`,
      routineTemplates: `${baseUrl}/api/routines/templates`,
      routineDetailTemplate: `${baseUrl}/api/routines/{routineId}`,
      routineManifestTemplate: `${baseUrl}/api/routines/{routineId}/manifest`,
      routineRunTemplate: `${baseUrl}/api/routines/{routineId}/run`,
      routineSourcesTemplate: `${baseUrl}/api/routines/{routineId}/sources`,
      routineSourceTemplate: `${baseUrl}/api/routines/{routineId}/sources/{sourceId}`,
      routineSourceTestTemplate: `${baseUrl}/api/routines/{routineId}/sources/{sourceId}/test`,
      routineCandidatesTemplate: `${baseUrl}/api/routines/{routineId}/candidates`,
      routineCandidateTemplate: `${baseUrl}/api/routines/{routineId}/candidates/{candidateId}`,
    },
  };
}
