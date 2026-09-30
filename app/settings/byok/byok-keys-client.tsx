"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ByokProvider, UserApiKeySummary } from "@/lib/auth/user-api-keys";

const PROVIDER_LABEL: Record<ByokProvider, string> = {
  openai: "OpenAI API key",
  codex: "Codex (ChatGPT auth token)",
};

const PROVIDER_PLACEHOLDER: Record<ByokProvider, string> = {
  openai: "sk-...",
  codex: "Paste your Codex auth token (sk-... or session ID)",
};

interface Props {
  tier: string;
  initialKeys: UserApiKeySummary[];
}

export function ByokKeysClient({ tier, initialKeys }: Props) {
  const [keys, setKeys] = useState<UserApiKeySummary[]>(initialKeys);
  const [provider, setProvider] = useState<ByokProvider>("openai");
  const [plaintext, setPlaintext] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();

  const isCommunity = tier === "community";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!plaintext.trim()) {
      setError("Paste your key first.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/user/provider-keys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, key: plaintext, label: label || null }),
        });
        const data = (await res.json()) as { key?: UserApiKeySummary; error?: string };
        if (!res.ok || !data.key) {
          throw new Error(data.error || "Failed to save key");
        }
        setKeys((prev) => {
          const filtered = prev.filter((k) => k.provider !== data.key!.provider);
          return [...filtered, data.key!];
        });
        setPlaintext("");
        setLabel("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this key? You won't be able to chat until you add a new one.")) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/user/provider-keys?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Failed to delete key");
        }
        setKeys((prev) => prev.filter((k) => k.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <div className="space-y-6">
      {!isCommunity && (
        <div className="rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Your account is on the <strong>{tier}</strong> tier — the system already runs on shared
          credentials. You can still add a personal key here, but it won&apos;t be used until your
          account is moved to the <strong>community</strong> tier.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add or replace a key</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as ByokProvider)}>
                <SelectTrigger id="provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROVIDER_LABEL) as ByokProvider[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PROVIDER_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="key">Key</Label>
              <Input
                id="key"
                type="password"
                autoComplete="off"
                placeholder={PROVIDER_PLACEHOLDER[provider]}
                value={plaintext}
                onChange={(e) => setPlaintext(e.target.value)}
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Stored encrypted. Replacing an existing key for the same provider overwrites the
                previous value.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="label">Label (optional)</Label>
              <Input
                id="label"
                type="text"
                placeholder="e.g. personal-OpenAI-2026"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={submitting}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save key
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys saved yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium">
                      {PROVIDER_LABEL[k.provider] ?? k.provider}{" "}
                      <span className="font-mono text-muted-foreground">{k.preview}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {k.label ? `${k.label} — ` : ""}added {new Date(k.createdAt).toLocaleString()}
                      {k.lastUsedAt
                        ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}`
                        : " · never used"}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(k.id)}
                    disabled={submitting}
                    aria-label="Remove key"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
