export const REPORT_BUILT_IN_SOURCE_IDS = [
  "company_db",
  "odoo",
  "documents",
] as const;

export type ReportBuiltInSourceId = typeof REPORT_BUILT_IN_SOURCE_IDS[number];

const DEFAULT_REPORT_SOURCES: ReportBuiltInSourceId[] = ["company_db", "odoo", "documents"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function resolveReportBuiltInSources(sourcePolicy: unknown): ReportBuiltInSourceId[] {
  if (!isRecord(sourcePolicy) || !Array.isArray(sourcePolicy.builtInSources)) {
    return DEFAULT_REPORT_SOURCES;
  }
  const selected = sourcePolicy.builtInSources.filter(
    (source): source is ReportBuiltInSourceId =>
      source === "company_db" ||
      source === "odoo" ||
      source === "documents",
  );
  const deduped = Array.from(new Set(selected));
  return deduped.length > 0 ? deduped : DEFAULT_REPORT_SOURCES;
}
