"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocale } from "next-intl";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useThreadList,
  useThreadListItem,
  useThreadListItemRuntime,
} from "@assistant-ui/react";
import { MessageSquareIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { getAppCopy } from "@/lib/i18n/copy";
import { cn } from "@/lib/utils";

export interface ThreadListProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

// Inner list UI. Outer layout (aside / sheet) lives in thread-sidebar.tsx.
export function ThreadList({ collapsed = false, onNavigate }: ThreadListProps) {
  const locale = useLocale();
  const sidebarCopy = getAppCopy(locale).chat.v2.sidebar;
  return (
    <ThreadListPrimitive.Root className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border/40 px-3 py-3",
          collapsed && "justify-center px-2",
        )}
      >
        {!collapsed && (
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
              AI
            </span>
            <span>Corpus</span>
          </div>
        )}

        <div className={cn("ml-auto", collapsed && "ml-0")}>
          <ThreadListPrimitive.New asChild>
            <Button
              size={collapsed ? "icon-sm" : "sm"}
              variant={collapsed ? "ghost" : "outline"}
              className={cn(
                "gap-1.5 rounded-full",
                collapsed ? "size-9" : "h-8 px-3",
              )}
              aria-label={sidebarCopy.newChat}
              onClick={onNavigate}
            >
              <PlusIcon className={collapsed ? "size-5" : "size-4"} />
              {!collapsed && <span className="text-xs font-medium">{sidebarCopy.newChat}</span>}
            </Button>
          </ThreadListPrimitive.New>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2">
        <ThreadListItemsOrEmpty collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </ThreadListPrimitive.Root>
  );
}

