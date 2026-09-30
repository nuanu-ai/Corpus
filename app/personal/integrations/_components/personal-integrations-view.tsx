"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  Shield,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PersonalConnectionRow {
  id: string;
  provider: string;
  status: string;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
}

interface PersonalEmailIngestState {
  provider: "email_ingest";
  address: string;
  token: string;
  rotated: boolean;
}

interface TelegramChatRow {
  chatId: string;
  title: string;
  type: string;
  enabled: boolean;
  lastSyncedMessageId: number;
}

interface TelegramParticipantRow {
  participantId: string;
  displayName: string;
  telegramHandle?: string;
  isBot: boolean;
  relatedCompanies: string;
  analysisContext: string;
  contactFilePath?: string | null;
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function humanizeProvider(provider: string) {
  switch (provider) {
    case "email_ingest":
      return "Email forwarding";
    case "google_drive":
      return "Google Drive";
    case "telegram":
      return "Telegram";
    default:
      return provider.replace(/_/g, " ");
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="border-0 bg-emerald-500/15 text-emerald-400">Active</Badge>;
    case "error":
      return <Badge className="border-0 bg-red-500/15 text-red-400">Error</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function splitLines(value: string): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const row of value.split(/\r?\n|,/)) {
    const trimmed = row.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
  }
  return next;
}

function PersonalTelegramCard({ onConnected }: { onConnected: () => void }) {
  const [step, setStep] = useState<"phone" | "code" | "password" | "chats">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loginState, setLoginState] = useState("");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [chats, setChats] = useState<TelegramChatRow[]>([]);
  const [selectedChatId, setSelectedChatId] = useState("");
  const [participants, setParticipants] = useState<TelegramParticipantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingContext, setSavingContext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadChats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/personal/connections/telegram/chats", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 404) {
        setStep("phone");
        setChats([]);
        setConnectionId(null);
        return;
      }
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Telegram chat load failed (${response.status})`,
        );
      }
      setConnectionId(typeof payload.connectionId === "string" ? payload.connectionId : null);
      setPhone(typeof payload.phone === "string" ? payload.phone : "");
      const nextChats: TelegramChatRow[] = Array.isArray(payload.chats)
        ? payload.chats.flatMap((chat: unknown) => {
            if (!chat || typeof chat !== "object") return [];
            const source = chat as Record<string, unknown>;
            if (typeof source.chatId !== "string") return [];
            return [{
              chatId: source.chatId,
              title: typeof source.title === "string" ? source.title : "Telegram chat",
              type: typeof source.type === "string" ? source.type : "group",
              enabled: Boolean(source.enabled),
              lastSyncedMessageId:
                typeof source.lastSyncedMessageId === "number"
                  ? source.lastSyncedMessageId
                  : 0,
            }];
          })
        : [];
      setChats(nextChats);
      const firstEnabled = nextChats.find((chat) => chat.enabled)?.chatId ?? "";
      setSelectedChatId((current) =>
        current && nextChats.some((chat) => chat.chatId === current && chat.enabled)
          ? current
          : firstEnabled,
      );
      setStep("chats");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Telegram chats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  const enabledChats = chats.filter((chat) => chat.enabled);

  async function sendCode() {
    if (!phone.trim()) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/personal/connections/telegram/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Telegram auth failed");
      }
      setPhone(typeof payload.phone === "string" ? payload.phone : phone.trim());
      setLoginState(typeof payload.loginState === "string" ? payload.loginState : "");
      setCode("");
      setPassword("");
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send Telegram code");
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (!loginState) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/personal/connections/telegram/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          code: step === "code" ? code.trim() : undefined,
          password: step === "password" ? password : undefined,
          loginState,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Telegram verification failed",
        );
      }
      if (payload.requiresPassword) {
        setLoginState(typeof payload.loginState === "string" ? payload.loginState : loginState);
        setStep("password");
        return;
      }
      if (typeof payload.connectionId === "string") setConnectionId(payload.connectionId);
      onConnected();
      await loadChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Telegram verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveChats() {
    if (!connectionId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/personal/connections/telegram/select-chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, chats }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Telegram chat selection failed",
        );
      }
      setNotice(`Saved ${payload.enabledChats ?? enabledChats.length} selected chat(s).`);
      onConnected();
      await loadChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save Telegram chats");
    } finally {
      setLoading(false);
    }
  }

  async function loadParticipants(chatId = selectedChatId) {
    if (!chatId) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/personal/connections/telegram/participants?chatId=${encodeURIComponent(chatId)}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Telegram participants load failed",
        );
      }
      setSelectedChatId(chatId);
      const nextParticipants: TelegramParticipantRow[] = Array.isArray(payload.participants)
          ? payload.participants.flatMap((participant: unknown) => {
              if (!participant || typeof participant !== "object") return [];
              const source = participant as Record<string, unknown>;
              if (typeof source.participantId !== "string") return [];
              return [{
                participantId: source.participantId,
                displayName:
                  typeof source.displayName === "string"
                    ? source.displayName
                    : "Telegram user",
                telegramHandle:
                  typeof source.telegramHandle === "string"
                    ? source.telegramHandle
                    : undefined,
                isBot: Boolean(source.isBot),
                relatedCompanies: Array.isArray(source.relatedCompanies)
                  ? source.relatedCompanies.filter((item): item is string => typeof item === "string").join("\n")
                  : "",
                analysisContext:
                  typeof source.analysisContext === "string" ? source.analysisContext : "",
                contactFilePath:
                  typeof source.contactFilePath === "string" ? source.contactFilePath : null,
              }];
            })
          : [];
      setParticipants(nextParticipants);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Telegram participants");
    } finally {
      setLoading(false);
    }
  }

  async function savePeopleContext() {
    if (!connectionId || !selectedChatId) return;
    setSavingContext(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/personal/connections/telegram/people-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          peopleContext: participants.map((participant) => ({
            chatId: selectedChatId,
            participantId: participant.participantId,
            displayName: participant.displayName,
            telegramHandle: participant.telegramHandle,
            relatedCompanies: splitLines(participant.relatedCompanies),
            analysisContext: participant.analysisContext,
            contactFilePath: participant.contactFilePath,
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Telegram people context save failed",
        );
      }
      setNotice(`Saved context for ${payload.saved ?? participants.length} participant(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save people context");
    } finally {
      setSavingContext(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4" />
          Telegram personal chats
        </CardTitle>
        <CardDescription>
          Connect your own Telegram account, select chats, and add private per-person context for analysis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="size-4" />
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
            {notice}
          </div>
        ) : null}

        {step === "phone" ? (
          <div className="space-y-3">
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+62812345678"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <Button type="button" onClick={() => void sendCode()} disabled={loading || !phone.trim()}>
              {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Send Telegram code
            </Button>
          </div>
        ) : null}

        {step === "code" ? (
          <div className="space-y-3">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Telegram code"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <Button type="button" onClick={() => void verify()} disabled={loading || !code.trim()}>
              {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Verify code
            </Button>
          </div>
        ) : null}

        {step === "password" ? (
          <div className="space-y-3">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Telegram 2FA password"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <Button type="button" onClick={() => void verify()} disabled={loading || !password}>
              {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Verify password
            </Button>
          </div>
        ) : null}

        {step === "chats" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{phone || "Telegram connected"}</Badge>
              <span>{enabledChats.length} selected chat(s)</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void loadChats()} disabled={loading}>
                {loading ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <RefreshCw className="mr-2 size-3.5" />}
                Refresh
              </Button>
            </div>

            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border/70 p-2">
              {chats.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">
                  {loading ? "Loading Telegram chats..." : "No chats available."}
                </div>
              ) : (
                chats.map((chat) => (
                  <label key={chat.chatId} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/40">
                    <input
                      type="checkbox"
                      checked={chat.enabled}
                      onChange={() =>
                        setChats((current) =>
                          current.map((item) =>
                            item.chatId === chat.chatId ? { ...item, enabled: !item.enabled } : item,
                          ),
                        )
                      }
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{chat.title}</span>
                      <span className="block text-xs text-muted-foreground">{chat.type} · {chat.chatId}</span>
                    </span>
                  </label>
                ))
              )}
            </div>

            <Button type="button" onClick={() => void saveChats()} disabled={loading || !connectionId}>
              {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Save selected chats
            </Button>

            {enabledChats.length > 0 ? (
              <div className="space-y-3 rounded-lg border border-border/70 p-3">
                <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    value={selectedChatId}
                    onChange={(event) => setSelectedChatId(event.target.value)}
                    className="h-9 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {enabledChats.map((chat) => (
                      <option key={chat.chatId} value={chat.chatId}>
                        {chat.title}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void loadParticipants()}
                    disabled={loading || !selectedChatId}
                  >
                    Load people
                  </Button>
                </div>

                {participants.length > 0 ? (
                  <div className="space-y-3">
                    {participants.map((participant, index) => (
                      <div key={participant.participantId} className="space-y-2 rounded-md border border-border/60 p-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium">{participant.displayName}</span>
                          {participant.telegramHandle ? (
                            <Badge variant="outline">@{participant.telegramHandle}</Badge>
                          ) : null}
                          {participant.isBot ? <Badge variant="secondary">bot</Badge> : null}
                        </div>
                        <textarea
                          value={participant.relatedCompanies}
                          onChange={(event) =>
                            setParticipants((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, relatedCompanies: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          rows={2}
                          className="min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          placeholder="Related companies, one per line. Can include external companies."
                        />
                        <textarea
                          value={participant.analysisContext}
                          onChange={(event) =>
                            setParticipants((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, analysisContext: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          rows={3}
                          className="min-h-[90px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          placeholder="Private context for analysis: who this is, what topics matter, how to interpret messages."
                        />
                      </div>
                    ))}
                    <Button
                      type="button"
                      onClick={() => void savePeopleContext()}
                      disabled={savingContext || !connectionId}
                    >
                      {savingContext ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                      Save people context
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                    Load people from a selected chat to add context.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function PersonalIntegrationsView() {
  const [connections, setConnections] = useState<PersonalConnectionRow[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [emailState, setEmailState] = useState<PersonalEmailIngestState | null>(null);
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailCopied, setEmailCopied] = useState(false);

  const loadConnections = useCallback(async () => {
    setConnectionsError(null);
    try {
      const response = await fetch("/api/personal/connections", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => []);
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : `Failed to load personal integrations (${response.status})`,
        );
      }

      const rows = Array.isArray(payload) ? (payload as PersonalConnectionRow[]) : [];
      rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      setConnections(rows);
    } catch (err) {
      setConnectionsError(
        err instanceof Error ? err.message : "Failed to load personal integrations",
      );
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  const loadEmailState = useCallback(async (method: "GET" | "POST" = "GET") => {
    setEmailError(null);
    setEmailLoading(true);
    try {
      const response = await fetch("/api/personal/connections/providers/email-ingest", {
        method,
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Failed to load personal email forwarding (${response.status})`,
        );
      }

      if (typeof payload.address !== "string" || payload.address.trim().length === 0) {
        throw new Error("Personal email forwarding address is missing.");
      }

      setEmailState({
        provider: "email_ingest",
        address: payload.address,
        token: typeof payload.token === "string" ? payload.token : "",
        rotated: Boolean(payload.rotated),
      });
    } catch (err) {
      setEmailError(
        err instanceof Error ? err.message : "Failed to load personal email forwarding",
      );
    } finally {
      setEmailLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadConnections(), loadEmailState("GET")]);
  }, [loadConnections, loadEmailState]);

  const activeConnectionCount = useMemo(
    () => connections.filter((connection) => connection.status === "active").length,
    [connections],
  );

  const handleCopyAddress = useCallback(async () => {
    if (!emailState?.address) return;

    try {
      await navigator.clipboard.writeText(emailState.address);
      setEmailCopied(true);
      window.setTimeout(() => setEmailCopied(false), 1500);
    } catch {
      setEmailError("Could not copy the personal forwarding address.");
    }
  }, [emailState?.address]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Live now</CardTitle>
            <CardDescription>Personal-safe integrations in production</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">2</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Connection rows</CardTitle>
            <CardDescription>Personal project connection records</CardDescription>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{activeConnectionCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Access mode</CardTitle>
            <CardDescription>How this surface is exposed</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-sm font-medium">
            <Shield className="size-4 text-muted-foreground" />
            Session only
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="size-4" />
              Personal email forwarding
            </CardTitle>
            <CardDescription>
              Forward emails with attachments here to push files into your personal document pipeline. This is not a full mailbox sync.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 font-mono text-xs break-all text-foreground">
              {emailLoading ? "Loading personal forwarding address..." : emailState?.address ?? "No forwarding address available"}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleCopyAddress()}
                disabled={emailLoading || !emailState?.address}
              >
                <Copy className="mr-2 size-3.5" />
                {emailCopied ? "Copied" : "Copy"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadEmailState("POST")}
                disabled={emailLoading}
              >
                {emailLoading ? (
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-3.5" />
                )}
                Rotate address
              </Button>
            </div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p>- attachments go through the existing personal document ingestion path</p>
              <p>- this surface stays outside bearer API keys and external agents for now</p>
              <p>- personal communications sync is intentionally not enabled in this slice</p>
            </div>

            {emailError ? (
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertCircle className="size-4" />
                {emailError}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <PersonalTelegramCard onConnected={loadConnections} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Existing personal connection rows</CardTitle>
          <CardDescription>
            Manual providers that already have a stored encrypted connection on your personal project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connectionsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading personal connectors
            </div>
          ) : connectionsError ? (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle className="size-4" />
              {connectionsError}
            </div>
          ) : connections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
              No personal connector rows yet. Email forwarding is live even though it does not create a connection row.
            </div>
          ) : (
            <div className="space-y-3">
              {connections.map((connection) => (
                <div
                  key={connection.id}
                  className="rounded-xl border border-border/70 bg-card/60 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="font-medium capitalize">{humanizeProvider(connection.provider)}</div>
                        {statusBadge(connection.status)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Created {formatDate(connection.createdAt)} · last sync {formatDate(connection.lastSyncAt)}
                      </div>
                      {connection.lastError ? (
                        <div className="flex items-center gap-2 text-sm text-red-400">
                          <AlertCircle className="size-4" />
                          {connection.lastError}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-emerald-400">
                          <CheckCircle2 className="size-4" />
                          No current connector error
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">ID {connection.id}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
