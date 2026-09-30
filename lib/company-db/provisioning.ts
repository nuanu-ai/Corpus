import { execFile } from "child_process";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

import { eq, sql, type SQLWrapper } from "drizzle-orm";
import YAML from "yaml";

import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { getTenantSlug } from "@/lib/company-db/tenant";
import { buildSummaryRegistryQmd } from "@/lib/company-db/summary/registry";

const execFileAsync = promisify(execFile);

const PORT_LOCK_KEY = 87451291;
const DEFAULT_PORT_START = 3100;
const DEFAULT_PORT_STRIDE = 3;
const DEFAULT_TENANT_KIND = "company";
const DEFAULT_SCHEMA_PACK = "company";
const PERSONAL_TENANT_KIND = "person";
const PERSONAL_SCHEMA_PACK = "person";

const DEFAULT_DOMAINS = [
  "assets",
  "banking",
  "communications",
  "documents",
  "entities",
  "expenses",
  "finance",
  "governance",
  "integrations",
  "knowledge",
  "legal",
  "operations",
  "people",
  "projects",
  "revenue",
  "strategy",
  "tax",
] as const;

const PERSONAL_DOMAINS = [
  "identity",
  "relationships",
  "workspaces",
  "communications",
  "documents",
  "knowledge",
  "commitments",
  "integrations",
  "today",
  "timeline",
  "inbox",
] as const;

const BOOTSTRAP_DIRS = [
  "assets/depreciation",
  "assets/equipment",
  "assets/imports",
  "assets/maintenance",
  "banking/accounts",
  "banking/imports",
  "banking/payments",
  "banking/reconciliation",
  "banking/transactions",
  "communications/context",
  "communications/daily",
  "communications/signals",
  "documents/imports",
  "documents/pipelines",
  "documents/registry",
  "entities/consolidation",
  "entities/imports",
  "entities/operating-objects",
  "entities/operating-relationships",
  "expenses/bills",
  "expenses/expense-reports",
  "expenses/imports",
  "expenses/purchase-orders",
  "expenses/vendors",
  "finance/chart-of-accounts",
  "finance/imports",
  "finance/journal-entries",
  "finance/ledger/journal-entries",
  "finance/ledger/periods",
  "finance/snapshots",
  "finance/statements",
  "governance/board",
  "governance/cap-table",
  "governance/company",
  "governance/funding-rounds",
  "governance/imports",
  "integrations/imports",
  "integrations/data-sources",
  "knowledge/docs",
  "knowledge/imports",
  "legal/contracts",
  "legal/imports",
  "legal/ip",
  "operations/imports",
  "operations/processes",
  "people/contacts",
  "people/imports",
  "people/organizations",
  "people/resources",
  "projects/epics",
  "projects/imports",
  "projects/portfolio",
  "projects/tasks",
  "revenue/customers",
  "revenue/imports",
  "revenue/invoices",
  "revenue/sales-orders",
  "strategy/annual-plans",
  "strategy/imports",
  "strategy/kpis",
  "strategy/okrs",
  "tax/imports",
  "tax/filings",
] as const;

const PERSONAL_BOOTSTRAP_DIRS = [
  "identity/profile",
  "identity/imports",
  "relationships/people",
  "relationships/interactions",
  "relationships/imports",
  "workspaces/companies",
  "workspaces/projects",
  "workspaces/notes",
  "workspaces/watchpoints",
  "workspaces/waiting-fors",
  "communications/daily",
  "communications/context",
  "communications/signals",
  "documents/imports",
  "documents/registry",
  "documents/pipelines",
  "knowledge/docs",
  "knowledge/imports",
  "commitments/open-loops",
  "commitments/promises",
  "integrations/imports",
  "integrations/data-sources",
  "today",
  "timeline",
  "inbox",
] as const;

const REQUIRED_DOMAIN_INDEXES = [
  "assets",
  "finance",
  "banking",
  "communications",
  "documents",
  "governance",
  "legal",
  "operations",
  "people",
  "projects",
  "strategy",
  "tax",
  "entities",
] as const;

const PERSONAL_REQUIRED_DOMAIN_INDEXES = [
  "identity",
  "relationships",
  "workspaces",
  "communications",
  "documents",
  "knowledge",
  "commitments",
  "integrations",
  "today",
  "timeline",
  "inbox",
] as const;

