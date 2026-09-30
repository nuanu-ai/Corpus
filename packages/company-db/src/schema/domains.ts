import type { DomainConfig, EntityTypeConfig, SchemaPack, SchemaPackConfig } from "./types.js";
import { TYPE_PREFIXES } from "./types.js";

export const COMPANY_DOMAINS: Record<string, DomainConfig> = {
  identity: {
    name: "Identity",
    basePath: "identity",
    entityTypes: [
      { prefix: "company", name: "Company Profile", domain: "identity", padding: 3 },
    ],
  },
  governance: {
    name: "Governance",
    basePath: "governance",
    entityTypes: [
      { prefix: "board", name: "Board Member", domain: "governance", padding: 3 },
      { prefix: "round", name: "Funding Round", domain: "governance", padding: 3 },
    ],
  },
  strategy: {
    name: "Strategy",
    basePath: "strategy",
    entityTypes: [
      { prefix: "okr", name: "OKR", domain: "strategy", padding: 3 },
      { prefix: "kpi", name: "KPI", domain: "strategy", padding: 3 },
    ],
  },
  people: {
    name: "People",
    basePath: "people",
    entityTypes: [
      { prefix: "emp", name: "Employee", domain: "people", padding: 3 },
      { prefix: "agt", name: "Agent", domain: "people", padding: 3 },
      { prefix: "team", name: "Team", domain: "people", padding: 3 },
      { prefix: "job", name: "Job Posting", domain: "people", padding: 3 },
    ],
  },
  finance: {
    name: "Finance",
    basePath: "finance",
    entityTypes: [
      { prefix: "acct", name: "Account", domain: "finance", padding: 3 },
      { prefix: "je", name: "Journal Entry", domain: "finance", padding: 5 },
      { prefix: "snapshot", name: "Financial Snapshot", domain: "finance", padding: 3 },
    ],
  },
  banking: {
    name: "Banking",
    basePath: "banking",
    entityTypes: [
      { prefix: "txn", name: "Transaction", domain: "banking", padding: 3 },
    ],
  },
  communications: {
    name: "Communications",
    basePath: "communications",
    entityTypes: [],
  },
  revenue: {
    name: "Revenue",
    basePath: "revenue",
    entityTypes: [
      { prefix: "cust", name: "Customer", domain: "revenue", padding: 3 },
      { prefix: "contact", name: "Contact", domain: "revenue", padding: 3 },
      { prefix: "sub", name: "Subscription", domain: "revenue", padding: 3 },
      { prefix: "inv", name: "Invoice", domain: "revenue", padding: 3 },
      { prefix: "deal", name: "Deal", domain: "revenue", padding: 3 },
      { prefix: "pipeline", name: "Pipeline", domain: "revenue", padding: 3 },
    ],
  },
  expenses: {
    name: "Expenses",
    basePath: "expenses",
    entityTypes: [
      { prefix: "vnd", name: "Vendor", domain: "expenses", padding: 3 },
      { prefix: "bill", name: "Bill", domain: "expenses", padding: 3 },
      { prefix: "po", name: "Purchase Order", domain: "expenses", padding: 3 },
      { prefix: "report", name: "Expense Report", domain: "expenses", padding: 3 },
    ],
  },
  tax: {
    name: "Tax",
    basePath: "tax",
    entityTypes: [
      { prefix: "filing", name: "Tax Filing", domain: "tax", padding: 3 },
    ],
  },
  products: {
    name: "Products",
    basePath: "products",
    entityTypes: [
      { prefix: "prod", name: "Product", domain: "products", padding: 3 },
    ],
  },
  projects: {
    name: "Projects",
    basePath: "projects",
    entityTypes: [],
  },
  legal: {
    name: "Legal",
    basePath: "legal",
    entityTypes: [
      { prefix: "ctr", name: "Contract", domain: "legal", padding: 3 },
    ],
  },
  operations: {
    name: "Operations",
    basePath: "operations",
    entityTypes: [
      { prefix: "loc", name: "Location", domain: "operations", padding: 3 },
    ],
  },
  knowledge: {
    name: "Knowledge",
    basePath: "knowledge",
    entityTypes: [],
  },
  market: {
    name: "Market",
    basePath: "market",
    entityTypes: [
      { prefix: "channel", name: "Channel", domain: "market", padding: 3 },
    ],
  },
  integrations: {
    name: "Integrations",
    basePath: "integrations",
    entityTypes: [],
  },
  security: {
    name: "Security",
    basePath: "security",
    entityTypes: [
      { prefix: "risk", name: "Risk", domain: "security", padding: 3 },
      { prefix: "incident", name: "Incident", domain: "security", padding: 3 },
    ],
  },
  inventory: {
    name: "Inventory",
    basePath: "inventory",
    entityTypes: [],
    industries: ["restaurant", "retail", "manufacturing", "hotel"],
  },
  assets: {
    name: "Assets",
    basePath: "assets",
    entityTypes: [
      { prefix: "asset", name: "Asset", domain: "assets", padding: 3 },
    ],
    industries: ["hotel", "restaurant", "manufacturing", "retail"],
  },
  bookings: {
    name: "Bookings",
    basePath: "bookings",
    entityTypes: [
      { prefix: "res", name: "Reservation", domain: "bookings", padding: 3 },
      { prefix: "guest", name: "Guest", domain: "bookings", padding: 3 },
      { prefix: "room", name: "Room", domain: "bookings", padding: 3 },
    ],
    industries: ["hotel", "restaurant"],
  },
  documents: {
    name: "Documents",
    basePath: "documents",
    entityTypes: [
      { prefix: "doc", name: "Document", domain: "documents", padding: 3 },
    ],
  },
  entities: {
    name: "Entities",
    basePath: "entities",
    entityTypes: [],
  },
};

