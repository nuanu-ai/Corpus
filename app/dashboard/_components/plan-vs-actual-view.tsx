"use client";

import { useLocale } from "next-intl";
import { Target } from "lucide-react";
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
  formatDashboardWindowLabel,
  FinancialIndicatorGrid,
  FinancialOverviewMeta,
  type FinancialIndicatorItem,
  formatFinancialAmount,
  formatFinancialAxis,
  formatFinancialCompactAmount,
  formatSelectedWindowHint,
  sumFinancialValues,
} from "./financial-overview-ui";
import { ViewSkeleton } from "./view-skeleton";

export function PlanVsActualView() {
  const locale = useLocale();
  const months = useDashboardMonths();
  const { data: overview, isLoading } = useFinancialOverviewData({ months });

  if (isLoading) {
    return <ViewSkeleton variant="chart" />;
  }

  if (!overview || overview.mode === "no-finance-data") {
    return (
      <EmptyState
        icon={Target}
        title={locale === "ru" ? "Плана пока нет" : locale === "id" ? "Belum ada plan" : "No financial plan yet"}
        description={locale === "ru"
          ? "Загрузите projection или budget workbook, чтобы сравнивать план с фактом."
          : locale === "id"
            ? "Unggah workbook projection atau budget untuk membandingkan plan versus actual."
            : "Upload a projection or budget workbook to compare plan versus actual."}
        actionLabel={locale === "ru" ? "Загрузить план" : locale === "id" ? "Unggah plan" : "Upload a plan"}
        actionHref="/documents"
      />
    );
  }

  const hasProjection = overview.projection.available;
  const chartData = overview.series.planVsActual.filter(
    (point) =>
      point.actualRevenue !== null ||
      point.plannedRevenue !== null ||
      point.actualNetIncome !== null ||
      point.plannedNetIncome !== null,
  );
  const selectedWindowHint = formatSelectedWindowHint(months, locale);
  const windowLabel = formatDashboardWindowLabel(months, locale);
  const windowActualRevenue = sumFinancialValues(chartData.map((point) => point.actualRevenue));
  const windowPlannedRevenue = sumFinancialValues(chartData.map((point) => point.plannedRevenue));
  const windowActualExpenses = sumFinancialValues(chartData.map((point) => point.actualExpenses));
  const windowPlannedExpenses = sumFinancialValues(chartData.map((point) => point.plannedExpenses));
  const windowActualNetIncome = sumFinancialValues(chartData.map((point) => point.actualNetIncome));
  const windowPlannedNetIncome = sumFinancialValues(chartData.map((point) => point.plannedNetIncome));
  const windowRevenueVariance =
    windowActualRevenue !== null && windowPlannedRevenue !== null
      ? windowActualRevenue - windowPlannedRevenue
      : overview.projection.varianceRevenue;
  const windowExpenseVariance =
    windowActualExpenses !== null && windowPlannedExpenses !== null
      ? windowActualExpenses - windowPlannedExpenses
      : overview.projection.varianceExpenses;
  const windowNetIncomeVariance =
    windowActualNetIncome !== null && windowPlannedNetIncome !== null
      ? windowActualNetIncome - windowPlannedNetIncome
      : overview.projection.varianceNetIncome;
  const keyIndicators: FinancialIndicatorItem[] = [
    {
      label: "Plan horizon through",
      value: overview.projection.latestPlanPeriod ?? "--",
      hint: `Latest plan slice visible in ${windowLabel}`,
    },
    {
      label: "Comparable actuals through",
      value: overview.projection.comparableThroughPeriod ?? "--",
      hint: `Latest overlapping month in ${windowLabel}`,
    },
    {
      label: "Planned revenue",
      value: formatFinancialCompactAmount(windowPlannedRevenue, overview.currency, locale),
      hint: selectedWindowHint,
    },
    {
      label: "Actual revenue",
      value: formatFinancialCompactAmount(windowActualRevenue, overview.currency, locale),
      hint: selectedWindowHint,
    },
    {
      label: "Planned net income",
      value: formatFinancialCompactAmount(windowPlannedNetIncome, overview.currency, locale),
      hint: selectedWindowHint,
    },
    {
      label: "Actual net income",
      value: formatFinancialCompactAmount(windowActualNetIncome, overview.currency, locale),
      hint: selectedWindowHint,
    },
  ];

  return (
    <div className="space-y-4">
      <FinancialOverviewMeta overview={overview} months={months} />

      {!hasProjection ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground font-medium">
              Projection coverage is incomplete
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Actual monthly finance statements are available, but no canonical
              financial projection plan has been extracted yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Plan horizon through</p>
                <p className="text-2xl font-bold text-foreground">
                  {overview.projection.latestPlanPeriod ?? "--"}
                </p>
                <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Comparable actuals through</p>
                <p className="text-2xl font-bold text-foreground">
                  {overview.projection.comparableThroughPeriod ?? "--"}
                </p>
                <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Revenue variance</p>
                <p
                  className="break-words text-2xl leading-tight font-bold text-foreground"
                  title={formatFinancialAmount(windowRevenueVariance, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(windowRevenueVariance, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Expense variance</p>
                <p
                  className="break-words text-2xl leading-tight font-bold text-foreground"
                  title={formatFinancialAmount(windowExpenseVariance, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(windowExpenseVariance, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Net income variance</p>
                <p
                  className="break-words text-2xl leading-tight font-bold text-foreground"
                  title={formatFinancialAmount(windowNetIncomeVariance, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(windowNetIncomeVariance, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{selectedWindowHint}</p>
              </CardContent>
            </Card>
          </div>

          {chartData.length >= 1 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Plan vs actual trend within selected window
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[320px]">
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
                      <Line type="monotone" dataKey="actualRevenue" name="Actual revenue" stroke="#22c55e" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="plannedRevenue" name="Planned revenue" stroke="#38bdf8" strokeWidth={2} strokeDasharray="6 4" dot={false} />
                      <Line type="monotone" dataKey="actualNetIncome" name="Actual net income" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="plannedNetIncome" name="Planned net income" stroke="#f97316" strokeWidth={2} strokeDasharray="6 4" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Plan comparison
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Projection slices are available. The comparison chart appears once
                  at least one overlapping plan and actual period exists.
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
