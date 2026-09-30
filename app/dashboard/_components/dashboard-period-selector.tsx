"use client";

import { useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildDashboardHrefForView,
  clampDashboardMonths,
  DEFAULT_FINANCE_DASHBOARD_VIEW,
  isFinanceDashboardView,
} from "@/lib/dashboard-navigation";

const DASHBOARD_PERIOD_OPTIONS = [1, 3, 6, 12, 24, 60] as const;

function getPeriodControlLabel(locale: string): string {
  if (locale === "ru") return "Период дашборда";
  if (locale === "id") return "Periode dashboard";
  return "Dashboard period";
}

function getPeriodOptionLabel(months: number, locale: string): string {
  if (months === 1) {
    if (locale === "ru") return "Последний месяц";
    if (locale === "id") return "1 bulan terakhir";
    return "Last month";
  }

  if (months === 60) {
    if (locale === "ru") return "Последние 5 лет";
    if (locale === "id") return "5 tahun terakhir";
    return "Last 5 years";
  }

  if (locale === "ru") return `Последние ${months} мес.`;
  if (locale === "id") return `${months} bulan terakhir`;
  return `Last ${months} months`;
}

export function useDashboardMonths(): number {
  const searchParams = useSearchParams();
  return clampDashboardMonths(searchParams.get("months"));
}

export function DashboardPeriodSelector() {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const months = useDashboardMonths();
  const requestedView = searchParams.get("view");
  const currentView = requestedView && isFinanceDashboardView(requestedView)
    ? requestedView
    : DEFAULT_FINANCE_DASHBOARD_VIEW;

  return (
    <div className="flex items-center gap-3">
      <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
        <CalendarRange className="size-4" />
        <span>{getPeriodControlLabel(locale)}</span>
      </div>
      <Select
        value={String(months)}
        onValueChange={(value) => {
          router.replace(buildDashboardHrefForView(currentView, Number(value)), {
            scroll: false,
          });
        }}
      >
        <SelectTrigger className="w-full min-w-[170px] sm:w-[190px]">
          <SelectValue placeholder={getPeriodControlLabel(locale)} />
        </SelectTrigger>
        <SelectContent align="end">
          {DASHBOARD_PERIOD_OPTIONS.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {getPeriodOptionLabel(option, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
