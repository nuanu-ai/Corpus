"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "next-intl";

import { getAppCopy } from "@/lib/i18n/copy";

import { ConnectedSources } from "./_components/connected-sources";
import { AddSourceGrid } from "./_components/add-source-grid";
import { UploadZone } from "./_components/upload-zone";
import { DriveFilePicker } from "./_components/drive-file-picker";
import { TelegramChatManager } from "./_components/telegram-chat-manager";
import { TelegramBotLinkCard } from "./_components/telegram-bot-link-card";

export default function IntegrationsPage() {
  const locale = useLocale();
  const copy = getAppCopy(locale).integrations.page;
  const [hasGoogleDrive, setHasGoogleDrive] = useState(false);
  const [hasTelegram, setHasTelegram] = useState(false);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);

  const handleConnected = useCallback(() => {
    // Trigger refresh of the ConnectedSources list
    const refresh = (window as unknown as Record<string, unknown>)
      .__refreshConnections;
    if (typeof refresh === "function") {
      (refresh as () => void)();
    }
  }, []);

  // Listen for Google Drive connection status from ConnectedSources
  useEffect(() => {
    const driveHandler = (e: Event) => {
      const detail = (e as CustomEvent<{ connected: boolean }>).detail;
      setHasGoogleDrive(detail.connected);
    };
    const providerHandler = (e: Event) => {
      const detail = (e as CustomEvent<{ providers: string[] }>).detail;
      setConnectedProviders(detail.providers);
      setHasTelegram(detail.providers.includes("telegram"));
    };
    window.addEventListener("google-drive-status", driveHandler);
    window.addEventListener("connected-providers", providerHandler);
    return () => {
      window.removeEventListener("google-drive-status", driveHandler);
      window.removeEventListener("connected-providers", providerHandler);
    };
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.title}</h2>
        <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
      </div>

      <UploadZone />
      <TelegramBotLinkCard />
      <ConnectedSources />
      {hasGoogleDrive && <DriveFilePicker />}
      {hasTelegram && <TelegramChatManager />}
      <AddSourceGrid onConnected={handleConnected} connectedProviders={connectedProviders} />
    </div>
  );
}
