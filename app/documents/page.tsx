"use client";

import { useLocale } from "next-intl";

import { getAppCopy } from "@/lib/i18n/copy";
import { DocumentsWorkspaceTabs } from "@/app/dashboard/_components/documents-workspace-tabs";

export default function DocumentsPage() {
  const locale = useLocale();
  const copy = getAppCopy(locale).documents.page;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.title}</h2>
        <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
      </div>

      <DocumentsWorkspaceTabs />
    </div>
  );
}
