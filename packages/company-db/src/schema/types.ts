export type TenantKind = "company" | "person";

export type SchemaPack = "company" | "person";

export interface DomainConfig {
  name: string;
  basePath: string;
  entityTypes: EntityTypeConfig[];
  industries?: string[];
}

export interface EntityTypeConfig {
  prefix: string;
  name: string;
  domain: string;
  padding: number;
}

export interface QualifiedId {
  prefix: string;
  number: number;
  raw: string;
}

export interface TenantDescriptor {
  tenantKind: TenantKind;
  schemaPack: SchemaPack;
  slug: string;
  title: string;
}

export interface SchemaPackConfig {
  schemaPack: SchemaPack;
  tenantKind: TenantKind;
  rootTitle: string;
  versionDescription: string;
  domains: Record<string, DomainConfig>;
  typePrefixes: Record<string, EntityTypeConfig>;
}

export const TYPE_PREFIXES: Record<string, EntityTypeConfig> = {
  emp: { prefix: "emp", name: "Employee", domain: "people", padding: 3 },
  agt: { prefix: "agt", name: "Agent", domain: "people", padding: 3 },
  team: { prefix: "team", name: "Team", domain: "people", padding: 3 },
  cust: { prefix: "cust", name: "Customer", domain: "revenue", padding: 3 },
  contact: { prefix: "contact", name: "Contact", domain: "revenue", padding: 3 },
  deal: { prefix: "deal", name: "Deal", domain: "revenue", padding: 3 },
  sub: { prefix: "sub", name: "Subscription", domain: "revenue", padding: 3 },
  vnd: { prefix: "vnd", name: "Vendor", domain: "expenses", padding: 3 },
  bill: { prefix: "bill", name: "Bill", domain: "expenses", padding: 3 },
  po: { prefix: "po", name: "Purchase Order", domain: "expenses", padding: 3 },
  report: { prefix: "report", name: "Expense Report", domain: "expenses", padding: 3 },
  inv: { prefix: "inv", name: "Invoice", domain: "revenue", padding: 3 },
  prod: { prefix: "prod", name: "Product", domain: "products", padding: 3 },
  je: { prefix: "je", name: "Journal Entry", domain: "finance", padding: 5 },
  txn: { prefix: "txn", name: "Transaction", domain: "banking", padding: 3 },
  doc: { prefix: "doc", name: "Document", domain: "documents", padding: 3 },
  job: { prefix: "job", name: "Job Posting", domain: "people", padding: 3 },
  pipeline: { prefix: "pipeline", name: "Pipeline", domain: "revenue", padding: 3 },
  res: { prefix: "res", name: "Reservation", domain: "bookings", padding: 3 },
  guest: { prefix: "guest", name: "Guest", domain: "bookings", padding: 3 },
  channel: { prefix: "channel", name: "Channel", domain: "market", padding: 3 },
  ctr: { prefix: "ctr", name: "Contract", domain: "legal", padding: 3 },
  room: { prefix: "room", name: "Room", domain: "bookings", padding: 3 },
  asset: { prefix: "asset", name: "Asset", domain: "assets", padding: 3 },
  loc: { prefix: "loc", name: "Location", domain: "operations", padding: 3 },
  filing: { prefix: "filing", name: "Tax Filing", domain: "tax", padding: 3 },
  risk: { prefix: "risk", name: "Risk", domain: "security", padding: 3 },
  incident: { prefix: "incident", name: "Incident", domain: "security", padding: 3 },
  snapshot: { prefix: "snapshot", name: "Financial Snapshot", domain: "finance", padding: 3 },
};

export type IdPrefix = keyof typeof TYPE_PREFIXES;
