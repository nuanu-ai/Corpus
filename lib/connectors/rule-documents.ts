import { eq } from "drizzle-orm";

import {
  readQmdFile,
  submitCompanyDbCommit,
  submitCompanyDbDelete,
} from "@/lib/company-db/client";
import { getCompanySlug } from "@/lib/company-db/tenant";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { getConnectorProviderDefinition } from "@/lib/connectors/provider-registry";
import {
  buildConnectorRuleSummary,
  getConnectorRuleFilePath,
  getDefaultConnectorRuleTemplate,
  parseConnectorRuleFile,
  type ConnectorRuleSummary,
} from "@/lib/connectors/rules";

type ConnectorRuleCompanyContext = {
  companySlug: string;
  companyDbPort: number;
  writeQueuePort: number;
};

export type ConnectorRuleDocumentState = {
  provider: string;
  label: string;
  path: string;
  exists: boolean;
  content: string;
  template: string;
  summary: ConnectorRuleSummary;
};

async function resolveConnectorRuleCompanyContext(
  companyId: string,
): Promise<ConnectorRuleCompanyContext> {
  const companySlug = await getCompanySlug(companyId);
  const [company] = await db
    .select({ companyDbPort: companies.companyDbPort })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  const companyDbPort = company?.companyDbPort ?? 3100;
  return {
    companySlug,
    companyDbPort,
    writeQueuePort: companyDbPort + 1,
  };
}

function getRequiredConnectorProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  const definition = getConnectorProviderDefinition(normalized);
  if (!definition) {
    throw new Error(`Unsupported connector provider: ${provider}`);
  }
  return definition;
}

export async function loadConnectorRuleDocumentForCompany(input: {
  companyId: string;
  provider: string;
  callerId: string;
  callerRole?: string;
}): Promise<ConnectorRuleDocumentState> {
  const definition = getRequiredConnectorProvider(input.provider);
  const path = getConnectorRuleFilePath(definition.slug);
  const template = getDefaultConnectorRuleTemplate(definition.slug);
  const context = await resolveConnectorRuleCompanyContext(input.companyId);
  const raw = await readQmdFile(path, {
    companySlug: context.companySlug,
    callerId: input.callerId,
    callerRole: input.callerRole,
    port: context.companyDbPort,
  });

  if (raw === null) {
    return {
      provider: definition.slug,
      label: definition.label,
      path,
      exists: false,
      content: template,
      template,
      summary: {
        path,
        exists: false,
        provider: definition.slug,
        policyMode: "advisory",
        strict: false,
        notes: null,
        restrictionSummary: {},
      },
    };
  }

  try {
    const document = parseConnectorRuleFile(definition.slug, raw, path);
    return {
      provider: definition.slug,
      label: definition.label,
      path,
      exists: true,
      content: raw,
      template,
      summary: document.summary,
    };
  } catch (error) {
    return {
      provider: definition.slug,
      label: definition.label,
      path,
      exists: true,
      content: raw,
      template,
      summary: {
        path,
        exists: true,
        provider: definition.slug,
        policyMode: "advisory",
        strict: false,
        notes: null,
        restrictionSummary: {},
        error:
          error instanceof Error
            ? error.message
            : `Invalid connector rule file: ${path}`,
      },
    };
  }
}

export async function saveConnectorRuleDocumentForCompany(input: {
  companyId: string;
  provider: string;
  content: string;
  actorUserId: string;
  actorRole?: string;
}) {
  const definition = getRequiredConnectorProvider(input.provider);
  const path = getConnectorRuleFilePath(definition.slug);
  const content = input.content.trim();
  if (!content) {
    throw new Error("Connector rule content is required");
  }

  const parsed = parseConnectorRuleFile(definition.slug, content, path);
  const context = await resolveConnectorRuleCompanyContext(input.companyId);

  await submitCompanyDbCommit(
    context.companySlug,
    {
      domain: "operations",
      filePath: path,
      content,
      commitMessage: `Update ${definition.label} connector rules`,
      metadata: {
        source: "connector-rules-editor",
        provider: definition.slug,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole ?? null,
      },
    },
    context.writeQueuePort,
  );

  return {
    provider: definition.slug,
    path,
    summary: buildConnectorRuleSummary(definition.slug, parsed.frontmatter, path),
  };
}

export async function deleteConnectorRuleDocumentForCompany(input: {
  companyId: string;
  provider: string;
  actorUserId: string;
  actorRole?: string;
}) {
  const definition = getRequiredConnectorProvider(input.provider);
  const path = getConnectorRuleFilePath(definition.slug);
  const context = await resolveConnectorRuleCompanyContext(input.companyId);

  await submitCompanyDbDelete(
    context.companySlug,
    {
      domain: "operations",
      filePaths: [path],
      commitMessage: `Delete ${definition.label} connector rules`,
      metadata: {
        source: "connector-rules-editor",
        provider: definition.slug,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole ?? null,
      },
    },
    context.writeQueuePort,
  );

  return {
    provider: definition.slug,
    path,
  };
}
