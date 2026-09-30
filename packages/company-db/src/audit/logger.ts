import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  domain?: string;
  result: "allow" | "deny";
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogger {
  log(entry: Omit<AuditEntry, "timestamp">): void;
  query(filters: {
    actor?: string;
    action?: string;
    from?: string;
    to?: string;
  }): AuditEntry[];
  generateDailySummary(date: string): {
    totalRequests: number;
    denials: number;
    byActor: Record<string, number>;
    byAction: Record<string, number>;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function dateFromTimestamp(ts: string): string {
  return ts.slice(0, 10); // "YYYY-MM-DD"
}

function fileForDate(logDir: string, date: string): string {
  return join(logDir, `audit-${date}.jsonl`);
}

/**
 * Collect the set of date strings between `from` and `to` (inclusive).
 * Both must be "YYYY-MM-DD".
 */
function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const end = new Date(to + "T00:00:00Z");
  let cur = new Date(from + "T00:00:00Z");

  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return dates;
}

function readDayEntries(logDir: string, date: string): AuditEntry[] {
  const file = fileForDate(logDir, date);
  if (!existsSync(file)) return [];

  const content = readFileSync(file, "utf-8").trimEnd();
  if (content.length === 0) return [];

  return content.split("\n").map((line) => JSON.parse(line) as AuditEntry);
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createAuditLogger(logDir: string): AuditLogger {
  mkdirSync(logDir, { recursive: true });

  return {
    log(entry) {
      const full: AuditEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      };
      const date = dateFromTimestamp(full.timestamp);
      const file = fileForDate(logDir, date);
      appendFileSync(file, JSON.stringify(full) + "\n", "utf-8");
    },

    query(filters) {
      // Determine which day files to scan
      let dates: string[];

      if (filters.from && filters.to) {
        dates = dateRange(filters.from, filters.to);
      } else if (filters.from) {
        // from → today
        dates = dateRange(filters.from, new Date().toISOString().slice(0, 10));
      } else if (filters.to) {
        // scan all existing files up to `to`
        // For simplicity, just read the target day (callers should provide from)
        dates = [filters.to];
      } else {
        // No date filters — read today's file
        dates = [new Date().toISOString().slice(0, 10)];
      }

      let entries: AuditEntry[] = [];
      for (const d of dates) {
        entries = entries.concat(readDayEntries(logDir, d));
      }

      // Apply non-date filters
      if (filters.actor) {
        entries = entries.filter((e) => e.actor === filters.actor);
      }
      if (filters.action) {
        entries = entries.filter((e) => e.action === filters.action);
      }

      return entries;
    },

    generateDailySummary(date) {
      const entries = readDayEntries(logDir, date);

      const byActor: Record<string, number> = {};
      const byAction: Record<string, number> = {};
      let denials = 0;

      for (const entry of entries) {
        byActor[entry.actor] = (byActor[entry.actor] ?? 0) + 1;
        byAction[entry.action] = (byAction[entry.action] ?? 0) + 1;
        if (entry.result === "deny") denials++;
      }

      return {
        totalRequests: entries.length,
        denials,
        byActor,
        byAction,
      };
    },
  };
}
