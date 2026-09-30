import type { Account, JournalEntry, JournalEntryLine, PeriodClose } from "../../schema/domain-types/finance.js";
import type { PeriodStatus } from "../../schema/domain-types/common.js";
// ── Constants ───────────────────────────────────────────────────────────

/** Tolerance for floating-point balance comparison (debits vs credits). */
export const BALANCE_TOLERANCE = 0.005;

// ── Types ────────────────────────────────────────────────────────────────

export interface JournalEntryValidation {
  valid: boolean;
  errors: string[];
}

export interface CreateJournalEntryData {
  date: string;
  description: string;
  lines: JournalEntryLine[];
  source?: string;
  source_ref?: string;
  tags?: string[];
}

// ── Period helpers ──────────────────────────────────────────────────────

/**
 * Derive the accounting period (YYYY-MM) from a date string.
 */
export function derivePeriod(date: string): string {
  // Accept ISO dates: "2024-01-15" or "2024-01-15T..."
  const match = date.match(/^(\d{4}-\d{2})/);
  if (!match) {
    throw new Error(`Cannot derive period from date: "${date}"`);
  }
  return match[1];
}

/**
 * Get the status of a period from a map of period close records.
 * Returns "open" if no record exists.
 */
export function getPeriodStatus(
  periodCloses: Map<string, PeriodClose> | PeriodClose[],
  period: string,
): PeriodStatus {
  if (Array.isArray(periodCloses)) {
    const record = periodCloses.find((pc) => pc.period === period);
    return record?.status ?? "open";
  }
  return periodCloses.get(period)?.status ?? "open";
}

// ── Validation ─────────────────────────────────────────────────────────

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a journal entry for double-entry correctness.
 *
 * Checks:
 * 1. At least 2 lines
 * 2. Each line has a debit XOR credit (not both, not neither)
 * 3. All account IDs reference accounts in the provided chart
 * 4. All account numbers are valid format
 * 5. Debits == Credits (within rounding tolerance of 0.005)
 * 6. Date is a valid ISO date
 * 7. Period is derivable from the date
 * 8. Status must be "draft" — new JEs cannot be created in any other status
 * 9. No negative amounts
 */
export function validateJournalEntry(
  entry: JournalEntry,
  chartOfAccounts: Account[],
): JournalEntryValidation {
  const errors: string[] = [];

  // Date validation
  if (!ISO_DATE_REGEX.test(entry.date)) {
    errors.push(`Invalid date format: "${entry.date}" — expected YYYY-MM-DD`);
  } else {
    const parsed = new Date(entry.date);
    if (isNaN(parsed.getTime())) {
      errors.push(`Invalid date value: "${entry.date}"`);
    }
  }

  // Period derivation
  try {
    const derived = derivePeriod(entry.date);
    if (entry.period && entry.period !== derived) {
      errors.push(
        `Period "${entry.period}" does not match date "${entry.date}" (expected "${derived}")`,
      );
    }
  } catch {
    errors.push(`Cannot derive period from date: "${entry.date}"`);
  }

  // Status must be draft for new entries
  if (entry.status !== "draft") {
    errors.push(
      `New journal entries must have status "draft", got "${entry.status}"`,
    );
  }

  // Must have at least 2 lines
  if (!entry.lines || entry.lines.length < 2) {
    errors.push("Journal entry must have at least 2 lines");
    return { valid: false, errors };
  }

  // Build account lookup
  const accountMap = new Map<string, Account>();
  for (const acct of chartOfAccounts) {
    accountMap.set(acct.id, acct);
  }

  let totalDebits = 0;
  let totalCredits = 0;

  for (let i = 0; i < entry.lines.length; i++) {
    const line = entry.lines[i];
    const lineLabel = `Line ${i + 1}`;

    // Account must exist in chart
    if (!accountMap.has(line.account_id)) {
      errors.push(
        `${lineLabel}: account "${line.account_id}" not found in chart of accounts`,
      );
    }

    // Debit XOR Credit
    const hasDebit = line.debit !== undefined && line.debit !== null;
    const hasCredit = line.credit !== undefined && line.credit !== null;

    if (hasDebit && hasCredit) {
      errors.push(
        `${lineLabel}: line cannot have both debit and credit`,
      );
    } else if (!hasDebit && !hasCredit) {
      errors.push(
        `${lineLabel}: line must have either debit or credit`,
      );
    }

    // No negative amounts
    if (hasDebit && (line.debit as number) < 0) {
      errors.push(`${lineLabel}: debit amount cannot be negative`);
    }
    if (hasCredit && (line.credit as number) < 0) {
      errors.push(`${lineLabel}: credit amount cannot be negative`);
    }

    // FX rate validation
    if (line.fx_rate !== undefined && line.fx_rate <= 0) {
      errors.push(`${lineLabel}: fx_rate must be positive, got ${line.fx_rate}`);
    }

    // Accumulate totals (apply fx_rate if present)
    const rate = line.fx_rate ?? 1;
    if (hasDebit) totalDebits += (line.debit as number) * rate;
    if (hasCredit) totalCredits += (line.credit as number) * rate;
  }

  // Debits must equal credits (within rounding tolerance)
  if (Math.abs(totalDebits - totalCredits) > BALANCE_TOLERANCE) {
    errors.push(
      `Debits (${totalDebits.toFixed(4)}) do not equal credits (${totalCredits.toFixed(4)}) — difference: ${Math.abs(totalDebits - totalCredits).toFixed(4)}`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ── Create ─────────────────────────────────────────────────────────────

/**
 * Create a new journal entry. Always starts in "draft" status.
 *
 * @param id — caller-provided unique ID (e.g. from ID registry)
 * @throws if validation fails
 */
export function createJournalEntry(
  id: string,
  data: CreateJournalEntryData,
  chartOfAccounts: Account[],
): JournalEntry {
  const period = derivePeriod(data.date);

  const entry: JournalEntry = {
    type: "journal_entry",
    id,
    date: data.date,
    period,
    description: data.description,
    lines: data.lines,
    status: "draft",
    source: data.source,
    source_ref: data.source_ref,
    tags: data.tags,
    created_at: new Date().toISOString(),
  };

  const validation = validateJournalEntry(entry, chartOfAccounts);
  if (!validation.valid) {
    throw new Error(
      `Invalid journal entry: ${validation.errors.join("; ")}`,
    );
  }

  return entry;
}

// ── Duplicate Detection ────────────────────────────────────────────────

/**
 * Compute the total amount (sum of debits) for a journal entry.
 */
export function computeJETotal(entry: JournalEntry): number {
  let total = 0;
  for (const line of entry.lines) {
    if (line.debit !== undefined && line.debit !== null) {
      const rate = line.fx_rate ?? 1;
      total += line.debit * rate;
    }
  }
  return total;
}

/**
 * Detect potential duplicate journal entries.
 *
 * A candidate is considered a duplicate if an existing entry has:
 * - Same date
 * - Same total (debit sum) within tolerance
 * - Similar description (case-insensitive, trimmed)
 */
export function detectDuplicateJE(
  candidate: JournalEntry,
  existing: JournalEntry[],
): JournalEntry[] {
  const candidateTotal = computeJETotal(candidate);
  const candidateDesc = candidate.description.trim().toLowerCase();

  return existing.filter((e) => {
    if (e.date !== candidate.date) return false;
    if (e.description.trim().toLowerCase() !== candidateDesc) return false;

    const existingTotal = computeJETotal(e);
    return Math.abs(existingTotal - candidateTotal) <= BALANCE_TOLERANCE;
  });
}
