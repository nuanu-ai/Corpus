import type {
  BankTransaction,
  FxRate,
} from "../../schema/domain-types/banking.js";
import type { JournalEntry } from "../../schema/domain-types/finance.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface ImportResult {
  imported: BankTransaction[];
  duplicates: BankTransaction[];
  errors: Array<{ transaction: BankTransaction; reason: string }>;
}

export interface ReconciliationMatch {
  bank_transaction: BankTransaction;
  journal_entry: JournalEntry;
  match_type: "exact_ref" | "amount_date" | "fuzzy";
  confidence: number;
}

export interface ReconciliationResult {
  matched: ReconciliationMatch[];
  unmatched_bank: BankTransaction[];
  unmatched_journal: JournalEntry[];
}

export interface RevaluationEntry {
  account_id: string;
  currency: string;
  original_amount: number;
  original_rate: number;
  closing_rate: number;
  functional_original: number;
  functional_closing: number;
  unrealized_gain_loss: number;
}

export interface RevaluationResult {
  period: string;
  entries: RevaluationEntry[];
  total_unrealized_gain_loss: number;
}

export interface ForeignCurrencyAccount {
  account_id: string;
  currency: string;
  balance: number;
  original_rate: number;
}

// ── Normalization ────────────────────────────────────────────────────────

/**
 * Normalize a transaction description for dedup comparison.
 *
 * - Lowercases
 * - Trims whitespace
 * - Collapses multiple spaces into one
 * - Removes common noise: "POS", "DEBIT", "CREDIT", "PURCHASE", date suffixes
 */
export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(
      /\b(pos|debit|credit|purchase|payment|withdrawal|deposit)\b/gi,
      "",
    )
    .replace(/\d{2}\/\d{2}\/?\d{0,4}/g, "") // strip date patterns like 01/15/2024
    .replace(/\s+/g, " ")
    .trim();
}

// ── Dedup ────────────────────────────────────────────────────────────────

/**
 * Two-tier deduplication for a single bank transaction.
 *
 * **Tier 1 (primary):** Exact `bank_reference` match.
 * **Tier 2 (secondary):** Normalized description + amount + date within 1 day.
 *
 * Returns the first matched existing transaction, or `null` if no duplicate.
 */
export function deduplicateTransaction(
  txn: BankTransaction,
  existing: BankTransaction[],
): BankTransaction | null {
  // Tier 1: bank_reference exact match
  if (txn.bank_reference) {
    const refMatch = existing.find(
      (e) => e.bank_reference !== undefined && e.bank_reference === txn.bank_reference,
    );
    if (refMatch) return refMatch;
  }

  // Tier 2: normalized_description + amount + date within 1 day
  const txnNorm =
    txn.normalized_description ?? normalizeDescription(txn.description);
  const txnDate = new Date(txn.date).getTime();

  for (const e of existing) {
    const eNorm =
      e.normalized_description ?? normalizeDescription(e.description);

    if (eNorm !== txnNorm) continue;
    if (e.amount !== txn.amount) continue;

    const eDate = new Date(e.date).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    if (Math.abs(txnDate - eDate) <= dayMs) {
      return e;
    }
  }

  return null;
}

// ── Validation ───────────────────────────────────────────────────────────

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a bank transaction for required fields and format.
 */
export function validateTransaction(
  txn: BankTransaction,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!txn.id) {
    errors.push("Missing transaction id");
  }
  if (!txn.account_id) {
    errors.push("Missing account_id");
  }
  if (!txn.date || !ISO_DATE_REGEX.test(txn.date)) {
    errors.push(`Invalid date format: "${txn.date}" -- expected YYYY-MM-DD`);
  }
  if (!txn.description || txn.description.trim().length === 0) {
    errors.push("Missing or empty description");
  }
  if (typeof txn.amount !== "number" || isNaN(txn.amount)) {
    errors.push("Amount must be a number");
  }
  if (!txn.currency) {
    errors.push("Missing currency");
  }

  return { valid: errors.length === 0, errors };
}

// ── Import ───────────────────────────────────────────────────────────────

