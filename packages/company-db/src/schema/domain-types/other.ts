import type { BaseEntity, MoneyAmount, Address } from "./common.js";

// Domain 1: Identity
export interface CompanyProfile extends BaseEntity {
  type: "company_profile";
  legal_name: string;
  entity_type: string;
  jurisdiction: string;
  stage: string;
  industry: string;
  tax_ids?: Array<{ type: string; value_ref: string; country: string }>;
}

// Domain 2: Governance
export interface BoardMember extends BaseEntity {
  type: "board_member";
  name: string;
  role: string;
  appointed_date: string;
}

export interface FundingRound extends BaseEntity {
  type: "funding_round";
  round_type: string;
  amount: MoneyAmount;
  date: string;
  lead_investor?: string;
  valuation?: MoneyAmount;
}

// Domain 3: Strategy
export interface OKR extends BaseEntity {
  type: "okr";
  period: string;
  objectives: Array<{
    title: string;
    key_results: Array<{ title: string; target: number; current: number }>;
  }>;
}

export interface KPI extends BaseEntity {
  type: "kpi";
  name: string;
  formula?: string;
  industry_tags?: string[];
  unit: string;
}

// Domain 9: Tax
export interface TaxRegistration extends BaseEntity {
  type: "tax_registration";
  jurisdiction: string;
  tax_type: string;
  registration_number_ref?: string;
  effective_date: string;
  status: "active" | "suspended" | "closed";
}

export interface TaxFiling extends BaseEntity {
  type: "tax_filing";
  jurisdiction: string;
  tax_type: string;
  period: string;
  due_date: string;
  filed_date?: string;
  status: "upcoming" | "filed" | "accepted" | "rejected" | "overdue";
  amount?: MoneyAmount;
}

// Domain 10: Products
export interface Product extends BaseEntity {
  type: "product";
  name: string;
  category?: string;
  price?: MoneyAmount;
  status: "active" | "discontinued" | "draft";
  sku?: string;
}

// Domain 11: Projects
export interface Project extends BaseEntity {
  type: "project";
  name: string;
  status: "planned" | "active" | "completed" | "on_hold";
  start_date?: string;
  end_date?: string;
  budget?: MoneyAmount;
}

// Domain 12: Legal
export interface Contract extends BaseEntity {
  type: "contract";
  title: string;
  counterparty: string;
  start_date: string;
  end_date?: string;
  value?: MoneyAmount;
  status: "draft" | "active" | "expired" | "terminated";
}

// Domain 13: Operations
export interface Facility extends BaseEntity {
  type: "facility";
  name: string;
  facility_type: string;
  address?: Address;
  status: "active" | "closed";
}

// Domain 14: Knowledge
export interface Decision extends BaseEntity {
  type: "decision";
  title: string;
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  date: string;
  context?: string;
  decision?: string;
}

// Domain 15: Market
export interface Competitor extends BaseEntity {
  type: "competitor";
  name: string;
  website?: string;
  positioning?: string;
  strengths?: string[];
  weaknesses?: string[];
}

// Domain 16: Integrations
export interface Integration extends BaseEntity {
  type: "integration";
  name: string;
  provider: string;
  status: "active" | "disabled" | "error";
  sync_frequency?: string;
}

// Domain 17: Security
export interface SecurityIncident extends BaseEntity {
  type: "security_incident";
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "investigating" | "resolved" | "closed";
  detected_at: string;
  resolved_at?: string;
}

export interface Risk extends BaseEntity {
  type: "risk";
  title: string;
  category: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  status: "identified" | "mitigated" | "accepted" | "closed";
  mitigation?: string;
}

// Domain 18: Inventory
export interface InventoryItem extends BaseEntity {
  type: "inventory_item";
  name: string;
  sku?: string;
  unit: string;
  reorder_point?: number;
  cost?: MoneyAmount;
}

export interface StockMovement extends BaseEntity {
  type: "stock_movement";
  item_id: string;
  location_id: string;
  movement_type: "receive" | "consume" | "waste" | "transfer" | "adjust";
  quantity: number;
  date: string;
}

// Domain 19: Assets
export interface PhysicalAsset extends BaseEntity {
  type: "physical_asset";
  name: string;
  asset_type: "property" | "equipment" | "vehicle" | "unit";
  purchase_date?: string;
  purchase_price?: MoneyAmount;
  depreciation_method?: string;
  status: "active" | "maintenance" | "retired";
}

// Domain 20: Bookings
export interface Reservation extends BaseEntity {
  type: "reservation";
  guest_id?: string;
  customer_id?: string;
  unit_id?: string;
  check_in: string;
  check_out: string;
  status: "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";
  total: MoneyAmount;
  channel?: string;
}

export interface Guest extends BaseEntity {
  type: "guest";
  name: string;
  email?: string;
  phone?: string;
  nationality?: string;
  visits?: number;
}

export interface Channel extends BaseEntity {
  type: "channel";
  name: string;
  channel_type: "ota" | "direct" | "walk_in" | "corporate";
  commission_rate?: number;
  is_active: boolean;
}

// Domain 21: Documents
export interface DocumentRecord extends BaseEntity {
  type: "document";
  filename: string;
  document_type: string;
  storage_path: string;
  extraction_status: "pending" | "processing" | "completed" | "failed";
  schema_id?: string;
  confidence?: number;
  dedup_hash?: string;
}

export interface ExtractionPipeline extends BaseEntity {
  type: "pipeline";
  name: string;
  schema_id: string;
  target_domain: string;
  status: "active" | "disabled";
}

export interface ExtractionJob extends BaseEntity {
  type: "extraction_job";
  pipeline_id: string;
  document_id: string;
  status: "pending" | "running" | "completed" | "failed";
  started_at?: string;
  completed_at?: string;
  records_extracted?: number;
  errors?: string[];
}

// Domain 22: Entities (multi-entity)
export interface EntityRecord extends BaseEntity {
  type: "entity";
  slug: string;
  legal_name: string;
  relationship: "parent" | "subsidiary" | "branch" | "affiliate";
  parent_entity?: string;
  jurisdiction: string;
  active_domains: string[];
}

export interface IntercompanyTransaction extends BaseEntity {
  type: "intercompany_transaction";
  source_entity: string;
  target_entity: string;
  amount: MoneyAmount;
  description: string;
  status: "pending_counterparty" | "confirmed" | "disputed" | "pending_confirmation" | "resolved" | "cancelled";
  journal_entry_ref?: string;
  counterparty_journal_entry_ref?: string;
}
