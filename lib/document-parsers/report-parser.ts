// ---------------------------------------------------------------------------
// Report Parser — orchestrator for structured financial report extraction
// ---------------------------------------------------------------------------
// Detects structured Excel reports (P&L, balance sheets, trial balances, etc.),
// resolves or generates extraction configs, runs the config-driven extractor,
// and validates financial invariants.
//
// Falls through to the CSV parser for flat transactional spreadsheets.
// ---------------------------------------------------------------------------

import * as XLSX from "xlsx";
import type {
  ParseDocumentSheetHint,
  ParseDocumentSourceContext,
  ParseResult,
} from "./format-router";
import type {
  ReportConfig,
  ExtractedReport,
  ReportLineItem,
  ReportingPeriod,
} from "./report-types";
import { validateReport } from "./report-types";
import {
  calculateDerivedMetrics,
  extractReport,
  extractSection,
} from "./config-driven-extractor";
import {
  isUnknownReportingPeriod,
  parsePeriodFromFileName,
  parsePeriodFromSourcePath,
} from "./period-utils";
import {
  computeFingerprint,
  findMatchingConfig,
  saveConfig,
  withConfigLock,
} from "./config-store";
import { generateReportConfig } from "./claude-config-generator";
import { canonicalFinanceBundleRequiresReview } from "./canonical-finance-staging";
import {
  estimateAnthropicUsageCostUsd,
  hasRecentLlmUsageEvent,
  recordLlmUsageEvent,
} from "@/lib/llm-usage-events";
import { extractCanonicalFinanceWorkbook } from "./canonical-finance-extractor";

// ── Heuristic detection ──────────────────────────────────────────────────

/**
 * Common column header patterns that indicate a flat transactional CSV/Excel
 * file (bank statements, transaction exports). Case-insensitive.
 */
const FLAT_TXN_PATTERNS = [
  /\bdate\b/i,
  /\bamount\b/i,
  /\bdescription\b/i,
  /\btransaction\b/i,
  /\bpayee\b/i,
  /\bmerchant\b/i,
  /\bbalance\b/i,
  /\breference\b/i,
  /\bdebit\b/i,
  /\bcredit\b/i,
];

/**
 * Minimum number of flat-txn header patterns that must match to classify
 * a single-sheet workbook as a flat transaction file (not a structured report).
 */
const FLAT_TXN_THRESHOLD = 2;
const LOW_CONFIDENCE_THRESHOLD = 0.7;
const REPORT_CONFIG_INITIAL_COOLDOWN_HOURS = Math.max(
  1,
  Number.parseInt(process.env.REPORT_CONFIG_INITIAL_COOLDOWN_HOURS ?? "24", 10) || 24,
);
const REPORT_CONFIG_RECOVERY_COOLDOWN_HOURS = Math.max(
  1,
  Number.parseInt(process.env.REPORT_CONFIG_RECOVERY_COOLDOWN_HOURS ?? "24", 10) || 24,
);

/**
 * Filename/sheet/header patterns that indicate a financial report workbook.
 * These take precedence over flat transaction heuristics for single-sheet files,
 * because trial balances and general ledgers often include Date/Debit/Credit columns.
 */
const REPORT_HINT_PATTERNS = [
  /\bp&l\b/i,
  /\bpnl\b/i,
  /profit\s*(?:&|and)?\s*loss/i,
  /income\s+statement/i,
  /balance\s+sheet/i,
  /^\s*bs(?:\b|[\s_-])/i,
  /trial\s+balance/i,
  /^\s*tb(?:\b|[\s_-])/i,
  /general\s+ledger/i,
  /^\s*gl(?:\b|[\s_-])/i,
  /statement\s+of\s+financial\s+position/i,
  /\baccount[-\s_]?no(?:\.|\.?|\b)/i,
  /\bcoa\b/i,
];

function hasReportHint(text: string): boolean {
  return REPORT_HINT_PATTERNS.some((pattern) => pattern.test(text));
}

