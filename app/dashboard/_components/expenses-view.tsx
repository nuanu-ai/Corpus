"use client";

import { useLocale } from "next-intl";
import {
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Receipt } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useFinancialOverviewData } from "@/lib/hooks/use-financial-data";
import { useDashboardMonths } from "./dashboard-period-selector";
import { EmptyState } from "./empty-state";
import {
  averageFinancialValues,
  formatDashboardWindowLabel,
  FinancialIndicatorGrid,
  FinancialOverviewMeta,
  type FinancialIndicatorItem,
  formatFinancialAmount,
  formatFinancialAxis,
  formatFinancialCompactAmount,
  formatLatestInWindowHint,
  formatSelectedWindowHint,
  sumFinancialValues,
} from "./financial-overview-ui";
import { ViewSkeleton } from "./view-skeleton";

const COLORS = ["#3B82F6", "#8B5CF6", "#06B6D4", "#F59E0B", "#EF4444", "#6B7280"];

export function ExpensesView() {
  const locale = useLocale();
  const months = useDashboardMonths();
  const { data: overview, isLoading } = useFinancialOverviewData({ months });

  if (isLoading) {
    return <ViewSkeleton variant="default" />;
  }

  if (!overview || overview.mode === "no-finance-data") {
    return (
        <EmptyState
          icon={Receipt}
          title={locale === "ru" ? "Данных по расходам пока нет" : locale === "id" ? "Belum ada data biaya" : "No expense data yet"}
          description={locale === "ru"
            ? "Загрузите финансовые отчёты или подключите источники транзакций, чтобы увидеть покрытие расходов."
            : locale === "id"
              ? "Unggah laporan keuangan atau hubungkan sumber transaksi untuk melihat cakupan biaya."
              : "Upload financial statements or connect transaction sources to see expense coverage."}
          actionLabel={locale === "ru" ? "Подключить источник" : locale === "id" ? "Hubungkan sumber" : "Connect a source"}
          actionHref="/documents"
        />
    );
  }

  const hasExpenseMetrics =
    overview.expenses.total !== null ||
    overview.expenses.operatingExpenses !== null ||
    overview.expenses.costOfSales !== null ||
    overview.expenses.breakdown.length > 0;

  const pieData = overview.expenses.breakdown.map((row, index) => ({
    name: row.category,
    value: row.amount,
    count: row.count,
    percentOfTotal: row.percentOfTotal,
    color: COLORS[index % COLORS.length],
  }));

  const expenseTrendData = overview.series.expenses
    .filter(
      (point) =>
        point.expenses !== null ||
        point.operatingExpenses !== null ||
        point.costOfSales !== null,
    )
    .map((point) => ({
      period: point.period,
      total: point.expenses,
      operatingExpenses: point.operatingExpenses,
      costOfSales: point.costOfSales,
    }));
  const selectedWindowHint = formatSelectedWindowHint(months, locale);
  const windowLabel = formatDashboardWindowLabel(months, locale);
  const latestExpensePeriod = expenseTrendData[expenseTrendData.length - 1]?.period ?? overview.sourcePeriod;
  const latestDetailHint = formatLatestInWindowHint(latestExpensePeriod, months, locale);
  const windowTotalExpenses =
    sumFinancialValues(expenseTrendData.map((point) => point.total)) ?? overview.expenses.total;
  const windowOperatingExpenses =
    sumFinancialValues(expenseTrendData.map((point) => point.operatingExpenses)) ??
    overview.expenses.operatingExpenses;
  const windowCostOfSales =
    sumFinancialValues(expenseTrendData.map((point) => point.costOfSales)) ??
    overview.expenses.costOfSales;
  const averageMonthlyExpenses = averageFinancialValues(
    expenseTrendData.map((point) => point.total),
  );
  const breakdownSourceLabel =
    overview.expenses.breakdownBasis === "transactions"
      ? "Transaction-categorized"
      : overview.expenses.breakdownBasis === "statements"
        ? "Statement-derived"
        : "No detailed breakdown";
  const rowVolumeLabel = (count: number) => {
    if (overview.expenses.breakdownBasis === "transactions") {
      return `${count} txn${count !== 1 ? "s" : ""}`;
    }
    if (overview.expenses.breakdownBasis === "statements") {
      return "statement mix";
    }
    return "no detail";
  };
  const topExpenseCategory =
    overview.expenses.breakdown.length > 0 ? overview.expenses.breakdown[0] : null;
  const operatingShare =
    windowTotalExpenses && windowOperatingExpenses !== null
      ? Number(((windowOperatingExpenses / windowTotalExpenses) * 100).toFixed(1))
      : null;
  const costOfSalesShare =
    windowTotalExpenses && windowCostOfSales !== null
      ? Number(((windowCostOfSales / windowTotalExpenses) * 100).toFixed(1))
      : null;
  const keyIndicators: FinancialIndicatorItem[] = [
    {
      label: "Breakdown basis",
      value:
        overview.expenses.breakdownBasis === "transactions"
          ? "Transactions"
          : overview.expenses.breakdownBasis === "statements"
            ? "Statements"
            : "No detail",
      hint: `${breakdownSourceLabel} • ${latestDetailHint}`,
    },
    {
      label: "Top expense category",
      value: topExpenseCategory?.category ?? "--",
      hint: topExpenseCategory
        ? `${formatFinancialCompactAmount(topExpenseCategory.amount, overview.currency, locale)} • ${latestDetailHint}`
        : "No ranked category yet",
    },
    {
      label: "Operating expense share",
      value: operatingShare === null ? "--" : `${operatingShare}%`,
      hint: `Across ${windowLabel}`,
    },
    {
      label: "Cost of sales share",
      value: costOfSalesShare === null ? "--" : `${costOfSalesShare}%`,
      hint: `Across ${windowLabel}`,
    },
    {
      label: "Avg monthly expenses",
      value: formatFinancialCompactAmount(averageMonthlyExpenses, overview.currency, locale),
      hint: selectedWindowHint,
    },
  ];

  return (
    <div className="space-y-4">
      <FinancialOverviewMeta overview={overview} months={months} />

      {!hasExpenseMetrics ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground font-medium">
              Expense coverage is incomplete
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Finance records exist, but the latest verified period does not expose
              enough expense detail yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Total expenses
                </CardTitle>
                <p
                  className="break-words text-2xl leading-tight font-bold"
                  title={formatFinancialAmount(windowTotalExpenses, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(windowTotalExpenses, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Operating expenses
                </CardTitle>
                <p
                  className="break-words text-2xl leading-tight font-bold"
                  title={formatFinancialAmount(
                    windowOperatingExpenses,
                    overview.currency,
                    locale,
                  )}
                >
                  {formatFinancialCompactAmount(
                    windowOperatingExpenses,
                    overview.currency,
                    locale,
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Cost of sales
                </CardTitle>
                <p
                  className="break-words text-2xl leading-tight font-bold"
                  title={formatFinancialAmount(windowCostOfSales, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(windowCostOfSales, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
              </CardHeader>
            </Card>
          </div>

          {expenseTrendData.length >= 1 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Monthly expense trend within selected window
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={expenseTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.5} />
                      <XAxis
                        dataKey="period"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tickFormatter={(value) => formatFinancialAxis(Number(value), overview.currency, locale)}
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
                            overview.currency,
                            locale,
                          ),
                        ]}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="total" name="Total expenses" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="operatingExpenses" name="Operating expenses" stroke="#ef4444" strokeWidth={2} strokeDasharray="6 4" dot={false} />
                      <Line type="monotone" dataKey="costOfSales" name="Cost of sales" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {pieData.length > 0 ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground font-medium">
                    Expense mix
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {breakdownSourceLabel} • {latestDetailHint}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={95}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {pieData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
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
                              overview.currency,
                              locale,
                            ),
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {pieData.map((entry) => (
                      <div key={entry.name} className="flex items-center gap-2">
                        <div
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="truncate text-xs text-muted-foreground">
                          {entry.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground font-medium">
                    Expense categories
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {overview.expenses.breakdown.map((row, index) => (
                      <div
                        key={row.category}
                        className="flex items-center gap-3 rounded-lg px-2 py-2.5"
                      >
                        <div
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="flex-1 text-sm">{row.category}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {rowVolumeLabel(row.count)}
                        </span>
                        <div className="min-w-0 shrink-0 text-right">
                          <span
                            className="block break-words text-sm font-medium leading-tight tabular-nums"
                            title={formatFinancialAmount(row.amount, overview.currency, locale)}
                          >
                            {formatFinancialCompactAmount(row.amount, overview.currency, locale)}
                          </span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {row.percentOfTotal.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Expense detail
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Total expenses are available, but the current period does not expose
                  a usable category split yet.
                </p>
              </CardContent>
            </Card>
          )}

          <FinancialIndicatorGrid title="Key indicators" items={keyIndicators} />
        </>
      )}
    </div>
  );
}
