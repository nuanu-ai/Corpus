// ---------------------------------------------------------------------------
// Report types, extraction blueprints, and financial invariant validators
// ---------------------------------------------------------------------------

// ---- Report Type enum ----

export const REPORT_TYPES = [
  "profit_and_loss",
  "balance_sheet",
  "trial_balance",
  "general_ledger",
  "financial_statement",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(value: unknown): value is ReportType {
  return (
    typeof value === "string" &&
    REPORT_TYPES.includes(value as ReportType)
  );
}

// ---- Book type ----

export const BOOK_TYPES = ["actual", "budget", "forecast"] as const;
export type BookType = (typeof BOOK_TYPES)[number];

export function isBookType(value: unknown): value is BookType {
  return (
    typeof value === "string" && BOOK_TYPES.includes(value as BookType)
  );
}

// ---- Extraction type ----

export const EXTRACTION_TYPES = ["section", "tabular"] as const;
export type ExtractionType = (typeof EXTRACTION_TYPES)[number];

// ---- Detection rule ----

export interface DetectionRule {
  /** Field to match against (e.g. "sheet_name", "header_row", "cell") */
  field: string;
  /** Regex pattern or literal string to match */
  pattern: string;
  /** Weight for scoring when multiple rules match (0-1, default 1) */
  weight?: number;
}

// ---- Section marker ----

export interface SectionMarker {
  /** Regex or literal to detect the start of a section */
  start: string;
  /** Regex or literal to detect the end of a section (optional; next section start ends previous) */
  end?: string;
}

// ---- ReportConfig — extraction blueprint ----

export interface ReportConfig {
  report_type: ReportType;
  /** Sheet names to look for (Excel workbooks) */
  sheet_names: string[];
  extraction_type: ExtractionType;
  /** Column mapping: logical name -> column letter or index */
  columns: Record<string, string>;
  /** Optional section markers for "section" extraction */
  sections?: Record<string, SectionMarker>;
  /** Rules used to auto-detect this report type */
  detection_rules: DetectionRule[];
  book: BookType;
  currency: string; // ISO 4217
}

// ---- ReportLineItem ----

export interface ReportLineItem {
  account_name: string;
  account_number?: string;
  section: string;
  subsection?: string;
  /** Period label -> numeric value (null = missing) */
  values: Record<string, number | null>;
  /** Nesting depth (0 = top level) */
  depth: number;
  /** Whether this line is a subtotal / total row */
  is_total: boolean;
  /** Provenance information */
  source: {
    sheet: string;
    row: number;
    columns: Record<string, string>;
  };
}

// ---- Reporting period ----

export interface ReportingPeriod {
  start: string; // ISO date
  end: string; // ISO date
  label?: string;
}

// ---- ExtractedReport — output of report extraction ----

export interface ExtractedReport {
  report_type: ReportType;
  reporting_period: ReportingPeriod;
  currency: string;
  book: BookType;
  entity: string;
  /** Source worksheet name used to extract this report. */
  sheet_name?: string;
  department?: string;
  line_items: ReportLineItem[];
  derived_metrics?: Record<string, number>;
  /** Extraction confidence 0-1 */
  confidence: number;
}

// ---- ValidationResult ----

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isReportLineItem(value: unknown): value is ReportLineItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.account_name === "string" &&
    typeof v.section === "string" &&
    typeof v.values === "object" &&
    v.values !== null &&
    typeof v.depth === "number" &&
    typeof v.is_total === "boolean" &&
    typeof v.source === "object" &&
    v.source !== null
  );
}

export function isExtractedReport(value: unknown): value is ExtractedReport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isReportType(v.report_type) &&
    typeof v.reporting_period === "object" &&
    v.reporting_period !== null &&
    typeof v.currency === "string" &&
    isBookType(v.book) &&
    typeof v.entity === "string" &&
    Array.isArray(v.line_items) &&
    typeof v.confidence === "number"
  );
}

export function isReportConfig(value: unknown): value is ReportConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isReportType(v.report_type) &&
    Array.isArray(v.sheet_names) &&
    typeof v.extraction_type === "string" &&
    EXTRACTION_TYPES.includes(v.extraction_type as ExtractionType) &&
    typeof v.columns === "object" &&
    v.columns !== null &&
    Array.isArray(v.detection_rules) &&
    isBookType(v.book) &&
    typeof v.currency === "string"
  );
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

