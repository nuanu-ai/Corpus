import * as Ofx from "ofx-js";
import type { ParseResult, ParsedTransaction } from "./format-router";

/**
 * Parse OFX date format: YYYYMMDD or YYYYMMDDHHMMSS[.XXX]
 */
function parseOfxDate(raw: string): Date | null {
  if (!raw) return null;

  const str = String(raw).trim();

  // YYYYMMDDHHMMSS.XXX or YYYYMMDDHHMMSS or YYYYMMDD
  const match = str.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const d = new Date(Date.UTC(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour ?? "0"),
    parseInt(minute ?? "0"),
    parseInt(second ?? "0"),
  ));

  return isNaN(d.getTime()) ? null : d;
}

/**
 * Safely navigate a nested object by path segments.
 */
function getNestedValue(
  obj: Record<string, unknown>,
  ...keys: string[]
): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export async function parseOfx(buffer: Buffer): Promise<ParseResult> {
  const data = await Ofx.parse(buffer.toString());

  // Try bank statement path: OFX.BANKMSGSRSV1.STMTTRNRS.STMTRS
  let stmtrs = getNestedValue(
    data,
    "OFX",
    "BANKMSGSRSV1",
    "STMTTRNRS",
    "STMTRS",
  ) as Record<string, unknown> | undefined;

  // Also try credit card path: OFX.CREDITCARDMSGSRSV1.CCSTMTTRNRS.CCSTMTRS
  if (!stmtrs) {
    stmtrs = getNestedValue(
      data,
      "OFX",
      "CREDITCARDMSGSRSV1",
      "CCSTMTTRNRS",
      "CCSTMTRS",
    ) as Record<string, unknown> | undefined;
  }

  if (!stmtrs) {
    return {
      transactions: [],
      confidence: 0.5,
      metadata: { error: "Could not find statement data in OFX file" },
    };
  }

  // Get currency. Null when CURDEF is absent — consumer applies company.reportingCurrency.
  const currency =
    typeof stmtrs.CURDEF === "string" && stmtrs.CURDEF.trim()
      ? stmtrs.CURDEF.trim().toUpperCase()
      : null;

  // Get transaction list
  const tranList = stmtrs.BANKTRANLIST as Record<string, unknown> | undefined;
  if (!tranList) {
    return {
      transactions: [],
      confidence: 0.5,
      metadata: { error: "No transaction list found in OFX statement" },
    };
  }

  let rawTxns = tranList.STMTTRN;
  if (!rawTxns) {
    return {
      transactions: [],
      confidence: 0.95,
      metadata: { currency, transactionCount: 0 },
    };
  }

  // Ensure rawTxns is an array (single transaction comes as object)
  if (!Array.isArray(rawTxns)) {
    rawTxns = [rawTxns];
  }

  const transactions: ParsedTransaction[] = [];

  for (const txn of rawTxns as Record<string, unknown>[]) {
    const dateStr = String(txn.DTPOSTED ?? "");
    const date = parseOfxDate(dateStr);
    if (!date) continue;

    const amountStr = String(txn.TRNAMT ?? "0");
    const amount = parseFloat(amountStr);
    if (isNaN(amount)) continue;

    const name = txn.NAME ? String(txn.NAME) : null;
    const memo = txn.MEMO ? String(txn.MEMO) : null;
    const fitid = txn.FITID ? String(txn.FITID) : null;

    transactions.push({
      date,
      amount,
      currency,
      description: name ?? memo,
      merchantName: name,
      sourceRef: fitid,
    });
  }

  return {
    transactions,
    confidence: 0.95,
    metadata: { currency, transactionCount: transactions.length },
  };
}
