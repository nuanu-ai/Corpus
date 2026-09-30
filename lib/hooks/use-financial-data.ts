"use client";

import { useState, useEffect, useCallback } from "react";
import {
  COMPANIES_CHANGED_EVENT,
  type CompaniesChangedDetail,
} from "@/lib/company-context";
import type { FinancialOverview } from "@/lib/queries/financial-overview";
import type { BankBalanceSnapshotResponse } from "@/lib/queries/bank-balance-snapshot";

interface UseFinancialDataResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Generic hook that fetches financial entities from /api/company/query.
 * Returns { data, isLoading, error, refetch }.
 *
 * The Company-DB query endpoint returns EntityResult[] directly.
 * Still useful for views that query Company-DB directly (metrics, tax).
 */
export function useFinancialData<T = unknown[]>(
  domain: string,
  type?: string,
  options?: { limit?: number; enabled?: boolean },
): UseFinancialDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasResolvedOnce, setHasResolvedOnce] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);

  const enabled = options?.enabled !== false;

  const refetch = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const params = new URLSearchParams();
    params.set("domain", domain);
    if (type) params.set("type", type);
    if (options?.limit) params.set("limit", String(options.limit));

    const run = async () => {
      setIsLoading(!hasResolvedOnce);
      setError(null);

      try {
        const res = await fetch(`/api/company/query?${params}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          // 401/403 means user is not authenticated or has no company - not an error state
          if (res.status === 401 || res.status === 403) {
            if (!cancelled) {
              setData(null);
              setHasResolvedOnce(true);
              setIsLoading(false);
            }
            return;
          }
          throw new Error(`Failed to fetch data (${res.status})`);
        }

        const json = await res.json();
        if (!cancelled) {
          setData(json as T);
          setHasResolvedOnce(true);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          // Network errors or Company-DB not running => treat as no data
          console.warn(
            `[useFinancialData] ${domain}/${type ?? "*"}:`,
            err instanceof Error ? err.message : String(err),
          );
          setData(null);
          setError(null); // Don't show error to user - just show empty state
          setHasResolvedOnce(true);
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [domain, type, options?.limit, enabled, fetchKey]);

  useEffect(() => {
    if (!enabled) return;

    const handleCompaniesChanged = (event: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as CompaniesChangedDetail | undefined)
          : undefined;
      if (detail?.activeCompanyId === undefined) return;
      setData(null);
      setError(null);
      setHasResolvedOnce(false);
      setIsLoading(true);
      setFetchKey((k) => k + 1);
    };

    window.addEventListener(COMPANIES_CHANGED_EVENT, handleCompaniesChanged);
    return () => {
      window.removeEventListener(
        COMPANIES_CHANGED_EVENT,
        handleCompaniesChanged,
      );
    };
  }, [enabled]);

  return {
    data,
    isLoading: enabled ? isLoading : false,
    error: enabled ? error : null,
    refetch,
  };
}

// ── Simple fetch hook for PG-backed API endpoints ──────────────────────

/**
 * Generic hook that fetches data from a given URL.
 * Used by the PG-backed financial hooks below.
 */
function useFetchData<T>(
  url: string,
  options?: { enabled?: boolean; refreshIntervalMs?: number },
): UseFinancialDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasResolvedOnce, setHasResolvedOnce] = useState(false);
  const [fetchKey, setFetchKey] = useState(0);

  const enabled = options?.enabled !== false;

  const refetch = useCallback(() => {
    setFetchKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const run = async () => {
      setIsLoading(!hasResolvedOnce);
      setError(null);

      try {
        const res = await fetch(url, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            if (!cancelled) {
              setData(null);
              setHasResolvedOnce(true);
              setIsLoading(false);
            }
            return;
          }
          throw new Error(`Failed to fetch data (${res.status})`);
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json as T);
          setHasResolvedOnce(true);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[useFetchData] ${url}:`, message);
          setData(null);
          setError(message);
          setHasResolvedOnce(true);
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [url, enabled, fetchKey]);

  useEffect(() => {
    if (!enabled) return;

    const handleCompaniesChanged = (event: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as CompaniesChangedDetail | undefined)
          : undefined;
      if (detail?.activeCompanyId === undefined) return;
      setData(null);
      setError(null);
      setHasResolvedOnce(false);
      setIsLoading(true);
      setFetchKey((k) => k + 1);
    };

    window.addEventListener(COMPANIES_CHANGED_EVENT, handleCompaniesChanged);
    return () => {
      window.removeEventListener(
        COMPANIES_CHANGED_EVENT,
        handleCompaniesChanged,
      );
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const refreshIntervalMs = options?.refreshIntervalMs;
    if (
      typeof refreshIntervalMs !== "number" ||
      !Number.isFinite(refreshIntervalMs) ||
      refreshIntervalMs <= 0
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setFetchKey((k) => k + 1);
    }, refreshIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, options?.refreshIntervalMs]);

  return {
    data,
    isLoading: enabled ? isLoading : false,
    error: enabled ? error : null,
    refetch,
  };
}

// ── PG-backed convenience hooks ────────────────────────────────────────

/**
 * Hook for P&L / income statement data.
 * Fetches from PG via /api/financial/pnl.
 */
export function usePnLData() {
  return useFetchData("/api/financial/pnl");
}

/**
 * Hook for accounts data.
 * Fetches from PG via /api/financial/accounts.
 */
