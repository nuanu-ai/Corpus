import * as XLSX from "xlsx";
import { basename } from "path";
import type {
  CanonicalFinanceFact,
  CanonicalFinanceFamily,
  CanonicalFinanceForm,
  CanonicalFinanceParseOptions,
  CanonicalFinanceWorkbookExtraction,
  CanonicalMetricCadence,
  CanonicalPeriod,
  CanonicalSourceRef,
} from "./canonical-finance-types";
import {
  parsePeriodFromFileName,
  parsePeriodFromSourcePath,
} from "./period-utils";

type CellValue = string | number | boolean | Date | null | undefined;
type Row = CellValue[];

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  agust: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const PNL_LAYOUT_HEADERS = [
  "description",
  "actual",
  "budget",
  "variance",
  "last month",
  "ytd actual",
  "ytd budget",
];

const PNL_FAMILY_HINTS = [
  /profit\s+and\s+loss/i,
  /\bp&l\b/i,
  /\bpnl\b/i,
  /income\s+statement/i,
  /consolidation/i,
  /consilidation/i,
];

const BS_FAMILY_HINTS = [
  /balance\s+sheet/i,
  /\bbs\b/i,
  /bal\s*sheet/i,
];

const CF_FAMILY_HINTS = [/cash\s+flow/i];

const PROJECTION_FAMILY_HINTS = [
  /projection/i,
  /forecast/i,
  /budget/i,
];

const METRICS_FAMILY_HINTS = [
  /statistic/i,
  /metrics?/i,
  /revenue\s+history/i,
];

function toText(value: CellValue): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .trim();
}

function normalizeText(value: CellValue): string {
  return toText(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  return normalizeName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function buildMonthPeriod(
  year: number,
  month: number,
  label?: string,
): CanonicalPeriod {
  const lastDay = lastDayOfMonth(year, month);
  return {
    start: isoDate(year, month, 1),
    end: isoDate(year, month, lastDay),
    label,
  };
}

function buildDayPeriod(
  year: number,
  month: number,
  day: number,
  label?: string,
): CanonicalPeriod {
  return {
    start: isoDate(year, month, day),
    end: isoDate(year, month, day),
    label,
  };
}

function normalizeYear(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  if (raw.length === 2) {
    return parsed <= 79 ? 2000 + parsed : 1900 + parsed;
  }
  if (parsed >= 1900 && parsed <= 2100) return parsed;
  return null;
}

function parseMonthToken(raw: string): number | null {
  return MONTH_MAP[raw.toLowerCase().trim()] ?? null;
}

function parsePeriodHeader(value: CellValue): {
  period: CanonicalPeriod;
  cadence: CanonicalMetricCadence;
  kind: "month" | "day" | "quarter" | "year" | "unknown";
} | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = value.getMonth() + 1;
    const day = value.getDate();
    const lastDay = lastDayOfMonth(year, month);
    if (day === lastDay) {
      return {
        period: buildMonthPeriod(year, month, value.toISOString().slice(0, 10)),
        cadence: "monthly",
        kind: "month",
      };
    }
    return {
      period: buildDayPeriod(year, month, day, value.toISOString().slice(0, 10)),
      cadence: "daily",
      kind: "day",
    };
  }

  const text = normalizeName(toText(value));
  if (!text) return null;
  if (/^ytd\b/i.test(text)) return null;

  const monthYearMatch = text.match(
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|agust|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[-/ ]\s*(\d{2,4})$/i,
  );
  if (monthYearMatch) {
    const month = parseMonthToken(monthYearMatch[1]);
    const year = normalizeYear(monthYearMatch[2]);
    if (month && year) {
      return {
        period: buildMonthPeriod(year, month, text),
        cadence: "monthly",
        kind: "month",
      };
    }
  }

  const dayMonthYearMatch = text.match(
    /^(\d{1,2})\s*[\/.-]\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|agust|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[\/.-]\s*(\d{2,4})$/i,
  );
  if (dayMonthYearMatch) {
    const day = Number.parseInt(dayMonthYearMatch[1], 10);
    const month = parseMonthToken(dayMonthYearMatch[2]);
    const year = normalizeYear(dayMonthYearMatch[3]);
    if (month && year && day >= 1 && day <= 31) {
      const lastDay = lastDayOfMonth(year, month);
      if (day === lastDay) {
        return {
          period: buildMonthPeriod(year, month, text),
          cadence: "monthly",
          kind: "month",
        };
      }
      return {
        period: buildDayPeriod(year, month, day, text),
        cadence: "daily",
        kind: "day",
      };
    }
  }

  const isoMatch = text.match(/^(\d{4})[-/](\d{2})(?:[-/](\d{2}))?$/);
  if (isoMatch) {
    const year = Number.parseInt(isoMatch[1], 10);
    const month = Number.parseInt(isoMatch[2], 10);
    const day = isoMatch[3] ? Number.parseInt(isoMatch[3], 10) : null;
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12) {
      if (day) {
        const lastDay = lastDayOfMonth(year, month);
        if (day === lastDay) {
          return {
            period: buildMonthPeriod(year, month, text),
            cadence: "monthly",
            kind: "month",
          };
        }
        return {
          period: buildDayPeriod(year, month, day, text),
          cadence: "daily",
          kind: "day",
        };
      }
      return {
        period: buildMonthPeriod(year, month, text),
        cadence: "monthly",
        kind: "month",
      };
    }
  }

  const monthOnlyMatch = text.match(
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|agust|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[- ]\s*(\d{2,4})$/i,
  );
  if (monthOnlyMatch) {
    const month = parseMonthToken(monthOnlyMatch[1]);
    const year = normalizeYear(monthOnlyMatch[2]);
    if (month && year) {
      return {
        period: buildMonthPeriod(year, month, text),
        cadence: "monthly",
        kind: "month",
      };
    }
  }

  const quarterMatch = text.match(/^q([1-4])\s*[-/ ]\s*(\d{2,4})$/i);
  if (quarterMatch) {
    const q = Number.parseInt(quarterMatch[1], 10);
    const year = normalizeYear(quarterMatch[2]);
    if (q >= 1 && q <= 4 && year) {
      const startMonth = (q - 1) * 3 + 1;
      const endMonth = q * 3;
      return {
        period: {
          start: `${year}-${pad2(startMonth)}-01`,
          end: `${year}-${pad2(endMonth)}-${pad2(lastDayOfMonth(year, endMonth))}`,
          label: `Q${q} ${year}`,
        },
        cadence: "quarterly",
        kind: "quarter",
      };
    }
  }

  const yearMatch = text.match(/^(19\d{2}|20\d{2})$/);
  if (yearMatch) {
    const year = Number.parseInt(yearMatch[1], 10);
    return {
      period: {
        start: `${year}-01-01`,
        end: `${year}-12-31`,
        label: String(year),
      },
      cadence: "yearly",
      kind: "year",
    };
  }

  return null;
}

