import { access, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

import { parseQmd, toQmd } from "@/lib/company-db/summary/qmd";
import type { SummaryTarget } from "@/lib/company-db/summary/types";

const SUMMARY_REGISTRY_VERSION = 2;
const RETIRED_SUMMARY_TARGET_IDS = new Set([
  "finance-snapshots-folder",
]);
const SUMMARY_AGENT_ID =
  process.env.SUMMARY_MATERIALIZER_AGENT_ID ?? "summary-materializer";

function mapTarget(raw: Record<string, unknown>): SummaryTarget {
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? raw.id ?? "Summary"),
    enabled: raw.enabled !== false,
    summaryScope: String(raw.summary_scope ?? "folder") as SummaryTarget["summaryScope"],
    summaryTemplate: String(raw.summary_template ?? "transaction_flow") as SummaryTarget["summaryTemplate"],
    domain: String(raw.domain ?? ""),
    physicalPath: String(raw.physical_path ?? ""),
    logicalPath: String(raw.logical_path ?? raw.physical_path ?? ""),
    sourceDomains: Array.isArray(raw.source_domains)
      ? raw.source_domains.map(String)
      : [],
    sourcePaths: Array.isArray(raw.source_paths)
      ? raw.source_paths.map(String)
      : [],
    excludePaths: Array.isArray(raw.exclude_paths)
      ? raw.exclude_paths.map(String)
      : [],
    includeTypes: Array.isArray(raw.include_types)
      ? raw.include_types.map(String)
      : undefined,
    refreshPolicy: String(raw.refresh_policy ?? "manual") as SummaryTarget["refreshPolicy"],
    llmMode: String(raw.llm_mode ?? "off") as SummaryTarget["llmMode"],
    metricProfile: String(raw.metric_profile ?? raw.summary_template ?? "generic"),
    thresholdProfile:
      typeof raw.threshold_profile === "string" ? raw.threshold_profile : undefined,
    parentTargetId:
      typeof raw.parent_target_id === "string" ? raw.parent_target_id : undefined,
    childTargetIds: Array.isArray(raw.child_target_ids)
      ? raw.child_target_ids.map(String)
      : undefined,
  };
}

function serializeTarget(target: SummaryTarget): Record<string, unknown> {
  return {
    id: target.id,
    title: target.title,
    enabled: target.enabled,
    summary_scope: target.summaryScope,
    summary_template: target.summaryTemplate,
    domain: target.domain,
    physical_path: target.physicalPath,
    logical_path: target.logicalPath,
    source_domains: target.sourceDomains,
    source_paths: target.sourcePaths,
    exclude_paths: target.excludePaths,
    include_types: target.includeTypes,
    refresh_policy: target.refreshPolicy,
    llm_mode: target.llmMode,
    metric_profile: target.metricProfile,
    threshold_profile: target.thresholdProfile,
    parent_target_id: target.parentTargetId,
    child_target_ids: target.childTargetIds,
  };
}