export const PERSON_DOMAINS: Record<string, DomainConfig> = {
  identity: {
    name: "Identity",
    basePath: "identity",
    entityTypes: [
      { prefix: "person", name: "Person Profile", domain: "identity", padding: 3 },
    ],
  },
  relationships: {
    name: "Relationships",
    basePath: "relationships",
    entityTypes: [
      { prefix: "relation", name: "Relationship", domain: "relationships", padding: 3 },
      { prefix: "counterparty", name: "Counterparty", domain: "relationships", padding: 3 },
    ],
  },
  workspaces: {
    name: "Workspaces",
    basePath: "workspaces",
    entityTypes: [
      { prefix: "workspace", name: "Workspace", domain: "workspaces", padding: 3 },
    ],
  },
  communications: {
    name: "Communications",
    basePath: "communications",
    entityTypes: [],
  },
  documents: {
    name: "Documents",
    basePath: "documents",
    entityTypes: [
      { prefix: "pdoc", name: "Personal Document", domain: "documents", padding: 3 },
    ],
  },
  knowledge: {
    name: "Knowledge",
    basePath: "knowledge",
    entityTypes: [
      { prefix: "note", name: "Note", domain: "knowledge", padding: 3 },
      { prefix: "decision", name: "Decision", domain: "knowledge", padding: 3 },
    ],
  },
  planning: {
    name: "Planning",
    basePath: "planning",
    entityTypes: [
      { prefix: "goal", name: "Goal", domain: "planning", padding: 3 },
      { prefix: "plan", name: "Plan", domain: "planning", padding: 3 },
    ],
  },
  commitments: {
    name: "Commitments",
    basePath: "commitments",
    entityTypes: [
      { prefix: "commitment", name: "Commitment", domain: "commitments", padding: 3 },
    ],
  },
  money: {
    name: "Money",
    basePath: "money",
    entityTypes: [
      { prefix: "wallet", name: "Wallet", domain: "money", padding: 3 },
      { prefix: "obligation", name: "Obligation", domain: "money", padding: 3 },
    ],
  },
  admin: {
    name: "Admin",
    basePath: "admin",
    entityTypes: [
      { prefix: "record", name: "Admin Record", domain: "admin", padding: 3 },
    ],
  },
  assets: {
    name: "Assets",
    basePath: "assets",
    entityTypes: [
      { prefix: "personalasset", name: "Personal Asset", domain: "assets", padding: 3 },
    ],
  },
  travel: {
    name: "Travel",
    basePath: "travel",
    entityTypes: [
      { prefix: "trip", name: "Trip", domain: "travel", padding: 3 },
    ],
  },
  wellbeing: {
    name: "Wellbeing",
    basePath: "wellbeing",
    entityTypes: [
      { prefix: "health", name: "Health Record", domain: "wellbeing", padding: 3 },
    ],
  },
  automations: {
    name: "Automations",
    basePath: "automations",
    entityTypes: [
      { prefix: "routine", name: "Routine", domain: "automations", padding: 3 },
      { prefix: "assistant", name: "Assistant", domain: "automations", padding: 3 },
    ],
  },
  integrations: {
    name: "Integrations",
    basePath: "integrations",
    entityTypes: [],
  },
  today: {
    name: "Today",
    basePath: "today",
    entityTypes: [],
  },
  timeline: {
    name: "Timeline",
    basePath: "timeline",
    entityTypes: [],
  },
  inbox: {
    name: "Inbox",
    basePath: "inbox",
    entityTypes: [],
  },
};

