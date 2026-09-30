"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Brain,
  Bot,
  FileText,
  GitFork,
  Home,
  MessageSquare,
  Plug,
  Search,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CommandItem = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  keywords: string;
  requiresPlatformAdmin?: boolean;
};

const COMMAND_ITEMS: CommandItem[] = [
  {
    label: "Home",
    description: "Open dashboard and finance overview",
    href: "/dashboard",
    icon: Home,
    keywords: "dashboard home finance pnl balance cash",
  },
  {
    label: "Ask Corpus",
    description: "Open chat with company context",
    href: "/assistant",
    icon: MessageSquare,
    keywords: "chat ask ai ceo question",
  },
  {
    label: "Automations",
    description: "Open routines, runs, findings, and approvals",
    href: "/automations",
    icon: Bot,
    keywords: "automations routines legal watch runs findings approvals",
  },
  {
    label: "Memory",
    description: "Open Company-DB memory and sources",
    href: "/admin/company-db",
    icon: Brain,
    keywords: "memory company db sources knowledge",
  },
  {
    label: "Structure",
    description: "Open linked companies and operating structure",
    href: "/admin/organization/structure",
    icon: GitFork,
    keywords: "structure companies organization graph access",
    requiresPlatformAdmin: true,
  },
  {
    label: "Processing history",
    description: "Open documents, review queue, and file history",
    href: "/documents",
    icon: FileText,
    keywords: "documents files history upload review",
  },
  {
    label: "Connect sources",
    description: "Open integrations and connector setup",
    href: "/integrations",
    icon: Plug,
    keywords: "integrations connectors bank drive email telegram odoo",
  },
  {
    label: "Settings",
    description: "Manage profile, companies, and developer options",
    href: "/settings",
    icon: Settings,
    keywords: "settings profile company api key byok developer",
  },
];

export function AppCommandPalette({
  enabled = true,
  includeAdminStructure = false,
}: {
  enabled?: boolean;
  includeAdminStructure?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const allowedItems = COMMAND_ITEMS.filter(
      (item) => !item.requiresPlatformAdmin || includeAdminStructure,
    );
    if (!normalized) return allowedItems;
    return allowedItems.filter((item) =>
      `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(normalized),
    );
  }, [includeAdminStructure, query]);

  const runCommand = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  if (!enabled) return null;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="hidden h-8 min-w-[210px] items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
        >
          <Search className="size-3.5" />
          <span className="min-w-0 flex-1 text-left">Search or command...</span>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-20 z-50 w-[560px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search and open Corpus workspace actions.
          </Dialog.Description>
          <div className="flex items-center gap-2 border-b border-border px-3 py-3">
            <Search className="size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search commands, pages, sources..."
              autoFocus
              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close command palette">
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </div>

          <div className="max-h-[420px] overflow-y-auto p-2">
            {filteredItems.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                No commands found.
              </div>
            ) : (
              filteredItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => runCommand(item.href)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-accent",
                      index === 0 && "bg-accent/60",
                    )}
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
