import * as XLSX from "xlsx";
import type { ParseDocumentSourceContext } from "./format-router";
import {
  isUnknownReportingPeriod,
  normalizeReportingPeriodKey,
  parsePeriodFromFileName,
  parsePeriodFromSourcePath,
  type ReportingPeriodLike,
} from "./period-utils";
import type { ExtractedReport, ReportLineItem } from "./report-types";
import type {
  CanonicalBalanceSheetMonth,
  CanonicalFinanceClarificationKey,
  CanonicalFinanceClarificationQuestion,
  CanonicalFinanceBaseRecord,
  CanonicalCashFlowMonth,
  CanonicalDailyMetricValue,
  CanonicalFactCandidate,
  CanonicalFinanceBundle,
  CanonicalFinanceRecord,
  CanonicalFinanceSourceRef,
  CanonicalFinancialProjectionPlan,
  CanonicalMetricsDaily,
  CanonicalPnlMonth,
  CanonicalReviewStatus,
  CanonicalStatementLine,
  CanonicalValueScale,
} from "./canonical-finance-types";

type WorkbookCell = XLSX.CellObject | undefined;

type ExtractionOptions = {
  fileName: string;
  sourceContext?: ParseDocumentSourceContext;
  reports?: ExtractedReport[];
  clarificationAnswers?: Partial<Record<CanonicalFinanceClarificationKey, string>>;
};

type CandidateMetric = {
  value: number | null;
  sourceRef: CanonicalFinanceSourceRef | null;
};

const DIRECT_SHEET_PATTERNS = {
  pnl: [
    /\bp&l\b/i,
    /(?:^|[\s_.-])pl(?:$|[\s_.-])/i,
    /(?:^|[\s_.-])lr(?:$|[\s_.-])/i,
    /profit\s*(?:&|and)?\s*loss/i,
    /profit\s*(?:&|and)?\s*lost/i,
    /statement\s+of\s+profit\s+or\s+loss/i,
    /profit\s*loss(?:\s*statement)?/i,
    /profit\s*lost(?:\s*statement)?/i,
    /lap(?:oran)?\s*laba(?:\s*[\[(]?\s*rugi\s*[\)]?)?/i,
    /income statement/i,
    /laba\s*rugi/i,
  ],
  balanceSheet: [
    /\bbalance\s*sheet\b/i,
    /\bbal\s*sheet\b/i,
    /\bbs\b/i,
    /\bneraca\b/i,
    /statement\s+of\s+financial\s+position/i,
    /lap(?:oran)?\s+posisi\s+keuangan/i,
  ],
  cashFlow: [/\bcash\s*flow/i, /statement of cash flows/i],
  projection: [/\bprojection\b/i, /\bforecast\b/i, /\bbudget\b/i],
  statistics: [/\bstatistic/i, /\bmetrics?\b/i],
  summary: [/\bsummary\b/i],
};

const ORDINAL_SHEET_NAME_PATTERNS = [
  /\bp and l\b/,
  /\bpl\b/,
  /\blr\b/,
  /\bprofit and loss\b/,
  /\bprofit and lost\b/,
  /\bstatement of profit or loss\b/,
  /\bprofit loss\b/,
  /\bprofit lost\b/,
  /\bprofit loss statement\b/,
  /\blap(?:oran)? laba(?:\s*[\[(]?\s*rugi\s*[\)]?)?\b/,
  /\bincome statement\b/,
  /\blaba rugi\b/,
  /\bbalance sheet\b/,
  /\bstatement of financial position\b/,
  /\blap(?:oran)? posisi keuangan\b/,
  /\bbal sheet\b/,
  /\bbs\b/,
  /\bneraca\b/,
  /\bcash flow\b/,
  /\bstatement of cash flows\b/,
  /\bprojection\b/,
  /\bbudget\b/,
  /\bforecast\b/,
  /\bmetrics?\b/,
  /\bstatistics?\b/,
  /\bsummary\b/,
  /\btrial balance\b/,
  /\btb\b/,
] as const;

const PNL_LABELS = {
  revenue: [
    "total trading income",
    "trading income",
    "total revenue",
    "revenue",
    "sales revenue",
    "total pendapatan usaha",
    "total pendapatan",
    "pendapatan usaha",
    "pendapatan",
    "income",
  ],
  cost_of_sales: [
    "total cost of sales",
    "cost of sales",
    "total cost of revenue",
    "cost of revenue",
    "total cogs",
    "cogs",
    "total cost of fb",
    "cost of fb",
    "total harga pokok penjualan",
    "harga pokok penjualan",
  ],
  gross_profit: [
    "gross profit",
    "gross income",
    "laba rugi kotor",
    "laba kotor",
  ],
  other_income: ["total other income", "other income", "other incomes"],
  other_expenses: ["total other expense", "total other expenses", "other expense", "other expenses"],
  operating_expenses: [
    "total operating expenses",
    "total operating expense",
    "total overhead departement",
    "total overhead department",
    "overhead departement",
    "overhead department",
    "total expenses",
    "operating expenses",
    "expenses",
    "total payroll and operational expenses",
    "biaya operasional",
    "total biaya operasional",
    "beban usaha",
    "total beban usaha",
  ],
  depreciation_amortization: [
    "depreciation and amortization",
    "depreciation amortization",
    "depreciation",
    "amortization",
  ],
  interest_expense: ["interest expense", "finance cost", "financial charges", "interest charges"],
  tax_expense: [
    "total tax expense",
    "total tax expenses",
    "tax expense",
    "tax expenses",
    "income tax",
    "biaya pajak",
  ],
  net_income: [
    "net profit",
    "net income",
    "nett operating profit",
    "nop",
    "nett owner share profit",
    "net owner share profit",
    "department profit loss",
    "department profit",
    "laba rugi bersih",
    "laba bersih",
    "rugi bersih",
    "laba bersih sebelum pajak",
    "laba bersih setelah pajak",
  ],
};

const PNL_AUX_LABELS = {
  gross_operating_income: [
    "operating income",
    "gross operating income",
    "gross operating profit",
    "department profit",
    "departement profit",
    "net operating profit",
    "nett operating profit",
  ],
};

const BS_SUMMARY_LABELS = {
  cash_and_equivalents: [
    "total cash and bank",
    "cash and bank",
    "bank and cash accounts",
    "cash and cash equivalents",
    "kas dan setara kas",
  ],
  inventory: ["inventories", "inventory", "persediaan"],
  other_current_assets: ["total prepayments", "prepayments", "prepayment", "biaya dibayar dimuka"],
  total_current_assets: ["total current assets", "total aset lancar"],
  fixed_assets: ["total fixed assets", "fixed assets", "aset tetap"],
  other_non_current_assets: ["shareholder receivables", "start up expenses", "total non current assets"],
  total_assets: ["total assets", "assets", "total aset"],
  accounts_payable: [
    "total account payables",
    "accounts payable",
    "account payable",
    "account payables",
    "utang usaha",
  ],
  other_current_liabilities: [
    "total employee payable",
    "total employee payables",
    "total tax payable",
    "total tax payables",
    "employee payables",
    "employee payable",
    "tax payables",
    "tax payable",
  ],
  total_current_liabilities: ["total current liabilities", "total liabilitas jangka pendek"],
  total_liabilities: ["total liabilities", "liabilities", "total liabilitas", "liabilitas"],
  equity: ["net assets", "shareholders funds", "equity", "ekuitas", "total ekuitas"],
  retained_earnings: ["retained earnings", "retained earning", "total retained earning", "saldo laba"],
};

const BS_AUX_LABELS = {
  total_liabilities_and_capital: [
    "total liabilities and capital",
    "total liabilities capitals",
    "total liabilities capital",
    "total liabilities equity",
    "liabilities and equity",
    "liabilities equity",
    "liabilities capitals",
    "total liabilities capitals",
    "liabilities and capitals",
    "total liabilities and capitals",
    "total liabilities capital",
    "total liabilities capitals",
    "total liabilities & capital",
    "liabilities & capital",
  ],
  capital_owning_company: [
    "total capital owning company",
    "capital owning company",
    "total capital",
    "owners capital",
    "owner capital",
    "paid up capital total",
  ],
};

const CASH_FLOW_LABELS = {
  cash_from_operations: ["net cash flows from operating activities"],
  cash_from_investing: ["net cash flows from investing activities"],
  cash_from_financing: ["net cash flows from financing activities"],
  net_cash_flow: ["net cash flows", "net change in cash for period"],
  opening_cash: ["cash and cash equivalents at beginning of period"],
  closing_cash: ["cash and cash equivalents at end of period"],
};

const PROJECTION_LABELS = {
  revenue: ["total revenue"],
  cost_of_sales: ["total cost of sales"],
  gross_profit: ["gross profit"],
  operating_expenses: ["total operating expenses"],
  net_income: ["net profit", "net income", "profit after tax"],
};

const MONTHLY_METRIC_SKIP_WARNING = "statistics_sheet_not_daily_granularity";
const CURRENCY_HINTS = [
  { pattern: /\b(idr|rupiah)\b|(?:^|[^a-z])rp\.?(?:[^a-z]|$)/i, code: "IDR" },
  { pattern: /\busd\b|\$/i, code: "USD" },
  { pattern: /\beur\b|€/i, code: "EUR" },
  { pattern: /\bsgd\b/i, code: "SGD" },
  { pattern: /\bgbp\b|£/i, code: "GBP" },
  { pattern: /\baud\b/i, code: "AUD" },
  { pattern: /\bjpy\b|¥/i, code: "JPY" },
] as const;
const CURRENT_PERIOD_COLUMN_HINTS = [
  /\bcurrent month\b/i,
  /\bthis month\b/i,
  /\bcurrent\b/i,
  /\bactual\b/i,
  /\bend of period\b/i,
];
const PRIOR_PERIOD_COLUMN_HINTS = [/\blast month\b/i, /\bprevious\b/i, /\bprior\b/i];
const GENERIC_SCOPE_LABELS: Record<CanonicalFinanceRecord["family"], string[]> = {
  pnl_month: [
    "p and l",
    "pl",
    "profit and loss",
    "profit loss",
    "profit loss statement",
    "income statement",
    "lr",
    "laba rugi",
  ],
  balance_sheet_month: [
    "balance sheet",
    "bal sheet",
    "bs",
    "neraca",
    "balance sheet summary",
    "bal sheet summary",
  ],
  cash_flow_month: ["cash flow", "statement of cash flows"],
  financial_projection_plan: ["projection", "projection plan", "budget", "budget plan", "forecast"],
  metrics_daily: ["statistics", "statistic", "metrics", "daily metrics"],
};
const DAILY_METRIC_LABEL_HINTS = [
  /\brevenue\b/i,
  /\bsales\b/i,
  /\bcustomer/i,
  /\bguest/i,
  /\bmember/i,
  /\boccupancy\b/i,
  /\broom\b/i,
  /\border/i,
  /\bbooking/i,
  /\blead/i,
  /\bconversion\b/i,
  /\bavg\b/i,
  /\baverage\b/i,
  /\bticket\b/i,
  /\bmargin\b/i,
  /\brate\b/i,
  /\bcount\b/i,
  /\bvisit/i,
  /\bfootfall\b/i,
  /\bday pass\b/i,
  /\bspend\b/i,
];
const DAILY_METRIC_SKIP_LABELS = [
  /^total\b/i,
  /^grand total\b/i,
  /^subtotal\b/i,
  /^description$/i,
  /^account$/i,
  /^date$/i,
  /^period$/i,
  /^month$/i,
  /^ytd\b/i,
  /^mtd\b/i,
  /^actual$/i,
  /^budget$/i,
  /^forecast$/i,
  /^variance$/i,
] as const;

function normalizeLabel(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\brenenue\b/g, "revenue")
    .replace(/\brevnue\b/g, "revenue")
    .replace(/\bdepartement\b/g, "department")
    .replace(/\bsumamry\b/g, "summary")
    .replace(/\bconsilidation\b/g, "consolidation")
    .replace(/\bprofit\s+and\s+lost\b/g, "profit and loss")
    .replace(/\bprofit\s+lost\b/g, "profit loss")
    .replace(/\btotsl\b/g, "total")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toText(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateCell(value);
  }
  return String(value ?? "").trim();
}

function formatDateCell(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function scopeKeyFromLabel(label: string | null | undefined): string {
  const normalized = normalizeLabel(label ?? "");
  return normalized.length > 0 ? normalized.replace(/\s+/g, "_") : "company";
}

function isExplicitCompanyScopeLabel(
  label: string | null | undefined,
  family?: CanonicalFinanceRecord["family"],
): boolean {
  const normalized = normalizeLabel(stripSheetOrdinalPrefix(label ?? ""));
  if (!normalized) return true;

  if (
    normalized === "company" ||
    normalized === "company wide" ||
    normalized === "whole company" ||
    normalized === "consolidated" ||
    normalized === "consolidation" ||
    normalized === "consilidation" ||
    normalized === "pl consolidated"
  ) {
    return true;
  }

  if (family && GENERIC_SCOPE_LABELS[family].includes(normalized)) {
    return true;
  }

  return false;
}

function normalizeCanonicalScopeLabel(
  label: string | null | undefined,
  family?: CanonicalFinanceRecord["family"],
): string {
  return isExplicitCompanyScopeLabel(label, family) ? "company" : (label?.trim() || "company");
}

function isCompanyWideScope(label: string | null | undefined): boolean {
  return normalizeCanonicalScopeLabel(label) === "company";
}

function makeSourceRef(
  fileName: string,
  sheetName: string | null,
  cellRange: string | null,
  rowIndex?: number | null,
  formula?: string | null,
  note?: string | null,
): CanonicalFinanceSourceRef {
  return {
    file_name: fileName,
    sheet_name: sheetName,
    cell_range: cellRange,
    row_index: rowIndex ?? null,
    formula: formula ?? null,
    note: note ?? null,
  };
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  let text = value.trim();
  if (!text || text === "-" || /^-+$/.test(text) || text === "#DIV/0!") return null;

  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  text = text
    .replace(/[%]/g, "")
    .replace(/\b(cr|dr)\b$/i, "")
    .replace(/\b(usd|idr|eur|gbp|sgd|aud|cad|jpy)\b/gi, "")
    .replace(/rp\.?/gi, "")
    .replace(/[$€£¥]/g, "")
    .replace(/\s+/g, "");

  if (!text || text === "-" || /^-+$/.test(text)) return null;

  const commaCount = (text.match(/,/g) ?? []).length;
  const dotCount = (text.match(/\./g) ?? []).length;

  if (commaCount > 0 && dotCount > 0) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(/,/g, ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (commaCount > 0) {
    if (commaCount === 1 && /,\d{1,2}$/.test(text)) {
      text = text.replace(/\./g, "").replace(/,/g, ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (dotCount > 1 && /^\d{1,3}(?:\.\d{3})+(?:\.\d+)?$/.test(text)) {
    text = text.replace(/\./g, "");
  } else if (dotCount === 1 && /^\d{1,3}\.\d{3}$/.test(text)) {
    text = text.replace(/\./g, "");
  }

  if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) return null;

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function inferWorkbookCurrency(
  workbook: XLSX.WorkBook,
  preferredSheetName?: string | null,
  reports?: ExtractedReport[] | undefined,
): string | null {
  const sampleSheets = [
    ...(preferredSheetName ? [preferredSheetName] : []),
    ...workbook.SheetNames.filter((sheetName) => sheetName !== preferredSheetName).slice(0, 20),
  ];

  const scanSheetHints = (): string | null => {
    for (const sheetName of sampleSheets) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const rows = sheetRows(sheet);
      for (const row of rows.slice(0, 80)) {
        for (const cell of row.slice(0, 20)) {
          const text = toText(cell);
          for (const hint of CURRENCY_HINTS) {
            if (hint.pattern.test(text)) return hint.code;
          }
        }
      }
    }
    return null;
  };

  const directHintCurrency = scanSheetHints();
  if (directHintCurrency) {
    return directHintCurrency;
  }

  const workbookText = sampleSheets
    .map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return "";
      return sheetRows(sheet)
        .slice(0, 140)
        .flatMap((row) => row.slice(0, 12).map((cell) => toText(cell)))
        .join(" ");
    })
    .join(" ")
    .toLowerCase();

  const reportCurrencies = Array.from(
    new Set((reports ?? []).map((report) => normalizeCurrencyCode(report.currency)).filter(Boolean)),
  );
  if (reportCurrencies.length === 1) {
    const reportCurrency = reportCurrencies[0]!;
    if (reportCurrency === "USD") {
      if (/(jamsostek|rupiah|\bidr\b|\bthr\b|\bppn\b|\bpajak\b)/i.test(workbookText)) {
        return "IDR";
      }
    }
    return reportCurrency;
  }

  if (/(jamsostek|rupiah|\bidr\b|\bthr\b|\bppn\b|\bpajak\b)/i.test(workbookText)) {
    return "IDR";
  }

  const props = workbook.Props ?? {};
  for (const key of ["Company", "Title", "Subject", "Category"] as const) {
    const text = toText(props[key] as unknown);
    for (const hint of CURRENCY_HINTS) {
      if (hint.pattern.test(text)) return hint.code;
    }
  }
  return null;
}

export function stripSheetOrdinalPrefix(sheetName: string): string {
  const trimmed = sheetName.trim();
  if (!trimmed) return trimmed;

  const punctuatedMatch = trimmed.match(/^\d+\s*([.)_-]\s*)(.+)$/);
  if (punctuatedMatch?.[2]) {
    return punctuatedMatch[2].trim();
  }

  const spacedMatch = trimmed.match(/^\d+\s+(.+)$/);
  if (!spacedMatch?.[1]) {
    return trimmed;
  }

  const remainder = spacedMatch[1].trim();
  const normalizedRemainder = normalizeLabel(remainder);
  if (
    ORDINAL_SHEET_NAME_PATTERNS.some((pattern) => pattern.test(normalizedRemainder)) ||
    isExplicitCompanyScopeLabel(remainder)
  ) {
    return remainder;
  }

  return trimmed;
}

export function resolveDirectScopeLabel(
  sheetName: string,
  family: CanonicalFinanceRecord["family"],
): string {
  const trimmed = sheetName.trim();
  if (!trimmed) return "company";

  const stripped = stripSheetOrdinalPrefix(trimmed);
  const normalizedCandidate = normalizeLabel(stripped);
  if (isCompanyWideScope(stripped) || GENERIC_SCOPE_LABELS[family].includes(normalizedCandidate)) {
    return "company";
  }

  const withoutFamilyTokens = normalizedCandidate
    .replace(
      /\bp and l\b|\bpl\b|\blr\b|\bprofit and loss\b|\bstatement of profit or loss\b|\bprofit loss\b|\bprofit loss statement\b|\bincome statement\b|\blap(?:oran)? laba(?:\s*[\[(]?\s*rugi\s*[\)]?)?\b|\blaba rugi\b/g,
      " ",
    )
    .replace(
      /\bbalance sheet\b|\bstatement of financial position\b|\blap(?:oran)? posisi keuangan\b|\bbal sheet\b|\bbs\b|\bneraca\b/g,
      " ",
    )
    .replace(/\bcash flow\b|\bstatement of cash flows\b/g, " ")
    .replace(/\bprojection\b|\bbudget\b|\bforecast\b/g, " ")
    .replace(/\bstatistics?\b|\bmetrics?\b/g, " ")
    .replace(/\bsummary\b/g, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const timeOnlyScopeCandidate = withoutFamilyTokens
    .replace(
      /\b(ytd|mtd|qtd|actual|current|month|monthly|quarter|quarterly|fy|cy|year|years|yr|yrs|annual|annually|year to date|month to date|quarter to date)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!/[a-z]/i.test(withoutFamilyTokens)) {
    return "company";
  }

  if (!/[a-z]/i.test(timeOnlyScopeCandidate)) {
    return "company";
  }

  if (isCompanyWideScope(withoutFamilyTokens)) {
    return "company";
  }

  if (
    /^(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december|q[1-4])$/.test(
      timeOnlyScopeCandidate,
    )
  ) {
    return "company";
  }

  return withoutFamilyTokens;
}

function inferProjectionScenarioKey(fileName: string, sheetName: string): string {
  const combined = normalizeLabel(`${fileName} ${sheetName}`);
  if (/(^|\s)(best case|bestcase|upside|optimistic|stretch|bull)(\s|$)/.test(combined)) {
    return "best_case";
  }
  if (/(^|\s)(worst case|worstcase|downside|conservative|bear|stress)(\s|$)/.test(combined)) {
    return "worst_case";
  }
  if (/(^|\s)(base case|basecase|baseline)(\s|$)/.test(combined)) {
    return "base";
  }
  return "base";
}

function isHospitalityDirectPnlSheet(sheet: XLSX.WorkSheet): boolean {
  const rows = sheetRows(sheet);
  const hasTitle = rows.slice(0, 8).some((row) =>
    row.some((cell) => {
      const normalized = normalizeLabel(cell);
      return (
        normalized.includes("income statement") ||
        normalized.includes("profit loss statement") ||
        normalized.includes("profit statement")
      );
    }),
  );
  if (!hasTitle) return false;

  return rows.slice(0, 20).some((row) => {
    const normalizedRow = row.map(normalizeLabel).filter(Boolean);
    if (normalizedRow.length < 2) return false;
    const hasDescriptionLikeHeader =
      normalizedRow.includes("description") ||
      normalizedRow.includes("account") ||
      normalizedRow.includes("current month");
    if (!hasDescriptionLikeHeader) return false;
    return (
      (normalizedRow.includes("actual") && normalizedRow.includes("budget")) ||
      (normalizedRow.includes("current month") && normalizedRow.includes("budget"))
    );
  });
}

function findNamedDirectPnlSheetNames(workbook: XLSX.WorkBook): string[] {
  return findSheetNames(workbook, DIRECT_SHEET_PATTERNS.pnl).filter(
    (name) => !DIRECT_SHEET_PATTERNS.summary.some((pattern) => pattern.test(name)),
  );
}

function findHospitalityDirectPnlSheetNames(workbook: XLSX.WorkBook): string[] {
  return workbook.SheetNames.filter((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return false;
    return isHospitalityDirectPnlSheet(sheet);
  });
}

function findGenericDirectPnlSheetNames(workbook: XLSX.WorkBook): string[] {
  const namedCandidates = new Set(findNamedDirectPnlSheetNames(workbook));
  return workbook.SheetNames.filter((sheetName) => {
    if (namedCandidates.has(sheetName)) return false;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return false;
    return isGenericDirectPnlSheet(sheet);
  });
}

function findDirectPnlSheetNames(workbook: XLSX.WorkBook): string[] {
  return Array.from(
    new Set([
      ...findNamedDirectPnlSheetNames(workbook),
      ...findHospitalityDirectPnlSheetNames(workbook),
      ...findGenericDirectPnlSheetNames(workbook),
    ]),
  );
}

function findNamedDirectBalanceSheetSheetNames(workbook: XLSX.WorkBook): string[] {
  return findSheetNames(workbook, DIRECT_SHEET_PATTERNS.balanceSheet);
}

function findGenericDirectBalanceSheetSheetNames(workbook: XLSX.WorkBook): string[] {
  const namedCandidates = new Set(findNamedDirectBalanceSheetSheetNames(workbook));
  return workbook.SheetNames.filter((sheetName) => {
    if (namedCandidates.has(sheetName)) return false;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return false;
    return isGenericDirectBalanceSheetSheet(sheet);
  });
}

function findDirectBalanceSheetSheetNames(workbook: XLSX.WorkBook): string[] {
  return Array.from(
    new Set([
      ...findNamedDirectBalanceSheetSheetNames(workbook),
      ...findGenericDirectBalanceSheetSheetNames(workbook),
    ]),
  );
}

function reportTypeToFamily(
  reportType: ExtractedReport["report_type"],
): CanonicalFinanceRecord["family"] | null {
  if (reportType === "profit_and_loss") return "pnl_month";
  if (reportType === "balance_sheet") return "balance_sheet_month";
  return null;
}

function isProjectionLikeText(value: string | null | undefined): boolean {
  const text = value?.trim();
  if (!text) return false;
  return DIRECT_SHEET_PATTERNS.projection.some((pattern) => pattern.test(text));
}

function isProjectionLikeReport(
  report: ExtractedReport,
  fileName: string,
): boolean {
  return (
    report.book === "budget" ||
    report.book === "forecast" ||
    isProjectionLikeText(fileName) ||
    isProjectionLikeText(report.sheet_name ?? null) ||
    isProjectionLikeText(report.entity ?? null)
  );
}

function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function dayKeyFromCell(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateCell(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 20_000) return null;
    const parsed = XLSX.SSF.parse_date_code(value);
    if (
      parsed &&
      typeof parsed.y === "number" &&
      typeof parsed.m === "number" &&
      typeof parsed.d === "number"
    ) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!isoMatch) return null;
  return `${isoMatch[1]}-${isoMatch[2]!.padStart(2, "0")}-${isoMatch[3]!.padStart(2, "0")}`;
}

function inferMetricUnit(label: string): CanonicalDailyMetricValue["unit"] {
  if (/%|occupancy|margin|ratio|rate/.test(label.toLowerCase())) return "percent";
  if (/revenue|sales|income|spend|average|ticket|adr|revpar/i.test(label)) return "currency";
  return "count";
}

function shouldKeepDailyMetricLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;
  if (DAILY_METRIC_SKIP_LABELS.some((pattern) => pattern.test(trimmed))) return false;
  return DAILY_METRIC_LABEL_HINTS.some((pattern) => pattern.test(trimmed));
}

function findSummaryTargetColumnIndex(
  rows: unknown[][],
  targetPeriodKey: string | null,
): number | null {
  const strict = findTargetColumnIndex(rows, targetPeriodKey);
  if (strict) return strict.columnIndex;

  if (targetPeriodKey) {
    for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      const periodColumns = row
        .map((cell, columnIndex) => ({ columnIndex, periodKey: periodKeyFromCell(cell) }))
        .filter((entry): entry is { columnIndex: number; periodKey: string } => Boolean(entry.periodKey));
      if (periodColumns.length < 2) {
        continue;
      }
      const exact = periodColumns.find((entry) => entry.periodKey === targetPeriodKey);
      if (exact) {
        return exact.columnIndex;
      }
    }
  }

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const stringCells = row.filter(
      (cell): cell is string => typeof cell === "string" && cell.trim().length > 0,
    );
    const numericCells = row.filter((cell) => parseNumber(cell) !== null);
    if (stringCells.length < 2 || numericCells.length > 0) {
      continue;
    }
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const text = toText(row[columnIndex]);
      if (!text || PRIOR_PERIOD_COLUMN_HINTS.some((pattern) => pattern.test(text))) {
        continue;
      }
      if (CURRENT_PERIOD_COLUMN_HINTS.some((pattern) => pattern.test(text))) {
        return columnIndex;
      }
    }
  }

  const numericColumnCounts = new Map<number, number>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length === 0) continue;
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (parseNumber(row[columnIndex]) === null) continue;
      const labelCell = findLabelCellBeforeValue(row, columnIndex);
      if (!labelCell) continue;
      numericColumnCounts.set(columnIndex, (numericColumnCounts.get(columnIndex) ?? 0) + 1);
    }
  }

  if (numericColumnCounts.size > 0) {
    const best = Array.from(numericColumnCounts.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return b[0] - a[0];
      })[0];
    if (best && best[1] >= 2) {
      return best[0];
    }
  }

  return null;
}

