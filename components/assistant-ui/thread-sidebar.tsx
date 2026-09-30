"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { useLocale } from "next-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import { MenuIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getAppCopy } from "@/lib/i18n/copy";
import { cn } from "@/lib/utils";

import { ThreadList } from "./thread-list";

type MobileSidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const MobileSidebarContext = createContext<MobileSidebarContextValue | null>(null);

function useMobileSidebar(): MobileSidebarContextValue {
  const ctx = useContext(MobileSidebarContext);
  if (!ctx) {
    throw new Error(
      "useMobileSidebar must be used within <ThreadSidebar>. Wrap the chat tree with <ThreadSidebar />.",
    );
  }
  return ctx;
}

export interface ThreadSidebarProps {
  children?: ReactNode;
}

// Combined desktop + mobile sidebar shell. Renders nothing for mobile until
// the hamburger trigger opens it; the desktop aside is always mounted.
export function ThreadSidebar({ children }: ThreadSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <MobileSidebarContext.Provider value={{ open: mobileOpen, setOpen: setMobileOpen }}>
      <div className="flex h-full min-h-0 w-full">
        <DesktopSidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
        <MobileSidebarSheet open={mobileOpen} onOpenChange={setMobileOpen} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </MobileSidebarContext.Provider>
  );
}

function DesktopSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const locale = useLocale();
  const sidebarCopy = getAppCopy(locale).chat.v2.sidebar;
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "hidden lg:flex h-full shrink-0 flex-col border-r border-border bg-muted/30",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-16" : "w-72",
      )}
    >
      <ThreadList collapsed={collapsed} />
      <div
        className={cn(
          "flex items-center border-t border-border/40 px-2 py-2",
          collapsed ? "justify-center" : "justify-end",
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={onToggle}
          aria-label={collapsed ? sidebarCopy.expand : sidebarCopy.collapse}
        >
          {collapsed ? (
            <PanelLeftOpenIcon className="size-4" />
          ) : (
            <PanelLeftCloseIcon className="size-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}

function MobileSidebarSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const locale = useLocale();
  const sidebarCopy = getAppCopy(locale).chat.v2.sidebar;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-background/70 backdrop-blur-sm lg:hidden",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          aria-label={sidebarCopy.title}
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-sm flex-col bg-background shadow-xl lg:hidden",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-left",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left",
          )}
        >
          <DialogPrimitive.Title className="sr-only">{sidebarCopy.title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {sidebarCopy.description}
          </DialogPrimitive.Description>
          <div className="flex min-h-0 flex-1 flex-col">
            <ThreadList onNavigate={() => onOpenChange(false)} />
          </div>
          <DialogPrimitive.Close asChild>
            <button
              type="button"
              aria-label={sidebarCopy.closeConversations}
              className={cn(
                "absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-md",
                "text-muted-foreground hover:bg-muted hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              )}
            >
              <XIcon className="size-4" />
            </button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Hamburger trigger for mobile. Rendered inside <Thread /> top bar.
export function MobileSidebarTrigger({ className }: { className?: string }) {
  const locale = useLocale();
  const sidebarCopy = getAppCopy(locale).chat.v2.sidebar;
  const { setOpen } = useMobileSidebar();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn("size-9 text-muted-foreground hover:text-foreground", className)}
      onClick={() => setOpen(true)}
      aria-label={sidebarCopy.openConversations}
    >
      <MenuIcon className="size-5" />
    </Button>
  );
}
