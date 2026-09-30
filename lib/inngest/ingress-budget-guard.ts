const DEFAULT_NON_FINANCIAL_DAILY_CAP = 200;
const MIN_NON_FINANCIAL_DAILY_CAP = 0;
const MAX_NON_FINANCIAL_DAILY_CAP = 100000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parsePositiveInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

export interface IngressBudgetGuardSettings {
  nonFinancialDailyCap: number;
}

export const INGRESS_BUDGET_CONSUMING_DOCUMENT_STATUSES = [
  "completed",
  "needs_review",
] as const;

export function isIngressBudgetConsumingDocumentStatus(status: string): boolean {
  return (INGRESS_BUDGET_CONSUMING_DOCUMENT_STATUSES as readonly string[]).includes(status);
}

export function resolveIngressBudgetGuardSettings(
  env: NodeJS.ProcessEnv = process.env,
): IngressBudgetGuardSettings {
  return {
    nonFinancialDailyCap: parsePositiveInteger(
      env.INGEST_INGRESS_NON_FIN_DAILY_CAP,
      DEFAULT_NON_FINANCIAL_DAILY_CAP,
      MIN_NON_FINANCIAL_DAILY_CAP,
      MAX_NON_FINANCIAL_DAILY_CAP,
    ),
  };
}

export function utcDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