export function useAccountsData() {
  return useFetchData("/api/financial/accounts");
}

/**
 * Hook for CFO uploaded bank balance snapshots.
 * Fetches the latest Company-DB bank_balance_snapshot.
 */
export function useBankBalancesData() {
  return useFetchData<BankBalanceSnapshotResponse>("/api/financial/bank-balances");
}

/**
 * Hook for expense data.
 * Fetches from PG via /api/financial/expenses.
 */
export function useExpensesData() {
  return useFetchData("/api/financial/expenses");
}

/**
 * Hook for cash flow data.
 * Fetches from PG via /api/financial/cash-flow.
 */
export function useCashFlowData() {
  return useFetchData("/api/financial/cash-flow");
}

/**
 * Hook for unified financial dashboard overview.
 * Uses finance-first sourcing with Company-DB summaries and PG fallbacks.
 */
export function useFinancialOverviewData(options?: {
  months?: number;
  enabled?: boolean;
  refreshIntervalMs?: number;
}) {
  const months =
    typeof options?.months === "number" && Number.isFinite(options.months)
      ? Math.min(Math.max(Math.trunc(options.months), 1), 60)
      : 24;

  return useFetchData<FinancialOverview>(
    `/api/financial/overview?months=${months}`,
    {
      enabled: options?.enabled,
      refreshIntervalMs: options?.refreshIntervalMs,
    },
  );
}

/**
 * Hook for documents data.
 * Fetches from PG via /api/documents.
 */
export function useDocumentsData(options?: {
  refreshIntervalMs?: number;
  limit?: number;
  enabled?: boolean;
}) {
  const limit =
    typeof options?.limit === "number" && Number.isFinite(options.limit)
      ? Math.min(Math.max(Math.trunc(options.limit), 1), 200)
      : 200;

  return useFetchData(`/api/documents?limit=${limit}&attentionFirst=1`, {
    enabled: options?.enabled,
    refreshIntervalMs: options?.refreshIntervalMs,
  });
}

export interface PersonAction {
  id: string;
  kind: "manual" | "pending_signal";
  title: string;
  summary: string;
  sourceLabel?: string | null;
  targetDomain?: string | null;
}

export interface PersonProfile {
  qualifiedId: string;
  filePath: string;
  profileKind: "contact" | "organization";
  crmStatus: "active" | "archived" | "merged";
  mergedInto: string | null;
  name: string;
  displayName: string | null;
  role: string | null;
  organization: string | null;
  relatedCompanies: string[];
  analysisContext: string | null;
  observedChannels: Record<string, string>;
  crmChannels: Record<string, string>;
  channels: Record<string, string>;
  tags: string[];
  domains: string[];
  lastInteraction: string | null;
  interactionCount: number | null;
  confidence: number | null;
  sourceMessageCount: number;
  autoDescription: string | null;
  manualDescription: string | null;
  manualActionRequired: boolean;
  manualNextAction: string | null;
  description: string | null;
  actionRequired: boolean;
  nextAction: string | null;
  owner: string | null;
  actions: PersonAction[];
}

export interface PeopleResponse {
  data: PersonProfile[];
  count: number;
  actionCount: number;
  pendingSignalCount: number;
  resourceCount: number;
}

export function usePeopleData() {
  return useFetchData<PeopleResponse>("/api/people");
}

/**
 * Hook for notifications data.
 * Fetches from PG via /api/notifications.
 */
export function useNotificationsData() {
  return useFetchData<Notification[]>("/api/notifications");
}

export interface Notification {
  id: string;
  companyId: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  connectionId: string | null;
  isRead: boolean;
  emailSentAt: string | null;
  followUpSentAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

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
  status: "open" | "completed" | "cancelled";
  escalationLevel: "l1" | "l2" | "l3" | null;
  resolvedAt: string | null;
  resolutionKind: "completion" | "cancellation" | null;
  resolutionSummary: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DashboardCommitmentsResponse {
  data: DashboardCommitmentItem[];
  count: number;
  telegramConnected: boolean;
  enabledChatCount: number;
  generatedAt: string;
}

// ── Company-DB backed hooks (domains not yet available) ────────────────

/**
 * Hook for metrics data.
 * Metrics domain doesn't exist in Company-DB yet — returns null.
 */
export function useMetricsData() {
  return useFinancialData("finance", "metrics", { enabled: false });
}

/**
 * Hook for tax data.
 * Tax domain doesn't exist in Company-DB yet — returns null.
 */
export function useTaxData() {
  return useFinancialData("finance", "tax", { enabled: false });
}

export function useDashboardCommitmentsData() {
  return useFetchData<DashboardCommitmentsResponse>(
    "/api/dashboard/commitments",
    {
      refreshIntervalMs: 60_000,
    },
  );
}

/**
 * Helper to check if data is present and non-empty array.
 */
export function hasData(data: unknown): boolean {
  if (Array.isArray(data)) return data.length > 0;
  if (data && typeof data === "object") {
    const keys = Object.keys(data);
    if (keys.length === 0) return false;
    // If all values are numeric and all zero, treat as no data
    const values = Object.values(data as Record<string, unknown>);
    const allNumeric = values.every((v) => typeof v === "number");
    if (allNumeric && values.every((v) => v === 0)) return false;
    return true;
  }
  return false;
}