function inferDominantNumericColumnIndex(rows: unknown[][]): number | null {
  const counts = new Map<number, number>();

  for (const row of rows) {
    row.forEach((cell, columnIndex) => {
      if (parseNumber(cell) === null) return;
      counts.set(columnIndex, (counts.get(columnIndex) ?? 0) + 1);
    });
  }

  let bestColumn: number | null = null;
  let bestCount = 0;
  for (const [columnIndex, count] of counts.entries()) {
    if (columnIndex < 1) continue;
    if (count > bestCount) {
      bestColumn = columnIndex;
      bestCount = count;
    }
  }

  return bestCount >= 2 ? bestColumn : null;
}

function datePeriodFromCell(value: unknown): ReportingPeriodLike | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const day = formatDateCell(value);
    return { start: day, end: day, label: day };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (
      parsed &&
      typeof parsed.y === "number" &&
      typeof parsed.m === "number" &&
      typeof parsed.d === "number" &&
      parsed.y >= 2000
    ) {
      const day = `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
      return { start: day, end: day, label: day };
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      const day = `${iso[1]}-${iso[2]}-${iso[3]}`;
      return { start: day, end: day, label: day };
    }
  }

  return null;
}

function isMonthEndPeriod(period: ReportingPeriodLike): boolean {
  const match = period.start.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day === lastDay;
}

function findDailyMetricColumns(
  rows: unknown[][],
): { rowIndex: number; periods: Array<{ columnIndex: number; period: ReportingPeriodLike }> } | null {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const periods = row
      .map((cell, columnIndex) => ({ columnIndex, period: datePeriodFromCell(cell) }))
      .filter((entry): entry is { columnIndex: number; period: ReportingPeriodLike } => Boolean(entry.period));
    if (
      periods.length >= 2 &&
      periods.some((entry) => !isMonthEndPeriod(entry.period)) &&
      !looksLikeMonthlyMetricsHeader(rows, rowIndex, periods)
    ) {
      return { rowIndex, periods };
    }
  }
  return null;
}

function hasMonthlyMetricHeader(rows: unknown[][]): boolean {
  return rows.some((row, rowIndex) => {
    const dailyPeriods = row
      .map((cell, columnIndex) => ({ columnIndex, period: datePeriodFromCell(cell) }))
      .filter(
        (entry): entry is { columnIndex: number; period: ReportingPeriodLike } => Boolean(entry.period),
      );
    if (dailyPeriods.length >= 2) {
      if (
        dailyPeriods.every(({ period }) => isMonthEndPeriod(period)) ||
        looksLikeMonthlyMetricsHeader(rows, rowIndex, dailyPeriods)
      ) {
        return true;
      }
    }
    const monthlyColumns = row
      .map((cell) => periodKeyFromCell(cell))
      .filter((value): value is string => Boolean(value));
    return monthlyColumns.length >= 2;
  });
}

function looksLikeMonthlyMetricsHeader(
  rows: unknown[][],
  rowIndex: number,
  periods: Array<{ columnIndex: number; period: ReportingPeriodLike }>,
): boolean {
  if (periods.length < 6) {
    return false;
  }

  const nextRow = rows[rowIndex + 1] ?? [];
  const monthLengthLikeValues = periods
    .map(({ columnIndex }) => parseNumber(nextRow[columnIndex]))
    .filter((value): value is number => value !== null);
  if (
    monthLengthLikeValues.length >= Math.min(periods.length, 6) &&
    monthLengthLikeValues.every((value) => Number.isInteger(value) && value >= 28 && value <= 31)
  ) {
      return true;
    }

  return periods.every(({ period }) => {
    const day = Number(period.start.slice(-2));
    return day >= 28;
  });
}

function resolveWorkbookPeriod(
  fileName: string,
  sourceContext?: ParseDocumentSourceContext,
): ReportingPeriodLike | null {
  return (
    parsePeriodFromFileName(fileName.split("#")[0]) ??
    (sourceContext?.sourcePath ? parsePeriodFromSourcePath(sourceContext.sourcePath) : null)
  );
}

function monthPeriodFromKey(periodKey: string): ReportingPeriodLike {
  const match = periodKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return periodFromKey(periodKey);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const end = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: `${match[1]}-${match[2]}-${String(end).padStart(2, "0")}`,
    label: periodKey,
  };
}

function parseIsoDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function monthRangeFromKey(periodKey: string): { start: number; end: number } | null {
  const match = periodKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = Date.UTC(year, month - 1, 1);
  const end = Date.UTC(year, month, 0);
  return { start, end };
}

function periodContainsMonthKey(
  period: ReportingPeriodLike | null,
  periodKey: string,
): boolean {
  if (!period) return true;
  if (!isMonthlyPeriodKey(periodKey)) return false;

  const monthRange = monthRangeFromKey(periodKey);
  const start = parseIsoDateParts(period.start);
  const end = parseIsoDateParts(period.end);
  if (!monthRange || !start || !end) return true;

  const periodStart = Date.UTC(start.year, start.month - 1, start.day);
  const periodEnd = Date.UTC(end.year, end.month - 1, end.day);
  return monthRange.start >= periodStart && monthRange.end <= periodEnd;
}

function periodsOverlap(left: ReportingPeriodLike, right: ReportingPeriodLike): boolean {
  const leftStart = parseIsoDateParts(left.start);
  const leftEnd = parseIsoDateParts(left.end);
  const rightStart = parseIsoDateParts(right.start);
  const rightEnd = parseIsoDateParts(right.end);
  if (!leftStart || !leftEnd || !rightStart || !rightEnd) {
    return false;
  }

  const leftStartMs = Date.UTC(leftStart.year, leftStart.month - 1, leftStart.day);
  const leftEndMs = Date.UTC(leftEnd.year, leftEnd.month - 1, leftEnd.day);
  const rightStartMs = Date.UTC(rightStart.year, rightStart.month - 1, rightStart.day);
  const rightEndMs = Date.UTC(rightEnd.year, rightEnd.month - 1, rightEnd.day);

  return leftStartMs <= rightEndMs && rightStartMs <= leftEndMs;
}

function confidenceFromWarnings(warnings: string[]): number {
  return warnings.length === 0 ? 0.95 : warnings.length === 1 ? 0.8 : 0.65;
}

function reviewStatusFromWarnings(warnings: string[]): CanonicalReviewStatus {
  return warnings.length === 0 ? "verified" : "review_pending";
}

function pickLineValue(item: ReportLineItem, report: ExtractedReport): number | null {
  const preferredKeys =
    report.book === "budget"
      ? ["budget", "actual", "current_period"]
      : report.book === "forecast"
        ? ["forecast", "budget", "actual", "current_period"]
        : ["actual", "current_period", "ending_balance", "balance", "value"];

  for (const key of preferredKeys) {
    if (!(key in item.values)) continue;
    const value = item.values[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  for (const value of Object.values(item.values)) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  return null;
}

function lineSourceRef(fileName: string, item: ReportLineItem): CanonicalFinanceSourceRef {
  const refs = Object.values(item.source.columns ?? {});
  return makeSourceRef(
    fileName,
    item.source.sheet,
    refs.length > 0 ? refs.join(",") : null,
    item.source.row,
  );
}

function resolveLegacyReportScopeLabel(report: ExtractedReport): string {
  const family = reportTypeToFamily(report.report_type);
  const isGenericLegacyScope = (value: string | null | undefined): boolean => {
    const normalized = normalizeLabel(stripSheetOrdinalPrefix(value ?? ""));
    if (!normalized || normalized === "unknown") return true;
    if (normalized.includes("summary")) return true;
    if (isProjectionLikeText(value)) return true;
    if (family && GENERIC_SCOPE_LABELS[family].includes(normalized)) return true;
    return false;
  };

  const entity = report.entity?.trim();
  if (entity) {
    if (isExplicitCompanyScopeLabel(entity, family ?? undefined)) {
      return "company";
    }
    if (!isGenericLegacyScope(entity)) {
      return entity;
    }
  }

  const sheetName = report.sheet_name?.trim();
  if (sheetName) {
    if (isExplicitCompanyScopeLabel(sheetName, family ?? undefined)) {
      return "company";
    }
    if (!isGenericLegacyScope(sheetName)) {
      return sheetName;
    }
  }

  return "company";
}

function findLineMetric(
  report: ExtractedReport,
  fileName: string,
  matcher: (item: ReportLineItem) => boolean,
): CandidateMetric {
  const matching = report.line_items.filter((item) => matcher(item));
  const totalLine = matching.find((item) => item.is_total);
  const sourceLine = totalLine ?? matching[0] ?? null;

  if (totalLine) {
    return {
      value: pickLineValue(totalLine, report),
      sourceRef: sourceLine ? lineSourceRef(fileName, sourceLine) : null,
    };
  }

  const values = matching
    .map((item) => pickLineValue(item, report))
    .filter((value): value is number => typeof value === "number");

  if (values.length === 0) {
    return { value: null, sourceRef: sourceLine ? lineSourceRef(fileName, sourceLine) : null };
  }

  return {
    value: values.reduce((sum, value) => sum + value, 0),
    sourceRef: sourceLine ? lineSourceRef(fileName, sourceLine) : null,
  };
}

function pushCandidateFact(
  facts: CanonicalFactCandidate[],
  record: CanonicalFinanceRecord,
  concept: string,
  rawLabel: string,
  metric: CandidateMetric,
  unit: "currency" | "count" | "percent" = "currency",
): void {
  if (!metric.sourceRef) return;
  facts.push({
    concept,
    raw_label: rawLabel,
    value: metric.value,
    unit,
    scale: record.scale,
    period_key: record.period_key,
    scope_key: record.scope_key,
    source_ref: metric.sourceRef,
    confidence: record.confidence,
  });
}

function periodFromKey(periodKey: string): ReportingPeriodLike {
  const monthMatch = periodKey.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    const end = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      start: `${monthMatch[1]}-${monthMatch[2]}-01`,
      end: `${monthMatch[1]}-${monthMatch[2]}-${String(end).padStart(2, "0")}`,
      label: periodKey,
    };
  }

  return (
    parsePeriodFromFileName(periodKey) ?? {
      start: `${periodKey}-01`,
      end: `${periodKey}-31`,
      label: periodKey,
    }
  );
}

function isMonthlyPeriodKey(periodKey: string): boolean {
  return /^\d{4}-\d{2}$/.test(periodKey);
}

function periodKeyForComparison(period: ReportingPeriodLike): string {
  return normalizeReportingPeriodKey(period);
}

function isSingleMonthPeriod(period: ReportingPeriodLike): boolean {
  return isMonthlyPeriodKey(periodKeyForComparison(period));
}

function isFullYearPeriod(period: ReportingPeriodLike): boolean {
  return /^\d{4}$/.test(periodKeyForComparison(period));
}

function isClosingRangePlaceholder(period: ReportingPeriodLike): boolean {
  const start = parseIsoDateParts(period.start);
  const end = parseIsoDateParts(period.end);
  if (!start || !end) return false;
  if (start.year === end.year && start.month === end.month) return false;

  const startMonthLastDay = new Date(Date.UTC(start.year, start.month, 0)).getUTCDate();
  const endMonthLastDay = new Date(Date.UTC(end.year, end.month, 0)).getUTCDate();
  return start.day === startMonthLastDay && end.day === endMonthLastDay;
}

function periodContains(candidate: ReportingPeriodLike, inner: ReportingPeriodLike): boolean {
  const candidateStart = parseIsoDateParts(candidate.start);
  const candidateEnd = parseIsoDateParts(candidate.end);
  const innerStart = parseIsoDateParts(inner.start);
  const innerEnd = parseIsoDateParts(inner.end);
  if (!candidateStart || !candidateEnd || !innerStart || !innerEnd) return false;

  const candidateStartMs = Date.UTC(candidateStart.year, candidateStart.month - 1, candidateStart.day);
  const candidateEndMs = Date.UTC(candidateEnd.year, candidateEnd.month - 1, candidateEnd.day);
  const innerStartMs = Date.UTC(innerStart.year, innerStart.month - 1, innerStart.day);
  const innerEndMs = Date.UTC(innerEnd.year, innerEnd.month - 1, innerEnd.day);
  return candidateStartMs <= innerStartMs && candidateEndMs >= innerEndMs;
}

function periodMonthSpan(period: ReportingPeriodLike): number | null {
  const start = parseIsoDateParts(period.start);
  const end = parseIsoDateParts(period.end);
  if (!start || !end) return null;
  return (end.year - start.year) * 12 + (end.month - start.month) + 1;
}

function periodEndsInSameMonth(period: ReportingPeriodLike, candidateMonth: ReportingPeriodLike): boolean {
  const periodEnd = parseIsoDateParts(period.end);
  const candidateStart = parseIsoDateParts(candidateMonth.start);
  if (!periodEnd || !candidateStart) return false;
  return periodEnd.year === candidateStart.year && periodEnd.month === candidateStart.month;
}

function resolveReportDerivedPnlPeriod(
  reportPeriod: ReportingPeriodLike,
  fileName: string,
): { period: ReportingPeriodLike; refinedFromWorkbook: boolean } {
  const workbookPeriod = resolveWorkbookPeriod(fileName);
  if (!workbookPeriod || !isSingleMonthPeriod(workbookPeriod)) {
    return { period: reportPeriod, refinedFromWorkbook: false };
  }

  if (isFullYearPeriod(reportPeriod) && periodContains(reportPeriod, workbookPeriod)) {
    return { period: workbookPeriod, refinedFromWorkbook: true };
  }

  if (isClosingRangePlaceholder(reportPeriod) && periodContains(reportPeriod, workbookPeriod)) {
    return { period: workbookPeriod, refinedFromWorkbook: true };
  }

  const monthSpan = periodMonthSpan(reportPeriod);
  if (
    monthSpan !== null &&
    monthSpan <= 2 &&
    monthSpan > 1 &&
    periodEndsInSameMonth(reportPeriod, workbookPeriod) &&
    periodContains(reportPeriod, workbookPeriod)
  ) {
    return { period: workbookPeriod, refinedFromWorkbook: true };
  }

  return { period: reportPeriod, refinedFromWorkbook: false };
}

function createBaseRecord(
  reportPeriod: ReportingPeriodLike,
  fileName: string,
  sourceRefs: CanonicalFinanceSourceRef[],
  input: {
    family: CanonicalFinanceRecord["family"];
    currency: string | null;
    scale?: CanonicalValueScale;
    scopeLabel: string;
    book: CanonicalFinanceRecord["book"];
    warnings: string[];
  },
): Omit<CanonicalFinanceBaseRecord, "family"> {
  const normalizedScopeLabel = normalizeCanonicalScopeLabel(input.scopeLabel, input.family);
  return {
    period: reportPeriod,
    period_key: normalizeReportingPeriodKey(reportPeriod),
    revision_key: null,
    currency: input.currency,
    scale: input.scale ?? "raw",
    scope_key: scopeKeyFromLabel(normalizedScopeLabel),
    scope_label: normalizedScopeLabel,
    company_wide: isCompanyWideScope(normalizedScopeLabel),
    book: input.book,
    confidence: confidenceFromWarnings(input.warnings),
    review_status: reviewStatusFromWarnings(input.warnings),
    warnings: input.warnings,
    source_document_name: fileName,
    source_refs: sourceRefs,
  };
}

function convertPnlReport(
  report: ExtractedReport,
  fileName: string,
  facts: CanonicalFactCandidate[],
): CanonicalPnlMonth | null {
  if (report.report_type !== "profit_and_loss") return null;
  const resolvedPeriod = resolveReportDerivedPnlPeriod(report.reporting_period, fileName);
  const statementLines = extractReportStatementLines(report, fileName);

  const revenue = findLineMetric(
    report,
    fileName,
    (item) =>
      item.section === "revenue" && (item.is_total || normalizeLabel(item.account_name) === "total revenue"),
  );
  const costOfSales = findLineMetric(
    report,
    fileName,
    (item) => item.section === "cost_of_sales" && item.is_total,
  );
  let grossProfit = findLineMetric(
    report,
    fileName,
    (item) => normalizeLabel(item.account_name).includes("gross profit"),
  );
  const grossOperatingIncome = findLineMetric(
    report,
    fileName,
    (item) =>
      item.section === "gross_operating_income" ||
      PNL_AUX_LABELS.gross_operating_income.some((keyword) =>
        normalizeLabel(item.account_name).includes(keyword),
      ),
  );
  const otherIncome = findLineMetric(
    report,
    fileName,
    (item) => PNL_LABELS.other_income.some((keyword) => normalizeLabel(item.account_name).includes(keyword)),
  );
  const otherExpenses = findLineMetric(
    report,
    fileName,
    (item) => PNL_LABELS.other_expenses.some((keyword) => normalizeLabel(item.account_name).includes(keyword)),
  );
  let operatingExpenses = findLineMetric(
    report,
    fileName,
    (item) =>
      (item.section === "operating_expenses" && item.is_total) ||
      PNL_LABELS.operating_expenses.some((keyword) =>
        normalizeLabel(item.account_name).includes(keyword),
      ),
  );
  const depreciationAmortization = findLineMetric(
    report,
    fileName,
    (item) =>
      PNL_LABELS.depreciation_amortization.some((keyword) =>
        normalizeLabel(item.account_name).includes(keyword),
      ),
  );
  const interestExpense = findLineMetric(
    report,
    fileName,
    (item) =>
      PNL_LABELS.interest_expense.some((keyword) =>
        normalizeLabel(item.account_name).includes(keyword),
      ),
  );
  const taxExpense = findLineMetric(
    report,
    fileName,
    (item) => normalizeLabel(item.account_name).includes("tax"),
  );
  const netIncome = findLineMetric(
    report,
    fileName,
    (item) => item.section === "net_income" || normalizeLabel(item.account_name).includes("net profit"),
  );

  if (
    grossProfit.value === null &&
    revenue.value !== null &&
    costOfSales.value !== null
  ) {
    grossProfit = {
      value: Number((revenue.value - costOfSales.value).toFixed(2)),
      sourceRef: grossOperatingIncome.sourceRef ?? revenue.sourceRef ?? costOfSales.sourceRef,
    };
  }

  if (
    operatingExpenses.value === null &&
    grossProfit.value !== null &&
    grossOperatingIncome.value !== null
  ) {
    operatingExpenses = {
      value: Number((grossProfit.value - grossOperatingIncome.value).toFixed(2)),
      sourceRef: grossOperatingIncome.sourceRef,
    };
  }

  const warnings: string[] = [];
  if (revenue.value === null) warnings.push("pnl_revenue_missing");
  if (netIncome.value === null) warnings.push("pnl_net_income_missing");
  if (resolvedPeriod.refinedFromWorkbook) warnings.push("pnl_period_refined_from_workbook_period");

  const record: CanonicalPnlMonth = {
    family: "pnl_month",
    ...createBaseRecord(resolvedPeriod.period, fileName, [
      revenue.sourceRef,
      costOfSales.sourceRef,
      grossProfit.sourceRef,
      otherIncome.sourceRef,
      otherExpenses.sourceRef,
      operatingExpenses.sourceRef,
      depreciationAmortization.sourceRef,
      interestExpense.sourceRef,
      taxExpense.sourceRef,
      netIncome.sourceRef,
    ].filter((value): value is CanonicalFinanceSourceRef => Boolean(value)), {
      family: "pnl_month",
      currency: report.currency,
      scopeLabel: resolveLegacyReportScopeLabel(report),
      book: report.book,
      warnings,
    }),
    statement_lines: statementLines,
    values: {
      revenue: revenue.value,
      cost_of_sales: costOfSales.value,
      gross_profit: grossProfit.value,
      other_income: otherIncome.value,
      other_expenses: otherExpenses.value,
      operating_expenses: operatingExpenses.value,
      depreciation_amortization: depreciationAmortization.value,
      ebitda: null,
      ebit: null,
      interest_expense: interestExpense.value,
      tax_expense: taxExpense.value,
      net_income: netIncome.value,
    },
  };

  pushCandidateFact(facts, record, "revenue", "Revenue", revenue);
  pushCandidateFact(facts, record, "cost_of_sales", "Cost of Sales", costOfSales);
  pushCandidateFact(facts, record, "gross_profit", "Gross Profit", grossProfit);
  pushCandidateFact(facts, record, "other_income", "Other Income", otherIncome);
  pushCandidateFact(facts, record, "other_expenses", "Other Expenses", otherExpenses);
  pushCandidateFact(facts, record, "operating_expenses", "Operating Expenses", operatingExpenses);
  pushCandidateFact(facts, record, "depreciation_amortization", "Depreciation & Amortization", depreciationAmortization);
  pushCandidateFact(facts, record, "interest_expense", "Interest Expense", interestExpense);
  pushCandidateFact(facts, record, "tax_expense", "Tax Expense", taxExpense);
  pushCandidateFact(facts, record, "net_income", "Net Income", netIncome);

  return record;
}

function convertBalanceSheetReport(
  report: ExtractedReport,
  fileName: string,
  facts: CanonicalFactCandidate[],
): CanonicalBalanceSheetMonth | null {
  if (report.report_type !== "balance_sheet") return null;
  const statementLines = extractReportStatementLines(report, fileName);

  const currentAssets = findLineMetric(
    report,
    fileName,
    (item) => item.section === "current_assets" && item.is_total,
  );
  const fixedAssets = findLineMetric(
    report,
    fileName,
    (item) => item.section === "fixed_assets" && item.is_total,
  );
  const otherAssets = findLineMetric(
    report,
    fileName,
    (item) => item.section === "other_assets" && item.is_total,
  );
  const currentLiabilities = findLineMetric(
    report,
    fileName,
    (item) => item.section === "current_liabilities" && item.is_total,
  );
  const longTermLiabilities = findLineMetric(
    report,
    fileName,
    (item) => item.section === "long_term_liabilities" && item.is_total,
  );
  const retainedEarnings = findLineMetric(
    report,
    fileName,
    (item) => item.section === "retained_earnings_equity" && item.is_total,
  );
  const capitalEquity = findLineMetric(
    report,
    fileName,
    (item) => item.section === "capital_equity" && item.is_total,
  );

  const totalAssets = [
    currentAssets.value,
    fixedAssets.value,
    otherAssets.value,
  ].every((value) => value === null)
    ? { value: null, sourceRef: currentAssets.sourceRef ?? fixedAssets.sourceRef ?? otherAssets.sourceRef }
    : {
        value: (currentAssets.value ?? 0) + (fixedAssets.value ?? 0) + (otherAssets.value ?? 0),
        sourceRef: currentAssets.sourceRef ?? fixedAssets.sourceRef ?? otherAssets.sourceRef,
      };
  const totalLiabilities = [
    currentLiabilities.value,
    longTermLiabilities.value,
  ].every((value) => value === null)
    ? { value: null, sourceRef: currentLiabilities.sourceRef ?? longTermLiabilities.sourceRef }
    : {
        value: (currentLiabilities.value ?? 0) + (longTermLiabilities.value ?? 0),
        sourceRef: currentLiabilities.sourceRef ?? longTermLiabilities.sourceRef,
      };
  const totalEquity = [capitalEquity.value, retainedEarnings.value].every((value) => value === null)
    ? { value: null, sourceRef: capitalEquity.sourceRef ?? retainedEarnings.sourceRef }
    : {
        value: (capitalEquity.value ?? 0) + (retainedEarnings.value ?? 0),
        sourceRef: capitalEquity.sourceRef ?? retainedEarnings.sourceRef,
      };

  const warnings: string[] = [];
  if (totalAssets.value !== null && totalLiabilities.value !== null && totalEquity.value !== null) {
    const delta = Math.abs(totalAssets.value - (totalLiabilities.value + totalEquity.value));
    if (delta > 1) warnings.push("balance_sheet_equation_mismatch");
  } else {
    warnings.push("balance_sheet_totals_incomplete");
  }

  const record: CanonicalBalanceSheetMonth = {
    family: "balance_sheet_month",
    ...createBaseRecord(report.reporting_period, fileName, [
      currentAssets.sourceRef,
      fixedAssets.sourceRef,
      otherAssets.sourceRef,
      currentLiabilities.sourceRef,
      longTermLiabilities.sourceRef,
      capitalEquity.sourceRef,
      retainedEarnings.sourceRef,
    ].filter((value): value is CanonicalFinanceSourceRef => Boolean(value)), {
      family: "balance_sheet_month",
      currency: report.currency,
      scopeLabel: resolveLegacyReportScopeLabel(report),
      book: report.book,
      warnings,
    }),
    statement_lines: statementLines,
    values: {
      cash_and_equivalents: null,
      accounts_receivable: null,
      inventory: null,
      other_current_assets: null,
      total_current_assets: currentAssets.value,
      fixed_assets: fixedAssets.value,
      intangible_assets: null,
      other_non_current_assets: otherAssets.value,
      total_assets: totalAssets.value,
      accounts_payable: null,
      short_term_debt: null,
      other_current_liabilities: null,
      total_current_liabilities: currentLiabilities.value,
      long_term_debt: null,
      other_non_current_liabilities: longTermLiabilities.value,
      total_liabilities: totalLiabilities.value,
      equity: totalEquity.value,
      retained_earnings: retainedEarnings.value,
    },
  };

  pushCandidateFact(facts, record, "total_current_assets", "Total Current Assets", currentAssets);
  pushCandidateFact(facts, record, "fixed_assets", "Fixed Assets", fixedAssets);
  pushCandidateFact(facts, record, "other_non_current_assets", "Other Non Current Assets", otherAssets);
  pushCandidateFact(facts, record, "total_current_liabilities", "Total Current Liabilities", currentLiabilities);
  pushCandidateFact(facts, record, "other_non_current_liabilities", "Long Term Liabilities", longTermLiabilities);
  pushCandidateFact(facts, record, "equity", "Equity", totalEquity);
  pushCandidateFact(facts, record, "retained_earnings", "Retained Earnings", retainedEarnings);

  return record;
}

function sheetRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
}

function findSheetNames(workbook: XLSX.WorkBook, patterns: RegExp[]): string[] {
  return workbook.SheetNames.filter((sheetName) =>
    patterns.some((pattern) => pattern.test(sheetName)),
  );
}

function normalizeSheetSelection(value: string | null | undefined): string {
  return normalizeLabel(value ?? "");
}

function matchClarifiedSheetName(
  candidates: string[],
  clarificationValue: string | null | undefined,
): string | null {
  const normalizedAnswer = normalizeSheetSelection(clarificationValue);
  if (!normalizedAnswer) return null;

  return (
    candidates.find((candidate) => normalizeSheetSelection(candidate) === normalizedAnswer) ??
    candidates.find((candidate) =>
      normalizeSheetSelection(candidate).includes(normalizedAnswer) ||
      normalizedAnswer.includes(normalizeSheetSelection(candidate)),
    ) ??
    null
  );
}

function normalizeSheetBaseWithoutDetail(sheetName: string): string {
  return normalizeLabel(stripSheetOrdinalPrefix(sheetName))
    .replace(/\bdetails?\b/g, " ")
    .replace(/\bdetailled\b/g, " ")
    .replace(/\bstatement of profit or loss\b/g, " ")
    .replace(/\bstatement of financial position\b/g, " ")
    .replace(/\blap(?:oran)? laba(?:\s*[\[(]?\s*rugi\s*[\)]?)?\b/g, " ")
    .replace(/\blap(?:oran)? posisi keuangan\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isDetailVariantSheetName(sheetName: string): boolean {
  return /\bdetails?\b|\bdetailled\b/i.test(stripSheetOrdinalPrefix(sheetName));
}

function preferSummarySheetOverDetailVariant(candidates: string[]): string | null {
  if (candidates.length < 2) return null;

  const uniqueCandidates = Array.from(new Set(candidates));
  const grouped = new Map<
    string,
    {
      summary: string[];
      detail: string[];
    }
  >();

  for (const candidate of uniqueCandidates) {
    const base = normalizeSheetBaseWithoutDetail(candidate);
    if (!base) return null;
    const bucket = grouped.get(base) ?? { summary: [], detail: [] };
    if (isDetailVariantSheetName(candidate)) {
      bucket.detail.push(candidate);
    } else {
      bucket.summary.push(candidate);
    }
    grouped.set(base, bucket);
  }

  if (grouped.size !== 1) return null;

  const onlyGroup = Array.from(grouped.values())[0];
  if (!onlyGroup) return null;
  if (onlyGroup.summary.length !== 1) return null;
  if (onlyGroup.detail.length === 0) return null;

  return onlyGroup.summary[0] ?? null;
}

function preferSingleCompanySummaryCandidate(
  candidates: string[],
  family: CanonicalFinanceRecord["family"],
): string | null {
  if (candidates.length < 2) return null;

  const uniqueCandidates = Array.from(new Set(candidates));
  const summaryCandidates = uniqueCandidates.filter(
    (candidate) =>
      !isDetailVariantSheetName(candidate) &&
      resolveDirectScopeLabel(candidate, family) === "company",
  );
  const detailCandidates = uniqueCandidates.filter((candidate) =>
    isDetailVariantSheetName(candidate),
  );

  if (summaryCandidates.length !== 1) return null;
  if (detailCandidates.length === 0) return null;
  if (summaryCandidates.length + detailCandidates.length !== uniqueCandidates.length) return null;

  return summaryCandidates[0] ?? null;
}

function sheetTopTextMatches(
  sheet: XLSX.WorkSheet,
  patterns: RegExp[],
  options?: { maxRows?: number; maxCols?: number },
): boolean {
  const rows = sheetRows(sheet);
  const maxRows = options?.maxRows ?? 8;
  const maxCols = options?.maxCols ?? 6;
  return rows.slice(0, maxRows).some((row) =>
    row.slice(0, maxCols).some((cell) => {
      const text = toText(cell);
      return text ? patterns.some((pattern) => pattern.test(text)) : false;
    }),
  );
}

function hasGenericPeriodHeaderRow(
  rows: unknown[][],
  options?: { maxRows?: number },
): boolean {
  const maxRows = options?.maxRows ?? 12;
  return rows.slice(0, maxRows).some((row) => {
    const normalized = row.map(normalizeLabel).filter(Boolean);
    const hasAccountLikeHeader =
      normalized.includes("account") || normalized.includes("description");
    const periodLikeCount = row.reduce<number>(
      (count, cell) => count + (periodKeyFromCell(cell) ? 1 : 0),
      0,
    );
    return hasAccountLikeHeader && periodLikeCount >= 1;
  });
}

function isGenericDirectPnlSheet(sheet: XLSX.WorkSheet): boolean {
  const rows = sheetRows(sheet);
  const hasTitle = sheetTopTextMatches(
    sheet,
    [
      ...DIRECT_SHEET_PATTERNS.pnl,
      /statement\s+of\s+profit\s+or\s+loss/i,
      /statement\s+of\s+profit\s+or\s+loss\s+and\s+other\s+comprehensive\s+income/i,
    ],
    { maxRows: 6, maxCols: 4 },
  );
  if (!hasTitle) return false;
  if (hasGenericPeriodHeaderRow(rows)) return true;

  return rows.slice(0, 24).some((row) => {
    const normalized = row.map(normalizeLabel).filter(Boolean);
    return (
      normalized.includes("income") ||
      normalized.includes("revenue") ||
      normalized.includes("expenses") ||
      normalized.includes("gross profit") ||
      normalized.includes("net profit") ||
      normalized.includes("net income")
    );
  });
}

function isGenericDirectBalanceSheetSheet(sheet: XLSX.WorkSheet): boolean {
  const rows = sheetRows(sheet);
  const hasTitle = sheetTopTextMatches(
    sheet,
    [
      ...DIRECT_SHEET_PATTERNS.balanceSheet,
      /statement\s+of\s+financial\s+position/i,
      /lap(?:oran)?\s+posisi\s+keuangan/i,
    ],
    { maxRows: 6, maxCols: 4 },
  );
  if (!hasTitle) return false;
  if (hasGenericPeriodHeaderRow(rows)) return true;

  return rows.slice(0, 24).some((row) => {
    const normalized = row.map(normalizeLabel).filter(Boolean);
    return (
      normalized.includes("assets") ||
      normalized.includes("aset") ||
      normalized.includes("liabilities") ||
      normalized.includes("equity")
    );
  });
}

function resolveSheetSelection(input: {
  family: CanonicalFinanceRecord["family"];
  clarificationKey: CanonicalFinanceClarificationKey;
  candidates: string[];
  options: ExtractionOptions;
  label: string;
  prompt: string;
  reason: string;
}): { sheetName: string | null; question: CanonicalFinanceClarificationQuestion | null } {
  const candidates = Array.from(new Set(input.candidates));
  if (candidates.length === 0) {
    return { sheetName: null, question: null };
  }

  const preferredSummarySheet = preferSummarySheetOverDetailVariant(candidates);
  if (preferredSummarySheet) {
    return { sheetName: preferredSummarySheet, question: null };
  }

  const preferredCompanySummarySheet = preferSingleCompanySummaryCandidate(
    candidates,
    input.family,
  );
  if (preferredCompanySummarySheet) {
    return { sheetName: preferredCompanySummarySheet, question: null };
  }

  const targetPeriod = resolveWorkbookPeriod(input.options.fileName, input.options.sourceContext);
  if (targetPeriod && candidates.length > 1) {
    const overlappingCandidates = candidates.filter((candidate) => {
      const candidatePeriod = parsePeriodFromFileName(stripSheetOrdinalPrefix(candidate));
      return candidatePeriod ? periodsOverlap(candidatePeriod, targetPeriod) : false;
    });
    if (overlappingCandidates.length === 1) {
      return { sheetName: overlappingCandidates[0] ?? null, question: null };
    }
  }

  const clarified = matchClarifiedSheetName(
    candidates,
    input.options.clarificationAnswers?.[input.clarificationKey],
  );
  if (clarified) {
    return { sheetName: clarified, question: null };
  }

  if (candidates.length === 1) {
    return { sheetName: candidates[0] ?? null, question: null };
  }

  return {
    sheetName: null,
    question: {
      key: input.clarificationKey,
      family: input.family,
      label: input.label,
      prompt: input.prompt,
      reason: input.reason,
      required: true,
      template_eligible: true,
      options: candidates,
    },
  };
}

function sheetCandidatesForFamily(
  workbook: XLSX.WorkBook,
  family: CanonicalFinanceRecord["family"],
): string[] {
  if (family === "pnl_month") {
    return findDirectPnlSheetNames(workbook);
  }
  if (family === "balance_sheet_month") {
    return findDirectBalanceSheetSheetNames(workbook);
  }
  return [];
}

function clarificationKeyForFamily(
  family: CanonicalFinanceRecord["family"],
): CanonicalFinanceClarificationKey | null {
  if (family === "pnl_month") return "pnl_sheet_name";
  if (family === "balance_sheet_month") return "balance_sheet_sheet_name";
  return null;
}

function shouldDeferReportDerivedFamily(
  workbook: XLSX.WorkBook,
  family: CanonicalFinanceRecord["family"],
): boolean {
  const candidates = Array.from(new Set(sheetCandidatesForFamily(workbook, family)));
  return candidates.length > 1;
}

function periodKeyFromCell(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const adjusted = new Date(value.getTime());
    const hasUtcTimeOffset =
      adjusted.getUTCHours() !== 0 ||
      adjusted.getUTCMinutes() !== 0 ||
      adjusted.getUTCSeconds() !== 0 ||
      adjusted.getUTCMilliseconds() !== 0;
    if (hasUtcTimeOffset) {
      adjusted.setUTCDate(adjusted.getUTCDate() + 1);
    }
    const year = adjusted.getUTCFullYear();
    const month = String(adjusted.getUTCMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 20_000 || value > 80_000) return null;
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && typeof parsed.y === "number" && typeof parsed.m === "number") {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}`;
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const fromName = parsePeriodFromFileName(trimmed);
    return fromName ? normalizeReportingPeriodKey(fromName) : null;
  }

  return null;
}

