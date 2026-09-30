"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "next-intl";
import { Bot, BriefcaseBusiness, Building2, Files, Home, MessageSquare } from "lucide-react";

import { AppAddModal } from "@/components/app-add-modal";
import { cn } from "@/lib/utils";

const MOBILE_TABS = [
  { href: "/dashboard", labelKey: "home", icon: Home },
  { href: "/automations", labelKey: "automations", icon: Bot },
  { href: "/assistant", labelKey: "chat", icon: MessageSquare },
  { href: "/settings/companies", labelKey: "companies", icon: Building2 },
] as const;

const PERSONAL_MOBILE_TABS = [
  { href: "/personal", labelKey: "home", icon: Home },
  { href: "/personal/documents", labelKey: "files", icon: Files },
  { href: "/personal/chat", labelKey: "chat", icon: MessageSquare },
  { href: "/personal/workspaces", labelKey: "companies", icon: BriefcaseBusiness },
] as const;

const MOBILE_TAB_LABELS = {
  en: {
    home: "Home",
    automations: "Auto",
    chat: "Chat",
    companies: "Companies",
    files: "Files",
    add: "Add",
  },
  ru: {
    home: "Home",
    automations: "Авто",
    chat: "Чат",
    companies: "Компании",
    files: "Файлы",
    add: "Add",
  },
  id: {
    home: "Home",
    automations: "Auto",
    chat: "Chat",
    companies: "Perusahaan",
    files: "File",
    add: "Add",
  },
} as const;

export function AppMobileTabBar() {
  const pathname = usePathname();
  const locale = useLocale();
  const labels =
    locale === "ru" ? MOBILE_TAB_LABELS.ru : locale === "id" ? MOBILE_TAB_LABELS.id : MOBILE_TAB_LABELS.en;
  const tabs = pathname.startsWith("/personal") ? PERSONAL_MOBILE_TABS : MOBILE_TABS;
  const isActive = (href: string) =>
    href === "/dashboard" || href === "/personal"
      ? pathname === href
      : pathname.startsWith(href);

  return (
    <nav
      aria-label="Mobile primary navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-end gap-1">
        {tabs.slice(0, 2).map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium text-muted-foreground",
                active && "text-primary",
              )}
            >
              <Icon className="size-4" />
              <span>{labels[item.labelKey]}</span>
            </Link>
          );
        })}

        <div className="-mt-7 flex flex-col items-center gap-1">
          <div className="rounded-full bg-card p-1 shadow-lg ring-1 ring-border">
            <AppAddModal
              triggerClassName="size-12 rounded-full px-0 shadow-md [&_svg]:size-5"
            />
          </div>
          <span className="text-[10px] font-medium text-muted-foreground">{labels.add}</span>
        </div>

        {tabs.slice(2).map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium text-muted-foreground",
                active && "text-primary",
              )}
            >
              <Icon className="size-4" />
              <span>{labels[item.labelKey]}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
