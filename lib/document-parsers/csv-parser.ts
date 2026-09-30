import * as XLSX from "xlsx";
import type { ParseResult, ParsedTransaction } from "./format-router";

// ---------------------------------------------------------------------------
// Known bank CSV format detection
// ---------------------------------------------------------------------------

export type CsvFormat = "mercury" | "wise" | "generic";

/**
 * Detect CSV format based on column headers.
 *
 * Mercury CSVs have columns like: "Status", "Bank Description", "Date", "Amount", "Currency"
 * Wise CSVs have columns like: "TransferWise ID", "Date", "Amount", "Currency", "Description"
 */
export function detectCsvFormat(headers: string[]): CsvFormat {
  const headerSet = new Set(headers.map((h) => h.trim().toLowerCase()));

  // Mercury: always has "status" + "bank description" columns
  if (
    (headerSet.has("status") && headerSet.has("bank description")) ||
    (headerSet.has("status") && headerSet.has("note"))
  ) {
    return "mercury";
  }

  // Wise (formerly TransferWise): has "transferwise id" or "transfer id"
  if (
    headerSet.has("transferwise id") ||
    headerSet.has("transfer id") ||
    (headerSet.has("target amount (after fees)") && headerSet.has("source amount (after fees)"))
  ) {
    return "wise";
  }

  return "generic";
}

// ---------------------------------------------------------------------------
// Column pattern matching
// ---------------------------------------------------------------------------

const DATE_PATTERNS = [
  /^date$/i,
  /^transaction[\s_-]?date$/i,
  /^posted[\s_-]?date$/i,
  /^value[\s_-]?date$/i,
  /^booking[\s_-]?date$/i,
  /^trade[\s_-]?date$/i,
  /^settlement[\s_-]?date$/i,
];

const AMOUNT_PATTERNS = [
  /^amount$/i,
  /^value$/i,
  /^total$/i,
  /^sum$/i,
  /^net[\s_-]?amount$/i,
];

const DEBIT_PATTERNS = [
  /^debit$/i,
  /^withdrawal$/i,
  /^debit[\s_-]?amount$/i,
  /^money[\s_-]?out$/i,
  /^outflow$/i,
];

const CREDIT_PATTERNS = [
  /^credit$/i,
  /^deposit$/i,
  /^credit[\s_-]?amount$/i,
  /^money[\s_-]?in$/i,
  /^inflow$/i,
];

const DESCRIPTION_PATTERNS = [
  /^description$/i,
  /^memo$/i,
  /^narrative$/i,
  /^details$/i,
  /^reference$/i,
  /^particulars$/i,
  /^remarks$/i,
  /^transaction[\s_-]?description$/i,
];

const MERCHANT_PATTERNS = [
  /^merchant$/i,
  /^payee$/i,
  /^vendor$/i,
  /^name$/i,
  /^merchant[\s_-]?name$/i,
  /^beneficiary$/i,
];

const CURRENCY_PATTERNS = [
  /^currency$/i,
  /^currency[\s_-]?code$/i,
  /^ccy$/i,
];

function matchHeader(header: string, patterns: RegExp[]): boolean {
  const trimmed = header.trim();
  return patterns.some((p) => p.test(trimmed));
}

function parseAmount(raw: string | undefined | null): number | null {
  if (raw == null || raw === "") return null;

  const rawText = String(raw).trim();
  let str = rawText;

  // Handle parentheses as negative: (100.00) → -100.00
  const isParenNegative = /^\(.*\)$/.test(str);
  if (isParenNegative) {
    str = str.replace(/[()]/g, "");
  }

  str = str.replace(/[^0-9,.\-+eE]/g, "");

  // Normalize separators before stripping currency symbols.
  // Keep the last separator as the decimal marker when both comma and dot are present.
  if (str.includes(",") && str.includes(".")) {
    if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
      // European-style: 1.234,56 -> 1234.56
      str = str.replace(/\./g, "").replace(/,/g, ".");
    } else {
      // US-style: 1,234.56 -> 1234.56
      str = str.replace(/,/g, "");
    }
  } else if (str.includes(",")) {
    const groupedThousands = /^[-+]?\d{1,3}(?:,\d{3})+$/.test(str);
    const decimalComma = /^[-+]?\d+,\d{1,2}$/.test(str);
    if (groupedThousands) {
      str = str.replace(/,/g, "");
    } else if (decimalComma) {
      str = str.replace(/,/g, ".");
    } else {
      str = str.replace(/,/g, "");
    }
  } else if (str.includes(".")) {
    const groupedThousands = /^[-+]?\d{1,3}(?:\.\d{3})+$/.test(str);
    if (groupedThousands) {
      str = str.replace(/\./g, "");
    }
  }

  const num = parseFloat(str);
  if (isNaN(num)) return null;

  return isParenNegative ? -Math.abs(num) : num;
}

