import { genericSearch } from "@/lib/connectors/odoo";
import { withOdooClient } from "@/lib/connectors/odoo-mcp-client";
import { getLatestConnectionCredentialsByProvider } from "@/lib/connections";
import type { ReportIntent } from "@/lib/report-jobs/types";

const ODOO_PAGE_SIZE = 200;
const ODOO_MAX_RECORDS = 5_000;
const ODOO_MAX_LINE_RECORDS = 20_000;
const LINE_LEVEL_DIMENSIONS = new Set(["venue", "department"]);

interface OdooMoveHeader {
  id: number;
  name: string;
  move_type: string;
  state: string;
  invoice_date: string | null;
  amount_total: number | string | null;
  amount_untaxed: number | string | null;
  amount_tax: number | string | null;
  currency_id: [number, string] | false | null;
  partner_id: [number, string] | false | null;
  payment_state?: string | null;
  ref?: string | false | null;
}

interface OdooMoveLine {
  id: number;
  date: string | null;
  name: string | null;
  move_name?: string | null;
  debit: number | string | null;
  credit: number | string | null;
  balance: number | string | null;
  account_id: [number, string] | false | null;
  partner_id?: [number, string] | false | null;
  analytic_distribution?: Record<string, number> | false | null;
  display_type?: string | false | null;
}

interface OdooMoveRecord {
  id: number;
  name: string;
  ref?: string | false | null;
}

interface OdooAccountRecord {
  id: number;
  code?: string | null;
  name: string;
  account_type: string;
}

interface OdooAnalyticAccountRecord {
  id: number;
  name: string;
  plan_id: [number, string] | false | null;
}

interface OdooPosSessionRecord {
  id: number;
  name: string;
  config_id: [number, string] | false | null;
}

export interface ReportFinanceRow {
  recordId: number;
  sourceType: "revenue" | "expense";
  moveType: string;
  name: string;
  partnerName: string | null;
  invoiceDate: string | null;
  currency: string | null;
  grossAmount: number;
  untaxedAmount: number;
  taxAmount: number;
  paymentState: string | null;
  reference: string | null;
  accountName?: string | null;
  accountType?: string | null;
  dimensionValues?: Record<string, string>;
}

export interface ReportFinanceBreakdownRow {
  dimension: string;
  value: string;
  revenueTotal: number;
  expenseTotal: number;
  netTotal: number;
  revenueCount: number;
  expenseCount: number;
}

