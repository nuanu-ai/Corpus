"use client";

import { BalanceCard } from "./_components/balance-card";
import { FinanceDashboardTabs } from "./_components/finance-dashboard-tabs";

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Owner-grade finance views built from canonical statements, projections, and live account signals.
        </p>
      </div>

      <BalanceCard />
      <FinanceDashboardTabs />
    </div>
  );
}