function isGenericScopeSheetName(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  if (!normalized) return false;
  if (/^\d+$/.test(normalized)) return true;
  if (/^(sheet|chart|filter)s?\s*\d*$/i.test(normalized)) return true;

  return [
    /\bprofit\s*(and|&)?\s*loss\b/i,
    /\bp\s*&\s*l\b/i,
    /\bpnl\b/i,
    /\bbalance\s*sheet\b/i,
    /\btrial\s*balance\b/i,
    /\bcash\s*flow\b/i,
    /\bgeneral\s*ledger\b/i,
    /\bfixed\s*asset\b/i,
    /\bsummary\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function roleHintToSheetLabel(candidateRole: string | null | undefined): string | null {
  const normalized = String(candidateRole ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return null;

  if (normalized.includes("profit") || normalized.includes("pnl")) {
    return "P&L";
  }
  if (normalized.includes("balance_sheet") || normalized.includes("financial_position")) {
    return "Balance Sheet";
  }
  if (normalized.includes("trial_balance")) {
    return "Trial Balance";
  }
  if (normalized.includes("general_ledger") || normalized.includes("ledger")) {
    return "General Ledger";
  }
  if (normalized.includes("cash_flow")) {
    return "Cash Flow";
  }
  if (normalized.includes("financial_statement") || normalized.includes("primary_statement")) {
    return "Financial Statement";
  }

  return null;
}

function isFinancialSheetHint(hint: ParseDocumentSheetHint): boolean {
  if (roleHintToSheetLabel(hint.candidateRole)) {
    return true;
  }

  const title = hint.title?.trim();
  if (title && hasReportHint(title)) {
    return true;
  }

  const sheetName = hint.sheetName?.trim();
  if (sheetName && hasReportHint(sheetName)) {
    return true;
  }

  return false;
}

function resolveHintedSheetName(
  workbook: XLSX.WorkBook,
  hint: ParseDocumentSheetHint,
): string | null {
  const rawSheetName = hint.sheetName?.trim();
  if (rawSheetName && workbook.SheetNames.includes(rawSheetName)) {
    return rawSheetName;
  }

  const sheetOrdinal = hint.sheetOrdinal;
  if (typeof sheetOrdinal === "number" && Number.isInteger(sheetOrdinal) && sheetOrdinal > 0) {
    return workbook.SheetNames[sheetOrdinal - 1] ?? null;
  }

  return null;
}

function resolveSheetAlias(
  originalSheetName: string,
  hint?: ParseDocumentSheetHint,
): string {
  const original = originalSheetName.trim();
  if (original && !isGenericScopeSheetName(original)) {
    return original;
  }

  if (hasReportHint(originalSheetName)) return originalSheetName;

  const titled = hint?.title?.trim();
  if (titled && !isGenericScopeSheetName(titled)) {
    return titled;
  }
  if (titled && hasReportHint(titled)) {
    return titled;
  }

  return roleHintToSheetLabel(hint?.candidateRole) ?? originalSheetName;
}

function collectSheetTextSamples(
  sheet: XLSX.WorkSheet,
  maxRows = 8,
  maxCols = 30,
): string[] {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);

  const rowEnd = Math.min(range.e.r, range.s.r + maxRows);
  const colEnd = Math.min(range.e.c, range.s.c + maxCols);
  const samples: string[] = [];

  for (let r = range.s.r; r <= rowEnd; r++) {
    for (let c = range.s.c; c <= colEnd; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell || typeof cell.v !== "string") continue;
      const text = cell.v.trim();
      if (!text) continue;
      samples.push(text);
    }
  }

  return samples;
}

function selectCandidateSheets(
  workbook: XLSX.WorkBook,
  fileName: string,
  sheetHints: ParseDocumentSheetHint[] = [],
): string[] {
  const sheetNames = workbook.SheetNames;
  if (sheetNames.length <= 1) return sheetNames;

  const hintedSheets = sheetHints
    .filter((hint) => isFinancialSheetHint(hint))
    .map((hint) => resolveHintedSheetName(workbook, hint))
    .filter((name): name is string => Boolean(name));
  if (hintedSheets.length > 0) return Array.from(new Set(hintedSheets));

  const byName = sheetNames.filter((name) => hasReportHint(name));
  if (byName.length > 0) return byName;

  const byContent = sheetNames.filter((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return false;
    const samples = collectSheetTextSamples(sheet);
    return samples.some((text) => hasReportHint(text));
  });
  if (byContent.length > 0) return byContent;

  if (hasReportHint(fileName) && sheetNames.length <= 6) {
    return sheetNames;
  }

  if (sheetNames.length <= 4) {
    return sheetNames;
  }

  // Conservative fallback for very wide workbooks with no clear report hints.
  return [sheetNames[0]];
}

function createWorkbookForSheet(
  source: XLSX.WorkBook,
  sheetName: string,
  hint?: ParseDocumentSheetHint,
): XLSX.WorkBook | null {
  const sheet = source.Sheets[sheetName];
  if (!sheet) return null;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, resolveSheetAlias(sheetName, hint));

  if (source.Props) wb.Props = { ...source.Props };
  if (source.Custprops) wb.Custprops = { ...source.Custprops };
  return wb;
}

const UNKNOWN_REPORTING_PERIOD: ReportingPeriod = {
  start: "1970-01-01",
  end: "1970-01-01",
  label: "Unknown",
};

function resolvePeriodHint(
  fileName: string,
  sourceContext?: ParseDocumentSourceContext,
): ReportingPeriod | null {
  const filePeriod = parsePeriodFromFileName(fileName);
  if (filePeriod) return filePeriod as ReportingPeriod;

  const sourcePathPeriod = parsePeriodFromSourcePath(
    sourceContext?.sourcePath ?? "",
  );
  if (sourcePathPeriod) return sourcePathPeriod as ReportingPeriod;

  return null;
}

function normalizeCellText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function inferWorkbookCurrency(workbook: XLSX.WorkBook): string {
  const hints = [
    { pattern: /\b(idr|rupiah)\b|(?:^|[^a-z])rp\.?(?:[^a-z]|$)/i, code: "IDR" },
    { pattern: /\busd\b|\$/i, code: "USD" },
    { pattern: /\beur\b|€/i, code: "EUR" },
    { pattern: /\bsgd\b/i, code: "SGD" },
  ] as const;

  for (const sheetName of workbook.SheetNames.slice(0, 8)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: false,
    });

    for (const row of rows.slice(0, 40)) {
      for (const cell of row.slice(0, 12)) {
        if (cell == null) continue;
        const text = String(cell);
        for (const hint of hints) {
          if (hint.pattern.test(text)) {
            return hint.code;
          }
        }
      }
    }
  }

  return "USD";
}