function parseDate(raw: string | undefined | null): Date | null {
  if (raw == null || raw === "") return null;

  const str = String(raw).trim();

  // Try YYYY-MM-DD explicitly (ISO date-only) — construct as UTC
  const isoMatch = str.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const d = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
    if (!isNaN(d.getTime())) return d;
  }

  // Try slash/dot/hyphen dates only when they are unambiguous.
  const slashMatch = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (slashMatch) {
    const [, part1, part2, yearStr] = slashMatch;
    const first = parseInt(part1);
    const second = parseInt(part2);
    let year = parseInt(yearStr);
    if (year < 100) year += 2000;

    if (first > 12 && second <= 12) {
      // DD/MM/YYYY
      const d = new Date(Date.UTC(year, second - 1, first));
      if (!isNaN(d.getTime())) return d;
      return null;
    }

    if (second > 12 && first <= 12) {
      // MM/DD/YYYY
      const d = new Date(Date.UTC(year, first - 1, second));
      if (!isNaN(d.getTime())) return d;
      return null;
    }

    // If both parts are <= 12, the date is ambiguous. Skip it rather than guessing.
    return null;
  }

  // Fallback to Date.parse for natural language dates like "March 5 2024"
  const ms = Date.parse(str);
  if (!isNaN(ms)) {
    // Normalize to UTC midnight to avoid timezone drift
    const local = new Date(ms);
    return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
  }

  return null;
}

interface ColumnMapping {
  dateCol: string | null;
  amountCol: string | null;
  debitCol: string | null;
  creditCol: string | null;
  descriptionCol: string | null;
  merchantCol: string | null;
  currencyCol: string | null;
}

function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    dateCol: null,
    amountCol: null,
    debitCol: null,
    creditCol: null,
    descriptionCol: null,
    merchantCol: null,
    currencyCol: null,
  };

  for (const h of headers) {
    if (!mapping.dateCol && matchHeader(h, DATE_PATTERNS)) {
      mapping.dateCol = h;
    } else if (!mapping.amountCol && matchHeader(h, AMOUNT_PATTERNS)) {
      mapping.amountCol = h;
    } else if (!mapping.debitCol && matchHeader(h, DEBIT_PATTERNS)) {
      mapping.debitCol = h;
    } else if (!mapping.creditCol && matchHeader(h, CREDIT_PATTERNS)) {
      mapping.creditCol = h;
    } else if (
      !mapping.descriptionCol &&
      matchHeader(h, DESCRIPTION_PATTERNS)
    ) {
      mapping.descriptionCol = h;
    } else if (!mapping.merchantCol && matchHeader(h, MERCHANT_PATTERNS)) {
      mapping.merchantCol = h;
    } else if (!mapping.currencyCol && matchHeader(h, CURRENCY_PATTERNS)) {
      mapping.currencyCol = h;
    }
  }

  return mapping;
}

function computeConfidence(mapping: ColumnMapping): number {
  const hasDate = mapping.dateCol !== null;
  const hasAmount =
    mapping.amountCol !== null ||
    (mapping.debitCol !== null && mapping.creditCol !== null);
  const hasDescription = mapping.descriptionCol !== null;
  const hasMerchant = mapping.merchantCol !== null;

  if (!hasDate || !hasAmount) return 0.3;
  if (hasDate && hasAmount && hasDescription && hasMerchant) return 0.9;
  if (hasDate && hasAmount && (hasDescription || hasMerchant)) return 0.8;
  return 0.6;
}

// ---------------------------------------------------------------------------
// Mercury-specific CSV parser
// ---------------------------------------------------------------------------

/**
 * Mercury bank export columns:
 * Date, Description (or Bank Description), Amount, Status, Note, Currency, etc.
 * Status values: "Sent", "Completed", "Pending", "Failed"
 */
