"use client";

// Dashboard chat side-panel.
//
// Mounts <ChatV2> alongside the dashboard so the model and the dashboard
// share an `AssistantRuntimeProvider`. That makes every `<AssistantVisible>`
// wrapper on the page actually feed the assistant the rendered card
// HTML each turn — the user can ask "what changed in this card?" and the
// model already has the data, no extra tool call.
//
// Persistence: collapsed/expanded state is in localStorage so the panel
// stays where the user left it across navigations and reloads.

import { useEffect, useState, type CSSProperties } from "react";
import { MessagesSquareIcon, PanelRightCloseIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ChatV2 } from "@/app/assistant/_components/chat-v2";

const STORAGE_KEY = "corpus:dashboard-chat-panel:v1";
const MOBILE_TAB_BAR_HEIGHT = "calc(4.75rem + env(safe-area-inset-bottom))";
const CHAT_MOBILE_OFFSET_STYLE = {
  "--chat-composer-bottom": MOBILE_TAB_BAR_HEIGHT,
  "--chat-composer-safe-bottom": "0px",
  "--chat-viewport-bottom-extra": MOBILE_TAB_BAR_HEIGHT,
} as CSSProperties;

function readInitialOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "open";
  } catch {
    return false;
  }
}

function persist(open: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // ignore storage failures (private mode, quota etc.) — non-critical
  }
}

export function DashboardChatSidePanel() {
  // Render-time we don't know the persisted value (SSR), so start closed and
  // hydrate from localStorage on the client. Keeps SSR markup deterministic.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setOpen(readInitialOpen());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      persist(next);
      return next;
    });
  };

  if (!open) {
    return (
      <Button
        type="button"
        size="icon"
        variant="default"
        aria-label="Open AI chat"
        title="Open AI chat"
        onClick={toggle}
        className="fixed bottom-6 right-6 z-30 size-12 rounded-full shadow-lg"
      >
        <MessagesSquareIcon className="size-5" />
      </Button>
    );
  }

  return (
    <aside
      className={cn(
        "fixed inset-y-0 right-0 z-30 flex h-full w-full max-w-md flex-col border-l border-border/60 bg-background shadow-2xl",
        "sm:max-w-md md:w-[420px]",
      )}
      style={CHAT_MOBILE_OFFSET_STYLE}
      aria-label="AI assistant panel"
    >
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <span className="text-sm font-medium text-muted-foreground">
          AI Assistant
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Close AI chat"
          title="Close"
          onClick={toggle}
          className="size-8 text-muted-foreground hover:text-foreground"
        >
          <PanelRightCloseIcon className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        <ChatV2 />
      </div>
    </aside>
  );
}