function getCompanySummaryTargets(): SummaryTarget[] {
  return [
    {
      id: "finance-statements-folder",
      title: "Finance Statements Summary",
      enabled: true,
      summaryScope: "folder",
      summaryTemplate: "finance_statements_pack",
      domain: "finance",
      physicalPath: "finance/statements/_summary.qmd",
      logicalPath: "finance/statements/_summary.qmd",
      sourceDomains: ["finance"],
      sourcePaths: ["finance/statements/**"],
      excludePaths: ["finance/statements/_summary.qmd"],
      includeTypes: ["income_statement", "balance_sheet", "cash_flow_statement"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "finance_statements",
      parentTargetId: "finance-domain",
    },
    {
      id: "finance-projections-folder",
      title: "Finance Projections Summary",
      enabled: true,
      summaryScope: "folder",
      summaryTemplate: "finance_projections_pack",
      domain: "finance",
      physicalPath: "finance/projections/_summary.qmd",
      logicalPath: "finance/projections/_summary.qmd",
      sourceDomains: ["finance"],
      sourcePaths: ["finance/projections/**"],
      excludePaths: ["finance/projections/_summary.qmd"],
      includeTypes: ["forecast"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "finance_projections",
      parentTargetId: "finance-domain",
    },
    {
      id: "banking-transactions-folder",
      title: "Banking Transactions Summary",
      enabled: true,
      summaryScope: "folder",
      summaryTemplate: "transaction_flow",
      domain: "banking",
      physicalPath: "banking/transactions/_summary.qmd",
      logicalPath: "banking/transactions/_summary.qmd",
      sourceDomains: ["banking"],
      sourcePaths: ["banking/transactions/**"],
      excludePaths: ["banking/transactions/_summary.qmd"],
      includeTypes: ["transaction"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "banking_transactions",
      parentTargetId: "banking-domain",
    },
    {
      id: "revenue-invoices-folder",
      title: "Revenue Invoices Summary",
      enabled: true,
      summaryScope: "folder",
      summaryTemplate: "transaction_flow",
      domain: "revenue",
      physicalPath: "revenue/invoices/_summary.qmd",
      logicalPath: "revenue/invoices/_summary.qmd",
      sourceDomains: ["revenue"],
      sourcePaths: ["revenue/invoices/**"],
      excludePaths: ["revenue/invoices/_summary.qmd"],
      includeTypes: ["invoice"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "revenue_invoices",
      parentTargetId: "revenue-domain",
    },
    {
      id: "expenses-bills-folder",
      title: "Expenses Bills Summary",
      enabled: true,
      summaryScope: "folder",
      summaryTemplate: "transaction_flow",
      domain: "expenses",
      physicalPath: "expenses/bills/_summary.qmd",
      logicalPath: "expenses/bills/_summary.qmd",
      sourceDomains: ["expenses"],
      sourcePaths: ["expenses/bills/**"],
      excludePaths: ["expenses/bills/_summary.qmd"],
      includeTypes: ["bill"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "expenses_bills",
      parentTargetId: "expenses-domain",
    },
    {
      id: "knowledge-docs-folder",
      title: "Knowledge Docs Summary",
      enabled: true,
      summaryScope: "folder",
      summaryTemplate: "knowledge_catalog",
      domain: "knowledge",
      physicalPath: "knowledge/docs/_summary.qmd",
      logicalPath: "knowledge/docs/_summary.qmd",
      sourceDomains: ["knowledge"],
      sourcePaths: ["knowledge/docs/**"],
      excludePaths: ["knowledge/docs/_summary.qmd"],
      includeTypes: ["knowledge-doc"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "knowledge_docs",
      parentTargetId: "knowledge-domain",
    },
    {
      id: "legal-imports-folder",
      title: "Legal Imports Summary",
      enabled: true,
      summaryScope: "folder",
      summaryTemplate: "legal_decision_pack",
      domain: "legal",
      physicalPath: "legal/imports/_summary.qmd",
      logicalPath: "legal/imports/_summary.qmd",
      sourceDomains: ["legal"],
      sourcePaths: ["legal/imports/**"],
      excludePaths: ["legal/imports/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "legal_imports",
      parentTargetId: "legal-domain",
    },
    {
      id: "finance-domain",
      title: "Finance Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "finance_decision_pack",
      domain: "finance",
      physicalPath: "finance/_summary.qmd",
      logicalPath: "finance/_summary.qmd",
      sourceDomains: ["finance", "banking", "revenue", "expenses"],
      sourcePaths: ["finance/**", "banking/**", "revenue/**", "expenses/**"],
      excludePaths: ["finance/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "finance_decision_pack",
      childTargetIds: [
        "finance-statements-folder",
        "finance-projections-folder",
        "banking-transactions-folder",
        "revenue-invoices-folder",
        "expenses-bills-folder",
      ],
    },
    {
      id: "banking-domain",
      title: "Banking Summary",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "transaction_flow",
      domain: "banking",
      physicalPath: "banking/_summary.qmd",
      logicalPath: "banking/_summary.qmd",
      sourceDomains: ["banking"],
      sourcePaths: ["banking/**"],
      excludePaths: ["banking/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "banking_domain",
      childTargetIds: ["banking-transactions-folder"],
    },
    {
      id: "revenue-domain",
      title: "Revenue Summary",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "transaction_flow",
      domain: "revenue",
      physicalPath: "revenue/_summary.qmd",
      logicalPath: "revenue/_summary.qmd",
      sourceDomains: ["revenue"],
      sourcePaths: ["revenue/**"],
      excludePaths: ["revenue/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "revenue_domain",
      childTargetIds: ["revenue-invoices-folder"],
    },
    {
      id: "expenses-domain",
      title: "Expenses Summary",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "transaction_flow",
      domain: "expenses",
      physicalPath: "expenses/_summary.qmd",
      logicalPath: "expenses/_summary.qmd",
      sourceDomains: ["expenses"],
      sourcePaths: ["expenses/**"],
      excludePaths: ["expenses/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "expenses_domain",
      childTargetIds: ["expenses-bills-folder"],
    },
    {
      id: "knowledge-domain",
      title: "Knowledge Summary",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "knowledge_catalog",
      domain: "knowledge",
      physicalPath: "knowledge/_summary.qmd",
      logicalPath: "knowledge/_summary.qmd",
      sourceDomains: ["knowledge"],
      sourcePaths: ["knowledge/**"],
      excludePaths: ["knowledge/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "knowledge_domain",
      childTargetIds: ["knowledge-docs-folder"],
    },
    {
      id: "legal-domain",
      title: "Legal Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "legal_decision_pack",
      domain: "legal",
      physicalPath: "legal/_summary.qmd",
      logicalPath: "legal/_summary.qmd",
      sourceDomains: ["legal"],
      sourcePaths: ["legal/**"],
      excludePaths: ["legal/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "legal_decision_pack",
      childTargetIds: ["legal-imports-folder"],
    },
    {
      id: "tax-domain",
      title: "Tax Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "tax",
      physicalPath: "tax/_summary.qmd",
      logicalPath: "tax/_summary.qmd",
      sourceDomains: ["tax"],
      sourcePaths: ["tax/**"],
      excludePaths: ["tax/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "tax_decision_pack",
    },
    {
      id: "governance-domain",
      title: "Governance Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "governance",
      physicalPath: "governance/_summary.qmd",
      logicalPath: "governance/_summary.qmd",
      sourceDomains: ["governance"],
      sourcePaths: ["governance/**"],
      excludePaths: ["governance/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "governance_decision_pack",
    },
    {
      id: "strategy-domain",
      title: "Strategy Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "strategy",
      physicalPath: "strategy/_summary.qmd",
      logicalPath: "strategy/_summary.qmd",
      sourceDomains: ["strategy"],
      sourcePaths: ["strategy/**"],
      excludePaths: ["strategy/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "strategy_decision_pack",
    },
    {
      id: "operations-domain",
      title: "Operations Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "operations",
      physicalPath: "operations/_summary.qmd",
      logicalPath: "operations/_summary.qmd",
      sourceDomains: ["operations"],
      sourcePaths: ["operations/**"],
      excludePaths: ["operations/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "operations_decision_pack",
    },
    {
      id: "communications-domain",
      title: "Communications Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "communications_decision_pack",
      domain: "communications",
      physicalPath: "communications/_summary.qmd",
      logicalPath: "communications/_summary.qmd",
      sourceDomains: ["communications"],
      sourcePaths: ["communications/**"],
      excludePaths: ["communications/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "communications_decision_pack",
    },
    {
      id: "assets-domain",
      title: "Assets Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "assets",
      physicalPath: "assets/_summary.qmd",
      logicalPath: "assets/_summary.qmd",
      sourceDomains: ["assets"],
      sourcePaths: ["assets/**"],
      excludePaths: ["assets/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "assets_decision_pack",
    },
    {
      id: "documents-domain",
      title: "Documents Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "documents",
      physicalPath: "documents/_summary.qmd",
      logicalPath: "documents/_summary.qmd",
      sourceDomains: ["documents"],
      sourcePaths: ["documents/**"],
      excludePaths: ["documents/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "documents_decision_pack",
    },
    {
      id: "company-overview",
      title: "Company Overview",
      enabled: false,
      summaryScope: "company",
      summaryTemplate: "executive_overview",
      domain: "governance",
      physicalPath: "governance/company/_summary.qmd",
      logicalPath: "/_summary.qmd",
      sourceDomains: ["finance", "banking", "revenue", "expenses", "knowledge", "legal", "tax", "governance", "strategy", "operations", "communications", "assets", "documents"],
      sourcePaths: ["finance/**", "banking/**", "revenue/**", "expenses/**", "knowledge/**", "legal/**", "tax/**", "governance/**", "strategy/**", "operations/**", "communications/**", "assets/**", "documents/**"],
      excludePaths: ["**/_summary.qmd"],
      refreshPolicy: "manual",
      llmMode: "off",
      metricProfile: "company_overview",
    },
  ];
}

function getPersonSummaryTargets(): SummaryTarget[] {
  return [
    {
      id: "knowledge-domain",
      title: "Knowledge Summary",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "knowledge_catalog",
      domain: "knowledge",
      physicalPath: "knowledge/_summary.qmd",
      logicalPath: "knowledge/_summary.qmd",
      sourceDomains: ["knowledge"],
      sourcePaths: ["knowledge/**"],
      excludePaths: ["knowledge/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "off",
      metricProfile: "knowledge_domain",
    },
    {
      id: "relationships-domain",
      title: "Relationships Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "relationships",
      physicalPath: "relationships/_summary.qmd",
      logicalPath: "relationships/_summary.qmd",
      sourceDomains: ["relationships"],
      sourcePaths: ["relationships/**"],
      excludePaths: ["relationships/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "relationships_decision_pack",
    },
    {
      id: "workspaces-domain",
      title: "Workspace Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "workspaces",
      physicalPath: "workspaces/_summary.qmd",
      logicalPath: "workspaces/_summary.qmd",
      sourceDomains: ["workspaces"],
      sourcePaths: ["workspaces/**"],
      excludePaths: ["workspaces/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "workspaces_decision_pack",
    },
    {
      id: "communications-domain",
      title: "Communications Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "communications_decision_pack",
      domain: "communications",
      physicalPath: "communications/_summary.qmd",
      logicalPath: "communications/_summary.qmd",
      sourceDomains: ["communications"],
      sourcePaths: ["communications/**"],
      excludePaths: ["communications/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "communications_decision_pack",
    },
    {
      id: "documents-domain",
      title: "Documents Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "documents",
      physicalPath: "documents/_summary.qmd",
      logicalPath: "documents/_summary.qmd",
      sourceDomains: ["documents"],
      sourcePaths: ["documents/**"],
      excludePaths: ["documents/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "documents_decision_pack",
    },
    {
      id: "commitments-domain",
      title: "Commitments Decision Pack",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "commitments",
      physicalPath: "commitments/_summary.qmd",
      logicalPath: "commitments/_summary.qmd",
      sourceDomains: ["commitments"],
      sourcePaths: ["commitments/**"],
      excludePaths: ["commitments/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "commitments_decision_pack",
    },
    {
      id: "today-domain",
      title: "Today Brief",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "today",
      physicalPath: "today/_summary.qmd",
      logicalPath: "today/_summary.qmd",
      sourceDomains: ["today", "commitments", "communications", "workspaces"],
      sourcePaths: ["today/**", "commitments/**", "communications/**", "workspaces/**"],
      excludePaths: ["today/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "today_brief",
    },
    {
      id: "timeline-domain",
      title: "Timeline Brief",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "timeline",
      physicalPath: "timeline/_summary.qmd",
      logicalPath: "timeline/_summary.qmd",
      sourceDomains: ["timeline", "communications", "documents", "workspaces"],
      sourcePaths: ["timeline/**", "communications/**", "documents/**", "workspaces/**"],
      excludePaths: ["timeline/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "timeline_brief",
    },
    {
      id: "inbox-domain",
      title: "Inbox Brief",
      enabled: true,
      summaryScope: "domain",
      summaryTemplate: "advisory_decision_pack",
      domain: "inbox",
      physicalPath: "inbox/_summary.qmd",
      logicalPath: "inbox/_summary.qmd",
      sourceDomains: ["inbox", "communications", "documents", "commitments"],
      sourcePaths: ["inbox/**", "communications/**", "documents/**", "commitments/**"],
      excludePaths: ["inbox/_summary.qmd", "**/_summary.qmd"],
      refreshPolicy: "incremental",
      llmMode: "narrative_only",
      metricProfile: "inbox_brief",
    },
  ];
}

export function getDefaultSummaryTargets(
  schemaPack: "company" | "person" = "company",
): SummaryTarget[] {
  return schemaPack === "person"
    ? getPersonSummaryTargets()
    : getCompanySummaryTargets();
}

export function buildSummaryRegistryQmd(
  targetsOrSchemaPack: SummaryTarget[] | "company" | "person" = "company",
): string {
  const targets = Array.isArray(targetsOrSchemaPack)
    ? targetsOrSchemaPack
    : getDefaultSummaryTargets(targetsOrSchemaPack);
  return toQmd(
    {
      version: SUMMARY_REGISTRY_VERSION,
      targets: targets.map(serializeTarget),
    },
    "Summary targets registry. Managed by the summary materializer bootstrap.",
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getRepoPath(companySlug: string): string {
  const repoBase = process.env.COMPANY_DB_REPO ?? "/data/companies";
  return join(/* turbopackIgnore: true */ repoBase, companySlug);
}

export async function ensureSummaryBootstrap(companySlug: string): Promise<void> {
  const repoPath = getRepoPath(companySlug);
  const schemaDir = join(repoPath, ".schema");
  const peopleDir = join(repoPath, "people", "resources");
  await mkdir(schemaDir, { recursive: true });
  await mkdir(peopleDir, { recursive: true });

  const summaryTargetsPath = join(schemaDir, "summary-targets.qmd");
  if (!(await fileExists(summaryTargetsPath))) {
    await writeFile(summaryTargetsPath, buildSummaryRegistryQmd());
  }

  const agentPath = join(peopleDir, `${SUMMARY_AGENT_ID}.qmd`);
  if (!(await fileExists(agentPath))) {
    await writeFile(
      agentPath,
      toQmd(
        {
          id: SUMMARY_AGENT_ID,
          type: "agent",
          title: "Summary Materializer Agent",
          status: "active",
          domains: ["*"],
          permissions: ["write"],
          created_at: new Date().toISOString(),
        },
        "Automated agent that materializes summary vitrine files into Company-DB.",
      ),
    );
  }

  const accessControlsPath = join(schemaDir, "access-controls.qmd");
  const rawAccessControls = (await fileExists(accessControlsPath))
    ? await readFile(accessControlsPath, "utf-8")
    : toQmd({ rules: [], agents: {} }, "Access control rules. Managed by admin.");
  const parsed = parseQmd(rawAccessControls);
  const frontmatter = parsed.frontmatter;
  const rules = Array.isArray(frontmatter.rules)
    ? [...frontmatter.rules]
    : [];

  const hasRule = rules.some((rule) => {
    if (typeof rule !== "object" || rule === null) return false;
    return (rule as Record<string, unknown>).agent_pattern === SUMMARY_AGENT_ID;
  });

  if (!hasRule) {
    rules.push({
      agent_pattern: SUMMARY_AGENT_ID,
      domains: ["*"],
      permissions: ["write"],
    });
    frontmatter.rules = rules;
    if (!frontmatter.agents || typeof frontmatter.agents !== "object") {
      frontmatter.agents = {};
    }
    await writeFile(accessControlsPath, toQmd(frontmatter, parsed.body));
  }
}

export async function loadSummaryTargets(companySlug: string): Promise<SummaryTarget[]> {
  const registryPath = join(getRepoPath(companySlug), ".schema", "summary-targets.qmd");
  if (!(await fileExists(registryPath))) {
    return getDefaultSummaryTargets();
  }

  const raw = await readFile(registryPath, "utf-8");
  const parsed = parseQmd(raw);
  const targets = Array.isArray(parsed.frontmatter.targets)
    ? parsed.frontmatter.targets
    : [];

  const mapped = targets
    .filter((target): target is Record<string, unknown> => typeof target === "object" && target !== null)
    .map(mapTarget)
    .filter(
      (target) =>
        Boolean(target.id) &&
        Boolean(target.physicalPath) &&
        Boolean(target.domain) &&
        !RETIRED_SUMMARY_TARGET_IDS.has(target.id),
    );

  if (mapped.length === 0) {
    return getDefaultSummaryTargets();
  }

  const defaults = getDefaultSummaryTargets();
  const merged = new Map<string, SummaryTarget>();
  for (const target of defaults) {
    merged.set(target.id, target);
  }
  for (const target of mapped) {
    merged.set(target.id, target);
  }

  const defaultOrder = defaults.map((target) => target.id);
  const customTargets = mapped
    .map((target) => target.id)
    .filter((id) => !defaultOrder.includes(id));

  return [...defaultOrder, ...customTargets]
    .map((id) => merged.get(id))
    .filter((target): target is SummaryTarget => Boolean(target));
}
