export const FINANCE_DASHBOARD_VIEWS = [
  "pnl",
  "balance-sheet",
  "cash-flow",
  "plan-vs-actual",
  "expenses",
  "accounts",
  "bank-balances",
  "commitments",
] as const;

export const DOCUMENTS_DASHBOARD_VIEWS = [
  "documents",
  "people",
  "agent-files",
] as const;

export type FinanceDashboardView = (typeof FINANCE_DASHBOARD_VIEWS)[number];
export type DocumentsDashboardView = (typeof DOCUMENTS_DASHBOARD_VIEWS)[number];
export type DashboardView = FinanceDashboardView | DocumentsDashboardView;
export type DashboardRoute = "/dashboard" | "/documents";

const FINANCE_DASHBOARD_VIEW_SET = new Set<string>(FINANCE_DASHBOARD_VIEWS);
const DOCUMENTS_DASHBOARD_VIEW_SET = new Set<string>(DOCUMENTS_DASHBOARD_VIEWS);

export const DEFAULT_FINANCE_DASHBOARD_VIEW: FinanceDashboardView = "pnl";
export const DEFAULT_DOCUMENTS_DASHBOARD_VIEW: DocumentsDashboardView = "documents";
export const DEFAULT_DASHBOARD_MONTHS = 24;

export function clampDashboardMonths(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_DASHBOARD_MONTHS;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DASHBOARD_MONTHS;
  return Math.min(Math.max(Math.trunc(parsed), 1), 60);
}

export function isFinanceDashboardView(value: string): value is FinanceDashboardView {
  return FINANCE_DASHBOARD_VIEW_SET.has(value);
}

export function isDocumentsDashboardView(value: string): value is DocumentsDashboardView {
  return DOCUMENTS_DASHBOARD_VIEW_SET.has(value);
}

export function getDashboardRouteForView(view: DashboardView): DashboardRoute {
  return isFinanceDashboardView(view) ? "/dashboard" : "/documents";
}

export function buildDashboardHrefForView(
  view: DashboardView,
  months?: string | number | null,
): string {
  const route = getDashboardRouteForView(view);
  const params = new URLSearchParams();

  if (route === "/dashboard") {
    if (view !== DEFAULT_FINANCE_DASHBOARD_VIEW) {
      params.set("view", view);
    }

    if (view !== "commitments" && view !== "bank-balances") {
      const normalizedMonths = clampDashboardMonths(months);
      if (normalizedMonths !== DEFAULT_DASHBOARD_MONTHS) {
        params.set("months", String(normalizedMonths));
      }
    }
  }

  if (route === "/documents" && view !== DEFAULT_DOCUMENTS_DASHBOARD_VIEW) {
    params.set("view", view);
  }

  const query = params.toString();
  return query ? `${route}?${query}` : route;
}
