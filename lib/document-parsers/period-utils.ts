export interface ReportingPeriodLike {
  start: string;
  end: string;
  label?: string;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

const MONTH_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  januari: 1,
  feb: 2,
  february: 2,
  februari: 2,
  mar: 3,
  march: 3,
  maret: 3,
  apr: 4,
  april: 4,
  may: 5,
  mei: 5,
  jun: 6,
  june: 6,
  juni: 6,
  jul: 7,
  july: 7,
  juli: 7,
  aug: 8,
  august: 8,
  agust: 8,
  agustus: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  desember: 12,
};

const MONTH_TOKEN =
  "(jan(?:uary|uari)?|feb(?:ruary|ruari)?|mar(?:ch|et)?|apr(?:il)?|may|mei|jun(?:e|i)?|jul(?:y|i)?|aug(?:ust|ustus)?|agust|sep(?:t(?:ember)?)?|oct(?:ober|ober)?|nov(?:ember)?|dec(?:ember|ember)?)";

const RANGE_MONTH_RE = new RegExp(
  `${MONTH_TOKEN}\\s*(?:-|to|through|thru|/|\\u2013|\\u2014)\\s*${MONTH_TOKEN}\\s*(\\d{2,4})`,
  "i",
);
const SINGLE_MONTH_RE = new RegExp(`${MONTH_TOKEN}[\\s._-]*(\\d{2,4})`, "i");
const QUARTER_RE = /\bq([1-4])[\s._-]*(\d{2,4})\b/i;
const YEAR_MONTH_RE = /\b(19\d{2}|20\d{2})[._ -](0?[1-9]|1[0-2])\b/;
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function monthLastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeYear(raw: string): number | null {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  if (raw.length === 2) {
    if (parsed <= 79) return 2000 + parsed;
    return 1900 + parsed;
  }
  if (parsed >= 1900 && parsed <= 2100) return parsed;
  return null;
}

function parseMonth(raw: string): number | null {
  const normalized = raw.toLowerCase().trim();
  return MONTH_MAP[normalized] ?? null;
}

function parseIso(value: string): DateParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (month < 1 || month > 12) return null;
  const maxDay = monthLastDay(year, month);
  if (day < 1 || day > maxDay) return null;
  return { year, month, day };
}

function isQuarterRange(start: DateParts, end: DateParts): number | null {
  if (start.year !== end.year) return null;
  if (start.day !== 1) return null;
  const endMonthLastDay = monthLastDay(end.year, end.month);
  if (end.day !== endMonthLastDay) return null;
  const quarters = [
    { q: 1, startMonth: 1, endMonth: 3 },
    { q: 2, startMonth: 4, endMonth: 6 },
    { q: 3, startMonth: 7, endMonth: 9 },
    { q: 4, startMonth: 10, endMonth: 12 },
  ];
  for (const candidate of quarters) {
    if (
      start.month === candidate.startMonth &&
      end.month === candidate.endMonth
    ) {
      return candidate.q;
    }
  }
  return null;
}

