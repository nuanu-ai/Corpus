"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import ChatPanel from "@/app/dashboard/_components/chat-panel.legacy";
import { Button } from "@/components/ui/button";

interface EmbedChatShellProps {
  companyId: string | null;
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null);
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

export function EmbedChatShell({ companyId }: EmbedChatShellProps) {
  const [isReady, setIsReady] = useState(companyId === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function syncActiveCompany() {
      if (!companyId) {
        setIsReady(true);
        setError(null);
        return;
      }

      setIsReady(false);
      setError(null);

      try {
        const response = await fetch("/api/companies/active", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ companyId }),
        });

        if (!response.ok) {
          throw new Error(await getErrorMessage(response, "Failed to switch Corpus company"));
        }

        if (!cancelled) {
          setIsReady(true);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error ? nextError.message : "Failed to switch Corpus company",
          );
          setIsReady(false);
        }
      }
    }

    void syncActiveCompany();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-destructive/10 p-2 text-destructive">
              <AlertTriangle className="size-5" />
            </div>
            <div className="space-y-2">
              <h1 className="text-lg font-semibold text-foreground">Corpus chat is not ready</h1>
              <p className="text-sm text-muted-foreground">{error}</p>
              <p className="text-sm text-muted-foreground">
                Open Corpus directly to confirm your session has access to this company, then reload
                this embedded view.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button asChild>
              <a href="/dashboard" target="_blank" rel="noreferrer">
                Open Corpus
                <ExternalLink className="size-4" />
              </a>
            </Button>
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              Reload chat
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Preparing Corpus chat...
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background">
      <ChatPanel key={companyId ?? "active-company"} />
    </div>
  );
}
