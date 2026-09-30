"use client";

import { Globe, Loader2 } from "lucide-react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAppCopy } from "@/lib/i18n/copy";
import { APP_LOCALES, isAppLocale, type AppLocale } from "@/lib/i18n/config";

export function LanguageSwitcher({
  compact = false,
}: {
  compact?: boolean;
}) {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const resolvedLocale: AppLocale = isAppLocale(locale) ? locale : "en";
  const copy = getAppCopy(resolvedLocale).language;

  const handleLocaleChange = async (nextLocale: string) => {
    if (!isAppLocale(nextLocale) || nextLocale === resolvedLocale) return;

    await fetch("/api/i18n/locale", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ locale: nextLocale }),
    });

    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      {!compact ? (
        <div className="hidden text-xs text-muted-foreground lg:flex items-center gap-1.5">
          <Globe className="size-3.5" />
          {copy.label}
        </div>
      ) : null}
      <Select
        value={resolvedLocale}
        onValueChange={(value) => {
          void handleLocaleChange(value);
        }}
      >
        <SelectTrigger className={compact ? "h-8 w-[110px]" : "h-8 w-[146px]"}>
          {isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {copy.updating}
            </div>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent align="end">
          {APP_LOCALES.map((option) => (
            <SelectItem key={option} value={option}>
              {copy.options[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
