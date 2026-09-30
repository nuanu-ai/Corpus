import { join } from "path";

import type { ApiKeyAuthContext } from "@/lib/api-auth";
import { resolveApiKeyCompanyId } from "@/lib/api-key-access-runtime";
import { listConnections } from "@/lib/connections";
import { getConnectorUseScopes } from "@/lib/connectors/provider-registry";
import type { CompanyMembership } from "@/lib/db/tenant";

import {
  compileAgentContextPack,
  type AgentContextAuthSurface,
  type AgentContextConnectorSnapshot,
} from "./compile";
import {
  agentContextIntentSchema,
  type AgentContextIntent,
  type AgentContextPack,
} from "./schema";
import {
  readAgentContextSourceFilesFromDirectory,
  type AgentContextSourceFile,
} from "./source-files";

export function parseAgentContextIntent(value: unknown): AgentContextIntent {
  const parsed = agentContextIntentSchema.safeParse(value);
  return parsed.success ? parsed.data : "general";
}

export function resolveAgentContextPackMembership(input: {
  apiKey: Pick<
    ApiKeyAuthContext,
    "companyScopeMode" | "defaultCompanyId" | "allowedCompanyIds"
  >;
  companies: readonly CompanyMembership[];
  requestedCompanyId?: string | null;
}): CompanyMembership | null {
  const companyId = resolveApiKeyCompanyId(
    input.requestedCompanyId ?? null,
    [...input.companies],
    {
      companyScopeMode: input.apiKey.companyScopeMode,
      defaultCompanyId: input.apiKey.defaultCompanyId,
      allowedCompanyIds: input.apiKey.allowedCompanyIds,
    },
  );

  if (!companyId) return null;
  return input.companies.find((company) => company.companyId === companyId) ?? null;
}

export async function buildAgentContextPackForMembership(input: {
  membership: CompanyMembership;
  scopes?: readonly string[] | null;
  authSurface?: AgentContextAuthSurface;
  intent?: AgentContextIntent | string | null;
  query?: string | null;
  maxItemsPerSection?: number;
}): Promise<AgentContextPack> {
  const scopes = input.scopes ?? null;
  const connectorSnapshotResult =
    input.authSurface === "api_key" && !scopes?.includes("connectors.read")
      ? { snapshots: [] }
      : await listConnectorSnapshots(input.membership);
  const agentContextSourceFileResult = await listAgentContextSourceFileSnapshots(
    input.membership,
    scopes,
  );

  return compileAgentContextPack({
    authSurface: input.authSurface ?? "api_key",
    scopes,
    intent: input.intent,
    query: input.query,
    maxItemsPerSection: input.maxItemsPerSection,
    connectorSnapshots: connectorSnapshotResult.snapshots,
    connectorSnapshotsUnavailable: connectorSnapshotResult.unavailableDetail,
    agentContextSourceFiles: agentContextSourceFileResult.sourceFiles,
    agentContextSourceFilesUnavailable: agentContextSourceFileResult.unavailableDetail,
    company: {
      id: input.membership.companyId,
      name: input.membership.companyName,
      slug: input.membership.companySlug,
      jurisdiction: input.membership.jurisdiction ?? null,
      entityType: input.membership.entityType ?? null,
      businessType: input.membership.businessType ?? null,
      website: input.membership.website ?? null,
      aliases: input.membership.aliases ?? [],
      reportingCurrency: input.membership.reportingCurrency ?? null,
      role: input.membership.role,
      settings: input.membership.companySettings,
      accessSource: input.membership.accessSource ?? "direct",
      viaCompanyId: input.membership.viaCompanyId ?? null,
      viaCompanyName: input.membership.viaCompanyName ?? null,
      allowedDomains: input.membership.allowedDomains ?? null,
      domainAccessLevels: input.membership.domainAccessLevels ?? null,
      allowedConnectorScopes: input.membership.allowedConnectorScopes ?? null,
    },
  });
}

async function listAgentContextSourceFileSnapshots(
  membership: CompanyMembership,
  scopes: readonly string[] | null,
): Promise<{
  sourceFiles: AgentContextSourceFile[];
  unavailableDetail?: string;
}> {
  if (!scopes?.includes("company_db.read")) {
    return { sourceFiles: [] };
  }

  const companySlug = membership.companySlug?.trim();
  if (!companySlug) {
    return {
      sourceFiles: [],
      unavailableDetail: "Agent Context source files require a company slug to resolve the Company-DB repository.",
    };
  }

  const repoBase = process.env.COMPANY_DB_REPO?.trim() || "/data/companies";
  try {
    const result = await readAgentContextSourceFilesFromDirectory({
      repoRoot: join(/* turbopackIgnore: true */ repoBase, companySlug),
      companyId: membership.companyId,
      companySlug,
    });
    return {
      sourceFiles: result.sourceFiles,
      unavailableDetail: result.sourceFiles.length === 0 && result.warnings.length > 0
        ? result.warnings.join(" ")
        : undefined,
    };
  } catch (error) {
    return {
      sourceFiles: [],
      unavailableDetail: `Agent Context source files unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function buildAgentContextPackForApiKey(input: {
  apiKey: ApiKeyAuthContext;
  companies: readonly CompanyMembership[];
  requestedCompanyId?: string | null;
  intent?: AgentContextIntent | string | null;
  query?: string | null;
  maxItemsPerSection?: number;
}): Promise<AgentContextPack | null> {
  const membership = resolveAgentContextPackMembership({
    apiKey: input.apiKey,
    companies: input.companies,
    requestedCompanyId: input.requestedCompanyId ?? null,
  });
  if (!membership) return null;

  return buildAgentContextPackForMembership({
    membership,
    scopes: input.apiKey.scopes,
    authSurface: "api_key",
    intent: input.intent,
    query: input.query,
    maxItemsPerSection: input.maxItemsPerSection,
  });
}

async function listConnectorSnapshots(
  membership: CompanyMembership,
): Promise<{
  snapshots: AgentContextConnectorSnapshot[];
  unavailableDetail?: string;
}> {
  try {
    const connections = await listConnections(membership.companyId);
    return {
      snapshots: connections
        .filter((connection) =>
          isConnectorSnapshotAllowed(membership, connection.provider),
        )
        .map((connection) => ({
          provider: connection.provider,
          status: connection.status,
          lastSyncAt: connection.lastSyncAt,
          lastError: connection.lastError,
          connectionLabel:
            typeof connection.metadata === "object" &&
            connection.metadata !== null &&
            "label" in connection.metadata
              ? String((connection.metadata as { label?: unknown }).label ?? "")
              : null,
        })),
    };
  } catch {
    return {
      snapshots: [],
      unavailableDetail:
        "Connector freshness snapshot is unavailable; do not infer that live integrations are missing.",
    };
  }
}

function isConnectorSnapshotAllowed(
  membership: CompanyMembership,
  provider: string,
): boolean {
  if (!membership.allowedConnectorScopes) return true;
  const requiredScopes = getConnectorUseScopes(provider);
  if (requiredScopes.length === 0) return true;
  const allowed = new Set(membership.allowedConnectorScopes);
  return requiredScopes.some((scope) => allowed.has(scope));
}