const KNOWLEDGE_AGENT_ID = process.env.KNOWLEDGE_AGENT_ID ?? "knowledge-agent";
const ODOO_SYNC_AGENT_ID = process.env.ODOO_SYNC_AGENT_ID ?? "odoo-sync-agent";
const RECONCILIATION_AGENT_ID = process.env.RECONCILIATION_AGENT_ID ?? "reconciliation-worker";
const CONSULTANT_AGENT_ID = process.env.CONSULTANT_AGENT_ID ?? "consultant-agent";
const COMMUNICATIONS_AGENT_ID = process.env.COMMUNICATIONS_AGENT_ID ?? "communications-agent";
const OPERATING_STRUCTURE_AGENT_ID =
  process.env.OPERATING_STRUCTURE_AGENT_ID ?? "operating-structure-agent";
const SUMMARY_MATERIALIZER_AGENT_ID =
  process.env.SUMMARY_MATERIALIZER_AGENT_ID ?? "summary-materializer";
const PERSONAL_ASSISTANT_AGENT_ID =
  process.env.PERSONAL_ASSISTANT_AGENT_ID ?? "personal-assistant-agent";
const CONSULTANT_AGENT_DOMAINS = [
  "communications",
  "finance",
  "documents",
  "knowledge",
  "legal",
  "governance",
  "strategy",
  "tax",
  "operations",
  "assets",
  "people",
  "revenue",
  "expenses",
  "banking",
];
const COMMUNICATIONS_AGENT_DOMAINS = [
  "communications",
  "people",
  "finance",
  "legal",
  "governance",
  "strategy",
  "tax",
  "operations",
  "assets",
  "documents",
  "revenue",
  "expenses",
  "banking",
];
const OPERATING_STRUCTURE_AGENT_DOMAINS = ["entities"];

interface CompanyRecord {
  id: string;
  name: string;
  tenantKind: string;
  schemaPack: string;
  companyDbPort: number;
}

interface AgentRule {
  agent_pattern: string;
  domains: string[];
  permissions: string[];
}

function getPortStart(): number {
  const parsed = parseInt(process.env.COMPANY_DB_PORT_START ?? `${DEFAULT_PORT_START}`, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT_START;
}

function getPortStride(): number {
  const parsed = parseInt(process.env.COMPANY_DB_PORT_STRIDE ?? `${DEFAULT_PORT_STRIDE}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT_STRIDE;
}

// Ports claimed by other services on the same host.
// The allocator skips these so a tenant daemon never collides with them and
// crashloops. Reserved ports cover the tenant's full triplet (API, queue, MCP).
function getReservedPorts(): Set<number> {
  const raw = process.env.COMPANY_DB_RESERVED_PORTS ?? "";
  const set = new Set<number>();
  for (const token of raw.split(",")) {
    const parsed = parseInt(token.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) set.add(parsed);
  }
  return set;
}

export function pickNextCompanyDbPort(
  existingPorts: number[],
  start = getPortStart(),
  stride = getPortStride(),
  reserved: Set<number> = getReservedPorts(),
): number {
  const used = new Set(existingPorts.filter((p) => Number.isFinite(p)));
  let candidate = start;
  while (
    used.has(candidate) ||
    reserved.has(candidate) ||
    reserved.has(candidate + 1) ||
    reserved.has(candidate + 2)
  ) {
    candidate += stride;
  }
  return candidate;
}

export async function allocateNextCompanyDbPort(
  tx: { execute: (query: string | SQLWrapper) => unknown },
): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${PORT_LOCK_KEY})`);
  const rows = (await tx.execute(
    sql`SELECT company_db_port FROM companies ORDER BY company_db_port ASC`,
  )) as Array<{ company_db_port: number }>;
  const ports = rows.map((r) => Number(r.company_db_port));
  return pickNextCompanyDbPort(ports);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function toQmd(frontmatter: Record<string, unknown>, body = ""): string {
  const yaml = YAML.stringify(frontmatter).trimEnd();
  const cleanBody = body.trimEnd();
  if (cleanBody.length === 0) {
    return `---\n${yaml}\n---\n`;
  }
  return `---\n${yaml}\n---\n\n${cleanBody}\n`;
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoPath,
    maxBuffer: 1024 * 1024 * 4,
  });
  return stdout.trim();
}

