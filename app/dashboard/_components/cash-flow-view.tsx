"use client";

import { useLocale } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp } from "lucide-react";

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
  deltaFinancialValues,
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

export function CashFlowView() {
  const locale = useLocale();
  const months = useDashboardMonths();
  const { data: overview, isLoading } = useFinancialOverviewData({ months });

  if (isLoading) {
    return <ViewSkeleton variant="chart" />;
  }

  if (!overview || overview.mode === "no-finance-data") {
    return (
        <EmptyState
          icon={TrendingUp}
          title={locale === "ru" ? "Данных по cash пока нет" : locale === "id" ? "Belum ada data kas" : "No cash data yet"}
          description={locale === "ru"
            ? "Загрузите финансовые отчёты или подключите банковские источники, чтобы увидеть подтверждённую cash position и историю cash flow."
            : locale === "id"
              ? "Unggah laporan keuangan atau hubungkan sumber perbankan untuk melihat posisi kas dan riwayat arus kas yang terverifikasi."
              : "Upload financial statements or connect banking sources to see verified cash position and cash flow history."}
          actionLabel={locale === "ru" ? "Подключить источник" : locale === "id" ? "Hubungkan sumber" : "Connect a source"}
          actionHref="/documents"
        />
    );
  }

  const hasCashMetrics =
    overview.cash.cashPosition !== null ||
    overview.cash.runwayMonths !== null ||
    overview.series.cashFlow.length > 0 ||
    overview.series.cash.length > 0;

  const chartData =
    overview.cash.chartKind === "cash_flow"
      ? overview.series.cashFlow.map((point) => ({
          period: point.month,
          primary: point.net,
          inflows: point.inflows,
          outflows: point.outflows,
        }))
      : overview.series.cash.map((point) => ({
          period: point.period,
          primary: point.cashPosition,
          inflows: null,
          outflows: null,
        }));
  const selectedWindowHint = formatSelectedWindowHint(months, locale);
  const windowLabel = formatDashboardWindowLabel(months, locale);
  const latestCashFlowPoint =
    overview.series.cashFlow.length > 0
      ? overview.series.cashFlow[overview.series.cashFlow.length - 1]
      : null;
  const latestCashPositionPoint =
    overview.series.cash.length > 0 ? overview.series.cash[overview.series.cash.length - 1] : null;
  const earliestCashPositionPoint = overview.series.cash.length > 0 ? overview.series.cash[0] : null;
  const latestCashPosition =
    latestCashPositionPoint?.cashPosition ?? overview.cash.cashPosition ?? null;
  const latestWindowHint = formatLatestInWindowHint(
    latestCashPositionPoint?.period ?? latestCashFlowPoint?.month ?? overview.sourcePeriod,
    months,
    locale,
  );
  const cashMovement =
    overview.series.cashFlow.length > 0
      ? sumFinancialValues(overview.series.cashFlow.map((point) => point.net))
      : deltaFinancialValues(
          latestCashPositionPoint?.cashPosition,
          earliestCashPositionPoint?.cashPosition,
        );
  const avgMonthlyInflows = averageFinancialValues(
    overview.series.cashFlow.map((point) => point.inflows),
  );
  const avgMonthlyOutflows = averageFinancialValues(
    overview.series.cashFlow.map((point) => point.outflows),
  );
  const avgMonthlyBurn =
    avgMonthlyOutflows ?? averageFinancialValues(overview.series.pnl.map((point) => point.expenses));
  const avgMonthlyRevenue =
    averageFinancialValues(overview.series.pnl.map((point) => point.revenue)) ??
    overview.cash.avgMonthlyRevenue;
  const avgMonthlyProfit =
    averageFinancialValues(overview.series.pnl.map((point) => point.netIncome)) ??
    overview.cash.avgMonthlyProfit;
  const runwayMonths =
    latestCashPosition !== null &&
    avgMonthlyBurn !== null &&
    avgMonthlyBurn > 0
      ? latestCashPosition / avgMonthlyBurn
      : overview.cash.runwayMonths;
  const keyIndicators: FinancialIndicatorItem[] = [
    {
      label: "Latest net cash flow",
      value: formatFinancialCompactAmount(latestCashFlowPoint?.net ?? null, overview.currency, locale),
      hint: latestCashFlowPoint?.month
        ? formatLatestInWindowHint(latestCashFlowPoint.month, months, locale)
        : "No verified cash-flow month yet",
      tone: (latestCashFlowPoint?.net ?? 0) >= 0 ? "positive" : "negative",
    },
    {
      label: "Avg monthly inflows",
      value: formatFinancialCompactAmount(avgMonthlyInflows, overview.currency, locale),
      hint: selectedWindowHint,
    },
    {
      label: "Avg monthly outflows",
      value: formatFinancialCompactAmount(avgMonthlyOutflows, overview.currency, locale),
      hint: selectedWindowHint,
    },
    {
      label: "Avg monthly revenue",
      value: formatFinancialCompactAmount(avgMonthlyRevenue, overview.currency, locale),
      hint: selectedWindowHint,
    },
    {
      label: "Avg monthly profit",
      value: formatFinancialCompactAmount(avgMonthlyProfit, overview.currency, locale),
      hint: selectedWindowHint,
    },
    {
      label: "Runway",
      value: runwayMonths === null ? "--" : `${runwayMonths.toFixed(1)} months`,
      hint: `Based on average burn across ${windowLabel}`,
    },
  ];

  return (
    <div className="space-y-4">
      <FinancialOverviewMeta overview={overview} months={months} />

      {!hasCashMetrics ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground font-medium">
              Cash coverage is incomplete
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Finance records exist, but there is not enough verified liquidity data
              yet to populate this tab.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Cash position</p>
                <p
                  className="break-words text-2xl leading-tight font-bold text-foreground"
                  title={formatFinancialAmount(latestCashPosition, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(latestCashPosition, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{latestWindowHint}</p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Cash movement</p>
                <p
                  className="break-words text-2xl leading-tight font-bold text-foreground"
                  title={formatFinancialAmount(cashMovement, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(cashMovement, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Avg monthly burn</p>
                <p
                  className="break-words text-2xl leading-tight font-bold text-foreground"
                  title={formatFinancialAmount(avgMonthlyBurn, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(avgMonthlyBurn, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Runway</p>
                <p className="text-2xl font-bold text-foreground">
                  {runwayMonths === null
                    ? "--"
                    : runwayMonths.toFixed(1)}
                </p>
                <p className="text-xs text-muted-foreground">{`Based on ${windowLabel}`}</p>
              </CardContent>
            </Card>
          </div>

          {chartData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  {overview.cash.chartKind === "cash_flow"
                    ? "Cash flow trend within selected window"
                    : "Cash position trend within selected window"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="cashOverviewGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
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
                        formatter={(value, name) => [
                          formatFinancialAmount(
                            typeof value === "number" ? value : Number(value ?? 0),
                            overview.currency,
                            locale,
                          ),
                          String(name ?? ""),
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="primary"
                        name={
                          overview.cash.chartKind === "cash_flow"
                            ? "Net cash flow"
                            : "Cash position"
                        }
                        stroke="#10B981"
                        strokeWidth={2}
                        fill="url(#cashOverviewGradient)"
                        dot={{ r: 3, fill: "#10B981" }}
                        activeDot={{ r: 5 }}
                      />
                      {overview.cash.chartKind === "cash_flow" ? (
                        <>
                          <Line type="monotone" dataKey="inflows" name="Inflows" stroke="#22c55e" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="outflows" name="Outflows" stroke="#ef4444" strokeWidth={2} strokeDasharray="6 4" dot={false} />
                        </>
                      ) : null}
                    </AreaChart>
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
                  A cash chart is shown once at least one verified period or
                  sufficient bank transaction history is available. Cards above
                  still reflect the latest verified liquidity data.
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