function toKnownLayoutNumericValue(value: unknown): number | null {
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
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(/,/g, ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (commaCount > 0) {
    if (/,\d{1,2}$/.test(text)) {
      text = text.replace(/\./g, "").replace(/,/g, ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (dotCount > 1 && /^\d{1,3}(?:\.\d{3})+(?:\.\d+)?$/.test(text)) {
    text = text.replace(/\./g, "");
  } else if (dotCount === 1 && /^\d{1,3}\.\d{3}$/.test(text)) {
    text = text.replace(/\./g, "");
  }

  if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) {
    return null;
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function hasValues(item: ReportLineItem): boolean {
  return Object.values(item.values).some(
    (value) => value !== null && value !== undefined,
  );
}

function compactLabel(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

function compactSemanticLabel(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function buildKnownTrialBalanceConfig(
  sheetName: string,
  currency: string,
): ReportConfig {
  return {
    report_type: "trial_balance",
    sheet_names: [sheetName],
    extraction_type: "tabular",
    columns: {
      account_number: "A",
      account_name: "B",
      beginning_balance: "C",
      debit: "D",
      credit: "E",
      net_change: "F",
      ending_balance: "G",
      ytd_balance: "H",
    },
    detection_rules: [
      { field: "sheet_name", pattern: "Trial\\s+Balance|Output\\s+File", weight: 0.9 },
      { field: "header_row", pattern: "Account\\s+No|Description|Total\\s+Debit|Total\\s+Credit", weight: 1 },
    ],
    book: "actual",
    currency,
  };
}

function normalizeKnownTrialBalanceReports(
  reports: ExtractedReport[],
): ExtractedReport[] {
  return reports.map((report) => {
    const normalizedItems = report.line_items.map((item) => {
      const compactName = compactLabel(item.account_name);
      if (compactName === "subtotal" || compactName === "total") {
        return {
          ...item,
          is_total: true,
        };
      }
      return item;
    });

    const grandTotalIndex = normalizedItems.findIndex((item) => {
      const compactName = compactLabel(item.account_name);
      return compactName === "total" && item.is_total;
    });

    const trimmedItems =
      grandTotalIndex >= 0
        ? normalizedItems.slice(0, grandTotalIndex + 1)
        : normalizedItems.filter(
            (item) =>
              !/balance\s*-\s*profit\s*&?\s*loss\s*current\s*period/i.test(
                item.account_name,
              ),
          );

    const normalizedReport: ExtractedReport = {
      ...report,
      line_items: trimmedItems,
    };

    const validation = validateReport(normalizedReport);
    normalizedReport.confidence = validation.valid ? 0.9 : 0.5;
    return normalizedReport;
  });
}

function inferGenericBalanceSheetSection(item: ReportLineItem): string {
  const section = compactSemanticLabel(item.section ?? "");
  const subsection = compactSemanticLabel(item.subsection ?? "");
  const name = compactSemanticLabel(item.account_name);

  if (
    section.includes("liabilit") ||
    section.includes("equity") ||
    section === "bank"
  ) {
    return item.section;
  }

  if (
    name.includes("paidupcapital") ||
    name.includes("retainedearnings") ||
    name.includes("currentyearearnings") ||
    name.includes("netassets")
  ) {
    if (
      name.includes("retainedearnings") ||
      name.includes("currentyearearnings")
    ) {
      return "retained_earnings_equity";
    }
    return "capital_equity";
  }

  if (
    subsection.includes("noncurrentliabilit") ||
    subsection.includes("longtermliabilit")
  ) {
    return "long_term_liabilities";
  }
  if (subsection.includes("currentliabilit")) {
    return "current_liabilities";
  }
  if (subsection.includes("fixedasset")) {
    return "fixed_assets";
  }
  if (subsection.includes("noncurrentasset")) {
    return "other_assets";
  }

  if (
    name.includes("accountspayable") ||
    name.includes("othercurrentliab") ||
    name.includes("taxpayable") ||
    name.includes("loanvendor")
  ) {
    return "current_liabilities";
  }
  if (
    name.includes("loanfrom") ||
    name.includes("longtermliabilit") ||
    name.includes("noncurrentliabilit")
  ) {
    return "long_term_liabilities";
  }

  return item.section;
}

const KNOWN_HOSPITALITY_PNL_COLUMNS = {
  account_name: "D",
  actual: "E",
  actual_pct: "F",
  budget: "G",
  budget_pct: "H",
  variance: "I",
  variance_pct: "J",
  last_month: "K",
  last_month_pct: "L",
  ytd_actual: "P",
  ytd_actual_pct: "Q",
  ytd_budget: "R",
  ytd_budget_pct: "S",
  ytd_variance: "T",
  ytd_variance_pct: "U",
  ytd_last_year: "V",
  ytd_last_year_pct: "W",
} as const;

type KnownHospitalitySectionState = {
  section: string | null;
  subsection: string | null;
  afterGoi: boolean;
};

function isKnownHospitalityScopeSheetName(sheetName: string): boolean {
  const normalized = normalizeCellText(sheetName).replace(/&/g, "and");
  if (!normalized) return false;

  return ![
    "p&l",
    "p and l",
    "profit and loss",
    "income statement",
    "income statement consolidation",
    "income statement consilidation",
    "statement of income",
    "sheet1",
  ].includes(normalized);
}

function matchesKnownHospitalityPnLLayout(sheet: XLSX.WorkSheet): boolean {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });

  const hasTitle = rows.slice(0, 8).some((row) =>
    row.some((cell) => normalizeCellText(cell).includes("income statement")),
  );
  if (!hasTitle) return false;

  return rows.slice(0, 25).some((row) => {
    return (
      normalizeCellText(row[3]) === "description" &&
      normalizeCellText(row[4]) === "actual" &&
      normalizeCellText(row[6]) === "budget" &&
      normalizeCellText(row[10]) === "last month" &&
      normalizeCellText(row[15]) === "ytd actual" &&
      normalizeCellText(row[21]) === "ytd last year"
    );
  });
}

function resolveKnownHospitalitySectionHeader(
  label: string,
  state: KnownHospitalitySectionState,
): { section: string; subsection: string | null } | null {
  const normalized = normalizeCellText(label).replace(/&/g, "and");

  if (normalized === "statistic") {
    return { section: "statistics", subsection: null };
  }
  if (normalized === "revenue") {
    return { section: "revenue", subsection: null };
  }
  if (normalized === "cost of sales") {
    return { section: "cost_of_sales", subsection: null };
  }
  if (normalized === "payroll and related expenses") {
    return { section: "operating_expenses", subsection: "payroll_related_expenses" };
  }
  if (normalized === "other expenses") {
    return state.afterGoi
      ? { section: "other_income_expense", subsection: "other_expenses" }
      : { section: "operating_expenses", subsection: "other_expenses" };
  }

  return null;
}

function resolveKnownHospitalitySpecialLine(
  label: string,
): { section: string; markAfterGoi?: boolean } | null {
  const normalized = normalizeCellText(label);

  if (normalized === "gross operating income") {
    return { section: "gross_operating_income", markAfterGoi: true };
  }
  if (
    normalized === "nett owner share profit" ||
    normalized === "net owner share profit" ||
    normalized === "net income" ||
    normalized === "net profit" ||
    normalized === "net loss"
  ) {
    return { section: "net_income" };
  }

  return null;
}

function isKnownHospitalitySubtotal(
  label: string,
  section: string,
  subsection: string | null,
): boolean {
  const normalized = normalizeCellText(label).replace(/&/g, "and");
  if (!normalized.includes("total")) return false;

  if (
    section === "operating_expenses" &&
    subsection === "payroll_related_expenses" &&
    normalized.includes("payroll and related expenses")
  ) {
    return false;
  }

  return true;
}

function extractKnownHospitalityPnL(
  workbook: XLSX.WorkBook,
  fileName: string,
  sourceContext?: ParseDocumentSourceContext,
): ExtractedReport | null {
  if (workbook.SheetNames.length !== 1) return null;

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return null;
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !matchesKnownHospitalityPnLLayout(sheet)) return null;

  const rangeRef = sheet["!ref"];
  if (!rangeRef) return null;
  const range = XLSX.utils.decode_range(rangeRef);

  const headerCols = {
    account: XLSX.utils.decode_col(KNOWN_HOSPITALITY_PNL_COLUMNS.account_name),
    actual: XLSX.utils.decode_col(KNOWN_HOSPITALITY_PNL_COLUMNS.actual),
    budget: XLSX.utils.decode_col(KNOWN_HOSPITALITY_PNL_COLUMNS.budget),
    lastMonth: XLSX.utils.decode_col(KNOWN_HOSPITALITY_PNL_COLUMNS.last_month),
    ytdActual: XLSX.utils.decode_col(KNOWN_HOSPITALITY_PNL_COLUMNS.ytd_actual),
    ytdLastYear: XLSX.utils.decode_col(KNOWN_HOSPITALITY_PNL_COLUMNS.ytd_last_year),
  };

  let headerRowIndex = -1;
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 40); r += 1) {
    const description = normalizeCellText(
      sheet[XLSX.utils.encode_cell({ r, c: headerCols.account })]?.v,
    );
    const actual = normalizeCellText(
      sheet[XLSX.utils.encode_cell({ r, c: headerCols.actual })]?.v,
    );
    const budget = normalizeCellText(
      sheet[XLSX.utils.encode_cell({ r, c: headerCols.budget })]?.v,
    );
    const lastMonth = normalizeCellText(
      sheet[XLSX.utils.encode_cell({ r, c: headerCols.lastMonth })]?.v,
    );
    const ytdActual = normalizeCellText(
      sheet[XLSX.utils.encode_cell({ r, c: headerCols.ytdActual })]?.v,
    );
    const ytdLastYear = normalizeCellText(
      sheet[XLSX.utils.encode_cell({ r, c: headerCols.ytdLastYear })]?.v,
    );

    if (
      description === "description" &&
      actual === "actual" &&
      budget === "budget" &&
      lastMonth === "last month" &&
      ytdActual === "ytd actual" &&
      ytdLastYear === "ytd last year"
    ) {
      headerRowIndex = r;
      break;
    }
  }

  if (headerRowIndex < 0) return null;

  const valueColumns = Object.entries(KNOWN_HOSPITALITY_PNL_COLUMNS).filter(
    ([key]) => key !== "account_name",
  );

  const lineItems: ReportLineItem[] = [];
  const sectionState: KnownHospitalitySectionState = {
    section: null,
    subsection: null,
    afterGoi: false,
  };

  for (let r = headerRowIndex + 1; r <= range.e.r; r += 1) {
    const labelCell = sheet[XLSX.utils.encode_cell({ r, c: headerCols.account })];
    const rawLabel = labelCell?.v;
    const label = String(rawLabel ?? "").trim();
    if (!label || normalizeCellText(label) === "description") continue;

    const values: Record<string, number | null> = {};
    const columnRefs: Record<string, string> = {
      account_name: XLSX.utils.encode_cell({ r, c: headerCols.account }),
    };
    let hasNumericValue = false;

    for (const [key, column] of valueColumns) {
      const columnIndex = XLSX.utils.decode_col(column);
      const ref = XLSX.utils.encode_cell({ r, c: columnIndex });
      const parsedValue = toKnownLayoutNumericValue(sheet[ref]?.v);
      values[key] = parsedValue;
      columnRefs[key] = ref;
      if (parsedValue !== null) {
        hasNumericValue = true;
      }
    }

    const sectionHeader = resolveKnownHospitalitySectionHeader(label, sectionState);
    if (!hasNumericValue && sectionHeader) {
      sectionState.section = sectionHeader.section;
      sectionState.subsection = sectionHeader.subsection;
      continue;
    }

    if (!hasNumericValue) {
      if (sectionState.section && sectionState.section !== "statistics") {
        sectionState.subsection = label;
      }
      continue;
    }

    const specialLine = resolveKnownHospitalitySpecialLine(label);
    if (specialLine?.markAfterGoi) {
      sectionState.afterGoi = true;
    }

    const section = specialLine?.section ?? sectionState.section;
    if (!section) continue;

    const isTotal =
      specialLine !== null ||
      isKnownHospitalitySubtotal(label, section, sectionState.subsection);

    if (!isTotal && /\btotal\b/i.test(label)) {
      continue;
    }

    lineItems.push({
      account_name: label,
      section,
      ...(sectionState.subsection ? { subsection: sectionState.subsection } : {}),
      values,
      depth: 0,
      is_total: isTotal,
      source: {
        sheet: sheetName,
        row: r,
        columns: columnRefs,
      },
    });
  }

  if (lineItems.length === 0) return null;

  const entityCandidate = String(workbook.Props?.Company ?? "").trim();
  const resolvedEntity = isKnownHospitalityScopeSheetName(sheetName)
    ? sheetName
    : entityCandidate && normalizeCellText(entityCandidate) !== "unknown"
      ? entityCandidate
      : "Unknown";
  const report: ExtractedReport = {
    report_type: "profit_and_loss",
    reporting_period:
      resolvePeriodHint(fileName.split("#")[0], sourceContext) ??
      UNKNOWN_REPORTING_PERIOD,
    currency: inferWorkbookCurrency(workbook),
    book: "actual",
    entity: resolvedEntity,
    sheet_name: sheetName,
    line_items: lineItems,
    derived_metrics: calculateDerivedMetrics(lineItems, "profit_and_loss"),
    confidence: 0.9,
  };

  const validation = validateReport(report);
  report.confidence = validation.valid ? 0.9 : 0.72;
  return report;
}

export function normalizeGenericBalanceSheetReports(
  reports: ExtractedReport[],
): ExtractedReport[] {
  return reports.map((report) => {
    if (report.report_type !== "balance_sheet") {
      return report;
    }

    const normalizedItems = report.line_items.map((item) => {
      const nextSection = inferGenericBalanceSheetSection(item);
      const compactName = compactLabel(item.account_name);
      return {
        ...item,
        section: nextSection,
        is_total: item.is_total || compactName === "netassets",
      };
    });

    const normalizedReport: ExtractedReport = {
      ...report,
      line_items: normalizedItems,
    };

    const validation = validateReport(normalizedReport);
    normalizedReport.confidence = validation.valid ? 0.9 : 0.5;
    return normalizedReport;
  });
}

function matchesKnownTrialBalanceLayout(sheet: XLSX.WorkSheet): boolean {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });

  const headerRows = rows.slice(0, 3);
  return headerRows.some((row) => {
    const cells = row.map(normalizeCellText);
    return (
      cells[0] === "account no" &&
      cells[1] === "description" &&
      cells[3] === "total debit" &&
      cells[4] === "total credit"
    );
  });
}

