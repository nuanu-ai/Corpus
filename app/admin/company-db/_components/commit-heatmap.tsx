"use client";

import { useMemo } from "react";

// ── Color scale ──────────────────────────────────────────────────────────────

const COLORS = {
  empty: "#1e293b", // bg-muted equivalent (slate-800)
  L1: "#0e4429", // 1 commit
  L2: "#006d32", // 2-3 commits
  L3: "#26a641", // 4-6 commits
  L4: "#39d353", // 7+ commits
} as const;

function commitColor(count: number): string {
  if (count === 0) return COLORS.empty;
  if (count === 1) return COLORS.L1;
  if (count <= 3) return COLORS.L2;
  if (count <= 6) return COLORS.L3;
  return COLORS.L4;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CELL_SIZE = 13;
const CELL_GAP = 3;
const CELL_PITCH = CELL_SIZE + CELL_GAP; // 16px
const WEEKS = 52;
const DAYS_PER_WEEK = 7;

const DAY_LABEL_WIDTH = 36; // space for Mon/Wed/Fri labels
const MONTH_LABEL_HEIGHT = 16; // space for month labels at top
const PADDING_TOP = 4;

const SVG_WIDTH = DAY_LABEL_WIDTH + WEEKS * CELL_PITCH;
const SVG_HEIGHT = MONTH_LABEL_HEIGHT + PADDING_TOP + DAYS_PER_WEEK * CELL_PITCH;

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_LABELS: Array<{ row: number; label: string }> = [
  { row: 1, label: "Mon" },
  { row: 3, label: "Wed" },
  { row: 5, label: "Fri" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format a date as "Mar 3, 2026" */
function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Format date as "YYYY-MM-DD" for map lookup */
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Grid generation ──────────────────────────────────────────────────────────

interface CellData {
  date: Date;
  dateStr: string;
  count: number;
  col: number; // week index (0-51)
  row: number; // day index (0=Sun, 6=Sat)
}

interface MonthLabel {
  label: string;
  col: number;
}

function buildGrid(
  countMap: Map<string, number>,
  today: Date,
): { cells: CellData[]; monthLabels: MonthLabel[] } {
  const cells: CellData[] = [];
  const monthLabels: MonthLabel[] = [];

  // Find the starting Sunday: 52 weeks before this week's Sunday
  const todayDay = today.getDay(); // 0=Sun
  const thisSunday = new Date(today);
  thisSunday.setDate(today.getDate() - todayDay);
  thisSunday.setHours(0, 0, 0, 0);

  const startDate = new Date(thisSunday);
  startDate.setDate(thisSunday.getDate() - (WEEKS - 1) * 7);

  let lastMonth = -1;

  for (let col = 0; col < WEEKS; col++) {
    for (let row = 0; row < DAYS_PER_WEEK; row++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + col * 7 + row);

      // Don't render cells for future dates
      if (d > today) continue;

      const dateStr = toISODate(d);
      const count = countMap.get(dateStr) ?? 0;

      cells.push({ date: d, dateStr, count, col, row });

      // Track month labels: emit at the first day of each new month
      const month = d.getMonth();
      if (month !== lastMonth) {
        monthLabels.push({ label: MONTH_NAMES[month], col });
        lastMonth = month;
      }
    }
  }

  return { cells, monthLabels };
}

// ── Component ────────────────────────────────────────────────────────────────

export function CommitHeatmap({
  heatmap,
  totalCommits,
}: {
  heatmap: Array<{ date: string; count: number }>;
  totalCommits: number;
}) {
  const { cells, monthLabels } = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const entry of heatmap) {
      countMap.set(entry.date, entry.count);
    }
    return buildGrid(countMap, new Date());
  }, [heatmap]);

  return (
    <div className="space-y-3">
      {/* Summary */}
      <p className="text-sm text-muted-foreground">
        {totalCommits} {totalCommits === 1 ? "commit" : "commits"} in the last
        year
      </p>

      {/* Scrollable SVG container */}
      <div className="overflow-x-auto">
        <svg
          width={SVG_WIDTH}
          height={SVG_HEIGHT}
          className="block"
          role="img"
          aria-label={`Commit heatmap showing ${totalCommits} commits in the last year`}
        >
          {/* Month labels along the top */}
          {monthLabels.map((m, i) => (
            <text
              key={`month-${i}`}
              x={DAY_LABEL_WIDTH + m.col * CELL_PITCH}
              y={MONTH_LABEL_HEIGHT - 2}
              className="fill-muted-foreground"
              fontSize={11}
              fontFamily="system-ui, sans-serif"
            >
              {m.label}
            </text>
          ))}

          {/* Day labels on the left: Mon, Wed, Fri */}
          {DAY_LABELS.map((d) => (
            <text
              key={`day-${d.row}`}
              x={0}
              y={MONTH_LABEL_HEIGHT + PADDING_TOP + d.row * CELL_PITCH + CELL_SIZE - 2}
              className="fill-muted-foreground"
              fontSize={11}
              fontFamily="system-ui, sans-serif"
            >
              {d.label}
            </text>
          ))}

          {/* Heatmap cells */}
          {cells.map((cell) => {
            const x = DAY_LABEL_WIDTH + cell.col * CELL_PITCH;
            const y = MONTH_LABEL_HEIGHT + PADDING_TOP + cell.row * CELL_PITCH;
            const tooltip = `${cell.count} ${cell.count === 1 ? "commit" : "commits"} on ${formatDate(cell.date)}`;

            return (
              <rect
                key={cell.dateStr}
                x={x}
                y={y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                rx={2}
                ry={2}
                fill={commitColor(cell.count)}
                className="transition-opacity hover:opacity-80"
              >
                <title>{tooltip}</title>
              </rect>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Less</span>
        {[COLORS.empty, COLORS.L1, COLORS.L2, COLORS.L3, COLORS.L4].map(
          (color) => (
            <span
              key={color}
              className="inline-block size-[11px] rounded-sm"
              style={{ backgroundColor: color }}
            />
          ),
        )}
        <span>More</span>
      </div>
    </div>
  );
}
