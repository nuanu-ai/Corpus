import type {
  CodexAgentOutput,
  CodexArtifactManifest,
  CodexTargetDomain,
} from "./types";
import { resolveFinanceImportRouteOverride } from "./import-route-policy";

export interface CodexBundleRoute {
  domain: CodexTargetDomain;
  routeKey: string;
  importRootPath: string;
  indexFilePath: string;
  commitMessage: string;
  primaryType: "knowledge-doc" | "document_import";
}

const ALLOWED_TARGET_DOMAINS = new Set<CodexTargetDomain>([
  "finance",
  "knowledge",
  "legal",
  "tax",
  "governance",
  "strategy",
  "operations",
  "assets",
  "documents",
]);

const LEGAL_SIGNAL_PATTERNS: RegExp[] = [
  /\bcontract\b/i,
  /\bagreement\b/i,
  /\bterm[\s_-]?sheet\b/i,
  /\bnda\b/i,
  /\bdeed\b/i,
  /\bnotar(y|ial)\b/i,
  /\bincorporation\b/i,
  /\blicen[sc]e\b/i,
  /\bpermit\b/i,
  /\bcertificate\b/i,
  /\bregistration\b/i,
  /\bakta\b/i,
  /\bpendirian\b/i,
  /\bkemenkumham\b/i,
  /\bnib\b/i,
  /\bnomor induk berusaha\b/i,
  /\bizin\b/i,
  /\bsertifika(t|si)\b/i,
  /\bperjanjian\b/i,
  /(?:^|[\s._-])sk(?:$|[\s._-])/i,
];

const NON_ROUTEABLE_FINANCE_ROLES = new Set([
  "cover",
  "index",
  "table_of_contents",
  "blank_sheet",
  "empty_placeholder",
  "account_mapping",
  "account_mapping_reference",
  "supporting_schedule",
  "reference_schedule",
]);

const FINANCE_ROUTE_ROLE_ALIASES = new Map<string, string>([
  ["balance_sheet", "balance_sheet"],
  ["profit_and_loss", "profit_and_loss"],
  ["cash_flow", "cash_flow"],
  ["trial_balance", "trial_balance"],
  ["general_ledger", "general_ledger"],
  ["fixed_asset_register", "fixed_asset_register"],
  ["bank_reconciliation", "bank_reconciliation"],
  ["budget_vs_actual", "budget_vs_actual"],
  ["ar_aging", "ar_aging"],
  ["ap_aging", "ap_aging"],
  ["primary_statement", "financial_statement"],
]);

const LEGAL_ROUTE_ROLE_ALIASES = new Map<string, string>([
  ["business_license_certificate", "business-license"],
  ["dokumen_izin_usaha", "business-license"],
  ["company_license", "company-license"],
  ["license_or_certificate_record", "license-or-certificate-record"],
  ["permit_register", "permit-register"],
  ["regulatory_filing", "regulatory-filing"],
  ["company_regulatory_filing", "company-regulatory-filing"],
  ["corporate_regulatory_filing", "corporate-regulatory-filing"],
]);

const NON_ROUTEABLE_LEGAL_ROLES = new Set([
  "cover",
  "index",
  "table_of_contents",
  "blank_sheet",
  "empty_placeholder",
  "trial_balance",
  "balance_sheet",
  "profit_and_loss",
  "cash_flow",
  "general_ledger",
  "fixed_asset_register",
  "bank_reconciliation",
  "budget_vs_actual",
  "ar_aging",
  "ap_aging",
  "primary_statement",
]);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "document";
}

function normalizeTargetDomain(value: string): CodexTargetDomain {
  return ALLOWED_TARGET_DOMAINS.has(value as CodexTargetDomain)
    ? (value as CodexTargetDomain)
    : "documents";
}

function normalizeFinanceRouteRole(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;
  if (NON_ROUTEABLE_FINANCE_ROLES.has(normalized)) return null;
  return FINANCE_ROUTE_ROLE_ALIASES.get(normalized) ?? normalized;
}

function inferFinanceRouteKeyFromUnits(output: CodexAgentOutput): string | null {
  const distinctRoles = Array.from(
    new Set(
      output.units
        .map((unit) => normalizeFinanceRouteRole(unit.candidate_role))
        .filter((role): role is string => role !== null),
    ),
  );

  if (distinctRoles.length === 0) return null;
  if (distinctRoles.length === 1) return slugify(distinctRoles[0]!);
  return "financial-statement-pack";
}

function normalizeLegalRouteRole(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;
  if (NON_ROUTEABLE_LEGAL_ROLES.has(normalized)) return null;
  return LEGAL_ROUTE_ROLE_ALIASES.get(normalized) ?? slugify(normalized);
}

