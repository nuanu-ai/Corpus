export const LOCAL_TIMEZONE = "UTC" as const;

export type RoutineScheduleCadence = "manual" | "daily" | "weekly" | "monthly";
export type RoutineScheduleCatchUpPolicy = "none" | "last_due_only" | "bounded";

export interface RoutineScheduleLocalTime {
  hour: number;
  minute: number;
}

export interface RoutineScheduleLocalAnchor extends RoutineScheduleLocalTime {
  dayOfWeek?: number;
  dayOfMonth?: number;
}

export interface ManualRoutineSchedulePolicy {
  manualOnly: true;
  cadence: "manual";
}

export interface RecurringRoutineSchedulePolicy {
  cadence: Exclude<RoutineScheduleCadence, "manual">;
  timezone: string;
  localAnchor: RoutineScheduleLocalAnchor;
  dueTime: RoutineScheduleLocalTime;
  dueOffsetDays: number;
  catchUpPolicy: RoutineScheduleCatchUpPolicy;
  maxBackfillWindowCount: number;
}

export type RoutineSchedulePolicy =
  | ManualRoutineSchedulePolicy
  | RecurringRoutineSchedulePolicy;

export interface RoutineScheduleWindow {
  cadence: Exclude<RoutineScheduleCadence, "manual">;
  timezone: string;
  periodKey: string;
  windowStart: Date;
  windowEnd: Date;
  dueAt: Date;
}

export type DueRoutineRunDecision =
  | {
      action: "enqueue";
      window: RoutineScheduleWindow;
      idempotencyKey: string;
    }
  | {
      action: "disabled" | "not_due" | "duplicate" | "blocked";
      reason: string;
      window?: RoutineScheduleWindow;
      idempotencyKey?: string;
    };

export interface RoutineScheduleStatus {
  cadence: RoutineScheduleCadence;
  timezone: string | null;
  schedulerEnabled: boolean;
  globalSchedulerEnabled: boolean;
  runnable: boolean;
  decision: DueRoutineRunDecision;
  currentWindow: RoutineScheduleWindow | null;
  latestDueWindow: RoutineScheduleWindow | null;
  nextDueWindow: RoutineScheduleWindow | null;
}

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    calendar: "iso8601",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}

function zonedParts(date: Date, timezone: string): LocalDateTime {
  const parts = formatterFor(timezone).formatToParts(date);
  const value = (type: string) => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (!part) throw new Error(`Missing ${type} for timezone ${timezone}`);
    return Number(part);
  };
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
    millisecond: date.getUTCMilliseconds(),
  };
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  return asUtc - date.getTime();
}

function localDateTimeToUtc(local: LocalDateTime, timezone: string): Date {
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    local.millisecond,
  );
  let utc = localAsUtc - timezoneOffsetMs(new Date(localAsUtc), timezone);
  utc = localAsUtc - timezoneOffsetMs(new Date(utc), timezone);
  return new Date(utc);
}

function localDateAt(date: LocalDate, time: RoutineScheduleLocalTime): LocalDateTime {
  return {
    year: date.year,
    month: date.month,
    day: date.day,
    hour: time.hour,
    minute: time.minute,
    second: 0,
    millisecond: 0,
  };
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function addLocalMonths(date: LocalDate, months: number): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: 1,
  };
}

