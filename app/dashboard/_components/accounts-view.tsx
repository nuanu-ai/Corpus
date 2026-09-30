"use client";

import { useLocale } from "next-intl";
import { BarChart3, Building2, CreditCard, Wallet } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveDisplayCurrency } from "@/lib/finance/display-currency";
import { useAccountsData, useFinancialOverviewData, hasData } from "@/lib/hooks/use-financial-data";
import { EmptyState } from "./empty-state";
import {
  formatLiveSnapshotHint,
  FinancialIndicatorGrid,
  FinancialOverviewMeta,
  type FinancialIndicatorItem,
  formatFinancialAmount,
  formatFinancialAxis,
  formatFinancialCompactAmount,
} from "./financial-overview-ui";
import { ViewSkeleton } from "./view-skeleton";

interface AccountRow {
  connectionId: string | null;
  provider: string;
  currency: string;
  balance: number;
  nativeBalance?: number | null;
  balanceUsd?: number | null;
  reportingCurrency?: string | null;
  reportingRate?: number | null;
  reportingBalance?: number | null;
  lastSyncAt: string | null;
}

const providerIcons: Record<string, React.ElementType> = {
  stripe: CreditCard,
  mercury: Building2,
  plaid: Building2,
};

function formatSyncDate(dateStr: string | null): string {
  if (!dateStr) return "Never synced";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAccountBalance(balance: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(balance);
}

function getReportingBalance(account: AccountRow, reportingCurrency: string): number | null {
  if (typeof account.reportingBalance === "number" && Number.isFinite(account.reportingBalance)) {
    return account.reportingBalance;
  }

  if (account.currency === reportingCurrency) {
    return account.balance;
  }

  return null;
}

export function AccountsView() {
  const locale = useLocale();
  const { data: accountData, isLoading: isLoadingAccounts } = useAccountsData();
  const { data: overview, isLoading: isLoadingOverview } = useFinancialOverviewData({ months: 60 });

  if (isLoadingAccounts || isLoadingOverview) {
    return <ViewSkeleton variant="list" />;
  }

  const accounts = hasData(accountData) ? (accountData as AccountRow[]) : [];
  const hasAccounts = accounts.length > 0;
  const hasRecordedLiquidity =
    (overview?.cash.cashPosition ?? null) !== null ||
    (overview?.balanceSheet.cashAndEquivalents ?? null) !== null;

  if (!hasAccounts && (!overview || overview.mode === "no-finance-data" || !hasRecordedLiquidity)) {
    return (
      <EmptyState
        icon={Building2}
        title="No accounts connected"
        description="Connect a bank account, payment processor, or crypto wallet to see live balances here."
        actionLabel="Connect an account"
        actionHref="/integrations"
      />
    );
  }

  const currency = resolveDisplayCurrency({
    overviewCurrency: overview?.currency,
    accounts,
  });
  const currencyTotals = accounts.reduce((map, account) => {
    const key = account.currency || "Unknown";
    const current = map.get(key) ?? { balance: 0, count: 0 };
    current.balance += account.balance;
    current.count += 1;
    map.set(key, current);
    return map;
  }, new Map<string, { balance: number; count: number }>());
  const sortedAccounts = [...accounts].sort((left, right) => {
    const rightBalance = getReportingBalance(right, currency) ?? right.balance;
    const leftBalance = getReportingBalance(left, currency) ?? left.balance;
    return Math.abs(rightBalance) - Math.abs(leftBalance);
  });
  const providerTotals = Array.from(
    accounts.reduce((map, account) => {
      const providerKey = account.provider.toLowerCase();
      const current = map.get(providerKey) ?? {
        provider: account.provider,
        balance: 0,
      };
      current.balance += getReportingBalance(account, currency) ?? 0;
      map.set(providerKey, current);
      return map;
    }, new Map<string, { provider: string; balance: number }>()).values(),
  ).sort((left, right) => Math.abs(right.balance) - Math.abs(left.balance));
  const recordedCashPosition =
    overview?.balanceSheet.cashAndEquivalents ??
    overview?.cash.cashPosition ??
    null;
  const visibleBalanceTotal = accounts.reduce(
    (sum, account) => sum + (getReportingBalance(account, currency) ?? 0),
    0,
  );
  const excludedFromReportingCount = accounts.filter(
    (account) =>
      account.currency !== currency &&
      getReportingBalance(account, currency) === null,
  ).length;
  const keyIndicators: FinancialIndicatorItem[] = hasAccounts
    ? [
        {
          label: "Visible balances",
          value: formatFinancialCompactAmount(visibleBalanceTotal, currency, locale),
          hint:
            excludedFromReportingCount > 0
              ? `${formatLiveSnapshotHint(locale)} · ${excludedFromReportingCount} account${excludedFromReportingCount === 1 ? "" : "s"} excluded from ${currency} totals until FX rates are available`
              : formatLiveSnapshotHint(locale),
        },
        {
          label: "Recorded finance cash",
          value: formatFinancialCompactAmount(recordedCashPosition, currency, locale),
          hint: "Latest verified canonical statement cash",
        },
        {
          label: "Top provider",
          value: providerTotals[0]?.provider ?? "--",
          hint: providerTotals[0]
            ? formatFinancialCompactAmount(providerTotals[0].balance, currency, locale)
            : formatLiveSnapshotHint(locale),
        },
        {
          label: "Largest account",
          value: sortedAccounts[0]
            ? formatAccountBalance(
                getReportingBalance(sortedAccounts[0], currency) ?? sortedAccounts[0].balance,
                getReportingBalance(sortedAccounts[0], currency) === null
                  ? sortedAccounts[0].currency
                  : currency,
                locale,
              )
            : "--",
          hint: sortedAccounts[0]
            ? `${sortedAccounts[0].provider} • ${formatAccountBalance(
                sortedAccounts[0].balance,
                sortedAccounts[0].currency,
                locale,
              )}`
            : formatLiveSnapshotHint(locale),
        },
        {
          label: "Active currencies",
          value: String(currencyTotals.size),
          hint: formatLiveSnapshotHint(locale),
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      {overview ? <FinancialOverviewMeta overview={overview} /> : null}

      {!hasAccounts && recordedCashPosition !== null ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              No live accounts connected
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p
              className="text-3xl font-bold text-foreground"
              title={formatFinancialAmount(recordedCashPosition, currency, locale)}
            >
              {formatFinancialCompactAmount(recordedCashPosition, currency, locale)}
            </p>
            <p className="text-sm text-muted-foreground">
              Showing the latest recorded cash position from verified finance statements until live account integrations are connected.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {hasAccounts ? (
        <>
          <Card className="border-dashed">
            <CardContent className="py-4 text-sm text-muted-foreground">
              Live accounts stay on a live snapshot. The dashboard period selector affects finance statement trends and selected-window summaries, not connected account balances.
            </CardContent>
          </Card>

          {excludedFromReportingCount > 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-4 text-sm text-muted-foreground">
                {excludedFromReportingCount} cross-currency account{excludedFromReportingCount === 1 ? "" : "s"} are excluded from {currency} totals until FX rates are available.
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Connected accounts
                </CardTitle>
                <p className="text-2xl font-bold text-foreground">{accounts.length}</p>
                <p className="text-xs text-muted-foreground">{formatLiveSnapshotHint(locale)}</p>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Active currencies
                </CardTitle>
                <p className="text-2xl font-bold text-foreground">{currencyTotals.size}</p>
                <p className="text-xs text-muted-foreground">{formatLiveSnapshotHint(locale)}</p>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Largest balance
                </CardTitle>
                <p
                  className="text-2xl font-bold text-foreground"
                  title={
                    sortedAccounts[0]
                      ? formatAccountBalance(
                          getReportingBalance(sortedAccounts[0], currency) ?? sortedAccounts[0].balance,
                          getReportingBalance(sortedAccounts[0], currency) === null
                            ? sortedAccounts[0].currency
                            : currency,
                          locale,
                        )
                      : "--"
                  }
                >
                  {sortedAccounts[0]
                    ? formatAccountBalance(
                        getReportingBalance(sortedAccounts[0], currency) ?? sortedAccounts[0].balance,
                        getReportingBalance(sortedAccounts[0], currency) === null
                          ? sortedAccounts[0].currency
                          : currency,
                        locale,
                      )
                    : "--"}
                </p>
                {sortedAccounts[0] ? (
                  <p className="text-xs capitalize text-muted-foreground">
                    {sortedAccounts[0].provider} •{" "}
                    {formatAccountBalance(sortedAccounts[0].balance, sortedAccounts[0].currency, locale)}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">{formatLiveSnapshotHint(locale)}</p>
              </CardHeader>
            </Card>
          </div>

          {providerTotals.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Balance distribution by provider
                </CardTitle>
                <p className="text-xs text-muted-foreground">{formatLiveSnapshotHint(locale)}</p>
              </CardHeader>
              <CardContent>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={providerTotals}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.5} />
                      <XAxis
                        dataKey="provider"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tickFormatter={(value) => formatFinancialAxis(Number(value), currency, locale)}
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                        width={72}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "1px solid #1e293b",
                          borderRadius: "8px",
                          fontSize: 12,
                          color: "#e2e8f0",
                        }}
                        formatter={(value) => [
                          formatFinancialAmount(
                            typeof value === "number" ? value : Number(value ?? 0),
                            currency,
                            locale,
                          ),
                        ]}
                      />
                      <Bar dataKey="balance" name="Balance" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <FinancialIndicatorGrid title="Key indicators" items={keyIndicators} />

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from(currencyTotals.entries()).map(([accountCurrency, stats]) => (
              <Card key={accountCurrency}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {accountCurrency} balance
                  </CardTitle>
                  <p className="text-2xl font-bold text-foreground">
                    {formatAccountBalance(stats.balance, accountCurrency, locale)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {stats.count} account{stats.count === 1 ? "" : "s"}
                  </p>
                </CardHeader>
              </Card>
            ))}
          </div>

          <div className="grid gap-3">
            {sortedAccounts.map((account, index) => {
              const Icon = providerIcons[account.provider.toLowerCase()] || Wallet;
              return (
                <Card key={account.connectionId ?? `account-${index}`} className="py-4">
                  <CardContent className="flex items-center gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <Icon className="size-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium capitalize">
                          {account.provider}
                        </p>
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {account.currency}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatAccountBalance(account.balance, account.currency, locale)}
                      </p>
                      {getReportingBalance(account, currency) !== null && account.currency !== currency ? (
                        <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                          Reported as{" "}
                          {formatAccountBalance(getReportingBalance(account, currency) ?? 0, currency, locale)}
                        </p>
                      ) : null}
                      {getReportingBalance(account, currency) === null && account.currency !== currency ? (
                        <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                          Reporting equivalent unavailable until FX rate is available
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                        {formatSyncDate(account.lastSyncAt)}
                      </p>
                    </div>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatAccountBalance(account.balance, account.currency, locale)}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      ) : null}

      {!hasAccounts && recordedCashPosition === null ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <BarChart3 className="size-4" />
            No live account balances yet. Connect integrations to unlock provider-level account charts.
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
