"use client";

// Inline renderer for tool results carrying `action: "switch_view"`.
// These are emitted by backend `show_pnl`, `show_expenses`, `show_balance_sheet`,
// `show_cash_flow`, `show_plan_vs_actual`, `show_accounts`, and `show_documents`
// tools (see app/api/chat/route.ts). The legacy chat panel side-effected a
// router.push; here we render a clickable chip instead so v2 is not coupled to
// dashboard-route navigation behavior.

import Link from "next/link";
import { useLocale } from "next-intl";
import { ArrowRightIcon } from "lucide-react";

import {
  buildDashboardHrefForView,
  DOCUMENTS_DASHBOARD_VIEWS,
  FINANCE_DASHBOARD_VIEWS,
  type DashboardView,
} from "@/lib/dashboard-navigation";
import { getAppCopy } from "@/lib/i18n/copy";

import { toText } from "@/app/assistant/_lib/normalizers";

const ALL_VIEWS: readonly DashboardView[] = [
  ...FINANCE_DASHBOARD_VIEWS,
  ...DOCUMENTS_DASHBOARD_VIEWS,
];

function isDashboardView(value: string): value is DashboardView {
  return (ALL_VIEWS as readonly string[]).includes(value);
}

export interface NavigationHintProps {
  result: Record<string, unknown>;
}

export function NavigationHint({ result }: NavigationHintProps) {
  const locale = useLocale();
  const copy = getAppCopy(locale).chat.v2.tool.navigation;

  const view = toText(result.view);
  if (!view || !isDashboardView(view)) return null;

  // Prefer an explicit backend-provided route; otherwise derive from the view.
  const explicitRoute = toText(result.route);
  const href = explicitRoute
    ? buildExplicitHref(explicitRoute, view)
    : buildDashboardHrefForView(view);

  const label = copy.viewLabels[view] ?? view;

  return (
    <div className="my-1.5">
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
      >
        <span>{copy.openPrefix}</span>
        <span>{label}</span>
        <ArrowRightIcon className="size-3" aria-hidden />
      </Link>
    </div>
  );
}

// Mirrors dashboard/_components/chat-panel.tsx ~line 1884: when backend supplies
// an explicit route we reproduce its query-param behavior.
function buildExplicitHref(route: string, view: string): string {
  if (route === "/dashboard") {
    return `${route}?view=${encodeURIComponent(view)}`;
  }
  if (route === "/documents" && view !== "documents") {
    return `${route}?view=${encodeURIComponent(view)}`;
  }
  return route;
}