function findTargetColumnIndex(
  rows: unknown[][],
  targetPeriodKey: string | null,
): { rowIndex: number; columnIndex: number } | null {
  if (!targetPeriodKey) return null;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const periodColumns: number[] = [];
    const normalizedRow = row.map(normalizeLabel);
    const hasStructuredHeader =
      normalizedRow.includes("account") ||
      normalizedRow.includes("description");
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (periodKeyFromCell(row[columnIndex]) !== null) {
        periodColumns.push(columnIndex);
      }
    }

    if (periodColumns.length < 2 && !hasStructuredHeader) {
      continue;
    }

    for (const columnIndex of periodColumns) {
      if (periodKeyFromCell(row[columnIndex]) === targetPeriodKey) {
        return { rowIndex, columnIndex };
      }
    }
  }

  return null;
}

function firstStringLabel(row: unknown[]): string | null {
  for (let index = 0; index < Math.min(row.length, 4); index += 1) {
    const cell = row[index];
    if (typeof cell === "string" && cell.trim().length > 0) {
      return cell.trim();
    }
  }
  return null;
}

type MetricRowMatch = {
  rowIndex: number;
  label: string;
  labelColumnIndex: number;
};

function findMetricRows(
  rows: unknown[][],
  keywords: string[],
): MetricRowMatch[] {
  const matches: MetricRowMatch[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = row[columnIndex];
      if (typeof cell !== "string" || cell.trim().length === 0) continue;
      const label = cell.trim();
      const normalized = normalizeLabel(label);
      if (!normalized) continue;
      if (keywords.some((keyword) => normalized.includes(keyword))) {
        matches.push({
          rowIndex,
          label,
          labelColumnIndex: columnIndex,
        });
      }
    }
  }
  return matches;
}

