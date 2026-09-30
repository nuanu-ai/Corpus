"use client";

import { useEffect, useState, useCallback } from "react";
import { useLocale } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link2, Unplug, Loader2, RefreshCw, AlertCircle, PlugZap } from "lucide-react";

import { getAppCopy } from "@/lib/i18n/copy";
import {
  coerceGoogleDriveConnectionMetadata,
  hasGoogleDriveActiveAutoImport,
} from "@/lib/connectors/google-drive";
import { getConnectorProviderDefinition } from "@/lib/connectors/provider-registry";
import {
  describeConnectionSyncFreshness,
  getExpectedSyncInterval,
} from "@/lib/connectors/sync-health";
import { ConnectorRulesEditor } from "./connector-rules-editor";

type ConnectionStatus = "active" | "error" | "expired" | "disconnected";

interface Connection {
  id: string;
  provider: string;
  status: ConnectionStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  errorCount?: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "bg-green-500/15 text-green-500 border-green-500/30",
  },
  error: {
    label: "Error",
    className: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  },
  expired: {
    label: "Expired",
    className: "bg-red-500/15 text-red-500 border-red-500/30",
  },
  disconnected: {
    label: "Disconnected",
    className: "bg-gray-500/15 text-gray-500 border-gray-500/30",
  },
};

function getProviderName(provider: string): string {
  return getConnectorProviderDefinition(provider)?.label ?? provider;
}

function formatSyncTime(connection: Connection): string {
  const metadata =
    connection.provider === "google_drive"
      ? coerceGoogleDriveConnectionMetadata(connection.metadata)
      : null;
  const skipSyncExpectation =
    connection.provider === "google_drive" &&
    metadata !== null &&
    !hasGoogleDriveActiveAutoImport(metadata);
  const expectedInterval = skipSyncExpectation
    ? null
    : getExpectedSyncInterval(connection.provider);
  const freshness = describeConnectionSyncFreshness({
    provider: connection.provider,
    lastSyncAt: connection.lastSyncAt,
    createdAt: connection.createdAt,
    expectedIntervalMs: expectedInterval,
  });

  if (freshness.state === "healthy" && connection.lastSyncAt) {
    return `Synced ${formatRelativeTime(connection.lastSyncAt)}`;
  }

  if (freshness.state === "on_demand" && connection.lastSyncAt) {
    return `Last sync ${formatRelativeTime(connection.lastSyncAt)}`;
  }

  if (freshness.state === "connected" && freshness.createdAgeLabel) {
    return `Connected ${freshness.createdAgeLabel}`;
  }

  return freshness.message;
}

function formatGoogleDriveSubtitle(connection: Connection): string | null {
  if (connection.provider !== "google_drive") return null;
  const metadata = coerceGoogleDriveConnectionMetadata(connection.metadata);
  const root = metadata.rootPath ?? "Root folder not configured";
  const watchedCount = metadata.watchedFolders.filter(
    (folder) => folder.enabled !== false
  ).length;
  const watchedLabel =
    watchedCount > 0
      ? `${watchedCount} watched folder${watchedCount === 1 ? "" : "s"}`
      : "Browse-only";
  return `${root} · ${watchedLabel}`;
}

function getProviderDisplayName(connection: Connection): string {
  const customLabel =
    typeof connection.metadata?.connectionLabel === "string"
      ? connection.metadata.connectionLabel.trim()
      : "";
  if (customLabel) {
    return customLabel;
  }

  if (connection.provider !== "google_drive") {
    return getProviderName(connection.provider);
  }

  const metadata = coerceGoogleDriveConnectionMetadata(connection.metadata);
  return metadata.connectionLabel?.trim() || "Google Drive";
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function ConnectedSources() {
  const locale = useLocale();
  const sectionsCopy = getAppCopy(locale).integrations.page.sections;
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/connections");
      if (res.ok) {
        const data = await res.json();
        setConnections(data);
      }
    } catch {
      // Silently fail -- page still usable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const handleDisconnect = useCallback(async (id: string) => {
    setDisconnecting(id);
    try {
      const res = await fetch(`/api/connections/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConnections((prev) => prev.filter((c) => c.id !== id));
      }
    } catch {
      // Silently fail
    } finally {
      setDisconnecting(null);
    }
  }, []);

  // Expose refresh for parent components
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__refreshConnections =
      fetchConnections;
    return () => {
      delete (window as unknown as Record<string, unknown>)
        .__refreshConnections;
    };
  }, [fetchConnections]);

  /** Check if the user has a Google Drive connection active. */
  const hasGoogleDrive = connections.some(
    (c) => c.provider === "google_drive" && c.status === "active"
  );

  // Expose Google Drive status + connected providers so parent can conditionally render
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__hasGoogleDrive =
      hasGoogleDrive;
    const event = new CustomEvent("google-drive-status", {
      detail: { connected: hasGoogleDrive },
    });
    window.dispatchEvent(event);

    const activeProviders = connections
      .filter((c) => c.status === "active")
      .map((c) => c.provider);
    const providerEvent = new CustomEvent("connected-providers", {
      detail: { providers: activeProviders },
    });
    window.dispatchEvent(providerEvent);
  }, [hasGoogleDrive, connections]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4" />
          {sectionsCopy.connected}
          {connections.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
              {connections.length}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={fetchConnections}
            className="ml-auto text-muted-foreground"
          >
            <RefreshCw className="size-3" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 text-muted-foreground animate-spin" />
          </div>
        ) : connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <div className="size-12 rounded-full bg-muted/60 ring-1 ring-inset ring-border/60 flex items-center justify-center">
              <PlugZap className="size-5 text-muted-foreground" />
            </div>
            <p className="max-w-xs text-sm text-muted-foreground">
              {sectionsCopy.connectedEmpty}
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {connections.map((connection) => {
              const config =
                statusConfig[connection.status] ?? statusConfig.active;
              return (
                <div
                  key={connection.id}
                  className="rounded-lg border border-border bg-muted/30 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm font-medium text-foreground">
                          {getProviderDisplayName(connection)}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 shrink-0 ${config.className}`}
                        >
                          {config.label}
                        </Badge>
                        {connection.lastError && connection.status === "error" && (
                          <span
                            className="text-xs text-amber-500 truncate max-w-[200px] flex items-center gap-1"
                            title={connection.lastError}
                          >
                            <AlertCircle className="size-3 shrink-0" />
                            {connection.lastError}
                          </span>
                        )}
                      </div>
                      {formatGoogleDriveSubtitle(connection) ? (
                        <p className="text-xs text-muted-foreground truncate max-w-[360px]">
                          {formatGoogleDriveSubtitle(connection)}
                        </p>
                      ) : null}
                      <ConnectorRulesEditor
                        provider={connection.provider}
                        label={getProviderName(connection.provider)}
                      />
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {formatSyncTime(connection)}
                      </span>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleDisconnect(connection.id)}
                        disabled={disconnecting === connection.id}
                      >
                        {disconnecting === connection.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Unplug className="size-3.5" />
                        )}
                        Disconnect
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
