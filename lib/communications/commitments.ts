import type { EntityResult } from "@/lib/company-db/client";

export type CommitmentSignalType = "commitment" | "deadline";
export type CommitmentStatus = "open" | "completed" | "cancelled";
export type CommitmentResolutionKind = "completion" | "cancellation";
export type CommitmentEscalationLevel = "l1" | "l2" | "l3";

export interface DashboardCommitmentItem {
  id: string;
  qualifiedId: string;
  filePath: string;
  title: string;
  summary: string | null;
  signalType: "commitment" | "deadline";
  provider: string | null;
  threadKey: string | null;
  threadLabel: string | null;
  participants: string[];
  counterparties: string[];
  keyThemes: string[];
  risks: string[];
  dueDate: string | null;
  dueDateLabel: string | null;
  dueDateMeaning: string | null;
  sourceMessageCount: number;
  sourceMessageIds: string[];
  confidence: number | null;
  dayKey: string | null;
  status: CommitmentStatus;
  escalationLevel: CommitmentEscalationLevel | null;
  resolvedAt: string | null;
  resolutionKind: CommitmentResolutionKind | null;
  resolutionSummary: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface ParsedDueDateCandidate {
  dayKey: string | null;
  label: string | null;
  meaning: string | null;
  score: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeStringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];

  for (const entry of value) {
    const next = normalizeString(entry);
    if (!next) continue;
    if (seen.has(next)) continue;
    seen.add(next);
    items.push(next);
    if (items.length >= limit) break;
  }

  return items;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace("%", ""));
    if (!Number.isFinite(parsed)) return null;
    return value.includes("%") || parsed > 1 ? parsed / 100 : parsed;
  }
  return null;
}

function normalizeDayKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return match ? match[1] + "-" + match[2] + "-" + match[3] : null;
}

function dayKeyToDate(dayKey: string): Date | null {
  const match = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  )
    return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dayKey: string, days: number): string | null {
  const date = dayKeyToDate(dayKey);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return toDayKey(date);
}

function normalizeYear(year: string): number {
  const parsed = Number(year);
  if (year.length === 2) return 2000 + parsed;
  return parsed;
}

function parseAbsoluteDate(raw: string): string | null {
  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const isoSlash = raw.match(/\b(\d{4})[/.](\d{1,2})[/.](\d{1,2})\b/);
  if (isoSlash) {
    const candidate = `${isoSlash[1]}-${isoSlash[2]!.padStart(2, "0")}-${isoSlash[3]!.padStart(2, "0")}`;
    return dayKeyToDate(candidate) ? candidate : null;
  }

  const slashOrDot = raw.match(/\b(\d{1,2})([./])(\d{1,2})\2(\d{2,4})\b/);
  if (slashOrDot) {
    const first = Number(slashOrDot[1]);
    const separator = slashOrDot[2]!;
    const second = Number(slashOrDot[3]);
    const year = normalizeYear(slashOrDot[4]!);
    const useMonthFirst = separator === "/" && second > 12 && first <= 12;
    const day = useMonthFirst ? second : first;
    const month = useMonthFirst ? first : second;
    const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return dayKeyToDate(candidate) ? candidate : null;
  }

  return null;
}

function parseRelativeDate(
  raw: string,
  anchorDayKey: string | null,
): string | null {
  if (!anchorDayKey) return null;
  const value = raw.toLowerCase();

  if (
    /\b(today)\b/.test(value) ||
    /\bсегодня\b/.test(value) ||
    /\bhari ini\b/.test(value)
  ) {
    return anchorDayKey;
  }

  if (
    /\b(day after tomorrow)\b/.test(value) ||
    /\bпослезавтра\b/.test(value) ||
    /\blusa\b/.test(value)
  ) {
    return addDays(anchorDayKey, 2);
  }

  if (
    /\b(tomorrow)\b/.test(value) ||
    /\bзавтра\b/.test(value) ||
    /\bbesok\b/.test(value)
  ) {
    return addDays(anchorDayKey, 1);
  }

  if (
    /\bnext week\b/.test(value) ||
    (/\bследующ/i.test(value) && /\bнедел/i.test(value)) ||
    /\bminggu depan\b/.test(value)
  ) {
    return addDays(anchorDayKey, 7);
  }

  if (
    /\bthis week\b/.test(value) ||
    /\bна этой неделе\b/.test(value) ||
    /\bminggu ini\b/.test(value)
  ) {
    return anchorDayKey;
  }

  const weekday = parseWeekday(value);
  if (weekday === null) return null;

  const anchorDate = dayKeyToDate(anchorDayKey);
  if (!anchorDate) return null;

  const currentWeekday = anchorDate.getUTCDay();
  let delta = (weekday - currentWeekday + 7) % 7;
  if (
    /\bnext\b/.test(value) ||
    /\bследующ/i.test(value) ||
    /\bdepan\b/.test(value)
  ) {
    if (delta === 0) delta = 7;
  }

  return addDays(anchorDayKey, delta);
}

