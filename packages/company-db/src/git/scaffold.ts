import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

import type { RepoHandle } from "./types.js";
import type { SchemaPack, TenantKind } from "../schema/types.js";
import { writeQmd } from "../qmd/writer.js";
import { getDomainsForSchemaPack } from "../schema/domains.js";

const COMPANY_DOMAIN_DIRS: Record<string, string[]> = {
  identity: [],
  governance: [
    "corporate-documents",
    "board",
    "board/meetings",
    "cap-table",
    "funding-rounds",
  ],
  strategy: [
    "annual-plans",
    "okrs",
    "kpis",
    "kpis/snapshots",
  ],
  people: [
    "contacts",
    "organizations",
    "resources",
    "teams",
    "compensation",
    "benefits",
    "payroll",
    "payroll/runs",
    "scheduling",
    "tips",
    "hiring",
    "hiring/positions",
    "hiring/candidates",
    "performance",
    "performance/reviews",
    "policies",
  ],
  finance: [
    "chart-of-accounts",
    "ledger",
    "ledger/journal-entries",
    "ledger/periods",
    "statements",
    "statements/income-statement",
    "statements/balance-sheet",
    "statements/cash-flow-statement",
    "forecasts",
  ],
  banking: [
    "accounts",
    "transactions",
    "reconciliation",
    "fx-rates",
    "payment-processors",
  ],
  communications: ["daily", "signals", "context"],
  revenue: [
    "customers",
    "contacts",
    "subscriptions",
    "invoices",
    "daily-sales",
    "deals",
    "metrics",
    "metrics/saas",
    "metrics/hospitality",
    "metrics/retail",
    "metrics/general",
  ],
  expenses: ["vendors", "bills", "purchase-orders", "expense-reports"],
  tax: ["registrations", "filings", "calendar", "audit", "compliance"],
  products: [
    "catalog",
    "plans",
    "pricing-history",
    "roadmap",
    "roadmap/initiatives",
    "roadmap/releases",
  ],
  projects: ["portfolio", "epics", "tasks"],
  legal: [
    "contracts",
    "intellectual-property",
    "intellectual-property/patents",
    "intellectual-property/trademarks",
    "intellectual-property/copyrights",
    "intellectual-property/trade-secrets",
    "intellectual-property/domain-names",
    "corporate-actions",
  ],
  operations: ["processes", "tools-and-systems", "facilities"],
  knowledge: ["handbook", "handbook/onboarding", "runbooks", "meetings", "decisions", "postmortems"],
  market: ["industry", "competitors", "win-loss", "icp"],
  integrations: ["catalog", "data-sources", "api-catalog"],
  security: ["assets", "risk-register", "incidents", "audit", "policies"],
  inventory: ["catalog", "stock", "movements", "counts"],
  assets: ["properties", "units", "equipment", "vehicles", "maintenance"],
  bookings: ["reservations", "pos-sessions", "guests", "channels"],
  documents: [
    "registry",
    "schemas",
    "schemas/bank-statements",
    "schemas/financial-reports",
    "schemas/invoices",
    "schemas/hr",
    "pipelines",
    "jobs",
  ],
  entities: ["consolidation"],
};

const PERSON_DOMAIN_DIRS: Record<string, string[]> = {
  identity: ["documents", "preferences"],
  relationships: ["people", "advisors", "family", "interaction-log"],
  workspaces: ["companies", "projects", "notes", "watchpoints", "waiting-fors"],
  communications: ["daily", "signals", "context", "bindings"],
  documents: ["imports", "registry", "clarifications", "pipelines"],
  knowledge: ["notes", "journal", "meetings", "decisions", "references"],
  planning: ["areas", "goals", "projects", "quarterly-plans"],
  commitments: ["open", "waiting-fors", "deadlines", "recurring"],
  money: ["accounts", "transactions", "obligations", "recurring-payments", "shared-expenses"],
  admin: ["identity", "permits", "insurance", "agreements", "tax"],
  assets: ["devices", "property", "vehicles", "memberships", "warranties"],
  travel: ["trips", "itineraries", "bookings", "places"],
  wellbeing: ["documents", "appointments", "metrics"],
  automations: ["agents", "routines", "rules"],
  integrations: ["catalog", "bindings", "rules", "sync-health"],
  today: [],
  timeline: [],
  inbox: [],
};