function ThreadListItemsOrEmpty({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const locale = useLocale();
  const sidebarCopy = getAppCopy(locale).chat.v2.sidebar;
  const count = useThreadList((state) => state.threadIds.length);

  // Stable component identity — prevents row remounts that would wipe local state
  // (isEditing during rename, armed during two-tap delete confirm).
  const components = useMemo(
    () => ({
      ThreadListItem: () => (
        <ThreadItemRow collapsed={collapsed} onNavigate={onNavigate} />
      ),
    }),
    [collapsed, onNavigate],
  );

  if (count === 0) {
    if (collapsed) return null;
    return (
      <div className="flex h-full items-center justify-center px-4 py-8 text-center text-xs text-muted-foreground">
        {sidebarCopy.empty}
      </div>
    );
  }

  return <ThreadListPrimitive.Items components={components} />;
}

function ThreadItemRow({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const locale = useLocale();
  const sidebarCopy = getAppCopy(locale).chat.v2.sidebar;
  const [isEditing, setIsEditing] = useState(false);

  if (collapsed) {
    return (
      <ThreadListItemPrimitive.Root
        className={cn(
          "mb-1 flex items-center justify-center rounded-md",
          "data-[active=true]:bg-muted",
        )}
      >
        <ThreadListItemPrimitive.Trigger
          className="flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          onClick={onNavigate}
          aria-label={sidebarCopy.openConversation}
        >
          <MessageSquareIcon className="size-4" />
        </ThreadListItemPrimitive.Trigger>
      </ThreadListItemPrimitive.Root>
    );
  }

  return (
    <ThreadListItemPrimitive.Root
      className={cn(
        "group/item relative mb-0.5 flex items-center rounded-md",
        "data-[active=true]:bg-muted",
      )}
    >
      {isEditing ? (
        <ThreadItemRenameForm onDone={() => setIsEditing(false)} />
      ) : (
        <>
          <ThreadListItemPrimitive.Trigger
            className={cn(
              "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground/80",
              "transition-colors hover:bg-muted/60",
              "data-[active=true]:font-medium data-[active=true]:text-foreground",
            )}
            onClick={onNavigate}
          >
            <ThreadItemTitleText />
          </ThreadListItemPrimitive.Trigger>
          <ThreadItemMenu onRenameRequest={() => setIsEditing(true)} />
        </>
      )}
    </ThreadListItemPrimitive.Root>
  );
}

function ThreadItemTitleText() {
  const locale = useLocale();
  const sidebarCopy = getAppCopy(locale).chat.v2.sidebar;
  return (
    <span className="min-w-0 flex-1 truncate">
      <ThreadListItemPrimitive.Title fallback={sidebarCopy.newChat} />
    </span>
  );
}

function ThreadItemMenu({ onRenameRequest }: { onRenameRequest: () => void }) {
  const locale = useLocale();
  const sidebarCopy = getAppCopy(locale).chat.v2.sidebar;
  const [menuOpen, setMenuOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current);
    };
  }, []);

  // Reset the two-tap confirm state whenever the menu closes, so reopening
  // never shows a stale "armed" mode.
  const handleOpenChange = useCallback((open: boolean) => {
    setMenuOpen(open);
    if (!open) {
      if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current);
      setArmed(false);
    }
  }, []);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className={cn(
            "mr-1 size-8 shrink-0 rounded-md text-muted-foreground",
            "opacity-0 focus-visible:opacity-100 group-hover/item:opacity-100",
            "data-[state=open]:opacity-100",
          )}
          aria-label={sidebarCopy.threadActions}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} collisionPadding={8} className="min-w-[10rem]">
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onRenameRequest();
            setMenuOpen(false);
          }}
        >
          <PencilIcon className="size-4" />
          {sidebarCopy.rename}
        </DropdownMenuItem>
        <ThreadItemDeleteMenuItem
          armed={armed}
          onArm={() => {
            setArmed(true);
            if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current);
            armTimeoutRef.current = setTimeout(() => setArmed(false), 3000);
          }}
          onConfirm={() => {
            if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current);
            setArmed(false);
            setMenuOpen(false);
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThreadItemDeleteMenuItem({
  armed,
  onArm,
  onConfirm,
}: {
  armed: boolean;
  onArm: () => void;
  onConfirm: () => void;
}) {
  const locale = useLocale();
  const sidebarCopy = getAppCopy(locale).chat.v2.sidebar;
  const runtime = useThreadListItemRuntime();

  const handleSelect = useCallback(
    (event: Event) => {
      event.preventDefault();
      if (!armed) {
        onArm();
        return;
      }
      onConfirm();
      void runtime.delete();
    },
    [armed, onArm, onConfirm, runtime],
  );

  return (
    <DropdownMenuItem variant="destructive" onSelect={handleSelect}>
      <Trash2Icon className="size-4" />
      {armed ? sidebarCopy.deleteConfirm : sidebarCopy.delete}
    </DropdownMenuItem>
  );
}

function ThreadItemRenameForm({ onDone }: { onDone: () => void }) {
  const locale = useLocale();
  const sidebarCopy = getAppCopy(locale).chat.v2.sidebar;
  const runtime = useThreadListItemRuntime();
  const currentTitle = useThreadListItem((state) => state.title ?? "");
  const [value, setValue] = useState(currentTitle);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = useCallback(async () => {
    if (submitting) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === currentTitle) {
      onDone();
      return;
    }
    setSubmitting(true);
    try {
      await runtime.rename(trimmed);
    } finally {
      setSubmitting(false);
      onDone();
    }
  }, [submitting, value, currentTitle, runtime, onDone]);

  return (
    <form
      ref={formRef}
      className="flex w-full items-center gap-1 px-1 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        ref={inputRef}
        value={value}
        disabled={submitting}
        onChange={(event) => setValue(event.target.value)}
        onBlur={(event) => {
          // Ignore focus shifts within the form itself (e.g. clicking label).
          const nextTarget = event.relatedTarget as Node | null;
          if (nextTarget && formRef.current?.contains(nextTarget)) return;
          void submit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDone();
          }
        }}
        className="h-9 text-sm"
        aria-label={sidebarCopy.renameConversation}
      />
    </form>
  );
}