type MonthlyColumnCandidate = {
  rowIndex: number;
  columnIndex: number;
  periodKey: string;
};

type MonthlyColumnGroup = {
  rowIndex: number;
  periodKey: string;
  columnIndices: number[];
};

function findMonthlyColumnCandidates(
  rows: unknown[][],
  targetPeriod: ReportingPeriodLike | null,
): MonthlyColumnCandidate[] {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const normalizedRow = row.map(normalizeLabel);
    const hasStructuredHeader =
      normalizedRow.includes("account") ||
      normalizedRow.includes("description") ||
      normalizedRow.includes("month");
    const periodColumns = row
      .map((cell, columnIndex) => ({
        columnIndex,
        periodKey: periodKeyFromCell(cell),
      }))
      .filter((entry): entry is { columnIndex: number; periodKey: string } => {
        if (!entry.periodKey) return false;
        return isMonthlyPeriodKey(entry.periodKey);
      })
      .filter((entry) => periodContainsMonthKey(targetPeriod, entry.periodKey));

    if (periodColumns.length === 0) {
      continue;
    }

    if (periodColumns.length < 2 && !hasStructuredHeader) {
      continue;
    }

    return periodColumns
      .map((entry) => ({
        rowIndex,
        columnIndex: entry.columnIndex,
        periodKey: entry.periodKey,
      }))
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey));
  }

  return [];
}

function groupMonthlyColumnCandidates(
  candidates: MonthlyColumnCandidate[],
): MonthlyColumnGroup[] {
  const groups = new Map<string, MonthlyColumnGroup>();
  for (const candidate of candidates) {
    const key = `${candidate.rowIndex}:${candidate.periodKey}`;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.columnIndices.includes(candidate.columnIndex)) {
        existing.columnIndices.push(candidate.columnIndex);
      }
      continue;
    }

    groups.set(key, {
      rowIndex: candidate.rowIndex,
      periodKey: candidate.periodKey,
      columnIndices: [candidate.columnIndex],
    });
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    columnIndices: [...group.columnIndices].sort((left, right) => left - right),
  }));
}

function hasDirectSheetCandidates(
  workbook: XLSX.WorkBook,
  family: CanonicalFinanceRecord["family"],
): boolean {
  return sheetCandidatesForFamily(workbook, family).length > 0;
}

function isTotalLikeMetricLabel(label: string): boolean {
  const normalized = normalizeLabel(label);
  return (
    normalized.startsWith("total ") ||
    normalized === "income" ||
    normalized === "other income" ||
    normalized === "expenses" ||
    normalized === "other expenses" ||
    normalized === "gross profit" ||
    normalized === "gross income" ||
    normalized === "operating income" ||
    normalized === "gross operating profit" ||
    normalized === "nett operating profit" ||
    normalized === "net profit" ||
    normalized === "net income" ||
    normalized === "net assets" ||
    normalized.includes("net cash flows") ||
    normalized.includes("cash and cash equivalents at beginning of period") ||
    normalized.includes("cash and cash equivalents at end of period")
  );
}

function metricKeywordMatchScore(label: string, keywords: string[]): number {
  const normalized = normalizeLabel(label);
  let best = 0;
  for (const [index, keyword] of keywords.entries()) {
    if (
      keywords === PNL_LABELS.revenue &&
      keyword === "income" &&
      normalized !== "income" &&
      normalized !== "total income"
    ) {
      continue;
    }
    const priority = keywords.length - index;
    if (normalized === keyword) {
      best = Math.max(best, 20 + priority);
      continue;
    }
    if (normalized.startsWith(`${keyword} `) || normalized.endsWith(` ${keyword}`)) {
      best = Math.max(best, 15 + priority);
      continue;
    }
    if (normalized.includes(keyword)) {
      best = Math.max(best, 5 + priority);
    }
  }
  return best;
}