function matchesKnownDualSideBalanceSheetLayout(sheet: XLSX.WorkSheet): boolean {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });

  return rows.slice(0, 8).some((row) => {
    const leftHeader = normalizeCellText(row[1]);
    const leftCurrent = normalizeCellText(row[3]);
    const leftPrior = normalizeCellText(row[4]);
    const rightHeader = normalizeCellText(row[6]);
    const rightCurrent = normalizeCellText(row[8]);
    const rightPrior = normalizeCellText(row[9]);
    return (
      leftHeader === "assets" &&
      leftCurrent === "this month" &&
      leftPrior === "last month" &&
      rightHeader.includes("liabilities") &&
      rightCurrent === "this month" &&
      rightPrior === "last month"
    );
  });
}

function normalizeKnownBalanceSheetItems(
  items: ReportLineItem[],
): ReportLineItem[] {
  return items
    .map((item) => {
      if (/book\s+value/i.test(item.account_name)) {
        return {
          ...item,
          is_total: true,
        };
      }
      return item;
    })
    .filter((item) => item.is_total || hasValues(item));
}

function extractKnownDualSideBalanceSheet(
  workbook: XLSX.WorkBook,
  fileName: string,
  sourceContext?: ParseDocumentSourceContext,
): ExtractedReport | null {
  const sheetName = workbook.SheetNames.find((name) => {
    const sheet = workbook.Sheets[name];
    return sheet ? matchesKnownDualSideBalanceSheetLayout(sheet) : false;
  });
  if (!sheetName) return null;

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;

  const assetItems = extractSection(
    sheet,
    {
      account_name: "B",
      current_period: "D",
      prior_period: "E",
    },
    {
      current_assets: {
        start: "^\\s*1\\.\\s*CURRENT\\s+ASSETS\\b",
        end: "^\\s*TOTAL\\s+CURRENT\\s+ASSETS\\b",
      },
      affiliated_assets: {
        start: "^\\s*2\\.\\s*AFFILIATED\\s+COMPANIES\\s+RECEIVABLE\\b",
        end: "^\\s*TOTAL\\s+AFFILIATED\\s+COMPANIES\\s+RECEIVABLE\\b",
      },
      fixed_assets: {
        start: "^\\s*3\\.\\s*FIXED\\s+ASSETS\\b",
        end: "^\\s*BOOK\\s+VALUE\\b",
      },
      fixed_assets_leasing: {
        start: "^\\s*4\\.\\s*FIXED\\s+ASSETS\\s+LEASING\\b",
        end: "^\\s*BOOK\\s+VALUE\\b",
      },
      other_assets: {
        start: "^\\s*5\\.\\s*OTHER\\s+ASSETS\\b",
        end: "^\\s*TOTAL\\s+OTHER\\s+ASSETS\\b",
      },
    },
    sheetName,
  );

  const liabilityItems = extractSection(
    sheet,
    {
      account_name: "G",
      current_period: "I",
      prior_period: "J",
    },
    {
      current_liabilities: {
        start: "^\\s*6\\.\\s*CURRENT\\s+LIABILITIES\\b",
        end: "^\\s*TOTAL\\s+CURRENT\\s+LIABILITIES\\b",
      },
      other_liabilities: {
        start: "^\\s*7\\.\\s*OTHER\\s+LIABILITIES\\b",
        end: "^\\s*TOTAL\\s+OTHER\\s+LIABILITIES\\b",
      },
      affiliated_liabilities: {
        start: "^\\s*8\\.\\s*AFFILIATED\\s+COMPANIES\\s+PAYABLE\\b",
        end: "^\\s*TOTAL\\s+AFFILIATED\\s+COMPANIES\\s+PAYABLE\\b",
      },
      long_term_liabilities: {
        start: "^\\s*9\\.\\s*LONG\\s+TERM\\s+LIABILITIES\\b",
        end: "^\\s*TOTAL\\s+LONG\\s+TERM\\s+LIABILITIES\\b",
      },
      capital_equity: {
        start: "^\\s*10\\.\\s*CAPITAL\\s+OWNING\\s+COMPANY\\b",
        end: "^\\s*TOTAL\\s+CAPITAL\\s+OWNING\\s+COMPANY\\b",
      },
      retained_earnings_equity: {
        start: "^\\s*11\\.\\s*RETAINED\\s+EARNING\\b",
        end: "^\\s*TOTAL\\s+RETAINED\\s+EARNING\\b",
      },
    },
    sheetName,
  );

  const lineItems = normalizeKnownBalanceSheetItems([
    ...assetItems,
    ...liabilityItems,
  ]);
  if (lineItems.length === 0) return null;

  const report: ExtractedReport = {
    report_type: "balance_sheet",
    reporting_period:
      resolvePeriodHint(fileName.split("#")[0], sourceContext) ??
      UNKNOWN_REPORTING_PERIOD,
    currency: inferWorkbookCurrency(workbook),
    book: "actual",
    entity: workbook.Props?.Company ?? "Unknown",
    sheet_name: sheetName,
    line_items: lineItems,
    derived_metrics: calculateDerivedMetrics(lineItems, "balance_sheet"),
    confidence: 0.9,
  };

  const validation = validateReport(report);
  report.confidence = validation.valid ? 0.9 : 0.5;
  return report;
}

