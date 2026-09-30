/**
 * Pre-canned Odoo report tools.
 *
 * Each function takes an OdooMcpClient (already connected via the per-turn
 * client) plus typed inputs, issues a schema-correct XML-RPC search/read,
 * aggregates server-side data in Node, and returns a flat result object the
 * model can render in one shot.
 *
 * Why these exist: the generic search_odoo tool burns 1-2 of the avg 3.5
 * tool calls per turn on schema discovery (move_id.* dotted paths,
 * malformed OR-domains, wrong fields). These wrappers hard-code the right
 * filter shape so the model gets correct numbers in a single call.
 *
 * Backward compat: search_odoo / get_odoo_record stay registered as a
 * fallback for inventory / HR / CRM / one-off lookups.
 */

import {
  genericSearch,
  fetchPartners,
  type Executor,
  type GenericSearchParams,
} from "@/lib/connectors/odoo";

// ── Period parsing ────────────────────────────────────────────────

export interface ParsedPeriod {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  label: string;
}

const RU_MONTHS: Record<string, number> = {
  январь: 1, января: 1, янв: 1,
  февраль: 2, февраля: 2, фев: 2,
  март: 3, марта: 3, мар: 3,
  апрель: 4, апреля: 4, апр: 4,
  май: 5, мая: 5,
  июнь: 6, июня: 6, июн: 6,
  июль: 7, июля: 7, июл: 7,
  август: 8, августа: 8, авг: 8,
  сентябрь: 9, сентября: 9, сен: 9, сент: 9,
  октябрь: 10, октября: 10, окт: 10,
  ноябрь: 11, ноября: 11, ноя: 11, нбр: 11,
  декабрь: 12, декабря: 12, дек: 12,
};

const EN_MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const DEFAULT_REPORT_TIME_ZONE =
  process.env.CORPUS_REPORT_TIME_ZONE?.trim() || "UTC";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function utcDate(year: number, month1to12: number, day: number): Date {
  return new Date(Date.UTC(year, month1to12 - 1, day));
}

function reportToday(now: Date): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_REPORT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    const year = Number(byType.get("year"));
    const month = Number(byType.get("month"));
    const day = Number(byType.get("day"));
    if (year && month && day) return utcDate(year, month, day);
  } catch {
    // Invalid timezone config should not break report execution.
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const PERIOD_TYPO_REPLACEMENTS: Array<[RegExp, string]> = [
  // Keep this intentionally narrow: finance periods should be typo-tolerant
  // for obvious date keywords, not fuzzy-guessed across arbitrary words.
  [/(^|\s)(вчреа|вцера|вчира|вчора|вчераа|вчерашн[а-я]*)($|\s|[,.!?;:])/g, "$1вчера$3"],
  [/(^|\s)(сегоня|сегдня|сегодн[яа])($|\s|[,.!?;:])/g, "$1сегодня$3"],
  [/(^|\s)(yesterdya|yesteday|yestday|yesterdayy|yestrday|yday)($|\s|[,.!?;:])/g, "$1yesterday$3"],
  [/(^|\s)(todya|toady|todayy|tdy)($|\s|[,.!?;:])/g, "$1today$3"],
];

function normalizePeriodTypos(input: string): string {
  return PERIOD_TYPO_REPLACEMENTS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    input.replaceAll("ё", "е"),
  );
}

/**
 * Parse a free-form period expression into ISO start/end (UTC).
 * Falls back to "this month" if nothing matches.
 *
 * Supports: "march", "march 2026", "Q1 2026", "last week", "yesterday",
 * "ytd", "last 30 days", "last 12 months", "2026-03-01..2026-03-31",
 * "март", "за прошлую неделю", "вчера", "за последний месяц",
 * "первый квартал 2026".
 */