/**
 * Import bank transactions with validation and deduplication.
 *
 * - Validates each transaction
 * - Deduplicates against `existingTransactions`
 * - Returns imported (new), duplicates, and errors
 */
export function importTransactions(
  transactions: BankTransaction[],
  existingTransactions: BankTransaction[] = [],
): ImportResult {
  const imported: BankTransaction[] = [];
  const duplicates: BankTransaction[] = [];
  const errors: Array<{ transaction: BankTransaction; reason: string }> = [];

  // Build growing pool of existing + newly imported for intra-batch dedup
  const pool = [...existingTransactions];

  for (const txn of transactions) {
    // Validate
    const validation = validateTransaction(txn);
    if (!validation.valid) {
      errors.push({
        transaction: txn,
        reason: validation.errors.join("; "),
      });
      continue;
    }

    // Enrich: compute normalized_description if missing
    const enriched: BankTransaction = {
      ...txn,
      normalized_description:
        txn.normalized_description ?? normalizeDescription(txn.description),
    };

    // Dedup against pool
    const dup = deduplicateTransaction(enriched, pool);
    if (dup) {
      duplicates.push(enriched);
      continue;
    }

    imported.push(enriched);
    pool.push(enriched);
  }

  return { imported, duplicates, errors };
}

// ── FX Rates ─────────────────────────────────────────────────────────────

/**
 * Store (create) an FX rate record. Pure factory -- no I/O.
 */
export function storeFxRate(
  date: string,
  baseCurrency: string,
  rates: Record<string, number>,
  source?: string,
): FxRate {
  return {
    type: "fx_rate",
    id: `fx-${date}-${baseCurrency}`,
    date,
    base_currency: baseCurrency,
    rates,
    source,
    created_at: new Date().toISOString(),
  };
}

/**
 * Convert an amount between currencies using a rate table.
 *
 * Supports direct conversion and triangulation through the base currency.
 *
 * @param amount  The amount to convert
 * @param from    Source currency code
 * @param to      Target currency code
 * @param fxRate  An FxRate record (base_currency + rates map)
 * @returns The converted amount
 * @throws If no conversion path exists
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  fxRate: FxRate,
): number {
  if (from === to) return amount;

  const { base_currency, rates } = fxRate;

  // Direct: from == base, to is in rates
  if (from === base_currency && rates[to] !== undefined) {
    return amount * rates[to];
  }

  // Direct: to == base, from is in rates
  if (to === base_currency && rates[from] !== undefined) {
    return amount / rates[from];
  }

  // Triangulation: both from and to are in rates (go through base)
  if (rates[from] !== undefined && rates[to] !== undefined) {
    // from -> base -> to
    const amountInBase = amount / rates[from];
    return amountInBase * rates[to];
  }

  throw new Error(
    `No conversion path from ${from} to ${to} via base ${base_currency}`,
  );
}

// ── Reconciliation ───────────────────────────────────────────────────────

/**
 * Compute total debit amount for a journal entry (sum of all debit lines).
 */
function jeDebitTotal(je: JournalEntry): number {
  let total = 0;
  for (const line of je.lines) {
    if (line.debit !== undefined && line.debit !== null) {
      total += line.debit;
    }
  }
  return total;
}

/**
 * Compute total credit amount for a journal entry (sum of all credit lines).
 */
function jeCreditTotal(je: JournalEntry): number {
  let total = 0;
  for (const line of je.lines) {
    if (line.credit !== undefined && line.credit !== null) {
      total += line.credit;
    }
  }
  return total;
}

/**
 * Reconcile bank transactions against journal entries.
 *
 * Matching tiers:
 * 1. **Exact ref:** `bank_transaction.journal_entry_ref === journal_entry.id`
 * 2. **Amount + date:** Absolute amount matches JE debit or credit total,
 *    same date. Confidence 0.8.
 *
 * Each bank transaction and journal entry is matched at most once.
 */
