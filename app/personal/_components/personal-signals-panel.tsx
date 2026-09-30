"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Inbox } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PersonalSignalRow {
  id: string;
  signalType: string;
  targetDomain: string;
  title: string;
  summary: string;
  sourceProvider: string | null;
  sourceLabel: string | null;
  confidenceScore: string | null;
  createdAt: string;
}

interface PersonalSignalsPayload {
  data: PersonalSignalRow[];
  count: number;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PersonalSignalsPanel() {
  const [payload, setPayload] = useState<PersonalSignalsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/personal/communications/signals", {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`Failed to load personal signals (${res.status})`);
        }
        const next = (await res.json()) as PersonalSignalsPayload;
        if (!cancelled) {
          setPayload(next);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load personal signals");
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="size-4" />
          Pending signals
        </CardTitle>
        <CardDescription>Unapproved communication-derived intake for your personal tenant.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading pending signals…</div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="size-4" />
            {error}
          </div>
        ) : !payload || payload.data.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
            No pending personal signals right now.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{payload.count}</Badge>
              awaiting review or promotion
            </div>
            <div className="space-y-3">
              {payload.data.map((signal) => (
                <div key={signal.id} className="rounded-lg border border-border/70 bg-card/50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{signal.title}</div>
                    <Badge variant="outline">{signal.signalType}</Badge>
                    <Badge variant="secondary">{signal.targetDomain}</Badge>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{signal.summary}</div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {signal.sourceProvider ? (
                      <Badge variant="outline">{signal.sourceProvider}</Badge>
                    ) : null}
                    {signal.sourceLabel ? (
                      <Badge variant="outline">{signal.sourceLabel}</Badge>
                    ) : null}
                    {signal.confidenceScore ? (
                      <Badge variant="outline">confidence {signal.confidenceScore}</Badge>
                    ) : null}
                    <Badge variant="outline">{formatTimestamp(signal.createdAt)}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