function inferCadenceFromPeriods(
  parsedPeriods: Array<ReturnType<typeof parsePeriodHeader>>,
): CanonicalMetricCadence {
  const periods = parsedPeriods.filter(
    (entry): entry is NonNullable<typeof entry> => Boolean(entry),
  );
  if (periods.length === 0) return "unknown";

  const kinds = new Set(periods.map((period) => period.kind));
  if (kinds.size === 1) {
    const [kind] = Array.from(kinds);
    if (kind === "day") return "daily";
    if (kind === "quarter") return "quarterly";
    if (kind === "year") return "yearly";
    return "monthly";
  }

  if (kinds.has("day") && !kinds.has("month")) {
    return "daily";
  }
  if (kinds.has("quarter")) return "quarterly";
  if (kinds.has("year") && !kinds.has("month")) return "yearly";
  return "monthly";
}

function toNumberLike(value: CellValue): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;

  let text = value.trim();
  if (!text || text === "-" || /^-+$/.test(text)) return null;

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

function detectSheetRefs(formula: string | null | undefined): string[] {
  if (!formula) return [];
  const refs = new Set<string>();
  const regex = /(?:'([^']+)'|([A-Za-z0-9_.& -]+))!/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(formula)) !== null) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const normalized = raw.trim();
    if (normalized) refs.add(normalized);
  }
  return Array.from(refs);
}

function inferCurrency(workbook: XLSX.WorkBook, rows: Row[] = []): string {
  const hints = [
    { pattern: /\b(idr|rupiah)\b|(?:^|[^a-z])rp\.?(?:[^a-z]|$)/i, code: "IDR" },
    { pattern: /\busd\b|\$/i, code: "USD" },
    { pattern: /\beur\b|€/i, code: "EUR" },
    { pattern: /\bsgd\b/i, code: "SGD" },
  ] as const;

  const samples: CellValue[] = [];
  for (const row of rows.slice(0, 40)) {
    samples.push(...row.slice(0, 16));
  }

  for (const sample of samples) {
    const text = toText(sample);
    for (const hint of hints) {
      if (hint.pattern.test(text)) return hint.code;
    }
  }

  const props = workbook.Props ?? {};
  for (const key of ["Company", "Title", "Subject", "Category"] as const) {
    const text = toText(props[key] as CellValue);
    for (const hint of hints) {
      if (hint.pattern.test(text)) return hint.code;
    }
  }

  return "USD";
}

function extractEntity(
  workbook: XLSX.WorkBook,
  options: CanonicalFinanceParseOptions,
  rowsBySheet: Record<string, Row[]> = {},
): string {
  const sourcePath = normalizeName(options.sourcePath ?? "");
  const fileName = basename(options.fileName).replace(/\.[^.]+$/, "");
  const props = workbook.Props ?? {};
  const propCandidates: CellValue[] = [
    props.Company as CellValue,
    props.Title as CellValue,
    props.Subject as CellValue,
    props.Category as CellValue,
  ];

  const directCandidates: Array<string | null> = [];
  if (sourcePath) {
    const pathMatches = Array.from(sourcePath.matchAll(/\(([^)]+)\)/g)).map(
      (match) => normalizeName(match[1]),
    );
    for (const match of pathMatches) {
      directCandidates.push(match);
    }
  }
  if (fileName) {
    directCandidates.push(fileName);
  }

  const textCandidates: string[] = [];
  for (const candidate of directCandidates) {
    if (!candidate) continue;
    const normalized = extractMeaningfulEntityCandidate(candidate);
    if (normalized) textCandidates.push(normalized);
  }

  for (const value of propCandidates) {
    const text = extractMeaningfulEntityCandidate(toText(value));
    if (text) textCandidates.push(text);
  }

  for (const sheetName of workbook.SheetNames.slice(0, 4)) {
    const rows = rowsBySheet[sheetName] ?? [];
    for (const row of rows.slice(0, 6)) {
      const text = extractMeaningfulEntityCandidate(
        [row[0], row[1], row[2]].map((cell) => toText(cell)).find(Boolean) ?? "",
      );
      if (text) textCandidates.push(text);
    }
  }

  for (const candidate of textCandidates) {
    const lowered = candidate.toLowerCase();
    if (
      lowered &&
      !/(balance sheet|profit and loss|income statement|statement of cash flows|trial balance|general ledger|forecast|projection|statistics?)/i.test(
        candidate,
      ) &&
      lowered !== "unknown" &&
      lowered !== "n/a" &&
      lowered !== "na" &&
      !/^\d+(?:[./-]\d+)*$/.test(lowered)
    ) {
      return candidate;
    }
  }

  return normalizeName(fileName) || "Unknown";
}

const ENTITY_STOPWORDS = new Set([
  "fs",
  "financial",
  "financials",
  "statement",
  "statements",
  "report",
  "reports",
  "summary",
  "trial",
  "balance",
  "cash",
  "flow",
  "profit",
  "loss",
  "income",
  "projection",
  "forecast",
  "budget",
  "actual",
  "monthly",
  "month",
  "year",
  "final",
  "draft",
  "revised",
  "copy",
  "reporting",
  "analysis",
  "ledger",
]);