function metricLabelConflictPenalty(label: string, keywords: string[]): number {
  const normalized = normalizeLabel(label);

  if (keywords === PNL_LABELS.revenue) {
    if (/\bgross\b|\bprofit\b|\bcost\b|\bexpense\b/.test(normalized)) {
      return -40;
    }
    if (/\bother\b|\binterest\b|\brounding\b|\bexchange\b|\bforex\b|\bnon operating\b/.test(normalized)) {
      return -25;
    }
    if (
      normalized.includes("income") &&
      normalized !== "income" &&
      normalized !== "total income" &&
      normalized !== "trading income"
    ) {
      return -20;
    }
  }

  if (keywords === PNL_LABELS.cost_of_sales) {
    if (/\bgross\b|\bprofit\b|\brevenue\b|\bincome\b|\bexpense\b/.test(normalized)) {
      return -35;
    }
  }

  if (keywords === PNL_LABELS.operating_expenses) {
    if (/\bgross\b|\bprofit\b|\brevenue\b|\bincome\b/.test(normalized)) {
      return -35;
    }
  }

  if (keywords === PNL_LABELS.net_income) {
    if (/\bgross\b|\brevenue\b|\bcost\b|\bexpense\b/.test(normalized)) {
      return -30;
    }
  }

  if (keywords === BS_SUMMARY_LABELS.total_liabilities) {
    if (/\bcapital\b|\bequity\b/.test(normalized)) {
      return -50;
    }
    if (/\bcurrent\b|\bother\b|\blong\s*term\b|\baffiliated\b/.test(normalized)) {
      return -35;
    }
  }

  if (keywords === BS_SUMMARY_LABELS.equity) {
    if (/\bliabilit(?:y|ies)\b/.test(normalized)) {
      return -50;
    }
  }

  if (keywords === BS_SUMMARY_LABELS.retained_earnings) {
    if (/\bliabilit(?:y|ies)\b/.test(normalized)) {
      return -30;
    }
  }

  return 0;
}

function selectBestMetricRow(
  rows: unknown[][],
  keywords: string[],
  preferredColumnIndex?: number | null,
): MetricRowMatch | null {
  const matches = findMetricRows(rows, keywords);
  if (matches.length === 0) return null;

  let best: { match: MetricRowMatch; score: number } | null = null;
  for (const match of matches) {
    const row = rows[match.rowIndex] ?? [];
    const preferredValue =
      typeof preferredColumnIndex === "number" &&
      preferredColumnIndex >= 0 &&
      preferredColumnIndex < row.length
        ? parseNumber(row[preferredColumnIndex])
        : null;
    const preferredValueScore =
      preferredValue === null ? 0 : Math.abs(preferredValue) > 0.000001 ? 20 : -5;
    const numericAfterLabel = row.some(
      (cell, columnIndex) =>
        columnIndex > match.labelColumnIndex && parseNumber(cell) !== null,
    );
    const keywordScore = metricKeywordMatchScore(match.label, keywords);
    const score =
      (preferredValue !== null ? 100 : 0) +
      preferredValueScore +
      (isTotalLikeMetricLabel(match.label) ? 30 : 0) +
      (numericAfterLabel ? 1 : 0) +
      keywordScore +
      metricLabelConflictPenalty(match.label, keywords);

    if (!best || score > best.score || (score === best.score && match.rowIndex > best.match.rowIndex)) {
      best = { match, score };
    }
  }

  return best?.match ?? null;
}

function matrixMetric(
  rows: unknown[][],
  sheet: XLSX.WorkSheet,
  fileName: string,
  sheetName: string,
  labelKeywords: string[],
  columnIndex: number,
): CandidateMetric {
  const found = selectBestMetricRow(rows, labelKeywords, columnIndex);
  if (!found) return { value: null, sourceRef: null };

  const row = rows[found.rowIndex] ?? [];
  const value = parseNumber(row[columnIndex]);
  const ref = XLSX.utils.encode_cell({ r: found.rowIndex, c: columnIndex });
  const cell = sheet[ref] as WorkbookCell;
  return {
    value,
    sourceRef: makeSourceRef(
      fileName,
      sheetName,
      ref,
      found.rowIndex + 1,
      typeof cell?.f === "string" ? cell.f : null,
      found.label,
    ),
  };
}

function summaryMetric(
  rows: unknown[][],
  sheet: XLSX.WorkSheet,
  fileName: string,
  sheetName: string,
  keywords: string[],
  preferredColumnIndex?: number | null,
): CandidateMetric {
  const found = selectBestMetricRow(rows, keywords, preferredColumnIndex);
  if (!found) return { value: null, sourceRef: null };
  const row = rows[found.rowIndex] ?? [];
  if (
    typeof preferredColumnIndex === "number" &&
    preferredColumnIndex >= 0 &&
    preferredColumnIndex < row.length &&
    preferredColumnIndex > found.labelColumnIndex
  ) {
    const ref = XLSX.utils.encode_cell({ r: found.rowIndex, c: preferredColumnIndex });
    const cell = sheet[ref] as WorkbookCell;
    return {
      value: parseNumber(row[preferredColumnIndex]),
      sourceRef: makeSourceRef(
        fileName,
        sheetName,
        ref,
        found.rowIndex + 1,
        typeof cell?.f === "string" ? cell.f : null,
        found.label,
      ),
    };
  }

  const numericColumns = row
    .map((cell, columnIndex) => ({ columnIndex, value: parseNumber(cell) }))
    .filter(
      (candidate) =>
        candidate.columnIndex > found.labelColumnIndex && candidate.value !== null,
    );
  if (numericColumns.length !== 1) {
    return {
      value: null,
      sourceRef: makeSourceRef(
        fileName,
        sheetName,
        `${found.rowIndex + 1}:${found.rowIndex + 1}`,
        found.rowIndex + 1,
        null,
        found.label,
      ),
    };
  }

  const { columnIndex, value } = numericColumns[0]!;
  const ref = XLSX.utils.encode_cell({ r: found.rowIndex, c: columnIndex });
  const cell = sheet[ref] as WorkbookCell;
  return {
    value,
    sourceRef: makeSourceRef(
      fileName,
      sheetName,
      ref,
      found.rowIndex + 1,
      typeof cell?.f === "string" ? cell.f : null,
      found.label,
    ),
  };
}

function hasExplicitZeroPlaceholderMetricRow(
  rows: unknown[][],
  labelKeywords: string[],
  columnIndex: number,
): boolean {
  const found = selectBestMetricRow(rows, labelKeywords, columnIndex);
  if (!found) return false;

  const row = rows[found.rowIndex] ?? [];
  const numericValues = row
    .slice(found.labelColumnIndex + 1)
    .map((cell) => parseNumber(cell))
    .filter((value): value is number => value !== null);

  if (numericValues.length === 0) return false;
  return numericValues.some((value) => Math.abs(value) <= 0.000001) &&
    numericValues.every((value) => Math.abs(value) <= 0.000001);
}

function findLabelCellBeforeValue(
  row: unknown[],
  valueColumnIndex: number,
): { label: string; columnIndex: number } | null {
  const lastLabelColumn = valueColumnIndex - 1;
  if (lastLabelColumn < 0) return null;

  for (let columnIndex = lastLabelColumn; columnIndex >= 0; columnIndex -= 1) {
    const cell = row[columnIndex];
    if (typeof cell === "string" && cell.trim().length > 0) {
      return {
        label: cell.trim(),
        columnIndex,
      };
    }
  }

  return null;
}

function columnHasNumericContent(
  rows: unknown[][],
  columnIndex: number,
  startRowIndex: number,
  endRowIndex = Math.min(rows.length, startRowIndex + 120),
): boolean {
  for (let rowIndex = startRowIndex; rowIndex < endRowIndex; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (parseNumber(row[columnIndex]) !== null) return true;
  }
  return false;
}

function findCompanionValueColumns(
  rows: unknown[][],
  headerRowIndex: number,
  primaryColumnIndex: number,
): number[] {
  const headerRow = rows[headerRowIndex] ?? [];
  const headerLabel = normalizeLabel(headerRow[primaryColumnIndex]);
  if (!headerLabel) {
    return [primaryColumnIndex];
  }

  const columns = headerRow
    .map((cell, columnIndex) => ({
      columnIndex,
      headerLabel: normalizeLabel(cell),
    }))
    .filter((entry) => entry.headerLabel === headerLabel)
    .filter((entry) => columnHasNumericContent(rows, entry.columnIndex, headerRowIndex + 1))
    .map((entry) => entry.columnIndex);

  if (!columns.includes(primaryColumnIndex)) {
    columns.push(primaryColumnIndex);
  }

  return Array.from(new Set(columns)).sort((left, right) => left - right);
}

function summaryMetricFromColumns(
  rows: unknown[][],
  sheet: XLSX.WorkSheet,
  fileName: string,
  sheetName: string,
  keywords: string[],
  columnIndices: readonly number[],
): CandidateMetric {
  let fallbackRef: CanonicalFinanceSourceRef | null = null;
  for (const columnIndex of columnIndices) {
    const metric = summaryMetric(rows, sheet, fileName, sheetName, keywords, columnIndex);
    if (metric.value !== null) return metric;
    if (!fallbackRef && metric.sourceRef) {
      fallbackRef = metric.sourceRef;
    }
  }

  return {
    value: null,
    sourceRef: fallbackRef,
  };
}

function extractSheetStatementLinesFromColumns(input: {
  rows: unknown[][];
  sheet: XLSX.WorkSheet;
  fileName: string;
  sheetName: string;
  valueColumnIndices: readonly number[];
  headerRowIndex: number;
}): CanonicalStatementLine[] {
  const merged = input.valueColumnIndices.flatMap((valueColumnIndex) =>
    extractSheetStatementLines({
      rows: input.rows,
      sheet: input.sheet,
      fileName: input.fileName,
      sheetName: input.sheetName,
      valueColumnIndex,
      headerRowIndex: input.headerRowIndex,
    }),
  );

  return merged
    .sort((left, right) => {
      const leftRowIndex = left.source_ref.row_index ?? Number.MAX_SAFE_INTEGER;
      const rightRowIndex = right.source_ref.row_index ?? Number.MAX_SAFE_INTEGER;
      const rowDelta = leftRowIndex - rightRowIndex;
      if (rowDelta !== 0) return rowDelta;
      return (left.source_ref.cell_range ?? "").localeCompare(right.source_ref.cell_range ?? "");
    })
    .map((line, index) => ({
      ...line,
      row_order: index + 1,
    }));
}

function extractAccountCode(label: string): string | null {
  const match = label.trim().match(/^([0-9]{3,6}[A-Z]?)\s*-\s*/i);
  return match?.[1] ?? null;
}

function normalizeStatementLineLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

function looksLikeCodePrefixedLabel(label: string): boolean {
  return /^[A-Z]{2,}[0-9]{4,}\b/i.test(label.trim());
}

function isStatementTotalLabel(label: string): boolean {
  const normalized = normalizeLabel(label);
  return (
    normalized.startsWith("total ") ||
    normalized === "income" ||
    normalized === "cost of sales" ||
    normalized === "cost of revenue" ||
    normalized === "other income" ||
    normalized === "expenses" ||
    normalized === "other expenses" ||
    normalized === "gross profit" ||
    normalized === "gross income" ||
    normalized === "operating income" ||
    normalized === "gross operating profit" ||
    normalized === "nett operating profit" ||
    normalized === "operating profit" ||
    normalized === "net profit" ||
    normalized === "net income" ||
    normalized === "assets" ||
    normalized === "current assets" ||
    normalized === "liabilities" ||
    normalized === "current liabilities" ||
    normalized === "equity" ||
    normalized === "liabilities + equity" ||
    normalized === "net assets" ||
    normalized.includes("net cash flows") ||
    normalized.includes("net change in cash") ||
    normalized.includes("cash and cash equivalents at beginning of period") ||
    normalized.includes("cash and cash equivalents at end of period")
  );
}

function classifyStatementLineKind(input: {
  label: string;
  depth: number;
  value: number | null;
  formula: string | null;
}): CanonicalStatementLine["line_kind"] {
  if (input.value === null) {
    return input.depth === 0 ? "section" : "group";
  }
  if (isStatementTotalLabel(input.label)) {
    return "total";
  }
  if (input.formula && input.depth <= 1) {
    return "total";
  }
  return "line_item";
}

function formatSourceRange(labelRef: string | null, valueRef: string | null): string | null {
  if (labelRef && valueRef && labelRef !== valueRef) {
    return `${labelRef}:${valueRef}`;
  }
  return valueRef ?? labelRef;
}

function findHeaderRowIndexForColumn(
  rows: unknown[][],
  valueColumnIndex: number,
  targetPeriodKey: string | null,
): number {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const periodKey = periodKeyFromCell(row[valueColumnIndex]);
    if (periodKey && (!targetPeriodKey || periodKey === targetPeriodKey)) {
      return rowIndex;
    }

    const headerLabel = normalizeLabel(row[valueColumnIndex]);
    if (
      headerLabel === "this month" ||
      headerLabel === "current month" ||
      headerLabel === "this period" ||
      headerLabel === "month" ||
      headerLabel === "ytd"
    ) {
      return rowIndex;
    }
  }
  return rows.length > 0 ? Math.min(2, rows.length - 1) : 0;
}

function extractSheetStatementLines(input: {
  rows: unknown[][];
  sheet: XLSX.WorkSheet;
  fileName: string;
  sheetName: string;
  valueColumnIndex: number;
  headerRowIndex: number;
}): CanonicalStatementLine[] {
  const lines: CanonicalStatementLine[] = [];
  let currentSection: string | null = null;
  let currentGroup: string | null = null;

  for (let rowIndex = input.headerRowIndex + 1; rowIndex < input.rows.length; rowIndex += 1) {
    const row = input.rows[rowIndex] ?? [];
    const labelCell = findLabelCellBeforeValue(row, input.valueColumnIndex);
    const value = parseNumber(row[input.valueColumnIndex]);

    if (!labelCell && value === null) {
      continue;
    }

    const label = labelCell ? normalizeStatementLineLabel(labelCell.label) : "";
    if (!label && value === null) {
      continue;
    }

    if (label && /^account$/i.test(label)) {
      continue;
    }

    if (value === null && looksLikeCodePrefixedLabel(label)) {
      continue;
    }

    const depth = labelCell?.columnIndex ?? 0;
    const valueRef = XLSX.utils.encode_cell({ r: rowIndex, c: input.valueColumnIndex });
    const labelRef =
      typeof labelCell?.columnIndex === "number"
        ? XLSX.utils.encode_cell({ r: rowIndex, c: labelCell.columnIndex })
        : null;
    const valueCell = input.sheet[valueRef] as WorkbookCell;
    const formula = typeof valueCell?.f === "string" ? valueCell.f : null;
    const lineKind = classifyStatementLineKind({
      label,
      depth,
      value,
      formula,
    });

    if (lineKind === "section") {
      currentSection = label || currentSection;
      currentGroup = null;
    } else if (lineKind === "group") {
      if (depth <= 1) {
        currentGroup = label || currentGroup;
      } else if (!currentGroup) {
        currentGroup = label || currentGroup;
      }
    }

    const shouldClearGroupLabel =
      lineKind === "total" && (depth <= 1 || isStatementTotalLabel(label));

    lines.push({
      row_order: lines.length + 1,
      label: label || `Row ${rowIndex + 1}`,
      normalized_label: normalizeLabel(label),
      account_code: label ? extractAccountCode(label) : null,
      section_label: lineKind === "section" ? label : currentSection,
      group_label:
        lineKind === "group"
          ? depth > 1
            ? currentGroup
            : null
          : lineKind === "section"
            ? null
            : shouldClearGroupLabel
              ? null
              : depth > 0
              ? currentGroup
              : null,
      depth,
      line_kind: lineKind,
      value,
      source_ref: makeSourceRef(
        input.fileName,
        input.sheetName,
        formatSourceRange(labelRef, valueRef),
        rowIndex + 1,
        formula,
        label || null,
      ),
    });
  }

  return lines;
}

function extractReportStatementLines(
  report: ExtractedReport,
  fileName: string,
): CanonicalStatementLine[] {
  return report.line_items.map((item, index) => {
    const value = pickLineValue(item, report);
    const refs = Object.values(item.source.columns ?? {});
    const primaryRef = refs[0] ?? null;
    const formula = null;
    return {
      row_order: index + 1,
      label: item.account_name,
      normalized_label: normalizeLabel(item.account_name),
      account_code: item.account_number ?? extractAccountCode(item.account_name),
      section_label: item.section || null,
      group_label: item.subsection ?? null,
      depth: item.depth,
      line_kind:
        value === null
          ? item.depth === 0
            ? "section"
            : "group"
          : item.is_total
            ? "total"
            : "line_item",
      value,
      source_ref: makeSourceRef(
        fileName,
        item.source.sheet,
        primaryRef,
        item.source.row,
        formula,
        item.account_name,
      ),
    };
  });
}

function normalizedStatementSection(line: CanonicalStatementLine): string {
  return normalizeLabel(line.section_label ?? "");
}

function normalizedStatementGroup(line: CanonicalStatementLine): string {
  return normalizeLabel(line.group_label ?? "");
}

function normalizedStatementLine(line: CanonicalStatementLine): string {
  return normalizeLabel(line.label);
}

function isStatementNumericLine(line: CanonicalStatementLine): boolean {
  return line.line_kind === "line_item" && line.value !== null;
}

function sumStatementLineValues(
  lines: CanonicalStatementLine[],
  predicate: (line: CanonicalStatementLine) => boolean,
): number | null {
  const matching = lines.filter((line) => isStatementNumericLine(line) && predicate(line));
  if (matching.length === 0) return null;
  return Number(
    matching.reduce((sum, line) => sum + (line.value ?? 0), 0).toFixed(2),
  );
}

function metricNeedsStatementFallback(
  currentValue: number | null,
  derivedValue: number | null,
): boolean {
  if (derivedValue === null) return currentValue === null;
  if (currentValue === null) return true;
  return Math.abs(currentValue) < 0.000001 && Math.abs(derivedValue) > 0.000001;
}

function withStatementFallback(
  metric: CandidateMetric,
  derivedValue: number | null,
): CandidateMetric {
  if (!metricNeedsStatementFallback(metric.value, derivedValue)) {
    return metric;
  }

  return {
    ...metric,
    value: derivedValue,
  };
}

