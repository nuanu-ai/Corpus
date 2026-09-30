import simpleGit from "simple-git";
import { parseQmd } from "../../qmd/parser.js";
import { readFile } from "../repo-manager.js";
import type { RepoHandle } from "../types.js";
import type { JournalEntry } from "../../schema/domain-types/finance.js";
import {
  loadAccessControls,
  loadAgentProfile,
  checkWritePermission,
  checkPeriodLock,
} from "../../access/access-control.js";
import { BALANCE_TOLERANCE } from "../../domains/finance/journal-entries.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface PreCommitResult {
  allowed: boolean;
  errors: string[];
}

// ── JE path matching ─────────────────────────────────────────────────────

const JE_PATH_PATTERN =
  /^finance\/ledger\/journal-entries\/(?:(\d{4}-\d{2})\/)?.*\.qmd$/;

const PERIOD_PATH_PATTERN =
  /^finance\/ledger\/journal-entries\/(\d{4}-\d{2})\//;

/**
 * Extract the period (YYYY-MM) from a journal-entry path, if present.
 */
function extractPeriodFromPath(filePath: string): string | null {
  const match = filePath.match(PERIOD_PATH_PATTERN);
  return match ? match[1] : null;
}

/**
 * Check whether a path is a journal-entry QMD file.
 */
function isJournalEntryQmd(filePath: string): boolean {
  return JE_PATH_PATTERN.test(filePath);
}

// ── Balance validation ───────────────────────────────────────────────────

/**
 * Validate that a journal entry's debits equal credits.
 * Uses a tolerance of 0.005 to handle floating-point rounding.
 */
function validateJEBalance(
  lines: { debit?: number; credit?: number }[]
): { balanced: boolean; totalDebits: number; totalCredits: number } {
  let totalDebits = 0;
  let totalCredits = 0;

  for (const line of lines) {
    totalDebits += line.debit ?? 0;
    totalCredits += line.credit ?? 0;
  }

  // Round to 2 decimal places for comparison
  totalDebits = Math.round(totalDebits * 100) / 100;
  totalCredits = Math.round(totalCredits * 100) / 100;

  return {
    balanced: Math.abs(totalDebits - totalCredits) < BALANCE_TOLERANCE,
    totalDebits,
    totalCredits,
  };
}

// ── Main hook function ───────────────────────────────────────────────────

/**
 * Run all pre-commit validations against staged files.
 *
 * Checks:
 * 1. Agent scope — agent must have write permission for all staged files' domains
 * 2. Period locks — staged files in locked periods are rejected
 * 3. JE balance — journal entry QMDs must have sum(debits) == sum(credits)
 */
export async function runPreCommitHook(
  repoPath: string
): Promise<PreCommitResult> {
  const errors: string[] = [];

  const repo: RepoHandle = { path: repoPath, slug: "" };

  // Get staged files
  const git = simpleGit(repoPath);

  // Use diff --cached for accurate staged file list
  const diffResult = await git.diff(["--cached", "--name-only"]);
  const staged = diffResult
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);

  if (staged.length === 0) {
    return { allowed: true, errors: [] };
  }

  // ── 1. Agent scope check ─────────────────────────────────────────────

  const agentId = process.env.GIT_AUTHOR_NAME ?? "";

  if (agentId) {
    const controls = await loadAccessControls(repo);
    const profile = await loadAgentProfile(repo, agentId);

    if (!profile) {
      errors.push(
        `Agent scope: unknown agent "${agentId}" — no profile found`
      );
    } else {
      const result = checkWritePermission(agentId, staged, controls, profile);
      if (!result.allowed) {
        errors.push(`Agent scope: ${result.reason}`);
      }
    }
  }

  // ── 2. Period lock check ─────────────────────────────────────────────

  const periodsChecked = new Set<string>();

  for (const filePath of staged) {
    const period = extractPeriodFromPath(filePath);
    if (period && !periodsChecked.has(period)) {
      periodsChecked.add(period);
      const lockResult = await checkPeriodLock(repo, period);
      if (lockResult.locked) {
        errors.push(
          `Period lock: ${lockResult.reason} — cannot modify files in ${period}/`
        );
      }
    }
  }

  // ── 3. JE balance validation ─────────────────────────────────────────

  for (const filePath of staged) {
    if (!isJournalEntryQmd(filePath)) continue;

    const content = await readFile(repo, filePath);
    if (content === null) continue;

    try {
      const doc = parseQmd<JournalEntry>(content);
      const lines = doc.frontmatter.lines;

      if (!Array.isArray(lines)) continue;

      const { balanced, totalDebits, totalCredits } =
        validateJEBalance(lines);

      if (!balanced) {
        errors.push(
          `JE balance: ${filePath} — debits (${totalDebits}) != credits (${totalCredits})`
        );
      }
    } catch {
      // If QMD can't be parsed, skip balance check (schema validator handles this)
    }
  }

  return {
    allowed: errors.length === 0,
    errors,
  };
}

// ── CLI entrypoint ───────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const repoPath = process.cwd();
  const result = await runPreCommitHook(repoPath);

  if (!result.allowed) {
    console.error("Pre-commit hook failed:");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  process.exit(0);
}
