"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  MessageSquareText,
} from "lucide-react";

import { EmptyState } from "@/app/dashboard/_components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatShortDate } from "@/lib/i18n/format";
import { getAppCopy } from "@/lib/i18n/copy";
import {
  useDashboardCommitmentsData,
  type DashboardCommitmentItem,
} from "@/lib/hooks/use-financial-data";
import { ViewSkeleton } from "./view-skeleton";

function toLocalDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateOnly(locale: string, dayKey: string): string {
  return formatShortDate(locale, `${dayKey}T12:00:00.000Z`);
}

function formatRelativeUpdated(locale: string, value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return formatShortDate(locale, date);
}

function getDueBadgeClass(bucket: "overdue" | "today" | "upcoming" | "undated"): string {
  switch (bucket) {
    case "overdue":
      return "border-red-500/30 bg-red-500/10 text-red-500";
    case "today":
      return "border-amber-500/30 bg-amber-500/10 text-amber-500";
    case "upcoming":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-500";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}

function getCommitmentBucket(
  item: DashboardCommitmentItem,
  todayKey: string,
): "overdue" | "today" | "upcoming" | "undated" {
  if (!item.dueDate) return "undated";
  if (item.dueDate < todayKey) return "overdue";
  if (item.dueDate === todayKey) return "today";
  return "upcoming";
}

function MetricCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: number;
  icon: typeof CalendarDays;
}) {
  return (
    <Card className="gap-3">
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="rounded-lg border border-border/60 bg-muted/40 p-2">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {title}
          </div>
          <div className="text-2xl font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function CommitmentRow({
  item,
  locale,
}: {
  item: DashboardCommitmentItem;
  locale: string;
}) {
  const copy = getAppCopy(locale).dashboard.commitments;
  const todayKey = toLocalDayKey();
  const bucket = getCommitmentBucket(item, todayKey);
  const dueLabel = item.dueDate
    ? formatDateOnly(locale, item.dueDate)
    : (item.dueDateLabel ?? copy.noDueDate);
  const updatedLabel = formatRelativeUpdated(locale, item.updatedAt ?? item.createdAt);

  return (
    <Card className="gap-4">
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{item.title}</CardTitle>
              <Badge
                variant="outline"
                className={
                  item.signalType === "deadline"
                    ? "border-blue-500/30 bg-blue-500/10 text-blue-500"
                    : "border-violet-500/30 bg-violet-500/10 text-violet-500"
                }
              >
                {item.signalType === "deadline" ? copy.deadlineBadge : copy.promiseBadge}
              </Badge>
              <Badge variant="outline" className={getDueBadgeClass(bucket)}>
                {bucket === "overdue"
                  ? copy.overdue
                  : bucket === "today"
                    ? copy.dueToday
                    : bucket === "upcoming"
                      ? copy.upcoming
                      : copy.undated}
              </Badge>
            </div>

            {item.summary ? (
              <p className="text-sm text-muted-foreground">{item.summary}</p>
            ) : null}

            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{`${copy.due}: ${dueLabel}`}</Badge>
              {item.threadLabel ? (
                <Badge variant="outline">{`${copy.sourceChat}: ${item.threadLabel}`}</Badge>
              ) : null}
              {updatedLabel ? (
                <Badge variant="outline">{`${copy.lastUpdated}: ${updatedLabel}`}</Badge>
              ) : null}
              {item.sourceMessageCount > 0 ? (
                <Badge variant="outline">{`${copy.evidenceRefs}: ${item.sourceMessageCount}`}</Badge>
              ) : null}
            </div>
          </div>
        </div>

        {item.participants.length > 0 || item.counterparties.length > 0 ? (
          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
            <div>
              <span className="font-medium text-foreground">{copy.participants}:</span>{" "}
              {item.participants.join(", ") || "—"}
            </div>
            <div>
              <span className="font-medium text-foreground">{copy.counterparties}:</span>{" "}
              {item.counterparties.join(", ") || "—"}
            </div>
          </div>
        ) : null}

        {item.risks.length > 0 || item.keyThemes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {item.risks.slice(0, 3).map((risk) => (
              <Badge
                key={`${item.id}:risk:${risk}`}
                className="border-0 bg-red-500/10 text-red-500"
              >
                {risk}
              </Badge>
            ))}
            {item.keyThemes.slice(0, 3).map((theme) => (
              <Badge
                key={`${item.id}:theme:${theme}`}
                variant="secondary"
              >
                {theme}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CommitmentSection({
  title,
  items,
  locale,
}: {
  title: string;
  items: DashboardCommitmentItem[];
  locale: string;
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <Badge variant="outline">{items.length}</Badge>
      </div>
      <div className="grid gap-3">
        {items.map((item) => (
          <CommitmentRow key={item.id} item={item} locale={locale} />
        ))}
      </div>
    </section>
  );
}

export function CommitmentsView() {
  const locale = useLocale();
  const copy = getAppCopy(locale).dashboard.commitments;
  const { data, isLoading, error } = useDashboardCommitmentsData();
  const items = data?.data ?? [];

  const {
    overdue,
    dueToday,
    upcoming,
    undated,
    upcomingSoonCount,
  } = useMemo(() => {
    const todayKey = toLocalDayKey();
    const sevenDaysFromNow = (() => {
      const date = new Date();
      date.setDate(date.getDate() + 7);
      return toLocalDayKey(date);
    })();

    const buckets = {
      overdue: [] as DashboardCommitmentItem[],
      dueToday: [] as DashboardCommitmentItem[],
      upcoming: [] as DashboardCommitmentItem[],
      undated: [] as DashboardCommitmentItem[],
      upcomingSoonCount: 0,
    };

    for (const item of items) {
      const bucket = getCommitmentBucket(item, todayKey);
      if (bucket === "overdue") {
        buckets.overdue.push(item);
        continue;
      }
      if (bucket === "today") {
        buckets.dueToday.push(item);
        continue;
      }
      if (bucket === "upcoming") {
        buckets.upcoming.push(item);
        if (item.dueDate && item.dueDate <= sevenDaysFromNow) {
          buckets.upcomingSoonCount += 1;
        }
        continue;
      }
      buckets.undated.push(item);
    }

    return buckets;
  }, [items]);

  if (isLoading) {
    return <ViewSkeleton variant="list" />;
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={copy.unavailableTitle}
        description={copy.unavailableDescription}
      />
    );
  }

  if (!data?.telegramConnected || data.enabledChatCount === 0) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title={copy.noChatsTitle}
        description={copy.noChatsDescription}
        actionLabel={copy.connectAction}
        actionHref="/integrations"
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title={copy.noSignalsTitle}
        description={copy.noSignalsDescription}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>{copy.title}</CardTitle>
          <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title={copy.open} value={items.length} icon={CalendarDays} />
          <MetricCard title={copy.overdue} value={overdue.length} icon={AlertTriangle} />
          <MetricCard title={copy.dueToday} value={dueToday.length} icon={Clock3} />
          <MetricCard title={copy.upcomingWindow} value={upcomingSoonCount} icon={CalendarClock} />
        </CardContent>
      </Card>

      <CommitmentSection title={copy.overdue} items={overdue} locale={locale} />
      <CommitmentSection title={copy.dueToday} items={dueToday} locale={locale} />
      <CommitmentSection title={copy.upcoming} items={upcoming} locale={locale} />
      <CommitmentSection title={copy.undated} items={undated} locale={locale} />
    </div>
  );
}
