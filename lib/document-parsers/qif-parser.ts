import type { ParseResult, ParsedTransaction } from "./format-router";

/**
 * Parse a QIF date string into a Date.
 * Supports formats: MM/DD/YYYY, MM-DD-YYYY, MM/DD'YY, DD/MM/YYYY (with heuristics).
 */
function parseQifDate(raw: string): Date | null {
  if (!raw) return null;
  const str = raw.trim();

  // MM/DD/YYYY or MM-DD-YYYY
  const slashMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    const date = new Date(Date.UTC(year, parseInt(m) - 1, parseInt(d)));
    return isNaN(date.getTime()) ? null : date;
  }

  // MM/DD'YY (Quicken shorthand)
  const quoteMatch = str.match(/^(\d{1,2})[/-](\d{1,2})'(\d{2})$/);
  if (quoteMatch) {
    const [, m, d, y] = quoteMatch;
    const year = 2000 + parseInt(y);
    const date = new Date(Date.UTC(year, parseInt(m) - 1, parseInt(d)));
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}

/**
 * Parse a QIF file buffer into transactions.
 *
 * QIF format reference:
 *   ^       = end of record
 *   !Type:  = account type header (Bank, CCard, Cash, etc.)
 *   D       = Date
 *   T       = Amount (total)
 *   P       = Payee
 *   M       = Memo
 *   N       = Check number
 *   L       = Category
 *   C       = Cleared status
 */
export function parseQif(buffer: Buffer): ParseResult {
  const content = buffer.toString("utf-8");
  const lines = content.split(/\r?\n/);

  const transactions: ParsedTransaction[] = [];

  let currentDate: Date | null = null;
  let currentAmount: number | null = null;
  let currentPayee: string | null = null;
  let currentMemo: string | null = null;
  let currentNumber: string | null = null;
  let hasRecords = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip headers like !Type:Bank
    if (trimmed.startsWith("!")) continue;

    const code = trimmed[0];
    const value = trimmed.slice(1).trim();

    switch (code) {
      case "D":
        currentDate = parseQifDate(value);
        break;
      case "T":
      case "U": // U is alternate amount field
        currentAmount = parseFloat(value.replace(/,/g, ""));
        break;
      case "P":
        currentPayee = value || null;
        break;
      case "M":
        currentMemo = value || null;
        break;
      case "N":
        currentNumber = value || null;
        break;
      case "^":
        // End of record — flush
        if (currentDate && currentAmount != null && !isNaN(currentAmount)) {
          hasRecords = true;
          transactions.push({
            date: currentDate,
            amount: currentAmount,
            currency: null, // QIF doesn't carry currency; consumer applies company.reportingCurrency
            description: currentPayee ?? currentMemo,
            merchantName: currentPayee,
            sourceRef: currentNumber,
          });
        }
        // Reset
        currentDate = null;
        currentAmount = null;
        currentPayee = null;
        currentMemo = null;
        currentNumber = null;
        break;
      // Ignore other codes (C, L, A, etc.)
    }
  }

  return {
    transactions,
    confidence: hasRecords ? 0.9 : 0.5,
    metadata: { transactionCount: transactions.length },
  };
}