export function resolvePeriod(input: string | undefined, now: Date = new Date()): ParsedPeriod {
  const lower = normalizePeriodTypos((input ?? "").trim().toLowerCase());
  const today = reportToday(now);

  // ISO range "YYYY-MM-DD..YYYY-MM-DD"
  const isoRange = lower.match(/^(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})$/);
  if (isoRange) {
    return { start: isoRange[1], end: isoRange[2], label: `${isoRange[1]} → ${isoRange[2]}` };
  }

  // Quarter: "Q1 2026", "первый квартал 2026"
  const enQuarter = lower.match(/q([1-4])(?:\s+(\d{4}))?/);
  const ruQuarter = lower.match(
    /(перв|втор|трет|четв)[а-яёй]*\s+(?:квартал|кв)\.?(?:\s+(\d{4}))?/,
  );
  if (enQuarter || ruQuarter) {
    let q: number;
    let yr: number;
    if (enQuarter) {
      q = Number(enQuarter[1]);
      yr = enQuarter[2] ? Number(enQuarter[2]) : today.getUTCFullYear();
    } else {
      const map: Record<string, number> = { перв: 1, втор: 2, трет: 3, четв: 4 };
      q = map[ruQuarter![1]];
      yr = ruQuarter![2] ? Number(ruQuarter![2]) : today.getUTCFullYear();
    }
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const start = `${yr}-${pad2(startMonth)}-01`;
    const end = `${yr}-${pad2(endMonth)}-${pad2(lastDayOfMonth(yr, endMonth))}`;
    return { start, end, label: `Q${q} ${yr}` };
  }

  // YTD
  if (/(^|\s)ytd(\s|$)/.test(lower)) {
    const yr = today.getUTCFullYear();
    return {
      start: `${yr}-01-01`,
      end: isoDate(today),
      label: `YTD ${yr}`,
    };
  }

  // Specific month: "march", "march 2026", "март", "март 2026"
  const monthWordMatch = lower.match(
    /(?:^|\s)(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec|январ[ьяй]|января|февра[льяй]|февраля|март[аеу]?|марта|апрел[ья]|апреля|ма[йя]|мая|июн[ья]|июня|июл[ья]|июля|август[аеу]?|августа|сентябр[ья]|сентября|октябр[ья]|октября|ноябр[ья]|ноября|декабр[ья]|декабря|янв|фев|мар|апр|май|июн|июл|авг|сен|сент|окт|ноя|нбр|дек)(?:\s+(\d{4}))?(?:$|\s)/,
  );
  if (monthWordMatch) {
    const word = monthWordMatch[1];
    const m = EN_MONTHS[word] ?? RU_MONTHS[word];
    if (m) {
      const yr = monthWordMatch[2] ? Number(monthWordMatch[2]) : today.getUTCFullYear();
      const start = `${yr}-${pad2(m)}-01`;
      const end = `${yr}-${pad2(m)}-${pad2(lastDayOfMonth(yr, m))}`;
      return { start, end, label: `${word} ${yr}` };
    }
  }

  // Relative: yesterday, today, last week, last month, last 7 days, last 30 days, last 12 months
  if (/(^|\s)(yesterday|вчера)(\s|$)/.test(lower)) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - 1);
    return { start: isoDate(d), end: isoDate(d), label: "yesterday" };
  }
  if (/(^|\s)(today|сегодня)(\s|$)/.test(lower)) {
    return { start: isoDate(today), end: isoDate(today), label: "today" };
  }

  const lastDays = lower.match(/last\s+(\d+)\s+days?|за\s+последние\s+(\d+)\s+дн/);
  if (lastDays) {
    const n = Number(lastDays[1] ?? lastDays[2]);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - (n - 1));
    return { start: isoDate(start), end: isoDate(today), label: `last ${n} days` };
  }

  const lastMonths = lower.match(/last\s+(\d+)\s+months?|за\s+последние\s+(\d+)\s+мес/);
  if (lastMonths) {
    const n = Number(lastMonths[1] ?? lastMonths[2]);
    const start = new Date(today);
    start.setUTCMonth(start.getUTCMonth() - n);
    start.setUTCDate(1);
    return { start: isoDate(start), end: isoDate(today), label: `last ${n} months` };
  }

  if (/(^|\s)(last\s+week|за\s+прошлую\s+неделю|прошлая\s+неделя)(\s|$)/.test(lower)) {
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() - end.getUTCDay() - 1); // last Saturday (0=Sun)
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    return { start: isoDate(start), end: isoDate(end), label: "last week" };
  }

  if (
    /(^|\s)(this\s+week|на\s+этой\s+неделе|текущая\s+неделя)(\s|$)/.test(lower)
  ) {
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // Sunday
    return { start: isoDate(start), end: isoDate(today), label: "this week" };
  }

  if (
    /(^|\s)(last\s+month|за\s+прошлый\s+месяц|прошлый\s+месяц)(\s|$)/.test(lower)
  ) {
    const ref = new Date(today);
    ref.setUTCMonth(ref.getUTCMonth() - 1);
    const yr = ref.getUTCFullYear();
    const m = ref.getUTCMonth() + 1;
    return {
      start: `${yr}-${pad2(m)}-01`,
      end: `${yr}-${pad2(m)}-${pad2(lastDayOfMonth(yr, m))}`,
      label: "last month",
    };
  }

  if (
    /(^|\s)(this\s+month|за\s+этот\s+месяц|текущий\s+месяц)(\s|$)/.test(lower) ||
    !lower
  ) {
    const yr = today.getUTCFullYear();
    const m = today.getUTCMonth() + 1;
    return {
      start: `${yr}-${pad2(m)}-01`,
      end: isoDate(today),
      label: "this month",
    };
  }

  // Pure year: "2025"
  const yearOnly = lower.match(/^(\d{4})$/);
  if (yearOnly) {
    const yr = Number(yearOnly[1]);
    return { start: `${yr}-01-01`, end: `${yr}-12-31`, label: String(yr) };
  }

  // Fallback: this month
  const yr = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  return {
    start: `${yr}-${pad2(m)}-01`,
    end: isoDate(today),
    label: "this month (fallback)",
  };
}

// ── Currency aggregation helpers ──────────────────────────────────

interface MoneyBucket {
  total: number;
  count: number;
}

function emptyBucket(): MoneyBucket {
  return { total: 0, count: 0 };
}

function addToBucket(bucket: Record<string, MoneyBucket>, currency: string, amount: number) {
  if (!bucket[currency]) bucket[currency] = emptyBucket();
  bucket[currency].total += amount;
  bucket[currency].count += 1;
}

function tupleName(value: unknown): string {
  if (Array.isArray(value) && typeof value[1] === "string") return value[1];
  return "?";
}

function tupleId(value: unknown): number | null {
  if (Array.isArray(value) && typeof value[0] === "number") return value[0];
  return null;
}

const ODOO_COMPANY_CURRENCY = "company_currency";
const REPORT_PAGE_SIZE = 1000;
const REPORT_MAX_ROWS = 20_000;
const OPERATING_REVENUE_TYPES = ["income"];
const OTHER_INCOME_TYPES = ["income_other"];
const EXPENSE_TYPES = ["expense_direct_cost", "expense", "expense_depreciation"];

interface OdooCompanyScopeParams {
  odoo_company_name?: string | null;
}

interface OdooCompanyScope {
  requestedName: string | null;
  matchedIds: number[];
  matchedNames: string[];
}

export interface OdooCompanyScopeResult {
  requested_name: string | null;
  matched_company_ids: number[];
  matched_company_names: string[];
  filter_applied: boolean;
}

type SearchAllResult<T> = {
  rows: T[];
  truncated: boolean;
};