function extractMeaningfulEntityCandidate(value: string): string | null {
  let text = normalizeName(value);
  if (!text) return null;

  const parenthetical = Array.from(text.matchAll(/\(([^)]+)\)/g))
    .map((match) => normalizeName(match[1]))
    .find(Boolean);
  if (parenthetical) {
    const inner = cleanupEntitySegment(parenthetical);
    if (inner) return inner;
  }

  text = cleanupEntitySegment(text);
  return text || null;
}

function cleanupEntitySegment(value: string): string {
  let text = normalizeName(value);
  if (!text) return "";

  text = text.replace(/^[\d\s.()+\-_/]+/, "");
  text = text.replace(/\b(?:19|20)\d{2}\b/g, " ");
  text = text.replace(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|agust|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi,
    " ",
  );
  text = text.replace(/\b(?:fs|financial(?:s)?|statement(?:s)?|report(?:s)?|summary|trial|balance|cash|flow|profit|loss|income|projection|forecast|budget|actual|monthly|month|year|final|draft|revised|copy|reporting|analysis|ledger)\b/gi, " ");
  text = text.replace(/[^A-Za-z0-9&()./ -]+/g, " ");

  const segments = text
    .split(/[-–|/]+/)
    .map((segment) => normalizeName(segment))
    .map((segment) => segment.replace(/^[\d\s.()+\-_/]+/, ""))
    .filter(Boolean);

  for (const segment of segments) {
    const tokens = segment
      .split(/\s+/)
      .map((token) => token.replace(/^[^A-Za-z0-9&]+|[^A-Za-z0-9&]+$/g, ""))
      .filter(Boolean);
    const meaningful = tokens.filter((token) => !ENTITY_STOPWORDS.has(token.toLowerCase()));
    const candidate = meaningful.join(" ").trim();
    if (candidate && /[A-Za-z]/.test(candidate)) {
      return candidate;
    }
  }

  const fallback = normalizeName(text)
    .replace(/^[\d\s.()+\-_/]+/, "")
    .trim();
  if (fallback && /[A-Za-z]/.test(fallback)) {
    const lowered = fallback.toLowerCase();
    if (!ENTITY_STOPWORDS.has(lowered) && !/^\d+(?:[./-]\d+)*$/.test(lowered)) {
      return fallback;
    }
  }

  return "";
}

function canonicalScopeKey(entity: string, sheetName: string): string {
  return `${slugify(entity)}:${slugify(sheetName)}`;
}

function highestScoreCandidate(
  workbook: XLSX.WorkBook,
  family: CanonicalFinanceFamily,
): string | null {
  const rowsCache = new Map<string, Row[]>();
  const loadRows = (sheetName: string): Row[] => {
    const cached = rowsCache.get(sheetName);
    if (cached) return cached;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: false,
    });
    rowsCache.set(sheetName, rows);
    return rows;
  };

  let best: { sheetName: string; score: number } | null = null;
  for (const sheetName of workbook.SheetNames) {
    const normalizedName = normalizeText(sheetName);
    const rows = loadRows(sheetName);
    const topRows = rows.slice(0, 12);
    const headerBlob = topRows
      .flat()
      .map((cell) => normalizeText(cell))
      .join(" | ");
    let score = 0;

    const hasFamilyHint = (() => {
      const hints =
        family === "pnl_month"
          ? PNL_FAMILY_HINTS
          : family === "balance_sheet_month"
            ? BS_FAMILY_HINTS
            : family === "cash_flow_month"
              ? CF_FAMILY_HINTS
            : family === "projection_plan"
              ? PROJECTION_FAMILY_HINTS
              : METRICS_FAMILY_HINTS;
      return hints.some(
        (pattern) => pattern.test(normalizedName) || pattern.test(headerBlob),
      );
    })();
    if (!hasFamilyHint) continue;

    score += 10;
    if (normalizedName.includes("summary")) score -= 2;
    if (normalizedName.includes("forecast")) score += 2;
    if (normalizedName.includes("projection")) score += 3;
    if (normalizedName.includes("cash flow")) score += 3;
    if (normalizedName.includes("balance sheet")) score += 3;
    if (normalizedName.includes("profit and loss")) score += 3;
    if (normalizedName.includes("statistic")) score += 3;

    if (family === "pnl_month") {
      if (/description.*actual.*budget/i.test(headerBlob)) score += 6;
      if (/for the month ended/i.test(headerBlob)) score += 4;
      if (/total revenue/i.test(headerBlob)) score += 3;
      if (/income statement/i.test(headerBlob)) score += 2;
      if (/consolidation|consilidation/i.test(normalizedName)) score += 3;
    } else if (family === "balance_sheet_month") {
      if (/assets.*liabilities/i.test(headerBlob)) score += 6;
      if (/current month.*last month/i.test(headerBlob)) score += 4;
      if (/account/i.test(headerBlob)) score += 2;
    } else if (family === "cash_flow_month") {
      if (/operating activities/i.test(headerBlob)) score += 6;
      if (/cash flows?/i.test(headerBlob)) score += 6;
    } else if (family === "projection_plan") {
      if (/forecast/i.test(headerBlob)) score += 5;
      if (/revenues?/i.test(headerBlob)) score += 3;
    } else if (family === "metrics") {
      if (/average|member|guest|day pass/i.test(headerBlob)) score += 5;
      if (/ytd/i.test(headerBlob)) score += 2;
    }

    if (!best || score > best.score) {
      best = { sheetName, score };
    }
  }

  return best?.sheetName ?? null;
}

function extractSupportingTabs(
  workbook: XLSX.WorkBook,
  primarySheetName: string,
): string[] {
  const sheet = workbook.Sheets[primarySheetName];
  if (!sheet) return [];
  const refs = new Set<string>();
  for (const cell of Object.values(sheet)) {
    if (!cell || typeof cell !== "object") continue;
    const formula = (cell as { f?: string | null }).f ?? null;
    for (const ref of detectSheetRefs(formula)) {
      if (ref !== primarySheetName) refs.add(ref);
    }
  }
  return Array.from(refs);
}

