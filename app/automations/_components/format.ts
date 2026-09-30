const AUTOMATION_UI_LOCALE = "en-US";

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(AUTOMATION_UI_LOCALE, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(AUTOMATION_UI_LOCALE, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatExclusiveEndDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  const isUtcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  return formatDate(new Date(date.getTime() - (isUtcMidnight ? 24 * 60 * 60 * 1000 : 0)).toISOString());
}

export function isRoutineSourceUnhealthy(source: {
  status: string;
  lastError?: string | null;
}) {
  return source.status === "broken" || (source.status === "active" && Boolean(source.lastError));
}

export function canRunRoutineNow(status: string | null | undefined) {
  return status === "active" || status === "paused";
}

export function compactId(value: string | null | undefined) {
  if (!value) return "none";
  return value.length > 12 ? `${value.slice(0, 7)}...${value.slice(-4)}` : value;
}

export function labelize(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ");
}

export function countRecordValue(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" ? value : 0;
}