async function searchAll<T>(
  exec: Executor,
  params: Omit<GenericSearchParams, "limit" | "offset">,
  maxRows = REPORT_MAX_ROWS,
): Promise<SearchAllResult<T>> {
  const rows: T[] = [];
  for (let offset = 0; offset < maxRows; offset += REPORT_PAGE_SIZE) {
    const page = (await genericSearch(exec, {
      ...params,
      limit: Math.min(REPORT_PAGE_SIZE, maxRows - offset),
      offset,
    })) as T[];
    rows.push(...page);
    if (page.length < REPORT_PAGE_SIZE) {
      return { rows, truncated: false };
    }
  }
  return { rows, truncated: true };
}

interface OdooAccountRecord {
  id: number;
  code?: string;
  name?: string;
  account_type: string;
}

interface OdooMoveLineRecord {
  id: number;
  date: string;
  balance: number;
  debit?: number;
  credit?: number;
  account_id: unknown;
  partner_id?: unknown;
  company_currency_id?: unknown;
  company_id?: unknown;
  move_id?: unknown;
  journal_id?: unknown;
}

interface OdooCompanyRecord {
  id: number;
  name: string;
}

function normalizeCompanyNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(pt|cv|yayasan)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ODOO_COMPANY_NAME_ALIASES: Record<string, string[]> = {
  "example subsidiary": ["example subsidiary ltd"],
};

function companyNameMatchCandidates(name: string): Set<string> {
  const normalized = normalizeCompanyNameForMatch(name);
  return new Set([normalized, ...(ODOO_COMPANY_NAME_ALIASES[normalized] ?? [])]);
}

function companyScopeToResult(scope: OdooCompanyScope): OdooCompanyScopeResult {
  return {
    requested_name: scope.requestedName,
    matched_company_ids: scope.matchedIds,
    matched_company_names: scope.matchedNames,
    filter_applied: scope.matchedIds.length > 0,
  };
}

async function resolveOdooCompanyScope(
  exec: Executor,
  requestedName?: string | null,
): Promise<OdooCompanyScope> {
  const trimmed = requestedName?.trim() ?? "";
  if (!trimmed) {
    throw new Error(
      "Active app company name is required for Odoo finance reports; refusing to run an unscoped finance query.",
    );
  }

  const companiesResult = await searchAll<OdooCompanyRecord>(
    exec,
    {
      model: "res.company",
      domain: [],
      fields: ["id", "name"],
    },
    5000,
  );
  const targets = companyNameMatchCandidates(trimmed);
  const matches = companiesResult.rows.filter((company) => {
    const normalized = normalizeCompanyNameForMatch(company.name ?? "");
    return targets.has(normalized);
  });

  if (matches.length !== 1) {
    const names = matches.map((match) => match.name).filter(Boolean).join(", ");
    throw new Error(
      matches.length === 0
        ? `Could not resolve active app company "${trimmed}" to a unique Odoo res.company; refusing to run an unscoped finance query.`
        : `Active app company "${trimmed}" matched multiple Odoo companies (${names}); refusing to run an unscoped finance query.`,
    );
  }

  return {
    requestedName: trimmed,
    matchedIds: [matches[0].id],
    matchedNames: [matches[0].name],
  };
}

async function fetchAccountsByType(
  exec: Executor,
  accountTypes: string[],
): Promise<SearchAllResult<OdooAccountRecord>> {
  return searchAll<OdooAccountRecord>(exec, {
    model: "account.account",
    domain: [
      ["account_type", "in", accountTypes],
      ["deprecated", "=", false],
    ],
    fields: ["id", "code", "name", "account_type"],
  });
}

async function fetchPostedLinesForAccounts(
  exec: Executor,
  accountIds: number[],
  period: ParsedPeriod,
  companyIds?: number[],
): Promise<SearchAllResult<OdooMoveLineRecord>> {
  if (accountIds.length === 0) return { rows: [], truncated: false };
  const domain: unknown[] = [
    ["account_id", "in", accountIds],
    ["parent_state", "=", "posted"],
    ["date", ">=", period.start],
    ["date", "<=", period.end],
  ];
  if (companyIds && companyIds.length > 0) {
    domain.push(["company_id", "in", companyIds]);
  }
  return searchAll<OdooMoveLineRecord>(exec, {
    model: "account.move.line",
    domain,
    fields: [
      "id",
      "date",
      "balance",
      "debit",
      "credit",
      "account_id",
      "partner_id",
      "company_currency_id",
      "company_id",
      "move_id",
      "journal_id",
    ],
  });
}

function lineCompanyCurrency(line: OdooMoveLineRecord): string {
  const currency = tupleName(line.company_currency_id);
  return currency === "?" ? ODOO_COMPANY_CURRENCY : currency;
}

function lineSignedAmount(
  line: OdooMoveLineRecord,
  kind: "income" | "expense",
): number {
  // Odoo P&L reports use account.move.line.balance in company currency:
  // income is normally negative (credit), expense normally positive (debit).
  const balance = line.balance ?? 0;
  return kind === "income" ? -balance : balance;
}

// ── Bucket-by-month/week helper ───────────────────────────────────

export type Granularity = "total" | "day" | "week" | "month";