function rowHasAnyNumericValue(row: Row, valueColumnIndexes: number[]): boolean {
  return valueColumnIndexes.some((index) => toNumberLike(row[index]) !== null);
}

function resolveLabel(row: Row, labelIndexes: number[]): string {
  for (const index of labelIndexes) {
    const text = normalizeName(toText(row[index]));
    if (text) return text;
  }
  return "";
}

function resolveLabelWithIndex(
  row: Row,
  labelIndexes: number[],
): { label: string; index: number } | null {
  for (const index of labelIndexes) {
    const text = normalizeName(toText(row[index]));
    if (text) return { label: text, index };
  }
  return null;
}

function isSectionHeading(label: string, row: Row, valueColumnIndexes: number[]): boolean {
  const hasValues = rowHasAnyNumericValue(row, valueColumnIndexes);
  if (hasValues) return false;
  if (!label) return false;
  if (/^total\b/i.test(label)) return false;
  return label === label.toUpperCase() || /^[A-Z0-9][A-Z0-9\s/&().-]+$/.test(label);
}

function factUnitForFamily(family: CanonicalFinanceFamily, label: string): CanonicalFinanceFact["unit"] {
  if (family === "metrics") {
    const lowered = label.toLowerCase();
    if (/%|occupancy|margin|ratio|rate/.test(lowered)) return "percent";
    if (
      /day pass|member|guest|room|count|customer|visit|night|day|quantity/.test(
        lowered,
      )
    ) {
      return "count";
    }
    if (
      /revenue|sales|income|spend|profit|cost|cash|ticket|rate|average/.test(
        lowered,
      )
    ) {
      return "currency";
    }
    return "other";
  }

  return "currency";
}

function buildFact(args: {
  family: CanonicalFinanceFamily;
  label: string;
  value: CellValue;
  period: CanonicalPeriod;
  scenario: string;
  sourceSheetName: string;
  rowIndex: number;
  labelCell: string;
  valueCell: string;
  formula: string | null;
  currency: string;
  confidence?: number;
}): CanonicalFinanceFact | null {
  const numeric = toNumberLike(args.value);
  if (numeric === null) return null;

  return {
    key: [
      slugify(args.family),
      slugify(args.label),
      slugify(args.scenario),
      slugify(args.period.label ?? args.period.start),
      slugify(args.sourceSheetName),
      `${args.rowIndex}`,
      slugify(args.valueCell),
    ].join(":"),
    label: args.label,
    value: numeric,
    rawValue: typeof args.value === "string" || typeof args.value === "number" ? args.value : null,
    scenario: args.scenario,
    period: args.period,
    unit: factUnitForFamily(args.family, args.label),
    source: {
      sheetName: args.sourceSheetName,
      labelCell: args.labelCell,
      valueCell: args.valueCell,
      row: args.rowIndex + 1,
      column: args.valueCell.replace(/\d+/g, ""),
      formula: args.formula,
    },
    confidence: args.confidence ?? (args.formula ? 0.88 : 0.98),
  };
}

function extractScenarioLayoutForm(
  workbook: XLSX.WorkBook,
  sheetName: string,
  family: CanonicalFinanceFamily,
  entity: string,
  currency: string,
  period: CanonicalPeriod,
): CanonicalFinanceForm | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });
  if (rows.length === 0) return null;

  const headerRowIndex = rows.findIndex((row) => {
    const header = row.map((cell) => normalizeText(cell));
    return (
      header.includes("description") &&
      header.includes("actual") &&
      (header.includes("budget") || header.includes("variance"))
    );
  });
  if (headerRowIndex < 0) return null;

  const headerRow = rows[headerRowIndex];
  const scenarioColumns: Array<{ scenario: string; index: number }> = [];
  headerRow.forEach((cell, index) => {
    const header = normalizeText(cell);
    if (!header) return;
    if (header === "description") return;
    if (PNL_LAYOUT_HEADERS.includes(header)) {
      scenarioColumns.push({ scenario: header.replace(/\s+/g, "_"), index });
    }
  });
  if (scenarioColumns.length === 0) return null;

  const labelIndexes = [3, 2, 1, 0];
  const facts: CanonicalFinanceFact[] = [];
  const notes = new Set<string>();
  const supportingTabs = new Set<string>(extractSupportingTabs(workbook, sheetName));
  let currentSection = "";

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const resolvedLabel = resolveLabelWithIndex(row, labelIndexes);
    const label = resolvedLabel?.label ?? "";
    if (!label) continue;

    const valueColumns = scenarioColumns.map((entry) => entry.index);
    if (isSectionHeading(label, row, valueColumns)) {
      currentSection = slugify(label);
      continue;
    }

    if (/^statistics?$/i.test(label) || currentSection === "statistic") {
      notes.add("Skipped statistics section on statement sheet in favor of metrics tab");
      continue;
    }

    for (const scenarioColumn of scenarioColumns) {
      const valueCell = row[scenarioColumn.index];
      const fact = buildFact({
        family,
        label,
        value: valueCell,
        period,
        scenario: scenarioColumn.scenario,
        sourceSheetName: sheetName,
        rowIndex,
        labelCell: XLSX.utils.encode_cell({
          r: rowIndex,
          c: resolvedLabel?.index ?? labelIndexes[0],
        }),
        valueCell: XLSX.utils.encode_cell({ r: rowIndex, c: scenarioColumn.index }),
        formula: (sheet[XLSX.utils.encode_cell({ r: rowIndex, c: scenarioColumn.index })] as { f?: string | null } | undefined)?.f ?? null,
        currency,
      });
      if (fact) {
        facts.push(fact);
        for (const ref of detectSheetRefs(fact.source.formula)) {
          if (ref !== sheetName) supportingTabs.add(ref);
        }
      }
    }
  }

  if (facts.length === 0) return null;

  return {
    family,
    sheetName,
    entity,
    scopeKey: canonicalScopeKey(entity, sheetName),
    currency,
    cadence: "monthly",
    period,
    facts,
    sourceTabs: [sheetName],
    supportingTabs: Array.from(supportingTabs),
    notes: Array.from(notes),
    needsReview: false,
  };
}

