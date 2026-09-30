import * as XLSX from "xlsx";

import type { ParseResult } from "./format-router";

export interface BankBalanceAccount {
  date: string;
  makerBy: string | null;
  companyName: string;
  bankName: string;
  bankAccount: string;
  purpose: string | null;
  currency: string;
  balance: number;
  fxRate: number;
  balanceIdr: number;
  sourceSheet: string;
  sourceRow: number;
}

export interface BankBalanceCompanySummary {
  companyName: string;
  accountCount: number;
  currencies: string[];
  totalIdr: number;
  accounts: BankBalanceAccount[];
}

export interface BankBalanceSnapshot {
  asOfDate: string;
  reportingCurrency: "IDR";
  totalIdr: number;
  companyCount: number;
  accountCount: number;
  sourceSheets: string[];
  dates: string[];
  companies: BankBalanceCompanySummary[];
  accounts: BankBalanceAccount[];
  warnings: string[];
}

const REQUIRED_COLUMNS = [
  "date",
  "company",
  "bankName",
  "bankAccount",
  "currency",
  "balance",
] as const;

type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];
type ColumnKey =
  | RequiredColumn
  | "makerBy"
  | "purpose"
  | "fxRate"
  | "balanceIdr";

type HeaderMap = Partial<Record<ColumnKey, number>>;

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  date: ["date"],
  makerBy: ["maker by", "maker"],
  company: ["company"],
  bankName: ["bank name", "bank"],
  bankAccount: ["bank account", "account"],
  purpose: ["purpose", "description"],
  currency: ["cur", "currency"],
  balance: ["balance"],
  fxRate: ["fx"],
  balanceIdr: ["fx balance", "fx-balance", "idr balance", "balance idr"],
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[_]+/g, " ");
}

function normalizeCurrency(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return normalized.length === 3 ? normalized : null;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function cellToText(cell: XLSX.CellObject | undefined): string | null {
  if (!cell) return null;
  if (cell.v === null || cell.v === undefined) return null;
  if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
    return Number.isInteger(cell.v) ? String(cell.v) : String(cell.v);
  }
  const text = String(cell.v).trim();
  return text.length > 0 ? text : null;
}

function cellToNumber(cell: XLSX.CellObject | undefined): number | null {
  if (!cell) return null;
  if (typeof cell.v === "number" && Number.isFinite(cell.v)) return cell.v;
  if (typeof cell.v !== "string") return null;
  const cleaned = cell.v
    .replace(/[,\s]/g, "")
    .replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function cellToDateKey(cell: XLSX.CellObject | undefined): string | null {
  if (!cell || cell.v === null || cell.v === undefined) return null;

  if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
    const parsed = XLSX.SSF.parse_date_code(cell.v);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  if (cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) {
    return cell.v.toISOString().slice(0, 10);
  }

  const text = String(cell.v).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function getCell(sheet: XLSX.WorkSheet, row: number, column: number): XLSX.CellObject | undefined {
  return sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
}

function findHeaderMap(sheet: XLSX.WorkSheet): { row: number; columns: HeaderMap } | null {
  const ref = sheet["!ref"];
  if (!ref) return null;

  const range = XLSX.utils.decode_range(ref);
  const maxHeaderRow = Math.min(range.e.r, range.s.r + 12);

  for (let row = range.s.r; row <= maxHeaderRow; row += 1) {
    const columns: HeaderMap = {};

    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const header = normalizeHeader(getCell(sheet, row, column)?.v);
      if (!header) continue;

      for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<[ColumnKey, string[]]>) {
        if (columns[key] !== undefined) continue;
        if (aliases.includes(header)) {
          columns[key] = column;
        }
      }
    }

    if (REQUIRED_COLUMNS.every((key) => columns[key] !== undefined)) {
      return { row, columns };
    }
  }

  return null;
}