function metricWasResolvedFromStatementLines(
  currentValue: number | null,
  derivedValue: number | null,
): boolean {
  if (derivedValue === null) return false;
  if (currentValue === null) return true;
  return Math.abs(currentValue) < 0.000001 && Math.abs(derivedValue) > 0.000001;
}

function derivePnlMetricsFromStatementLines(lines: CanonicalStatementLine[]): {
  revenue: number | null;
  costOfSales: number | null;
  grossProfit: number | null;
  otherIncome: number | null;
  otherExpenses: number | null;
  operatingExpenses: number | null;
  depreciationAmortization: number | null;
  interestExpense: number | null;
  taxExpense: number | null;
  netIncome: number | null;
} {
  const statementTotalValue = (labels: readonly string[]): number | null => {
    const matches = lines.filter((line) => {
      if (line.line_kind !== "total" || line.value === null) return false;
      const normalized = normalizedStatementLine(line);
      return labels.some((keyword) =>
        normalized === keyword ||
        normalized.startsWith(`${keyword} `) ||
        normalized.endsWith(` ${keyword}`),
      );
    });
    if (matches.length === 0) return null;
    const nonZeroMatches = matches.filter((line) => Math.abs(line.value ?? 0) > 0.000001);
    const candidate = (nonZeroMatches.length > 0 ? nonZeroMatches : matches)[
      (nonZeroMatches.length > 0 ? nonZeroMatches : matches).length - 1
    ];
    if (!candidate) return null;
    if (Math.abs(candidate.value ?? 0) <= 0.000001) return null;
    return candidate.value ?? null;
  };
  const revenueSectionLine = (line: CanonicalStatementLine) => {
    const section = normalizedStatementSection(line);
    const label = normalizedStatementLine(line);
    return (
      (section.includes("trading income") || section.includes("revenue")) &&
      !section.includes("non operating") &&
      !section.includes("other income")
    ) || (
      (label.includes("revenue") || label.includes("trading income") || label.includes("pendapatan")) &&
      !label.includes("other income")
    );
  };
  const costOfSalesLine = (line: CanonicalStatementLine) => {
    const label = normalizedStatementLine(line);
    const group = normalizedStatementGroup(line);
    return (
      label.includes("cogs") ||
      label.includes("cost of sales") ||
      label.includes("cost of revenue") ||
      group.includes("cogs") ||
      group.includes("cost of sales")
    );
  };
  const operatingExpenseSectionLine = (line: CanonicalStatementLine) => {
    const section = normalizedStatementSection(line);
    return (
      section.includes("operating expenses") ||
      section.includes("operational expenses") ||
      section.includes("payroll") ||
      section.includes("benefits")
    );
  };
  const revenue =
    statementTotalValue(PNL_LABELS.revenue.filter((keyword) => keyword !== "income")) ??
    sumStatementLineValues(lines, (line) => revenueSectionLine(line));
  const costOfSales =
    statementTotalValue(PNL_LABELS.cost_of_sales) ??
    sumStatementLineValues(lines, (line) => costOfSalesLine(line));
  const otherIncome =
    statementTotalValue(PNL_LABELS.other_income) ??
    sumStatementLineValues(lines, (line) =>
      PNL_LABELS.other_income.some((keyword) => normalizedStatementLine(line).includes(keyword)),
    );
  const otherExpenses =
    statementTotalValue(PNL_LABELS.other_expenses) ??
    sumStatementLineValues(lines, (line) =>
      PNL_LABELS.other_expenses.some((keyword) => normalizedStatementLine(line).includes(keyword)),
    );
  const operatingExpenses =
    statementTotalValue(PNL_LABELS.operating_expenses) ??
    sumStatementLineValues(lines, (line) => operatingExpenseSectionLine(line));
  const depreciationAmortization =
    statementTotalValue(PNL_LABELS.depreciation_amortization) ??
    sumStatementLineValues(lines, (line) =>
      PNL_LABELS.depreciation_amortization.some((keyword) =>
        normalizedStatementLine(line).includes(keyword),
      ),
    );
  const interestExpense =
    statementTotalValue(PNL_LABELS.interest_expense) ??
    sumStatementLineValues(lines, (line) =>
      PNL_LABELS.interest_expense.some((keyword) =>
        normalizedStatementLine(line).includes(keyword),
      ),
    );
  const taxExpense =
    statementTotalValue(PNL_LABELS.tax_expense) ??
    sumStatementLineValues(lines, (line) =>
      PNL_LABELS.tax_expense.some((keyword) => normalizedStatementLine(line).includes(keyword)),
    );
  const isOperatingExpenseSectionLine = (line: CanonicalStatementLine) =>
    operatingExpenseSectionLine(line);
  const isOtherExpenseLine = (line: CanonicalStatementLine) =>
    PNL_LABELS.other_expenses.some((keyword) => normalizedStatementLine(line).includes(keyword));
  const isBelowOperatingCharge = (line: CanonicalStatementLine, labels: readonly string[]) =>
    !isOperatingExpenseSectionLine(line) &&
    !isOtherExpenseLine(line) &&
    labels.some((keyword) => normalizedStatementLine(line).includes(keyword));
  const belowOperatingDepreciationAmortization = sumStatementLineValues(lines, (line) =>
    isBelowOperatingCharge(line, PNL_LABELS.depreciation_amortization),
  );
  const belowOperatingInterestExpense = sumStatementLineValues(lines, (line) =>
    isBelowOperatingCharge(line, PNL_LABELS.interest_expense),
  );
  const belowOperatingTaxExpense = sumStatementLineValues(lines, (line) =>
    isBelowOperatingCharge(line, PNL_LABELS.tax_expense),
  );
  const grossProfit =
    statementTotalValue(PNL_LABELS.gross_profit) ??
    (revenue !== null && costOfSales !== null ? Number((revenue - costOfSales).toFixed(2)) : null);
  const netIncome =
    statementTotalValue(PNL_LABELS.net_income) ??
    (grossProfit !== null && operatingExpenses !== null
      ? Number(
          (
            grossProfit +
            (otherIncome ?? 0) -
            (otherExpenses ?? 0) -
            operatingExpenses -
            (belowOperatingDepreciationAmortization ?? 0) -
            (belowOperatingInterestExpense ?? 0) -
            (belowOperatingTaxExpense ?? 0)
          ).toFixed(2),
        )
      : null);

  return {
    revenue,
    costOfSales,
    grossProfit,
    otherIncome,
    otherExpenses,
    operatingExpenses,
    depreciationAmortization,
    interestExpense,
    taxExpense,
    netIncome,
  };
}

function deriveBalanceSheetMetricsFromStatementLines(lines: CanonicalStatementLine[]): {
  cashAndEquivalents: number | null;
  inventory: number | null;
  accountsReceivable: number | null;
  totalCurrentAssets: number | null;
  fixedAssets: number | null;
  totalAssets: number | null;
  accountsPayable: number | null;
  totalCurrentLiabilities: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  retainedEarnings: number | null;
} {
  const assets = (line: CanonicalStatementLine) =>
    normalizedStatementSection(line) === "assets";
  const liabilities = (line: CanonicalStatementLine) =>
    normalizedStatementSection(line) === "liabilities";
  const currentLiabilities = (line: CanonicalStatementLine) => {
    if (!liabilities(line)) return false;
    const label = normalizedStatementLine(line);
    const group = normalizedStatementGroup(line);
    const hasNonCurrentMarker =
      group.includes("non current") ||
      group.includes("long term") ||
      label.includes("non current") ||
      label.includes("long term") ||
      label.includes("long-term") ||
      label.includes("term loan") ||
      label.includes("bank loan") ||
      label.includes("lease liability");
    return !hasNonCurrentMarker;
  };
  const equitySection = (line: CanonicalStatementLine) =>
    normalizedStatementSection(line) === "equity";
  const fixedAssetLine = (line: CanonicalStatementLine) =>
    normalizedStatementGroup(line).includes("fixed assets");
  const cashLikeLine = (line: CanonicalStatementLine) => {
    const label = normalizedStatementLine(line);
    const group = normalizedStatementGroup(line);
    return (
      group.includes("bank") ||
      label.includes("cash") ||
      label.includes("bank") ||
      label.includes("petty cash") ||
      label.includes("small change")
    );
  };

  const cashAndEquivalents = sumStatementLineValues(
    lines,
    (line) => assets(line) && cashLikeLine(line),
  );
  const inventory = sumStatementLineValues(
    lines,
    (line) => assets(line) && normalizedStatementLine(line).includes("inventory"),
  );
  const accountsReceivable = sumStatementLineValues(
    lines,
    (line) => assets(line) && normalizedStatementLine(line).includes("accounts receivable"),
  );
  const totalCurrentAssets = sumStatementLineValues(
    lines,
    (line) => assets(line) && !fixedAssetLine(line),
  );
  const fixedAssets = sumStatementLineValues(
    lines,
    (line) => assets(line) && fixedAssetLine(line),
  );
  const totalAssets = sumStatementLineValues(lines, assets);
  const accountsPayable = sumStatementLineValues(
    lines,
    (line) => liabilities(line) && normalizedStatementLine(line).includes("accounts payable"),
  );
  const totalCurrentLiabilities = sumStatementLineValues(lines, currentLiabilities);
  const totalLiabilities = sumStatementLineValues(lines, liabilities);
  const retainedEarnings = sumStatementLineValues(
    lines,
    (line) => equitySection(line) && normalizedStatementLine(line).includes("retained earnings"),
  );
  const equity = sumStatementLineValues(lines, equitySection);

  return {
    cashAndEquivalents,
    inventory,
    accountsReceivable,
    totalCurrentAssets,
    fixedAssets,
    totalAssets,
    accountsPayable,
    totalCurrentLiabilities,
    totalLiabilities,
    equity,
    retainedEarnings,
  };
}

function computeBalanceSheetEquationTolerance(
  totalAssets: number,
  totalLiabilities: number,
  equity: number,
): number {
  const scaleBase = Math.max(
    Math.abs(totalAssets),
    Math.abs(totalLiabilities + equity),
  );
  return Math.max(1, scaleBase * 0.00001);
}

function extractDirectPnl(
  workbook: XLSX.WorkBook,
  options: ExtractionOptions,
  facts: CanonicalFactCandidate[],
  clarificationQuestions: CanonicalFinanceClarificationQuestion[],
): CanonicalPnlMonth[] {
  const workbookPeriod = resolveWorkbookPeriod(options.fileName, options.sourceContext);
  const hospitalitySheetNames = findHospitalityDirectPnlSheetNames(workbook);
  const candidateSheetNames = findDirectPnlSheetNames(workbook);

  let sheetNames: string[] = [];
  if (hospitalitySheetNames.length > 0) {
    sheetNames = hospitalitySheetNames;
  } else {
    const selection = resolveSheetSelection({
      family: "pnl_month",
      clarificationKey: "pnl_sheet_name",
      candidates: candidateSheetNames,
      options,
      label: "Monthly P&L sheet",
      prompt: "Which workbook tab contains the monthly profit and loss statement we should use?",
      reason: "multiple_pnl_sheets_detected",
    });
    if (selection.question) clarificationQuestions.push(selection.question);
    if (selection.sheetName) {
      sheetNames = [selection.sheetName];
    }
  }

  if (sheetNames.length === 0) {
    return [];
  }

  const records: CanonicalPnlMonth[] = [];
  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = sheetRows(sheet);
    const sheetPeriod = parsePeriodFromFileName(stripSheetOrdinalPrefix(sheetName));
    const currency = inferWorkbookCurrency(workbook, sheetName, options.reports);
    const scopeLabel = resolveDirectScopeLabel(sheetName, "pnl_month");
    const monthlyColumns = findMonthlyColumnCandidates(rows, workbookPeriod ?? sheetPeriod ?? null);
    const targetColumns =
      monthlyColumns.length > 0
        ? monthlyColumns
        : (() => {
            const fallbackPeriod = sheetPeriod ?? workbookPeriod;
            const preferredColumnIndex =
              findSummaryTargetColumnIndex(
                rows,
                fallbackPeriod ? normalizeReportingPeriodKey(fallbackPeriod) : null,
              ) ??
              inferDominantNumericColumnIndex(rows);
            if (preferredColumnIndex === null || !fallbackPeriod) return [];
            return [
              {
                rowIndex: findHeaderRowIndexForColumn(
                  rows,
                  preferredColumnIndex,
                  normalizeReportingPeriodKey(fallbackPeriod),
                ),
                columnIndex: preferredColumnIndex,
                periodKey: normalizeReportingPeriodKey(fallbackPeriod),
              },
            ];
          })();

    for (const { columnIndex, rowIndex, periodKey } of targetColumns) {
    const recordPeriod = monthPeriodFromKey(periodKey);
    const statementLines = extractSheetStatementLines({
      rows,
      sheet,
      fileName: options.fileName,
      sheetName,
      valueColumnIndex: columnIndex,
      headerRowIndex: rowIndex,
    });

    const revenue = matrixMetric(rows, sheet, options.fileName, sheetName, PNL_LABELS.revenue, columnIndex);
    const costOfSales = matrixMetric(rows, sheet, options.fileName, sheetName, PNL_LABELS.cost_of_sales, columnIndex);
    const grossProfit = matrixMetric(rows, sheet, options.fileName, sheetName, PNL_LABELS.gross_profit, columnIndex);
    const grossOperatingIncome = matrixMetric(
      rows,
      sheet,
      options.fileName,
      sheetName,
      PNL_AUX_LABELS.gross_operating_income,
      columnIndex,
    );
    const otherIncome = matrixMetric(rows, sheet, options.fileName, sheetName, PNL_LABELS.other_income, columnIndex);
    const otherExpenses = matrixMetric(rows, sheet, options.fileName, sheetName, PNL_LABELS.other_expenses, columnIndex);
    const operatingExpenses = matrixMetric(rows, sheet, options.fileName, sheetName, PNL_LABELS.operating_expenses, columnIndex);
    const depreciationAmortization = matrixMetric(
      rows,
      sheet,
      options.fileName,
      sheetName,
      PNL_LABELS.depreciation_amortization,
      columnIndex,
    );
    const interestExpense = matrixMetric(
      rows,
      sheet,
      options.fileName,
      sheetName,
      PNL_LABELS.interest_expense,
      columnIndex,
    );
    const taxExpense = matrixMetric(rows, sheet, options.fileName, sheetName, PNL_LABELS.tax_expense, columnIndex);
    const netIncome = matrixMetric(rows, sheet, options.fileName, sheetName, PNL_LABELS.net_income, columnIndex);
    const derivedMetrics = derivePnlMetricsFromStatementLines(statementLines);

    let resolvedRevenue = withStatementFallback(revenue, derivedMetrics.revenue);
    let resolvedCostOfSales = withStatementFallback(costOfSales, derivedMetrics.costOfSales);
    let resolvedGrossProfit = withStatementFallback(grossProfit, derivedMetrics.grossProfit);
    const resolvedOtherIncome = withStatementFallback(otherIncome, derivedMetrics.otherIncome);
    const resolvedOtherExpenses = withStatementFallback(otherExpenses, derivedMetrics.otherExpenses);
    let resolvedOperatingExpenses = withStatementFallback(
      operatingExpenses,
      derivedMetrics.operatingExpenses,
    );
    const resolvedDepreciationAmortization = withStatementFallback(
      depreciationAmortization,
      derivedMetrics.depreciationAmortization,
    );
    const resolvedInterestExpense = withStatementFallback(
      interestExpense,
      derivedMetrics.interestExpense,
    );
    const resolvedTaxExpense = withStatementFallback(taxExpense, derivedMetrics.taxExpense);
    const resolvedNetIncome = withStatementFallback(netIncome, derivedMetrics.netIncome);
    const revenueSourceLabel = normalizeLabel(resolvedRevenue.sourceRef?.note ?? "");
    const costOfSalesSourceLabel = normalizeLabel(resolvedCostOfSales.sourceRef?.note ?? "");

    if (
      derivedMetrics.revenue !== null &&
      resolvedRevenue.value !== null &&
      (revenueSourceLabel === "income" || revenueSourceLabel === "total income") &&
      resolvedOtherIncome.value !== null &&
      Math.abs(resolvedRevenue.value - (derivedMetrics.revenue + resolvedOtherIncome.value)) <= 1
    ) {
      resolvedRevenue = {
        ...resolvedRevenue,
        value: derivedMetrics.revenue,
      };
    }

    if (
      derivedMetrics.costOfSales !== null &&
      resolvedCostOfSales.value !== null &&
      !isTotalLikeMetricLabel(costOfSalesSourceLabel) &&
      Math.abs(resolvedCostOfSales.value - derivedMetrics.costOfSales) > 1
    ) {
      resolvedCostOfSales = {
        ...resolvedCostOfSales,
        value: derivedMetrics.costOfSales,
      };
    }

    if (
      resolvedRevenue.value !== null &&
      (revenueSourceLabel === "income" || revenueSourceLabel === "total income") &&
      resolvedOtherIncome.value !== null &&
      resolvedGrossProfit.value !== null &&
      resolvedCostOfSales.value !== null
    ) {
      const operatingRevenue = Number(
        (resolvedGrossProfit.value + resolvedCostOfSales.value).toFixed(2),
      );
      if (
        Math.abs(
          resolvedRevenue.value - (operatingRevenue + resolvedOtherIncome.value),
        ) <= 1
      ) {
        resolvedRevenue = {
          ...resolvedRevenue,
          value: operatingRevenue,
        };
      }
    }

    if (
      resolvedRevenue.value !== null &&
      (revenueSourceLabel === "income" || revenueSourceLabel === "total income") &&
      resolvedOtherIncome.value !== null &&
      resolvedGrossProfit.value !== null &&
      resolvedCostOfSales.value === null &&
      Math.abs(resolvedRevenue.value - (resolvedGrossProfit.value + resolvedOtherIncome.value)) <= 1
    ) {
      resolvedRevenue = {
        ...resolvedRevenue,
        value: resolvedGrossProfit.value,
      };
    }

    if (
      resolvedRevenue.value !== null &&
      resolvedCostOfSales.value !== null &&
      resolvedGrossProfit.value !== null
    ) {
      const grossProfitDelta = Math.abs(
        resolvedGrossProfit.value - (resolvedRevenue.value - resolvedCostOfSales.value),
      );
      if (grossProfitDelta > 1) {
        const computedGrossProfit = Number(
          (resolvedRevenue.value - resolvedCostOfSales.value).toFixed(2),
        );
        resolvedGrossProfit = {
          ...resolvedGrossProfit,
          value:
            derivedMetrics.grossProfit !== null &&
            Math.abs(derivedMetrics.grossProfit - computedGrossProfit) <= 1
              ? derivedMetrics.grossProfit
              : computedGrossProfit,
        };
      }
    }

    if (
      resolvedOperatingExpenses.value === null &&
      resolvedGrossProfit.value !== null &&
      grossOperatingIncome.value !== null
    ) {
      resolvedOperatingExpenses = {
        value: Number((resolvedGrossProfit.value - grossOperatingIncome.value).toFixed(2)),
        sourceRef: grossOperatingIncome.sourceRef,
      };
    }

    const warnings: string[] = [];
    if (metricNeedsStatementFallback(revenue.value, derivedMetrics.revenue)) {
      warnings.push("pnl_totals_derived_from_statement_lines");
    }
    if (resolvedRevenue.value === null) warnings.push("pnl_revenue_missing");
    if (resolvedNetIncome.value === null) warnings.push("pnl_net_income_missing");
    if (
      resolvedRevenue.value !== null &&
      resolvedOtherIncome.value !== null &&
      Math.abs(resolvedRevenue.value - resolvedOtherIncome.value) <= 1 &&
      (revenueSourceLabel === "income" || revenueSourceLabel === "total income") &&
      resolvedGrossProfit.value === null &&
      resolvedCostOfSales.value === null &&
      (grossOperatingIncome.value === null ||
        Math.abs(grossOperatingIncome.value) <= 0.000001) &&
      hasExplicitZeroPlaceholderMetricRow(rows, PNL_LABELS.gross_profit, columnIndex) &&
      hasExplicitZeroPlaceholderMetricRow(rows, PNL_AUX_LABELS.gross_operating_income, columnIndex) &&
      hasExplicitZeroPlaceholderMetricRow(rows, PNL_LABELS.cost_of_sales, columnIndex)
    ) {
      resolvedRevenue = {
        ...resolvedRevenue,
        value: 0,
      };
    }

    if (
      resolvedRevenue.value !== null &&
      resolvedOtherIncome.value !== null &&
      Math.abs(resolvedRevenue.value - resolvedOtherIncome.value) <= 1 &&
      (revenueSourceLabel === "income" || revenueSourceLabel === "total income") &&
      resolvedCostOfSales.value === null &&
      resolvedGrossProfit.value === null
    ) {
      warnings.push("pnl_revenue_ambiguous_income_only");
    }
    if (
      resolvedGrossProfit.value !== null &&
      resolvedRevenue.value !== null &&
      resolvedCostOfSales.value !== null
    ) {
      const delta = Math.abs(
        resolvedGrossProfit.value - (resolvedRevenue.value - resolvedCostOfSales.value),
      );
      if (delta > 1) warnings.push("pnl_gross_profit_mismatch");
    }

    const record: CanonicalPnlMonth = {
      family: "pnl_month",
      ...createBaseRecord(recordPeriod, options.fileName, [
        resolvedRevenue.sourceRef,
        resolvedCostOfSales.sourceRef,
        resolvedGrossProfit.sourceRef,
        resolvedOtherIncome.sourceRef,
        resolvedOtherExpenses.sourceRef,
        resolvedOperatingExpenses.sourceRef,
        resolvedDepreciationAmortization.sourceRef,
        resolvedInterestExpense.sourceRef,
        resolvedTaxExpense.sourceRef,
        resolvedNetIncome.sourceRef,
      ].filter((value): value is CanonicalFinanceSourceRef => Boolean(value)), {
        family: "pnl_month",
        currency,
        scopeLabel,
        book: "actual",
        warnings,
      }),
      statement_lines: statementLines,
      values: {
        revenue: resolvedRevenue.value,
        cost_of_sales: resolvedCostOfSales.value,
        gross_profit: resolvedGrossProfit.value,
        other_income: resolvedOtherIncome.value,
        other_expenses: resolvedOtherExpenses.value,
        operating_expenses: resolvedOperatingExpenses.value,
        depreciation_amortization: resolvedDepreciationAmortization.value,
        ebitda: null,
        ebit: null,
        interest_expense: resolvedInterestExpense.value,
        tax_expense: resolvedTaxExpense.value,
        net_income: resolvedNetIncome.value,
      },
    };

    pushCandidateFact(facts, record, "revenue", "Total Revenue", resolvedRevenue);
    pushCandidateFact(facts, record, "cost_of_sales", "Total Cost of Sales", resolvedCostOfSales);
    pushCandidateFact(facts, record, "gross_profit", "Gross Profit", resolvedGrossProfit);
    pushCandidateFact(facts, record, "other_income", "Other Income", resolvedOtherIncome);
    pushCandidateFact(facts, record, "other_expenses", "Other Expenses", resolvedOtherExpenses);
    pushCandidateFact(facts, record, "operating_expenses", "Total Operating Expenses", resolvedOperatingExpenses);
    pushCandidateFact(facts, record, "depreciation_amortization", "Depreciation & Amortization", resolvedDepreciationAmortization);
    pushCandidateFact(facts, record, "interest_expense", "Interest Expense", resolvedInterestExpense);
    pushCandidateFact(facts, record, "tax_expense", "Tax Expense", resolvedTaxExpense);
    pushCandidateFact(facts, record, "net_income", "Net Profit", resolvedNetIncome);

      records.push(record);
    }
  }

  return records;
}

