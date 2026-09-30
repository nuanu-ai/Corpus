"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  HelpCircle,
  Copy,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ConnectorStatus } from "./add-source-grid";
import { getProviderSetupInfo } from "@/lib/provider-setup-info";

/* ---------- API-key provider config ---------- */

interface ApiKeyField {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password" | "textarea"; // defaults to "password"
  required?: boolean;
  rows?: number;
}

interface ApiKeyProviderConfig {
  provider: string;
  /** Single-field providers use label/placeholder directly */
  label?: string;
  placeholder?: string;
  /** Multi-field providers use the fields array */
  fields?: ApiKeyField[];
}

const API_KEY_PROVIDERS: Record<string, ApiKeyProviderConfig> = {
  stripe: {
    provider: "stripe",
    placeholder: "sk_live_... or rk_live_...",
    label: "Stripe Secret or Restricted Key",
  },
  mercury: {
    provider: "mercury",
    placeholder: "Mercury API key",
    label: "Mercury API Key",
  },
  odoo: {
    provider: "odoo",
    fields: [
      { key: "portalUrl", label: "Portal URL", placeholder: "https://your-host/odoo-instance", type: "text" },
      { key: "token", label: "API Token", placeholder: "Bearer token from ODOO Portal" },
    ],
  },
  tiktok_ads: {
    provider: "tiktok_ads",
    fields: [
      { key: "token", label: "Access Token", placeholder: "TikTok Ads access token", type: "password" },
      { key: "advertiserId", label: "Advertiser ID", placeholder: "TikTok advertiser ID", type: "text" },
      { key: "baseUrl", label: "API Base URL", placeholder: "https://business-api.tiktok.com", type: "text", required: false },
    ],
  },
  linkedin_ads: {
    provider: "linkedin_ads",
    fields: [
      { key: "adAccountId", label: "Default Ad Account ID", placeholder: "Optional LinkedIn ad account ID", type: "text", required: false },
      { key: "token", label: "Access Token", placeholder: "LinkedIn OAuth access token", type: "password" },
      { key: "apiVersion", label: "API Version", placeholder: "202603", type: "text", required: false },
      { key: "baseUrl", label: "API Base URL", placeholder: "https://api.linkedin.com/rest", type: "text", required: false },
    ],
  },
  hubspot: {
    provider: "hubspot",
    fields: [
      { key: "token", label: "Private App Token", placeholder: "pat-... or HubSpot private app token", type: "password" },
      { key: "portalId", label: "Portal ID", placeholder: "Optional HubSpot portal ID", type: "text", required: false },
      { key: "baseUrl", label: "API Base URL", placeholder: "https://api.hubapi.com", type: "text", required: false },
    ],
  },
  custom_http: {
    provider: "custom_http",
    fields: [
      { key: "connectionLabel", label: "Connection Label", placeholder: "Internal API", type: "text" },
      { key: "baseUrl", label: "Base URL", placeholder: "https://internal.example.com/api", type: "text" },
      { key: "authMode", label: "Auth Mode", placeholder: "none | bearer | header | query", type: "text", required: false },
      { key: "authToken", label: "Auth Token", placeholder: "Optional token or API key", type: "password", required: false },
      { key: "authHeaderName", label: "Auth Header Name", placeholder: "X-API-Key", type: "text", required: false },
      { key: "authQueryParam", label: "Auth Query Param", placeholder: "api_key", type: "text", required: false },
      { key: "probePath", label: "Probe Path", placeholder: "/health", type: "text", required: false },
      { key: "allowedPathPrefixes", label: "Allowed Path Prefixes", placeholder: "[\"/v1/reports\", \"/v1/metrics\"]", type: "textarea", rows: 3 },
      { key: "defaultHeaders", label: "Default Headers JSON", placeholder: "{\"X-Tenant\":\"example\"}", type: "textarea", rows: 3, required: false },
      { key: "actions", label: "Actions JSON", placeholder: "[{\"name\":\"list_reports\",\"method\":\"GET\",\"path\":\"/v1/reports\",\"readOnly\":true}]", type: "textarea", rows: 8 },
    ],
  },
  custom_openapi: {
    provider: "custom_openapi",
    fields: [
      { key: "connectionLabel", label: "Connection Label", placeholder: "OpenAPI service", type: "text" },
      { key: "specUrl", label: "Spec URL", placeholder: "https://internal.example.com/openapi.json", type: "text" },
      { key: "baseUrl", label: "Base URL Override", placeholder: "Optional live API base URL", type: "text", required: false },
      { key: "authMode", label: "Auth Mode", placeholder: "none | bearer | header | query", type: "text", required: false },
      { key: "authToken", label: "Auth Token", placeholder: "Optional token or API key", type: "password", required: false },
      { key: "authHeaderName", label: "Auth Header Name", placeholder: "X-API-Key", type: "text", required: false },
      { key: "authQueryParam", label: "Auth Query Param", placeholder: "api_key", type: "text", required: false },
      { key: "defaultHeaders", label: "Default Headers JSON", placeholder: "{\"X-Tenant\":\"example\"}", type: "textarea", rows: 3, required: false },
      { key: "allowedOperationIds", label: "Allowed Operation IDs", placeholder: "[\"listReports\",\"getRevenueSeries\"]", type: "textarea", rows: 4, required: false },
    ],
  },
  custom_mcp: {
    provider: "custom_mcp",
    fields: [
      { key: "connectionLabel", label: "Connection Label", placeholder: "MCP server", type: "text" },
      { key: "serverUrl", label: "Server URL", placeholder: "https://mcp.example.com/mcp", type: "text" },
      { key: "bearerToken", label: "Bearer Token", placeholder: "Optional bearer token", type: "password", required: false },
      { key: "allowedTools", label: "Allowed Tools JSON", placeholder: "[{\"name\":\"list_reports\",\"mode\":\"read\",\"allow\":true}]", type: "textarea", rows: 6 },
    ],
  },
  github: {
    provider: "github",
    fields: [
      { key: "token", label: "Personal Access Token", placeholder: "github_pat_... or ghp_...", type: "password" },
      { key: "baseUrl", label: "API Base URL", placeholder: "https://api.github.com", type: "text", required: false },
    ],
  },
  vercel: {
    provider: "vercel",
    fields: [
      { key: "token", label: "Personal Access Token", placeholder: "vercel access token", type: "password" },
      { key: "defaultTeam", label: "Default Team", placeholder: "team_xxx or my-team", type: "text", required: false },
    ],
  },
  linear: {
    provider: "linear",
    fields: [
      { key: "token", label: "Personal API Key", placeholder: "lin_api_...", type: "password" },
      { key: "defaultTeamId", label: "Default Team ID", placeholder: "Optional Linear team ID", type: "text", required: false },
      { key: "defaultProjectId", label: "Default Project ID", placeholder: "Optional Linear project ID", type: "text", required: false },
    ],
  },
  notion: {
    provider: "notion",
    fields: [
      { key: "token", label: "Integration Token", placeholder: "secret_... or ntn_...", type: "password" },
      { key: "baseUrl", label: "API Base URL", placeholder: "https://api.notion.com", type: "text", required: false },
    ],
  },
  slack: {
    provider: "slack",
    fields: [
      { key: "token", label: "Bot Token", placeholder: "xoxb-...", type: "password" },
    ],
  },
  jira: {
    provider: "jira",
    fields: [
      { key: "siteUrl", label: "Site URL", placeholder: "https://example.atlassian.net", type: "text" },
      { key: "email", label: "Account Email", placeholder: "ops@example.com", type: "text" },
      { key: "apiToken", label: "API Token", placeholder: "Atlassian API token", type: "password" },
    ],
  },
  bamboohr: {
    provider: "bamboohr",
    fields: [
      { key: "subdomain", label: "Subdomain", placeholder: "example", type: "text" },
      { key: "apiKey", label: "API Key", placeholder: "BambooHR API key", type: "password" },
    ],
  },
  confluence: {
    provider: "confluence",
    fields: [
      { key: "siteUrl", label: "Site URL", placeholder: "https://example.atlassian.net", type: "text" },
      { key: "email", label: "Account Email", placeholder: "ops@example.com", type: "text" },
      { key: "apiToken", label: "API Token", placeholder: "Atlassian API token", type: "password" },
    ],
  },
  ms_graph: {
    provider: "ms_graph",
    fields: [
      { key: "tenantId", label: "Tenant ID", placeholder: "Entra tenant ID", type: "text" },
      { key: "clientId", label: "Client ID", placeholder: "App registration client ID", type: "text" },
      { key: "clientSecret", label: "Client Secret", placeholder: "App registration client secret", type: "password" },
    ],
  },
  dynamics_bc: {
    provider: "dynamics_bc",
    fields: [
      { key: "tenantId", label: "Tenant ID", placeholder: "Entra tenant ID", type: "text" },
      { key: "clientId", label: "Client ID", placeholder: "App registration client ID", type: "text" },
      { key: "clientSecret", label: "Client Secret", placeholder: "App registration client secret", type: "password" },
      { key: "environmentName", label: "Environment", placeholder: "Production", type: "text" },
      { key: "companyId", label: "Company ID", placeholder: "Optional default company GUID", type: "text", required: false },
    ],
  },
  payhawk: {
    provider: "payhawk",
    fields: [
      { key: "apiKey", label: "API Key", placeholder: "Payhawk API key", type: "password" },
      { key: "accountId", label: "Account ID", placeholder: "moneytea_ltd_8f9bb396", type: "text", required: false },
      { key: "baseUrl", label: "Base URL", placeholder: "https://api.payhawk.com", type: "text", required: false },
    ],
  },
  zendesk: {
    provider: "zendesk",
    fields: [
      { key: "subdomain", label: "Subdomain", placeholder: "example", type: "text" },
      { key: "email", label: "Account Email", placeholder: "ops@example.com", type: "text" },
      { key: "apiToken", label: "API Token", placeholder: "Zendesk API token", type: "password" },
    ],
  },
  linkedin_mcp: {
    provider: "linkedin_mcp",
    fields: [
      { key: "serverUrl", label: "Server URL", placeholder: "https://mcp.example.com/mcp", type: "text" },
      { key: "bearerToken", label: "Bearer Token", placeholder: "Optional bearer token", type: "password", required: false },
    ],
  },
  metabase: {
    provider: "metabase",
    fields: [
      { key: "baseUrl", label: "Base URL", placeholder: "https://metabase.example.com", type: "text" },
      { key: "apiKey", label: "API Key", placeholder: "mb_...", type: "password" },
    ],
  },
  posthog: {
    provider: "posthog",
    fields: [
      { key: "baseUrl", label: "Base URL", placeholder: "https://us.posthog.com", type: "text" },
      { key: "token", label: "Personal API Key", placeholder: "phx_... or personal API key", type: "password" },
    ],
  },
};