function extractPeriodLayoutForm(
  workbook: XLSX.WorkBook,
  sheetName: string,
  family: CanonicalFinanceFamily,
  entity: string,
  currency: string,
  options: {
    labelIndexes: number[];
    headerRowIndex: number;
    periodStartIndex: number;
    periodEndIndex?: number;
    notes?: string[];
    rowFilter?: (label: string, row: Row) => boolean;
  },
): CanonicalFinanceForm | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });
  if (rows.length === 0 || options.headerRowIndex >= rows.length) return null;

  const headerRow = rows[options.headerRowIndex];
  const valueColumnIndexes: number[] = [];
  const periodHeaders: Array<{
    columnIndex: number;
    period: CanonicalPeriod;
    cadence: CanonicalMetricCadence;
  }> = [];
  const endIndex = options.periodEndIndex ?? headerRow.length - 1;

  for (let c = options.periodStartIndex; c <= endIndex; c += 1) {
    const parsed = parsePeriodHeader(headerRow[c]);
    if (!parsed) continue;
    valueColumnIndexes.push(c);
    periodHeaders.push({
      columnIndex: c,
      period: parsed.period,
      cadence: parsed.cadence,
    });
  }

  if (periodHeaders.length === 0) return null;

  const cadence = inferCadenceFromPeriods(
    periodHeaders.map((entry) => ({
      period: entry.period,
      cadence: entry.cadence,
      kind:
        entry.cadence === "daily"
          ? "day"
          : entry.cadence === "quarterly"
            ? "quarter"
            : entry.cadence === "yearly"
              ? "year"
              : "month",
    })),
  );
  const formPeriod =
    periodHeaders.length > 1
      ? {
          start: periodHeaders[0].period.start,
          end: periodHeaders[periodHeaders.length - 1].period.end,
          label:
            periodHeaders[0].period.label && periodHeaders[periodHeaders.length - 1].period.label
              ? `${periodHeaders[0].period.label} to ${periodHeaders[periodHeaders.length - 1].period.label}`
              : undefined,
        }
      : periodHeaders[0].period;

  const facts: CanonicalFinanceFact[] = [];
  const notes = new Set<string>(options.notes ?? []);
  const supportingTabs = new Set<string>(extractSupportingTabs(workbook, sheetName));
  let currentSection = "";

  for (let rowIndex = options.headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const resolvedLabel = resolveLabelWithIndex(row, options.labelIndexes);
    const label = resolvedLabel?.label ?? "";
    if (!label) continue;

    if (options.rowFilter && !options.rowFilter(label, row)) continue;

    if (isSectionHeading(label, row, valueColumnIndexes)) {
      currentSection = slugify(label);
      continue;
    }

    if (currentSection === "statistic" && family === "pnl_month") {
      notes.add("Skipped statistics subsection on P&L sheet in favor of metrics tab");
      continue;
    }

    for (const entry of periodHeaders) {
      const valueCell = row[entry.columnIndex];
      const fact = buildFact({
        family,
        label,
        value: valueCell,
        period: entry.period,
        scenario: cadence === "daily" ? "value" : "actual",
        sourceSheetName: sheetName,
        rowIndex,
        labelCell: XLSX.utils.encode_cell({
          r: rowIndex,
          c: resolvedLabel?.index ?? options.labelIndexes[0],
        }),
        valueCell: XLSX.utils.encode_cell({ r: rowIndex, c: entry.columnIndex }),
        formula: (sheet[XLSX.utils.encode_cell({ r: rowIndex, c: entry.columnIndex })] as { f?: string | null } | undefined)?.f ?? null,
        currency,
      });
      if (fact) {
        facts.push(fact);
        for (const ref of detectSheetRefs(fact.source.formula)) {
          if (ref !== sheetName) supportingTabs.add(ref);
        }
      }
    }
  }

  if (facts.length === 0) return null;

  return {
    family,
    sheetName,
    entity,
    scopeKey: canonicalScopeKey(entity, sheetName),
    currency,
    cadence,
    period: formPeriod,
    facts,
    sourceTabs: [sheetName],
    supportingTabs: Array.from(supportingTabs),
    notes: Array.from(notes),
    needsReview: false,
  };
}

function extractCashFlowForm(
  workbook: XLSX.WorkBook,
  sheetName: string,
  entity: string,
  currency: string,
  filePeriod: CanonicalPeriod,
): CanonicalFinanceForm | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });
  if (rows.length === 0) return null;

  const headerRowIndex = rows.findIndex((row) =>
    row.some((cell) => normalizeText(cell).includes("account")) &&
    row.some((cell) => normalizeText(cell).includes("month")),
  );
  const valueColumnIndex = headerRowIndex >= 0 ? rows[headerRowIndex].findIndex((cell) => normalizeText(cell).includes("jan")) : 1;
  const labelIndexes = [0, 1];

  const facts: CanonicalFinanceFact[] = [];
  const supportingTabs = new Set<string>(extractSupportingTabs(workbook, sheetName));
  let currentSection = "";

  for (let rowIndex = Math.max(headerRowIndex + 1, 0); rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const resolvedLabel = resolveLabelWithIndex(row, labelIndexes);
    const label = resolvedLabel?.label ?? "";
    if (!label) continue;

    if (isSectionHeading(label, row, [valueColumnIndex])) {
      currentSection = slugify(label);
      continue;
    }

    const fact = buildFact({
      family: "cash_flow_month",
      label,
      value: row[valueColumnIndex],
      period: filePeriod,
      scenario: "actual",
      sourceSheetName: sheetName,
      rowIndex,
      labelCell: XLSX.utils.encode_cell({
        r: rowIndex,
        c: resolvedLabel?.index ?? labelIndexes[0],
      }),
      valueCell: XLSX.utils.encode_cell({ r: rowIndex, c: valueColumnIndex }),
      formula: (sheet[XLSX.utils.encode_cell({ r: rowIndex, c: valueColumnIndex })] as { f?: string | null } | undefined)?.f ?? null,
      currency,
    });
    if (fact) {
      facts.push(fact);
      for (const ref of detectSheetRefs(fact.source.formula)) {
        if (ref !== sheetName) supportingTabs.add(ref);
      }
    }
  }

  if (facts.length === 0) return null;

  return {
    family: "cash_flow_month",
    sheetName,
    entity,
    scopeKey: canonicalScopeKey(entity, sheetName),
    currency,
    cadence: "monthly",
    period: filePeriod,
    facts,
    sourceTabs: [sheetName],
    supportingTabs: Array.from(supportingTabs),
    notes: [],
    needsReview: false,
  };
}