function tryExtractKnownLayout(
  workbook: XLSX.WorkBook,
  fileName: string,
  sourceContext?: ParseDocumentSourceContext,
): { reports: ExtractedReport[]; reportType: ReportConfig["report_type"] } | null {
  if (workbook.SheetNames.length === 1) {
    const hospitalityPnL = extractKnownHospitalityPnL(
      workbook,
      fileName,
      sourceContext,
    );
    if (hospitalityPnL) {
      return {
        reports: [hospitalityPnL],
        reportType: "profit_and_loss",
      };
    }
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    if (matchesKnownTrialBalanceLayout(sheet)) {
      const config = buildKnownTrialBalanceConfig(
        sheetName,
        inferWorkbookCurrency(workbook),
      );
      const reports = normalizeKnownTrialBalanceReports(
        extractReport(workbook, config),
      );
      if (reports.length > 0) {
        return {
          reports,
          reportType: "trial_balance",
        };
      }
    }
  }

  const balanceSheetReport = extractKnownDualSideBalanceSheet(
    workbook,
    fileName,
    sourceContext,
  );
  if (balanceSheetReport) {
    return {
      reports: [balanceSheetReport],
      reportType: "balance_sheet",
    };
  }

  return null;
}

interface ConfigResolution {
  config: ReportConfig | null;
  cacheHit: boolean;
  initialCooldown: boolean;
  fingerprint: string | null;
}