type ManualProviderKind = "email_ingest" | "telegram";

interface ManualProviderConfig {
  provider: string;
  kind: ManualProviderKind;
}

const MANUAL_PROVIDERS: Record<string, ManualProviderConfig> = {
  email_ingest: {
    provider: "email_ingest",
    kind: "email_ingest",
  },
  telegram: {
    provider: "telegram",
    kind: "telegram",
  },
};

/* ---------- Odoo sync config ---------- */

const ODOO_SYNC_OPTIONS = [
  { key: "invoices", label: "Invoices (customer)" },
  { key: "bills", label: "Bills (vendor)" },
  { key: "payments", label: "Payments" },
  { key: "purchase_orders", label: "Purchase Orders" },
  { key: "sales_orders", label: "Sales Orders" },
  { key: "journal_entries", label: "Journal Entries" },
  { key: "chart_of_accounts", label: "Chart of Accounts" },
  { key: "partners", label: "Partners (vendors/customers)" },
];

/* ---------- ConnectorCard component ---------- */

interface ConnectorCardProps {
  name: string;
  description: string;
  icon: LucideIcon;
  providerSlug?: string;
  connectorStatus: ConnectorStatus;
  /** null = not applicable (API-key or coming-soon), boolean = OAuth configured status */
  oauthConfigured?: boolean | null;
  onConnected?: () => void;
  /** Whether this provider is already connected (shown in Connected Sources) */
  alreadyConnected?: boolean;
}