export function validateReportConfig(config: ReportConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // report_type
  if (!isReportType(config.report_type)) {
    errors.push(
      `Invalid report_type: "${config.report_type}". Must be one of: ${REPORT_TYPES.join(", ")}`,
    );
  }

  // sheet_names
  if (!Array.isArray(config.sheet_names) || config.sheet_names.length === 0) {
    errors.push("sheet_names must be a non-empty array");
  }

  // extraction_type
  if (!EXTRACTION_TYPES.includes(config.extraction_type)) {
    errors.push(
      `Invalid extraction_type: "${config.extraction_type}". Must be "section" or "tabular"`,
    );
  }

  // columns
  if (
    typeof config.columns !== "object" ||
    config.columns === null ||
    Object.keys(config.columns).length === 0
  ) {
    errors.push("columns must be a non-empty object mapping logical names to column references");
  }

  // detection_rules
  if (
    !Array.isArray(config.detection_rules) ||
    config.detection_rules.length === 0
  ) {
    errors.push("detection_rules must be a non-empty array");
  } else {
    for (let i = 0; i < config.detection_rules.length; i++) {
      const rule = config.detection_rules[i];
      if (!rule.field || typeof rule.field !== "string") {
        errors.push(`detection_rules[${i}].field must be a non-empty string`);
      }
      if (!rule.pattern || typeof rule.pattern !== "string") {
        errors.push(`detection_rules[${i}].pattern must be a non-empty string`);
      }
      if (rule.weight !== undefined && (rule.weight < 0 || rule.weight > 1)) {
        warnings.push(
          `detection_rules[${i}].weight (${rule.weight}) is outside 0-1 range`,
        );
      }
    }
  }

  // book
  if (!isBookType(config.book)) {
    errors.push(
      `Invalid book: "${config.book}". Must be one of: ${BOOK_TYPES.join(", ")}`,
    );
  }

  // currency (basic ISO 4217 check: 3 uppercase letters)
  if (typeof config.currency !== "string" || !/^[A-Z]{3}$/.test(config.currency)) {
    errors.push(
      `Invalid currency: "${config.currency}". Must be a 3-letter ISO 4217 code`,
    );
  }

  // sections validation (if present with section extraction type)
  if (config.extraction_type === "section" && !config.sections) {
    warnings.push(
      'extraction_type is "section" but no sections markers are defined',
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Financial invariant validators
// ---------------------------------------------------------------------------

const TOLERANCE = 0.01;

/**
 * Trial balance: sum(debits) == sum(credits) within tolerance.
 * Debit/credit columns identified by keys containing "debit"/"credit" (case-insensitive).
 */
export function validateTrialBalance(report: ExtractedReport): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (report.report_type !== "trial_balance") {
    warnings.push(
      `Expected report_type "trial_balance", got "${report.report_type}"`,
    );
  }

  const nonTotalItems = report.line_items.filter((li) => !li.is_total);

  if (nonTotalItems.length === 0) {
    errors.push("No non-total line items found to validate");
    return { valid: false, errors, warnings };
  }

  // Find debit and credit column keys
  const allKeys = new Set<string>();
  for (const li of nonTotalItems) {
    for (const key of Object.keys(li.values)) {
      allKeys.add(key);
    }
  }

  const debitKeys = [...allKeys].filter((k) => k.toLowerCase().includes("debit"));
  const creditKeys = [...allKeys].filter((k) => k.toLowerCase().includes("credit"));

  if (debitKeys.length === 0) {
    errors.push('No value columns containing "debit" found');
  }
  if (creditKeys.length === 0) {
    errors.push('No value columns containing "credit" found');
  }

  if (debitKeys.length === 0 || creditKeys.length === 0) {
    return { valid: false, errors, warnings };
  }

  let totalDebits = 0;
  let totalCredits = 0;

  for (const li of nonTotalItems) {
    for (const key of debitKeys) {
      const val = li.values[key];
      if (val !== null && val !== undefined) totalDebits += val;
    }
    for (const key of creditKeys) {
      const val = li.values[key];
      if (val !== null && val !== undefined) totalCredits += val;
    }
  }

  const diff = Math.abs(totalDebits - totalCredits);
  if (diff > TOLERANCE) {
    errors.push(
      `Trial balance does not balance: debits=${totalDebits.toFixed(2)}, credits=${totalCredits.toFixed(2)}, difference=${diff.toFixed(2)}`,
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Balance sheet: assets == liabilities + equity within tolerance.
 * Sections identified by names containing "assets", "liabilities", "equity" (case-insensitive).
 * Uses total line items within each section to get section totals.
 */
export function validateBalanceSheet(report: ExtractedReport): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (report.report_type !== "balance_sheet") {
    warnings.push(
      `Expected report_type "balance_sheet", got "${report.report_type}"`,
    );
  }

  const sumLineItemValues = (lineItem: ReportLineItem): number => {
    let sum = 0;
    for (const val of Object.values(lineItem.values)) {
      if (val !== null && val !== undefined) sum += val;
    }
    return sum;
  };

  // Real balance sheets often include multiple subtotal rows per category
  // (e.g. current assets, fixed assets, other assets). Prefer an explicit
  // grand total when available; otherwise sum the strongest total per section
  // to avoid double-counting nested subtotals.
  const sectionTotal = (
    keyword: string,
    grandTotalPatterns: RegExp[] = [],
  ): number | null => {
    const matchingItems = report.line_items.filter((li) =>
      li.section.toLowerCase().includes(keyword),
    );
    if (matchingItems.length === 0) return null;

    const totalRows = matchingItems.filter((li) => li.is_total);
    if (totalRows.length === 0) {
      return matchingItems
        .filter((li) => !li.is_total)
        .reduce((sum, li) => sum + sumLineItemValues(li), 0);
    }

    const grandTotals = totalRows.filter((li) =>
      grandTotalPatterns.some((pattern) => pattern.test(li.account_name)),
    );
    if (grandTotals.length > 0) {
      const [largestGrandTotal] = [...grandTotals].sort(
        (a, b) =>
          Math.abs(sumLineItemValues(b)) - Math.abs(sumLineItemValues(a)),
      );
      return sumLineItemValues(largestGrandTotal);
    }

    const totalsBySection = new Map<string, ReportLineItem[]>();
    for (const li of totalRows) {
      const section = li.section.toLowerCase();
      const existing = totalsBySection.get(section) ?? [];
      existing.push(li);
      totalsBySection.set(section, existing);
    }

    let sum = 0;
    for (const totals of totalsBySection.values()) {
      const [largestSectionTotal] = [...totals].sort(
        (a, b) =>
          Math.abs(sumLineItemValues(b)) - Math.abs(sumLineItemValues(a)),
      );
      sum += sumLineItemValues(largestSectionTotal);
    }
    return sum;
  };

  const assets = sectionTotal("asset", [/total\s+assets?/i]);
  const liabilities = sectionTotal("liabilit", [/total\s+liabilit(?:y|ies)\b/i]);
  const equity = sectionTotal("equity", [/total\s+(equity|shareholders?\s+equity)\b/i]);

  if (assets === null) {
    errors.push('No line items found in "assets" section');
  }
  if (liabilities === null) {
    errors.push('No line items found in "liabilities" section');
  }
  if (equity === null) {
    errors.push('No line items found in "equity" section');
  }

  if (assets !== null && liabilities !== null && equity !== null) {
    const diff = Math.abs(assets - (liabilities + equity));
    if (diff > TOLERANCE) {
      errors.push(
        `Balance sheet does not balance: assets=${assets.toFixed(2)}, liabilities+equity=${(liabilities + equity).toFixed(2)}, difference=${diff.toFixed(2)}`,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * P&L: Section totals should match sum of non-total line items in that section.
 * Tolerance of 0.01 per section.
 */
export function validatePnL(report: ExtractedReport): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (report.report_type !== "profit_and_loss") {
    warnings.push(
      `Expected report_type "profit_and_loss", got "${report.report_type}"`,
    );
  }

  // Group by section
  const sections = new Map<string, { items: ReportLineItem[]; totals: ReportLineItem[] }>();

  for (const li of report.line_items) {
    if (!sections.has(li.section)) {
      sections.set(li.section, { items: [], totals: [] });
    }
    const group = sections.get(li.section)!;
    if (li.is_total) {
      group.totals.push(li);
    } else {
      group.items.push(li);
    }
  }

  if (sections.size === 0) {
    errors.push("No line items found to validate");
    return { valid: false, errors, warnings };
  }

  for (const [sectionName, group] of sections) {
    if (group.totals.length === 0) {
      // No total row for this section, skip validation
      warnings.push(`Section "${sectionName}" has no total row; cannot validate`);
      continue;
    }

    if (group.items.length === 0) {
      warnings.push(
        `Section "${sectionName}" has a total row but no detail items`,
      );
      continue;
    }

    // Collect all value keys across items and totals
    const allKeys = new Set<string>();
    for (const li of [...group.items, ...group.totals]) {
      for (const key of Object.keys(li.values)) {
        allKeys.add(key);
      }
    }

    for (const key of allKeys) {
      // Sum non-total items
      let itemSum = 0;
      for (const li of group.items) {
        const val = li.values[key];
        if (val !== null && val !== undefined) itemSum += val;
      }

      // Sum total rows (usually just one)
      let totalSum = 0;
      for (const li of group.totals) {
        const val = li.values[key];
        if (val !== null && val !== undefined) totalSum += val;
      }

      const diff = Math.abs(itemSum - totalSum);
      if (diff > TOLERANCE) {
        errors.push(
          `Section "${sectionName}" column "${key}": items sum=${itemSum.toFixed(2)} != total=${totalSum.toFixed(2)}, difference=${diff.toFixed(2)}`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Dispatches validation by report_type.
 * For types without a specific validator, returns valid with a warning.
 */
export function validateReport(report: ExtractedReport): ValidationResult {
  switch (report.report_type) {
    case "trial_balance":
      return validateTrialBalance(report);
    case "balance_sheet":
      return validateBalanceSheet(report);
    case "profit_and_loss":
      return validatePnL(report);
    case "general_ledger":
    case "financial_statement":
      return {
        valid: true,
        errors: [],
        warnings: [
          `No specific invariant validator for report_type "${report.report_type}"`,
        ],
      };
    default: {
      // Exhaustive check
      const _exhaustive: never = report.report_type;
      return {
        valid: false,
        errors: [`Unknown report_type: "${_exhaustive}"`],
        warnings: [],
      };
    }
  }
}