function normalizeTenantKind(value: string | null | undefined): "company" | "person" {
  return value === PERSONAL_TENANT_KIND ? PERSONAL_TENANT_KIND : DEFAULT_TENANT_KIND;
}

function normalizeSchemaPack(value: string | null | undefined): "company" | "person" {
  return value === PERSONAL_SCHEMA_PACK ? PERSONAL_SCHEMA_PACK : DEFAULT_SCHEMA_PACK;
}

function getTenantRepoDescription(tenant: CompanyRecord): string {
  const tenantKind = normalizeTenantKind(tenant.tenantKind);
  return tenantKind === PERSONAL_TENANT_KIND
    ? "Personal database schema."
    : "Company database schema.";
}

function getBootstrapDirsForTenant(tenant: CompanyRecord): readonly string[] {
  return normalizeSchemaPack(tenant.schemaPack) === PERSONAL_SCHEMA_PACK
    ? PERSONAL_BOOTSTRAP_DIRS
    : BOOTSTRAP_DIRS;
}

function getRequiredDomainIndexesForTenant(tenant: CompanyRecord): readonly string[] {
  return normalizeSchemaPack(tenant.schemaPack) === PERSONAL_SCHEMA_PACK
    ? PERSONAL_REQUIRED_DOMAIN_INDEXES
    : REQUIRED_DOMAIN_INDEXES;
}

function getDefaultDomainsForTenant(tenant: CompanyRecord): readonly string[] {
  return normalizeSchemaPack(tenant.schemaPack) === PERSONAL_SCHEMA_PACK
    ? PERSONAL_DOMAINS
    : DEFAULT_DOMAINS;
}

async function ensureRepoScaffold(repoPath: string, tenant: CompanyRecord): Promise<void> {
  await mkdir(repoPath, { recursive: true });
  const versionFile = join(repoPath, ".schema", "version.qmd");
  let initialized = false;
  const tenantKind = normalizeTenantKind(tenant.tenantKind);
  const schemaPack = normalizeSchemaPack(tenant.schemaPack);
  if (!(await fileExists(versionFile))) {
    initialized = true;
    await runGit(repoPath, ["init"]);
    await runGit(repoPath, ["config", "user.name", "company-db"]);
    await runGit(repoPath, ["config", "user.email", "company-db@local"]);

    await writeFile(join(repoPath, ".gitignore"), ".company-db/\n.queue/\n");
    await mkdir(join(repoPath, ".schema"), { recursive: true });

    await writeFile(
      versionFile,
      toQmd(
        {
          schema_version: "0.0.1",
          tenant_kind: tenantKind,
          schema_pack: schemaPack,
          created_at: new Date().toISOString(),
        },
        getTenantRepoDescription(tenant),
      ),
    );
    await writeFile(
      join(repoPath, ".schema", "id-registry.qmd"),
      toQmd({ sequences: {} }, "ID sequence registry. Managed by write queue."),
    );
    await writeFile(
      join(repoPath, ".schema", "access-controls.qmd"),
      toQmd({ rules: [], agents: {} }, "Access control rules. Managed by admin."),
    );
    await writeFile(
      join(repoPath, ".schema", "summary-targets.qmd"),
      buildSummaryRegistryQmd(schemaPack),
    );
  } else {
    const raw = await readFile(versionFile, "utf8");
    const parsed = parseQmd(raw);
    const frontmatter = parsed.frontmatter;
    let changed = false;

    if (typeof frontmatter.schema_version !== "string" || frontmatter.schema_version.trim().length === 0) {
      frontmatter.schema_version = "0.0.1";
      changed = true;
    }
    if (typeof frontmatter.tenant_kind !== "string" || frontmatter.tenant_kind.trim().length === 0) {
      frontmatter.tenant_kind = tenantKind;
      changed = true;
    }
    if (typeof frontmatter.schema_pack !== "string" || frontmatter.schema_pack.trim().length === 0) {
      frontmatter.schema_pack = schemaPack;
      changed = true;
    }
    if (typeof frontmatter.created_at !== "string") {
      frontmatter.created_at = new Date().toISOString();
      changed = true;
    }

    if (changed) {
      await writeFile(
        versionFile,
        toQmd(
          frontmatter,
          parsed.body.trim().length > 0 ? parsed.body : getTenantRepoDescription(tenant),
        ),
      );
    }
  }

  if (initialized) {
    await runGit(repoPath, ["add", "."]);
    await runGit(
      repoPath,
      ["commit", "-m", tenantKind === PERSONAL_TENANT_KIND
        ? "init: scaffold personal repository"
        : "init: scaffold company repository"],
    );
  }
}

