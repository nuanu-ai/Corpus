"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildDashboardHrefForView,
  isDocumentsDashboardView,
  isFinanceDashboardView,
  type FinanceDashboardView,
} from "@/lib/dashboard-navigation";
import { getAppCopy } from "@/lib/i18n/copy";
import { useCFOStore } from "@/lib/store";
import { AccountsView } from "./accounts-view";
import { BalanceSheetView } from "./balance-sheet-view";
import { BankBalancesView } from "./bank-balances-view";
import { CashFlowView } from "./cash-flow-view";
import { CommitmentsView } from "./commitments-view";
import { DashboardPeriodSelector, useDashboardMonths } from "./dashboard-period-selector";
import { ExpensesView } from "./expenses-view";
import { PlanVsActualView } from "./plan-vs-actual-view";
import { PnLView } from "./pnl-view";

function getDashboardHelperCopy(
  locale: string,
  view: FinanceDashboardView,
): string {
  if (view === "commitments") {
    if (locale === "ru") {
      return "Открытые обещания и дедлайны строятся из уже подключённых Telegram чатов и communication signals.";
    }
    if (locale === "id") {
      return "Janji terbuka dan deadline dibangun dari chat Telegram yang sudah terhubung dan communication signals.";
    }
    return "Open promises and deadlines are built from the already connected Telegram chats and communication signals.";
  }
  if (view === "bank-balances") {
    if (locale === "ru") {
      return "Последний загруженный bank balance snapshot из Company-DB. Период дашборда на него не влияет.";
    }
    if (locale === "id") {
      return "Snapshot bank balance terbaru dari Company-DB. Periode dashboard tidak memengaruhinya.";
    }
    return "Latest uploaded bank balance snapshot from Company-DB. Dashboard period does not affect it.";
  }
  if (locale === "ru") {
    return "Период меняет графики и summary по выбранному окну. Live account balances остаются snapshot-видом.";
  }
  if (locale === "id") {
    return "Periode mengubah grafik dan ringkasan jendela terpilih. Saldo akun live tetap berupa snapshot.";
  }
  return "Period changes trend charts and selected-window summaries. Live account balances remain snapshot-based.";
}

export function FinanceDashboardTabs() {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = getAppCopy(locale).dashboard.tabs;
  const activeFinanceDashboardView = useCFOStore((s) => s.activeFinanceDashboardView);
  const setActiveFinanceDashboardView = useCFOStore((s) => s.setActiveFinanceDashboardView);
  const months = useDashboardMonths();

  const tabs: { value: FinanceDashboardView; label: string }[] = [
    { value: "pnl", label: copy.pnl },
    { value: "balance-sheet", label: copy.balanceSheet },
    { value: "cash-flow", label: copy.cashFlow },
    { value: "plan-vs-actual", label: copy.planVsActual },
    { value: "expenses", label: copy.expenses },
    { value: "accounts", label: copy.accounts },
    { value: "bank-balances", label: copy.bankBalances },
    { value: "commitments", label: copy.commitments },
  ];

  useEffect(() => {
    const requestedView = searchParams.get("view");
    if (!requestedView) return;

    if (isDocumentsDashboardView(requestedView)) {
      const params = new URLSearchParams();
      if (requestedView !== "documents") {
        params.set("view", requestedView);
      }
      const doc = searchParams.get("doc");
      if (doc) params.set("doc", doc);
      router.replace(
        `/documents${params.toString() ? `?${params.toString()}` : ""}${doc ? "#document-questions" : ""}`,
      );
      return;
    }

    if (
      isFinanceDashboardView(requestedView) &&
      requestedView !== activeFinanceDashboardView
    ) {
      setActiveFinanceDashboardView(requestedView);
    }
  }, [activeFinanceDashboardView, router, searchParams, setActiveFinanceDashboardView]);

  return (
    <Tabs
      value={activeFinanceDashboardView}
      onValueChange={(value) => {
        const nextView = value as FinanceDashboardView;
        setActiveFinanceDashboardView(nextView);
        router.replace(buildDashboardHrefForView(nextView, months), { scroll: false });
      }}
    >
      <div className="space-y-3">
        {activeFinanceDashboardView !== "commitments" && activeFinanceDashboardView !== "bank-balances" ? (
          <div className="flex justify-end">
            <DashboardPeriodSelector />
          </div>
        ) : null}
        <p className="text-right text-xs text-muted-foreground">
          {getDashboardHelperCopy(locale, activeFinanceDashboardView)}
        </p>

        <TabsList className="grid !h-auto w-full grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-8 min-w-0 text-xs sm:text-sm"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="pnl" className="animate-in fade-in-0 duration-200">
        <PnLView />
      </TabsContent>
      <TabsContent value="balance-sheet" className="animate-in fade-in-0 duration-200">
        <BalanceSheetView />
      </TabsContent>
      <TabsContent value="cash-flow" className="animate-in fade-in-0 duration-200">
        <CashFlowView />
      </TabsContent>
      <TabsContent value="plan-vs-actual" className="animate-in fade-in-0 duration-200">
        <PlanVsActualView />
      </TabsContent>
      <TabsContent value="expenses" className="animate-in fade-in-0 duration-200">
        <ExpensesView />
      </TabsContent>
      <TabsContent value="accounts" className="animate-in fade-in-0 duration-200">
        <AccountsView />
      </TabsContent>
      <TabsContent value="bank-balances" className="animate-in fade-in-0 duration-200">
        <BankBalancesView />
      </TabsContent>
      <TabsContent value="commitments" className="animate-in fade-in-0 duration-200">
        <CommitmentsView />
      </TabsContent>
    </Tabs>
  );
}
