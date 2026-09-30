"use client";

import { useLocale } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
  formatFinancialCompactAmount,
  formatSelectedWindowHint,
  sumFinancialValues,
} from "./financial-overview-ui";
import { ViewSkeleton } from "./view-skeleton";

export function PnLView() {
  const locale = useLocale();
  const months = useDashboardMonths();
  const { data: overview, isLoading } = useFinancialOverviewData({ months });

  if (isLoading) {
    return <ViewSkeleton variant="chart" />;
  }

  if (!overview || overview.mode === "no-finance-data") {
    return (
        <EmptyState
          icon={BarChart3}
          title={locale === "ru" ? "Данных P&L пока нет" : locale === "id" ? "Belum ada data laba rugi" : "No P&L data yet"}
          description={locale === "ru"
            ? "Загрузите финансовые отчёты или подключите источники транзакций, чтобы увидеть подтверждённые данные по прибыли и убыткам."
            : locale === "id"
              ? "Unggah laporan keuangan atau hubungkan sumber transaksi untuk melihat data laba rugi yang terverifikasi."
              : "Upload financial statements or connect transaction sources to see verified profit and loss data."}
          actionLabel={locale === "ru" ? "Подключить источник" : locale === "id" ? "Hubungkan sumber" : "Connect a source"}
          actionHref="/documents"
        />
    );
  }

  const hasPnLMetrics =
    overview.pnl.revenue !== null ||
    overview.pnl.expenses !== null ||
    overview.pnl.operatingExpenses !== null ||
    overview.pnl.costOfSales !== null ||
    overview.pnl.grossProfit !== null ||
    overview.pnl.netProfit !== null;

  const chartData = overview.series.pnl
    .filter(
      (point) =>
        point.revenue !== null ||
        point.expenses !== null ||
        point.netIncome !== null,
    )
    .map((point) => ({
      period: point.period,
      revenue: point.revenue,
      expenses: point.expenses,
      operatingExpenses: point.operatingExpenses,
      costOfSales: point.costOfSales,
      grossProfit: point.grossProfit,
      netProfit: point.netIncome,
    }));
  const selectedWindowHint = formatSelectedWindowHint(months, locale);
  const windowLabel = formatDashboardWindowLabel(months, locale);
  const latestWindowPeriod = chartData[chartData.length - 1]?.period ?? overview.sourcePeriod;
  const windowRevenue =
    sumFinancialValues(chartData.map((point) => point.revenue)) ?? overview.pnl.revenue;
  const windowExpenses =
    sumFinancialValues(chartData.map((point) => point.expenses)) ?? overview.pnl.expenses;
  const windowOperatingExpenses =
    sumFinancialValues(chartData.map((point) => point.operatingExpenses)) ?? overview.pnl.operatingExpenses;
  const windowCostOfSales =
    sumFinancialValues(chartData.map((point) => point.costOfSales)) ?? overview.pnl.costOfSales;
  const windowGrossProfit =
    sumFinancialValues(chartData.map((point) => point.grossProfit)) ?? overview.pnl.grossProfit;
  const windowNetProfit =
    sumFinancialValues(chartData.map((point) => point.netProfit)) ?? overview.pnl.netProfit;
  const averageRevenue = averageFinancialValues(chartData.map((point) => point.revenue));
  const averageNetProfit = averageFinancialValues(chartData.map((point) => point.netProfit));
  const grossMarginPct =
    windowRevenue !== null &&
    windowGrossProfit !== null &&
    windowRevenue !== 0
      ? Number(((windowGrossProfit / windowRevenue) * 100).toFixed(1))
      : null;
  const netMarginPct =
    windowRevenue !== null &&
    windowNetProfit !== null &&
    windowRevenue !== 0
      ? Number(((windowNetProfit / windowRevenue) * 100).toFixed(1))
      : null;
  const keyIndicators: FinancialIndicatorItem[] = [
    {
      label: "Gross profit",
      value: formatFinancialCompactAmount(windowGrossProfit, overview.currency, locale),
      hint: selectedWindowHint,
      tone: (windowGrossProfit ?? 0) >= 0 ? "positive" : "negative",
    },
    {
      label: "Gross margin",
      value: grossMarginPct === null ? "--" : `${grossMarginPct}%`,
      hint: `Gross profit as % of revenue across ${windowLabel}`,
    },
    {
      label: "Operating expenses",
      value: formatFinancialCompactAmount(windowOperatingExpenses, overview.currency, locale),
      hint: selectedWindowHint,
    },
    {
      label: "Cost of sales",
      value: formatFinancialCompactAmount(windowCostOfSales, overview.currency, locale),
      hint: selectedWindowHint,
    },
    {
      label: "Avg monthly revenue",
      value: formatFinancialCompactAmount(averageRevenue, overview.currency, locale),
      hint: selectedWindowHint,
    },
    {
      label: "Net margin",
      value: netMarginPct === null ? "--" : `${netMarginPct}%`,
      hint: `Net income as % of revenue across ${windowLabel}`,
      tone: (windowNetProfit ?? 0) >= 0 ? "positive" : "negative",
    },
  ];

  return (
    <div className="space-y-4">
      <FinancialOverviewMeta overview={overview} months={months} />

      {!hasPnLMetrics ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground font-medium">
              P&amp;L coverage is incomplete
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Finance data exists, but the latest verified period does not expose
              enough P&amp;L metrics yet. Upload a company-wide P&amp;L statement or
              a richer trial balance to populate this tab.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Selected-window P&amp;L
                </CardTitle>
              </CardHeader>
              <CardContent>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Revenue</p>
                  <p
                    className="break-words text-xl leading-tight font-bold text-foreground"
                    title={formatFinancialAmount(windowRevenue, overview.currency, locale)}
                  >
                    {formatFinancialCompactAmount(windowRevenue, overview.currency, locale)}
                  </p>
                  <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Expenses</p>
                  <p
                    className="break-words text-xl leading-tight font-bold text-foreground"
                    title={formatFinancialAmount(windowExpenses, overview.currency, locale)}
                  >
                    {formatFinancialCompactAmount(windowExpenses, overview.currency, locale)}
                  </p>
                  <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Net profit</p>
                  <p
                    className={`break-words text-xl leading-tight font-bold ${
                      (windowNetProfit ?? 0) >= 0 ? "text-green-500" : "text-red-500"
                    }`}
                    title={formatFinancialAmount(windowNetProfit, overview.currency, locale)}
                  >
                    {formatFinancialCompactAmount(windowNetProfit, overview.currency, locale)}
                  </p>
                  <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Profitability
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold text-foreground">
                    {netMarginPct === null ? "--" : `${netMarginPct}%`}
                  </p>
                  <p className="text-xs text-muted-foreground">{windowLabel}</p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${
                      (windowNetProfit ?? 0) >= 0 ? "bg-green-500" : "bg-red-500"
                    }`}
                    style={{
                      width: `${Math.min(Math.abs(netMarginPct ?? 0), 100)}%`,
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Gross profit</p>
                    <p
                      className="break-words font-medium leading-tight"
                      title={formatFinancialAmount(windowGrossProfit, overview.currency, locale)}
                    >
                      {formatFinancialCompactAmount(windowGrossProfit, overview.currency, locale)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cost of sales</p>
                    <p
                      className="break-words font-medium leading-tight"
                      title={formatFinancialAmount(windowCostOfSales, overview.currency, locale)}
                    >
                      {formatFinancialCompactAmount(windowCostOfSales, overview.currency, locale)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Coverage notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Source: {overview.sourceLabel}</p>
                <p>Quality: {overview.quality}</p>
                <p>
                  Window summary:{" "}
                  <span className="text-foreground">{windowLabel}</span>
                </p>
                <p>
                  Latest verified point in window:{" "}
                  <span className="text-foreground">{latestWindowPeriod ?? "Unknown"}</span>
                </p>
                <p>
                  Covered months:{" "}
                  <span className="text-foreground">{chartData.length || 0}</span>
                </p>
                {overview.provenance.departmentLevelOnly ? (
                  <p>Latest P&amp;L is aggregated from department-level snapshots.</p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {chartData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Verified P&amp;L trend within selected window
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" opacity={0.5} />
                      <XAxis
                        dataKey="period"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                        width={48}
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
                      <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="grossProfit" name="Gross profit" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="expenses" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="operatingExpenses" name="Operating expenses" stroke="#f97316" strokeWidth={2} strokeDasharray="6 4" dot={false} />
                      <Line type="monotone" dataKey="netProfit" stroke="#10b981" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Trend availability
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  A verified P&amp;L trend chart appears once at least one verified
                  reporting period is available.
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
