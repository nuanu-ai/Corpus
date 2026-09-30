"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useLocale } from "next-intl";
import { MessageSquareWarning } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDocumentsData } from "@/lib/hooks/use-financial-data";
import {
  buildDocumentQuestionFeed,
  type DocumentQuestionSource,
} from "@/lib/documents/question-feed";
import { getAppCopy } from "@/lib/i18n/copy";
import { pickPluralWord } from "@/lib/i18n/format";

export function DocumentQuestionsSummary() {
  const locale = useLocale();
  const copy = getAppCopy(locale).dashboard.documentQuestions;
  const { data, isLoading } = useDocumentsData({ refreshIntervalMs: 10000, limit: 50 });
  const feed = useMemo(
    () => buildDocumentQuestionFeed(
      Array.isArray(data) ? (data as DocumentQuestionSource[]) : [],
      { limit: 4 },
    ),
    [data],
  );

  if (!isLoading && feed.documentCount === 0) {
    return null;
  }

  return (
    <Card id="document-questions-summary" className="border-blue-500/20 bg-blue-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareWarning className="size-4 text-blue-400" />
              {copy.title}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {copy.subtitle}
            </p>
          </div>
          <div className="rounded-full bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-400">
            {feed.totalRequestCount} {pickPluralWord(locale, feed.totalRequestCount, {
              one: locale === "ru" ? "открытый запрос" : locale === "id" ? "permintaan terbuka" : "open request",
              few: "открытых запроса",
              many: "открытых запросов",
              other: locale === "id" ? "permintaan terbuka" : "open requests",
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {feed.items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-blue-500/20 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
            {copy.scanning}
          </div>
        ) : (
          <div className="space-y-2">
            {feed.items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="block rounded-lg border border-blue-500/15 bg-background/80 px-4 py-3 transition-colors hover:border-blue-400/40 hover:bg-background"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium">{item.fileName}</p>
                    <p className="text-xs text-muted-foreground">{item.summary}</p>
                    <p className="truncate text-[11px] text-muted-foreground/80">
                      {item.sourcePath ?? item.sourceLabel}
                    </p>
                  </div>
                  <div className="rounded-full bg-blue-500/10 px-2 py-1 text-[11px] font-medium text-blue-400">
                    {item.requestCount}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link href="/documents#document-questions">{copy.open}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