function parseSheetAccounts(
  sheet: XLSX.WorkSheet,
  sheetName: string,
): BankBalanceAccount[] {
  const header = findHeaderMap(sheet);
  if (!header) return [];

  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const accounts: BankBalanceAccount[] = [];

  for (let row = header.row + 1; row <= range.e.r; row += 1) {
    const date = cellToDateKey(getCell(sheet, row, header.columns.date!));
    const companyName = cellToText(getCell(sheet, row, header.columns.company!));
    const bankName = cellToText(getCell(sheet, row, header.columns.bankName!));
    const bankAccount = cellToText(getCell(sheet, row, header.columns.bankAccount!));
    const currency = normalizeCurrency(getCell(sheet, row, header.columns.currency!)?.v);

    if (!date || !companyName || !bankName || !bankAccount || !currency) {
      continue;
    }

    const rawBalance = cellToNumber(getCell(sheet, row, header.columns.balance!));
    const fxRate =
      cellToNumber(header.columns.fxRate === undefined ? undefined : getCell(sheet, row, header.columns.fxRate)) ??
      (currency === "IDR" ? 1 : null);
    const rawBalanceIdr =
      cellToNumber(
        header.columns.balanceIdr === undefined
          ? undefined
          : getCell(sheet, row, header.columns.balanceIdr),
      ) ?? (fxRate === null || rawBalance === null ? null : rawBalance * fxRate);

    if (fxRate === null || rawBalanceIdr === null) {
      continue;
    }

    const balance = rawBalance ?? (rawBalanceIdr === 0 ? 0 : null);
    if (balance === null) {
      continue;
    }

    accounts.push({
      date,
      makerBy:
        header.columns.makerBy === undefined
          ? null
          : cellToText(getCell(sheet, row, header.columns.makerBy)),
      companyName,
      bankName,
      bankAccount,
      purpose:
        header.columns.purpose === undefined
          ? null
          : cellToText(getCell(sheet, row, header.columns.purpose)),
      currency,
      balance: roundMoney(balance),
      fxRate,
      balanceIdr: roundMoney(rawBalanceIdr),
      sourceSheet: sheetName,
      sourceRow: row + 1,
    });
  }

  return accounts;
}

function compareCompanySummaries(
  left: BankBalanceCompanySummary,
  right: BankBalanceCompanySummary,
): number {
  return Math.abs(right.totalIdr) - Math.abs(left.totalIdr);
}

export function extractBankBalanceSnapshot(buffer: Buffer): BankBalanceSnapshot | null {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellFormula: true,
    cellNF: true,
    cellDates: false,
  });

  const sourceSheets: string[] = [];
  const accounts = workbook.SheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    const sheetAccounts = parseSheetAccounts(sheet, sheetName);
    if (sheetAccounts.length > 0) sourceSheets.push(sheetName);
    return sheetAccounts;
  });

  if (accounts.length === 0) return null;

  const dates = Array.from(new Set(accounts.map((account) => account.date))).sort();
  const asOfDate = dates[dates.length - 1]!;
  const warnings: string[] = [];
  if (dates.length > 1) {
    warnings.push("multiple_snapshot_dates_detected");
  }

  const companyMap = new Map<string, BankBalanceCompanySummary>();
  for (const account of accounts) {
    const current = companyMap.get(account.companyName) ?? {
      companyName: account.companyName,
      accountCount: 0,
      currencies: [],
      totalIdr: 0,
      accounts: [],
    };
    current.accountCount += 1;
    current.totalIdr += account.balanceIdr;
    current.accounts.push(account);
    if (!current.currencies.includes(account.currency)) {
      current.currencies.push(account.currency);
    }
    companyMap.set(account.companyName, current);
  }

  const companies = Array.from(companyMap.values())
    .map((company) => ({
      ...company,
      totalIdr: roundMoney(company.totalIdr),
      accounts: company.accounts.sort((left, right) => Math.abs(right.balanceIdr) - Math.abs(left.balanceIdr)),
      currencies: company.currencies.sort(),
    }))
    .sort(compareCompanySummaries);

  return {
    asOfDate,
    reportingCurrency: "IDR",
    totalIdr: roundMoney(accounts.reduce((sum, account) => sum + account.balanceIdr, 0)),
    companyCount: companies.length,
    accountCount: accounts.length,
    sourceSheets,
    dates,
    companies,
    accounts,
    warnings,
  };
}

export function parseBankBalanceWorkbook(
  buffer: Buffer,
  fileName: string,
): ParseResult | null {
  const snapshot = extractBankBalanceSnapshot(buffer);
  if (!snapshot) return null;

  return {
    transactions: [],
    reports: [],
    confidence: 0.98,
    documentType: "bank_balance_snapshot",
    needsReview: false,
    bankBalanceSnapshot: snapshot,
    metadata: {
      format: "bank_balance_workbook",
      source_file_name: fileName,
      bank_balance: {
        as_of_date: snapshot.asOfDate,
        reporting_currency: snapshot.reportingCurrency,
        total_idr: snapshot.totalIdr,
        company_count: snapshot.companyCount,
        account_count: snapshot.accountCount,
        source_sheets: snapshot.sourceSheets,
        warnings: snapshot.warnings,
      },
    },
  };
}