export function reconcileTransactions(
  bankTxns: BankTransaction[],
  journalEntries: JournalEntry[],
): ReconciliationResult {
  const matched: ReconciliationMatch[] = [];
  const matchedBankIds = new Set<string>();
  const matchedJEIds = new Set<string>();

  // Pass 1: Exact ref match
  for (const bt of bankTxns) {
    if (!bt.journal_entry_ref) continue;
    const je = journalEntries.find(
      (j) => j.id === bt.journal_entry_ref && !matchedJEIds.has(j.id),
    );
    if (je) {
      matched.push({
        bank_transaction: bt,
        journal_entry: je,
        match_type: "exact_ref",
        confidence: 1.0,
      });
      matchedBankIds.add(bt.id);
      matchedJEIds.add(je.id);
    }
  }

  // Pass 2: Amount + date match
  const TOLERANCE = 0.005;

  for (const bt of bankTxns) {
    if (matchedBankIds.has(bt.id)) continue;

    const absAmount = Math.abs(bt.amount);

    for (const je of journalEntries) {
      if (matchedJEIds.has(je.id)) continue;
      if (je.date !== bt.date) continue;

      const debitTotal = jeDebitTotal(je);
      const creditTotal = jeCreditTotal(je);

      if (
        Math.abs(absAmount - debitTotal) <= TOLERANCE ||
        Math.abs(absAmount - creditTotal) <= TOLERANCE
      ) {
        matched.push({
          bank_transaction: bt,
          journal_entry: je,
          match_type: "amount_date",
          confidence: 0.8,
        });
        matchedBankIds.add(bt.id);
        matchedJEIds.add(je.id);
        break;
      }
    }
  }

  const unmatched_bank = bankTxns.filter((bt) => !matchedBankIds.has(bt.id));
  const unmatched_journal = journalEntries.filter(
    (je) => !matchedJEIds.has(je.id),
  );

  return { matched, unmatched_bank, unmatched_journal };
}

// ── Revaluation ──────────────────────────────────────────────────────────

/**
 * Revalue foreign-currency-denominated accounts at period close.
 *
 * For each account whose currency differs from the functional currency
 * (the base_currency of the FxRate), compute the unrealized gain/loss:
 *
 *   unrealized = (balance / closingRate) - (balance / originalRate)
 *   ... or equivalently:
 *   functional_original = balance * originalRate
 *   functional_closing  = balance * closingRate
 *   unrealized = functional_closing - functional_original
 *
 * Convention: rates in the FxRate record express how many units of
 * the quote currency equal 1 unit of the base currency. So to convert
 * foreign -> base we divide: `foreignAmount / rate`.
 *
 * But the `original_rate` on the account is stored the same way:
 * "1 base = X foreign". So `functional_original = balance / original_rate`.
 */
export function revalueAtPeriodClose(
  accounts: ForeignCurrencyAccount[],
  fxRate: FxRate,
  period: string,
): RevaluationResult {
  const entries: RevaluationEntry[] = [];

  for (const acct of accounts) {
    // Skip accounts already in the functional (base) currency
    if (acct.currency === fxRate.base_currency) continue;

    const closingRate = fxRate.rates[acct.currency];
    if (closingRate === undefined) {
      // No closing rate available; skip
      continue;
    }

    // Convert foreign balance to functional currency
    // rate = how many units of foreign per 1 base
    const functionalOriginal = acct.balance / acct.original_rate;
    const functionalClosing = acct.balance / closingRate;
    const unrealized = functionalClosing - functionalOriginal;

    entries.push({
      account_id: acct.account_id,
      currency: acct.currency,
      original_amount: acct.balance,
      original_rate: acct.original_rate,
      closing_rate: closingRate,
      functional_original: round(functionalOriginal, 2),
      functional_closing: round(functionalClosing, 2),
      unrealized_gain_loss: round(unrealized, 2),
    });
  }

  const totalUnrealized = entries.reduce(
    (sum, e) => sum + e.unrealized_gain_loss,
    0,
  );

  return {
    period,
    entries,
    total_unrealized_gain_loss: round(totalUnrealized, 2),
  };
}

// ── Utilities ────────────────────────────────────────────────────────────

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