function localDayOfWeek(date: LocalDate): number {
  const utcDay = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

function addCadence(date: LocalDate, cadence: Exclude<RoutineScheduleCadence, "manual">, count: number): LocalDate {
  if (cadence === "daily") return addLocalDays(date, count);
  if (cadence === "weekly") return addLocalDays(date, count * 7);
  return addLocalMonths(date, count);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateKey(date: LocalDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

function periodKey(cadence: Exclude<RoutineScheduleCadence, "manual">, start: LocalDate): string {
  if (cadence === "monthly") return `monthly:${start.year}-${pad2(start.month)}`;
  return `${cadence}:${localDateKey(start)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) ? Number(value) : fallback;
}

function readTime(value: unknown, fallback: RoutineScheduleLocalTime): RoutineScheduleLocalTime {
  if (!isRecord(value)) return fallback;
  const hour = readInteger(value.hour, fallback.hour);
  const minute = readInteger(value.minute, fallback.minute);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return { hour, minute };
}

function readAnchor(value: unknown, fallback: RoutineScheduleLocalAnchor): RoutineScheduleLocalAnchor {
  const time = readTime(value, fallback);
  const anchor: RoutineScheduleLocalAnchor = { ...fallback, ...time };
  if (!isRecord(value)) return anchor;
  if (Number.isInteger(value.dayOfWeek)) {
    const dayOfWeek = Number(value.dayOfWeek);
    if (dayOfWeek >= 1 && dayOfWeek <= 7) anchor.dayOfWeek = dayOfWeek;
  }
  if (Number.isInteger(value.dayOfMonth)) {
    const dayOfMonth = Number(value.dayOfMonth);
    if (dayOfMonth >= 1 && dayOfMonth <= 31) anchor.dayOfMonth = dayOfMonth;
  }
  return anchor;
}

function readTimezone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return LOCAL_TIMEZONE;
  try {
    formatterFor(value);
    return value;
  } catch {
    return LOCAL_TIMEZONE;
  }
}

export function buildDefaultRoutineSchedulePolicy(
  cadence: Exclude<RoutineScheduleCadence, "manual">,
): RecurringRoutineSchedulePolicy {
  return {
    cadence,
    timezone: LOCAL_TIMEZONE,
    localAnchor: {
      hour: 0,
      minute: 0,
      ...(cadence === "weekly" ? { dayOfWeek: 1 } : {}),
      ...(cadence === "monthly" ? { dayOfMonth: 1 } : {}),
    },
    dueTime: { hour: 0, minute: 0 },
    dueOffsetDays: 0,
    catchUpPolicy: "last_due_only",
    maxBackfillWindowCount: 8,
  };
}

export function normalizeRoutineSchedulePolicy(value: unknown): RoutineSchedulePolicy {
  if (!isRecord(value)) return { manualOnly: true, cadence: "manual" };
  if (value.manualOnly === true || value.cadence === "manual") {
    return { manualOnly: true, cadence: "manual" };
  }
  const cadence = value.cadence;
  if (cadence !== "daily" && cadence !== "weekly" && cadence !== "monthly") {
    return { manualOnly: true, cadence: "manual" };
  }
  const defaults = buildDefaultRoutineSchedulePolicy(cadence);
  const anchor = readAnchor(value.localAnchor, defaults.localAnchor);
  const maxBackfillWindowCount = readInteger(
    value.maxBackfillWindowCount,
    defaults.maxBackfillWindowCount,
  );
  const dueOffsetDays = readInteger(value.dueOffsetDays, defaults.dueOffsetDays);
  return {
    cadence,
    timezone: readTimezone(value.timezone),
    localAnchor: anchor,
    dueTime: readTime(value.dueTime, defaults.dueTime),
    dueOffsetDays: Math.max(0, Math.min(31, dueOffsetDays)),
    catchUpPolicy:
      value.catchUpPolicy === "none" ||
      value.catchUpPolicy === "last_due_only" ||
      value.catchUpPolicy === "bounded"
        ? value.catchUpPolicy
        : defaults.catchUpPolicy,
    maxBackfillWindowCount: Math.max(1, Math.min(366, maxBackfillWindowCount)),
  };
}

function currentWindowStartLocal(policy: RecurringRoutineSchedulePolicy, now: Date): LocalDate {
  const localNow = zonedParts(now, policy.timezone);
  const today = { year: localNow.year, month: localNow.month, day: localNow.day };
  let candidate: LocalDate;

  if (policy.cadence === "daily") {
    candidate = today;
  } else if (policy.cadence === "weekly") {
    const targetDay = policy.localAnchor.dayOfWeek ?? 1;
    const diff = (localDayOfWeek(today) - targetDay + 7) % 7;
    candidate = addLocalDays(today, -diff);
  } else {
    candidate = {
      year: today.year,
      month: today.month,
      day: policy.localAnchor.dayOfMonth ?? 1,
    };
  }

  const candidateUtc = localDateTimeToUtc(localDateAt(candidate, policy.localAnchor), policy.timezone);
  if (candidateUtc.getTime() <= now.getTime()) return candidate;
  return addCadence(candidate, policy.cadence, -1);
}

function windowFromStart(
  policy: RecurringRoutineSchedulePolicy,
  start: LocalDate,
): RoutineScheduleWindow {
  const end = addCadence(start, policy.cadence, 1);
  const dueLocalDate = addLocalDays(end, policy.dueOffsetDays);
  return {
    cadence: policy.cadence,
    timezone: policy.timezone,
    periodKey: periodKey(policy.cadence, start),
    windowStart: localDateTimeToUtc(localDateAt(start, policy.localAnchor), policy.timezone),
    windowEnd: localDateTimeToUtc(localDateAt(end, policy.localAnchor), policy.timezone),
    dueAt: localDateTimeToUtc(localDateAt(dueLocalDate, policy.dueTime), policy.timezone),
  };
}

export function parseRoutineScheduleBoundary(
  policyValue: unknown,
  value: string,
): Date | null {
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const policy = normalizeRoutineSchedulePolicy(policyValue);
    if (policy.cadence === "manual") return null;
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return localDateTimeToUtc(
      localDateAt({ year, month, day }, policy.localAnchor),
      policy.timezone,
    );
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function getRoutineScheduleWindowForInstant(
  policyValue: unknown,
  instant: Date,
): RoutineScheduleWindow | null {
  const policy = normalizeRoutineSchedulePolicy(policyValue);
  if (policy.cadence === "manual") return null;
  return windowFromStart(policy, currentWindowStartLocal(policy, instant));
}

export function getMostRecentDueRoutineScheduleWindow(
  policyValue: unknown,
  now: Date,
): RoutineScheduleWindow | null {
  const policy = normalizeRoutineSchedulePolicy(policyValue);
  if (policy.cadence === "manual") return null;
  const currentStart = currentWindowStartLocal(policy, now);
  const previousStart = addCadence(currentStart, policy.cadence, -1);
  const previousWindow = windowFromStart(policy, previousStart);
  if (previousWindow.dueAt.getTime() <= now.getTime()) return previousWindow;
  return windowFromStart(policy, addCadence(previousStart, policy.cadence, -1));
}

export function getNextDueRoutineScheduleWindow(
  policyValue: unknown,
  now: Date,
): RoutineScheduleWindow | null {
  const policy = normalizeRoutineSchedulePolicy(policyValue);
  if (policy.cadence === "manual") return null;
  let start = currentWindowStartLocal(policy, now);
  for (let index = 0; index < 400; index += 1) {
    const window = windowFromStart(policy, start);
    if (window.dueAt.getTime() > now.getTime()) return window;
    start = addCadence(start, policy.cadence, 1);
  }
  return null;
}

export function buildRoutineScheduleIdempotencyKey(input: {
  routineId: string;
  window: RoutineScheduleWindow;
}): string {
  return [
    "routine",
    input.routineId,
    "schedule-window",
    input.window.cadence,
    input.window.timezone,
    input.window.periodKey,
    input.window.windowStart.toISOString(),
    input.window.windowEnd.toISOString(),
  ].join(":");
}

export function evaluateDueRoutineRun(input: {
  routineId: string;
  routineStatus: string;
  schedulePolicy: unknown;
  now: Date;
  hasActiveScheduledRun?: boolean;
  existingIdempotencyKeys?: ReadonlySet<string>;
}): DueRoutineRunDecision {
  if (input.routineStatus !== "active") {
    return { action: "disabled", reason: "routine is not active" };
  }
  const window = getMostRecentDueRoutineScheduleWindow(input.schedulePolicy, input.now);
  if (!window) return { action: "not_due", reason: "routine is manual-only" };
  if (window.dueAt.getTime() > input.now.getTime()) {
    return { action: "not_due", reason: "latest completed window is not due yet", window };
  }
  const idempotencyKey = buildRoutineScheduleIdempotencyKey({
    routineId: input.routineId,
    window,
  });
  if (input.existingIdempotencyKeys?.has(idempotencyKey)) {
    return {
      action: "duplicate",
      reason: "schedule window already has a run",
      window,
      idempotencyKey,
    };
  }
  if (input.hasActiveScheduledRun) {
    return {
      action: "blocked",
      reason: "routine already has an active scheduled or backfill run",
      window,
      idempotencyKey,
    };
  }
  return { action: "enqueue", window, idempotencyKey };
}

export function describeRoutineScheduleStatus(input: {
  routineId: string;
  routineStatus: string;
  schedulePolicy: unknown;
  now: Date;
  globalSchedulerEnabled?: boolean;
  hasActiveScheduledRun?: boolean;
  existingIdempotencyKeys?: ReadonlySet<string>;
}): RoutineScheduleStatus {
  const policy = normalizeRoutineSchedulePolicy(input.schedulePolicy);
  const globalSchedulerEnabled = input.globalSchedulerEnabled ?? false;
  const schedulerEnabled =
    isRecord(input.schedulePolicy) && input.schedulePolicy.schedulerEnabled === true;
  const currentWindow = getRoutineScheduleWindowForInstant(policy, input.now);
  const latestDueWindow = getMostRecentDueRoutineScheduleWindow(policy, input.now);
  const nextDueWindow = getNextDueRoutineScheduleWindow(policy, input.now);

  if (policy.cadence === "manual") {
    return {
      cadence: "manual",
      timezone: null,
      schedulerEnabled: false,
      globalSchedulerEnabled,
      runnable: false,
      currentWindow,
      latestDueWindow,
      nextDueWindow,
      decision: { action: "not_due", reason: "routine is manual-only" },
    };
  }
  if (!globalSchedulerEnabled) {
    return {
      cadence: policy.cadence,
      timezone: policy.timezone,
      schedulerEnabled,
      globalSchedulerEnabled,
      runnable: false,
      currentWindow,
      latestDueWindow,
      nextDueWindow,
      decision: { action: "disabled", reason: "global scheduler is disabled", window: latestDueWindow ?? undefined },
    };
  }
  if (!schedulerEnabled) {
    return {
      cadence: policy.cadence,
      timezone: policy.timezone,
      schedulerEnabled,
      globalSchedulerEnabled,
      runnable: false,
      currentWindow,
      latestDueWindow,
      nextDueWindow,
      decision: { action: "disabled", reason: "scheduler disabled for routine", window: latestDueWindow ?? undefined },
    };
  }

  const decision = evaluateDueRoutineRun({
    routineId: input.routineId,
    routineStatus: input.routineStatus,
    schedulePolicy: policy,
    now: input.now,
    hasActiveScheduledRun: input.hasActiveScheduledRun,
    existingIdempotencyKeys: input.existingIdempotencyKeys,
  });
  return {
    cadence: policy.cadence,
    timezone: policy.timezone,
    schedulerEnabled,
    globalSchedulerEnabled,
    runnable: decision.action === "enqueue",
    currentWindow,
    latestDueWindow,
    nextDueWindow,
    decision,
  };
}

export function previewBackfillRoutineScheduleWindows(input: {
  routineId: string;
  schedulePolicy: unknown;
  windowStart: Date;
  windowEnd: Date;
  maxWindowCount?: number;
}): {
  ok: boolean;
  windows: Array<RoutineScheduleWindow & { idempotencyKey: string }>;
  error?: string;
} {
  const policy = normalizeRoutineSchedulePolicy(input.schedulePolicy);
  if (policy.cadence === "manual") {
    return { ok: false, windows: [], error: "manual-only routines cannot be backfilled" };
  }
  if (input.windowEnd.getTime() <= input.windowStart.getTime()) {
    return { ok: false, windows: [], error: "windowEnd must be after windowStart" };
  }

  const firstWindow = getRoutineScheduleWindowForInstant(policy, input.windowStart);
  if (!firstWindow || firstWindow.windowStart.getTime() !== input.windowStart.getTime()) {
    return { ok: false, windows: [], error: "windowStart must align to the schedule window boundary" };
  }

  const requestedMaxWindowCount = input.maxWindowCount ?? policy.maxBackfillWindowCount;
  const maxWindowCount = Math.max(
    1,
    Math.min(requestedMaxWindowCount, policy.maxBackfillWindowCount),
  );
  const windows: Array<RoutineScheduleWindow & { idempotencyKey: string }> = [];
  let cursor = firstWindow;
  while (cursor.windowEnd.getTime() <= input.windowEnd.getTime()) {
    windows.push({
      ...cursor,
      idempotencyKey: buildRoutineScheduleIdempotencyKey({
        routineId: input.routineId,
        window: cursor,
      }),
    });
    if (windows.length > maxWindowCount) {
      return { ok: false, windows: [], error: "backfill window count exceeds policy limit" };
    }
    const nextWindow = getRoutineScheduleWindowForInstant(policy, cursor.windowEnd);
    if (!nextWindow || nextWindow.windowStart.getTime() !== cursor.windowEnd.getTime()) {
      return { ok: false, windows: [], error: "failed to advance schedule window" };
    }
    cursor = nextWindow;
  }

  if (cursor.windowStart.getTime() !== input.windowEnd.getTime()) {
    return { ok: false, windows: [], error: "windowEnd must align to the schedule window boundary" };
  }
  return { ok: true, windows };
}
