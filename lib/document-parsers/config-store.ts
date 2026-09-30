import { createHash } from "crypto";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { reportConfigs } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { ReportConfig } from "./report-types";

// ── Fingerprinting ──────────────────────────────────────────────────

/**
 * Compute a SHA-256 fingerprint of a workbook's structural layout.
 *
 * Captures: sorted sheet names, per-sheet column count, first 3 non-empty
 * rows, merged cell ranges, detected header row count, and workbook metadata.
 * This allows matching structurally identical workbooks even when cell values
 * differ (e.g. monthly P&L exports from the same template).
 */
export function computeFingerprint(workbook: XLSX.WorkBook): string {
  const hash = createHash("sha256");

  // Sorted sheet names for order-independent matching
  const sheetNames = [...workbook.SheetNames].sort();
  hash.update(`sheets:${sheetNames.join(",")}`);

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;

    const ref = sheet["!ref"];
    if (!ref) {
      hash.update(`sheet:${name}:empty`);
      continue;
    }

    const range = XLSX.utils.decode_range(ref);
    const colCount = range.e.c - range.s.c + 1;
    hash.update(`sheet:${name}:cols:${colCount}`);

    // First 3 non-empty rows (structural fingerprint)
    let nonEmptyCount = 0;
    for (let r = range.s.r; r <= range.e.r && nonEmptyCount < 3; r++) {
      const rowValues: string[] = [];
      let hasValue = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") {
          rowValues.push(String(cell.v));
          hasValue = true;
        } else {
          rowValues.push("");
        }
      }
      if (hasValue) {
        hash.update(`row:${nonEmptyCount}:${rowValues.join("|")}`);
        nonEmptyCount++;
      }
    }

    // Merged cell ranges
    const merges = sheet["!merges"] ?? [];
    const mergeStrings = merges
      .map((m) => `${XLSX.utils.encode_range(m)}`)
      .sort();
    hash.update(`merges:${mergeStrings.join(",")}`);

    // Detect header row count (rows before first numeric value in column A)
    let headerRows = 0;
    for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
      const addr = XLSX.utils.encode_cell({ r, c: range.s.c });
      const cell = sheet[addr];
      if (cell && typeof cell.v === "number") break;
      headerRows++;
    }
    hash.update(`headers:${headerRows}`);
  }

  // Workbook metadata (author, company, etc.)
  const props = workbook.Props ?? {};
  const metaKeys = ["Author", "Company", "Application"] as const;
  for (const key of metaKeys) {
    if (props[key]) {
      hash.update(`meta:${key}:${props[key]}`);
    }
  }

  return hash.digest("hex");
}

const MONTH_NAME_RE =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/gi;
const QUARTER_RE = /\bq[1-4]\b/gi;
const DATE_RE = /\b\d{1,4}[\/-]\d{1,2}(?:[\/-]\d{1,4})?\b/g;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const NUMERIC_TOKEN_RE = /\b\d+(?:[.,]\d+)?\b/g;
const MULTISPACE_RE = /\s+/g;
const NON_WORD_RE = /[^a-z0-9&<>]+/g;

function normalizeFamilyText(value: unknown): string {
  const raw = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();

  if (raw.length === 0) return "<empty>";

  const normalized = raw
    .replace(/\r?\n/g, " ")
    .replace(DATE_RE, " <date> ")
    .replace(MONTH_NAME_RE, " <month> ")
    .replace(QUARTER_RE, " <quarter> ")
    .replace(YEAR_RE, " <year> ")
    .replace(NUMERIC_TOKEN_RE, " <num> ")
    .replace(NON_WORD_RE, " ")
    .replace(MULTISPACE_RE, " ")
    .trim();

  return normalized.length > 0 ? normalized : "<empty>";
}

/**
 * Compute a normalized workbook-family fingerprint.
 *
 * Unlike the exact fingerprint, this intentionally strips volatile header
 * tokens such as month names, years, dates, and numeric totals so recurring
 * monthly workbooks from the same template can reuse a proven config.
 */