export const PERSON_TYPE_PREFIXES: Record<string, EntityTypeConfig> = {
  person: { prefix: "person", name: "Person Profile", domain: "identity", padding: 3 },
  relation: { prefix: "relation", name: "Relationship", domain: "relationships", padding: 3 },
  counterparty: {
    prefix: "counterparty",
    name: "Counterparty",
    domain: "relationships",
    padding: 3,
  },
  workspace: { prefix: "workspace", name: "Workspace", domain: "workspaces", padding: 3 },
  pdoc: { prefix: "pdoc", name: "Personal Document", domain: "documents", padding: 3 },
  note: { prefix: "note", name: "Note", domain: "knowledge", padding: 3 },
  decision: { prefix: "decision", name: "Decision", domain: "knowledge", padding: 3 },
  goal: { prefix: "goal", name: "Goal", domain: "planning", padding: 3 },
  plan: { prefix: "plan", name: "Plan", domain: "planning", padding: 3 },
  commitment: {
    prefix: "commitment",
    name: "Commitment",
    domain: "commitments",
    padding: 3,
  },
  wallet: { prefix: "wallet", name: "Wallet", domain: "money", padding: 3 },
  obligation: {
    prefix: "obligation",
    name: "Obligation",
    domain: "money",
    padding: 3,
  },
  record: { prefix: "record", name: "Admin Record", domain: "admin", padding: 3 },
  personalasset: {
    prefix: "personalasset",
    name: "Personal Asset",
    domain: "assets",
    padding: 3,
  },
  trip: { prefix: "trip", name: "Trip", domain: "travel", padding: 3 },
  health: { prefix: "health", name: "Health Record", domain: "wellbeing", padding: 3 },
  routine: { prefix: "routine", name: "Routine", domain: "automations", padding: 3 },
  assistant: { prefix: "assistant", name: "Assistant", domain: "automations", padding: 3 },
};

export const DOMAINS: Record<string, DomainConfig> = COMPANY_DOMAINS;

export const DOMAIN_NAMES = Object.keys(COMPANY_DOMAINS);

export const SCHEMA_PACKS: Record<SchemaPack, SchemaPackConfig> = {
  company: {
    schemaPack: "company",
    tenantKind: "company",
    rootTitle: "Company Index",
    versionDescription: "Company database schema.",
    domains: COMPANY_DOMAINS,
    typePrefixes: TYPE_PREFIXES,
  },
  person: {
    schemaPack: "person",
    tenantKind: "person",
    rootTitle: "Personal Index",
    versionDescription: "Personal database schema.",
    domains: PERSON_DOMAINS,
    typePrefixes: PERSON_TYPE_PREFIXES,
  },
};

function getPackConfig(schemaPack: SchemaPack): SchemaPackConfig {
  return SCHEMA_PACKS[schemaPack];
}

export function getDomain(name: string): DomainConfig | undefined {
  return COMPANY_DOMAINS[name];
}

export function getDomainForSchemaPack(
  schemaPack: SchemaPack,
  name: string,
): DomainConfig | undefined {
  return getPackConfig(schemaPack).domains[name];
}

export function getDomainsForIndustry(industry: string): DomainConfig[] {
  return getDomainsForSchemaPack("company", { industry });
}

export function getDomainsForSchemaPack(
  schemaPack: SchemaPack,
  options?: { industry?: string | null },
): DomainConfig[] {
  const packDomains = Object.values(getPackConfig(schemaPack).domains);
  if (schemaPack !== "company") {
    return packDomains;
  }

  const industry = options?.industry ?? null;
  if (!industry) {
    return packDomains.filter((d) => !d.industries);
  }

  const coreDomains = packDomains.filter((d) => !d.industries);
  const industryDomains = packDomains.filter((d) => d.industries?.includes(industry));
  return [...coreDomains, ...industryDomains];
}

export function getDomainNamesForSchemaPack(schemaPack: SchemaPack): string[] {
  return Object.keys(getPackConfig(schemaPack).domains);
}

export function getTypePrefixesForSchemaPack(
  schemaPack: SchemaPack,
): Record<string, EntityTypeConfig> {
  return getPackConfig(schemaPack).typePrefixes;
}
