const DEFAULT_TIME_ZONE = "UTC";

const EN_MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const RU_MONTHS: Record<string, number> = {
  января: 1,
  январь: 1,
  февраля: 2,
  февраль: 2,
  марта: 3,
  март: 3,
  апреля: 4,
  апрель: 4,
  мая: 5,
  май: 5,
  июня: 6,
  июнь: 6,
  июля: 7,
  июль: 7,
  августа: 8,
  август: 8,
  сентября: 9,
  сентябрь: 9,
  октября: 10,
  октябрь: 10,
  ноября: 11,
  ноябрь: 11,
  декабря: 12,
  декабрь: 12,
};

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const WEEKDAY_ALIASES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  воскресенье: 0,
  понедельник: 1,
  monday: 1,
  mon: 1,
  вторник: 2,
  tuesday: 2,
  tue: 2,
  tues: 2,
  среда: 3,
  wednesday: 3,
  wed: 3,
  четверг: 4,
  thursday: 4,
  thu: 4,
  thurs: 4,
  пятница: 5,
  friday: 5,
  fri: 5,
  суббота: 6,
  saturday: 6,
  sat: 6,
};

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

export type ResolvedBusinessDate = {
  expression: string;
  timeZone: string;
  today: string;
  kind: "date" | "range";
  startDate: string;
  endDate: string;
  dayOfWeek?: string;
  label: string;
  warnings: string[];
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toIsoDate(parts: LocalDateParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function parseIsoDate(date: string): LocalDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function utcDate(parts: LocalDateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function addDays(parts: LocalDateParts, days: number): LocalDateParts {
  const date = utcDate(parts);
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function dayOfWeek(parts: LocalDateParts): number {
  return utcDate(parts).getUTCDay();
}

function localDateInTimeZone(now: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);

  return { year, month, day };
}

function buildDateResult(input: {
  expression: string;
  timeZone: string;
  today: LocalDateParts;
  date: LocalDateParts;
  label: string;
  warnings?: string[];
}): ResolvedBusinessDate {
  return {
    expression: input.expression,
    timeZone: input.timeZone,
    today: toIsoDate(input.today),
    kind: "date",
    startDate: toIsoDate(input.date),
    endDate: toIsoDate(input.date),
    dayOfWeek: WEEKDAY_LABELS[dayOfWeek(input.date)],
    label: input.label,
    warnings: input.warnings ?? [],
  };
}

function buildRangeResult(input: {
  expression: string;
  timeZone: string;
  today: LocalDateParts;
  startDate: LocalDateParts;
  endDate: LocalDateParts;
  label: string;
  warnings?: string[];
}): ResolvedBusinessDate {
  return {
    expression: input.expression,
    timeZone: input.timeZone,
    today: toIsoDate(input.today),
    kind: "range",
    startDate: toIsoDate(input.startDate),
    endDate: toIsoDate(input.endDate),
    label: input.label,
    warnings: input.warnings ?? [],
  };
}

function findExplicitWeekday(expression: string): number | null {
  const normalized = expression.toLowerCase();
  for (const [label, weekday] of Object.entries(WEEKDAY_ALIASES)) {
    if (new RegExp(`(^|[^\\p{L}])${label}([^\\p{L}]|$)`, "iu").test(normalized)) {
      return weekday;
    }
  }
  return null;
}

function hasWordPhrase(expression: string, phrase: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${phrase}(?=$|[^\\p{L}\\p{N}])`, "iu").test(
    expression,
  );
}

function weekdayMismatchWarnings(expression: string, date: LocalDateParts): string[] {
  const stated = findExplicitWeekday(expression);
  if (stated === null) return [];
  const actual = dayOfWeek(date);
  if (stated === actual) return [];
  return [
    `weekday_mismatch: expression states ${WEEKDAY_LABELS[stated]}, but ${toIsoDate(date)} is ${WEEKDAY_LABELS[actual]}`,
  ];
}

function parseAbsoluteDate(expression: string, defaultYear: number): LocalDateParts | null {
  const normalized = expression.trim();
  const iso = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return parseIsoDate(iso[1]!);

  const dayMonthYear = normalized.match(
    /(^|[^\p{L}\p{N}])(\d{1,2})[.\s-]+([A-Za-zА-Яа-яёЁ]+)[,\s-]+(\d{4})(?=$|[^\p{L}\p{N}])/u,
  );
  if (dayMonthYear) {
    const monthName = dayMonthYear[3]!.toLowerCase();
    const month = EN_MONTHS[monthName] ?? RU_MONTHS[monthName];
    if (month) {
      return {
        day: Number(dayMonthYear[2]),
        month,
        year: Number(dayMonthYear[4]),
      };
    }
  }

  const monthDayYear = normalized.match(
    /\b([A-Za-z]+)[\s-]+(\d{1,2})(?:st|nd|rd|th)?[,\s-]+(\d{4})\b/i,
  );
  if (monthDayYear) {
    const month = EN_MONTHS[monthDayYear[1]!.toLowerCase()];
    if (month) {
      return {
        month,
        day: Number(monthDayYear[2]),
        year: Number(monthDayYear[3]),
      };
    }
  }

  const dotted = normalized.match(/\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})\b/);
  if (dotted) {
    return {
      day: Number(dotted[1]),
      month: Number(dotted[2]),
      year: Number(dotted[3]),
    };
  }

  const dayMonthWithoutYear = normalized.match(
    /(^|[^\p{L}\p{N}])(\d{1,2})[.\s-]+([A-Za-zА-Яа-яёЁ]+)(?=$|[^\p{L}\p{N}])/u,
  );
  if (dayMonthWithoutYear) {
    const monthName = dayMonthWithoutYear[3]!.toLowerCase();
    const month = EN_MONTHS[monthName] ?? RU_MONTHS[monthName];
    if (month) {
      return {
        day: Number(dayMonthWithoutYear[2]),
        month,
        year: defaultYear,
      };
    }
  }

  return null;
}

function resolveLastWeekday(today: LocalDateParts, targetWeekday: number): LocalDateParts {
  const current = dayOfWeek(today);
  let delta = current - targetWeekday;
  if (delta <= 0) delta += 7;
  return addDays(today, -delta);
}

export function resolveBusinessDateExpression(input: {
  expression: string;
  now?: Date;
  timeZone?: string;
}): ResolvedBusinessDate {
  const expression = input.expression.trim();
  const timeZone = input.timeZone?.trim() || DEFAULT_TIME_ZONE;
  const today = localDateInTimeZone(input.now ?? new Date(), timeZone);
  const normalized = expression.toLowerCase();

  const absoluteDate = parseAbsoluteDate(expression, today.year);
  if (absoluteDate) {
    return buildDateResult({
      expression,
      timeZone,
      today,
      date: absoluteDate,
      label: "absolute date",
      warnings: weekdayMismatchWarnings(expression, absoluteDate),
    });
  }

  if (hasWordPhrase(normalized, "(?:yesterday|вчера)")) {
    const date = addDays(today, -1);
    return buildDateResult({
      expression,
      timeZone,
      today,
      date,
      label: "yesterday",
    });
  }

  if (hasWordPhrase(normalized, "(?:today|сегодня)")) {
    return buildDateResult({
      expression,
      timeZone,
      today,
      date: today,
      label: "today",
    });
  }

  if (hasWordPhrase(normalized, "(?:tomorrow|завтра)")) {
    const date = addDays(today, 1);
    return buildDateResult({
      expression,
      timeZone,
      today,
      date,
      label: "tomorrow",
    });
  }

  const lastWeekdayMatch = normalized.match(
    /(?:^|[^\p{L}\p{N}])(?:last|прошл(?:ый|ую|ая|ое))\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?=$|[^\p{L}\p{N}])/u,
  );
  if (lastWeekdayMatch) {
    const target = WEEKDAY_ALIASES[lastWeekdayMatch[1]!.toLowerCase()];
    if (target !== undefined) {
      const date = resolveLastWeekday(today, target);
      return buildDateResult({
        expression,
        timeZone,
        today,
        date,
        label: `last ${WEEKDAY_LABELS[target]}`,
      });
    }
  }

  if (hasWordPhrase(normalized, "(?:last week|прошл(?:ая|ую)\\s+недел[\\p{L}]*)")) {
    const currentDow = dayOfWeek(today);
    const daysSinceMonday = (currentDow + 6) % 7;
    const currentWeekStart = addDays(today, -daysSinceMonday);
    const startDate = addDays(currentWeekStart, -7);
    const endDate = addDays(currentWeekStart, -1);
    return buildRangeResult({
      expression,
      timeZone,
      today,
      startDate,
      endDate,
      label: "previous completed calendar week (Monday-Sunday)",
    });
  }

  return buildDateResult({
    expression,
    timeZone,
    today,
    date: today,
    label: "unresolved expression; defaulted to today",
    warnings: ["unresolved_date_expression"],
  });
}
