export type SummaryScope = "folder" | "domain" | "company";

export type SummaryTemplate =
  | "periodic_snapshot"
  | "transaction_flow"
  | "knowledge_catalog"
  | "legal_decision_pack"
  | "advisory_decision_pack"
  | "communications_decision_pack"
  | "finance_decision_pack"
  | "finance_statements_pack"
  | "finance_projections_pack"
  | "executive_overview";

export interface SummaryTarget {
  id: string;
  title: string;
  enabled: boolean;
  summaryScope: SummaryScope;
  summaryTemplate: SummaryTemplate;
  domain: string;
  physicalPath: string;
  logicalPath: string;
  sourceDomains: string[];
  sourcePaths: string[];
  excludePaths: string[];
  includeTypes?: string[];
  refreshPolicy: "incremental" | "scheduled" | "manual";
  llmMode: "off" | "narrative_only" | "assist_review";
  metricProfile: string;
  thresholdProfile?: string;
  parentTargetId?: string;
  childTargetIds?: string[];
}

export interface SummaryDoc {
  path: string;
  raw: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface SummaryRefreshRequest {
  companySlug: string;
  port: number;
  writeQueuePort: number;
  domains?: string[];
  targetIds?: string[];
  reason?: string;
}

export interface SummaryRefreshResultItem {
  targetId: string;
  path: string;
  status: "updated" | "deleted" | "noop" | "skipped";
  commitSha: string | null;
}

export interface SummaryRefreshResult {
  companySlug: string;
  items: SummaryRefreshResultItem[];
}
