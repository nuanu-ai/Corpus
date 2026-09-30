import type { ExtractedReport, ReportLineItem } from "@/lib/document-parsers/report-types";
import { normalizeReportingPeriodKey } from "@/lib/document-parsers/period-utils";

function sanitizeSheetPart(value: string | null | undefined): string {
  const normalized = value
    ?.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return normalized && normalized.length > 0 ? normalized : "sheet";
}

function isKnownEntity(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;

  const lowered = normalized.toLowerCase();
  return lowered !== "unknown" && lowered !== "n/a" && lowered !== "na";
}

function isGenericReportSheetName(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  if (!normalized) return false;
  if (/^(sheet|chart|filter)s?\s*\d*$/i.test(normalized)) return true;

  const genericPatterns = [
    /\bprofit\s*(and|&)?\s*loss\b/i,
    /\bp\s*&\s*l\b/i,
    /\bpnl\b/i,
    /\bbalance\s*sheet\b/i,
    /\btrial\s*balance\b/i,
    /\bcash\s*flow\b/i,
    /\bgeneral\s*ledger\b/i,
    /\bfixed\s*asset\b/i,
    /\bsummary\b/i,
  ];

  return genericPatterns.some((pattern) => pattern.test(normalized));
}

export function resolveReportEntity(
  entity: string | null | undefined,
  sheetName?: string | null,
): string {
  if (isKnownEntity(entity) && !isGenericReportSheetName(entity)) {
    return entity.trim();
  }
  if (isKnownEntity(sheetName) && !isGenericReportSheetName(sheetName)) {
    return sheetName.trim();
  }
  return "Unknown";
}

export function resolveReportSheetPart(
  sheetName: string | null | undefined,
  lineItems?: Array<Pick<ReportLineItem, "source">> | null,
): string {
  const sourceSheet = lineItems?.[0]?.source?.sheet;
  return sanitizeSheetPart(sheetName ?? sourceSheet ?? "sheet");
}

type ReportIdentityInput = Pick<
  ExtractedReport,
  "report_type" | "reporting_period" | "book" | "currency" | "entity" | "sheet_name" | "line_items"
>;

export function buildReportExternalId(report: ReportIdentityInput): string {
  const periodKey = normalizeReportingPeriodKey(report.reporting_period);
  const resolvedEntity = resolveReportEntity(report.entity, report.sheet_name);
  const sheetPart = resolveReportSheetPart(report.sheet_name, report.line_items);

  return `report:${report.report_type}:${periodKey}:${report.book}:${report.currency}:${resolvedEntity}:${sheetPart}:v1`;
}
