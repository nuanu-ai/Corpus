"use client";

import { useLocale } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveDisplayCurrency } from "@/lib/finance/display-currency";
import { getAppCopy } from "@/lib/i18n/copy";
import { formatCurrency, pickPluralWord } from "@/lib/i18n/format";
import { useAccountsData, hasData, useFinancialOverviewData } from "@/lib/hooks/use-financial-data";
import { formatLiveSnapshotHint } from "./financial-overview-ui";

function BalanceCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-8 w-32" />
        <div className="flex gap-4 mt-1">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-2.5 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function BalanceCard() {
  const locale = useLocale();
  const copy = getAppCopy(locale).dashboard.balance;
  const { data, isLoading } = useAccountsData();
  const { data: overview, isLoading: isOverviewLoading } = useFinancialOverviewData({ months: 60 });

  if (isLoading || isOverviewLoading) {
    return <BalanceCardSkeleton />;
  }

  if (!hasData(data)) {
    const statementCash = overview?.cash.cashPosition ?? null;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground font-medium">
            {copy.title}
          </CardTitle>
          {statementCash !== null && overview ? (
            <>
              <p className="text-3xl font-bold tracking-tight">
                {formatCurrency(locale, statementCash, overview.currency)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Latest verified cash position from canonical statements
              </p>
              <p className="text-xs text-muted-foreground">
                Period selector does not change this fallback snapshot.
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold tracking-tight text-muted-foreground/50">
                --
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {copy.noData}
              </p>
            </>
          )}
        </CardHeader>
      </Card>
    );
  }

  // Use flat PG account rows
  const accounts = (data ?? []) as Array<{
    connectionId: string | null;
    provider: string;
    currency: string;
    balance: number;
    reportingCurrency?: string | null;
    reportingRate?: number | null;
    reportingBalance?: number | null;
    lastSyncAt: string | null;
  }>;

  const reportingCurrency = resolveDisplayCurrency({
    overviewCurrency: overview?.currency,
    accounts,
  });
  const excludedFromReportingCount = accounts.filter(
    (account) => account.currency !== reportingCurrency && account.reportingBalance === null,
  ).length;
  const totalBalance = accounts.reduce(
    (sum, account) => sum + (account.reportingBalance ?? 0),
    0,
  );

  // Provider-based color assignment for the dot indicators
  const PROVIDER_COLORS: Record<string, string> = {
    stripe: "#635BFF",
    mercury: "#6366F1",
    plaid: "#00D67E",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground font-medium">
          {copy.title}
        </CardTitle>
        <p className="text-3xl font-bold tracking-tight">
          {formatCurrency(locale, totalBalance, reportingCurrency)}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {copy.across} {accounts.length}{" "}
          {pickPluralWord(locale, accounts.length, {
            one: copy.accountOne,
            few: copy.accountOther,
            many: copy.accountOther,
            other: copy.accountOther,
          })}
        </p>
        <p className="text-xs text-muted-foreground">{formatLiveSnapshotHint(locale)}</p>
        {excludedFromReportingCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {excludedFromReportingCount} account{excludedFromReportingCount === 1 ? "" : "s"} excluded from {reportingCurrency} totals until FX rates are available.
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {accounts.map((account, idx) => {
            const color =
              PROVIDER_COLORS[account.provider.toLowerCase()] ?? "#6366F1";
            return (
              <div
                key={account.connectionId ?? `account-${idx}`}
                className="flex items-center justify-between py-1.5"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-sm text-foreground capitalize">
                    {account.provider}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 text-muted-foreground border-border"
                  >
                    {account.currency}
                  </Badge>
                </div>
                <span className="text-sm font-medium tabular-nums">
                  {formatCurrency(locale, account.balance, account.currency)}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