function inferMetricCadence(rows: Row[], headerRowIndex: number, startIndex: number): CanonicalMetricCadence {
  const periods: Array<ReturnType<typeof parsePeriodHeader>> = [];
  const headerRow = rows[headerRowIndex] ?? [];
  for (let c = startIndex; c < headerRow.length; c += 1) {
    const parsed = parsePeriodHeader(headerRow[c]);
    if (parsed) periods.push(parsed);
  }
  return inferCadenceFromPeriods(periods);
}

function inferMetricUnit(label: string): CanonicalFinanceFact["unit"] {
  const lowered = label.toLowerCase();
  if (/%|occupancy|margin|ratio|rate/.test(lowered)) return "percent";
  if (
    /day pass|member|guest|room|count|customer|visit|night|day|quantity|days?/i.test(
      lowered,
    )
  ) {
    return "count";
  }
  if (
    /revenue|sales|income|spend|profit|cost|cash|ticket|average|spend per guest|revenue per day/i.test(
      lowered,
    )
  ) {
    return "currency";
  }
  return "other";
}

function extractMetricsForm(
  workbook: XLSX.WorkBook,
  sheetName: string,
  entity: string,
  currency: string,
): CanonicalFinanceForm | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });
  if (rows.length === 0) return null;

  const headerRowIndex = rows.findIndex((row) =>
    row.some((cell) => {
      const text = normalizeText(cell);
      return (
        /^\d{4}-\d{2}-\d{2}$/.test(text) ||
        /\bjan[-/ ]\d{2,4}\b/.test(text) ||
        /\bytd\b/.test(text)
      );
    }),
  );
  if (headerRowIndex < 0) return null;

  const headerRow = rows[headerRowIndex];
  const periodColumns: Array<{ columnIndex: number; period: CanonicalPeriod; cadence: CanonicalMetricCadence }> = [];
  const ytdColumnIndexes: number[] = [];
  for (let c = 0; c < headerRow.length; c += 1) {
    const header = normalizeText(headerRow[c]);
    if (!header) continue;
    if (/^ytd/.test(header)) {
      ytdColumnIndexes.push(c);
      continue;
    }
    const parsed = parsePeriodHeader(headerRow[c]);
    if (!parsed) continue;
    periodColumns.push({
      columnIndex: c,
      period: parsed.period,
      cadence: parsed.cadence,
    });
  }

  if (periodColumns.length === 0) return null;

  const cadence = inferMetricCadence(rows, headerRowIndex, periodColumns[0].columnIndex);
  const formPeriod = periodColumns.length > 1
    ? {
        start: periodColumns[0].period.start,
        end: periodColumns[periodColumns.length - 1].period.end,
        label:
          periodColumns[0].period.label && periodColumns[periodColumns.length - 1].period.label
            ? `${periodColumns[0].period.label} to ${periodColumns[periodColumns.length - 1].period.label}`
            : undefined,
      }
    : periodColumns[0].period;

  const facts: CanonicalFinanceFact[] = [];
  const supportingTabs = new Set<string>(extractSupportingTabs(workbook, sheetName));
  const labelIndexes = [0, 1];
  let currentSection = "";

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const resolvedLabel = resolveLabelWithIndex(row, labelIndexes);
    const label = resolvedLabel?.label ?? "";
    if (!label) continue;
    if (/^note[;:]?/i.test(label)) continue;

    if (isSectionHeading(label, row, periodColumns.map((entry) => entry.columnIndex))) {
      currentSection = slugify(label);
      continue;
    }

    for (const entry of periodColumns) {
      const valueCell = row[entry.columnIndex];
      const scenario = entry.cadence === "daily" ? "value" : "period";
      const fact = buildFact({
        family: "metrics",
        label,
        value: valueCell,
        period: entry.period,
        scenario,
        sourceSheetName: sheetName,
        rowIndex,
        labelCell: XLSX.utils.encode_cell({
          r: rowIndex,
          c: resolvedLabel?.index ?? labelIndexes[0],
        }),
        valueCell: XLSX.utils.encode_cell({ r: rowIndex, c: entry.columnIndex }),
        formula: (sheet[XLSX.utils.encode_cell({ r: rowIndex, c: entry.columnIndex })] as { f?: string | null } | undefined)?.f ?? null,
        currency,
        confidence: 0.96,
      });
      if (fact) {
        fact.unit = inferMetricUnit(label);
        facts.push(fact);
        for (const ref of detectSheetRefs(fact.source.formula)) {
          if (ref !== sheetName) supportingTabs.add(ref);
        }
      }
    }

    for (const ytdColumnIndex of ytdColumnIndexes) {
      const valueCell = row[ytdColumnIndex];
      const fact = buildFact({
        family: "metrics",
        label,
        value: valueCell,
        period: formPeriod,
        scenario: "ytd",
        sourceSheetName: sheetName,
        rowIndex,
        labelCell: XLSX.utils.encode_cell({
          r: rowIndex,
          c: resolvedLabel?.index ?? labelIndexes[0],
        }),
        valueCell: XLSX.utils.encode_cell({ r: rowIndex, c: ytdColumnIndex }),
        formula: (sheet[XLSX.utils.encode_cell({ r: rowIndex, c: ytdColumnIndex })] as { f?: string | null } | undefined)?.f ?? null,
        currency,
        confidence: 0.93,
      });
      if (fact) {
        fact.unit = inferMetricUnit(label);
        facts.push(fact);
      }
    }
  }

  if (facts.length === 0) return null;

  return {
    family: "metrics",
    sheetName,
    entity,
    scopeKey: canonicalScopeKey(entity, sheetName),
    currency,
    cadence,
    period: formPeriod,
    facts,
    sourceTabs: [sheetName],
    supportingTabs: Array.from(supportingTabs),
    notes: [],
    needsReview: false,
  };
}

