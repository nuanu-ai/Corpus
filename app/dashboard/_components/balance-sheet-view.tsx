"use client";

import { useLocale } from "next-intl";
import { Landmark } from "lucide-react";
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
  deltaFinancialValues,
  formatChangeAcrossWindowHint,
  formatDashboardWindowLabel,
  FinancialIndicatorGrid,
  FinancialOverviewMeta,
  type FinancialIndicatorItem,
  formatFinancialAmount,
  formatFinancialAxis,
  formatFinancialCompactAmount,
  formatLatestInWindowHint,
} from "./financial-overview-ui";
import { ViewSkeleton } from "./view-skeleton";

export function BalanceSheetView() {
  const locale = useLocale();
  const months = useDashboardMonths();
  const { data: overview, isLoading } = useFinancialOverviewData({ months });

  if (isLoading) {
    return <ViewSkeleton variant="chart" />;
  }

  if (!overview || overview.mode === "no-finance-data") {
    return (
      <EmptyState
        icon={Landmark}
        title={locale === "ru" ? "Данных balance sheet пока нет" : locale === "id" ? "Belum ada balance sheet" : "No balance sheet data yet"}
        description={locale === "ru"
          ? "Загрузите monthly balance sheet, чтобы увидеть активы, обязательства и капитал в canonical finance layer."
          : locale === "id"
            ? "Unggah balance sheet bulanan untuk melihat aset, liabilitas, dan ekuitas di canonical finance layer."
            : "Upload monthly balance sheets to see assets, liabilities, and equity in the canonical finance layer."}
        actionLabel={locale === "ru" ? "Загрузить документ" : locale === "id" ? "Unggah dokumen" : "Upload a document"}
        actionHref="/documents"
      />
    );
  }

  const hasBalanceSheetMetrics =
    overview.balanceSheet.totalAssets !== null ||
    overview.balanceSheet.totalLiabilities !== null ||
    overview.balanceSheet.equity !== null ||
    overview.balanceSheet.cashAndEquivalents !== null;

  const chartData = overview.series.balanceSheet
    .filter(
      (point) =>
        point.cashAndEquivalents !== null ||
        point.totalAssets !== null ||
        point.totalLiabilities !== null ||
        point.equity !== null,
    )
    .map((point) => ({
      period: point.period,
      cashAndEquivalents: point.cashAndEquivalents,
      totalAssets: point.totalAssets,
      totalLiabilities: point.totalLiabilities,
      equity: point.equity,
    }));
  const windowLabel = formatDashboardWindowLabel(months, locale);
  const latestBalanceSheetPoint = overview.series.balanceSheet[overview.series.balanceSheet.length - 1] ?? null;
  const firstBalanceSheetPoint = overview.series.balanceSheet[0] ?? null;
  const latestWindowHint = formatLatestInWindowHint(
    latestBalanceSheetPoint?.period ?? overview.sourcePeriod,
    months,
    locale,
  );
  const assetsChange = deltaFinancialValues(
    latestBalanceSheetPoint?.totalAssets,
    firstBalanceSheetPoint?.totalAssets,
  );
  const currentAssetsChange = deltaFinancialValues(
    latestBalanceSheetPoint?.totalCurrentAssets,
    firstBalanceSheetPoint?.totalCurrentAssets,
  );
  const fixedAssetsChange = deltaFinancialValues(
    latestBalanceSheetPoint?.fixedAssets,
    firstBalanceSheetPoint?.fixedAssets,
  );
  const liabilitiesChange = deltaFinancialValues(
    latestBalanceSheetPoint?.totalLiabilities,
    firstBalanceSheetPoint?.totalLiabilities,
  );
  const equityChange = deltaFinancialValues(
    latestBalanceSheetPoint?.equity,
    firstBalanceSheetPoint?.equity,
  );
  const retainedEarningsChange = deltaFinancialValues(
    latestBalanceSheetPoint?.retainedEarnings,
    firstBalanceSheetPoint?.retainedEarnings,
  );
  const cashChange = deltaFinancialValues(
    latestBalanceSheetPoint?.cashAndEquivalents,
    firstBalanceSheetPoint?.cashAndEquivalents,
  );
  const changeAcrossWindowHint = formatChangeAcrossWindowHint(months, locale);
  const liabilitiesToAssetsPct =
    overview.balanceSheet.totalAssets !== null &&
    overview.balanceSheet.totalLiabilities !== null &&
    overview.balanceSheet.totalAssets !== 0
      ? Number(
          ((overview.balanceSheet.totalLiabilities / overview.balanceSheet.totalAssets) * 100).toFixed(1),
        )
      : null;
  const equityToAssetsPct =
    overview.balanceSheet.totalAssets !== null &&
    overview.balanceSheet.equity !== null &&
    overview.balanceSheet.totalAssets !== 0
      ? Number(((overview.balanceSheet.equity / overview.balanceSheet.totalAssets) * 100).toFixed(1))
      : null;
  const keyIndicators: FinancialIndicatorItem[] = [
    {
      label: "Inventory",
      value: formatFinancialCompactAmount(
        latestBalanceSheetPoint?.inventory ?? overview.balanceSheet.inventory,
        overview.currency,
        locale,
      ),
      hint: latestWindowHint,
    },
    {
      label: "Current assets change",
      value: formatFinancialCompactAmount(currentAssetsChange, overview.currency, locale),
      hint: changeAcrossWindowHint,
    },
    {
      label: "Fixed assets change",
      value: formatFinancialCompactAmount(fixedAssetsChange, overview.currency, locale),
      hint: changeAcrossWindowHint,
    },
    {
      label: "Retained earnings change",
      value: formatFinancialCompactAmount(retainedEarningsChange, overview.currency, locale),
      hint: changeAcrossWindowHint,
      tone: (retainedEarningsChange ?? 0) >= 0 ? "positive" : "negative",
    },
    {
      label: "Liabilities / assets",
      value: liabilitiesToAssetsPct === null ? "--" : `${liabilitiesToAssetsPct}%`,
      hint: latestWindowHint,
    },
    {
      label: "Equity / assets",
      value: equityToAssetsPct === null ? "--" : `${equityToAssetsPct}%`,
      hint: latestWindowHint,
      tone: (overview.balanceSheet.equity ?? 0) >= 0 ? "positive" : "negative",
    },
  ];

  return (
    <div className="space-y-4">
      <FinancialOverviewMeta overview={overview} months={months} />

      {!hasBalanceSheetMetrics ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground font-medium">
              Balance sheet coverage is incomplete
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Finance data exists, but the latest verified balance sheet is not
              available yet in canonical form.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Cash &amp; equivalents</p>
                <p
                  className="break-words text-2xl leading-tight font-bold text-foreground"
                  title={formatFinancialAmount(overview.balanceSheet.cashAndEquivalents, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(overview.balanceSheet.cashAndEquivalents, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{latestWindowHint}</p>
                <p className="text-xs text-muted-foreground">
                  {changeAcrossWindowHint}: {formatFinancialCompactAmount(cashChange, overview.currency, locale)}
                </p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Total assets</p>
                <p
                  className="break-words text-2xl leading-tight font-bold text-foreground"
                  title={formatFinancialAmount(overview.balanceSheet.totalAssets, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(overview.balanceSheet.totalAssets, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{latestWindowHint}</p>
                <p className="text-xs text-muted-foreground">
                  {changeAcrossWindowHint}: {formatFinancialCompactAmount(assetsChange, overview.currency, locale)}
                </p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Total liabilities</p>
                <p
                  className="break-words text-2xl leading-tight font-bold text-foreground"
                  title={formatFinancialAmount(overview.balanceSheet.totalLiabilities, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(overview.balanceSheet.totalLiabilities, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{latestWindowHint}</p>
                <p className="text-xs text-muted-foreground">
                  {changeAcrossWindowHint}: {formatFinancialCompactAmount(liabilitiesChange, overview.currency, locale)}
                </p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="min-w-0">
                <p className="text-xs text-muted-foreground">Equity</p>
                <p
                  className="break-words text-2xl leading-tight font-bold text-foreground"
                  title={formatFinancialAmount(overview.balanceSheet.equity, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(overview.balanceSheet.equity, overview.currency, locale)}
                </p>
                <p className="text-xs text-muted-foreground">{latestWindowHint}</p>
                <p className="text-xs text-muted-foreground">
                  {changeAcrossWindowHint}: {formatFinancialCompactAmount(equityChange, overview.currency, locale)}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Current assets
                </CardTitle>
                <p className="text-xs text-muted-foreground">{latestWindowHint}</p>
              </CardHeader>
              <CardContent>
                <p
                  className="break-words text-xl leading-tight font-bold"
                  title={formatFinancialAmount(overview.balanceSheet.totalCurrentAssets, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(overview.balanceSheet.totalCurrentAssets, overview.currency, locale)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Fixed assets
                </CardTitle>
                <p className="text-xs text-muted-foreground">{latestWindowHint}</p>
              </CardHeader>
              <CardContent>
                <p
                  className="break-words text-xl leading-tight font-bold"
                  title={formatFinancialAmount(overview.balanceSheet.fixedAssets, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(overview.balanceSheet.fixedAssets, overview.currency, locale)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Retained earnings
                </CardTitle>
                <p className="text-xs text-muted-foreground">{latestWindowHint}</p>
              </CardHeader>
              <CardContent>
                <p
                  className="break-words text-xl leading-tight font-bold"
                  title={formatFinancialAmount(overview.balanceSheet.retainedEarnings, overview.currency, locale)}
                >
                  {formatFinancialCompactAmount(overview.balanceSheet.retainedEarnings, overview.currency, locale)}
                </p>
              </CardContent>
            </Card>
          </div>

          {chartData.length >= 1 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Balance sheet trend within selected window
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
                      <Line type="monotone" dataKey="cashAndEquivalents" name="Cash & equivalents" stroke="#06b6d4" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="totalAssets" name="Assets" stroke="#22c55e" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="totalLiabilities" name="Liabilities" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="equity" name="Equity" stroke="#38bdf8" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <FinancialIndicatorGrid title="Key indicators" items={keyIndicators} />
        </>
      )}
    </div>
  );
}
