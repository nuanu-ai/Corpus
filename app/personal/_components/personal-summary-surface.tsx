"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, FileText, RefreshCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PersonalSummaryPayload {
  domain: string;
  summary: {
    path: string;
    body: string;
    frontmatter: Record<string, unknown>;
  } | null;
  generatedAt: string;
}

function formatTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getMetricEntries(frontmatter: Record<string, unknown>): Array<{ key: string; value: string }> {
  const keyMetrics =
    frontmatter.key_metrics && typeof frontmatter.key_metrics === "object"
      ? (frontmatter.key_metrics as Record<string, unknown>)
      : {};

  return Object.entries(keyMetrics)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim().length > 0)
    .slice(0, 6)
    .map(([key, value]) => ({
      key,
      value: String(value),
    }));
}

export function PersonalSummarySurface({
  domain,
  emptyLabel,
}: {
  domain: "inbox" | "today" | "timeline" | "workspaces" | "commitments";
  emptyLabel: string;
}) {
  const [payload, setPayload] = useState<PersonalSummaryPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/personal/summary/${domain}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`Failed to load ${domain} summary (${res.status})`);
        }
        const next = (await res.json()) as PersonalSummaryPayload;
        if (!cancelled) {
          setPayload(next);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : `Failed to load ${domain} summary`);
          setPayload(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [domain, refreshKey]);

  const metricEntries = useMemo(
    () => (payload?.summary ? getMetricEntries(payload.summary.frontmatter) : []),
    [payload],
  );

  const refreshedAt = payload?.summary
    ? formatTimestamp(payload.summary.frontmatter.updated_at ?? payload.summary.frontmatter.generated_at)
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="capitalize">{domain}</CardTitle>
          <CardDescription>
            Materialized summary from your personal tenant schema pack.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={isLoading}
        >
          <RefreshCcw className="mr-2 size-4" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading summary…</div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="size-4" />
            {error}
          </div>
        ) : !payload?.summary ? (
          <div className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{payload.summary.path}</Badge>
              {refreshedAt ? <Badge variant="secondary">Updated {refreshedAt}</Badge> : null}
              {typeof payload.summary.frontmatter.source_entity_count !== "undefined" ? (
                <Badge variant="secondary">
                  Sources {String(payload.summary.frontmatter.source_entity_count)}
                </Badge>
              ) : null}
            </div>

            {metricEntries.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {metricEntries.map((entry) => (
                  <div
                    key={entry.key}
                    className="rounded-lg border border-border/70 bg-muted/30 p-3"
                  >
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {entry.key.replace(/_/g, " ")}
                    </div>
                    <div className="mt-1 text-sm font-medium">{entry.value}</div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="rounded-xl border border-border/70 bg-card/50 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <FileText className="size-4 text-muted-foreground" />
                {typeof payload.summary.frontmatter.title === "string"
                  ? payload.summary.frontmatter.title
                  : `${domain} summary`}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {payload.summary.body?.trim().length
                  ? payload.summary.body
                  : "Summary body is empty."}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