function extractPnlForm(
  workbook: XLSX.WorkBook,
  sheetName: string,
  entity: string,
  currency: string,
  filePeriod: CanonicalPeriod,
): CanonicalFinanceForm | null {
  const scenarioForm = extractScenarioLayoutForm(
    workbook,
    sheetName,
    "pnl_month",
    entity,
    currency,
    filePeriod,
  );
  if (scenarioForm) return scenarioForm;

  return extractPeriodLayoutForm(
    workbook,
    sheetName,
    "pnl_month",
    entity,
    currency,
    {
      labelIndexes: [3, 2, 1, 0],
      headerRowIndex: 3,
      periodStartIndex: 3,
      rowFilter: (label) => !/^note[;:]?/i.test(label),
      notes: ["Derived from period-based P&L layout"],
    },
  );
}

function extractBalanceSheetForm(
  workbook: XLSX.WorkBook,
  sheetName: string,
  entity: string,
  currency: string,
): CanonicalFinanceForm | null {
  const dualSide = extractDualSideBalanceSheetForm(workbook, sheetName, entity, currency);
  if (dualSide) return dualSide;

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });
  if (rows.length === 0) return null;

  const headerRowIndex = rows.findIndex((row) =>
    row.some((cell) => normalizeText(cell) === "account") &&
    row.some((cell) => parsePeriodHeader(cell)),
  );
  if (headerRowIndex < 0) return null;

  const labelIndexes = [2, 1, 0];
  const form = extractPeriodLayoutForm(
    workbook,
    sheetName,
    "balance_sheet_month",
    entity,
    currency,
    {
      labelIndexes,
      headerRowIndex,
      periodStartIndex: 3,
      notes: ["Balance sheet sourced from monthly snapshot layout"],
    },
  );

  return form;
}

function extractDualSideBalanceSheetForm(
  workbook: XLSX.WorkBook,
  sheetName: string,
  entity: string,
  currency: string,
): CanonicalFinanceForm | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });
  if (rows.length === 0) return null;

  const headerRowIndex = rows.findIndex((row) => {
    const blob = row.map((cell) => normalizeText(cell)).join(" | ");
    return (
      /assets/.test(blob) &&
      /liabilities/.test(blob) &&
      /this month/.test(blob) &&
      /last month/.test(blob)
    );
  });
  if (headerRowIndex < 0) return null;

  const filePeriod =
    parsePeriodFromFileName(sheetName) ??
    {
      start: "1970-01-01",
      end: "1970-01-01",
      label: "Unknown",
    };

  const facts: CanonicalFinanceFact[] = [];
  const supportingTabs = new Set<string>(extractSupportingTabs(workbook, sheetName));
  let leftSection = "";
  let rightSection = "";

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];

    const leftLabel = normalizeName(toText(row[1] ?? row[0]));
    const rightLabel = normalizeName(toText(row[6] ?? row[7]));
    const leftCurrent = row[3];
    const leftLast = row[4];
    const rightCurrent = row[8];
    const rightLast = row[9];

    const leftHasValues =
      toNumberLike(leftCurrent) !== null || toNumberLike(leftLast) !== null;
    const rightHasValues =
      toNumberLike(rightCurrent) !== null || toNumberLike(rightLast) !== null;

    if (leftLabel && !leftHasValues && /^(\d+\.|total\b)/i.test(leftLabel)) {
      leftSection = slugify(leftLabel);
      continue;
    }
    if (rightLabel && !rightHasValues && /^(\d+\.|total\b)/i.test(rightLabel)) {
      rightSection = slugify(rightLabel);
      continue;
    }

    if (leftLabel && leftHasValues) {
      const currentFact = buildFact({
        family: "balance_sheet_month",
        label: leftLabel,
        value: leftCurrent,
        period: filePeriod,
        scenario: "this_month",
        sourceSheetName: sheetName,
        rowIndex,
        labelCell: XLSX.utils.encode_cell({ r: rowIndex, c: 1 }),
        valueCell: XLSX.utils.encode_cell({ r: rowIndex, c: 3 }),
        formula: (sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 3 })] as { f?: string | null } | undefined)?.f ?? null,
        currency,
      });
      const lastFact = buildFact({
        family: "balance_sheet_month",
        label: leftLabel,
        value: leftLast,
        period: filePeriod,
        scenario: "last_month",
        sourceSheetName: sheetName,
        rowIndex,
        labelCell: XLSX.utils.encode_cell({ r: rowIndex, c: 1 }),
        valueCell: XLSX.utils.encode_cell({ r: rowIndex, c: 4 }),
        formula: (sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 4 })] as { f?: string | null } | undefined)?.f ?? null,
        currency,
      });
      if (currentFact) facts.push(currentFact);
      if (lastFact) facts.push(lastFact);
      for (const fact of [currentFact, lastFact]) {
        if (!fact) continue;
        for (const ref of detectSheetRefs(fact.source.formula)) {
          if (ref !== sheetName) supportingTabs.add(ref);
        }
      }
      continue;
    }

    if (rightLabel && rightHasValues) {
      const currentFact = buildFact({
        family: "balance_sheet_month",
        label: rightLabel,
        value: rightCurrent,
        period: filePeriod,
        scenario: "this_month",
        sourceSheetName: sheetName,
        rowIndex,
        labelCell: XLSX.utils.encode_cell({ r: rowIndex, c: 6 }),
        valueCell: XLSX.utils.encode_cell({ r: rowIndex, c: 8 }),
        formula: (sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 8 })] as { f?: string | null } | undefined)?.f ?? null,
        currency,
      });
      const lastFact = buildFact({
        family: "balance_sheet_month",
        label: rightLabel,
        value: rightLast,
        period: filePeriod,
        scenario: "last_month",
        sourceSheetName: sheetName,
        rowIndex,
        labelCell: XLSX.utils.encode_cell({ r: rowIndex, c: 6 }),
        valueCell: XLSX.utils.encode_cell({ r: rowIndex, c: 9 }),
        formula: (sheet[XLSX.utils.encode_cell({ r: rowIndex, c: 9 })] as { f?: string | null } | undefined)?.f ?? null,
        currency,
      });
      if (currentFact) facts.push(currentFact);
      if (lastFact) facts.push(lastFact);
      for (const fact of [currentFact, lastFact]) {
        if (!fact) continue;
        for (const ref of detectSheetRefs(fact.source.formula)) {
          if (ref !== sheetName) supportingTabs.add(ref);
        }
      }
    }
  }

  if (facts.length === 0) return null;

  return {
    family: "balance_sheet_month",
    sheetName,
    entity,
    scopeKey: canonicalScopeKey(entity, sheetName),
    currency,
    cadence: "monthly",
    period: filePeriod,
    facts,
    sourceTabs: [sheetName],
    supportingTabs: Array.from(supportingTabs),
    notes: ["Dual-side balance sheet summary layout"],
    needsReview: false,
  };
}

