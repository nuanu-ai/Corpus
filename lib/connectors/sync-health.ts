import { getConnectorExpectedSyncIntervalMs } from "@/lib/connectors/provider-registry";

export const DEFAULT_NEVER_SYNC_GRACE_MS = 60 * 60 * 1000;
export type ConnectionSyncFreshnessState =
  | "healthy"
  | "stale"
  | "never_synced"
  | "connected"
  | "on_demand";

export interface ConnectionSyncFreshnessDescriptor {
  state: ConnectionSyncFreshnessState;
  expectedIntervalMs: number | null;
  expectedIntervalLabel: string | null;
  lastSyncAgeLabel: string | null;
  createdAgeLabel: string | null;
  message: string;
}

function coerceTimestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function getExpectedSyncInterval(provider: string): number | null {
  return getConnectorExpectedSyncIntervalMs(provider);
}

export function formatExpectedSyncInterval(intervalMs: number): string {
  const minutes = Math.round(intervalMs / 60000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.round(hours / 24);
  return `${days}d`;
}

export function formatElapsedSyncWindow(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60000));
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.max(1, Math.round(minutes / 60));
  if (hours < 24) return `${hours}h`;

  const days = Math.max(1, Math.round(hours / 24));
  return `${days}d`;
}

export function isExpectedSyncStale(
  lastSyncAt: Date | string | null | undefined,
  expectedIntervalMs: number | null,
  now: Date = new Date(),
): boolean {
  if (expectedIntervalMs === null) return false;
  const lastSyncMs = coerceTimestamp(lastSyncAt);
  if (lastSyncMs === null) return false;
  return now.getTime() - lastSyncMs > expectedIntervalMs * 2;
}

export function shouldAlertNeverSynced(
  createdAt: Date | string | null | undefined,
  expectedIntervalMs: number | null,
  now: Date = new Date(),
  graceMs: number = DEFAULT_NEVER_SYNC_GRACE_MS,
): boolean {
  if (expectedIntervalMs === null) return false;
  const createdAtMs = coerceTimestamp(createdAt);
  if (createdAtMs === null) return false;
  return now.getTime() - createdAtMs > graceMs;
}

export function describeConnectionSyncFreshness(params: {
  provider: string;
  lastSyncAt: Date | string | null | undefined;
  createdAt: Date | string | null | undefined;
  expectedIntervalMs?: number | null;
  now?: Date;
}): ConnectionSyncFreshnessDescriptor {
  const now = params.now ?? new Date();
  const expectedIntervalMs =
    params.expectedIntervalMs === undefined
      ? getExpectedSyncInterval(params.provider)
      : params.expectedIntervalMs;
  const expectedIntervalLabel =
    expectedIntervalMs === null ? null : formatExpectedSyncInterval(expectedIntervalMs);
  const createdAtMs = coerceTimestamp(params.createdAt);
  const createdAgeLabel =
    createdAtMs === null ? null : `${formatElapsedSyncWindow(now.getTime() - createdAtMs)} ago`;

  if (!params.lastSyncAt) {
    if (shouldAlertNeverSynced(params.createdAt, expectedIntervalMs, now)) {
      return {
        state: "never_synced",
        expectedIntervalMs,
        expectedIntervalLabel,
        lastSyncAgeLabel: null,
        createdAgeLabel,
        message: expectedIntervalLabel
          ? `Never synced · expected every ${expectedIntervalLabel}`
          : "Never synced",
      };
    }

    return {
      state: expectedIntervalMs === null ? "on_demand" : "connected",
      expectedIntervalMs,
      expectedIntervalLabel,
      lastSyncAgeLabel: null,
      createdAgeLabel,
      message: createdAgeLabel ? `Connected ${createdAgeLabel}` : "Connected",
    };
  }

  const lastSyncMs = coerceTimestamp(params.lastSyncAt);
  const lastSyncAgeLabel =
    lastSyncMs === null ? null : `${formatElapsedSyncWindow(now.getTime() - lastSyncMs)} ago`;

  if (isExpectedSyncStale(params.lastSyncAt, expectedIntervalMs, now)) {
    return {
      state: "stale",
      expectedIntervalMs,
      expectedIntervalLabel,
      lastSyncAgeLabel,
      createdAgeLabel,
      message:
        lastSyncAgeLabel && expectedIntervalLabel
          ? `Stale · last sync ${lastSyncAgeLabel} · expected ${expectedIntervalLabel}`
          : "Stale",
    };
  }

  if (expectedIntervalMs === null) {
    return {
      state: "on_demand",
      expectedIntervalMs,
      expectedIntervalLabel,
      lastSyncAgeLabel,
      createdAgeLabel,
      message: lastSyncAgeLabel ? `Last sync ${lastSyncAgeLabel}` : "Last sync unavailable",
    };
  }

  return {
    state: "healthy",
    expectedIntervalMs,
    expectedIntervalLabel,
    lastSyncAgeLabel,
    createdAgeLabel,
    message: lastSyncAgeLabel ? `Synced ${lastSyncAgeLabel}` : "Synced recently",
  };
}