function extractDirectBalanceSheet(
  workbook: XLSX.WorkBook,
  options: ExtractionOptions,
  facts: CanonicalFactCandidate[],
  clarificationQuestions: CanonicalFinanceClarificationQuestion[],
): CanonicalBalanceSheetMonth[] {
  const selection = resolveSheetSelection({
    family: "balance_sheet_month",
    clarificationKey: "balance_sheet_sheet_name",
    candidates: findDirectBalanceSheetSheetNames(workbook),
    options,
    label: "Monthly balance sheet sheet",
    prompt: "Which workbook tab contains the month-end balance sheet we should use?",
    reason: "multiple_balance_sheet_sheets_detected",
  });
  if (selection.question) clarificationQuestions.push(selection.question);
  const sheetName = selection.sheetName;
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = sheetRows(sheet);
  const workbookPeriod = resolveWorkbookPeriod(options.fileName, options.sourceContext);
  const sheetPeriod = parsePeriodFromFileName(stripSheetOrdinalPrefix(sheetName));
  const currency = inferWorkbookCurrency(workbook, sheetName, options.reports);
  const scopeLabel = resolveDirectScopeLabel(sheetName, "balance_sheet_month");
  const monthlyColumns = findMonthlyColumnCandidates(rows, workbookPeriod ?? sheetPeriod ?? null);
  const targetColumnGroups =
    monthlyColumns.length > 0
      ? groupMonthlyColumnCandidates(monthlyColumns)
      : (() => {
          const fallbackPeriod = sheetPeriod ?? workbookPeriod;
          const preferredColumnIndex =
            findSummaryTargetColumnIndex(
              rows,
              fallbackPeriod ? normalizeReportingPeriodKey(fallbackPeriod) : null,
            ) ??
            inferDominantNumericColumnIndex(rows);
          if (preferredColumnIndex === null || !fallbackPeriod) return [];
          const headerRowIndex = findHeaderRowIndexForColumn(
            rows,
            preferredColumnIndex,
            normalizeReportingPeriodKey(fallbackPeriod),
          );
          return [
            {
              rowIndex: headerRowIndex,
              columnIndex: preferredColumnIndex,
              periodKey: normalizeReportingPeriodKey(fallbackPeriod),
            },
          ];
        })().map((candidate) => ({
          rowIndex: candidate.rowIndex,
          periodKey: candidate.periodKey,
          columnIndices: findCompanionValueColumns(rows, candidate.rowIndex, candidate.columnIndex),
        }));

  return targetColumnGroups.map(({ columnIndices, rowIndex, periodKey }) => {
    const recordPeriod = monthPeriodFromKey(periodKey);
    const statementLines = extractSheetStatementLinesFromColumns({
      rows,
      sheet,
      fileName: options.fileName,
      sheetName,
      valueColumnIndices: columnIndices,
      headerRowIndex: rowIndex,
    });

    const cash = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.cash_and_equivalents, columnIndices);
    const inventory = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.inventory, columnIndices);
    const otherCurrentAssets = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.other_current_assets, columnIndices);
    const totalCurrentAssets = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.total_current_assets, columnIndices);
    const fixedAssets = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.fixed_assets, columnIndices);
    const otherNonCurrentAssets = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.other_non_current_assets, columnIndices);
    const totalAssets = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.total_assets, columnIndices);
    const accountsPayable = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.accounts_payable, columnIndices);
    const otherCurrentLiabilities = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.other_current_liabilities, columnIndices);
    const totalCurrentLiabilities = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.total_current_liabilities, columnIndices);
    const totalLiabilities = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.total_liabilities, columnIndices);
    const equity = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.equity, columnIndices);
    const retainedEarnings = summaryMetricFromColumns(rows, sheet, options.fileName, sheetName, BS_SUMMARY_LABELS.retained_earnings, columnIndices);
    const totalLiabilitiesAndCapital = summaryMetricFromColumns(
      rows,
      sheet,
      options.fileName,
      sheetName,
      BS_AUX_LABELS.total_liabilities_and_capital,
      columnIndices,
    );
    const capitalOwningCompany = summaryMetricFromColumns(
      rows,
      sheet,
      options.fileName,
      sheetName,
      BS_AUX_LABELS.capital_owning_company,
      columnIndices,
    );
    const derivedMetrics = deriveBalanceSheetMetricsFromStatementLines(statementLines);

    const resolvedCash = withStatementFallback(cash, derivedMetrics.cashAndEquivalents);
    const resolvedInventory = withStatementFallback(inventory, derivedMetrics.inventory);
    const resolvedTotalCurrentAssets = withStatementFallback(
      totalCurrentAssets,
      derivedMetrics.totalCurrentAssets,
    );
    const resolvedFixedAssets = withStatementFallback(fixedAssets, derivedMetrics.fixedAssets);
    const resolvedTotalAssets = withStatementFallback(totalAssets, derivedMetrics.totalAssets);
    const resolvedAccountsPayable = withStatementFallback(
      accountsPayable,
      derivedMetrics.accountsPayable,
    );
    const resolvedTotalCurrentLiabilities = withStatementFallback(
      totalCurrentLiabilities,
      derivedMetrics.totalCurrentLiabilities,
    );
    let resolvedTotalLiabilities = withStatementFallback(
      totalLiabilities,
      derivedMetrics.totalLiabilities,
    );
    let resolvedEquity = withStatementFallback(equity, derivedMetrics.equity);
    const resolvedRetainedEarnings = withStatementFallback(
      retainedEarnings,
      derivedMetrics.retainedEarnings,
    );

    if (
      resolvedEquity.value === null &&
      capitalOwningCompany.value !== null &&
      resolvedRetainedEarnings.value !== null
    ) {
      resolvedEquity = {
        value: Number((capitalOwningCompany.value + resolvedRetainedEarnings.value).toFixed(2)),
        sourceRef: capitalOwningCompany.sourceRef ?? resolvedRetainedEarnings.sourceRef,
      };
    }

    if (
      resolvedTotalLiabilities.value === null &&
      totalLiabilitiesAndCapital.value !== null &&
      resolvedEquity.value !== null
    ) {
      resolvedTotalLiabilities = {
        value: Number((totalLiabilitiesAndCapital.value - resolvedEquity.value).toFixed(2)),
        sourceRef: totalLiabilitiesAndCapital.sourceRef ?? resolvedEquity.sourceRef,
      };
    }

    const totalLiabilitiesLooksInvalid =
      resolvedTotalLiabilities.value !== null &&
      (
        resolvedTotalLiabilities.value < 0 ||
        (
          resolvedTotalCurrentLiabilities.value !== null &&
          resolvedTotalLiabilities.value + 1 < resolvedTotalCurrentLiabilities.value
        )
      );

    if (
      totalLiabilitiesLooksInvalid &&
      totalLiabilitiesAndCapital.value !== null &&
      resolvedEquity.value !== null
    ) {
      resolvedTotalLiabilities = {
        value: Number((totalLiabilitiesAndCapital.value - resolvedEquity.value).toFixed(2)),
        sourceRef: totalLiabilitiesAndCapital.sourceRef ?? resolvedEquity.sourceRef,
      };
    }

    if (
      resolvedTotalLiabilities.value === null &&
      resolvedTotalAssets.value !== null &&
      resolvedEquity.value !== null
    ) {
      resolvedTotalLiabilities = {
        value: Number((resolvedTotalAssets.value - resolvedEquity.value).toFixed(2)),
        sourceRef: resolvedTotalAssets.sourceRef ?? resolvedEquity.sourceRef,
      };
    }

    const warnings: string[] = [];
    if (
      metricWasResolvedFromStatementLines(totalAssets.value, derivedMetrics.totalAssets) ||
      metricWasResolvedFromStatementLines(
        totalCurrentLiabilities.value,
        derivedMetrics.totalCurrentLiabilities,
      ) ||
      metricWasResolvedFromStatementLines(totalLiabilities.value, derivedMetrics.totalLiabilities) ||
      metricWasResolvedFromStatementLines(equity.value, derivedMetrics.equity)
    ) {
      warnings.push("balance_sheet_totals_derived_from_statement_lines");
    }
    if (
      resolvedTotalAssets.value !== null &&
      resolvedTotalLiabilities.value !== null &&
      resolvedEquity.value !== null
    ) {
      const delta = Math.abs(
        resolvedTotalAssets.value - (resolvedTotalLiabilities.value + resolvedEquity.value),
      );
      const tolerance = computeBalanceSheetEquationTolerance(
        resolvedTotalAssets.value,
        resolvedTotalLiabilities.value,
        resolvedEquity.value,
      );
      if (delta > tolerance) warnings.push("balance_sheet_equation_mismatch");
    } else {
      warnings.push("balance_sheet_totals_incomplete");
    }

    const record: CanonicalBalanceSheetMonth = {
      family: "balance_sheet_month",
      ...createBaseRecord(recordPeriod, options.fileName, [
        resolvedCash.sourceRef,
        resolvedInventory.sourceRef,
        otherCurrentAssets.sourceRef,
        resolvedTotalCurrentAssets.sourceRef,
        resolvedFixedAssets.sourceRef,
        otherNonCurrentAssets.sourceRef,
        resolvedTotalAssets.sourceRef,
        resolvedAccountsPayable.sourceRef,
        otherCurrentLiabilities.sourceRef,
        resolvedTotalCurrentLiabilities.sourceRef,
        resolvedTotalLiabilities.sourceRef,
        resolvedEquity.sourceRef,
        resolvedRetainedEarnings.sourceRef,
      ].filter((value): value is CanonicalFinanceSourceRef => Boolean(value)), {
        family: "balance_sheet_month",
        currency,
        scopeLabel,
        book: "actual",
        warnings,
      }),
      statement_lines: statementLines,
      values: {
        cash_and_equivalents: resolvedCash.value,
        accounts_receivable: derivedMetrics.accountsReceivable,
        inventory: resolvedInventory.value,
        other_current_assets: otherCurrentAssets.value,
        total_current_assets: resolvedTotalCurrentAssets.value,
        fixed_assets: resolvedFixedAssets.value,
        intangible_assets: null,
        other_non_current_assets: otherNonCurrentAssets.value,
        total_assets: resolvedTotalAssets.value,
        accounts_payable: resolvedAccountsPayable.value,
        short_term_debt: null,
        other_current_liabilities: otherCurrentLiabilities.value,
        total_current_liabilities: resolvedTotalCurrentLiabilities.value,
        long_term_debt: null,
        other_non_current_liabilities: null,
        total_liabilities: resolvedTotalLiabilities.value,
        equity: resolvedEquity.value,
        retained_earnings: resolvedRetainedEarnings.value,
      },
    };

    pushCandidateFact(facts, record, "cash_and_equivalents", "Cash and Bank", resolvedCash);
    pushCandidateFact(facts, record, "inventory", "Inventory", resolvedInventory);
    pushCandidateFact(facts, record, "other_current_assets", "Other Current Assets", otherCurrentAssets);
    pushCandidateFact(facts, record, "total_current_assets", "Total Current Assets", resolvedTotalCurrentAssets);
    pushCandidateFact(facts, record, "fixed_assets", "Fixed Assets", resolvedFixedAssets);
    pushCandidateFact(facts, record, "other_non_current_assets", "Other Non Current Assets", otherNonCurrentAssets);
    pushCandidateFact(facts, record, "total_assets", "Total Assets", resolvedTotalAssets);
    pushCandidateFact(facts, record, "accounts_payable", "Accounts Payable", resolvedAccountsPayable);
    pushCandidateFact(facts, record, "other_current_liabilities", "Other Current Liabilities", otherCurrentLiabilities);
    pushCandidateFact(facts, record, "total_current_liabilities", "Total Current Liabilities", resolvedTotalCurrentLiabilities);
    pushCandidateFact(facts, record, "total_liabilities", "Total Liabilities", resolvedTotalLiabilities);
    pushCandidateFact(facts, record, "equity", "Net Assets", resolvedEquity);
    pushCandidateFact(facts, record, "retained_earnings", "Retained Earnings", resolvedRetainedEarnings);

    return record;
  });
}