function extractProjectionForm(
  workbook: XLSX.WorkBook,
  sheetName: string,
  entity: string,
  currency: string,
): CanonicalFinanceForm | null {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  });
  if (rows.length === 0) return null;

  const headerRowIndex = rows.findIndex((row) =>
    row.some((cell) => parsePeriodHeader(cell)) &&
    row.some((cell) => normalizeText(cell).includes("revenues")),
  );
  const headerIndex = headerRowIndex >= 0 ? headerRowIndex : 0;
  return extractPeriodLayoutForm(workbook, sheetName, "projection_plan", entity, currency, {
    labelIndexes: [1, 0, 2],
    headerRowIndex: headerIndex,
    periodStartIndex: 0,
    notes: ["Projection plan parsed as month-by-month forecast workbook"],
  });
}

function extractCandidateForms(
  workbook: XLSX.WorkBook,
  options: CanonicalFinanceParseOptions,
): CanonicalFinanceWorkbookExtraction {
  const rowsBySheet: Record<string, Row[]> = {};
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    rowsBySheet[sheetName] = XLSX.utils.sheet_to_json<Row>(sheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: false,
    });
  }

  const entity = extractEntity(workbook, options, rowsBySheet);
  const currency = inferCurrency(workbook, Object.values(rowsBySheet).flat());
  const filePeriod =
    parsePeriodFromFileName(options.fileName) ??
    parsePeriodFromSourcePath(options.sourcePath ?? "") ?? {
      start: "1970-01-01",
      end: "1970-01-01",
      label: "Unknown",
    };

  const forms: CanonicalFinanceForm[] = [];
  const candidateTabs = new Set<string>();

  const families: Array<{
    family: CanonicalFinanceFamily;
    extractor: () => CanonicalFinanceForm | null;
  }> = [
    {
      family: "pnl_month",
      extractor: () => {
        const sheetName = highestScoreCandidate(workbook, "pnl_month");
        if (!sheetName) return null;
        candidateTabs.add(sheetName);
        return extractPnlForm(workbook, sheetName, entity, currency, filePeriod);
      },
    },
    {
      family: "balance_sheet_month",
      extractor: () => {
        const sheetName = highestScoreCandidate(workbook, "balance_sheet_month");
        if (!sheetName) return null;
        candidateTabs.add(sheetName);
        return extractBalanceSheetForm(workbook, sheetName, entity, currency);
      },
    },
    {
      family: "cash_flow_month",
      extractor: () => {
        const sheetName = highestScoreCandidate(workbook, "cash_flow_month");
        if (!sheetName) return null;
        candidateTabs.add(sheetName);
        return extractCashFlowForm(workbook, sheetName, entity, currency, filePeriod);
      },
    },
    {
      family: "projection_plan",
      extractor: () => {
        const sheetName = highestScoreCandidate(workbook, "projection_plan");
        if (!sheetName) return null;
        candidateTabs.add(sheetName);
        return extractProjectionForm(workbook, sheetName, entity, currency);
      },
    },
    {
      family: "metrics",
      extractor: () => {
        const sheetName = highestScoreCandidate(workbook, "metrics");
        if (!sheetName) return null;
        candidateTabs.add(sheetName);
        return extractMetricsForm(workbook, sheetName, entity, currency);
      },
    },
  ];

  const warnings: string[] = [];
  for (const family of families) {
    const form = family.extractor();
    if (form) {
      forms.push(form);
    } else {
      warnings.push(`No canonical ${family.family} form found`);
    }
  }

  const evidenceTabs = workbook.SheetNames.filter(
    (sheetName) => !candidateTabs.has(sheetName),
  );

  return {
    fileName: options.fileName,
    entity,
    forms,
    candidateTabs: Array.from(candidateTabs),
    evidenceTabs,
    warnings,
  };
}

export function parseCanonicalFinanceWorkbook(
  buffer: Buffer,
  options: CanonicalFinanceParseOptions,
): CanonicalFinanceWorkbookExtraction {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellFormula: true,
    cellDates: true,
  });
  return extractCandidateForms(workbook, options);
}