function parseWeekday(raw: string): number | null {
  const patterns: Array<{ regex: RegExp; weekday: number }> = [
    { regex: /\bsunday\b|воскресень|minggu|ahad/, weekday: 0 },
    { regex: /\bmonday\b|понедельник|понедельн|senin/, weekday: 1 },
    { regex: /\btuesday\b|вторник|вторни|selasa/, weekday: 2 },
    { regex: /\bwednesday\b|сред[ауеы]?|rabu/, weekday: 3 },
    { regex: /\bthursday\b|четверг|четверг[ауе]?|kamis/, weekday: 4 },
    { regex: /\bfriday\b|пятниц|jumat|jum'at/, weekday: 5 },
    { regex: /\bsaturday\b|суббот|sabtu/, weekday: 6 },
  ];

  for (const pattern of patterns) {
    if (pattern.regex.test(raw)) return pattern.weekday;
  }

  return null;
}

function scoreDateMeaning(
  signalType: DashboardCommitmentItem["signalType"],
  meaning: string | null,
): number {
  let score = signalType === "deadline" ? 5 : 2;
  if (!meaning) return score;

  const normalized = meaning.toLowerCase();
  if (
    /\b(due|deadline|deliver|delivery|send|reply|follow ?up|submit|payment|launch|meeting|call|review|report)\b/.test(
      normalized,
    ) ||
    /\b(срок|дедлайн|отправ|сдел|подготов|сдать|созвон|встреч|отчет|договор)\b/.test(
      normalized,
    ) ||
    /\b(jatuh tempo|deadline|kirim|balas|follow ?up|siapkan|laporan|rapat|review)\b/.test(
      normalized,
    )
  ) {
    score += 3;
  }

  return score;
}

function pickDueDate(
  dates: unknown,
  signalType: DashboardCommitmentItem["signalType"],
  anchorDayKey: string | null,
): Pick<
  DashboardCommitmentItem,
  "dueDate" | "dueDateLabel" | "dueDateMeaning"
> {
  if (!Array.isArray(dates) || dates.length === 0) {
    return {
      dueDate: null,
      dueDateLabel: null,
      dueDateMeaning: null,
    };
  }

  const parsedCandidates: ParsedDueDateCandidate[] = [];
  let fallbackLabel: string | null = null;
  let fallbackMeaning: string | null = null;

  for (const entry of dates) {
    const record = asRecord(entry);
    const rawDate = normalizeString(record?.date);
    const meaning = normalizeString(
      record?.meaning ?? record?.label ?? record?.context,
    );
    if (!fallbackLabel && rawDate) fallbackLabel = rawDate;
    if (!fallbackMeaning && meaning) fallbackMeaning = meaning;
    if (!rawDate) continue;

    const absolute = parseAbsoluteDate(rawDate);
    const relative = absolute ? null : parseRelativeDate(rawDate, anchorDayKey);
    const resolved = normalizeDayKey(absolute ?? relative);
    if (!resolved) continue;

    parsedCandidates.push({
      dayKey: resolved,
      label: rawDate,
      meaning,
      score: scoreDateMeaning(signalType, meaning),
    });
  }

  if (parsedCandidates.length === 0) {
    return {
      dueDate: null,
      dueDateLabel: fallbackLabel,
      dueDateMeaning: fallbackMeaning,
    };
  }

  parsedCandidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.dayKey!.localeCompare(right.dayKey!);
  });

  const winner = parsedCandidates[0]!;
  return {
    dueDate: winner.dayKey,
    dueDateLabel: winner.label,
    dueDateMeaning: winner.meaning,
  };
}

function normalizeSignalType(
  value: unknown,
): DashboardCommitmentItem["signalType"] | null {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === "commitment" || normalized === "deadline")
    return normalized;
  return null;
}

export function normalizeCommitmentStatus(value: unknown): CommitmentStatus {
  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized === "completed" || normalized === "cancelled")
    return normalized;
  return "open";
}

export function normalizeCommitmentResolutionKind(
  value: unknown,
): CommitmentResolutionKind | null {
  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized === "completion" || normalized === "cancellation")
    return normalized;
  return null;
}

export function normalizeCommitmentEscalationLevel(
  value: unknown,
): CommitmentEscalationLevel | null {
  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized === "l1" || normalized === "l2" || normalized === "l3")
    return normalized;
  return null;
}

function normalizeTitleKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .trim();
}

