"use client";

import Link from "next/link";
import { KeyRound } from "lucide-react";
import { useLocale } from "next-intl";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getAppCopy } from "@/lib/i18n/copy";
import { ProfileTab } from "./profile-tab";
import { ApiKeysTab } from "./api-keys-tab";
import { CompaniesTab } from "./companies-tab";

interface User {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  tier?: string | null;
  createdAt?: string | null;
}

export function SettingsTabs({ user }: { user: User }) {
  const locale = useLocale();
  const copy = getAppCopy(locale).settings;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {copy.title}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {copy.subtitle}
          </p>
        </div>
        <Link
          href="/settings/byok"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <KeyRound className="h-3.5 w-3.5" />
          Provider keys
        </Link>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">{copy.tabs.profile}</TabsTrigger>
          <TabsTrigger value="companies">{copy.tabs.companies}</TabsTrigger>
          <TabsTrigger value="api-keys">{copy.tabs.apiKeys}</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileTab user={user} />
        </TabsContent>

        <TabsContent value="companies">
          <CompaniesTab />
        </TabsContent>

        <TabsContent value="api-keys">
          <ApiKeysTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