interface ExtractionAssessment {
  config: ReportConfig;
  reports: ExtractedReport[];
  reportType: ReportConfig["report_type"];
  avgConfidence: number;
  invalidCount: number;
  lowConfidenceCount: number;
  totalLineItems: number;
}

function assessExtraction(
  config: ReportConfig,
  reports: ExtractedReport[],
): ExtractionAssessment {
  let invalidCount = 0;
  let lowConfidenceCount = 0;
  let totalLineItems = 0;

  for (const report of reports) {
    const validation = validateReport(report);
    if (!validation.valid) {
      invalidCount++;
    }
    if (report.confidence < LOW_CONFIDENCE_THRESHOLD) {
      lowConfidenceCount++;
    }
    totalLineItems += report.line_items.length;
  }

  const avgConfidence =
    reports.length > 0
      ? reports.reduce((sum, report) => sum + report.confidence, 0) /
        reports.length
      : 0;

  return {
    config,
    reports,
    reportType: config.report_type,
    avgConfidence,
    invalidCount,
    lowConfidenceCount,
    totalLineItems,
  };
}

function shouldRunRecoveryPass(assessment: ExtractionAssessment): boolean {
  if (assessment.reports.length === 0) {
    return true;
  }

  const strictReviewMode = assessment.reports.length <= 3;
  if (strictReviewMode) {
    return (
      assessment.invalidCount > 0 || assessment.lowConfidenceCount > 0
    );
  }

  return assessment.lowConfidenceCount === assessment.reports.length;
}

function buildRecoveryFeedback(
  fileName: string,
  assessment: ExtractionAssessment,
): string {
  const reportSummary =
    assessment.reports.length > 0
      ? assessment.reports
          .map((report) => {
            const sheet = report.sheet_name ?? "workbook";
            return `${sheet}:${report.report_type}:confidence=${report.confidence.toFixed(2)}:line_items=${report.line_items.length}`;
          })
          .join("; ")
      : "no reports extracted";

  return [
    `Recovery pass for workbook "${fileName}".`,
    `Previous config: ${JSON.stringify(assessment.config)}`,
    `Previous extraction summary: reports=${assessment.reports.length}, avg_confidence=${assessment.avgConfidence.toFixed(2)}, invalid_reports=${assessment.invalidCount}, low_confidence_reports=${assessment.lowConfidenceCount}, total_line_items=${assessment.totalLineItems}.`,
    `Per-report summary: ${reportSummary}.`,
    "Please regenerate a more robust ReportConfig.",
    "Re-evaluate sheet_names, columns, extraction_type, section markers, book, and currency.",
    "Prefer capturing all financial rows over overly narrow section boundaries.",
  ].join("\n");
}

function scoreAssessment(assessment: ExtractionAssessment): number {
  const validReports = assessment.reports.length - assessment.invalidCount;
  return (
    validReports * 1_000_000 +
    assessment.reports.length * 100_000 +
    assessment.totalLineItems * 100 +
    Math.round(assessment.avgConfidence * 1_000) -
    assessment.lowConfidenceCount * 1_000
  );
}

function isBetterAssessment(
  candidate: ExtractionAssessment,
  baseline: ExtractionAssessment,
): boolean {
  return scoreAssessment(candidate) > scoreAssessment(baseline);
}

async function isReportConfigRecoveryCoolingDown(input: {
  companyId: string;
  fileName: string;
}): Promise<boolean> {
  return hasRecentLlmUsageEvent({
    companyId: input.companyId,
    provider: "anthropic",
    subsystem: "report_config_generation",
    operation: "recovery_feedback_generation",
    referenceType: "report_config_recovery",
    referenceId: `${input.companyId}:${input.fileName}`,
    since: new Date(Date.now() - REPORT_CONFIG_RECOVERY_COOLDOWN_HOURS * 60 * 60 * 1000),
  });
}

async function isReportConfigInitialGenerationCoolingDown(input: {
  companyId: string;
  fingerprint: string;
}): Promise<boolean> {
  return hasRecentLlmUsageEvent({
    companyId: input.companyId,
    provider: "anthropic",
    subsystem: "report_config_generation",
    operation: "initial_generation",
    referenceType: "report_config",
    referenceId: `${input.companyId}:${input.fingerprint}:initial`,
    since: new Date(Date.now() - REPORT_CONFIG_INITIAL_COOLDOWN_HOURS * 60 * 60 * 1000),
  });
}

