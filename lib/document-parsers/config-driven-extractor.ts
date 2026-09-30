// ---------------------------------------------------------------------------
// ConfigDrivenExtractor — deterministic extraction engine for financial reports
// ---------------------------------------------------------------------------
// Given a ReportConfig blueprint and an XLSX workbook, extracts structured
// ReportLineItem[] with cell-level lineage, detects reporting periods,
// calculates derived metrics, and validates financial invariants.
// ---------------------------------------------------------------------------

import * as XLSX from "xlsx";
import type {
  ReportConfig,
  ReportLineItem,
  ExtractedReport,
  ReportingPeriod,
  ReportType,
  SectionMarker,
} from "./report-types";
import { validateReport } from "./report-types";

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a sheet to an array-of-arrays (raw mode preserves numeric types).
 */
function sheetToAOA(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });
}

/**
 * Resolve a column letter (e.g. "B") to a 0-based index.
 */
function colLetterToIndex(letter: string): number {
  return XLSX.utils.decode_col(letter.toUpperCase());
}

/**
 * Get cell reference string like "B15" for a given row/column.
 */
function cellRef(row: number, col: number): string {
  return XLSX.utils.encode_cell({ r: row, c: col });
}

/**
 * Measure leading whitespace to determine hierarchy depth.
 * depth = Math.floor(leadingSpaces / 2), capped at 10.
 */
function detectDepth(text: string): number {
  const match = text.match(/^(\s+)/);
  if (!match) return 0;
  return Math.min(Math.floor(match[1].length / 2), 10);
}

/**
 * Check if a row label represents a total/subtotal line.
 */
function isTotalRow(label: string): boolean {
  return /\btotal\b/i.test(label);
}

/**
 * Coerce a worksheet cell value into a numeric amount.
 *
 * Handles:
 * - native numeric cells
 * - accounting negatives in parentheses: "(1,234.56)"
 * - locale separators: "1,234.56", "1.234,56", "1.234.567"
 * - currency markers / sign noise: "Rp 1.234.567", "USD 1,234", "1,234 CR"
 */
function toNumericValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  let text = value.trim();
  if (!text) return null;

  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  // Strip common accounting suffixes and currency hints.
  text = text
    .replace(/\b(cr|dr)\b$/i, "")
    .replace(/\b(usd|idr|eur|gbp|sgd|aud|cad|jpy)\b/gi, "")
    .replace(/rp\.?/gi, "")
    .replace(/[$€£¥]/g, "")
    .replace(/\s+/g, "");

  if (!text) return null;

  const commaCount = (text.match(/,/g) ?? []).length;
  const dotCount = (text.match(/\./g) ?? []).length;

  if (commaCount > 0 && dotCount > 0) {
    // Whichever separator appears last is assumed decimal separator.
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(/,/g, ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (commaCount > 0) {
    // If last comma is followed by 1-2 digits, treat as decimal comma.
    if (/,\d{1,2}$/.test(text)) {
      text = text.replace(/\./g, "").replace(/,/g, ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (dotCount > 1 && /^\d{1,3}(?:\.\d{3})+(?:\.\d+)?$/.test(text)) {
    // Indonesian/European thousand separators without comma.
    text = text.replace(/\./g, "");
  } else if (dotCount === 1 && /^\d{1,3}\.\d{3}$/.test(text)) {
    // Common IDR-style thousands: 12.000 -> 12000
    text = text.replace(/\./g, "");
  }

  if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) {
    return null;
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRegexPattern(pattern: string): string {
  return pattern.replace(/^\(\?[a-z-]+\)/i, "");
}

function compilePattern(pattern: string): RegExp {
  const normalized = normalizeRegexPattern(pattern);
  try {
    return new RegExp(normalized, "i");
  } catch {
    return new RegExp(escapeRegExp(normalized), "i");
  }
}

/**
 * Try to match a string against a pattern (regex or literal).
 * Returns true if pattern matches.
 */
function matchesPattern(text: string, pattern: string): boolean {
  try {
    const re = compilePattern(pattern);
    return re.test(text);
  } catch {
    // Fallback to literal case-insensitive comparison
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
}

/**
 * Attempt to parse a date-like column header string.
 * Supports formats like "Jan 2024", "2024-01", "Q1 2024",
 * "January 2024", "FY2024", "2024", "31 Dec 2024", "12/31/2024".
 */
function parsePeriodFromHeader(header: string): { start: string; end: string; label: string } | null {
  if (!header || typeof header !== "string") return null;
  const trimmed = header.trim();

  // "2024-01" or "2024-01-31"
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]);
    const month = parseInt(isoMatch[2]);
    const day = isoMatch[3] ? parseInt(isoMatch[3]) : null;
    if (day) {
      return { start: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, end: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, label: trimmed };
    }
    const lastDay = new Date(year, month, 0).getDate();
    return {
      start: `${year}-${String(month).padStart(2, "0")}-01`,
      end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      label: trimmed,
    };
  }

  // Month name patterns: "Jan 2024", "January 2024", "Jan-24"
  const monthNames: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6,
    jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const monthMatch = trimmed.match(/^(\w+)\s*[-/]?\s*(\d{2,4})$/);
  if (monthMatch) {
    const monthStr = monthMatch[1].toLowerCase();
    const monthNum = monthNames[monthStr];
    if (monthNum) {
      let year = parseInt(monthMatch[2]);
      if (year < 100) year += 2000;
      const lastDay = new Date(year, monthNum, 0).getDate();
      return {
        start: `${year}-${String(monthNum).padStart(2, "0")}-01`,
        end: `${year}-${String(monthNum).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
        label: trimmed,
      };
    }
  }

  // "31 Dec 2024" or "Dec 31, 2024" style
  const dayMonthYear = trimmed.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (dayMonthYear) {
    const monthNum = monthNames[dayMonthYear[2].toLowerCase()];
    if (monthNum) {
      const year = parseInt(dayMonthYear[3]);
      const day = parseInt(dayMonthYear[1]);
      return {
        start: `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        end: `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        label: trimmed,
      };
    }
  }

  // Quarter: "Q1 2024", "Q1-2024"
  const quarterMatch = trimmed.match(/^Q([1-4])\s*[-/]?\s*(\d{4})$/i);
  if (quarterMatch) {
    const q = parseInt(quarterMatch[1]);
    const year = parseInt(quarterMatch[2]);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = q * 3;
    const lastDay = new Date(year, endMonth, 0).getDate();
    return {
      start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
      end: `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      label: trimmed,
    };
  }

  // FY: "FY2024", "FY 2024"
  const fyMatch = trimmed.match(/^FY\s*(\d{4})$/i);
  if (fyMatch) {
    const year = parseInt(fyMatch[1]);
    return {
      start: `${year}-01-01`,
      end: `${year}-12-31`,
      label: trimmed,
    };
  }

  // Plain year: "2024" (only accept realistic years 1900-2100)
  const yearMatch = trimmed.match(/^(\d{4})$/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    if (year >= 1900 && year <= 2100) {
      return {
        start: `${year}-01-01`,
        end: `${year}-12-31`,
        label: trimmed,
      };
    }
  }

  return null;
}

// ── Section extraction ──────────────────────────────────────────────────

/**
 * Extract line items from a sheet using section markers.
 *
 * Scans rows looking for start_marker / end_marker patterns in the
 * `account_name` column.  Between markers, each row becomes a
 * ReportLineItem with depth derived from indentation.
 */
export function extractSection(
  sheet: XLSX.WorkSheet,
  columns: Record<string, string>,
  sections: Record<string, SectionMarker>,
  sheetName: string,
): ReportLineItem[] {
  const rows = sheetToAOA(sheet);
  const items: ReportLineItem[] = [];

  // Resolve column mappings to indices
  const colMap: Record<string, number> = {};
  for (const [logicalName, colRef] of Object.entries(columns)) {
    colMap[logicalName] = colLetterToIndex(colRef);
  }

  const nameColIdx = colMap["account_name"] ?? colMap["name"] ?? 0;

  // Value columns are everything except account_name / name / account_number
  const valueColumns: { key: string; idx: number }[] = [];
  for (const [logicalName, idx] of Object.entries(colMap)) {
    if (logicalName !== "account_name" && logicalName !== "name" && logicalName !== "account_number") {
      valueColumns.push({ key: logicalName, idx });
    }
  }

  // Build ordered section list with compiled patterns
  const sectionDefs = Object.entries(sections).map(([name, marker]) => ({
    name,
    startRe: compilePattern(marker.start),
    endRe: marker.end ? compilePattern(marker.end) : null,
  }));

  let currentSection: string | null = null;
  let currentSubsection: string | null = null;
  let pendingEndRe: RegExp | null = null;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    const rawName = row[nameColIdx];
    if (rawName === null || rawName === undefined || String(rawName).trim() === "") continue;

    const nameStr = String(rawName);
    const trimmedName = nameStr.trim();

    // Check if this row marks the end of the current section
    if (pendingEndRe && matchesPattern(trimmedName, pendingEndRe.source)) {
      // Include the end marker row (often a total) before closing the section
      if (currentSection) {
        const depth = detectDepth(nameStr);
        const values: Record<string, number | null> = {};
        const columnRefs: Record<string, string> = {};

        columnRefs["account_name"] = cellRef(r, nameColIdx);
        for (const vc of valueColumns) {
          const cellVal = row[vc.idx];
          values[vc.key] = toNumericValue(cellVal);
          columnRefs[vc.key] = cellRef(r, vc.idx);
        }

        items.push({
          account_name: trimmedName,
          account_number: colMap["account_number"] !== undefined
            ? (row[colMap["account_number"]] != null ? String(row[colMap["account_number"]]).trim() : undefined)
            : undefined,
          section: currentSection,
          subsection: currentSubsection ?? undefined,
          values,
          depth,
          is_total: isTotalRow(trimmedName),
          source: { sheet: sheetName, row: r, columns: columnRefs },
        });
      }

      currentSection = null;
      currentSubsection = null;
      pendingEndRe = null;
      continue;
    }

    // Check if this row starts a new section
    let matchedSection = false;
    for (const def of sectionDefs) {
      if (def.startRe.test(trimmedName)) {
        // If we were already in a section, close it (next section start ends previous)
        currentSection = def.name;
        currentSubsection = null;
        pendingEndRe = def.endRe;
        matchedSection = true;
        break;
      }
    }

    // If the row matched a section start marker, it's a header — don't extract as data row
    if (matchedSection) continue;

    // If we're inside a section, extract the row as a line item
    if (currentSection) {
      const depth = detectDepth(nameStr);

      // Detect subsection: depth 0 non-total rows that don't match any section start
      if (depth === 0 && !isTotalRow(trimmedName)) {
        // Check if this row has no values — then it's a subsection header
        const hasValues = valueColumns.some((vc) => {
          const v = row[vc.idx];
          return toNumericValue(v) !== null;
        });
        if (!hasValues) {
          currentSubsection = trimmedName;
          continue;
        }
      }

      const values: Record<string, number | null> = {};
      const columnRefs: Record<string, string> = {};

      columnRefs["account_name"] = cellRef(r, nameColIdx);
      for (const vc of valueColumns) {
        const cellVal = row[vc.idx];
        values[vc.key] = toNumericValue(cellVal);
        columnRefs[vc.key] = cellRef(r, vc.idx);
      }

      items.push({
        account_name: trimmedName,
        account_number: colMap["account_number"] !== undefined
          ? (row[colMap["account_number"]] != null ? String(row[colMap["account_number"]]).trim() : undefined)
          : undefined,
        section: currentSection,
        subsection: currentSubsection ?? undefined,
        values,
        depth,
        is_total: isTotalRow(trimmedName),
        source: { sheet: sheetName, row: r, columns: columnRefs },
      });
    }
  }

  return items;
}

// ── Tabular extraction ──────────────────────────────────────────────────

/**
 * Extract line items from a sheet using a flat tabular layout.
 *
 * Each non-header row becomes a ReportLineItem.  Rows containing "TOTAL"
 * in the account name column are treated as group separators.  The current
 * section is tracked by the most recent total-row label prefix
 * (e.g. "TOTAL Current Assets" -> section = "Current Assets").
 */
export function extractTabular(
  sheet: XLSX.WorkSheet,
  columns: Record<string, string>,
  sheetName: string,
): ReportLineItem[] {
  const rows = sheetToAOA(sheet);
  const items: ReportLineItem[] = [];

  // Resolve column mappings
  const colMap: Record<string, number> = {};
  for (const [logicalName, colRef] of Object.entries(columns)) {
    colMap[logicalName] = colLetterToIndex(colRef);
  }

  const nameColIdx = colMap["account_name"] ?? colMap["name"] ?? 0;

  const valueColumns: { key: string; idx: number }[] = [];
  for (const [logicalName, idx] of Object.entries(colMap)) {
    if (logicalName !== "account_name" && logicalName !== "name" && logicalName !== "account_number") {
      valueColumns.push({ key: logicalName, idx });
    }
  }

  // Find the column label row. This is typically row 0, but could be later
  // for spreadsheets with multi-row headers (company name, period, etc.).
  // Strategy: find the first row where a value column contains a non-empty
  // string (column labels like "Amount", "Debit", "Credit").
  // Everything after the column label row is either section headers or data.
  let columnLabelRow = 0;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r];
    if (!row) continue;
    const hasStringLabel = valueColumns.some((vc) => {
      const v = row[vc.idx];
      return typeof v === "string" && v.trim() !== "";
    });
    if (hasStringLabel) {
      columnLabelRow = r;
      break;
    }
  }

  let currentSection = "Default";

  for (let r = columnLabelRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    const rawName = row[nameColIdx];
    if (rawName === null || rawName === undefined || String(rawName).trim() === "") continue;

    const nameStr = String(rawName);
    const trimmedName = nameStr.trim();
    const depth = detectDepth(nameStr);
    const isTotal = isTotalRow(trimmedName);

    const values: Record<string, number | null> = {};
    const columnRefs: Record<string, string> = {};
    columnRefs["account_name"] = cellRef(r, nameColIdx);

    for (const vc of valueColumns) {
      const cellVal = row[vc.idx];
      values[vc.key] = toNumericValue(cellVal);
      columnRefs[vc.key] = cellRef(r, vc.idx);
    }

    // Detect section from TOTAL rows:
    // "TOTAL Current Assets" -> section = "Current Assets"
    if (isTotal) {
      const sectionLabel = trimmedName.replace(/\btotal\b/i, "").trim();
      if (sectionLabel) {
        currentSection = sectionLabel;
      }
    }

    // Non-total rows with no values and depth 0 might be section headers
    const hasValues = valueColumns.some((vc) => toNumericValue(row[vc.idx]) !== null);
    if (!isTotal && !hasValues && depth === 0) {
      currentSection = trimmedName;
      continue;
    }

    items.push({
      account_name: trimmedName,
      account_number: colMap["account_number"] !== undefined
        ? (row[colMap["account_number"]] != null ? String(row[colMap["account_number"]]).trim() : undefined)
        : undefined,
      section: currentSection,
      values,
      depth,
      is_total: isTotal,
      source: { sheet: sheetName, row: r, columns: columnRefs },
    });
  }

  return items;
}

function estimateExtractableRowCount(
  sheet: XLSX.WorkSheet,
  columns: Record<string, string>,
): number {
  const rows = sheetToAOA(sheet);
  if (rows.length === 0) return 0;

  const colMap: Record<string, number> = {};
  for (const [logicalName, colRef] of Object.entries(columns)) {
    colMap[logicalName] = colLetterToIndex(colRef);
  }

  const nameColIdx = colMap["account_name"] ?? colMap["name"] ?? 0;
  const valueCols = Object.entries(colMap)
    .filter(([logicalName]) =>
      logicalName !== "account_name" &&
      logicalName !== "name" &&
      logicalName !== "account_number")
    .map(([, idx]) => idx);

  if (valueCols.length === 0) return 0;

  let count = 0;
  for (const row of rows) {
    if (!row) continue;
    const rawName = row[nameColIdx];
    if (rawName === null || rawName === undefined) continue;
    if (String(rawName).trim() === "") continue;

    const hasNumericValue = valueCols.some((idx) => {
      const value = row[idx];
      return toNumericValue(value) !== null;
    });

    if (hasNumericValue) count++;
  }

  return count;
}

// ── Period detection ────────────────────────────────────────────────────

/**
 * Detect reporting period from column headers.
 *
 * Scans only the header rows of the sheet (rows before the first numeric
 * data row) for date-like patterns in the value columns.
 */
function detectPeriod(
  sheet: XLSX.WorkSheet,
  columns: Record<string, string>,
): ReportingPeriod {
  const rows = sheetToAOA(sheet);

  // Build list of value column indices
  const valueColIndices: number[] = [];
  for (const [logicalName, colRef] of Object.entries(columns)) {
    if (logicalName !== "account_name" && logicalName !== "name" && logicalName !== "account_number") {
      valueColIndices.push(colLetterToIndex(colRef));
    }
  }

  // Find the first row with numeric data in value columns to bound header scan
  let headerBound = Math.min(rows.length, 5);
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r];
    if (!row) continue;
    const hasNumeric = valueColIndices.some((idx) => toNumericValue(row[idx]) !== null);
    if (hasNumeric) {
      // The row before the first data row is the last header row
      headerBound = r;
      break;
    }
  }

  // Scan only header rows for date-like patterns
  const periods: { start: string; end: string; label: string }[] = [];
  for (let r = 0; r < headerBound; r++) {
    const row = rows[r];
    if (!row) continue;
    for (const colIdx of valueColIndices) {
      const cellVal = row[colIdx];
      if (cellVal === null || cellVal === undefined) continue;
      // Skip purely numeric values that are likely data, not date headers
      if (typeof cellVal === "number") continue;
      const parsed = parsePeriodFromHeader(String(cellVal));
      if (parsed) {
        periods.push(parsed);
      }
    }
  }

  if (periods.length === 0) {
    // Fallback: unknown period
    return { start: "1970-01-01", end: "1970-01-01", label: "Unknown" };
  }

  // Use the widest span
  const allStarts = periods.map((p) => p.start).sort();
  const allEnds = periods.map((p) => p.end).sort();
  return {
    start: allStarts[0],
    end: allEnds[allEnds.length - 1],
    label: periods.map((p) => p.label).join(" - "),
  };
}