export function computeFamilyFingerprint(workbook: XLSX.WorkBook): string {
  const hash = createHash("sha256");

  const sheetNames = [...workbook.SheetNames]
    .map((name) => normalizeFamilyText(name))
    .sort();
  hash.update(`family:sheets:${sheetNames.join(",")}`);

  for (const name of [...workbook.SheetNames].sort()) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;

    const ref = sheet["!ref"];
    if (!ref) {
      hash.update(`sheet:${normalizeFamilyText(name)}:empty`);
      continue;
    }

    const range = XLSX.utils.decode_range(ref);
    const colCount = range.e.c - range.s.c + 1;
    hash.update(`sheet:${normalizeFamilyText(name)}:cols:${colCount}`);

    let nonEmptyCount = 0;
    for (let r = range.s.r; r <= range.e.r && nonEmptyCount < 3; r++) {
      const rowValues: string[] = [];
      let hasValue = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        if (cell && cell.v !== undefined && cell.v !== null && cell.v !== "") {
          rowValues.push(normalizeFamilyText(cell.v));
          hasValue = true;
        } else {
          rowValues.push("");
        }
      }
      if (hasValue) {
        hash.update(`family:row:${nonEmptyCount}:${rowValues.join("|")}`);
        nonEmptyCount++;
      }
    }

    const merges = sheet["!merges"] ?? [];
    const mergeStrings = merges
      .map((m) => `${XLSX.utils.encode_range(m)}`)
      .sort();
    hash.update(`family:merges:${mergeStrings.join(",")}`);

    let headerRows = 0;
    for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
      const addr = XLSX.utils.encode_cell({ r, c: range.s.c });
      const cell = sheet[addr];
      if (cell && typeof cell.v === "number") break;
      headerRows++;
    }
    hash.update(`family:headers:${headerRows}`);
  }

  const props = workbook.Props ?? {};
  const metaKeys = ["Author", "Company", "Application"] as const;
  for (const key of metaKeys) {
    if (props[key]) {
      hash.update(`family:meta:${key}:${normalizeFamilyText(props[key])}`);
    }
  }

  return hash.digest("hex");
}

async function bumpConfigUsage(configId: string): Promise<void> {
  await db
    .update(reportConfigs)
    .set({
      usageCount: sql`${reportConfigs.usageCount} + 1`,
      lastUsedAt: sql`now()`,
    })
    .where(eq(reportConfigs.id, configId));
}

// ── Config CRUD ─────────────────────────────────────────────────────

/**
 * Look up a saved config for this workbook structure.
 * Bumps usage_count and last_used_at on hit.
 */
export async function findMatchingConfig(
  companyId: string,
  workbook: XLSX.WorkBook,
): Promise<ReportConfig | null> {
  const fingerprint = computeFingerprint(workbook);

  const rows = await db
    .update(reportConfigs)
    .set({
      usageCount: sql`${reportConfigs.usageCount} + 1`,
      lastUsedAt: sql`now()`,
    })
    .where(
      and(
        eq(reportConfigs.companyId, companyId),
        eq(reportConfigs.fingerprint, fingerprint),
      ),
    )
    .returning({ config: reportConfigs.config });

  if (rows.length > 0) {
    return rows[0].config as ReportConfig;
  }

  const familyFingerprint = computeFamilyFingerprint(workbook);
  const familyRows = await db
    .select({
      id: reportConfigs.id,
      config: reportConfigs.config,
    })
    .from(reportConfigs)
    .where(
      and(
        eq(reportConfigs.companyId, companyId),
        eq(reportConfigs.familyFingerprint, familyFingerprint),
      ),
    )
    .orderBy(
      desc(reportConfigs.usageCount),
      desc(reportConfigs.lastUsedAt),
      desc(reportConfigs.updatedAt),
    )
    .limit(1);

  if (familyRows.length === 0) return null;

  await bumpConfigUsage(familyRows[0].id);
  return familyRows[0].config as ReportConfig;
}

/**
 * Persist a report config, keyed by workbook fingerprint.
 * On conflict (same company + fingerprint), bump version.
 */
export async function saveConfig(
  companyId: string,
  name: string,
  reportType: string,
  config: ReportConfig,
  workbook: XLSX.WorkBook,
): Promise<void> {
  const fingerprint = computeFingerprint(workbook);
  const familyFingerprint = computeFamilyFingerprint(workbook);

  await db
    .insert(reportConfigs)
    .values({
      companyId,
      name,
      reportType,
      config,
      fingerprint,
      familyFingerprint,
    })
    .onConflictDoUpdate({
      target: [reportConfigs.companyId, reportConfigs.fingerprint],
      set: {
        name,
        reportType,
        config,
        familyFingerprint,
        version: sql`${reportConfigs.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Execute `fn` under a PostgreSQL advisory lock scoped to
 * (companyId, fingerprint). Prevents parallel config generation
 * races for the same workbook structure.
 *
 * The lock is released when the wrapping transaction commits or
 * rolls back.
 */
export async function withConfigLock<T>(
  companyId: string,
  fingerprint: string,
  fn: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // pg_advisory_xact_lock takes a bigint, hashtext returns int4
    // We combine companyId + fingerprint into a single hash key
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${companyId} || ${fingerprint}))`,
    );
    return fn();
  });
}
