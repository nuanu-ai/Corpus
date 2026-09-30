"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Copy, ExternalLink, Loader2, MessageCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type TelegramBotLinkResponse = {
  ok?: boolean;
  ticket?: string;
  deepLink?: string;
  expiresAt?: string;
  error?: string;
};

function formatExpiry(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TelegramBotLinkCard() {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createLink(openAfterCreate: boolean) {
    setLoading(true);
    setCopied(false);
    setError(null);

    try {
      const response = await fetch("/api/telegram-bot/link", {
        method: "POST",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as TelegramBotLinkResponse;
      if (!response.ok || !payload.deepLink) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Telegram bot link failed (${response.status})`,
        );
      }

      setDeepLink(payload.deepLink);
      setExpiresAt(typeof payload.expiresAt === "string" ? payload.expiresAt : null);
      if (openAfterCreate) {
        window.open(payload.deepLink, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create Telegram bot link");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!deepLink) return;
    await navigator.clipboard.writeText(deepLink);
    setCopied(true);
  }

  const expiryLabel = formatExpiry(expiresAt);

  return (
    <Card className="border-sky-500/30 bg-sky-500/5">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="size-4 text-sky-400" />
              Corpus Telegram bot
              <Badge variant="secondary">DM beta</Badge>
            </CardTitle>
            <CardDescription>
              Link your Telegram account to this Corpus account, then ask company questions or upload documents in DM.
            </CardDescription>
          </div>
          <Button type="button" onClick={() => void createLink(true)} disabled={loading}>
            {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ExternalLink className="mr-2 size-4" />}
            Connect in Telegram
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">
          Opens <span className="font-medium text-foreground">@corpuscity_bot</span>. The link is single-use and expires in 10 minutes.
        </div>

        {deepLink ? (
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{deepLink}</div>
                {expiryLabel ? (
                  <div className="text-xs text-muted-foreground">Expires {expiryLabel}</div>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
                  {copied ? <CheckCircle2 className="mr-2 size-3.5" /> : <Copy className="mr-2 size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button type="button" variant="outline" size="sm" asChild>
                  <a href={deepLink} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="size-4" />
            {error}
          </div>
        ) : null}

        <div className="text-xs text-muted-foreground">
          Current scope: direct messages only. Group binding and mention/reply behavior are still separate roadmap items.
        </div>
      </CardContent>
    </Card>
  );
}
