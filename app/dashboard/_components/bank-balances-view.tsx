"use client";

import { useLocale } from "next-intl";
import { Building2, Landmark, WalletCards } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBankBalancesData } from "@/lib/hooks/use-financial-data";
import type { BankBalanceAccountView } from "@/lib/queries/bank-balance-snapshot";
import { EmptyState } from "./empty-state";
import {
  FinancialIndicatorGrid,
  type FinancialIndicatorItem,
  formatFinancialAmount,
  formatFinancialCompactAmount,
  formatLiveSnapshotHint,
} from "./financial-overview-ui";
import { ViewSkeleton } from "./view-skeleton";

function formatDate(value: string, locale: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatAccountNativeBalance(account: BankBalanceAccountView, locale: string): string {
  return formatFinancialAmount(account.balance, account.currency, locale);
}

export function BankBalancesView() {
  const locale = useLocale();
  const { data, isLoading } = useBankBalancesData();
  const snapshot = data?.snapshot ?? null;

  if (isLoading) {
    return <ViewSkeleton variant="list" />;
  }

  if (!snapshot) {
    return (
      <EmptyState
        icon={Landmark}
        title="No bank balance snapshot yet"
        description="Upload the CFO bank balance workbook to Documents. Corpus will parse it and publish the latest snapshot into Company-DB."
        actionLabel="Upload document"
        actionHref="/documents"
      />
    );
  }

  const currency = snapshot.reportingCurrency;
  const largestCompany = snapshot.companies[0] ?? null;
  const largestAccount = snapshot.accounts[0] ?? null;
  const indicators: FinancialIndicatorItem[] = [
    {
      label: "Total bank balance",
      value: formatFinancialCompactAmount(snapshot.totalIdr, currency, locale),
      hint: formatFinancialAmount(snapshot.totalIdr, currency, locale),
    },
    {
      label: "Companies",
      value: String(snapshot.companyCount),
      hint: `${snapshot.accountCount} bank account${snapshot.accountCount === 1 ? "" : "s"}`,
    },
    {
      label: "Largest company",
      value: largestCompany?.companyName ?? "--",
      hint: largestCompany
        ? formatFinancialCompactAmount(largestCompany.totalIdr, currency, locale)
        : formatLiveSnapshotHint(locale),
    },
    {
      label: "Largest account",
      value: largestAccount
        ? formatFinancialCompactAmount(largestAccount.balanceIdr, currency, locale)
        : "--",
      hint: largestAccount
        ? `${largestAccount.companyName} • ${largestAccount.bankName}`
        : formatLiveSnapshotHint(locale),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Company-DB snapshot</Badge>
        <Badge variant="outline">As of {formatDate(snapshot.asOfDate, locale)}</Badge>
        <Badge variant="outline">{formatLiveSnapshotHint(locale)}</Badge>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <WalletCards className="size-4" />
            Bank balances across the selected group and subsidiaries
          </CardTitle>
          <p
            className="text-4xl font-bold tabular-nums text-foreground"
            title={formatFinancialAmount(snapshot.totalIdr, currency, locale)}
          >
            {formatFinancialCompactAmount(snapshot.totalIdr, currency, locale)}
          </p>
          <p className="text-xs text-muted-foreground">
            Source: {snapshot.sourceDocumentName ?? "uploaded bank balance workbook"} ·{" "}
            {snapshot.companyDbPath}
          </p>
        </CardHeader>
      </Card>

      <FinancialIndicatorGrid title="Snapshot indicators" items={indicators} />

      {snapshot.warnings.length > 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-4 text-sm text-muted-foreground">
            Warnings: {snapshot.warnings.join(", ")}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3">
        {snapshot.companies.map((company, index) => (
          <details
            key={company.companyName}
            open={index === 0}
            className="group rounded-xl border bg-card text-card-foreground shadow-sm"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Building2 className="size-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">{company.companyName}</p>
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {company.currencies.join(", ")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {company.accountCount} account{company.accountCount === 1 ? "" : "s"}
                </p>
              </div>
              <p
                className="text-right text-lg font-semibold tabular-nums"
                title={formatFinancialAmount(company.totalIdr, currency, locale)}
              >
                {formatFinancialCompactAmount(company.totalIdr, currency, locale)}
              </p>
            </summary>

            <div className="border-t px-4 pb-4">
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3 font-medium">Bank</th>
                      <th className="py-2 pr-3 font-medium">Account</th>
                      <th className="py-2 pr-3 font-medium">Purpose</th>
                      <th className="py-2 pr-3 text-right font-medium">Native</th>
                      <th className="py-2 pr-3 text-right font-medium">IDR equivalent</th>
                      <th className="py-2 pr-3 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {company.accounts.map((account) => (
                      <tr
                        key={`${account.sourceSheet}:${account.sourceRow}:${account.bankAccount}`}
                        className="border-b last:border-0"
                      >
                        <td className="py-2 pr-3 font-medium">{account.bankName}</td>
                        <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                          {account.bankAccount}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {account.purpose ?? "--"}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatAccountNativeBalance(account, locale)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-medium">
                          {formatFinancialAmount(account.balanceIdr, currency, locale)}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {account.sourceSheet ?? "sheet"} row {account.sourceRow ?? "?"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
