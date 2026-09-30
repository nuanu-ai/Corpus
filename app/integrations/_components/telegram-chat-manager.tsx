"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, MessageSquare, RefreshCw, Save, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface TelegramChatRow {
  chatId: string;
  title: string;
  type: string;
  enabled: boolean;
  lastSyncedMessageId: number;
}

export function TelegramChatManager() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [phone, setPhone] = useState<string>("");
  const [chats, setChats] = useState<TelegramChatRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadChats = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/connections/telegram/chats");
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Telegram chat load failed (${response.status})`,
        );
      }

      setConnectionId(typeof payload.connectionId === "string" ? payload.connectionId : null);
      setPhone(typeof payload.phone === "string" ? payload.phone : "");
      setChats(
        Array.isArray(payload.chats)
          ? payload.chats
              .map((chat: unknown) => {
                const value =
                  chat && typeof chat === "object"
                    ? (chat as Record<string, unknown>)
                    : {};
                if (typeof value.chatId !== "string") return null;
                return {
                  chatId: value.chatId,
                  title: typeof value.title === "string" ? value.title : "Telegram chat",
                  type: typeof value.type === "string" ? value.type : "group",
                  enabled: Boolean(value.enabled),
                  lastSyncedMessageId:
                    typeof value.lastSyncedMessageId === "number"
                      ? value.lastSyncedMessageId
                      : 0,
                } satisfies TelegramChatRow;
              })
              .filter((chat: TelegramChatRow | null): chat is TelegramChatRow => Boolean(chat))
          : [],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Telegram chats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  const filteredChats = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return chats;
    return chats.filter((chat) => {
      return (
        chat.title.toLowerCase().includes(needle) ||
        chat.type.toLowerCase().includes(needle) ||
        chat.chatId.toLowerCase().includes(needle)
      );
    });
  }, [chats, query]);

  const enabledCount = chats.filter((chat) => chat.enabled).length;

  const toggleChat = useCallback((chatId: string) => {
    setChats((current) =>
      current.map((chat) =>
        chat.chatId === chatId ? { ...chat, enabled: !chat.enabled } : chat,
      ),
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!connectionId) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/connections/telegram/select-chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, chats }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Telegram chat save failed (${response.status})`,
        );
      }

      setNotice(`Saved ${enabledCount} enabled chat${enabledCount === 1 ? "" : "s"}.`);
      const refresh = (window as unknown as Record<string, unknown>).__refreshConnections;
      if (typeof refresh === "function") {
        (refresh as () => void)();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Telegram chats");
    } finally {
      setSaving(false);
    }
  }, [chats, connectionId, enabledCount]);

  const handleSyncNow = useCallback(async () => {
    if (!connectionId) return;

    setSyncing(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/connections/${connectionId}/sync`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Telegram sync failed (${response.status})`,
        );
      }

      setNotice("Telegram sync triggered.");
      const refresh = (window as unknown as Record<string, unknown>).__refreshConnections;
      if (typeof refresh === "function") {
        (refresh as () => void)();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trigger Telegram sync");
    } finally {
      setSyncing(false);
    }
  }, [connectionId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="size-4" />
          Manage Telegram Chats
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void loadChats()}
            className="ml-auto text-muted-foreground"
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {phone ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Connected phone</span>
            <Badge variant="outline" className="font-mono text-[11px]">
              {phone}
            </Badge>
            <span>{enabledCount} enabled</span>
          </div>
        ) : null}

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats by title, type, or ID"
            className="pl-8"
          />
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-6 text-sm text-muted-foreground">
            No chats match the current filter.
          </div>
        ) : (
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {filteredChats.map((chat) => (
              <label
                key={chat.chatId}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border/60 px-3 py-2 hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={chat.enabled}
                  onChange={() => toggleChat(chat.chatId)}
                  className="mt-0.5 rounded border-border"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {chat.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {chat.type} · {chat.chatId}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void handleSave()}
            disabled={saving || !connectionId}
          >
            {saving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            Save Chat Selection
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleSyncNow()}
            disabled={syncing || !connectionId || enabledCount === 0}
          >
            {syncing ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Sync Now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