function parseMercuryRows(
  rows: Record<string, string>[],
  headers: string[],
): { transactions: ParsedTransaction[]; skippedStatuses: string[] } {
  const transactions: ParsedTransaction[] = [];
  const skippedStatuses: string[] = [];

  // Find Mercury-specific columns (case-insensitive lookup)
  const hMap = buildHeaderMap(headers);
  const dateCol = hMap["date"];
  const amountCol = hMap["amount"];
  const statusCol = hMap["status"];
  const descCol = hMap["bank description"] || hMap["description"] || hMap["note"];
  const noteCol = hMap["note"];
  const currencyCol = hMap["currency"];

  if (!dateCol || !amountCol) {
    return { transactions: [], skippedStatuses: [] };
  }

  for (const row of rows) {
    // Skip failed/cancelled transactions
    const status = statusCol ? (row[statusCol] ?? "").toLowerCase() : "";
    if (status === "failed" || status === "cancelled") {
      skippedStatuses.push(status);
      continue;
    }

    const date = parseDate(row[dateCol]);
    if (!date) continue;

    const amount = parseAmount(row[amountCol]);
    if (amount === null) continue;

    const currency = currencyCol && row[currencyCol]
      ? row[currencyCol].toUpperCase()
      : null;
    const description = descCol ? (row[descCol] ?? null) : null;
    // If the description column is "Bank Description", also check "Note" for merchant-like info
    const merchantName = noteCol && noteCol !== descCol ? (row[noteCol] ?? null) : null;

    transactions.push({
      date,
      amount,
      currency,
      description,
      merchantName,
      sourceRef: null,
    });
  }

  return { transactions, skippedStatuses };
}

// ---------------------------------------------------------------------------
// Wise-specific CSV parser
// ---------------------------------------------------------------------------

/**
 * Wise (TransferWise) export columns:
 * TransferWise ID, Date, Amount, Currency, Description,
 * Payment Reference, Running Balance, Exchange Rate,
 * Payer Name, Payee Name, etc.
 */
function parseWiseRows(
  rows: Record<string, string>[],
  headers: string[],
): { transactions: ParsedTransaction[] } {
  const transactions: ParsedTransaction[] = [];

  const hMap = buildHeaderMap(headers);
  const dateCol = hMap["date"];
  const amountCol = hMap["amount"];
  const currencyCol = hMap["currency"];
  const descCol = hMap["description"];
  const idCol = hMap["transferwise id"] || hMap["transfer id"];
  const payeeCol = hMap["payee name"] || hMap["merchant"];
  const payerCol = hMap["payer name"];
  const refCol = hMap["payment reference"];

  if (!dateCol || !amountCol) {
    return { transactions: [] };
  }

  for (const row of rows) {
    const date = parseDate(row[dateCol]);
    if (!date) continue;

    const amount = parseAmount(row[amountCol]);
    if (amount === null) continue;

    const currency = currencyCol && row[currencyCol]
      ? row[currencyCol].toUpperCase()
      : null;
    const description = descCol ? (row[descCol] ?? null) : null;
    // For Wise, the counterparty is payee (if negative) or payer (if positive)
    const merchantName = amount < 0
      ? (payeeCol ? (row[payeeCol] ?? null) : null)
      : (payerCol ? (row[payerCol] ?? null) : null);
    const sourceRef = idCol
      ? (row[idCol] ?? null)
      : refCol
        ? (row[refCol] ?? null)
        : null;

    transactions.push({
      date,
      amount,
      currency,
      description,
      merchantName,
      sourceRef,
    });
  }

  return { transactions };
}

// ---------------------------------------------------------------------------
// Header normalization helper
// ---------------------------------------------------------------------------

function buildHeaderMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    map[h.trim().toLowerCase()] = h;
  }
  return map;
}

function parseCsvTextRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = (): void => {
    row.push(cell);
    cell = "";
  };

  const pushRow = (): void => {
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === "\"") {
        if (next === "\"") {
          cell += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      pushCell();
      continue;
    }

    if (char === "\n") {
      pushCell();
      pushRow();
      continue;
    }

    if (char === "\r") {
      if (next === "\n") {
        index += 1;
      }
      pushCell();
      pushRow();
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    pushCell();
    pushRow();
  }

  return rows.filter((parsedRow) => parsedRow.some((value) => value.trim() !== ""));
}