function compareIsoDateDesc(left: string | null, right: string | null): number {
  if (left && right) return right.localeCompare(left);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

export function resolveCommitmentDueDate(input: {
  dates: unknown;
  signalType: CommitmentSignalType;
  anchorDayKey: string | null;
  explicitDueDate?: unknown;
  explicitDueDateLabel?: unknown;
  explicitDueDateMeaning?: unknown;
}): Pick<
  DashboardCommitmentItem,
  "dueDate" | "dueDateLabel" | "dueDateMeaning"
> {
  const explicitDueDate = normalizeDayKey(
    normalizeString(input.explicitDueDate),
  );
  if (explicitDueDate) {
    return {
      dueDate: explicitDueDate,
      dueDateLabel:
        normalizeString(input.explicitDueDateLabel) ?? explicitDueDate,
      dueDateMeaning: normalizeString(input.explicitDueDateMeaning),
    };
  }

  return pickDueDate(input.dates, input.signalType, input.anchorDayKey);
}

export function toCommitmentSignalCandidate(
  record: EntityResult,
): DashboardCommitmentItem | null {
  const frontmatter = asRecord(record.frontmatter) ?? {};
  const signalType = normalizeSignalType(
    frontmatter.signal_type ?? frontmatter.target_entity_type,
  );
  if (!signalType) return null;

  const title = normalizeString(frontmatter.title ?? record.title);
  if (!title) return null;

  const dayKey =
    normalizeDayKey(normalizeString(frontmatter.day_key)) ??
    normalizeDayKey(record.createdAt) ??
    normalizeDayKey(record.updatedAt);
  const dueDate = resolveCommitmentDueDate({
    dates: frontmatter.dates,
    signalType,
    anchorDayKey: dayKey,
    explicitDueDate: frontmatter.due_date,
    explicitDueDateLabel: frontmatter.due_date_label,
    explicitDueDateMeaning: frontmatter.due_date_meaning,
  });
  const provider = normalizeString(frontmatter.provider)?.toLowerCase() ?? null;
  const sourceMessageIds = normalizeStringArray(
    frontmatter.source_message_ids,
    200,
  );
  const status = normalizeCommitmentStatus(frontmatter.commitment_status);

  return {
    id: record.qualifiedId,
    qualifiedId: record.qualifiedId,
    filePath: record.filePath,
    title,
    summary: normalizeString(frontmatter.signal_summary ?? frontmatter.summary),
    signalType,
    provider,
    threadKey: normalizeString(frontmatter.thread_key),
    threadLabel: normalizeString(frontmatter.thread_label),
    participants: normalizeStringArray(frontmatter.participants),
    counterparties: normalizeStringArray(frontmatter.counterparties),
    keyThemes: normalizeStringArray(frontmatter.key_themes, 8),
    risks: normalizeStringArray(frontmatter.risks, 8),
    dueDate: dueDate.dueDate,
    dueDateLabel: dueDate.dueDateLabel,
    dueDateMeaning: dueDate.dueDateMeaning,
    sourceMessageCount: sourceMessageIds.length,
    sourceMessageIds,
    confidence: normalizeNumber(frontmatter.overall_confidence),
    dayKey,
    status,
    escalationLevel: normalizeCommitmentEscalationLevel(
      frontmatter.escalation_level,
    ),
    resolvedAt: normalizeString(frontmatter.resolved_at),
    resolutionKind: normalizeCommitmentResolutionKind(
      frontmatter.resolution_kind,
    ),
    resolutionSummary: normalizeString(frontmatter.resolution_summary),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function sortCommitments(
  left: DashboardCommitmentItem,
  right: DashboardCommitmentItem,
): number {
  if (left.dueDate && right.dueDate) {
    if (left.dueDate !== right.dueDate)
      return left.dueDate.localeCompare(right.dueDate);
  } else if (left.dueDate) {
    return -1;
  } else if (right.dueDate) {
    return 1;
  }

  const updatedCompare = compareIsoDateDesc(
    left.updatedAt ?? left.createdAt,
    right.updatedAt ?? right.createdAt,
  );
  if (updatedCompare !== 0) return updatedCompare;
  return left.title.localeCompare(right.title);
}

function shouldReplaceCommitment(
  current: DashboardCommitmentItem,
  incoming: DashboardCommitmentItem,
): boolean {
  const currentTimestamp = current.updatedAt ?? current.createdAt;
  const incomingTimestamp = incoming.updatedAt ?? incoming.createdAt;
  if (
    incomingTimestamp &&
    currentTimestamp &&
    incomingTimestamp !== currentTimestamp
  ) {
    return incomingTimestamp > currentTimestamp;
  }
  return (incoming.confidence ?? 0) > (current.confidence ?? 0);
}

export function buildDashboardCommitmentsFeed(
  records: EntityResult[],
  options?: { provider?: string; limit?: number },
): DashboardCommitmentItem[] {
  const providerFilter =
    normalizeString(options?.provider)?.toLowerCase() ?? null;
  const deduped = new Map<string, DashboardCommitmentItem>();

  for (const record of records) {
    const item = toCommitmentSignalCandidate(record);
    if (!item) continue;
    if (providerFilter && item.provider !== providerFilter) continue;
    if (item.status !== "open") continue;

    const dedupeKey = [
      item.provider ?? "unknown",
      item.threadKey ?? item.filePath,
      normalizeTitleKey(item.title),
      item.dueDate ?? item.dueDateLabel ?? "undated",
    ].join("|");

    const existing = deduped.get(dedupeKey);
    if (!existing || shouldReplaceCommitment(existing, item)) {
      deduped.set(dedupeKey, item);
    }
  }

  const items = Array.from(deduped.values()).sort(sortCommitments);
  const limit =
    typeof options?.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.trunc(options.limit))
      : items.length;
  return items.slice(0, limit);
}