function fallbackPeriodKey(period: ReportingPeriodLike): string {
  const source = (period.label ?? period.start ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return source || "unknown";
}

export function isUnknownReportingPeriod(period: ReportingPeriodLike): boolean {
  const unknownLabel = (period.label ?? "").trim().toLowerCase() === "unknown";
  const unknownSentinel =
    period.start === "1970-01-01" && period.end === "1970-01-01";
  return unknownSentinel || unknownLabel;
}

export function normalizeReportingPeriodKey(period: ReportingPeriodLike): string {
  if (isUnknownReportingPeriod(period)) {
    return "unknown";
  }

  const start = parseIso(period.start);
  const end = parseIso(period.end);
  if (!start || !end) return fallbackPeriodKey(period);

  if (start.year === end.year && start.month === end.month) {
    const monthEnd = monthLastDay(start.year, start.month);
    if (start.day === 1 && end.day === monthEnd) {
      return `${start.year}-${pad2(start.month)}`;
    }
    return toIsoDate(start.year, start.month, start.day);
  }

  const quarter = isQuarterRange(start, end);
  if (quarter) {
    return `${start.year}-q${quarter}`;
  }

  if (
    start.year === end.year &&
    start.month === 1 &&
    start.day === 1 &&
    end.month === 12 &&
    end.day === 31
  ) {
    return String(start.year);
  }

  return `${toIsoDate(start.year, start.month, start.day)}-to-${toIsoDate(end.year, end.month, end.day)}`;
}

export function parsePeriodFromFileName(
  fileName: string,
): ReportingPeriodLike | null {
  const normalized = fileName
    .replace(/\.[a-z0-9]+$/i, " ")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ");

  const rangeMatch = normalized.match(RANGE_MONTH_RE);
  if (rangeMatch) {
    const startMonth = parseMonth(rangeMatch[1]);
    const endMonth = parseMonth(rangeMatch[2]);
    const year = normalizeYear(rangeMatch[3]);
    if (startMonth && endMonth && year) {
      const wrapsAcrossYear = startMonth > endMonth;
      const startYear = wrapsAcrossYear ? year - 1 : year;
      const endYear = year;
      return {
        start: toIsoDate(startYear, startMonth, 1),
        end: toIsoDate(endYear, endMonth, monthLastDay(endYear, endMonth)),
        label: `${rangeMatch[1]}-${rangeMatch[2]} ${year}`,
      };
    }
  }

  const quarterMatch = normalized.match(QUARTER_RE);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1], 10);
    const year = normalizeYear(quarterMatch[2]);
    if (Number.isFinite(quarter) && year) {
      const startMonth = (quarter - 1) * 3 + 1;
      const endMonth = quarter * 3;
      return {
        start: toIsoDate(year, startMonth, 1),
        end: toIsoDate(year, endMonth, monthLastDay(year, endMonth)),
        label: `Q${quarter} ${year}`,
      };
    }
  }

  const monthMatch = normalized.match(SINGLE_MONTH_RE);
  if (monthMatch) {
    const month = parseMonth(monthMatch[1]);
    const year = normalizeYear(monthMatch[2]);
    if (month && year) {
      return {
        start: toIsoDate(year, month, 1),
        end: toIsoDate(year, month, monthLastDay(year, month)),
        label: `${monthMatch[1]} ${year}`,
      };
    }
  }

  const yearMonthMatch = normalized.match(YEAR_MONTH_RE);
  if (yearMonthMatch) {
    const year = normalizeYear(yearMonthMatch[1]);
    const month = parseInt(yearMonthMatch[2], 10);
    if (year && Number.isFinite(month)) {
      return {
        start: toIsoDate(year, month, 1),
        end: toIsoDate(year, month, monthLastDay(year, month)),
        label: `${year}-${pad2(month)}`,
      };
    }
  }

  const yearMatch = normalized.match(YEAR_RE);
  if (yearMatch) {
    const year = normalizeYear(yearMatch[1]);
    if (year) {
      return {
        start: toIsoDate(year, 1, 1),
        end: toIsoDate(year, 12, 31),
        label: String(year),
      };
    }
  }

  return null;
}

function normalizePathSegment(value: string): string {
  return value
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePeriodFromSourcePath(
  sourcePath: string,
): ReportingPeriodLike | null {
  if (typeof sourcePath !== "string" || sourcePath.trim().length === 0) {
    return null;
  }

  const segments = sourcePath
    .split(/[\\/]+/)
    .map((segment) => normalizePathSegment(segment))
    .filter((segment) => segment.length > 0);

  const fileSegment = segments.at(-1) ?? null;
  const directorySegments = fileSegment ? segments.slice(0, -1) : segments;

  for (let index = directorySegments.length - 1; index > 0; index -= 1) {
    const current = directorySegments[index];
    const previous = directorySegments[index - 1];
    const forward = parsePeriodFromFileName(`${previous} ${current}`);
    if (forward) return forward;
    const backward = parsePeriodFromFileName(`${current} ${previous}`);
    if (backward) return backward;
  }

  for (let index = directorySegments.length - 1; index >= 0; index -= 1) {
    const segment = directorySegments[index];
    const segmentMatch = parsePeriodFromFileName(segment);
    if (segmentMatch) return segmentMatch;
  }

  if (fileSegment) {
    const fileMatch = parsePeriodFromFileName(fileSegment);
    if (fileMatch) return fileMatch;
  }

  const normalizedPath = normalizePathSegment(sourcePath);
  const directMatch = parsePeriodFromFileName(normalizedPath);
  if (directMatch) return directMatch;

  return null;
}
