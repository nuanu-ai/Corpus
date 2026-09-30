"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";

import { cn } from "@/lib/utils";
import { getAppCopy } from "@/lib/i18n/copy";
import { listSidebarPersonas, type PersonaSlug } from "@/lib/ai/personas";

/**
 * Pinned persona switcher rendered above the thread list / above the chat
 * surface. Renders one button per `visibleInCompanySidebar` persona,
 * highlights the active one, and links to `/assistant/<slug>` (or to
 * the legacy `/assistant` for the default `company` slug to avoid a
 * needless redirect).
 */
export function PersonaSelector({ className }: { className?: string }) {
  const pathname = usePathname();
  const locale = useLocale();
  const copy = getAppCopy(locale).chat.v2.persona;
  const personas = listSidebarPersonas();

  // Detect the active persona from the URL — `/assistant/<slug>` or root.
  const activeSlug: PersonaSlug = (() => {
    if (!pathname) return "company";
    const match = pathname.match(/^\/assistant\/([^/]+)/);
    if (!match) return "company";
    const candidate = match[1];
    return personas.some((p) => p.slug === candidate)
      ? (candidate as PersonaSlug)
      : "company";
  })();

  return (
    <nav
      aria-label="Chat personas"
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-2xl border border-border/50 bg-muted/40 p-1.5",
        className,
      )}
    >
      {personas.map((p) => {
        const isActive = p.slug === activeSlug;
        const href =
          p.slug === "company" ? "/assistant" : `/assistant/${p.slug}`;
        const label =
          (copy as Record<string, { name?: string; description?: string }>)[p.slug]?.name ??
          p.slug;
        const description =
          (copy as Record<string, { name?: string; description?: string }>)[p.slug]?.description;
        return (
          <Link
            key={p.slug}
            href={href}
            aria-current={isActive ? "page" : undefined}
            title={description}
            className={cn(
              "rounded-xl px-3 py-1.5 text-sm font-medium transition",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