function bucketKey(dateStr: string, grain: Granularity): string {
  if (grain === "total") return "total";
  const [y, m, d] = dateStr.split("-");
  if (grain === "day") return `${y}-${m}-${d}`;
  if (grain === "month") return `${y}-${m}`;
  // week (ISO-ish): YYYY-Www
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${target.getUTCFullYear()}-W${pad2(week)}`;
}

// ── Tool 1: revenue summary ──────────────────────────────────────

export interface RevenueSummaryParams extends OdooCompanyScopeParams {
  period: string;
  partner_filter?: string;
  group_by?: "none" | "partner" | "month" | "account";
  basis?: "gl" | "invoices";
}

export interface RevenueSummaryResult {
  action: "odoo_revenue";
  period: ParsedPeriod;
  basis: "gl" | "invoices";
  total_by_currency: Record<string, MoneyBucket>;
  rows?: Array<{
    id: number;
    name: string;
    date: string;
    amount_total: number;
    currency: string;
    partner?: string;
    account?: string;
    move_type?: string;
  }>;
  by_partner?: Array<{ partner: string; total_by_currency: Record<string, number>; invoice_count: number }>;
  by_month?: Array<{ month: string; total_by_currency: Record<string, number>; invoice_count: number }>;
  by_account?: Array<{ account: string; total_by_currency: Record<string, number>; line_count: number }>;
  company_scope: OdooCompanyScopeResult;
  notes: string[];
}

export async function odooRevenueSummary(
  exec: Executor,
  params: RevenueSummaryParams,
): Promise<RevenueSummaryResult> {
  const period = resolvePeriod(params.period);
  const basis = params.basis ?? "gl";
  const companyScope = await resolveOdooCompanyScope(exec, params.odoo_company_name);
  const companyScopeResult = companyScopeToResult(companyScope);

  if (basis === "gl") {
    const accountsResult = await fetchAccountsByType(exec, OPERATING_REVENUE_TYPES);
    const accountById = new Map(accountsResult.rows.map((account) => [account.id, account]));
    const lineResult = await fetchPostedLinesForAccounts(
      exec,
      accountsResult.rows.map((account) => account.id),
      period,
      companyScope.matchedIds,
    );

    const totals: Record<string, MoneyBucket> = {};
    const rows: RevenueSummaryResult["rows"] = [];
    const byPartner: Record<string, { total_by_currency: Record<string, number>; invoice_count: number }> = {};
    const byMonth: Record<string, { total_by_currency: Record<string, number>; invoice_count: number }> = {};
    const byAccount: Record<string, { total_by_currency: Record<string, number>; line_count: number }> = {};
    const partnerNeedle = params.partner_filter?.trim().toLowerCase();

    for (const line of lineResult.rows) {
      const partner = tupleName(line.partner_id);
      if (
        partnerNeedle &&
        partner !== "?" &&
        !partner.toLowerCase().includes(partnerNeedle)
      ) {
        continue;
      }
      if (partnerNeedle && partner === "?") continue;

      const currency = lineCompanyCurrency(line);
      const amount = lineSignedAmount(line, "income");
      const accountId = tupleId(line.account_id);
      const account = accountId != null ? accountById.get(accountId) : null;
      const accountName = account
        ? `${account.code ?? ""} ${account.name ?? ""}`.trim()
        : tupleName(line.account_id);

      addToBucket(totals, currency, amount);
      rows.push({
        id: line.id,
        name: tupleName(line.move_id),
        date: line.date,
        amount_total: amount,
        currency,
        partner,
        account: accountName,
      });

      if (params.group_by === "partner") {
        const key = partner;
        if (!byPartner[key]) byPartner[key] = { total_by_currency: {}, invoice_count: 0 };
        byPartner[key].total_by_currency[currency] =
          (byPartner[key].total_by_currency[currency] ?? 0) + amount;
        byPartner[key].invoice_count += 1;
      }

      if (params.group_by === "month") {
        const key = bucketKey(line.date, "month");
        if (!byMonth[key]) byMonth[key] = { total_by_currency: {}, invoice_count: 0 };
        byMonth[key].total_by_currency[currency] =
          (byMonth[key].total_by_currency[currency] ?? 0) + amount;
        byMonth[key].invoice_count += 1;
      }

      if (params.group_by === "account") {
        const key = accountName;
        if (!byAccount[key]) byAccount[key] = { total_by_currency: {}, line_count: 0 };
        byAccount[key].total_by_currency[currency] =
          (byAccount[key].total_by_currency[currency] ?? 0) + amount;
        byAccount[key].line_count += 1;
      }
    }

    const notes = [
      "Revenue is computed from posted account.move.line rows on operating income accounts (account_type=income), using accounting date and company-currency balance. This matches Odoo P&L revenue; use basis=invoices only for billed customer invoices.",
      "This is recognized/accrual GL revenue, not proof of customer cash payment. For cash received, use payment, bank, or reconciliation evidence instead of this revenue total.",
    ];
    if (companyScope.matchedNames.length > 0) {
      notes.push(`Odoo company scope applied: ${companyScope.matchedNames.join(", ")}.`);
    }
    if (accountsResult.truncated) {
      notes.push("Income account list was truncated; totals may be incomplete.");
    }
    if (lineResult.truncated) {
      notes.push("Revenue line scan was truncated; narrow the period for completeness.");
    }
    if (Object.keys(totals).length > 1) {
      notes.push("Multi-currency totals shown separately; convert with convert_currency_amount if a single number is needed.");
    }

    return {
      action: "odoo_revenue",
      period,
      basis,
      company_scope: companyScopeResult,
      total_by_currency: totals,
      rows: rows.slice(0, 100),
      ...(params.group_by === "partner"
        ? {
            by_partner: Object.entries(byPartner)
              .map(([partner, b]) => ({ partner, ...b }))
              .sort(
                (a, b) =>
                  Object.values(b.total_by_currency).reduce((s, v) => s + v, 0) -
                  Object.values(a.total_by_currency).reduce((s, v) => s + v, 0),
              )
              .slice(0, 50),
          }
        : {}),
      ...(params.group_by === "month"
        ? {
            by_month: Object.entries(byMonth)
              .map(([month, b]) => ({ month, ...b }))
              .sort((a, b) => a.month.localeCompare(b.month)),
          }
        : {}),
      ...(params.group_by === "account"
        ? {
            by_account: Object.entries(byAccount)
              .map(([account, b]) => ({ account, ...b }))
              .sort(
                (a, b) =>
                  Object.values(b.total_by_currency).reduce((s, v) => s + v, 0) -
                  Object.values(a.total_by_currency).reduce((s, v) => s + v, 0),
              )
              .slice(0, 50),
          }
        : {}),
      notes,
    };
  }

  const domain: unknown[] = [
    ["move_type", "in", ["out_invoice", "out_refund"]],
    ["state", "=", "posted"],
    ["invoice_date", ">=", period.start],
    ["invoice_date", "<=", period.end],
  ];
  if (params.partner_filter && params.partner_filter.trim().length > 0) {
    domain.push(["partner_id.name", "ilike", params.partner_filter.trim()]);
  }
  if (companyScope.matchedIds.length > 0) {
    domain.push(["company_id", "in", companyScope.matchedIds]);
  }

  const fields = [
    "id",
    "name",
    "invoice_date",
    "amount_total",
    "amount_untaxed",
    "currency_id",
    "partner_id",
    "move_type",
  ];

  const recordsResult = await searchAll<{
    id: number;
    name: string;
    invoice_date: string;
    amount_total: number;
    amount_untaxed: number;
    currency_id: unknown;
    partner_id: unknown;
    move_type: string;
  }>(exec, {
    model: "account.move",
    domain,
    fields,
  });

  const totals: Record<string, MoneyBucket> = {};
  const rows: RevenueSummaryResult["rows"] = [];
  const byPartner: Record<string, { total_by_currency: Record<string, number>; invoice_count: number }> = {};
  const byMonth: Record<string, { total_by_currency: Record<string, number>; invoice_count: number }> = {};

  for (const r of recordsResult.rows) {
    const sign = r.move_type === "out_refund" ? -1 : 1;
    const amount = (r.amount_total ?? 0) * sign;
    const currency = tupleName(r.currency_id);
    addToBucket(totals, currency, amount);

    rows.push({
      id: r.id,
      name: r.name,
      date: r.invoice_date,
      amount_total: amount,
      currency,
      partner: tupleName(r.partner_id),
      move_type: r.move_type,
    });

    if (params.group_by === "partner") {
      const key = tupleName(r.partner_id);
      if (!byPartner[key]) byPartner[key] = { total_by_currency: {}, invoice_count: 0 };
      byPartner[key].total_by_currency[currency] =
        (byPartner[key].total_by_currency[currency] ?? 0) + amount;
      byPartner[key].invoice_count += 1;
    }

    if (params.group_by === "month") {
      const key = bucketKey(r.invoice_date, "month");
      if (!byMonth[key]) byMonth[key] = { total_by_currency: {}, invoice_count: 0 };
      byMonth[key].total_by_currency[currency] =
        (byMonth[key].total_by_currency[currency] ?? 0) + amount;
      byMonth[key].invoice_count += 1;
    }
  }

  const notes: string[] = [];
  if (recordsResult.truncated) {
    notes.push("Invoice scan hit the safety cap; narrow the period or partner filter for completeness.");
  }
  notes.push(
    "Invoice basis: totals are posted customer invoices/refunds (account.move out_invoice/out_refund) by invoice_date. This is not the same as Odoo P&L revenue; use basis=gl for P&L revenue.",
    "Posted invoices are billed amounts, not proof of cash received. Use payment, bank, or reconciliation evidence for cash-paid/cash-received questions.",
  );
  if (companyScope.matchedNames.length > 0) {
    notes.push(`Odoo company scope applied: ${companyScope.matchedNames.join(", ")}.`);
  }
  if (Object.keys(totals).length > 1) {
    notes.push("Multi-currency totals shown separately; convert with convert_currency_amount if a single number is needed.");
  }

  return {
    action: "odoo_revenue",
    period,
    basis,
    company_scope: companyScopeResult,
    total_by_currency: totals,
    rows: rows.slice(0, 100),
    ...(params.group_by === "partner"
      ? {
          by_partner: Object.entries(byPartner)
            .map(([partner, b]) => ({ partner, ...b }))
            .sort(
              (a, b) =>
                Object.values(b.total_by_currency).reduce((s, v) => s + v, 0) -
                Object.values(a.total_by_currency).reduce((s, v) => s + v, 0),
            )
            .slice(0, 50),
        }
      : {}),
    ...(params.group_by === "month"
      ? {
          by_month: Object.entries(byMonth)
            .map(([month, b]) => ({ month, ...b }))
            .sort((a, b) => a.month.localeCompare(b.month)),
        }
      : {}),
    notes,
  };
}

// ── Tool 2: vendor spending ──────────────────────────────────────

export interface VendorSpendingParams extends OdooCompanyScopeParams {
  vendor: string;
  period: string;
  granularity?: Granularity;
}

export interface VendorSpendingResult {
  action: "odoo_vendor_spend";
  period: ParsedPeriod;
  company_scope: OdooCompanyScopeResult;
  vendor_query: string;
  matched_partners: Array<{ id: number; name: string }>;
  total_by_currency: Record<string, MoneyBucket>;
  by_bucket: Array<{ bucket: string; total_by_currency: Record<string, number>; invoice_count: number }>;
  notes: string[];
}

export async function odooVendorSpending(
  exec: Executor,
  params: VendorSpendingParams,
): Promise<VendorSpendingResult> {
  const period = resolvePeriod(params.period);
  const grain: Granularity = params.granularity ?? "month";
  const companyScope = await resolveOdooCompanyScope(exec, params.odoo_company_name);
  const companyScopeResult = companyScopeToResult(companyScope);

  const partners = (await fetchPartners(exec, null)) as unknown as Array<{
    id: number;
    name: string;
    supplier_rank?: number;
  }>;
  const matched = partners
    .filter(
      (p) =>
        typeof p.name === "string" &&
        p.name.toLowerCase().includes(params.vendor.toLowerCase()),
    )
    .slice(0, 50);

  const notes: string[] = [];
  if (matched.length === 0) {
    return {
      action: "odoo_vendor_spend",
      period,
      company_scope: companyScopeResult,
      vendor_query: params.vendor,
      matched_partners: [],
      total_by_currency: {},
      by_bucket: [],
      notes: [`No partners matched "${params.vendor}". Try a shorter or different name.`],
    };
  }
  if (matched.length > 10) {
    notes.push(
      `Matched ${matched.length} partners (capped at 50) — totals aggregate across all matches. Use a more specific vendor name to narrow.`,
    );
  }

  const partnerIds = matched.map((p) => p.id);
  const domain: unknown[] = [
    ["move_type", "in", ["in_invoice", "in_refund"]],
    ["state", "=", "posted"],
    ["partner_id", "in", partnerIds],
    ["invoice_date", ">=", period.start],
    ["invoice_date", "<=", period.end],
  ];
  if (companyScope.matchedIds.length > 0) {
    domain.push(["company_id", "in", companyScope.matchedIds]);
  }
  const recordsResult = await searchAll<{
    id: number;
    invoice_date: string;
    amount_total: number;
    currency_id: unknown;
    move_type: string;
  }>(exec, {
    model: "account.move",
    domain,
    fields: ["id", "invoice_date", "amount_total", "currency_id", "move_type"],
  });

  const totals: Record<string, MoneyBucket> = {};
  const buckets: Record<string, { total_by_currency: Record<string, number>; invoice_count: number }> = {};

  for (const r of recordsResult.rows) {
    const sign = r.move_type === "in_refund" ? -1 : 1;
    const amount = (r.amount_total ?? 0) * sign;
    const currency = tupleName(r.currency_id);
    addToBucket(totals, currency, amount);

    const bk = bucketKey(r.invoice_date, grain);
    if (!buckets[bk]) buckets[bk] = { total_by_currency: {}, invoice_count: 0 };
    buckets[bk].total_by_currency[currency] = (buckets[bk].total_by_currency[currency] ?? 0) + amount;
    buckets[bk].invoice_count += 1;
  }

  if (recordsResult.truncated) {
    notes.push("Bill scan hit the safety cap; narrow period or vendor for completeness.");
  }
  if (companyScope.matchedNames.length > 0) {
    notes.push(`Odoo company scope applied: ${companyScope.matchedNames.join(", ")}.`);
  }
  notes.push(
    "Vendor spending is based on posted vendor bills/refunds by invoice_date. It is booked spend, not cash-paid payments.",
  );

  return {
    action: "odoo_vendor_spend",
    period,
    company_scope: companyScopeResult,
    vendor_query: params.vendor,
    matched_partners: matched.map(({ id, name }) => ({ id, name })),
    total_by_currency: totals,
    by_bucket: Object.entries(buckets)
      .map(([bucket, b]) => ({ bucket, ...b }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket)),
    notes,
  };
}

// ── Tool 3: purchases by period ──────────────────────────────────

export interface PurchasesByPeriodParams extends OdooCompanyScopeParams {
  period: string;
  granularity?: Granularity;
  state?: "confirmed" | "all";
  vendor_filter?: string;
}

export interface PurchasesByPeriodResult {
  action: "odoo_purchases";
  period: ParsedPeriod;
  company_scope: OdooCompanyScopeResult;
  total_by_currency: Record<string, MoneyBucket>;
  by_bucket: Array<{ bucket: string; total_by_currency: Record<string, number>; po_count: number }>;
  rows: Array<{ id: number; name: string; partner: string; date_order: string; amount_total: number; currency: string; state: string }>;
  notes: string[];
}

export async function odooPurchasesByPeriod(
  exec: Executor,
  params: PurchasesByPeriodParams,
): Promise<PurchasesByPeriodResult> {
  const period = resolvePeriod(params.period);
  const grain: Granularity = params.granularity ?? "week";
  const companyScope = await resolveOdooCompanyScope(exec, params.odoo_company_name);
  const companyScopeResult = companyScopeToResult(companyScope);

  const domain: unknown[] = [
    ["date_order", ">=", period.start],
    ["date_order", "<=", `${period.end} 23:59:59`],
  ];
  if (companyScope.matchedIds.length > 0) {
    domain.push(["company_id", "in", companyScope.matchedIds]);
  }
  if (params.state !== "all") {
    domain.push(["state", "in", ["purchase", "done"]]);
  }
  if (params.vendor_filter && params.vendor_filter.trim().length > 0) {
    domain.push(["partner_id.name", "ilike", params.vendor_filter.trim()]);
  }

  const recordsResult = await searchAll<{
    id: number;
    name: string;
    date_order: string;
    amount_total: number;
    currency_id: unknown;
    partner_id: unknown;
    state: string;
  }>(exec, {
    model: "purchase.order",
    domain,
    fields: ["id", "name", "date_order", "amount_total", "currency_id", "partner_id", "state"],
  });

  const totals: Record<string, MoneyBucket> = {};
  const buckets: Record<string, { total_by_currency: Record<string, number>; po_count: number }> = {};
  const rows: PurchasesByPeriodResult["rows"] = [];

  for (const r of recordsResult.rows) {
    const currency = tupleName(r.currency_id);
    addToBucket(totals, currency, r.amount_total ?? 0);
    const dateOnly = r.date_order.slice(0, 10);
    const bk = bucketKey(dateOnly, grain);
    if (!buckets[bk]) buckets[bk] = { total_by_currency: {}, po_count: 0 };
    buckets[bk].total_by_currency[currency] = (buckets[bk].total_by_currency[currency] ?? 0) + (r.amount_total ?? 0);
    buckets[bk].po_count += 1;

    rows.push({
      id: r.id,
      name: r.name,
      partner: tupleName(r.partner_id),
      date_order: r.date_order,
      amount_total: r.amount_total ?? 0,
      currency,
      state: r.state,
    });
  }

  const notes: string[] = [];
  if (recordsResult.truncated) {
    notes.push("PO scan hit the safety cap; narrow period or vendor.");
  }
  if (companyScope.matchedNames.length > 0) {
    notes.push(`Odoo company scope applied: ${companyScope.matchedNames.join(", ")}.`);
  }
  notes.push("Purchases are based on purchase.order date_order and confirmed/done state by default; they are not accounting expenses.");

  return {
    action: "odoo_purchases",
    period,
    company_scope: companyScopeResult,
    total_by_currency: totals,
    by_bucket: Object.entries(buckets)
      .map(([bucket, b]) => ({ bucket, ...b }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket)),
    rows: rows.slice(0, 100),
    notes,
  };
}

// ── Tool 4: P&L summary ──────────────────────────────────────────

export interface PnlSummaryParams extends OdooCompanyScopeParams {
  period: string;
  granularity?: Exclude<Granularity, "day">;
}

export interface PnlSummaryResult {
  action: "odoo_pnl";
  period: ParsedPeriod;
  basis: "gl";
  revenue_by_currency: Record<string, MoneyBucket>;
  other_income_by_currency: Record<string, MoneyBucket>;
  expense_by_currency: Record<string, MoneyBucket>;
  net_by_currency: Record<string, number>;
  company_scope: OdooCompanyScopeResult;
  by_bucket?: Array<{
    bucket: string;
    revenue_by_currency: Record<string, number>;
    other_income_by_currency: Record<string, number>;
    expense_by_currency: Record<string, number>;
  }>;
  by_account: Array<{
    account_type: string;
    account: string;
    total_by_currency: Record<string, number>;
    line_count: number;
  }>;
  notes: string[];
}

export async function odooPnlSummary(
  exec: Executor,
  params: PnlSummaryParams,
): Promise<PnlSummaryResult> {
  const period = resolvePeriod(params.period);
  const grain = params.granularity ?? "total";
  const companyScope = await resolveOdooCompanyScope(exec, params.odoo_company_name);
  const companyScopeResult = companyScopeToResult(companyScope);

  const accountTypes = [
    ...OPERATING_REVENUE_TYPES,
    ...OTHER_INCOME_TYPES,
    ...EXPENSE_TYPES,
  ];
  const accountsResult = await fetchAccountsByType(exec, accountTypes);
  const accountById = new Map(accountsResult.rows.map((account) => [account.id, account]));
  const lineResult = await fetchPostedLinesForAccounts(
    exec,
    accountsResult.rows.map((account) => account.id),
    period,
    companyScope.matchedIds,
  );

  const revenueByCcy: Record<string, MoneyBucket> = {};
  const otherIncomeByCcy: Record<string, MoneyBucket> = {};
  const expenseByCcy: Record<string, MoneyBucket> = {};
  const buckets: Record<string, {
    revenue_by_currency: Record<string, number>;
    other_income_by_currency: Record<string, number>;
    expense_by_currency: Record<string, number>;
  }> = {};
  const byAccount: Record<string, {
    account_type: string;
    account: string;
    total_by_currency: Record<string, number>;
    line_count: number;
  }> = {};

  for (const line of lineResult.rows) {
    const accountId = tupleId(line.account_id);
    const account = accountId != null ? accountById.get(accountId) : null;
    if (!account) continue;

    const isExpense = EXPENSE_TYPES.includes(account.account_type);
    const isOtherIncome = OTHER_INCOME_TYPES.includes(account.account_type);
    const currency = lineCompanyCurrency(line);
    const amount = lineSignedAmount(line, isExpense ? "expense" : "income");
    const target = isExpense
      ? expenseByCcy
      : isOtherIncome
        ? otherIncomeByCcy
        : revenueByCcy;
    addToBucket(target, currency, amount);

    const accountName = `${account.code ?? ""} ${account.name ?? ""}`.trim();
    const accountKey = `${account.account_type}:${accountName}`;
    if (!byAccount[accountKey]) {
      byAccount[accountKey] = {
        account_type: account.account_type,
        account: accountName,
        total_by_currency: {},
        line_count: 0,
      };
    }
    byAccount[accountKey].total_by_currency[currency] =
      (byAccount[accountKey].total_by_currency[currency] ?? 0) + amount;
    byAccount[accountKey].line_count += 1;

    if (grain !== "total") {
      const bk = bucketKey(line.date, grain);
      if (!buckets[bk]) {
        buckets[bk] = {
          revenue_by_currency: {},
          other_income_by_currency: {},
          expense_by_currency: {},
        };
      }
      const bucketTarget = isExpense
        ? buckets[bk].expense_by_currency
        : isOtherIncome
          ? buckets[bk].other_income_by_currency
          : buckets[bk].revenue_by_currency;
      bucketTarget[currency] = (bucketTarget[currency] ?? 0) + amount;
    }
  }

  const allCurrencies = new Set<string>([
    ...Object.keys(revenueByCcy),
    ...Object.keys(otherIncomeByCcy),
    ...Object.keys(expenseByCcy),
  ]);
  const netByCcy: Record<string, number> = {};
  for (const c of allCurrencies) {
    netByCcy[c] =
      (revenueByCcy[c]?.total ?? 0) +
      (otherIncomeByCcy[c]?.total ?? 0) -
      (expenseByCcy[c]?.total ?? 0);
  }

  const notes: string[] = [];
  if (accountsResult.truncated) {
    notes.push("P&L account list was truncated; totals may be incomplete.");
  }
  if (lineResult.truncated) {
    notes.push("P&L line scan was truncated; narrow the period for completeness.");
  }
  if (companyScope.matchedNames.length > 0) {
    notes.push(`Odoo company scope applied: ${companyScope.matchedNames.join(", ")}.`);
  }
  notes.push(
    "P&L is computed from posted account.move.line rows using accounting date and company-currency balance. Revenue is account_type=income; other income is account_type=income_other; expenses are expense_direct_cost, expense, and expense_depreciation. Invoice totals are not used for P&L.",
    "P&L is accrual/recognized accounting performance, not cash flow or proof of payment. Use bank, payment, or reconciliation evidence for cash-paid/cash-received questions.",
  );

  return {
    action: "odoo_pnl",
    period,
    basis: "gl",
    company_scope: companyScopeResult,
    revenue_by_currency: revenueByCcy,
    other_income_by_currency: otherIncomeByCcy,
    expense_by_currency: expenseByCcy,
    net_by_currency: netByCcy,
    by_account: Object.values(byAccount)
      .sort(
        (a, b) =>
          Object.values(b.total_by_currency).reduce((s, v) => s + v, 0) -
          Object.values(a.total_by_currency).reduce((s, v) => s + v, 0),
      )
      .slice(0, 100),
    ...(grain !== "total"
      ? {
          by_bucket: Object.entries(buckets)
            .map(([bucket, b]) => ({ bucket, ...b }))
            .sort((a, b) => a.bucket.localeCompare(b.bucket)),
        }
      : {}),
    notes,
  };
}

// ── Tool 5: recurring vendor spending ─────────────────────────────

export interface RecurringSpendingParams extends OdooCompanyScopeParams {
  vendor?: string;
  lookback_months?: number;
  min_occurrences?: number;
}

export interface RecurringSpendingResult {
  action: "odoo_recurring";
  period: ParsedPeriod;
  company_scope: OdooCompanyScopeResult;
  vendors: Array<{
    partner_id: number;
    partner_name: string;
    occurrences: number;
    distinct_months: number;
    avg_monthly_by_currency: Record<string, number>;
    last_charge_date: string;
  }>;
  notes: string[];
}

export async function odooRecurringSpending(
  exec: Executor,
  params: RecurringSpendingParams,
): Promise<RecurringSpendingResult> {
  const lookback = params.lookback_months ?? 12;
  const minOccurrences = params.min_occurrences ?? 3;
  const companyScope = await resolveOdooCompanyScope(exec, params.odoo_company_name);
  const companyScopeResult = companyScopeToResult(companyScope);
  const now = new Date();
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - lookback);
  start.setUTCDate(1);
  const period: ParsedPeriod = {
    start: isoDate(start),
    end: isoDate(now),
    label: `last ${lookback} months`,
  };

  const domain: unknown[] = [
    ["move_type", "in", ["in_invoice", "in_refund"]],
    ["state", "=", "posted"],
    ["invoice_date", ">=", period.start],
    ["invoice_date", "<=", period.end],
  ];
  if (companyScope.matchedIds.length > 0) {
    domain.push(["company_id", "in", companyScope.matchedIds]);
  }
  if (params.vendor && params.vendor.trim().length > 0) {
    domain.push(["partner_id.name", "ilike", params.vendor.trim()]);
  }

  const recordsResult = await searchAll<{
    partner_id: unknown;
    invoice_date: string;
    amount_total: number;
    currency_id: unknown;
    move_type: string;
  }>(exec, {
    model: "account.move",
    domain,
    fields: ["partner_id", "invoice_date", "amount_total", "currency_id", "move_type"],
  });

  const byPartner = new Map<
    number,
    {
      partner_name: string;
      occurrences: number;
      months: Set<string>;
      total_by_currency: Record<string, number>;
      last_charge_date: string;
    }
  >();

  for (const r of recordsResult.rows) {
    const pid = tupleId(r.partner_id);
    if (pid == null) continue;
    const sign = r.move_type === "in_refund" ? -1 : 1;
    const amount = (r.amount_total ?? 0) * sign;
    const currency = tupleName(r.currency_id);
    const monthKey = r.invoice_date.slice(0, 7);
    const existing = byPartner.get(pid) ?? {
      partner_name: tupleName(r.partner_id),
      occurrences: 0,
      months: new Set<string>(),
      total_by_currency: {},
      last_charge_date: r.invoice_date,
    };
    existing.occurrences += 1;
    existing.months.add(monthKey);
    existing.total_by_currency[currency] = (existing.total_by_currency[currency] ?? 0) + amount;
    if (r.invoice_date > existing.last_charge_date) {
      existing.last_charge_date = r.invoice_date;
    }
    byPartner.set(pid, existing);
  }

  const vendors = Array.from(byPartner.entries())
    .filter(([, v]) => v.occurrences >= minOccurrences && v.months.size >= Math.min(minOccurrences, 3))
    .map(([pid, v]) => {
      const avgByCurrency: Record<string, number> = {};
      for (const [c, total] of Object.entries(v.total_by_currency)) {
        avgByCurrency[c] = total / Math.max(1, v.months.size);
      }
      return {
        partner_id: pid,
        partner_name: v.partner_name,
        occurrences: v.occurrences,
        distinct_months: v.months.size,
        avg_monthly_by_currency: avgByCurrency,
        last_charge_date: v.last_charge_date,
      };
    })
    .sort((a, b) => b.distinct_months - a.distinct_months);

  const notes: string[] = [];
  if (recordsResult.truncated) {
    notes.push("Recurring bill scan hit the safety cap; narrow lookback or vendor for completeness.");
  }
  if (companyScope.matchedNames.length > 0) {
    notes.push(`Odoo company scope applied: ${companyScope.matchedNames.join(", ")}.`);
  }
  notes.push(
    "Recurring spending is detected from posted vendor bills/refunds by invoice_date. It is booked recurring spend, not cash payment recurrence.",
  );

  return {
    action: "odoo_recurring",
    period,
    company_scope: companyScopeResult,
    vendors: vendors.slice(0, 50),
    notes,
  };
}