async function resolveConfig(
  workbook: XLSX.WorkBook,
  companyId: string,
  fileName: string,
): Promise<ConfigResolution> {
  const cached = await findMatchingConfig(companyId, workbook);
  if (cached) {
    return { config: cached, cacheHit: true, initialCooldown: false, fingerprint: null };
  }

  const fingerprint = computeFingerprint(workbook);
  return withConfigLock(companyId, fingerprint, async () => {
    const existing = await findMatchingConfig(companyId, workbook);
    if (existing) {
      return { config: existing, cacheHit: true, initialCooldown: false, fingerprint };
    }

    const initialCoolingDown = await isReportConfigInitialGenerationCoolingDown({
      companyId,
      fingerprint,
    }).catch((error) => {
      console.warn(
        `[report-parser] failed to check initial config generation cooldown for ${fileName}:`,
        error,
      );
      return false;
    });

    if (initialCoolingDown) {
      console.warn(
        `[report-parser] skipping initial config generation for ${fileName}; fingerprint cooldown active for ${REPORT_CONFIG_INITIAL_COOLDOWN_HOURS}h`,
      );
      return {
        config: null,
        cacheHit: false,
        initialCooldown: true,
        fingerprint,
      };
    }

    const generated = await generateReportConfig(workbook, {
      onUsage: async (usage, phase) => {
        try {
          const normalizedUsage = {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            reasoningTokens: 0,
          };
          await recordLlmUsageEvent({
            companyId,
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            subsystem: "report_config_generation",
            operation: phase === "retry" ? "recovery_retry" : "initial_generation",
            executor: "report_parser",
            billingMode: "api",
            usage: normalizedUsage,
            estimatedCostUsd: estimateAnthropicUsageCostUsd({
              model: "claude-sonnet-4-6",
              usage: normalizedUsage,
            }),
            referenceType: "report_config",
            referenceId: `${companyId}:${fingerprint}:${phase}`,
            metadata: {
              fileName,
              fingerprint,
            },
          });
        } catch (error) {
          console.warn("[report-parser] failed to record LLM usage event", error);
        }
      },
    });
    return {
      config: generated,
      cacheHit: false,
      initialCooldown: false,
      fingerprint,
    };
  });
}

async function resolveConfigAndExtract(
  workbook: XLSX.WorkBook,
  fileName: string,
  companyId: string,
  sourceContext?: ParseDocumentSourceContext,
): Promise<{ reports: ExtractedReport[]; reportType: ReportConfig["report_type"] }> {
  const knownLayout = tryExtractKnownLayout(workbook, fileName, sourceContext);
  if (knownLayout) {
    return knownLayout;
  }

  const resolved = await resolveConfig(workbook, companyId, fileName);
  if (!resolved.config) {
    if (resolved.initialCooldown) {
      return {
        reports: [],
        reportType: "financial_statement",
      };
    }
    throw new Error(`No report config available for ${fileName}`);
  }
  const baseline = assessExtraction(
    resolved.config,
    extractReport(workbook, resolved.config),
  );

  let finalAssessment = baseline;
  let shouldPersist = !resolved.cacheHit && baseline.reports.length > 0;

  if (shouldRunRecoveryPass(baseline)) {
    const recoveryCoolingDown = await isReportConfigRecoveryCoolingDown({
      companyId,
      fileName,
    }).catch((error) => {
      console.warn(
        `[report-parser] failed to check recovery cooldown for ${fileName}:`,
        error,
      );
      return false;
    });

    if (recoveryCoolingDown) {
      console.warn(
        `[report-parser] skipping recovery config generation for ${fileName}; cooldown active for ${REPORT_CONFIG_RECOVERY_COOLDOWN_HOURS}h`,
      );
    }

    if (!recoveryCoolingDown) {
      try {
        const regenerated = await generateReportConfig(workbook, {
          feedback: buildRecoveryFeedback(fileName, baseline),
          onUsage: async (usage) => {
            try {
              const normalizedUsage = {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                reasoningTokens: 0,
              };
              await recordLlmUsageEvent({
                companyId,
                provider: "anthropic",
                model: "claude-sonnet-4-6",
                subsystem: "report_config_generation",
                operation: "recovery_feedback_generation",
                executor: "report_parser",
                billingMode: "api",
                usage: normalizedUsage,
                estimatedCostUsd: estimateAnthropicUsageCostUsd({
                  model: "claude-sonnet-4-6",
                  usage: normalizedUsage,
                }),
                referenceType: "report_config_recovery",
                referenceId: `${companyId}:${fileName}`,
                metadata: {
                  fileName,
                  recovery: true,
                },
              });
            } catch (error) {
              console.warn("[report-parser] failed to record recovery LLM usage event", error);
            }
          },
        });
        const recovery = assessExtraction(
          regenerated,
          extractReport(workbook, regenerated),
        );

        if (isBetterAssessment(recovery, baseline)) {
          finalAssessment = recovery;
          shouldPersist = recovery.reports.length > 0;
        }
      } catch (error) {
        console.warn(
          `[report-parser] recovery config generation failed for ${fileName}:`,
          error,
        );
      }
    }
  }

  if (shouldPersist) {
    await saveConfig(
      companyId,
      `${finalAssessment.config.report_type} — ${fileName}`,
      finalAssessment.config.report_type,
      finalAssessment.config,
      workbook,
    );
  }

  return {
    reports: finalAssessment.reports,
    reportType: finalAssessment.reportType,
  };
}

/**
 * Determine whether a workbook looks like a structured financial report
 * (multi-sheet or non-transactional layout) vs a flat transaction file.
 *
 * Returns `true` if the workbook should be processed by the report pipeline.
 * Returns `false` if it looks like a flat CSV/transaction export.
 *
 * Heuristic:
 * - Multiple sheets → likely structured report
 * - Single sheet with date+amount+description columns → flat CSV
 * - Single sheet without flat CSV pattern → possibly a report
 */