// ── Derived metrics ─────────────────────────────────────────────────────

/**
 * Calculate derived financial metrics from extracted line items.
 *
 * - P&L: gross_margin, net_margin
 * - BS: current_ratio
 */
export function calculateDerivedMetrics(
  items: ReportLineItem[],
  reportType: ReportType,
): Record<string, number> {
  const metrics: Record<string, number> = {};

  if (reportType === "profit_and_loss") {
    // Find revenue total
    const revenueTotal = findSectionTotal(items, "revenue");
    const cogsTotal = findSectionTotal(items, "cost");
    const netIncomeTotal = findSectionTotal(items, "net");

    if (revenueTotal !== null && revenueTotal !== 0) {
      if (cogsTotal !== null) {
        metrics.gross_margin = (revenueTotal - Math.abs(cogsTotal)) / revenueTotal;
      }
      if (netIncomeTotal !== null) {
        metrics.net_margin = netIncomeTotal / revenueTotal;
      }
    }
  }

  if (reportType === "balance_sheet") {
    const currentAssets = findSectionTotal(items, "current asset");
    const currentLiabilities = findSectionTotal(items, "current liabilit");

    if (currentAssets !== null && currentLiabilities !== null && currentLiabilities !== 0) {
      metrics.current_ratio = currentAssets / Math.abs(currentLiabilities);
    }
  }

  return metrics;
}

