export type OperatingEntityObjectType =
  | "operating_domain"
  | "project"
  | "legal_entity"
  | "territory"
  | "line_of_business"
  | "partner"
  | "department"
  | "unknown";

export type OperatingEntityStatus =
  | "draft"
  | "confirmed"
  | "deprecated"
  | "outside_perimeter"
  | "unknown";

export type OperatingEntityConfidence = "low" | "medium" | "high";

export type OperatingRevenueBasis =
  | "operational_gross"
  | "company_net_share"
  | "posted_accounting"
  | "cash_received"
  | "mixed"
  | "unknown";

export type OperatingCostBasis =
  | "booked_expense"
  | "purchase_order"
  | "accrual_estimate"
  | "mixed"
  | "unknown";

export type OperatingCashBasis =
  | "bank_balance"
  | "wallet_balance"
  | "receivable"
  | "unknown";

export type OperatingOwnership =
  | "owned"
  | "joint_venture"
  | "tenant"
  | "partner_revenue_share"
  | "external_investment"
  | "unknown";

export interface OperatingEntitySourceRow {
  source: string;
  rowNumber: number;
  project: string;
  legalEntity: string;
  alias: string;
  notes: string[];
}

export interface OperatingEntitySourceMapping {
  odoo?: {
    company?: string;
    analyticAccounts?: string[];
    posConfigs?: string[];
    accounts?: string[];
    partners?: string[];
  };
  customMcp?: {
    tools?: string[];
  };
  companyDb?: {
    folders?: string[];
    queryAliases?: string[];
  };
}

export interface OperatingEntityMetricRules {
  revenueBasis: OperatingRevenueBasis;
  costBasis: OperatingCostBasis;
  cashBasis: OperatingCashBasis;
}

export interface OperatingEntityEconomicModel {
  ownership: OperatingOwnership;
  notes?: string;
}

export interface OperatingEntityRecord {
  id: string;
  canonicalName: string;
  objectType: OperatingEntityObjectType;
  status: OperatingEntityStatus;
  aliases: string[];
  parentIds: string[];
  legalEntityIds: string[];
  partnerIds: string[];
  sourceMappings: OperatingEntitySourceMapping;
  metricRules: OperatingEntityMetricRules;
  economicModel: OperatingEntityEconomicModel;
  confidence: OperatingEntityConfidence;
  reviewOwner?: string;
  notes: string[];
  tags: string[];
  sourceRows: OperatingEntitySourceRow[];
}

export interface OperatingEntityMatch {
  record: OperatingEntityRecord;
  score: number;
  matchedTerm: string;
  matchKind: "exact" | "contains" | "token";
}

export interface OperatingEntityRegistry {
  records: OperatingEntityRecord[];
  recordsById: Map<string, OperatingEntityRecord>;
  legalEntityNamesById: Map<string, string>;
  sourceWarnings: string[];
}
