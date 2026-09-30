"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarClock, Clock3, ListTodo } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardCommitmentItem } from "@/lib/communications/commitments";

interface PersonalCommitmentsPayload {
  data: DashboardCommitmentItem[];
  count: number;
  summary: {
    path: string;
    body: string;
    frontmatter: Record<string, unknown>;
  } | null;
  generatedAt: string;
}

function toLocalDayKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(dayKey: string | null, fallback: string | null): string {
  if (dayKey) {
    const date = new Date(`${dayKey}T12:00:00.000Z`);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  }
  return fallback ?? "No due date";
}

function getBucket(item: DashboardCommitmentItem, todayKey: string): "overdue" | "today" | "upcoming" | "undated" {
  if (!item.dueDate) return "undated";
  if (item.dueDate < todayKey) return "overdue";
  if (item.dueDate === todayKey) return "today";
  return "upcoming";
}

export function PersonalCommitmentsView() {
  const [payload, setPayload] = useState<PersonalCommitmentsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/personal/commitments", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`Failed to load personal commitments (${res.status})`);
        }
        const next = (await res.json()) as PersonalCommitmentsPayload;
        if (!cancelled) {
          setPayload(next);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load personal commitments");
          setPayload(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const items = payload?.data ?? [];
  const todayKey = toLocalDayKey();
  const metrics = useMemo(() => {
    const counts = {
      total: items.length,
      overdue: 0,
      today: 0,
      upcoming: 0,
      undated: 0,
    };

    for (const item of items) {
      counts[getBucket(item, todayKey)] += 1;
    }

    return counts;
  }, [items, todayKey]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Total</CardTitle>
            <CardDescription>Open commitments and deadlines</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{metrics.total}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Overdue</CardTitle>
            <CardDescription>Needs immediate attention</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{metrics.overdue}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Due today</CardTitle>
            <CardDescription>Time-sensitive items</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{metrics.today}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Upcoming</CardTitle>
            <CardDescription>Scheduled beyond today</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{metrics.upcoming}</CardContent>
        </Card>
      </div>

      {payload?.summary ? (
        <Card>
          <CardHeader>
            <CardTitle>Commitments summary</CardTitle>
            <CardDescription>{payload.summary.path}</CardDescription>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {payload.summary.body?.trim().length
              ? payload.summary.body
              : "No commitments summary body yet."}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListTodo className="size-4" />
            Open items
          </CardTitle>
          <CardDescription>Derived from personal communications signals already promoted into the person schema pack.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading commitments…</div>
          ) : error ? (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="size-4" />
              {error}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
              No personal commitments surfaced yet.
            </div>
          ) : (
            items.map((item) => {
              const bucket = getBucket(item, todayKey);
              return (
                <div key={item.id} className="rounded-lg border border-border/70 bg-card/50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{item.title}</div>
                    <Badge variant="outline">{item.signalType}</Badge>
                    <Badge
                      className={
                        bucket === "overdue"
                          ? "border-0 bg-red-500/15 text-red-400"
                          : bucket === "today"
                            ? "border-0 bg-amber-500/15 text-amber-300"
                            : bucket === "upcoming"
                              ? "border-0 bg-emerald-500/15 text-emerald-400"
                              : "border-0 bg-muted text-muted-foreground"
                      }
                    >
                      {bucket}
                    </Badge>
                  </div>
                  {item.summary ? (
                    <div className="mt-2 text-sm text-muted-foreground">{item.summary}</div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">
                      <CalendarClock className="mr-1 size-3" />
                      {formatDate(item.dueDate, item.dueDateLabel)}
                    </Badge>
                    {item.threadLabel ? <Badge variant="outline">{item.threadLabel}</Badge> : null}
                    {item.sourceMessageCount > 0 ? (
                      <Badge variant="outline">{item.sourceMessageCount} evidence refs</Badge>
                    ) : null}
                    {item.updatedAt ?? item.createdAt ? (
                      <Badge variant="outline">
                        <Clock3 className="mr-1 size-3" />
                        {new Date(item.updatedAt ?? item.createdAt ?? "").toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