export interface ReportFinanceSnapshot {
  rows: ReportFinanceRow[];
  breakdowns: ReportFinanceBreakdownRow[];
  totals: {
    revenueTotal: number;
    expenseTotal: number;
    netTotal: number;
    currency: string | null;
    revenueCount: number;
    expenseCount: number;
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function tupleLabel(value: unknown): string | null {
  return Array.isArray(value) && typeof value[1] === "string" ? value[1] : null;
}

function tupleId(value: unknown): number | null {
  return Array.isArray(value) && typeof value[0] === "number" ? value[0] : null;
}

function normalizeSignedAmount(moveType: string, amount: number): number {
  if (moveType === "out_refund" || moveType === "in_refund") {
    return amount * -1;
  }
  return amount;
}

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesKeyword(value: string | null | undefined, keywords: string[]): boolean {
  const normalized = normalizeLabel(value);
  return keywords.some((keyword) => normalized.includes(normalizeLabel(keyword)));
}

function isRevenueAccountType(accountType: string | null | undefined): boolean {
  const normalized = (accountType ?? "").toLowerCase();
  return normalized.includes("income");
}

function isExpenseAccountType(accountType: string | null | undefined): boolean {
  const normalized = (accountType ?? "").toLowerCase();
  return normalized.includes("expense") || normalized.includes("direct_cost");
}

function isLineLevelSubject(subject: string): boolean {
  return ["f&b", "multimedia"].includes(subject.toLowerCase());
}

function getScopeLabel(intent: ReportIntent): string | null {
  const value = intent.filters?.scopeLabel;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isLineLevelExecution(intent: ReportIntent): boolean {
  return (
    intent.dimensions.some((dimension) => LINE_LEVEL_DIMENSIONS.has(dimension)) ||
    isLineLevelSubject(intent.subject) ||
    Boolean(getScopeLabel(intent))
  );
}

function resolveSupportedScope(intent: ReportIntent): {
  includeRevenue: boolean;
  includeExpenses: boolean;
  lineLevel: boolean;
} {
  const unsupportedDimensions = intent.dimensions.filter(
    (dimension) => !LINE_LEVEL_DIMENSIONS.has(dimension),
  );
  if (unsupportedDimensions.length > 0) {
    throw new Error(
      `The current report executor supports venue and department segmentation only. Unsupported dimensions: ${unsupportedDimensions.join(", ")}.`,
    );
  }

  switch (intent.reportFamily) {
    case "revenue_report":
      return { includeRevenue: true, includeExpenses: false, lineLevel: isLineLevelExecution(intent) };
    case "expense_report":
      return { includeRevenue: false, includeExpenses: true, lineLevel: isLineLevelExecution(intent) };
    case "financial_analysis":
      return { includeRevenue: true, includeExpenses: true, lineLevel: isLineLevelExecution(intent) };
    default:
      throw new Error(
        `The current report executor supports revenue, expense, and financial analysis jobs only. Received ${intent.reportFamily}.`,
      );
  }
}

async function searchAllRecords<T>(
  exec: (params: {
    model: string;
    method: string;
    domain: unknown[];
    fields?: string[];
    limit?: number;
    offset?: number;
    order?: string;
  }) => Promise<unknown>,
  params: {
    model: string;
    domain: unknown[];
    fields?: string[];
    limit?: number;
    offset?: number;
  },
  maxRecords: number = ODOO_MAX_RECORDS,
): Promise<T[]> {
  const results: T[] = [];
  let offset = params.offset ?? 0;

  for (;;) {
    const page = (await genericSearch(exec, {
      model: params.model,
      domain: params.domain,
      fields: params.fields,
      limit: ODOO_PAGE_SIZE,
      offset,
    })) as T[];

    results.push(...page);
    offset += page.length;

    if (page.length < ODOO_PAGE_SIZE) break;
    if (results.length >= maxRecords) {
      throw new Error(
        `Odoo report query exceeded the ${maxRecords} record safety limit for ${params.model}.`,
      );
    }
  }

  return results;
}

async function searchAllMoves(
  portalUrl: string,
  token: string,
  moveTypes: string[],
  startDate: string,
  endDate: string,
): Promise<OdooMoveHeader[]> {
  return withOdooClient(portalUrl, token, async (client) =>
    searchAllRecords<OdooMoveHeader>(client.executeMethod.bind(client), {
      model: "account.move",
      domain: [
        ["move_type", "in", moveTypes],
        ["state", "=", "posted"],
        ["invoice_date", ">=", startDate],
        ["invoice_date", "<=", endDate],
      ],
      fields: [
        "id",
        "name",
        "move_type",
        "state",
        "invoice_date",
        "amount_total",
        "amount_untaxed",
        "amount_tax",
        "currency_id",
        "partner_id",
        "payment_state",
        "ref",
      ],
    }),
  );
}

function classifyLineSourceType(accountType: string): "revenue" | "expense" | null {
  if (isRevenueAccountType(accountType)) return "revenue";
  if (isExpenseAccountType(accountType)) return "expense";
  return null;
}

function subjectMatchesLine(
  subject: string,
  account: OdooAccountRecord | undefined,
  analytics: OdooAnalyticAccountRecord[],
): boolean {
  const normalizedSubject = subject.toLowerCase();
  if (normalizedSubject !== "f&b" && normalizedSubject !== "multimedia") return true;

  const keywords =
    normalizedSubject === "f&b"
      ? ["f&b", "fnb", "food and beverage", "food beverage", "food", "beverage"]
      : ["multimedia"];

  if (includesKeyword(account?.name, keywords) || includesKeyword(account?.code, keywords)) {
    return true;
  }

  return analytics.some((analytic) => includesKeyword(analytic.name, keywords));
}

function subjectKeywords(subject: string): string[] {
  const normalizedSubject = subject.toLowerCase();
  if (normalizedSubject === "f&b") {
    return ["f&b", "fnb", "food and beverage", "food beverage", "food", "beverage"];
  }
  if (normalizedSubject === "multimedia") {
    return ["multimedia"];
  }
  return [];
}

function chooseDimensionValue(
  dimension: string,
  analytics: Array<{ record: OdooAnalyticAccountRecord; weight: number }>,
): string | null {
  const candidates = analytics.filter(({ record }) => {
    const planLabel = tupleLabel(record.plan_id);
    if (dimension === "venue") {
      return includesKeyword(planLabel, ["project"]);
    }
    if (dimension === "department") {
      return includesKeyword(planLabel, ["ops", "general", "function"]) || includesKeyword(record.name, ["multimedia", "f&b"]);
    }
    return false;
  });

  if (candidates.length === 0) return null;

  return candidates.sort((left, right) => right.weight - left.weight)[0]?.record.name ?? null;
}

function normalizeVenueLabel(value: string): string {
  return value.replace(/\s*\(not used\)\s*$/i, "").trim();
}

function matchesScopeLabel(input: {
  scopeLabel: string | null;
  account: OdooAccountRecord | undefined;
  analytics: OdooAnalyticAccountRecord[];
  moveName: string | null | undefined;
  rowName: string | null | undefined;
  partnerName: string | null | undefined;
  venueLabel: string | null | undefined;
}): boolean {
  if (!input.scopeLabel) return true;

  const keywords = [input.scopeLabel];
  if (includesKeyword(input.account?.name, keywords) || includesKeyword(input.account?.code, keywords)) {
    return true;
  }
  if (includesKeyword(input.moveName, keywords) || includesKeyword(input.rowName, keywords)) {
    return true;
  }
  if (includesKeyword(input.partnerName, keywords) || includesKeyword(input.venueLabel, keywords)) {
    return true;
  }
  return input.analytics.some(
    (analytic) =>
      includesKeyword(analytic.name, keywords) || includesKeyword(tupleLabel(analytic.plan_id), keywords),
  );
}

function buildBreakdowns(rows: ReportFinanceRow[], dimensions: string[]): ReportFinanceBreakdownRow[] {
  const breakdowns = new Map<string, ReportFinanceBreakdownRow>();

  for (const dimension of dimensions) {
    for (const row of rows) {
      const value = row.dimensionValues?.[dimension] ?? `Unmapped ${dimension}`;
      const key = `${dimension}::${value}`;
      const current = breakdowns.get(key) ?? {
        dimension,
        value,
        revenueTotal: 0,
        expenseTotal: 0,
        netTotal: 0,
        revenueCount: 0,
        expenseCount: 0,
      };

      if (row.sourceType === "revenue") {
        current.revenueTotal += row.grossAmount;
        current.revenueCount += 1;
      } else {
        current.expenseTotal += row.grossAmount;
        current.expenseCount += 1;
      }
      current.netTotal = current.revenueTotal - current.expenseTotal;
      breakdowns.set(key, current);
    }
  }

  return [...breakdowns.values()].sort((left, right) => {
    if (left.dimension !== right.dimension) return left.dimension.localeCompare(right.dimension);
    return Math.abs(right.netTotal) - Math.abs(left.netTotal);
  });
}

async function loadLineLevelFinanceSnapshot(
  intent: ReportIntent,
  portalUrl: string,
  token: string,
  scope: { includeRevenue: boolean; includeExpenses: boolean },
): Promise<ReportFinanceSnapshot> {
  return withOdooClient(portalUrl, token, async (client) => {
    const exec = client.executeMethod.bind(client);
    const scopeLabel = getScopeLabel(intent);
    const allAccounts = await searchAllRecords<OdooAccountRecord>(exec, {
      model: "account.account",
      domain: [["deprecated", "=", false]],
      fields: ["id", "code", "name", "account_type"],
    });
    const scopedAccounts = allAccounts.filter((account) => {
      if (scope.includeRevenue && isRevenueAccountType(account.account_type)) return true;
      if (scope.includeExpenses && isExpenseAccountType(account.account_type)) return true;
      return false;
    });
    if (scopedAccounts.length === 0) {
      throw new Error("No eligible Odoo accounts were found for this report scope.");
    }

    const keywords = subjectKeywords(intent.subject);
    const subjectScopedAccounts =
      keywords.length > 0
        ? scopedAccounts.filter((account) =>
            includesKeyword(`${account.code ?? ""} ${account.name}`, keywords),
          )
        : scopedAccounts;
    const fetchLines = (accountIds: number[]) =>
      searchAllRecords<OdooMoveLine>(
        exec,
        {
          model: "account.move.line",
          domain: [
            ["parent_state", "=", "posted"],
            ["date", ">=", intent.period.startDate!],
            ["date", "<=", intent.period.endDate!],
            ["account_id", "in", accountIds],
          ],
          fields: [
            "id",
            "date",
            "name",
            "move_name",
            "debit",
            "credit",
            "balance",
            "account_id",
            "partner_id",
            "analytic_distribution",
            "display_type",
          ],
        },
        ODOO_MAX_LINE_RECORDS,
      );

    const narrowAccountIds = (subjectScopedAccounts.length > 0 ? subjectScopedAccounts : scopedAccounts).map(
      (account) => account.id,
    );
    let lines = await fetchLines(narrowAccountIds);
    if (lines.length === 0 && keywords.length > 0 && subjectScopedAccounts.length > 0) {
      lines = await fetchLines(scopedAccounts.map((account) => account.id));
    }

    const visibleLines = lines.filter((line) => {
      if (line.display_type === null || line.display_type === false || line.display_type === undefined) return true;
      return line.display_type === "product";
    });

    const accountIds = [...new Set(visibleLines.map((line) => tupleId(line.account_id)).filter((id): id is number => id !== null))];
    const analyticIds = [
      ...new Set(
        visibleLines.flatMap((line) =>
          Object.keys(line.analytic_distribution ?? {}).map((value) => Number(value)).filter(Number.isFinite),
        ),
      ),
    ];
    const moveNames = [
      ...new Set(
        visibleLines
          .map((line) => line.move_name)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    ];

    const [accounts, analyticAccounts, moves] = await Promise.all([
      Promise.resolve(
        (accountIds.length > 0
          ? scopedAccounts.filter((account) => accountIds.includes(account.id))
          : []) as OdooAccountRecord[],
      ),
      analyticIds.length > 0
        ? searchAllRecords<OdooAnalyticAccountRecord>(exec, {
            model: "account.analytic.account",
            domain: [["id", "in", analyticIds]],
            fields: ["id", "name", "plan_id"],
          })
        : Promise.resolve([] as OdooAnalyticAccountRecord[]),
      intent.dimensions.includes("venue") && moveNames.length > 0
        ? searchAllRecords<OdooMoveRecord>(exec, {
            model: "account.move",
            domain: [["name", "in", moveNames]],
            fields: ["id", "name", "ref"],
          })
        : Promise.resolve([] as OdooMoveRecord[]),
    ]);

    const accountMap = new Map(accounts.map((account) => [account.id, account]));
    const analyticMap = new Map(analyticAccounts.map((analytic) => [analytic.id, analytic]));
    const posRefs = [
      ...new Set(
        moves
          .map((move) => (typeof move.ref === "string" && move.ref.startsWith("POS/") ? move.ref : null))
          .filter((value): value is string => value !== null),
      ),
    ];
    const posSessions =
      posRefs.length > 0
        ? await searchAllRecords<OdooPosSessionRecord>(exec, {
            model: "pos.session",
            domain: [["name", "in", posRefs]],
            fields: ["id", "name", "config_id"],
          })
        : [];
    const posSessionMap = new Map(posSessions.map((session) => [session.name, session]));
    const moveVenueMap = new Map(
      moves.map((move) => {
        const session =
          typeof move.ref === "string"
            ? posSessionMap.get(move.ref)
            : undefined;
        const venueLabel = session ? normalizeVenueLabel(tupleLabel(session.config_id) ?? session.name) : null;
        return [move.name, venueLabel];
      }),
    );

    const rows: ReportFinanceRow[] = [];
    for (const line of visibleLines) {
      const accountId = tupleId(line.account_id);
      if (!accountId) continue;

      const account = accountMap.get(accountId);
      const sourceType = classifyLineSourceType(account?.account_type ?? "");
      if (!sourceType) continue;
      if (sourceType === "revenue" && !scope.includeRevenue) continue;
      if (sourceType === "expense" && !scope.includeExpenses) continue;

      const analyticDistribution = line.analytic_distribution ?? {};
      const analyticEntries = Object.entries(analyticDistribution)
        .map(([analyticId, weight]) => ({
          record: analyticMap.get(Number(analyticId)),
          weight: typeof weight === "number" ? weight : Number(weight),
        }))
        .filter(
          (
            entry,
          ): entry is { record: OdooAnalyticAccountRecord; weight: number } =>
            Boolean(entry.record) && Number.isFinite(entry.weight),
        );

      if (!subjectMatchesLine(intent.subject, account, analyticEntries.map((entry) => entry.record))) {
        continue;
      }

      const fallbackVenue =
        typeof line.move_name === "string" ? moveVenueMap.get(line.move_name) ?? null : null;
      if (
        !matchesScopeLabel({
          scopeLabel,
          account,
          analytics: analyticEntries.map((entry) => entry.record),
          moveName: line.move_name,
          rowName: line.name,
          partnerName: tupleLabel(line.partner_id),
          venueLabel: fallbackVenue,
        })
      ) {
        continue;
      }

      const amount =
        sourceType === "revenue"
          ? toNumber(line.credit) - toNumber(line.debit)
          : toNumber(line.debit) - toNumber(line.credit);

      const dimensionValues = Object.fromEntries(
        intent.dimensions
          .map((dimension) => {
            const analyticValue = chooseDimensionValue(dimension, analyticEntries);
            if (analyticValue) return [dimension, analyticValue] as const;
            if (dimension === "venue" && typeof line.move_name === "string") {
              if (fallbackVenue) return [dimension, fallbackVenue] as const;
            }
            return [dimension, null] as const;
          })
          .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
      );

      rows.push({
        recordId: line.id,
        sourceType,
        moveType: sourceType === "revenue" ? "account_move_line_income" : "account_move_line_expense",
        name: line.move_name ?? line.name ?? `Line ${line.id}`,
        partnerName: tupleLabel(line.partner_id),
        invoiceDate: line.date,
        currency: null,
        grossAmount: amount,
        untaxedAmount: amount,
        taxAmount: 0,
        paymentState: null,
        reference: line.name ?? null,
        accountName: account?.name ?? tupleLabel(line.account_id),
        accountType: account?.account_type ?? null,
        dimensionValues,
      });
    }

    if (scopeLabel && rows.length === 0) {
      throw new Error(
        `No Odoo ${intent.reportFamily === "expense_report" ? "expense" : "finance"} records matched scope label ${scopeLabel} for ${intent.period.label}.`,
      );
    }

    const revenueRows = rows.filter((row) => row.sourceType === "revenue");
    const expenseRows = rows.filter((row) => row.sourceType === "expense");

    return {
      rows,
      breakdowns: buildBreakdowns(rows, intent.dimensions),
      totals: {
        revenueTotal: revenueRows.reduce((sum, row) => sum + row.grossAmount, 0),
        expenseTotal: expenseRows.reduce((sum, row) => sum + row.grossAmount, 0),
        netTotal:
          revenueRows.reduce((sum, row) => sum + row.grossAmount, 0) -
          expenseRows.reduce((sum, row) => sum + row.grossAmount, 0),
        currency: null,
        revenueCount: revenueRows.length,
        expenseCount: expenseRows.length,
      },
    };
  });
}

export async function loadOdooFinanceSnapshot(intent: ReportIntent): Promise<ReportFinanceSnapshot> {
  if (!intent.period.startDate || !intent.period.endDate) {
    throw new Error("The report period is unresolved and cannot be executed.");
  }

  const scope = resolveSupportedScope(intent);
  const connection = await getLatestConnectionCredentialsByProvider(intent.companyId, "odoo");
  if (!connection) {
    throw new Error("Odoo is not connected for this company.");
  }

  const portalUrl = connection.credentials.portalUrl;
  const token = connection.credentials.token;
  if (typeof portalUrl !== "string" || typeof token !== "string") {
    throw new Error("Odoo credentials are incomplete.");
  }

  if (scope.lineLevel) {
    return loadLineLevelFinanceSnapshot(intent, portalUrl, token, scope);
  }

  const rows: ReportFinanceRow[] = [];

  if (scope.includeRevenue) {
    const revenueMoves = await searchAllMoves(
      portalUrl,
      token,
      ["out_invoice", "out_refund"],
      intent.period.startDate,
      intent.period.endDate,
    );
    rows.push(
      ...revenueMoves.map((move) => ({
        recordId: move.id,
        sourceType: "revenue" as const,
        moveType: move.move_type,
        name: move.name,
        partnerName: tupleLabel(move.partner_id),
        invoiceDate: move.invoice_date,
        currency: tupleLabel(move.currency_id),
        grossAmount: normalizeSignedAmount(move.move_type, toNumber(move.amount_total)),
        untaxedAmount: normalizeSignedAmount(move.move_type, toNumber(move.amount_untaxed)),
        taxAmount: normalizeSignedAmount(move.move_type, toNumber(move.amount_tax)),
        paymentState: typeof move.payment_state === "string" ? move.payment_state : null,
        reference: typeof move.ref === "string" ? move.ref : null,
      })),
    );
  }

  if (scope.includeExpenses) {
    const expenseMoves = await searchAllMoves(
      portalUrl,
      token,
      ["in_invoice", "in_refund"],
      intent.period.startDate,
      intent.period.endDate,
    );
    rows.push(
      ...expenseMoves.map((move) => ({
        recordId: move.id,
        sourceType: "expense" as const,
        moveType: move.move_type,
        name: move.name,
        partnerName: tupleLabel(move.partner_id),
        invoiceDate: move.invoice_date,
        currency: tupleLabel(move.currency_id),
        grossAmount: normalizeSignedAmount(move.move_type, toNumber(move.amount_total)),
        untaxedAmount: normalizeSignedAmount(move.move_type, toNumber(move.amount_untaxed)),
        taxAmount: normalizeSignedAmount(move.move_type, toNumber(move.amount_tax)),
        paymentState: typeof move.payment_state === "string" ? move.payment_state : null,
        reference: typeof move.ref === "string" ? move.ref : null,
      })),
    );
  }

  const revenueRows = rows.filter((row) => row.sourceType === "revenue");
  const expenseRows = rows.filter((row) => row.sourceType === "expense");
  const currency = rows.length > 0 ? rows[0].currency : null;

  return {
    rows,
    breakdowns: [],
    totals: {
      revenueTotal: revenueRows.reduce((sum, row) => sum + row.grossAmount, 0),
      expenseTotal: expenseRows.reduce((sum, row) => sum + row.grossAmount, 0),
      netTotal:
        revenueRows.reduce((sum, row) => sum + row.grossAmount, 0) -
        expenseRows.reduce((sum, row) => sum + row.grossAmount, 0),
      currency,
      revenueCount: revenueRows.length,
      expenseCount: expenseRows.length,
    },
  };
}