function inferLegalRouteKeyFromUnits(output: CodexAgentOutput): string | null {
  const distinctRoles = Array.from(
    new Set(
      output.units
        .map((unit) => normalizeLegalRouteRole(unit.candidate_role))
        .filter((role): role is string => role !== null),
    ),
  );

  if (distinctRoles.length === 0) return null;

  const preferredPermitRole = distinctRoles.find((role) =>
    /business-license|company-license|permit|license|certificate|regulatory-filing/.test(role),
  );
  if (preferredPermitRole) return preferredPermitRole;

  return distinctRoles[0] ?? null;
}

function hasLegalSignals(text: string): boolean {
  const normalized = text.replace(/[_-]+/g, " ");
  return LEGAL_SIGNAL_PATTERNS.some(
    (pattern) => pattern.test(text) || pattern.test(normalized),
  );
}

function hasStrongFinanceSignals(output: CodexAgentOutput): boolean {
  const normalizedReportType = output.normalized_metadata.report_type?.trim().toLowerCase() ?? null;
  const hasStructuredFinanceReportType =
    normalizedReportType !== null &&
    normalizedReportType.length > 0 &&
    normalizedReportType !== "other" &&
    normalizedReportType !== "unknown";

  return (
    output.document_kind === "financial_report" ||
    output.document_kind === "general_ledger" ||
    output.document_kind === "trial_balance" ||
    output.document_kind === "bank_statement" ||
    output.document_kind === "payroll" ||
    hasStructuredFinanceReportType
  );
}

function isFinanceLikeOutput(output: CodexAgentOutput): boolean {
  return (
    output.target_domain === "finance" || hasStrongFinanceSignals(output)
  );
}

function resolveTargetDomain(
  manifest: CodexArtifactManifest,
  output: CodexAgentOutput,
): CodexTargetDomain {
  const normalized = normalizeTargetDomain(output.target_domain);
  if (normalized === "tax") return normalized;

  if (output.document_kind === "license_document") {
    return "legal";
  }

  if (output.document_kind === "legal_document" && normalized === "governance") {
    return "governance";
  }

  const cueText = [
    manifest.fileName,
    output.document_title,
    output.target_entity_type,
    output.document_kind,
    output.normalized_metadata.entity ?? "",
  ]
    .filter((value) => value.trim().length > 0)
    .join("\n");

  if (hasLegalSignals(cueText) && !hasStrongFinanceSignals(output)) {
    return "legal";
  }

  if (isFinanceLikeOutput(output)) {
    return "finance";
  }

  if (normalized === "legal") return normalized;

  if (hasLegalSignals(cueText)) return "legal";
  return normalized;
}

function resolveRouteKey(domain: CodexTargetDomain, output: CodexAgentOutput): string {
  if (domain === "finance") {
    const routeOverride = resolveFinanceImportRouteOverride(output.normalized_metadata.book);
    if (routeOverride) return routeOverride;
    if (output.document_kind === "invoice") return "invoices";
    if (output.document_kind === "receipt") return "receipts";
    if (output.document_kind === "bank_statement") return "bank-statements";
    if (output.document_kind === "payroll") return "payroll";
  }
  const reportType = output.normalized_metadata.report_type?.trim();
  if (reportType && reportType.toLowerCase() !== "other") return slugify(reportType);
  if (domain === "finance") {
    const inferredFinanceRouteKey = inferFinanceRouteKeyFromUnits(output);
    if (inferredFinanceRouteKey) return inferredFinanceRouteKey;
  }
  if (domain === "legal") {
    const inferredLegalRouteKey = inferLegalRouteKeyFromUnits(output);
    if (inferredLegalRouteKey) return inferredLegalRouteKey;
    if (output.document_kind === "license_document") return "business-license";
  }
  if (output.target_entity_type.trim().length > 0) return slugify(output.target_entity_type);
  return slugify(output.document_kind);
}

export function buildCodexBundleRoute(
  manifest: CodexArtifactManifest,
  output: CodexAgentOutput,
): CodexBundleRoute {
  const domain = resolveTargetDomain(manifest, output);
  const routeKey = resolveRouteKey(domain, output);
  const importRootPath = `${domain}/imports/${routeKey}/${manifest.documentId}`;
  const indexFilePath = `${importRootPath}/index.qmd`;

  return {
    domain,
    routeKey,
    importRootPath,
    indexFilePath,
    commitMessage: `${domain}(codex-import:${routeKey}): ${manifest.fileName}`,
    primaryType: domain === "knowledge" ? "knowledge-doc" : "document_import",
  };
}
