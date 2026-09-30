"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildDashboardHrefForView,
  isDocumentsDashboardView,
  isFinanceDashboardView,
  type DocumentsDashboardView,
} from "@/lib/dashboard-navigation";
import { getAppCopy } from "@/lib/i18n/copy";
import { useCFOStore } from "@/lib/store";
import { AgentFilesView } from "./agent-files-view";
import { DocumentsView } from "./documents-view";
import { PeopleView } from "./people-view";

export function DocumentsWorkspaceTabs() {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = (getAppCopy(locale) as {
    documents: {
      page: {
        tabs: {
          documents: string;
          people: string;
          agentFiles: string;
        };
      };
    };
  }).documents.page.tabs;
  const activeDocumentsDashboardView = useCFOStore((s) => s.activeDocumentsDashboardView);
  const setActiveDocumentsDashboardView = useCFOStore((s) => s.setActiveDocumentsDashboardView);

  const tabs: { value: DocumentsDashboardView; label: string }[] = [
    { value: "documents", label: copy.documents },
    { value: "people", label: copy.people },
    { value: "agent-files", label: copy.agentFiles },
  ];

  useEffect(() => {
    const requestedView = searchParams.get("view");
    if (!requestedView) return;

    if (isFinanceDashboardView(requestedView)) {
      router.replace(buildDashboardHrefForView(requestedView));
      return;
    }

    if (
      isDocumentsDashboardView(requestedView) &&
      requestedView !== activeDocumentsDashboardView
    ) {
      setActiveDocumentsDashboardView(requestedView);
    }
  }, [activeDocumentsDashboardView, router, searchParams, setActiveDocumentsDashboardView]);

  return (
    <Tabs
      value={activeDocumentsDashboardView}
      onValueChange={(value) => {
        const nextView = value as DocumentsDashboardView;
        setActiveDocumentsDashboardView(nextView);
        router.replace(buildDashboardHrefForView(nextView), { scroll: false });
      }}
    >
      <TabsList className="grid !h-auto w-full grid-cols-1 gap-2 md:grid-cols-3">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="h-10 min-w-0 text-sm sm:text-base"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="documents" className="animate-in fade-in-0 duration-200">
        <DocumentsView />
      </TabsContent>
      <TabsContent value="people" className="animate-in fade-in-0 duration-200">
        <PeopleView />
      </TabsContent>
      <TabsContent value="agent-files" className="animate-in fade-in-0 duration-200">
        <AgentFilesView />
      </TabsContent>
    </Tabs>
  );
}
