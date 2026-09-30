"use client";

import { useState, useEffect } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Plug, FileUp, MessageSquare, Sparkles, Building2 } from "lucide-react";
import { getAppCopy } from "@/lib/i18n/copy";

/**
 * Welcome card shown at the top of the dashboard for new users
 * who have no financial connections yet. Provides quick-action
 * buttons to help them get started.
 */
export function WelcomeCard() {
  const locale = useLocale();
  const copy = getAppCopy(locale).dashboard.welcome;
  const router = useRouter();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("welcome-dismissed") === "1";
  });
  const [hasConnections, setHasConnections] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if user has any connections (i.e. is not a brand-new user)
    fetch("/api/connections")
      .then(async (res) => {
        if (!res.ok) {
          // If API is unavailable (demo mode), show the card
          setHasConnections(false);
          return;
        }
        const data = await res.json();
        const connections = Array.isArray(data) ? data : data.connections ?? [];
        setHasConnections(connections.length > 0);
      })
      .catch(() => {
        // Network error or demo mode — show the card
        setHasConnections(false);
      });
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem("welcome-dismissed", "1");
  };

  // Don't render while loading, if user has connections, or if dismissed
  if (hasConnections === null || hasConnections || dismissed) {
    return null;
  }

  return (
    <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors z-10"
        aria-label={copy.dismiss}
      >
        <X className="size-4" />
      </button>

      <CardContent className="pt-5 pb-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="size-5 text-primary" />
          <h3 className="text-base font-semibold text-foreground">
            {copy.title}
          </h3>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">
            {copy.badge}
          </Badge>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {copy.description}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-2 h-auto py-2.5 px-3"
            onClick={() => router.push("/integrations")}
          >
            <div className="size-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Plug className="size-3.5 text-primary" />
            </div>
            <div className="text-left">
              <p className="text-xs font-medium">{copy.connect.title}</p>
              <p className="text-[10px] text-muted-foreground">{copy.connect.subtitle}</p>
            </div>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-2 h-auto py-2.5 px-3"
            onClick={() => {
              // Focus on the chat panel by scrolling it into view
              const chatInput = document.querySelector<HTMLInputElement>(
                'aside input[placeholder*="finances"]'
              );
              if (chatInput) {
                chatInput.focus();
                chatInput.value = copy.upload.seedPrompt;
                chatInput.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }}
          >
            <div className="size-7 rounded-md bg-blue-500/10 flex items-center justify-center shrink-0">
              <FileUp className="size-3.5 text-blue-500" />
            </div>
            <div className="text-left">
              <p className="text-xs font-medium">{copy.upload.title}</p>
              <p className="text-[10px] text-muted-foreground">{copy.upload.subtitle}</p>
            </div>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-2 h-auto py-2.5 px-3"
            onClick={() => {
              const chatInput = document.querySelector<HTMLInputElement>(
                'aside input[placeholder*="finances"]'
              );
              if (chatInput) {
                chatInput.focus();
              }
            }}
          >
            <div className="size-7 rounded-md bg-green-500/10 flex items-center justify-center shrink-0">
              <MessageSquare className="size-3.5 text-green-500" />
            </div>
            <div className="text-left">
              <p className="text-xs font-medium">{copy.chat.title}</p>
              <p className="text-[10px] text-muted-foreground">{copy.chat.subtitle}</p>
            </div>
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-2 h-auto py-2.5 px-3"
            onClick={() => router.push("/admin/company-db")}
          >
            <div className="size-7 rounded-md bg-amber-500/10 flex items-center justify-center shrink-0">
              <Building2 className="size-3.5 text-amber-500" />
            </div>
            <div className="text-left">
              <p className="text-xs font-medium">{copy.companyMap.title}</p>
              <p className="text-[10px] text-muted-foreground">{copy.companyMap.subtitle}</p>
            </div>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
