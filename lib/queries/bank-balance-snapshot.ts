import type { EntityResult } from "@/lib/company-db/client";

export interface BankBalanceAccountView {
  date: string;
  makerBy: string | null;
  companyName: string;
  bankName: string;
  bankAccount: string;
  purpose: string | null;
  currency: string;
  balance: number;
  fxRate: number | null;
  balanceIdr: number;
  sourceSheet: string | null;
  sourceRow: number | null;
}

export interface BankBalanceCompanyView {
  companyName: string;
  accountCount: number;
  currencies: string[];
  totalIdr: number;
  accounts: BankBalanceAccountView[];
}

export interface BankBalanceSnapshotView {
  qualifiedId: string;
  companyDbPath: string;
  documentId: string | null;
  sourceDocumentName: string | null;
  asOfDate: string;
  reportingCurrency: "IDR";
  totalIdr: number;
  companyCount: number;
  accountCount: number;
  sourceSheets: string[];
  warnings: string[];
  companies: BankBalanceCompanyView[];
  accounts: BankBalanceAccountView[];
  updatedAt: string | null;
}

export interface BankBalanceSnapshotResponse {
  snapshot: BankBalanceSnapshotView | null;
  snapshotCount: number;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && value !== null) {
    const amount = (value as { amount?: unknown }).amount;
    if (amount !== undefined) return number(amount);
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item))
    .filter((item): item is string => Boolean(item));
}

function parseAccount(value: unknown): BankBalanceAccountView | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const companyName = text(raw.company_name) ?? text(raw.companyName);
  const bankName = text(raw.bank_name) ?? text(raw.bankName);
  const bankAccount = text(raw.bank_account) ?? text(raw.bankAccount);
  const currency = text(raw.currency)?.toUpperCase() ?? null;
  const balance = number(raw.balance);
  const balanceIdr = number(raw.balance_idr) ?? number(raw.balanceIdr);
  const date = text(raw.date);

  if (!date || !companyName || !bankName || !bankAccount || !currency || balance === null || balanceIdr === null) {
    return null;
  }

  return {
    date,
    makerBy: text(raw.maker_by) ?? text(raw.makerBy),
    companyName,
    bankName,
    bankAccount,
    purpose: text(raw.purpose),
    currency,
    balance,
    fxRate: number(raw.fx_rate) ?? number(raw.fxRate),
    balanceIdr,
    sourceSheet: text(raw.source_sheet) ?? text(raw.sourceSheet),
    sourceRow: number(raw.source_row) ?? number(raw.sourceRow),
  };
}

function parseCompany(value: unknown, accounts: BankBalanceAccountView[]): BankBalanceCompanyView | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const companyName = text(raw.company_name) ?? text(raw.companyName);
  const totalIdr = number(raw.total_idr) ?? number(raw.totalIdr);
  if (!companyName || totalIdr === null) return null;
  const companyAccounts = accounts.filter((account) => account.companyName === companyName);

  return {
    companyName,
    accountCount: Math.trunc(number(raw.account_count) ?? number(raw.accountCount) ?? companyAccounts.length),
    currencies: stringArray(raw.currencies),
    totalIdr,
    accounts: companyAccounts,
  };
}

function compareCompanies(left: BankBalanceCompanyView, right: BankBalanceCompanyView): number {
  return Math.abs(right.totalIdr) - Math.abs(left.totalIdr);
}

export function bankBalanceSnapshotFromEntity(
  entity: EntityResult,
): BankBalanceSnapshotView | null {
  const frontmatter = entity.frontmatter ?? {};
  const asOfDate = text(frontmatter.as_of_date) ?? text(frontmatter.asOfDate);
  if (!asOfDate) return null;

  const accounts = (Array.isArray(frontmatter.accounts) ? frontmatter.accounts : [])
    .map(parseAccount)
    .filter((account): account is BankBalanceAccountView => account !== null)
    .sort((left, right) => Math.abs(right.balanceIdr) - Math.abs(left.balanceIdr));
  if (accounts.length === 0) return null;

  const companies = (Array.isArray(frontmatter.company_totals) ? frontmatter.company_totals : [])
    .map((company) => parseCompany(company, accounts))
    .filter((company): company is BankBalanceCompanyView => company !== null)
    .sort(compareCompanies);
  const normalizedCompanies =
    companies.length > 0
      ? companies
      : Array.from(new Set(accounts.map((account) => account.companyName)))
          .map((companyName) => {
            const companyAccounts = accounts.filter((account) => account.companyName === companyName);
            return {
              companyName,
              accountCount: companyAccounts.length,
              currencies: Array.from(new Set(companyAccounts.map((account) => account.currency))).sort(),
              totalIdr: companyAccounts.reduce((sum, account) => sum + account.balanceIdr, 0),
              accounts: companyAccounts,
            } satisfies BankBalanceCompanyView;
          })
          .sort(compareCompanies);
  const totalIdr =
    number(frontmatter.total_balance_idr) ??
    number(frontmatter.total_balance) ??
    accounts.reduce((sum, account) => sum + account.balanceIdr, 0);

  return {
    qualifiedId: entity.qualifiedId,
    companyDbPath: entity.filePath,
    documentId: text(frontmatter.document_id) ?? text(frontmatter.documentId),
    sourceDocumentName: text(frontmatter.source_document_name) ?? text(frontmatter.sourceDocumentName),
    asOfDate,
    reportingCurrency: "IDR",
    totalIdr,
    companyCount: Math.trunc(number(frontmatter.company_count) ?? normalizedCompanies.length),
    accountCount: Math.trunc(number(frontmatter.account_count) ?? accounts.length),
    sourceSheets: stringArray(frontmatter.source_sheets ?? frontmatter.sourceSheets),
    warnings: stringArray(frontmatter.warnings),
    companies: normalizedCompanies,
    accounts,
    updatedAt: entity.updatedAt,
  };
}

export function selectLatestBankBalanceSnapshot(
  entities: EntityResult[],
): BankBalanceSnapshotResponse {
  const snapshots = entities
    .map(bankBalanceSnapshotFromEntity)
    .filter((snapshot): snapshot is BankBalanceSnapshotView => snapshot !== null)
    .sort((left, right) => {
      const dateDelta = right.asOfDate.localeCompare(left.asOfDate);
      if (dateDelta !== 0) return dateDelta;
      return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
    });

  return {
    snapshot: snapshots[0] ?? null,
    snapshotCount: snapshots.length,
  };
}