const PACK_DOMAIN_DIRS: Record<SchemaPack, Record<string, string[]>> = {
  company: COMPANY_DOMAIN_DIRS,
  person: PERSON_DOMAIN_DIRS,
};

const COMPANY_DOMAINS_WITH_INDEX_QMD = new Set([
  "finance",
  "banking",
  "communications",
  "people",
  "tax",
  "inventory",
  "entities",
]);

const PERSON_DOMAINS_WITH_INDEX_QMD = new Set([
  "communications",
  "documents",
  "workspaces",
  "today",
  "timeline",
  "inbox",
]);

const PACK_DOMAINS_WITH_INDEX_QMD: Record<SchemaPack, Set<string>> = {
  company: COMPANY_DOMAINS_WITH_INDEX_QMD,
  person: PERSON_DOMAINS_WITH_INDEX_QMD,
};

const PACK_ROOT_TITLES: Record<SchemaPack, string> = {
  company: "Company Index",
  person: "Personal Index",
};

const PACK_TENANT_KINDS: Record<SchemaPack, TenantKind> = {
  company: "company",
  person: "person",
};

export interface ScaffoldOptions {
  schemaPack?: SchemaPack;
  tenantKind?: TenantKind;
  rootTitle?: string;
}

export async function scaffoldDomains(
  repo: RepoHandle,
  activeDomains: string[],
  options: ScaffoldOptions = {},
): Promise<string[]> {
  const schemaPack = options.schemaPack ?? "company";
  const tenantKind = options.tenantKind ?? PACK_TENANT_KINDS[schemaPack];
  const domainDirs = PACK_DOMAIN_DIRS[schemaPack];
  const domainsWithIndex = PACK_DOMAINS_WITH_INDEX_QMD[schemaPack];
  const createdDirs: string[] = [];

  for (const domain of activeDomains) {
    const subdirs = domainDirs[domain];
    if (!subdirs) {
      throw new Error(`Unknown domain: ${domain}`);
    }

    const domainRoot = join(repo.path, domain);
    await mkdir(domainRoot, { recursive: true });
    createdDirs.push(domain);

    if (domainsWithIndex.has(domain)) {
      const indexContent = writeQmd(
        {
          title: domain.charAt(0).toUpperCase() + domain.slice(1),
          domain,
          tenant_kind: tenantKind,
          schema_pack: schemaPack,
        },
        "",
      );
      await writeFile(join(domainRoot, "_index.qmd"), indexContent);
    }

    for (const subdir of subdirs) {
      const fullPath = join(repo.path, domain, subdir);
      await mkdir(fullPath, { recursive: true });
      createdDirs.push(`${domain}/${subdir}`);
    }
  }

  const rootIndexContent = writeQmd(
    {
      title: options.rootTitle ?? PACK_ROOT_TITLES[schemaPack],
      tenant_kind: tenantKind,
      schema_pack: schemaPack,
      active_domains: activeDomains,
    },
    "",
  );
  await writeFile(join(repo.path, "_index.qmd"), rootIndexContent);

  return createdDirs;
}

export async function scaffoldPackDomains(
  repo: RepoHandle,
  schemaPack: SchemaPack,
  options: { industry?: string | null; rootTitle?: string } = {},
): Promise<string[]> {
  const activeDomains = getActiveDomains(options.industry ?? "", schemaPack);
  return scaffoldDomains(repo, activeDomains, {
    schemaPack,
    rootTitle: options.rootTitle,
  });
}

export function getActiveDomains(
  industry: string,
  schemaPack: SchemaPack = "company",
): string[] {
  const configs = getDomainsForSchemaPack(schemaPack, {
    industry: schemaPack === "company" ? industry : null,
  });
  return configs.map((c) => c.basePath);
}