/**
 * Find the summed value of total rows in a section whose name contains `keyword`.
 * Falls back to summing non-total items if no total row found.
 */
function findSectionTotal(items: ReportLineItem[], keyword: string): number | null {
  // Try total rows first
  const totals = items.filter(
    (li) => li.is_total && li.section.toLowerCase().includes(keyword),
  );
  if (totals.length > 0) {
    return sumValues(totals);
  }

  // Fallback: sum non-total items in matching sections
  const sectionItems = items.filter(
    (li) => !li.is_total && li.section.toLowerCase().includes(keyword),
  );
  if (sectionItems.length > 0) {
    return sumValues(sectionItems);
  }

  return null;
}

function sumValues(items: ReportLineItem[]): number {
  let total = 0;
  for (const li of items) {
    for (const val of Object.values(li.values)) {
      if (val !== null && val !== undefined) total += val;
    }
  }
  return total;
}

// ── Main extraction ─────────────────────────────────────────────────────

/**
 * Extract structured financial reports from a workbook using a config.
 *
 * For each configured sheet:
 * 1. Applies section or tabular extraction
 * 2. Detects reporting period from column headers
 * 3. Calculates derived metrics
 * 4. Validates financial invariants
 * 5. Sets confidence based on validation outcome
 */
export function extractReport(
  workbook: XLSX.WorkBook,
  config: ReportConfig,
): ExtractedReport[] {
  const reports: ExtractedReport[] = [];

  for (const sheetName of config.sheet_names) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // Extract line items
    let lineItems: ReportLineItem[];
    let usedTabularFallback = false;
    if (config.extraction_type === "section" && config.sections) {
      lineItems = extractSection(sheet, config.columns, config.sections, sheetName);

      const candidateRowCount = estimateExtractableRowCount(sheet, config.columns);
      const coverage = candidateRowCount > 0 ? lineItems.length / candidateRowCount : 1;

      // If section extraction captured too little of a large sheet, switch to
      // tabular extraction to preserve financial rows instead of dropping them.
      if (candidateRowCount >= 20 && coverage < 0.35) {
        const tabularItems = extractTabular(sheet, config.columns, sheetName);
        if (tabularItems.length > lineItems.length) {
          lineItems = tabularItems;
          usedTabularFallback = true;
        }
      }
    } else {
      lineItems = extractTabular(sheet, config.columns, sheetName);
    }

    if (lineItems.length === 0) continue;

    // Detect reporting period
    const period = detectPeriod(sheet, config.columns);

    // Calculate derived metrics
    const derivedMetrics = calculateDerivedMetrics(lineItems, config.report_type);

    // Build report
    const report: ExtractedReport = {
      report_type: config.report_type,
      reporting_period: period,
      currency: config.currency,
      book: config.book,
      entity: workbook.Props?.Company ?? "Unknown",
      sheet_name: sheetName,
      line_items: lineItems,
      derived_metrics: Object.keys(derivedMetrics).length > 0 ? derivedMetrics : undefined,
      confidence: 0.9, // default high confidence
    };

    // Validate financial invariants
    const validation = validateReport(report);
    if (!validation.valid) {
      report.confidence = usedTabularFallback ? 0.72 : 0.5;
    }

    reports.push(report);
  }

  return reports;
}