async function ensureDomainLayout(repoPath: string, tenant: CompanyRecord): Promise<void> {
  const tenantKind = normalizeTenantKind(tenant.tenantKind);
  const schemaPack = normalizeSchemaPack(tenant.schemaPack);
  const bootstrapDirs = getBootstrapDirsForTenant(tenant);
  const requiredDomainIndexes = getRequiredDomainIndexesForTenant(tenant);
  const defaultDomains = getDefaultDomainsForTenant(tenant);

  for (const dir of bootstrapDirs) {
    await mkdir(join(repoPath, dir), { recursive: true });
  }

  for (const domain of requiredDomainIndexes) {
    const indexPath = join(repoPath, domain, "_index.qmd");
    if (!(await fileExists(indexPath))) {
      await writeFile(
        indexPath,
        toQmd(
          {
            title: domain.charAt(0).toUpperCase() + domain.slice(1),
            domain,
          },
          "",
        ),
      );
    }
  }

  const rootIndex = join(repoPath, "_index.qmd");
  if (!(await fileExists(rootIndex))) {
    await writeFile(
      rootIndex,
      toQmd(
        {
          title: tenantKind === PERSONAL_TENANT_KIND ? "Personal Index" : "Company Index",
          tenant_kind: tenantKind,
          schema_pack: schemaPack,
          active_domains: [...defaultDomains],
        },
        "",
      ),
    );
  } else {
    const raw = await readFile(rootIndex, "utf8");
    const parsed = parseQmd(raw);
    const frontmatter = parsed.frontmatter;
    const activeDomains = mergeStringArray(frontmatter.active_domains, [...defaultDomains]);

    if (
      !Array.isArray(frontmatter.active_domains) ||
      activeDomains.length !== frontmatter.active_domains.length
    ) {
      frontmatter.title =
        typeof frontmatter.title === "string" && frontmatter.title.trim().length > 0
          ? frontmatter.title
          : tenantKind === PERSONAL_TENANT_KIND
            ? "Personal Index"
            : "Company Index";
      frontmatter.tenant_kind =
        typeof frontmatter.tenant_kind === "string" && frontmatter.tenant_kind.trim().length > 0
          ? frontmatter.tenant_kind
          : tenantKind;
      frontmatter.schema_pack =
        typeof frontmatter.schema_pack === "string" && frontmatter.schema_pack.trim().length > 0
          ? frontmatter.schema_pack
          : schemaPack;
      frontmatter.active_domains = activeDomains;
      await writeFile(rootIndex, toQmd(frontmatter, parsed.body));
    }
  }

  const summaryTargetsPath = join(repoPath, ".schema", "summary-targets.qmd");
  if (!(await fileExists(summaryTargetsPath))) {
    await writeFile(summaryTargetsPath, buildSummaryRegistryQmd(schemaPack));
  }
}