export function isStructuredReport(workbook: XLSX.WorkBook): boolean {
  // Multiple sheets → structured report
  if (workbook.SheetNames.length > 1) {
    return true;
  }

  // Single sheet — check first sheet for flat transaction patterns
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return false;

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return false;

  const ref = sheet["!ref"];
  if (!ref) return false;

  const range = XLSX.utils.decode_range(ref);

  // Scan the first 5 rows for header-like strings
  const maxScan = Math.min(range.s.r + 5, range.e.r);
  let flatPatternMatches = 0;
  const cellSamples: string[] = [];

  for (let r = range.s.r; r <= maxScan; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell || typeof cell.v !== "string") continue;

      const cellText = cell.v;
      cellSamples.push(cellText);
      for (const pattern of FLAT_TXN_PATTERNS) {
        if (pattern.test(cellText)) {
          flatPatternMatches++;
        }
      }
    }
  }

  // Some financial reports are single-sheet and contain Date/Debit/Credit columns
  // (e.g. trial balances, general ledgers). Recognize those as structured reports
  // before applying flat transaction fallback.
  if (hasReportHint(sheetName) || cellSamples.some(hasReportHint)) {
    return true;
  }

  // If enough flat-txn patterns match, this is a flat CSV — not a structured report
  if (flatPatternMatches >= FLAT_TXN_THRESHOLD) {
    return false;
  }

  // Single sheet, no flat CSV pattern → treat as potential structured report
  return true;
}

// ── Orchestrator ─────────────────────────────────────────────────────────

/**
 * Parse a structured financial report from an Excel buffer.
 *
 * Returns `null` if the workbook is not a structured report (caller should
 * fall through to the CSV parser).
 *
 * Flow:
 * 1. Read workbook
 * 2. `isStructuredReport()` heuristic — return null if flat
 * 3. Try `findMatchingConfig()` (cached config)
 * 4. If no config → lock, re-check, generate via Claude, save
 * 5. `extractReport()` with config
 * 6. `validateReport()` on each report — flag needsReview if any fail
 * 7. Build ParseResult with reports[] (no transactions — GL snapshots only)
 */
export async function parseStructuredReport(
  buffer: Buffer,
  fileName: string,
  companyId: string,
  sourceContext?: ParseDocumentSourceContext,
  sheetHints: ParseDocumentSheetHint[] = [],
  clarificationAnswers?: Record<string, string>,
): Promise<ParseResult | null> {
  // Step 1: Read workbook
  const workbook = XLSX.read(buffer, { type: "buffer" });

  // Step 2: Heuristic detection
  if (!isStructuredReport(workbook)) {
    return null;
  }

  let reports: ExtractedReport[] = [];
  const reportTypes = new Set<ReportConfig["report_type"]>();

  const knownWorkbookLayout = tryExtractKnownLayout(
    workbook,
    fileName,
    sourceContext,
  );
  if (knownWorkbookLayout) {
    reports = knownWorkbookLayout.reports;
    reportTypes.add(knownWorkbookLayout.reportType);
  } else if (workbook.SheetNames.length > 1) {
    const candidateSheets = selectCandidateSheets(workbook, fileName, sheetHints);
    const hintBySheetName = new Map(
      sheetHints
        .filter((hint) => isFinancialSheetHint(hint))
        .map((hint) => [resolveHintedSheetName(workbook, hint), hint] as const)
        .filter((entry): entry is readonly [string, ParseDocumentSheetHint] => Boolean(entry[0])),
    );

    for (const sheetName of candidateSheets) {
      const sheetHint = hintBySheetName.get(sheetName);
      const singleSheetWorkbook = createWorkbookForSheet(workbook, sheetName, sheetHint);
      if (!singleSheetWorkbook) continue;

      try {
        const result = await resolveConfigAndExtract(
          singleSheetWorkbook,
          `${fileName}#${resolveSheetAlias(sheetName, sheetHint)}`,
          companyId,
          sourceContext,
        );
        if (result.reports.length === 0) continue;
        reports.push(...result.reports);
        reportTypes.add(result.reportType);
      } catch (error) {
        console.warn(
          `[report-parser] per-sheet extraction failed for ${fileName}#${resolveSheetAlias(sheetName, sheetHint)}:`,
          error,
        );
      }
    }
  }

  // Fallback to whole-workbook extraction if per-sheet pass returned nothing.
  if (reports.length === 0) {
    const result = await resolveConfigAndExtract(
      workbook,
      fileName,
      companyId,
      sourceContext,
    );
    reports = result.reports;
    reportTypes.add(result.reportType);
  }

  // If extraction could not infer a valid period from headers, fall back to filename hints.
  const filePeriod = resolvePeriodHint(fileName, sourceContext);
  if (filePeriod) {
    reports = reports.map((report) => {
      if (!isUnknownReportingPeriod(report.reporting_period)) {
        return report;
      }
      return {
        ...report,
        reporting_period: filePeriod,
      };
    });
  }

  reports = normalizeGenericBalanceSheetReports(reports);

  // Step 6: Validate each report
  // For broad multi-sheet workbooks, require review only when confidence is
  // low across the entire extraction set. This avoids false positives where a
  // subset of sheets are structurally noisy but others are parsed well.
  let needsReview = false;
  let invalidCount = 0;
  let lowConfidenceCount = 0;
  for (const report of reports) {
    const result = validateReport(report);
    if (!result.valid) {
      invalidCount++;
    }
    if (report.confidence < 0.7) {
      lowConfidenceCount++;
    }
  }

  // If no reports were extracted at all, something went wrong — flag for review
  if (reports.length === 0) {
    needsReview = true;
  } else {
    const strictReviewMode = reports.length <= 3;
    if (strictReviewMode) {
      if (invalidCount > 0 || lowConfidenceCount > 0) {
        needsReview = true;
      }
    } else if (lowConfidenceCount === reports.length) {
      needsReview = true;
    }
  }

  // Step 7: Build ParseResult
  // GL/report extraction produces snapshots only — no transactions[]
  // to avoid double-counting with bank statement imports
  const avgConfidence =
    reports.length > 0
      ? reports.reduce((sum, r) => sum + r.confidence, 0) / reports.length
      : 0;
  const canonicalFinance = extractCanonicalFinanceWorkbook(workbook, {
    fileName,
    sourceContext,
    reports,
    clarificationAnswers,
  });
  const canonicalFinanceNeedsReview =
    canonicalFinance.clarification_questions.length > 0 ||
    canonicalFinanceBundleRequiresReview(canonicalFinance);

  return {
    transactions: [],
    confidence: avgConfidence,
    reports,
    canonicalFinance,
    documentType:
      reportTypes.size <= 1
        ? Array.from(reportTypes)[0]
        : "financial_statement",
    needsReview: needsReview || canonicalFinanceNeedsReview,
  };
}