// ---------------------------------------------------------------------------
// Main CSV parser entry point
// ---------------------------------------------------------------------------

export async function parseCsv(
  buffer: Buffer,
  fileName: string,
): Promise<ParseResult> {
  const isExcelWorkbook = /\.(xlsx|xlsm|xlsb|xls)$/i.test(fileName);
  const sheetName = isExcelWorkbook ? (() => {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    return workbook.SheetNames[0] ?? null;
  })() : "CSV";

  if (!sheetName) {
    return { transactions: [], confidence: 0.3 };
  }

  let rows: Record<string, string>[];

  if (isExcelWorkbook) {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
      raw: false,
      defval: "",
      dateNF: "yyyy-mm-dd",
    });
  } else {
    const parsedRows = parseCsvTextRows(buffer.toString("utf8"));
    if (parsedRows.length === 0) {
      return {
        transactions: [],
        confidence: 0.3,
        metadata: { fileName, sheetName, rowCount: 0, format: "generic" as CsvFormat },
      };
    }

    const headers = parsedRows[0];
    rows = parsedRows.slice(1).map((cells) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] ?? "";
      });
      return record;
    });
  }

  if (rows.length === 0) {
    return {
      transactions: [],
      confidence: 0.3,
      metadata: { fileName, sheetName, rowCount: 0, format: "generic" as CsvFormat },
    };
  }

  const headers = Object.keys(rows[0]);
  const format = detectCsvFormat(headers);

  // --- Mercury format ---
  if (format === "mercury") {
    const { transactions, skippedStatuses } = parseMercuryRows(rows, headers);
    return {
      transactions,
      confidence: transactions.length > 0 ? 0.95 : 0.5,
      metadata: {
        fileName,
        sheetName,
        format,
        rowCount: rows.length,
        parsedCount: transactions.length,
        skippedCount: skippedStatuses.length,
      },
    };
  }

  // --- Wise format ---
  if (format === "wise") {
    const { transactions } = parseWiseRows(rows, headers);
    return {
      transactions,
      confidence: transactions.length > 0 ? 0.95 : 0.5,
      metadata: {
        fileName,
        sheetName,
        format,
        rowCount: rows.length,
        parsedCount: transactions.length,
      },
    };
  }

  // --- Generic format (auto-detect columns) ---
  const mapping = detectColumns(headers);
  const confidence = computeConfidence(mapping);

  // If we can't even find date + amount, return empty with low confidence
  const hasDate = mapping.dateCol !== null;
  const hasAmount =
    mapping.amountCol !== null ||
    (mapping.debitCol !== null && mapping.creditCol !== null);

  if (!hasDate || !hasAmount) {
    return {
      transactions: [],
      confidence: 0.3,
      metadata: { fileName, sheetName, format, rowCount: rows.length, detectedColumns: mapping },
    };
  }

  const transactions: ParsedTransaction[] = [];

  for (const row of rows) {
    const date = parseDate(row[mapping.dateCol!]);
    if (!date) continue;

    let amount: number | null = null;

    if (mapping.amountCol) {
      amount = parseAmount(row[mapping.amountCol]);
    } else if (mapping.debitCol !== null || mapping.creditCol !== null) {
      const debit = parseAmount(
        mapping.debitCol ? row[mapping.debitCol] : undefined,
      );
      const credit = parseAmount(
        mapping.creditCol ? row[mapping.creditCol] : undefined,
      );
      // credit is positive, debit is negative
      amount = (credit ?? 0) - (debit ?? 0);
    }

    if (amount === null) continue;

    // Read per-row currency if available; null when the column is missing or
    // the cell is empty — let the consumer resolve via company.reportingCurrency.
    const currency = mapping.currencyCol && row[mapping.currencyCol]
      ? row[mapping.currencyCol].toUpperCase()
      : null;

    const description = mapping.descriptionCol
      ? (row[mapping.descriptionCol] ?? null)
      : null;
    const merchantName = mapping.merchantCol
      ? (row[mapping.merchantCol] ?? null)
      : null;

    transactions.push({
      date,
      amount,
      currency,
      description,
      merchantName,
      sourceRef: null,
    });
  }

  return {
    transactions,
    confidence,
    metadata: {
      fileName,
      sheetName,
      format,
      rowCount: rows.length,
      parsedCount: transactions.length,
      detectedColumns: mapping,
    },
  };
}