function extractDirectCashFlow(
  workbook: XLSX.WorkBook,
  options: ExtractionOptions,
  facts: CanonicalFactCandidate[],
  clarificationQuestions: CanonicalFinanceClarificationQuestion[],
): CanonicalCashFlowMonth[] {
  const selection = resolveSheetSelection({
    family: "cash_flow_month",
    clarificationKey: "cash_flow_sheet_name",
    candidates: findSheetNames(workbook, DIRECT_SHEET_PATTERNS.cashFlow),
    options,
    label: "Monthly cash flow sheet",
    prompt: "Which workbook tab contains the monthly cash flow statement we should use?",
    reason: "multiple_cash_flow_sheets_detected",
  });
  if (selection.question) clarificationQuestions.push(selection.question);
  const sheetName = selection.sheetName;
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = sheetRows(sheet);
  const workbookPeriod = resolveWorkbookPeriod(options.fileName, options.sourceContext);
  const sheetPeriod = parsePeriodFromFileName(stripSheetOrdinalPrefix(sheetName));
  const currency = inferWorkbookCurrency(workbook, sheetName, options.reports);
  const scopeLabel = resolveDirectScopeLabel(sheetName, "cash_flow_month");
  const monthlyColumns = findMonthlyColumnCandidates(rows, workbookPeriod ?? sheetPeriod ?? null);
  const targetColumns =
    monthlyColumns.length > 0
      ? monthlyColumns
      : (() => {
          const fallbackPeriod = sheetPeriod ?? workbookPeriod;
          const preferredColumnIndex =
            findSummaryTargetColumnIndex(
              rows,
              fallbackPeriod ? normalizeReportingPeriodKey(fallbackPeriod) : null,
            ) ??
            inferDominantNumericColumnIndex(rows);
          if (preferredColumnIndex === null || !fallbackPeriod) return [];
          return [
            {
              rowIndex: findHeaderRowIndexForColumn(
                rows,
                preferredColumnIndex,
                normalizeReportingPeriodKey(fallbackPeriod),
              ),
              columnIndex: preferredColumnIndex,
              periodKey: normalizeReportingPeriodKey(fallbackPeriod),
            },
          ];
        })();

  return targetColumns.map(({ columnIndex, rowIndex, periodKey }) => {
    const recordPeriod = monthPeriodFromKey(periodKey);
    const statementLines = extractSheetStatementLines({
      rows,
      sheet,
      fileName: options.fileName,
      sheetName,
      valueColumnIndex: columnIndex,
      headerRowIndex: rowIndex,
    });

    const cashFromOperations = summaryMetric(rows, sheet, options.fileName, sheetName, CASH_FLOW_LABELS.cash_from_operations, columnIndex);
    const cashFromInvesting = summaryMetric(rows, sheet, options.fileName, sheetName, CASH_FLOW_LABELS.cash_from_investing, columnIndex);
    const cashFromFinancing = summaryMetric(rows, sheet, options.fileName, sheetName, CASH_FLOW_LABELS.cash_from_financing, columnIndex);
    const netCashFlow = summaryMetric(rows, sheet, options.fileName, sheetName, CASH_FLOW_LABELS.net_cash_flow, columnIndex);
    const openingCash = summaryMetric(rows, sheet, options.fileName, sheetName, CASH_FLOW_LABELS.opening_cash, columnIndex);
    const closingCash = summaryMetric(rows, sheet, options.fileName, sheetName, CASH_FLOW_LABELS.closing_cash, columnIndex);

    const warnings: string[] = [];
    if (
      openingCash.value !== null &&
      netCashFlow.value !== null &&
      closingCash.value !== null
    ) {
      const delta = Math.abs(closingCash.value - (openingCash.value + netCashFlow.value));
      if (delta > 1) warnings.push("cash_flow_rollforward_mismatch");
    }

    const record: CanonicalCashFlowMonth = {
      family: "cash_flow_month",
      ...createBaseRecord(recordPeriod, options.fileName, [
        cashFromOperations.sourceRef,
        cashFromInvesting.sourceRef,
        cashFromFinancing.sourceRef,
        netCashFlow.sourceRef,
        openingCash.sourceRef,
        closingCash.sourceRef,
      ].filter((value): value is CanonicalFinanceSourceRef => Boolean(value)), {
        family: "cash_flow_month",
        currency,
        scopeLabel,
        book: "actual",
        warnings,
      }),
      statement_lines: statementLines,
      values: {
        cash_from_operations: cashFromOperations.value,
        cash_from_investing: cashFromInvesting.value,
        cash_from_financing: cashFromFinancing.value,
        net_cash_flow: netCashFlow.value,
        opening_cash: openingCash.value,
        closing_cash: closingCash.value,
      },
    };

    pushCandidateFact(facts, record, "cash_from_operations", "Net Cash Flow from Operations", cashFromOperations);
    pushCandidateFact(facts, record, "cash_from_investing", "Net Cash Flow from Investing", cashFromInvesting);
    pushCandidateFact(facts, record, "cash_from_financing", "Net Cash Flow from Financing", cashFromFinancing);
    pushCandidateFact(facts, record, "net_cash_flow", "Net Cash Flow", netCashFlow);
    pushCandidateFact(facts, record, "opening_cash", "Opening Cash", openingCash);
    pushCandidateFact(facts, record, "closing_cash", "Closing Cash", closingCash);

    return record;
  });
}

function extractProjectionPlans(
  workbook: XLSX.WorkBook,
  options: ExtractionOptions,
  facts: CanonicalFactCandidate[],
  clarificationQuestions: CanonicalFinanceClarificationQuestion[],
): CanonicalFinancialProjectionPlan[] {
  const projectionCandidates = (() => {
    const directMatches = findSheetNames(workbook, DIRECT_SHEET_PATTERNS.projection);
    if (directMatches.length > 0) {
      return directMatches;
    }
    if (isProjectionLikeText(options.fileName)) {
      return workbook.SheetNames.filter(
        (name) => !DIRECT_SHEET_PATTERNS.summary.some((pattern) => pattern.test(name)),
      );
    }
    return [];
  })();

  const selection = resolveSheetSelection({
    family: "financial_projection_plan",
    clarificationKey: "projection_sheet_name",
    candidates: projectionCandidates,
    options,
    label: "Projection or budget sheet",
    prompt: "Which workbook tab contains the projection or budget plan we should use?",
    reason: "multiple_projection_sheets_detected",
  });
  if (selection.question) clarificationQuestions.push(selection.question);
  const sheetName = selection.sheetName;
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const rows = sheetRows(sheet);
  const currency = inferWorkbookCurrency(workbook, sheetName, options.reports);
  const scopeLabel = resolveDirectScopeLabel(sheetName, "financial_projection_plan");
  const scenarioKey = inferProjectionScenarioKey(options.fileName, sheetName);

  const header = rows.find((row) =>
    row.some((cell) => periodKeyFromCell(cell) !== null),
  );
  if (!header) return [];
  const headerRowIndex = rows.indexOf(header);
  const plans: CanonicalFinancialProjectionPlan[] = [];

  for (let columnIndex = 0; columnIndex < header.length; columnIndex += 1) {
    const periodKey = periodKeyFromCell(header[columnIndex]);
    if (!periodKey || !isMonthlyPeriodKey(periodKey)) continue;
    const period = periodFromKey(periodKey);

    const revenue = matrixMetric(rows, sheet, options.fileName, sheetName, PROJECTION_LABELS.revenue, columnIndex);
    const costOfSales = matrixMetric(rows, sheet, options.fileName, sheetName, PROJECTION_LABELS.cost_of_sales, columnIndex);
    const grossProfit = matrixMetric(rows, sheet, options.fileName, sheetName, PROJECTION_LABELS.gross_profit, columnIndex);
    const operatingExpenses = matrixMetric(rows, sheet, options.fileName, sheetName, PROJECTION_LABELS.operating_expenses, columnIndex);
    const netIncome = matrixMetric(rows, sheet, options.fileName, sheetName, PROJECTION_LABELS.net_income, columnIndex);

    if (
      revenue.value === null &&
      costOfSales.value === null &&
      grossProfit.value === null &&
      operatingExpenses.value === null &&
      netIncome.value === null
    ) {
      continue;
    }

    const warnings: string[] = [];
    if (grossProfit.value !== null && revenue.value !== null && costOfSales.value !== null) {
      const delta = Math.abs(grossProfit.value - (revenue.value - costOfSales.value));
      if (delta > 1) warnings.push("projection_gross_profit_mismatch");
    }

    const record: CanonicalFinancialProjectionPlan = {
      family: "financial_projection_plan",
      ...createBaseRecord(period, options.fileName, [
        revenue.sourceRef,
        costOfSales.sourceRef,
        grossProfit.sourceRef,
        operatingExpenses.sourceRef,
        netIncome.sourceRef,
      ].filter((value): value is CanonicalFinanceSourceRef => Boolean(value)), {
        family: "financial_projection_plan",
        currency,
        scopeLabel,
        book: "projection",
        warnings,
      }),
      scenario_key: scenarioKey,
      plan_key: "default_projection",
      plan_status: "working",
      statement_lines: extractSheetStatementLines({
        rows,
        sheet,
        fileName: options.fileName,
        sheetName,
        valueColumnIndex: columnIndex,
        headerRowIndex,
      }),
      values: {
        revenue: revenue.value,
        cost_of_sales: costOfSales.value,
        gross_profit: grossProfit.value,
        operating_expenses: operatingExpenses.value,
        net_income: netIncome.value,
      },
    };

    pushCandidateFact(facts, record, "projection_revenue", "Projected Revenue", revenue);
    pushCandidateFact(facts, record, "projection_cost_of_sales", "Projected Cost of Sales", costOfSales);
    pushCandidateFact(facts, record, "projection_gross_profit", "Projected Gross Profit", grossProfit);
    pushCandidateFact(facts, record, "projection_operating_expenses", "Projected Operating Expenses", operatingExpenses);
    pushCandidateFact(facts, record, "projection_net_income", "Projected Net Income", netIncome);

    plans.push(record);
  }

  return plans;
}

function extractDailyMetrics(
  workbook: XLSX.WorkBook,
  options: ExtractionOptions,
  facts: CanonicalFactCandidate[],
  clarificationQuestions: CanonicalFinanceClarificationQuestion[],
): { records: CanonicalMetricsDaily[]; warning: string | null } {
  const selection = resolveSheetSelection({
    family: "metrics_daily",
    clarificationKey: "metrics_sheet_name",
    candidates: findSheetNames(workbook, DIRECT_SHEET_PATTERNS.statistics),
    options,
    label: "Daily metrics sheet",
    prompt: "Which workbook tab contains the day-level operating metrics we should use?",
    reason: "multiple_metrics_sheets_detected",
  });
  if (selection.question) clarificationQuestions.push(selection.question);
  const sheetName = selection.sheetName;
  if (!sheetName) return { records: [], warning: null };
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { records: [], warning: null };
  const rows = sheetRows(sheet);
  const dailyHeader = findDailyMetricColumns(rows);
  if (!dailyHeader) {
    return {
      records: [],
      warning: hasMonthlyMetricHeader(rows) ? MONTHLY_METRIC_SKIP_WARNING : null,
    };
  }

  const records: CanonicalMetricsDaily[] = [];
  for (const { columnIndex, period } of dailyHeader.periods) {
    const metricValues: CanonicalDailyMetricValue[] = [];
    for (let rowIndex = dailyHeader.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] ?? [];
      const label = firstStringLabel(row);
      if (!label || !shouldKeepDailyMetricLabel(label)) continue;
      const numeric = parseNumber(row[columnIndex]);
      if (numeric === null) continue;
      const ref = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[ref] as WorkbookCell;
      const sourceRef = makeSourceRef(
        options.fileName,
        sheetName,
        ref,
        rowIndex + 1,
        typeof cell?.f === "string" ? cell.f : null,
        label,
      );
      metricValues.push({
        metric_key: normalizeLabel(label).replace(/\s+/g, "_"),
        label,
        unit: inferMetricUnit(label),
        value: numeric,
        source_ref: sourceRef,
        confidence: 0.8,
      });
    }

    if (metricValues.length === 0) {
      continue;
    }

    const record: CanonicalMetricsDaily = {
      family: "metrics_daily",
      ...createBaseRecord(period, options.fileName, metricValues.map((value) => value.source_ref), {
        family: "metrics_daily",
        currency: null,
        scopeLabel: resolveDirectScopeLabel(sheetName, "metrics_daily"),
        book: "actual",
        warnings: [],
        scale: "raw",
      }),
      template_key: "default_daily_metrics",
      metric_basis: Object.fromEntries(metricValues.map((metric) => [metric.metric_key, "document"])),
      metric_values: metricValues,
    };

    for (const metric of metricValues) {
      facts.push({
        concept: metric.metric_key,
        raw_label: metric.label,
        value: metric.value,
        unit: metric.unit,
        scale: "raw",
        period_key: record.period_key,
        scope_key: record.scope_key,
        source_ref: metric.source_ref,
        confidence: metric.confidence,
      });
    }

    records.push(record);
  }

  if (records.length === 0) {
    return { records: [], warning: "daily_metrics_not_detected" };
  }

  return { records, warning: null };
}

function dedupeRecords(records: CanonicalFinanceRecord[]): CanonicalFinanceRecord[] {
  const seen = new Set<string>();
  const deduped: CanonicalFinanceRecord[] = [];

  for (const record of records) {
    const scenario = "scenario_key" in record ? record.scenario_key : "actual";
    const key = [
      record.family,
      record.period_key,
      record.scope_key,
      scenario,
      record.book,
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }

  return deduped;
}

function hasSupportedLegacyStatementPeriod(report: ExtractedReport): boolean {
  return !isUnknownReportingPeriod(report.reporting_period);
}

export function extractCanonicalFinanceWorkbook(
  workbook: XLSX.WorkBook,
  options: ExtractionOptions,
): CanonicalFinanceBundle {
  const candidateFacts: CanonicalFactCandidate[] = [];
  const records: CanonicalFinanceRecord[] = [];
  const warnings: string[] = [];
  const clarificationQuestions: CanonicalFinanceClarificationQuestion[] = [];
  const projectionLikeWorkbook = isProjectionLikeText(options.fileName);
  const directPnlCandidates =
    !projectionLikeWorkbook && hasDirectSheetCandidates(workbook, "pnl_month");
  const directBalanceSheetCandidates =
    !projectionLikeWorkbook && hasDirectSheetCandidates(workbook, "balance_sheet_month");

  if (!projectionLikeWorkbook) {
    records.push(...extractDirectPnl(workbook, options, candidateFacts, clarificationQuestions));
    records.push(
      ...extractDirectBalanceSheet(
        workbook,
        options,
        candidateFacts,
        clarificationQuestions,
      ),
    );
    records.push(
      ...extractDirectCashFlow(workbook, options, candidateFacts, clarificationQuestions),
    );
  }

  const blockedReportFamilies = new Set<CanonicalFinanceRecord["family"]>();
  if (directPnlCandidates || shouldDeferReportDerivedFamily(workbook, "pnl_month")) {
    blockedReportFamilies.add("pnl_month");
  }
  if (
    directBalanceSheetCandidates ||
    shouldDeferReportDerivedFamily(workbook, "balance_sheet_month")
  ) {
    blockedReportFamilies.add("balance_sheet_month");
  }

  for (const report of options.reports ?? []) {
    if (
      report.report_type === "profit_and_loss" &&
      !blockedReportFamilies.has("pnl_month") &&
      report.book === "actual" &&
      hasSupportedLegacyStatementPeriod(report) &&
      !isProjectionLikeReport(report, options.fileName)
    ) {
      const pnl = convertPnlReport(report, options.fileName, candidateFacts);
      if (pnl) {
        records.push(pnl);
      }
      continue;
    }

    if (
      report.report_type === "balance_sheet" &&
      !blockedReportFamilies.has("balance_sheet_month") &&
      report.book === "actual" &&
      hasSupportedLegacyStatementPeriod(report) &&
      !isProjectionLikeReport(report, options.fileName)
    ) {
      const balanceSheet = convertBalanceSheetReport(
        report,
        options.fileName,
        candidateFacts,
      );
      if (balanceSheet) {
        records.push(balanceSheet);
      }
    }
  }

  records.push(...extractProjectionPlans(workbook, options, candidateFacts, clarificationQuestions));

  const metricsResult = extractDailyMetrics(
    workbook,
    options,
    candidateFacts,
    clarificationQuestions,
  );
  records.push(...metricsResult.records);
  if (metricsResult.warning) warnings.push(metricsResult.warning);

  return {
    records: dedupeRecords(records),
    warnings,
    candidate_facts: candidateFacts,
    clarification_questions: clarificationQuestions,
  };
}