export function ConnectorCard({
  name,
  description,
  icon: Icon,
  providerSlug,
  connectorStatus,
  oauthConfigured,
  onConnected,
  alreadyConnected,
}: ConnectorCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [syncModels, setSyncModels] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [manualAddress, setManualAddress] = useState<string | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualCopied, setManualCopied] = useState(false);
  const [emailAllowedSenders, setEmailAllowedSenders] = useState("");
  const [emailAllowAllSenders, setEmailAllowAllSenders] = useState(false);
  const [emailAllowlistSaving, setEmailAllowlistSaving] = useState(false);
  const [emailAllowlistSaved, setEmailAllowlistSaved] = useState(false);
  const [telegramStep, setTelegramStep] = useState<
    "phone" | "code" | "password" | "chats" | "done"
  >("phone");
  const [telegramPhone, setTelegramPhone] = useState("");
  const [telegramCode, setTelegramCode] = useState("");
  const [telegramPassword, setTelegramPassword] = useState("");
  const [telegramLoginState, setTelegramLoginState] = useState("");
  const [telegramChats, setTelegramChats] = useState<
    Array<{
      chatId: string;
      title: string;
      type: string;
      entityClass?: string;
      accessHash?: string;
      enabled: boolean;
      lastSyncedMessageId: number;
    }>
  >([]);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramCodeViaApp, setTelegramCodeViaApp] = useState(false);

  const providerKey = providerSlug ?? "";
  const apiKeyConfig = API_KEY_PROVIDERS[providerKey];
  const manualConfig = MANUAL_PROVIDERS[providerKey];
  const isMultiField = !!apiKeyConfig?.fields;
  const isComingSoon = connectorStatus === "coming-soon";
  const isOAuthUnconfigured = oauthConfigured === false;
  const setupInfo = getProviderSetupInfo(providerKey);
  const isOdoo = apiKeyConfig?.provider === "odoo";
  const isManualProvider = !!manualConfig;
  const isEmailIngest = manualConfig?.kind === "email_ingest";
  const isTelegram = manualConfig?.kind === "telegram";
  const isGoogleDrive = providerSlug === "google_drive";

  const loadEmailIngestAddress = useCallback(
    async (method: "GET" | "POST" = "GET") => {
      if (!isEmailIngest) return;

      setManualLoading(true);
      setManualError(null);
      try {
        const response = await fetch("/api/connections/providers/email-ingest", {
          method,
          headers: { "Content-Type": "application/json" },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : `Email ingest setup failed (${response.status})`,
          );
        }

        const address =
          typeof payload.address === "string" ? payload.address.trim() : "";
        if (!address) {
          throw new Error("Server did not return an ingest address.");
        }

        setManualAddress(address);
        const senderAllowlist =
          payload.senderAllowlist &&
          typeof payload.senderAllowlist === "object" &&
          !Array.isArray(payload.senderAllowlist)
            ? (payload.senderAllowlist as {
                allowedSenders?: unknown;
                allowAllSenders?: unknown;
              })
            : null;
        if (senderAllowlist) {
          setEmailAllowedSenders(
            Array.isArray(senderAllowlist.allowedSenders)
              ? senderAllowlist.allowedSenders
                  .filter((entry): entry is string => typeof entry === "string")
                  .join("\n")
              : "",
          );
          setEmailAllowAllSenders(senderAllowlist.allowAllSenders === true);
        }
      } catch (err) {
        setManualError(
          err instanceof Error ? err.message : "Failed to load ingest address",
        );
      } finally {
        setManualLoading(false);
      }
    },
    [isEmailIngest],
  );

  // Hydrate existing Odoo connection on mount so sync config survives reload
  useEffect(() => {
    if (!isOdoo) return;
    let cancelled = false;
    fetch("/api/connections")
      .then((r) => (r.ok ? r.json() : []))
      .then((conns: Array<{ id: string; provider: string; metadata?: Record<string, unknown> }>) => {
        if (cancelled) return;
        const odoo = conns.find((c) => c.provider === "odoo");
        if (odoo) {
          setConnectionId(odoo.id);
          const meta = odoo.metadata as Record<string, unknown> | undefined;
          if (Array.isArray(meta?.syncModels)) {
            setSyncModels(meta.syncModels as string[]);
          }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOdoo]);

  useEffect(() => {
    if (!isEmailIngest) return;
    void loadEmailIngestAddress("GET");
  }, [isEmailIngest, loadEmailIngestAddress]);

  const loadTelegramChats = useCallback(async () => {
    if (!isTelegram) return false;

    setTelegramLoading(true);
    setTelegramError(null);
    try {
      const response = await fetch("/api/connections/telegram/chats");
      const payload = await response.json().catch(() => ({}));

      if (response.status === 404) {
        setTelegramStep("phone");
        setTelegramChats([]);
        return false;
      }

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Telegram chat load failed (${response.status})`,
        );
      }

      setConnectionId(typeof payload.connectionId === "string" ? payload.connectionId : null);
      setTelegramPhone(typeof payload.phone === "string" ? payload.phone : "");
      setTelegramChats(
        Array.isArray(payload.chats)
          ? payload.chats.map((chat: unknown) => {
              const value =
                chat && typeof chat === "object"
                  ? (chat as Record<string, unknown>)
                  : {};
              return {
                chatId: typeof value.chatId === "string" ? value.chatId : "",
                title: typeof value.title === "string" ? value.title : "Telegram chat",
                type: typeof value.type === "string" ? value.type : "group",
                entityClass:
                  typeof value.entityClass === "string" ? value.entityClass : undefined,
                accessHash:
                  typeof value.accessHash === "string" ? value.accessHash : undefined,
                enabled: Boolean(value.enabled),
                lastSyncedMessageId:
                  typeof value.lastSyncedMessageId === "number"
                    ? value.lastSyncedMessageId
                    : 0,
              };
            })
          : [],
      );
      setTelegramStep("chats");
      return true;
    } catch (err) {
      setTelegramError(
        err instanceof Error ? err.message : "Failed to load Telegram chats",
      );
      return false;
    } finally {
      setTelegramLoading(false);
    }
  }, [isTelegram]);

  useEffect(() => {
    if (!expanded || !isTelegram) return;
    void loadTelegramChats();
  }, [expanded, isTelegram, loadTelegramChats]);

  const handleTelegramSendCode = useCallback(async () => {
    if (!isTelegram || !telegramPhone.trim()) return;

    setTelegramLoading(true);
    setTelegramError(null);
    try {
      const response = await fetch("/api/connections/telegram/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: telegramPhone.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Telegram auth failed (${response.status})`,
        );
      }

      setTelegramPhone(typeof payload.phone === "string" ? payload.phone : telegramPhone.trim());
      setTelegramCodeViaApp(Boolean(payload.isCodeViaApp));
      setTelegramLoginState(
        typeof payload.loginState === "string" ? payload.loginState : "",
      );
      setTelegramCode("");
      setTelegramPassword("");
      setTelegramStep("code");
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : "Failed to send Telegram code");
    } finally {
      setTelegramLoading(false);
    }
  }, [isTelegram, telegramPhone]);

  const handleTelegramVerify = useCallback(async () => {
    if (!isTelegram || !telegramLoginState) return;

    setTelegramLoading(true);
    setTelegramError(null);
    try {
      const response = await fetch("/api/connections/telegram/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: telegramPhone.trim(),
          code: telegramStep === "code" ? telegramCode.trim() : undefined,
          password: telegramStep === "password" ? telegramPassword : undefined,
          loginState: telegramLoginState,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Telegram verification failed (${response.status})`,
        );
      }

      if (payload.requiresPassword) {
        setTelegramLoginState(
          typeof payload.loginState === "string" ? payload.loginState : telegramLoginState,
        );
        setTelegramStep("password");
        return;
      }

      if (typeof payload.connectionId === "string") {
        setConnectionId(payload.connectionId);
      }

      await loadTelegramChats();
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : "Telegram verification failed");
    } finally {
      setTelegramLoading(false);
    }
  }, [
    isTelegram,
    loadTelegramChats,
    telegramCode,
    telegramLoginState,
    telegramPassword,
    telegramPhone,
    telegramStep,
  ]);

  const handleTelegramToggleChat = useCallback((chatId: string) => {
    setTelegramChats((current) =>
      current.map((chat) =>
        chat.chatId === chatId ? { ...chat, enabled: !chat.enabled } : chat,
      ),
    );
  }, []);

  const handleTelegramSaveChats = useCallback(async () => {
    if (!isTelegram || !connectionId) return;

    setTelegramLoading(true);
    setTelegramError(null);
    try {
      const response = await fetch("/api/connections/telegram/select-chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          chats: telegramChats,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Telegram chat selection failed (${response.status})`,
        );
      }

      setTelegramStep("done");
      onConnected?.();
    } catch (err) {
      setTelegramError(
        err instanceof Error ? err.message : "Failed to save Telegram chats",
      );
    } finally {
      setTelegramLoading(false);
    }
  }, [connectionId, isTelegram, onConnected, telegramChats]);

  const handleConnectClick = useCallback(() => {
    if (isComingSoon || isOAuthUnconfigured) return;

    if (apiKeyConfig || manualConfig) {
      setExpanded((prev) => !prev);
      if (!expanded && isEmailIngest && !manualAddress) {
        void loadEmailIngestAddress("GET");
      }
      return;
    }

    // For OAuth providers, redirect to the OAuth authorize endpoint
    const slug = providerSlug || name.toLowerCase().replace(/\s+/g, "_");
    window.location.href = `/api/connections/oauth/authorize?provider=${slug}`;
  }, [
    apiKeyConfig,
    expanded,
    isComingSoon,
    isEmailIngest,
    isOAuthUnconfigured,
    loadEmailIngestAddress,
    manualAddress,
    manualConfig,
    name,
    providerSlug,
  ]);

  const handleCopyManualAddress = useCallback(async () => {
    if (!manualAddress) return;

    try {
      await navigator.clipboard.writeText(manualAddress);
      setManualCopied(true);
      window.setTimeout(() => setManualCopied(false), 1500);
    } catch {
      setManualError("Could not copy the ingest address.");
    }
  }, [manualAddress]);

  const handleSaveEmailAllowlist = useCallback(async () => {
    if (!isEmailIngest) return;

    setEmailAllowlistSaving(true);
    setEmailAllowlistSaved(false);
    setManualError(null);
    try {
      const response = await fetch("/api/connections/providers/email-ingest", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowedSenders: emailAllowedSenders,
          allowAllSenders: emailAllowAllSenders,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Sender allowlist update failed (${response.status})`,
        );
      }

      const senderAllowlist =
        payload.senderAllowlist &&
        typeof payload.senderAllowlist === "object" &&
        !Array.isArray(payload.senderAllowlist)
          ? (payload.senderAllowlist as {
              allowedSenders?: unknown;
              allowAllSenders?: unknown;
            })
          : null;
      if (senderAllowlist) {
        setEmailAllowedSenders(
          Array.isArray(senderAllowlist.allowedSenders)
            ? senderAllowlist.allowedSenders
                .filter((entry): entry is string => typeof entry === "string")
                .join("\n")
            : "",
        );
        setEmailAllowAllSenders(senderAllowlist.allowAllSenders === true);
      }
      setEmailAllowlistSaved(true);
      window.setTimeout(() => setEmailAllowlistSaved(false), 1500);
    } catch (err) {
      setManualError(
        err instanceof Error ? err.message : "Failed to save sender allowlist",
      );
    } finally {
      setEmailAllowlistSaving(false);
    }
  }, [emailAllowedSenders, emailAllowAllSenders, isEmailIngest]);

  const handleSubmitApiKey = useCallback(async () => {
    if (!apiKeyConfig) return;

    // Validate inputs
    if (isMultiField) {
      const fields = apiKeyConfig.fields!;
      const allFilled = fields.every(
        (f) => f.required === false || fieldValues[f.key]?.trim(),
      );
      if (!allFilled) return;
    } else {
      if (!apiKey.trim()) return;
    }

    setStatus("loading");
    setErrorMessage("");

    try {
      const credentials = isMultiField
        ? Object.fromEntries(
            apiKeyConfig.fields!.map((f) => [f.key, fieldValues[f.key]?.trim() ?? ""])
          )
        : { apiKey: apiKey.trim() };

      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: apiKeyConfig.provider,
          credentials,
        }),
      });

      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: "Connection failed" }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setStatus("success");
      setApiKey("");
      setFieldValues({});
      onConnected?.();

      if (isOdoo && data?.id) {
        // For Odoo, capture connection ID and show sync config instead of auto-collapsing
        setConnectionId(data.id);
      } else {
        // Collapse after brief success indication
        setTimeout(() => {
          setExpanded(false);
          setStatus("idle");
        }, 2000);
      }
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Connection failed"
      );
    }
  }, [apiKey, apiKeyConfig, fieldValues, isMultiField, isOdoo, onConnected]);

  const handleSyncModelToggle = useCallback(
    async (model: string, checked: boolean) => {
      const prev = syncModels;
      const next = checked
        ? [...syncModels, model]
        : syncModels.filter((m) => m !== model);
      setSyncModels(next);

      if (!connectionId) return;
      try {
        const res = await fetch(`/api/connections/${connectionId}/config`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ syncModels: next }),
        });
        if (!res.ok) {
          setSyncModels(prev); // revert on server error
        }
      } catch {
        setSyncModels(prev); // revert on network error
      }
    },
    [syncModels, connectionId]
  );

  const handleSyncNow = useCallback(async () => {
    if (!connectionId) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch(`/api/connections/${connectionId}/sync`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Sync failed" }));
        setSyncError(body.error || `Sync failed (HTTP ${res.status})`);
      }
    } catch {
      setSyncError("Network error — could not reach server");
    } finally {
      setSyncing(false);
    }
  }, [connectionId]);

  const multiFieldAllFilled = isMultiField
    ? apiKeyConfig.fields!.every(
        (f) => f.required === false || fieldValues[f.key]?.trim(),
      )
    : false;

  return (
    <Card
      className={`group relative overflow-hidden py-4 transition-all duration-200 ${
        isComingSoon
          ? "opacity-60"
          : isOAuthUnconfigured
            ? "opacity-90"
            : "hover:border-border hover:shadow-sm"
      }`}
    >
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3.5">
          {/* Provider icon — inset ring + soft gradient gives the card a more
              tactile, "branded" feel than a flat muted square. */}
          <div className="relative size-11 shrink-0 rounded-xl bg-gradient-to-br from-muted/80 to-muted ring-1 ring-inset ring-border/60 flex items-center justify-center transition-colors group-hover:ring-border">
            <Icon className="size-5 text-foreground/70" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium leading-tight text-foreground">{name}</p>
              {alreadyConnected && !isComingSoon && !isOAuthUnconfigured && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Connected
                </span>
              )}
              {isComingSoon && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground border-border/70"
                >
                  Coming Soon
                </Badge>
              )}
              {isOAuthUnconfigured && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-600 border-amber-500/30"
                >
                  Setup Required
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {description}
            </p>
            {isOAuthUnconfigured && (
              <p className="text-[11px] text-muted-foreground/70 mt-1 flex items-center gap-1">
                <HelpCircle className="size-3 shrink-0" />
                Contact your administrator to enable this integration
              </p>
            )}
          </div>

          <Button
            variant={
              alreadyConnected && !isOdoo && !isManualProvider && !isGoogleDrive
                ? "ghost"
                : "outline"
            }
            size="sm"
            onClick={handleConnectClick}
            disabled={
              status === "loading" ||
              telegramLoading ||
              isComingSoon ||
              isOAuthUnconfigured ||
              (!!alreadyConnected && !isOdoo && !isManualProvider && !isGoogleDrive)
            }
            className="shrink-0"
          >
            {status === "loading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : expanded ? (
              "Cancel"
            ) : (isEmailIngest && manualAddress) || (isTelegram && alreadyConnected) ? (
              "Manage"
            ) : alreadyConnected && isOdoo ? (
              "Configure"
            ) : alreadyConnected && isGoogleDrive ? (
              "Connect Another"
            ) : alreadyConnected ? (
              "Connected"
            ) : (
              "Connect"
            )}
          </Button>
        </div>

        {expanded && (apiKeyConfig || manualConfig) && (
          <div className="space-y-2 pt-1">
            {/* Setup instructions */}
            {setupInfo && (
              <div className="rounded-md bg-muted/50 p-3 space-y-2">
                <p className="text-xs font-medium text-foreground">How to get your key</p>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                  {setupInfo.instructions.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                <a
                  href={setupInfo.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="size-3" />
                  {setupInfo.docsLabel}
                </a>
              </div>
            )}

            {isEmailIngest ? (
              <div className="space-y-3">
                <div className="rounded-md border border-border bg-background/70 p-3 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">Private ingest address</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Forward supported attachments here to push them into the document pipeline.
                    </p>
                  </div>

                  <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 font-mono text-xs break-all text-foreground">
                    {manualLoading ? "Loading address..." : manualAddress ?? "No address available"}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleCopyManualAddress}
                      disabled={!manualAddress || manualLoading}
                    >
                      <Copy className="size-3.5" />
                      {manualCopied ? "Copied" : "Copy"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void loadEmailIngestAddress("POST")}
                      disabled={manualLoading}
                    >
                      {manualLoading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      Regenerate
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-border bg-background/70 p-3 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">Allowed senders</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Add exact emails or domains. One entry per line.
                    </p>
                  </div>

                  <textarea
                    value={emailAllowedSenders}
                    onChange={(event) => setEmailAllowedSenders(event.target.value)}
                    disabled={emailAllowAllSenders || emailAllowlistSaving}
                    placeholder={"finance@example.com\n@example.com"}
                    rows={4}
                    className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />

                  <label className="flex items-center gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={emailAllowAllSenders}
                      onChange={(event) => setEmailAllowAllSenders(event.target.checked)}
                      disabled={emailAllowlistSaving}
                      className="size-4 rounded border-border"
                    />
                    Allow all senders for this ingest address
                  </label>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleSaveEmailAllowlist()}
                    disabled={emailAllowlistSaving}
                  >
                    {emailAllowlistSaving ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : emailAllowlistSaved ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    {emailAllowlistSaved ? "Saved" : "Save senders"}
                  </Button>
                </div>

                {manualError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-500">
                    <XCircle className="size-3 shrink-0" />
                    {manualError}
                  </div>
                )}
              </div>
            ) : isTelegram ? (
              <div className="space-y-3">
                {telegramError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-500">
                    <XCircle className="size-3 shrink-0" />
                    {telegramError}
                  </div>
                )}

                {telegramStep === "phone" && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Telegram phone number
                    </label>
                    <Input
                      type="text"
                      placeholder="+62812345678"
                      value={telegramPhone}
                      onChange={(event) => setTelegramPhone(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void handleTelegramSendCode();
                        }
                      }}
                      disabled={telegramLoading}
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => void handleTelegramSendCode()}
                      disabled={telegramLoading || !telegramPhone.trim()}
                    >
                      {telegramLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Send Code"
                      )}
                    </Button>
                  </div>
                )}

                {telegramStep === "code" && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      {telegramCodeViaApp
                        ? "Code from Telegram app"
                        : "Verification code"}
                    </label>
                    <Input
                      type="text"
                      placeholder="12345"
                      value={telegramCode}
                      onChange={(event) => setTelegramCode(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void handleTelegramVerify();
                        }
                      }}
                      disabled={telegramLoading}
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => void handleTelegramVerify()}
                      disabled={telegramLoading || !telegramCode.trim()}
                    >
                      {telegramLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Verify Code"
                      )}
                    </Button>
                  </div>
                )}

                {telegramStep === "password" && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">
                      Telegram 2FA password
                    </label>
                    <Input
                      type="password"
                      placeholder="Two-factor password"
                      value={telegramPassword}
                      onChange={(event) => setTelegramPassword(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void handleTelegramVerify();
                        }
                      }}
                      disabled={telegramLoading}
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => void handleTelegramVerify()}
                      disabled={telegramLoading || !telegramPassword}
                    >
                      {telegramLoading ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Verify Password"
                      )}
                    </Button>
                  </div>
                )}

                {telegramStep === "chats" && (
                  <div className="space-y-3">
                    <div className="rounded-md border border-border p-3 space-y-2">
                      <div>
                        <p className="text-xs font-medium text-foreground">
                          Select chats to ingest
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Only selected chats will be polled into the communications pipeline.
                        </p>
                      </div>
                      <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                        {telegramChats.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            {telegramLoading ? "Loading chats..." : "No chats available."}
                          </p>
                        ) : (
                          telegramChats.map((chat) => (
                            <label
                              key={chat.chatId}
                              className="flex items-start gap-2 rounded-md border border-border/60 px-2 py-2 text-xs hover:bg-muted/40"
                            >
                              <input
                                type="checkbox"
                                checked={chat.enabled}
                                onChange={() => handleTelegramToggleChat(chat.chatId)}
                                className="mt-0.5 rounded border-border"
                              />
                              <span className="min-w-0">
                                <span className="block font-medium text-foreground">
                                  {chat.title}
                                </span>
                                <span className="block text-muted-foreground">
                                  {chat.type}
                                </span>
                              </span>
                            </label>
                          ))
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => void handleTelegramSaveChats()}
                          disabled={
                            telegramLoading ||
                            telegramChats.filter((chat) => chat.enabled).length === 0 ||
                            !connectionId
                          }
                        >
                          {telegramLoading ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            `Save (${telegramChats.filter((chat) => chat.enabled).length})`
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleSyncNow}
                          disabled={
                            syncing ||
                            telegramLoading ||
                            !connectionId ||
                            telegramChats.filter((chat) => chat.enabled).length === 0
                          }
                        >
                          {syncing ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            "Sync Now"
                          )}
                        </Button>
                      </div>
                    </div>

                    {syncError && (
                      <div className="flex items-center gap-1.5 text-xs text-red-500">
                        <XCircle className="size-3 shrink-0" />
                        {syncError}
                      </div>
                    )}
                  </div>
                )}

                {telegramStep === "done" && (
                  <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-300">
                    Telegram connected. Sync will start on the next poll cycle, and you can reopen this card to manage chat selection.
                  </div>
                )}
              </div>
            ) : isOdoo && connectionId ? (
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-xs text-green-500">
                  <CheckCircle2 className="size-3 shrink-0" />
                  Connected successfully. Select models to sync.
                </div>
                <div className="rounded-md border border-border p-3 space-y-2">
                  <p className="text-xs font-medium text-foreground">Sync Configuration</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {ODOO_SYNC_OPTIONS.map((opt) => (
                      <label
                        key={opt.key}
                        className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={syncModels.includes(opt.key)}
                          onChange={(e) =>
                            handleSyncModelToggle(opt.key, e.target.checked)
                          }
                          className="rounded border-border"
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSyncNow}
                    disabled={syncing || syncModels.length === 0}
                    className="w-full mt-2"
                  >
                    {syncing ? (
                      <>
                        <Loader2 className="size-4 animate-spin mr-1" />
                        Syncing...
                      </>
                    ) : (
                      "Sync Now"
                    )}
                  </Button>
                  {syncError && (
                    <div className="flex items-center gap-1.5 text-xs text-red-500 mt-2">
                      <XCircle className="size-3 shrink-0" />
                      {syncError}
                    </div>
                  )}
                </div>
              </div>
            ) : isMultiField ? (
              /* Multi-field input (e.g. Odoo: portalUrl + token) */
              <div className="space-y-2">
                {apiKeyConfig.fields!.map((field) => (
                  <div key={field.key}>
                    <label className="text-xs text-muted-foreground">
                      {field.label}
                    </label>
                    {field.type === "textarea" ? (
                      <textarea
                        placeholder={field.placeholder}
                        value={fieldValues[field.key] ?? ""}
                        onChange={(e) =>
                          setFieldValues((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        disabled={status === "loading" || status === "success"}
                        rows={field.rows ?? 4}
                        className="mt-1 flex min-h-[96px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    ) : (
                      <Input
                        type={field.type ?? "password"}
                        placeholder={field.placeholder}
                        value={fieldValues[field.key] ?? ""}
                        onChange={(e) =>
                          setFieldValues((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => e.key === "Enter" && handleSubmitApiKey()}
                        disabled={status === "loading" || status === "success"}
                        className="text-sm mt-1"
                      />
                    )}
                  </div>
                ))}
                <Button
                  size="sm"
                  onClick={handleSubmitApiKey}
                  disabled={
                    !multiFieldAllFilled ||
                    status === "loading" ||
                    status === "success"
                  }
                  className="w-full"
                >
                  {status === "loading" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : status === "success" ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            ) : (
              /* Single-field input (e.g. Stripe, Mercury) */
              <>
                <label className="text-xs text-muted-foreground">
                  {apiKeyConfig.label}
                </label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder={apiKeyConfig.placeholder}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmitApiKey()}
                    disabled={status === "loading" || status === "success"}
                    className="text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={handleSubmitApiKey}
                    disabled={
                      !apiKey.trim() ||
                      status === "loading" ||
                      status === "success"
                    }
                  >
                    {status === "loading" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : status === "success" ? (
                      <CheckCircle2 className="size-4" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
              </>
            )}

            {/* Error / success messages (not shown when Odoo sync config is visible) */}
            {!(isOdoo && connectionId) && !isTelegram && status === "error" && (
              <div className="flex items-center gap-1.5 text-xs text-red-500">
                <XCircle className="size-3 shrink-0" />
                {errorMessage}
              </div>
            )}
            {!(isOdoo && connectionId) && !isTelegram && status === "success" && (
              <div className="flex items-center gap-1.5 text-xs text-green-500">
                <CheckCircle2 className="size-3 shrink-0" />
                Connected successfully. Initial sync started.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