async function ensureAgentProfiles(repoPath: string, tenant: CompanyRecord): Promise<void> {
  const peopleDir = join(repoPath, "people", "resources");
  await mkdir(peopleDir, { recursive: true });

  const tenantKind = normalizeTenantKind(tenant.tenantKind);
  if (tenantKind === PERSONAL_TENANT_KIND) {
    const personalAssistantPath = join(peopleDir, `${PERSONAL_ASSISTANT_AGENT_ID}.qmd`);
    if (!(await fileExists(personalAssistantPath))) {
      await writeFile(
        personalAssistantPath,
        toQmd(
          {
            id: PERSONAL_ASSISTANT_AGENT_ID,
            type: "agent",
            title: "Personal Assistant Agent",
            status: "active",
            domains: [...PERSONAL_DOMAINS],
            permissions: ["write"],
            created_at: new Date().toISOString(),
          },
          "Automated agent that manages personal tenant summaries, context, and document promotion.",
        ),
      );
    }

    const summaryMaterializerPath = join(peopleDir, `${SUMMARY_MATERIALIZER_AGENT_ID}.qmd`);
    if (!(await fileExists(summaryMaterializerPath))) {
      await writeFile(
        summaryMaterializerPath,
        toQmd(
          {
            id: SUMMARY_MATERIALIZER_AGENT_ID,
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
    return;
  }

  const knowledgePath = join(peopleDir, `${KNOWLEDGE_AGENT_ID}.qmd`);
  if (!(await fileExists(knowledgePath))) {
    await writeFile(
      knowledgePath,
      toQmd(
        {
          id: KNOWLEDGE_AGENT_ID,
          type: "agent",
          title: "Knowledge Document Ingestion Agent",
          status: "active",
          domains: ["knowledge"],
          permissions: ["write"],
          created_at: new Date().toISOString(),
        },
        "Automated agent that ingests knowledge documents into the knowledge domain.",
      ),
    );
  }

  const odooPath = join(peopleDir, `${ODOO_SYNC_AGENT_ID}.qmd`);
  if (!(await fileExists(odooPath))) {
    await writeFile(
      odooPath,
      toQmd(
        {
          id: ODOO_SYNC_AGENT_ID,
          type: "agent",
          title: "Odoo ERP Sync Agent",
          status: "active",
          domains: ["revenue", "expenses", "banking", "finance"],
          permissions: ["write"],
          created_at: new Date().toISOString(),
        },
        "Automated agent that syncs financial records from Odoo into Company-DB domains.",
      ),
    );
  }

  const consultantPath = join(peopleDir, `${CONSULTANT_AGENT_ID}.qmd`);
  if (!(await fileExists(consultantPath))) {
    await writeFile(
      consultantPath,
      toQmd(
        {
          id: CONSULTANT_AGENT_ID,
          type: "agent",
          title: "Consultant Agent",
          status: "active",
          domains: CONSULTANT_AGENT_DOMAINS,
          permissions: ["write"],
          created_at: new Date().toISOString(),
        },
        "Interactive consultant agent that commits user-approved proposals through the write queue.",
      ),
    );
  }

  const communicationsPath = join(peopleDir, `${COMMUNICATIONS_AGENT_ID}.qmd`);
  if (!(await fileExists(communicationsPath))) {
    await writeFile(
      communicationsPath,
      toQmd(
        {
          id: COMMUNICATIONS_AGENT_ID,
          type: "agent",
          title: "Communications Agent",
          status: "active",
          domains: COMMUNICATIONS_AGENT_DOMAINS,
          permissions: ["write"],
          created_at: new Date().toISOString(),
        },
        "Automated agent that synthesizes communications into Company-DB records and user-approved cross-domain signals.",
      ),
    );
  }

  const operatingStructurePath = join(peopleDir, `${OPERATING_STRUCTURE_AGENT_ID}.qmd`);
  if (!(await fileExists(operatingStructurePath))) {
    await writeFile(
      operatingStructurePath,
      toQmd(
        {
          id: OPERATING_STRUCTURE_AGENT_ID,
          type: "agent",
          title: "Operating Structure Publisher",
          status: "active",
          domains: OPERATING_STRUCTURE_AGENT_DOMAINS,
          permissions: ["write"],
          created_at: new Date().toISOString(),
        },
        "Automated publisher for operating objects, operating relationships, and access-graph metadata.",
      ),
    );
  }

  const reconciliationPath = join(peopleDir, `${RECONCILIATION_AGENT_ID}.qmd`);
  const reconciliationDomains = [
    "banking",
    "communications",
    "finance",
    "integrations",
    "documents",
    "knowledge",
    "legal",
    "governance",
    "strategy",
    "tax",
    "operations",
    "assets",
  ];
  if (!(await fileExists(reconciliationPath))) {
    await writeFile(
      reconciliationPath,
      toQmd(
        {
          id: RECONCILIATION_AGENT_ID,
          type: "agent",
          title: "Reconciliation Worker Agent",
          status: "active",
          domains: reconciliationDomains,
          permissions: ["write"],
          created_at: new Date().toISOString(),
        },
        "Automated worker that commits staged transaction/report imports through the write queue.",
      ),
    );
  } else {
    const raw = await readFile(reconciliationPath, "utf-8");
    const parsed = parseQmd(raw);
    const frontmatter = parsed.frontmatter;
    frontmatter.id =
      typeof frontmatter.id === "string" && frontmatter.id.trim().length > 0
        ? frontmatter.id
        : RECONCILIATION_AGENT_ID;
    frontmatter.type = "agent";
    frontmatter.title =
      typeof frontmatter.title === "string" && frontmatter.title.trim().length > 0
        ? frontmatter.title
        : "Reconciliation Worker Agent";
    frontmatter.status =
      typeof frontmatter.status === "string" && frontmatter.status.trim().length > 0
        ? frontmatter.status
        : "active";
    frontmatter.domains = mergeStringArray(frontmatter.domains, reconciliationDomains);
    frontmatter.permissions = mergeStringArray(frontmatter.permissions, ["write"]);
    if (typeof frontmatter.created_at !== "string") {
      frontmatter.created_at = new Date().toISOString();
    }

    await writeFile(
      reconciliationPath,
      toQmd(
        frontmatter,
        parsed.body.trim().length > 0
          ? parsed.body
          : "Automated worker that commits staged transaction/report imports through the write queue.",
      ),
    );
  }

  const summaryMaterializerPath = join(
    peopleDir,
    `${SUMMARY_MATERIALIZER_AGENT_ID}.qmd`,
  );
  if (!(await fileExists(summaryMaterializerPath))) {
    await writeFile(
      summaryMaterializerPath,
      toQmd(
        {
          id: SUMMARY_MATERIALIZER_AGENT_ID,
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
}

function parseQmd(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  return {
    frontmatter: (YAML.parse(match[1]) as Record<string, unknown>) ?? {},
    body: match[2] ?? "",
  };
}

function mergeStringArray(existing: unknown, required: string[]): string[] {
  const current = Array.isArray(existing)
    ? existing.filter((value): value is string => typeof value === "string")
    : [];
  return [...new Set([...current, ...required])];
}

function upsertRule(
  rules: Array<Record<string, unknown>>,
  requiredRule: AgentRule,
): void {
  const index = rules.findIndex((rule) => {
    const candidate = rule?.agent_pattern;
    return typeof candidate === "string" && candidate === requiredRule.agent_pattern;
  });

  if (index === -1) {
    rules.push(requiredRule as unknown as Record<string, unknown>);
    return;
  }

  const existing = rules[index];
  rules[index] = {
    ...existing,
    agent_pattern: requiredRule.agent_pattern,
    domains: mergeStringArray(existing.domains, requiredRule.domains),
    permissions: mergeStringArray(existing.permissions, requiredRule.permissions),
  };
}

async function ensureAccessRules(repoPath: string, tenant: CompanyRecord): Promise<void> {
  const accessPath = join(repoPath, ".schema", "access-controls.qmd");
  const raw = await readFile(accessPath, "utf-8");
  const parsed = parseQmd(raw);

  const frontmatter = parsed.frontmatter;
  const rules = (Array.isArray(frontmatter.rules)
    ? [...frontmatter.rules]
    : []) as Array<Record<string, unknown>>;

  const tenantKind = normalizeTenantKind(tenant.tenantKind);
  const requiredRules: AgentRule[] = tenantKind === PERSONAL_TENANT_KIND
    ? [
      {
        agent_pattern: PERSONAL_ASSISTANT_AGENT_ID,
        domains: [...PERSONAL_DOMAINS],
        permissions: ["write"],
      },
      {
        agent_pattern: SUMMARY_MATERIALIZER_AGENT_ID,
        domains: ["*"],
        permissions: ["write"],
      },
    ]
    : [
    {
      agent_pattern: KNOWLEDGE_AGENT_ID,
      domains: ["knowledge"],
      permissions: ["write"],
    },
    {
      agent_pattern: ODOO_SYNC_AGENT_ID,
      domains: ["revenue", "expenses", "banking", "finance"],
      permissions: ["write"],
    },
    {
      agent_pattern: RECONCILIATION_AGENT_ID,
      domains: [
        "banking",
        "finance",
        "integrations",
        "documents",
        "knowledge",
        "legal",
        "governance",
        "strategy",
        "tax",
        "operations",
        "assets",
      ],
      permissions: ["write"],
    },
    {
      agent_pattern: CONSULTANT_AGENT_ID,
      domains: CONSULTANT_AGENT_DOMAINS,
      permissions: ["write"],
    },
    {
      agent_pattern: COMMUNICATIONS_AGENT_ID,
      domains: COMMUNICATIONS_AGENT_DOMAINS,
      permissions: ["write"],
    },
    {
      agent_pattern: OPERATING_STRUCTURE_AGENT_ID,
      domains: OPERATING_STRUCTURE_AGENT_DOMAINS,
      permissions: ["write"],
    },
    {
      agent_pattern: SUMMARY_MATERIALIZER_AGENT_ID,
      domains: ["*"],
      permissions: ["write"],
    },
  ];

  for (const rule of requiredRules) {
    upsertRule(rules, rule);
  }

  frontmatter.rules = rules;
  if (!frontmatter.agents || typeof frontmatter.agents !== "object") {
    frontmatter.agents = {};
  }

  await writeFile(accessPath, toQmd(frontmatter, parsed.body));
}

async function commitIfDirty(repoPath: string, message: string): Promise<void> {
  const status = await runGit(repoPath, ["status", "--porcelain"]);
  if (!status) return;
  await runGit(repoPath, ["add", "."]);
  await runGit(repoPath, ["commit", "-m", message]);
}

async function getTenantRecord(tenantId: string): Promise<CompanyRecord> {
  const rows = await db
    .select({
      id: companies.id,
      name: companies.name,
      tenantKind: companies.tenantKind,
      schemaPack: companies.schemaPack,
      companyDbPort: companies.companyDbPort,
    })
    .from(companies)
    .where(eq(companies.id, tenantId))
    .limit(1);

  if (!rows.length) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  return rows[0];
}

export async function provisionTenantDbRepo(
  tenantId: string,
): Promise<{ slug: string; repoPath: string; companyDbPort: number } | null> {
  if (process.env.COMPANY_DB_AUTO_PROVISION === "false") {
    return null;
  }

  const tenant = await getTenantRecord(tenantId);
  const slug = await getTenantSlug(tenant.id);
  const repoBase = process.env.COMPANY_DB_REPO ?? "/data/companies";
  const repoPath = join(/* turbopackIgnore: true */ repoBase, slug);

  await ensureRepoScaffold(repoPath, tenant);
  await ensureDomainLayout(repoPath, tenant);
  await ensureAgentProfiles(repoPath, tenant);
  await ensureAccessRules(repoPath, tenant);
  await commitIfDirty(
    repoPath,
    normalizeTenantKind(tenant.tenantKind) === PERSONAL_TENANT_KIND
      ? "chore: bootstrap personal domains and agent profiles"
      : "chore: bootstrap company domains and agent profiles",
  );

  return { slug, repoPath, companyDbPort: tenant.companyDbPort };
}

export async function provisionCompanyDbRepo(
  companyId: string,
): Promise<{ slug: string; repoPath: string; companyDbPort: number } | null> {
  return provisionTenantDbRepo(companyId);
}

/**
 * Materialise a company-db tenant (git repo + PM2 daemon) lazily on demand.
 * Idempotent — safe to call on every chat / upload entry path.
 *
 * Reads `companies.provisioning_status`:
 *   - 'active' (default for existing tenants)  → no-op
 *   - 'pending' (community-tier signup, never used)→ provision now, flip to 'active'
 *   - 'failed' (prior attempt errored)         → retry, flip to 'active' or stay 'failed'
 *
 * Use this at the start of any handler that requires the per-tenant company-db
 * to be live (chat route, document upload, etc). The status check is a single
 * indexed SELECT and short-circuits when active, so the steady-state overhead
 * is one cheap query.
 */
export async function ensureCompanyProvisioned(companyId: string): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT provisioning_status FROM companies WHERE id = ${companyId}::uuid LIMIT 1
  `)) as unknown as Array<{ provisioning_status: string }>;
  const status = rows[0]?.provisioning_status;
  if (!status || status === "active") return;

  if (status === "pending" || status === "failed") {
    try {
      await provisionTenantDbRepo(companyId);
      await db.execute(sql`
        UPDATE companies
        SET provisioning_status = 'active', updated_at = now()
        WHERE id = ${companyId}::uuid
      `);
      console.info(`[company-db] Lazy-provisioned companyId=${companyId} (was ${status})`);
    } catch (error) {
      await db.execute(sql`
        UPDATE companies
        SET provisioning_status = 'failed', updated_at = now()
        WHERE id = ${companyId}::uuid
      `);
      console.error(
        `[company-db] Lazy provisioning failed for companyId=${companyId}:`,
        error,
      );
      throw error;
    }
  }
}
