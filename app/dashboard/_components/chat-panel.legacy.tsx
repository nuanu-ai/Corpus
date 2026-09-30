"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { useLocale } from "next-intl";
import {
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { useRouter } from "next/navigation";
import { useCFOStore } from "@/lib/store";
import {
  buildDashboardHrefForView,
  isDocumentsDashboardView,
  isFinanceDashboardView,
} from "@/lib/dashboard-navigation";
import {
  serializeChatStateForStorage,
  type PersistableChatThread,
} from "@/lib/consultant/chat-storage";
import {
  downloadConsultantArtifact,
  isPreviewableConsultantArtifact,
  shareConsultantArtifactToCompany,
} from "@/lib/consultant/artifact-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send,
  Bot,
  User,
  Loader2,
  Paperclip,
  RefreshCw,
  Plus,
  History,
  FileText,
  ShieldCheck,
  Clock3,
  Check,
  X,
  Eye,
  Download,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";
import ReactMarkdown from "react-markdown";
import { getAppCopy } from "@/lib/i18n/copy";

const DEFAULT_THREAD_ID = "thread-default";
const MAX_THREAD_HISTORY_MESSAGES = 500;
const MAX_THREAD_COUNT = 20;

type ChatSurface = "company" | "personal";

interface ChatStorageKeys {
  threads: string;
  activeThread: string;
}

interface ChatPanelProps {
  surface?: ChatSurface;
  apiBase?: string;
  documentUploadUrl?: string;
  storageKeyPrefix?: string;
  allowCompanyArtifactShare?: boolean;
  title?: string;
  description?: string;
  inputPlaceholder?: string;
  uploadHint?: string;
}

interface StoredChatThread extends PersistableChatThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: UIMessage[];
  attachments: StoredChatAttachment[];
  artifacts: StoredChatArtifact[];
  approvals: StoredChatApproval[];
}

interface StoredChatAttachment {
  id: string;
  documentId: string | null;
  fileName: string;
  fileType: string | null;
  status: string;
  documentStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredChatArtifact {
  id: string;
  kind: string;
  title: string;
  filePath: string;
  mimeType: string | null;
  status: string;
  uiMessageId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface StoredChatApproval {
  id: string;
  artifactId: string | null;
  action: string;
  status: string;
  payload: Record<string, unknown>;
  requestedBy: string | null;
  approvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredChatState {
  threads: StoredChatThread[];
  activeThreadId: string;
}

interface PendingThreadNotice {
  threadId: string;
  text: string;
}

interface ArtifactPreviewState {
  content?: string;
  error?: string;
  isLoading: boolean;
}

interface DurableTurnResult {
  threadId: string;
  thread: StoredChatThread;
}

function getChatStorageKeys(prefix: string): ChatStorageKeys {
  return {
    threads: `${prefix}:threads:v1`,
    activeThread: `${prefix}:active-thread:v1`,
  };
}

function buildThreadListUrl(apiBase: string): string {
  return `${apiBase}/threads?summary=1`;
}

function buildThreadUrl(apiBase: string, threadId: string): string {
  return `${apiBase}/threads/${encodeURIComponent(threadId)}`;
}

function buildApprovalUrl(
  apiBase: string,
  threadId: string,
  approvalId: string,
): string {
  return `${buildThreadUrl(apiBase, threadId)}/approvals/${encodeURIComponent(approvalId)}`;
}

function buildArtifactUrl(
  apiBase: string,
  threadId: string,
  artifactId: string,
): string {
  return `${buildThreadUrl(apiBase, threadId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function getUiLocale(): string {
  if (typeof document === "undefined") return "en";
  return document.documentElement.lang || "en";
}

function resolveSurfaceHref(view: string): string | null {
  if (isFinanceDashboardView(view) || isDocumentsDashboardView(view)) {
    return buildDashboardHrefForView(view);
  }
  return null;
}

function getDefaultThreadTitle(locale: string): string {
  return getAppCopy(locale).dashboard.chat.newThread;
}

function buildDefaultThread(id: string, locale = getUiLocale()): StoredChatThread {
  return {
    id,
    title: getDefaultThreadTitle(locale),
    updatedAt: new Date().toISOString(),
    messages: [],
    attachments: [],
    artifacts: [],
    approvals: [],
  };
}

function trimMessages(messages: UIMessage[]): UIMessage[] {
  if (messages.length <= MAX_THREAD_HISTORY_MESSAGES) return messages;
  return messages.slice(-MAX_THREAD_HISTORY_MESSAGES);
}

function deriveThreadTitle(messages: UIMessage[], locale = getUiLocale()): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage) return getDefaultThreadTitle(locale);
  const text = firstUserMessage.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
  if (!text) return getDefaultThreadTitle(locale);
  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

function isValidRole(role: unknown): role is UIMessage["role"] {
  return role === "user" || role === "assistant" || role === "system";
}

function isUIMessage(value: unknown): value is UIMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { id?: unknown; role?: unknown; parts?: unknown };
  return (
    typeof candidate.id === "string" &&
    isValidRole(candidate.role) &&
    Array.isArray(candidate.parts)
  );
}

function normalizeMessages(value: unknown): UIMessage[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.filter(isUIMessage);
  const withoutLegacyGreeting = normalized.filter(
    (message) => message.id !== "greeting",
  );
  if (withoutLegacyGreeting.length === 0) return [];
  return trimMessages(withoutLegacyGreeting);
}

function normalizeThread(value: unknown): StoredChatThread | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    id?: unknown;
    title?: unknown;
    updatedAt?: unknown;
    messages?: unknown;
    attachments?: unknown;
    artifacts?: unknown;
    approvals?: unknown;
  };
  if (typeof candidate.id !== "string") return null;
  return {
    id: candidate.id,
    title:
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title
        : getDefaultThreadTitle(getUiLocale()),
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
    messages: normalizeMessages(candidate.messages),
    attachments: normalizeAttachments(candidate.attachments),
    artifacts: normalizeArtifacts(candidate.artifacts),
    approvals: normalizeApprovals(candidate.approvals),
  };
}

function normalizeAttachment(value: unknown): StoredChatAttachment | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.fileName !== "string") {
    return null;
  }

  return {
    id: candidate.id,
    documentId: typeof candidate.documentId === "string" ? candidate.documentId : null,
    fileName: candidate.fileName,
    fileType: typeof candidate.fileType === "string" ? candidate.fileType : null,
    status: typeof candidate.status === "string" ? candidate.status : "uploaded",
    documentStatus:
      typeof candidate.documentStatus === "string" ? candidate.documentStatus : null,
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
  };
}

function normalizeAttachments(value: unknown): StoredChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((attachment) => normalizeAttachment(attachment))
    .filter((attachment): attachment is StoredChatAttachment => attachment !== null);
}

function mergeAttachments(
  existing: StoredChatAttachment[],
  incoming: StoredChatAttachment[],
): StoredChatAttachment[] {
  const byId = new Map<string, StoredChatAttachment>();
  for (const attachment of [...incoming, ...existing]) {
    byId.set(attachment.id, attachment);
  }
  return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeArtifact(value: unknown): StoredChatArtifact | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.kind !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.filePath !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    kind: candidate.kind,
    title: candidate.title,
    filePath: candidate.filePath,
    mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : null,
    status: typeof candidate.status === "string" ? candidate.status : "draft",
    uiMessageId: typeof candidate.uiMessageId === "string" ? candidate.uiMessageId : null,
    metadata: isRecord(candidate.metadata) ? candidate.metadata : {},
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
  };
}

function normalizeArtifacts(value: unknown): StoredChatArtifact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((artifact) => normalizeArtifact(artifact))
    .filter((artifact): artifact is StoredChatArtifact => artifact !== null);
}

function mergeArtifacts(
  existing: StoredChatArtifact[],
  incoming: StoredChatArtifact[],
): StoredChatArtifact[] {
  const byId = new Map<string, StoredChatArtifact>();
  for (const artifact of [...incoming, ...existing]) {
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function normalizeApproval(value: unknown): StoredChatApproval | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.action !== "string" ||
    typeof candidate.status !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    artifactId: typeof candidate.artifactId === "string" ? candidate.artifactId : null,
    action: candidate.action,
    status: candidate.status,
    payload: isRecord(candidate.payload) ? candidate.payload : {},
    requestedBy:
      typeof candidate.requestedBy === "string" ? candidate.requestedBy : null,
    approvedBy:
      typeof candidate.approvedBy === "string" ? candidate.approvedBy : null,
    resolvedAt:
      typeof candidate.resolvedAt === "string" ? candidate.resolvedAt : null,
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
  };
}

function normalizeApprovals(value: unknown): StoredChatApproval[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((approval) => normalizeApproval(approval))
    .filter((approval): approval is StoredChatApproval => approval !== null);
}

function mergeApprovals(
  existing: StoredChatApproval[],
  incoming: StoredChatApproval[],
): StoredChatApproval[] {
  const byId = new Map<string, StoredChatApproval>();
  for (const approval of [...incoming, ...existing]) {
    byId.set(approval.id, approval);
  }
  return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function mergeThreadSummaries(
  existing: StoredChatThread[],
  incoming: StoredChatThread[],
): StoredChatThread[] {
  const existingById = new Map(existing.map((thread) => [thread.id, thread]));

  return incoming.map((thread) => {
    const current = existingById.get(thread.id);
    if (!current) {
      return thread;
    }

    return {
      ...thread,
      messages: current.messages.length > 0 ? current.messages : thread.messages,
      attachments:
        current.attachments.length > 0 ? current.attachments : thread.attachments,
      artifacts: current.artifacts.length > 0 ? current.artifacts : thread.artifacts,
      approvals: current.approvals.length > 0 ? current.approvals : thread.approvals,
    };
  });
}

function resolveActiveThreadId(threads: StoredChatThread[], preferred?: string): string {
  if (preferred && threads.some((thread) => thread.id === preferred)) {
    return preferred;
  }
  return threads[0]?.id ?? DEFAULT_THREAD_ID;
}

async function getApiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = await response.json().catch(() => null);
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return fallback;
}

function loadStoredChatState(storageKeys: ChatStorageKeys): StoredChatState {
  const fallbackThread = buildDefaultThread(DEFAULT_THREAD_ID);
  if (typeof window === "undefined") {
    return { threads: [fallbackThread], activeThreadId: fallbackThread.id };
  }

  try {
    const rawThreads = localStorage.getItem(storageKeys.threads);
    const rawActiveThread = localStorage.getItem(storageKeys.activeThread);
    if (!rawThreads) {
      return { threads: [fallbackThread], activeThreadId: fallbackThread.id };
    }

    const parsedThreads = JSON.parse(rawThreads) as StoredChatThread[];
    if (!Array.isArray(parsedThreads) || parsedThreads.length === 0) {
      return { threads: [fallbackThread], activeThreadId: fallbackThread.id };
    }

    const normalized = parsedThreads
      .map((thread) => normalizeThread(thread))
      .filter((thread): thread is StoredChatThread => thread !== null);

    if (normalized.length === 0) {
      return { threads: [fallbackThread], activeThreadId: fallbackThread.id };
    }

    const activeThreadId = resolveActiveThreadId(normalized, rawActiveThread ?? undefined);

    return { threads: normalized, activeThreadId };
  } catch {
    return { threads: [fallbackThread], activeThreadId: fallbackThread.id };
  }
}

const TOOL_LABELS: Record<string, string> = {
  show_pnl: "Showing P&L report",
  show_expenses: "Showing expense breakdown",
  show_balance_sheet: "Showing balance sheet",
  show_cash_flow: "Showing cash flow analysis",
  show_plan_vs_actual: "Showing plan vs actual",
  show_accounts: "Showing account balances",
  show_alert_details: "Showing alert details",
  show_documents: "Showing documents",
  analyze_website: "Analyzing website",
  suggest_connectors: "Suggesting connectors",
  confirm_profile: "Saving business profile",
  process_document: "Processing document",
  categorize_transaction: "Categorizing transaction",
  create_merchant_rule: "Creating merchant rule",
  suggest_connector: "Suggesting connector",
  get_company_db_overview: "Checking Company-DB overview",
  list_company_connectors: "Checking live integrations",
  use_company_connector: "Querying connected service",
  get_company_domain_summary: "Reading domain summary",
  query_financial_data: "Querying Company-DB",
  query_company_data: "Querying Company-DB",
  search_financial_data: "Searching Company-DB",
  search_company_data: "Searching Company-DB",
  read_company_db_file: "Reading Company-DB file",
  convert_currency_amount: "Converting currency",
  create_consultant_artifact: "Creating draft artifact",
  create_consultant_export: "Creating spreadsheet export",
  request_consultant_approval: "Requesting approval",
  search_odoo: "Searching Odoo",
  get_odoo_record: "Fetching Odoo record",
};

function getToolNameFromPart(part: { type: string; toolName?: string }): string {
  // Dynamic tool parts have a toolName property
  if ("toolName" in part && typeof part.toolName === "string") {
    return part.toolName;
  }
  // Static tool parts have type 'tool-{name}'
  if (part.type.startsWith("tool-")) {
    return part.type.slice(5);
  }
  return part.type;
}

const MAX_TOOL_RESULT_PREVIEW = 5;
const MAX_TOOL_FILE_PREVIEW_CHARS = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n...`;
}

function formatCurrencyAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)} ${currency}`;
  }
}

function formatFxRate(rate: number, fromCurrency: string, toCurrency: string): string {
  return `1 ${fromCurrency} = ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(rate)} ${toCurrency}`;
}

function formatArtifactStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function formatApprovalAction(action: string): string {
  return action.replace(/_/g, " ");
}

function getStatusBadgeClass(status: string): string {
  if (status === "approved" || status === "committed") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "rejected") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  if (status === "pending" || status === "pending_approval") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-border text-muted-foreground";
}

function buildCompanyDbResultMeta(result: Record<string, unknown>): string[] {
  const meta = [
    toText(result.documentKind) ?? toText(result.report_type),
    toText(result.periodLabel) ?? toText(result.period_label) ?? toText(result.period_key) ?? toText(result.period),
    toText(result.currency),
    toText(result.confidence),
    result.requiresReview === true ? "review required" : null,
    toText(result.status),
  ].filter((value): value is string => Boolean(value));

  const lineItemCount = toNumber(result.line_item_count);
  if (lineItemCount !== null) {
    meta.push(`${lineItemCount} rows`);
  }

  return meta;
}

function renderCompanyDbToolPreview(
  output: Record<string, unknown>,
  key: string,
  options?: {
    activeThreadId?: string;
    onShowAgentFiles?: () => void;
    artifactRouteBase?: string;
  },
): ReactElement | null {
  const action = toText(output.action);
  if (!action) return null;

  if (action === "artifact_created") {
    const error = toText(output.error);
    const artifact = isRecord(output.artifact) ? output.artifact : null;
    const title = artifact ? toText(artifact.title) ?? "Draft artifact" : "Draft artifact";
    const status = artifact ? toText(artifact.status) ?? "draft" : "draft";
    const filePath = artifact ? toText(artifact.filePath) : null;
    const artifactId = artifact ? toText(artifact.id) : null;
    const canDownload =
      Boolean(options?.activeThreadId) && Boolean(artifactId);

    return (
      <details
        key={key}
        open={Boolean(error) || Boolean(artifact)}
        className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-foreground"
      >
        <summary className="cursor-pointer list-none break-words font-medium [overflow-wrap:anywhere]">
          Draft artifact
          <span className="ml-2 text-muted-foreground">
            {error ? "error" : title}
          </span>
        </summary>
        <div className="mt-3 space-y-2">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </div>
          ) : artifact ? (
            <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2">
              <div className="font-medium text-foreground">{title}</div>
              <div className="mt-1 text-muted-foreground">
                {toText(artifact.kind) ?? "artifact"} · {formatArtifactStatus(status)}
              </div>
              {filePath && (
                <div className="mt-1 font-mono text-[11px] text-primary/90 break-all">
                  {filePath}
                </div>
              )}
              {canDownload && options?.activeThreadId && artifactId && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      void downloadConsultantArtifact(
                        options.activeThreadId!,
                        artifactId,
                        title,
                        options.artifactRouteBase
                          ? { routeBase: options.artifactRouteBase }
                          : undefined,
                      );
                    }}
                  >
                    <Download className="size-3.5" />
                    Download
                  </Button>
                  {options.onShowAgentFiles ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={options.onShowAgentFiles}
                    >
                      <Eye className="size-3.5" />
                      Open Files
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </details>
    );
  }

  if (action === "approval_requested") {
    const error = toText(output.error);
    const artifact = isRecord(output.artifact) ? output.artifact : null;
    const approval = isRecord(output.approval) ? output.approval : null;

    return (
      <details
        key={key}
        open={Boolean(error) || Boolean(approval)}
        className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-foreground"
      >
        <summary className="cursor-pointer list-none break-words font-medium [overflow-wrap:anywhere]">
          Approval request
          <span className="ml-2 text-muted-foreground">
            {error
              ? "error"
              : artifact
                ? toText(artifact.title) ?? "artifact"
                : "pending"}
          </span>
        </summary>
        <div className="mt-3 space-y-2">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </div>
          ) : approval ? (
            <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2">
              {artifact && (
                <div className="font-medium text-foreground">
                  {toText(artifact.title) ?? "Artifact"}
                </div>
              )}
              <div className="mt-1 text-muted-foreground">
                {formatApprovalAction(toText(approval.action) ?? "approval")} ·{" "}
                {formatArtifactStatus(toText(approval.status) ?? "pending")}
              </div>
            </div>
          ) : null}
        </div>
      </details>
    );
  }

  if (action === "currency_conversion") {
    const error = toText(output.error);
    const amount = toNumber(output.amount);
    const convertedAmount = toNumber(output.convertedAmount);
    const fxRate = toNumber(output.fxRate);
    const fromCurrency = toText(output.fromCurrency) ?? "N/A";
    const toCurrency = toText(output.toCurrency) ?? "N/A";
    const rateDate = toText(output.rateDate);
    const message = toText(output.message);
    const verified = output.verified === true;
    const hasConversion = amount !== null && convertedAmount !== null && fxRate !== null;
    const statusText = error
      ? "error"
      : verified
        ? "verified"
        : "unavailable";

    return (
      <details
        key={key}
        open={Boolean(error) || Boolean(message) || hasConversion}
        className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-foreground"
      >
        <summary className="cursor-pointer list-none break-words font-medium [overflow-wrap:anywhere]">
          Currency conversion
          <span className="ml-2 text-muted-foreground">{statusText}</span>
        </summary>
        <div className="mt-3 space-y-3">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </div>
          ) : (
            <>
              {amount !== null && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Source amount
                    </div>
                    <div className="mt-1 font-medium text-foreground">
                      {formatCurrencyAmount(amount, fromCurrency)}
                    </div>
                    <div className="mt-1 text-muted-foreground">{fromCurrency}</div>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Converted amount
                    </div>
                    <div className="mt-1 font-medium text-foreground">
                      {convertedAmount !== null
                        ? formatCurrencyAmount(convertedAmount, toCurrency)
                        : "Unavailable"}
                    </div>
                    <div className="mt-1 text-muted-foreground">{toCurrency}</div>
                  </div>
                </div>
              )}
              <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 space-y-1">
                {fxRate !== null ? (
                  <div className="text-muted-foreground">
                    {formatFxRate(fxRate, fromCurrency, toCurrency)}
                  </div>
                ) : (
                  <div className="text-muted-foreground">
                    No verified FX rate available.
                  </div>
                )}
                {rateDate && (
                  <div className="text-muted-foreground">Rate date: {rateDate}</div>
                )}
                <div
                  className={
                    verified
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-amber-700 dark:text-amber-300"
                  }
                >
                  {verified
                    ? "Verified rate applied."
                    : "Conversion unavailable. The assistant should keep the original currency unless a verified rate is provided."}
                </div>
              </div>
              {message && (
                <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 text-muted-foreground">
                  {message}
                </div>
              )}
            </>
          )}
        </div>
      </details>
    );
  }

  if (action === "company_db_result" || action === "company_db_search") {
    const error = toText(output.error);
    const results = Array.isArray(output.results)
      ? output.results.filter(isRecord)
      : [];
    const count = toNumber(output.count) ?? results.length;
    const title =
      action === "company_db_search"
        ? `Company-DB search: ${toText(output.query) ?? "query"}`
        : `Company-DB query: ${toText(output.domain) ?? "all"}${toText(output.type) && toText(output.type) !== "all" ? ` / ${toText(output.type)}` : ""}`;

    return (
      <details
        key={key}
        open={Boolean(error) || count > 0}
        className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-foreground"
      >
        <summary className="cursor-pointer list-none break-words font-medium [overflow-wrap:anywhere]">
          {title}
          <span className="ml-2 text-muted-foreground">
            {error ? "error" : `${count} result${count === 1 ? "" : "s"}`}
          </span>
        </summary>
        <div className="mt-3 space-y-2">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </div>
          ) : results.length === 0 ? (
            <div className="text-muted-foreground">No matching records.</div>
          ) : (
            <>
              {results.slice(0, MAX_TOOL_RESULT_PREVIEW).map((result, index) => {
                const titleText =
                  toText(result.title) ??
                  toText(result.account_name) ??
                  toText(result.id) ??
                  `Result ${index + 1}`;
                const meta = buildCompanyDbResultMeta(result);
                const filePath = toText(result.filePath);
                const entityId = toText(result.id);
                const managerialSummary = toText(result.managerialSummary);
                const highlights = Array.isArray(result.highlights)
                  ? result.highlights
                      .map((item) => toText(item))
                      .filter((item): item is string => Boolean(item))
                      .slice(0, 2)
                  : [];
                const risks = Array.isArray(result.risks)
                  ? result.risks
                      .map((item) => toText(item))
                      .filter((item): item is string => Boolean(item))
                      .slice(0, 1)
                  : [];

                return (
                  <div
                    key={`${key}-result-${index}`}
                    className="min-w-0 rounded-lg border border-border/50 bg-background/70 px-3 py-2"
                  >
                    <div className="break-words font-medium text-foreground [overflow-wrap:anywhere]">{titleText}</div>
                    {meta.length > 0 && (
                      <div className="mt-1 break-words text-muted-foreground [overflow-wrap:anywhere]">
                        {meta.join(" · ")}
                      </div>
                    )}
                    {entityId && (
                      <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                        {entityId}
                      </div>
                    )}
                    {managerialSummary && (
                      <div className="mt-2 break-words text-muted-foreground [overflow-wrap:anywhere]">
                        {managerialSummary}
                      </div>
                    )}
                    {highlights.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {highlights.map((highlight) => (
                          <div key={`${entityId}-${highlight}`} className="break-words text-muted-foreground [overflow-wrap:anywhere]">
                            - {highlight}
                          </div>
                        ))}
                      </div>
                    )}
                    {risks.length > 0 && (
                      <div className="mt-2 break-words text-destructive/90 [overflow-wrap:anywhere]">
                        Risk: {risks[0]}
                      </div>
                    )}
                    {filePath && (
                      <div className="mt-1 font-mono text-[11px] text-primary/90 break-all">
                        {filePath}
                      </div>
                    )}
                  </div>
                );
              })}
              {count > results.length && (
                <div className="text-muted-foreground">
                  Showing {results.length} of {count} results.
                </div>
              )}
            </>
          )}
        </div>
      </details>
    );
  }

  if (action === "company_db_overview") {
    const error = toText(output.error);
    const counts = isRecord(output.counts) ? output.counts : {};
    const domainHighlights = Array.isArray(output.domainHighlights)
      ? output.domainHighlights.filter(isRecord)
      : [];
    const domainsWithData = Array.isArray(output.domainsWithData)
      ? output.domainsWithData.filter(isRecord)
      : [];
    const summary = toText(output.summary);
    const hasData = output.hasData === true;
    const countLines = Object.entries(counts)
      .map(([domain, count]) => {
        if (typeof count !== "number") return null;
        return `${domain}: ${count}`;
      })
      .filter((line): line is string => Boolean(line));

    return (
      <details
        key={key}
        open={Boolean(error) || hasData}
        className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-foreground"
      >
        <summary className="cursor-pointer list-none break-words font-medium [overflow-wrap:anywhere]">
          Company-DB overview
          <span className="ml-2 text-muted-foreground">
            {error ? "error" : hasData ? "data detected" : "no records"}
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 space-y-1">
                {countLines.map((line) => (
                  <div key={`${key}-${line}`} className="text-muted-foreground">
                    {line}
                  </div>
                ))}
              </div>
              {domainsWithData.length > 0 && (
                <div className="space-y-2">
                  {domainHighlights.map((domainBlock, index) => {
                    const label =
                      toText(domainBlock.label) ??
                      toText(domainBlock.domain) ??
                      `Domain ${index + 1}`;
                    const count = toNumber(domainBlock.count) ?? 0;
                    const keyRecords = Array.isArray(domainBlock.keyRecords)
                      ? domainBlock.keyRecords.filter(isRecord).slice(0, 2)
                      : [];
                    const domainSummary = toText(domainBlock.summary);
                    return (
                      <div
                        key={`${key}-overview-domain-${index}`}
                        className="min-w-0 rounded-lg border border-border/50 bg-background/70 px-3 py-2"
                      >
                        <div className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
                          {label} · {count}
                        </div>
                        {keyRecords.map((record, recordIndex) => (
                          <div
                            key={`${key}-overview-domain-${index}-record-${recordIndex}`}
                            className="mt-2 rounded-md border border-border/40 bg-background/60 px-2 py-2"
                          >
                            <div className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
                              {toText(record.title) ?? toText(record.type) ?? "Document"}
                            </div>
                            {toText(record.managerialSummary) && (
                              <div className="mt-1 break-words text-muted-foreground [overflow-wrap:anywhere]">
                                {toText(record.managerialSummary)}
                              </div>
                            )}
                            {toText(record.filePath) && (
                              <div className="mt-1 font-mono text-[11px] text-primary/90 break-all">
                                {toText(record.filePath)}
                              </div>
                            )}
                          </div>
                        ))}
                        {keyRecords.length === 0 && domainSummary && (
                          <div className="mt-2 break-words text-muted-foreground [overflow-wrap:anywhere]">
                            {truncateText(domainSummary, 320)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {summary && (
                <pre className="max-h-80 overflow-auto rounded-lg bg-background/80 p-3 font-mono text-[11px] whitespace-pre-wrap break-words">
                  {truncateText(summary, MAX_TOOL_FILE_PREVIEW_CHARS)}
                </pre>
              )}
            </>
          )}
        </div>
      </details>
    );
  }

  if (action === "company_db_domain_summary") {
    const error = toText(output.error);
    const label = toText(output.label) ?? toText(output.domain) ?? "Domain";
    const count = toNumber(output.count) ?? 0;
    const summary = toText(output.summary);
    const keyRecords = Array.isArray(output.keyRecords)
      ? output.keyRecords.filter(isRecord)
      : [];

    return (
      <details
        key={key}
        open={Boolean(error) || count > 0}
        className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-foreground"
      >
        <summary className="cursor-pointer list-none break-words font-medium [overflow-wrap:anywhere]">
          {label} summary
          <span className="ml-2 text-muted-foreground">
            {error ? "error" : `${count} record${count === 1 ? "" : "s"}`}
          </span>
        </summary>
        <div className="mt-3 space-y-2">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </div>
          ) : (
            <>
              {keyRecords.map((record, index) => (
                <div
                  key={`${key}-domain-record-${index}`}
                  className="min-w-0 rounded-lg border border-border/50 bg-background/70 px-3 py-2"
                >
                  <div className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
                    {toText(record.title) ?? toText(record.type) ?? "Document"}
                  </div>
                  {toText(record.managerialSummary) && (
                    <div className="mt-1 break-words text-muted-foreground [overflow-wrap:anywhere]">
                      {toText(record.managerialSummary)}
                    </div>
                  )}
                  {toText(record.filePath) && (
                    <div className="mt-1 font-mono text-[11px] text-primary/90 break-all">
                      {toText(record.filePath)}
                    </div>
                  )}
                </div>
              ))}
              {summary && (
                <pre className="max-h-80 overflow-auto rounded-lg bg-background/80 p-3 font-mono text-[11px] whitespace-pre-wrap break-words">
                  {truncateText(summary, MAX_TOOL_FILE_PREVIEW_CHARS)}
                </pre>
              )}
            </>
          )}
        </div>
      </details>
    );
  }

  if (action === "company_db_file") {
    const filePath = toText(output.filePath) ?? "unknown.qmd";
    const error = toText(output.error);
    const found = output.found !== false;
    const content = toText(output.content);

    return (
      <details
        key={key}
        open={Boolean(error) || Boolean(content)}
        className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/60 p-3 text-xs text-foreground"
      >
        <summary className="cursor-pointer list-none break-words font-medium [overflow-wrap:anywhere]">
          Company-DB file
          <span className="ml-2 break-all font-mono text-[11px] text-muted-foreground">
            {filePath}
          </span>
        </summary>
        <div className="mt-3 space-y-2">
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </div>
          ) : !found || !content ? (
            <div className="text-muted-foreground">File not found.</div>
          ) : (
            <pre className="max-h-80 overflow-auto rounded-lg bg-background/80 p-3 font-mono text-[11px] whitespace-pre-wrap break-words">
              {truncateText(content, MAX_TOOL_FILE_PREVIEW_CHARS)}
            </pre>
          )}
        </div>
      </details>
    );
  }

  return null;
}

export default function ChatPanel({
  surface = "company",
  apiBase = "/api/chat",
  documentUploadUrl,
  storageKeyPrefix,
  allowCompanyArtifactShare,
  title,
  description,
  inputPlaceholder,
  uploadHint,
}: ChatPanelProps = {}) {
  const locale = useLocale();
  const copy = getAppCopy(locale).dashboard.chat;
  const suggestionChips =
    surface === "personal"
      ? [
          "Help me structure today's priorities",
          "Draft a personal note from this conversation",
          "Turn this into a checklist I can keep",
        ]
      : copy.suggestions;
  const defaultThreadTitle = copy.newThread;
  const router = useRouter();
  const { toast } = useToast();
  const setSelectedAlertId = useCFOStore((s) => s.setSelectedAlertId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resolvedDocumentUploadUrl =
    documentUploadUrl ?? (surface === "personal" ? "/api/personal/chat/upload" : "/api/documents/upload");
  const resolvedStorageKeys = useMemo(
    () => getChatStorageKeys(storageKeyPrefix ?? `corpus:chat:${surface}`),
    [storageKeyPrefix, surface],
  );
  const resolvedAllowCompanyArtifactShare =
    allowCompanyArtifactShare ?? surface === "company";
  const resolvedTitle = title ?? (surface === "personal" ? "AI Personal Copilot" : "Corpus Copilot");
  const resolvedDescription =
    description ??
    (surface === "personal"
      ? "Session-only personal chat for your personal workspace"
      : "Company-wide chat for the current workspace");
  const resolvedInputPlaceholder =
    inputPlaceholder ??
    (surface === "personal" ? "Ask about your personal workspace..." : "Ask about your company...");
  const resolvedUploadHint =
    uploadHint ??
    (surface === "personal"
      ? "Files uploaded here become personal documents. Drafts created here stay in your personal workspace."
      : "Files uploaded here become company documents. Drafts created here stay personal until you share them.");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: apiBase,
        prepareSendMessagesRequest: ({ id, messages, body }) => ({
          body: {
            ...(body ?? {}),
            id,
            threadId: id,
            messages,
          },
        }),
      }),
    [apiBase]
  );

  const [input, setInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const initialChatState = useMemo(
    () => loadStoredChatState(resolvedStorageKeys),
    [resolvedStorageKeys],
  );
  const [threads, setThreads] = useState<StoredChatThread[]>(
    initialChatState.threads,
  );
  const [activeThreadId, setActiveThreadId] = useState(
    initialChatState.activeThreadId,
  );
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [serverThreadsReady, setServerThreadsReady] = useState(false);
  const [pendingThreadNotice, setPendingThreadNotice] = useState<PendingThreadNotice | null>(null);
  const [resolvingApprovalIds, setResolvingApprovalIds] = useState<string[]>([]);
  const [artifactPreviews, setArtifactPreviews] = useState<Record<string, ArtifactPreviewState>>({});
  const [isPersistingTurn, setIsPersistingTurn] = useState(false);
  const threadsRef = useRef(initialChatState.threads);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0],
    [threads, activeThreadId],
  );
  const activeThreadSyncKey = activeThread
    ? `${activeThread.id}:${activeThread.updatedAt}:${activeThread.messages.length}`
    : "none";

  const threadOptions = useMemo(
    () =>
      [...threads].sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [threads],
  );

  const updateThreadState = useCallback(
    (
      threadId: string,
      updater: (thread: StoredChatThread) => StoredChatThread,
    ) => {
      setThreads((prev) =>
        prev.map((thread) => (thread.id === threadId ? updater(thread) : thread)),
      );
    },
    [],
  );

  const loadThreadsFromServer = useCallback(async (): Promise<StoredChatThread[]> => {
    const response = await fetch(buildThreadListUrl(apiBase), {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      const errorMessage = await getApiErrorMessage(
        response,
        `Failed to load chat history (${response.status})`,
      );
      throw new Error(errorMessage);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("Invalid server response for chat history");
    }
    return payload
      .map((item) => normalizeThread(item))
      .filter((thread): thread is StoredChatThread => thread !== null);
  }, [apiBase]);

  const loadThreadFromServer = useCallback(async (threadId: string) => {
    const response = await fetch(buildThreadUrl(apiBase, threadId), {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      const errorMessage = await getApiErrorMessage(
        response,
        `Failed to load chat thread (${response.status})`,
      );
      throw new Error(errorMessage);
    }

    const payload = (await response.json()) as unknown;
    const normalized = normalizeThread(payload);
    if (!normalized) {
      throw new Error("Invalid thread payload from server");
    }

    return normalized;
  }, [apiBase]);

  const createThreadOnServer = useCallback(
    async (params: { title: string; messages: UIMessage[] }) => {
      const response = await fetch(`${apiBase}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errorMessage = await getApiErrorMessage(
          response,
          `Failed to create chat (${response.status})`,
        );
        throw new Error(errorMessage);
      }

      const payload = (await response.json()) as unknown;
      const normalized = normalizeThread(payload);
      if (!normalized) {
        throw new Error("Invalid thread payload from server");
      }
      return normalized;
    },
    [apiBase],
  );

  const patchThreadOnServer = useCallback(
    async (
      threadId: string,
      params: { title?: string; messages?: UIMessage[] },
    ) => {
      const response = await fetch(buildThreadUrl(apiBase, threadId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const errorMessage = await getApiErrorMessage(
          response,
          `Failed to save chat (${response.status})`,
        );
        throw new Error(errorMessage);
      }

      const payload = (await response.json()) as unknown;
      const normalized = normalizeThread(payload);
      if (!normalized) {
        throw new Error("Invalid thread payload from server");
      }
      return normalized;
    },
    [apiBase],
  );

  const upsertThread = useCallback((thread: StoredChatThread) => {
    setThreads((prev) => {
      const existing = prev.findIndex((candidate) => candidate.id === thread.id);
      if (existing === -1) {
        return [thread, ...prev].slice(0, MAX_THREAD_COUNT);
      }

      const next = [...prev];
      next[existing] = thread;
      return next;
    });
  }, []);

  const ensurePersistableThread = useCallback(
    async (requestedThreadId: string): Promise<StoredChatThread> => {
      if (serverThreadsReady && requestedThreadId !== DEFAULT_THREAD_ID) {
        const existing = threads.find((thread) => thread.id === requestedThreadId);
        if (existing) {
          return existing;
        }
      }

      const createdThread = await createThreadOnServer({
        title: defaultThreadTitle,
        messages: [],
      });

      upsertThread(createdThread);
      setActiveThreadId(createdThread.id);
      setServerThreadsReady(true);
      return createdThread;
    },
    [createThreadOnServer, serverThreadsReady, threads, upsertThread],
  );

  const persistUserTurn = useCallback(
    async (
      requestedThreadId: string,
      text: string,
    ): Promise<DurableTurnResult> => {
      const ensuredThread = await ensurePersistableThread(requestedThreadId);
      const currentThread =
        threads.find((thread) => thread.id === ensuredThread.id) ?? ensuredThread;

      const userMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
      };

      const nextMessages = trimMessages([...currentThread.messages, userMessage]);
      const nextTitle =
        currentThread.title === defaultThreadTitle
          ? deriveThreadTitle(nextMessages, locale)
          : currentThread.title;

      const savedThread = await patchThreadOnServer(ensuredThread.id, {
        title: nextTitle,
        messages: nextMessages,
      });

      upsertThread(savedThread);
      return {
        threadId: savedThread.id,
        thread: savedThread,
      };
    },
    [ensurePersistableThread, patchThreadOnServer, threads, upsertThread],
  );

  const resolveApprovalOnServer = useCallback(
    async (
      threadId: string,
      approvalId: string,
      status: "approved" | "rejected",
    ) => {
      const response = await fetch(buildApprovalUrl(apiBase, threadId, approvalId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const errorMessage = await getApiErrorMessage(
          response,
          `Failed to update approval (${response.status})`,
        );
        throw new Error(errorMessage);
      }

      const payload = (await response.json()) as unknown;
      const normalized = normalizeApproval(payload);
      if (!normalized) {
        throw new Error("Invalid approval payload from server");
      }
      return normalized;
    },
    [apiBase],
  );

  const handleResolveApproval = useCallback(
    async (approvalId: string, status: "approved" | "rejected") => {
      if (!activeThreadId || activeThreadId === DEFAULT_THREAD_ID) return;
      if (resolvingApprovalIds.includes(approvalId)) return;

      setResolvingApprovalIds((prev) => prev.concat(approvalId));

      try {
        const approval = await resolveApprovalOnServer(activeThreadId, approvalId, status);
        updateThreadState(activeThreadId, (thread) => ({
          ...thread,
          updatedAt: new Date().toISOString(),
          approvals: mergeApprovals(thread.approvals, [approval]),
          artifacts: thread.artifacts.map((artifact) =>
            artifact.id === approval.artifactId
              ? {
                  ...artifact,
                  status:
                    status === "approved"
                      ? approval.action === "commit_company_db"
                        ? "committed"
                        : "approved"
                      : "rejected",
                  updatedAt: approval.updatedAt,
                }
              : artifact,
          ),
        }));
        toast(
          status === "approved"
            ? "Approval confirmed."
            : "Approval rejected.",
          { variant: status === "approved" ? "success" : "error" },
        );
      } catch (err) {
        toast(
          err instanceof Error ? err.message : "Failed to update approval.",
          { variant: "error" },
        );
      } finally {
        setResolvingApprovalIds((prev) =>
          prev.filter((value) => value !== approvalId),
        );
      }
    },
    [
      activeThreadId,
      resolveApprovalOnServer,
      resolvingApprovalIds,
      toast,
      updateThreadState,
    ],
  );

  const handleToggleArtifactPreview = useCallback(
    async (artifactId: string) => {
      if (!activeThreadId || activeThreadId === DEFAULT_THREAD_ID) return;

      const current = artifactPreviews[artifactId];
      if (current?.content || current?.error) {
        setArtifactPreviews((prev) => {
          const next = { ...prev };
          delete next[artifactId];
          return next;
        });
        return;
      }

      setArtifactPreviews((prev) => ({
        ...prev,
        [artifactId]: {
          isLoading: true,
        },
      }));

      try {
        const response = await fetch(buildArtifactUrl(apiBase, activeThreadId, artifactId), {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          const errorMessage = await getApiErrorMessage(
            response,
            `Failed to open artifact (${response.status})`,
          );
          throw new Error(errorMessage);
        }

        const payload = (await response.json()) as { content?: unknown };
        const content =
          typeof payload.content === "string" && payload.content.length > 0
            ? payload.content
            : "Artifact is empty.";

        setArtifactPreviews((prev) => ({
          ...prev,
          [artifactId]: {
            isLoading: false,
            content,
          },
        }));
      } catch (err) {
        setArtifactPreviews((prev) => ({
          ...prev,
          [artifactId]: {
            isLoading: false,
            error: err instanceof Error ? err.message : "Failed to open artifact.",
          },
        }));
      }
    },
    [activeThreadId, apiBase, artifactPreviews],
  );

  useEffect(() => {
    let cancelled = false;

    const syncThreadsFromServer = async () => {
      try {
        const remoteThreads = await loadThreadsFromServer();
        if (cancelled) return;

        if (remoteThreads.length > 0) {
          const preferredActiveThreadId =
            typeof window !== "undefined"
              ? localStorage.getItem(resolvedStorageKeys.activeThread) ?? undefined
              : undefined;
          const mergedThreads = mergeThreadSummaries(
            threadsRef.current,
            remoteThreads,
          );
          setThreads(mergedThreads);
          setActiveThreadId(
            resolveActiveThreadId(mergedThreads, preferredActiveThreadId),
          );
          setServerThreadsReady(true);
          return;
        }

        const createdThread = await createThreadOnServer({
          title: defaultThreadTitle,
          messages: [],
        });
        if (cancelled) return;

        setThreads([createdThread]);
        setActiveThreadId(createdThread.id);
        setServerThreadsReady(true);
      } catch (err) {
        if (cancelled) return;
        setServerThreadsReady(false);

        const message =
          err instanceof Error ? err.message : "Failed to load chat history";
        if (message.includes("Unauthorized") || message.includes("401")) {
          toast("Your session has expired. Redirecting to login...", {
            variant: "error",
          });
          setTimeout(() => router.push("/login"), 1500);
          return;
        }

        console.warn("Falling back to local chat history:", err);
      }
    };

    void syncThreadsFromServer();

    return () => {
      cancelled = true;
    };
  }, [createThreadOnServer, loadThreadsFromServer, resolvedStorageKeys.activeThread, router, toast]);

  useEffect(() => {
    if (!serverThreadsReady) return;
    if (!activeThreadId || activeThreadId === DEFAULT_THREAD_ID) return;

    let cancelled = false;

    void loadThreadFromServer(activeThreadId)
      .then((thread) => {
        if (cancelled) return;
        upsertThread(thread);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("Failed to refresh chat thread detail:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [activeThreadId, loadThreadFromServer, serverThreadsReady, upsertThread]);

  const createNewThread = async () => {
    if (isCreatingThread) return;
    setIsCreatingThread(true);
    setInput("");
    setConnectionError(false);

    try {
      const newThread = await createThreadOnServer({
        title: defaultThreadTitle,
        messages: [],
      });
      setThreads((prev) =>
        [newThread, ...prev.filter((thread) => thread.id !== newThread.id)].slice(
          0,
          MAX_THREAD_COUNT,
        ),
      );
      setActiveThreadId(newThread.id);
      setServerThreadsReady(true);
    } catch {
      toast("Failed to create a new chat thread. Please retry.", {
        variant: "error",
      });
    } finally {
      setIsCreatingThread(false);
    }
  };

  const { messages, status, sendMessage, error, setMessages } = useChat({
    id: activeThreadId,
    transport,
    messages: activeThread?.messages ?? [],
    onError: (err) => {
      const message = err.message || "Something went wrong";
      // Check for auth-related errors
      if (message.includes("Unauthorized") || message.includes("401")) {
        toast("Your session has expired. Redirecting to login...", { variant: "error" });
        setTimeout(() => router.push("/login"), 1500);
        return;
      }
      // Check for connection/network errors
      if (message.includes("Failed to fetch") || message.includes("NetworkError") || message.includes("fetch")) {
        setConnectionError(true);
        toast("Connection lost. Check your internet and try again.", {
          variant: "error",
          action: {
            label: "Retry",
            onClick: () => setConnectionError(false),
          },
        });
        return;
      }
      // API key or server errors
      if (message.includes("API key") || message.includes("503")) {
        toast("AI service is temporarily unavailable. Please try again later.", { variant: "error" });
        return;
      }
      // Generic error
      toast("Failed to get a response. Please try again.", { variant: "error" });
    },
    onFinish: ({ messages: finishedMessages }) => {
      const threadId = activeThreadId;
      const trimmed = trimMessages(finishedMessages);
      const nextLocalizedTitle = deriveThreadTitle(trimmed, locale);
      const updatedAt = new Date().toISOString();

      setThreads((prev) => {
        const index = prev.findIndex((thread) => thread.id === threadId);
        if (index === -1) return prev;
        const next = [...prev];
        next[index] = {
          ...next[index],
          title: nextLocalizedTitle,
          updatedAt,
          messages: trimmed,
        };
        return next;
      });

      if (!serverThreadsReady) return;

      void patchThreadOnServer(threadId, {
        title: nextLocalizedTitle,
        messages: trimmed,
      })
        .then((savedThread) => {
          setThreads((prev) => {
            const index = prev.findIndex((thread) => thread.id === savedThread.id);
            if (index === -1) return prev;
            const next = [...prev];
            next[index] = savedThread;
            return next;
          });
        })
        .catch((err) => {
          console.warn("Failed to persist chat thread:", err);
        });
    },
  });

  const isLoading =
    isPersistingTurn || status === "streaming" || status === "submitted";

  const persistAndSendUserTurn = useCallback(
    async (text: string, requestedThreadId?: string) => {
      const targetThreadId = requestedThreadId ?? activeThreadId;
      setIsPersistingTurn(true);

      try {
        const { threadId, thread } = await persistUserTurn(targetThreadId, text);
        setActiveThreadId(threadId);
        setMessages(thread.messages);
        await sendMessage();
      } finally {
        setIsPersistingTurn(false);
      }
    },
    [activeThreadId, persistUserTurn, sendMessage, setMessages],
  );

  const prevThreadIdRef = useRef(activeThreadId);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    if (prevThreadIdRef.current !== activeThreadId) {
      prevThreadIdRef.current = activeThreadId;
      setArtifactPreviews({});
    }
  }, [activeThreadId]);

  useEffect(() => {
    if (status === "streaming" || status === "submitted") {
      return;
    }
    setMessages(activeThread?.messages ?? []);
  }, [activeThreadSyncKey, activeThread, setMessages, status]);

  useEffect(() => {
    if (!pendingThreadNotice) return;
    if (pendingThreadNotice.threadId !== activeThreadId) return;
    void persistAndSendUserTurn(
      pendingThreadNotice.text,
      pendingThreadNotice.threadId,
    )
      .catch((err) => {
        toast(
          err instanceof Error
            ? err.message
            : "Failed to send the uploaded document notice.",
          { variant: "error" },
        );
      })
      .finally(() => {
        setPendingThreadNotice(null);
      });
  }, [activeThreadId, pendingThreadNotice, persistAndSendUserTurn, toast]);

  useEffect(() => {
    if (!serverThreadsReady) return;
    try {
      const storedState = serializeChatStateForStorage({
        threads,
        activeThreadId,
      });
      localStorage.setItem(resolvedStorageKeys.threads, storedState.threadsJson);
      localStorage.setItem(resolvedStorageKeys.activeThread, storedState.activeThreadId);
    } catch {
      // Ignore local storage write errors.
    }
  }, [activeThreadId, resolvedStorageKeys.activeThread, resolvedStorageKeys.threads, serverThreadsReady, threads]);

  // Handle tool invocation results -> update dashboard
  const processedToolCalls = useRef(new Set<string>());
  useEffect(() => {
    processedToolCalls.current.clear();
  }, [activeThreadId]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "assistant") {
      for (const part of lastMessage.parts) {
        if (isToolUIPart(part) && part.state === "output-available") {
          const callId = (part as { toolCallId?: string }).toolCallId ?? "";
          if (!callId || processedToolCalls.current.has(callId)) continue;
          processedToolCalls.current.add(callId);

          const output = part.output as Record<string, unknown> | undefined;
          if (
            output?.action === "switch_view" &&
            typeof output.view === "string"
          ) {
            const href =
              typeof output.route === "string"
                ? `${output.route}${output.route === "/dashboard" ? `?view=${encodeURIComponent(output.view)}` : output.route === "/documents" && output.view !== "documents" ? `?view=${encodeURIComponent(output.view)}` : ""}`
                : resolveSurfaceHref(output.view);
            if (href) router.push(href);
          } else if (
            output?.action === "show_alert" &&
            typeof output.alertId === "string"
          ) {
            setSelectedAlertId(output.alertId);
          } else if (output?.action === "artifact_created") {
            const artifact = normalizeArtifact(output.artifact);
            if (artifact) {
              updateThreadState(activeThreadId, (thread) => ({
                ...thread,
                updatedAt: new Date().toISOString(),
                artifacts: mergeArtifacts(thread.artifacts, [artifact]),
              }));
            }
          } else if (output?.action === "approval_requested") {
            const approval = normalizeApproval(output.approval);
            const artifactSummary = isRecord(output.artifact)
              ? toText(output.artifact.id)
              : null;

            updateThreadState(activeThreadId, (thread) => ({
              ...thread,
              updatedAt: new Date().toISOString(),
              approvals: approval
                ? mergeApprovals(thread.approvals, [approval])
                : thread.approvals,
              artifacts: thread.artifacts.map((artifact) =>
                artifact.id === (approval?.artifactId ?? artifactSummary)
                  ? {
                      ...artifact,
                      status: "pending_approval",
                      updatedAt: approval?.updatedAt ?? new Date().toISOString(),
                    }
                  : artifact,
              ),
            }));
          }
        }
      }
    }
  }, [
    activeThreadId,
    messages,
    setSelectedAlertId,
    updateThreadState,
  ]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const scrollContainer = scrollRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    setConnectionError(false);

    try {
      await persistAndSendUserTurn(text, activeThreadId);
    } catch (err) {
      setInput(text);
      toast(
        err instanceof Error ? err.message : "Failed to persist the message.",
        { variant: "error" },
      );
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

  const handleFileDrop = async (file: File) => {
    if (file.size === 0) {
      toast(`File "${file.name}" is empty. Please re-export or re-download it and try again.`, {
        variant: "error",
      });
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast(`File "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 25 MB.`, { variant: "error" });
      return;
    }

    let targetThreadId = activeThreadId;
    if (!serverThreadsReady || activeThreadId === DEFAULT_THREAD_ID) {
      try {
        const newThread = await createThreadOnServer({
          title: defaultThreadTitle,
          messages: [],
        });
        setThreads((prev) =>
          [newThread, ...prev.filter((thread) => thread.id !== newThread.id)].slice(
            0,
            MAX_THREAD_COUNT,
          ),
        );
        setActiveThreadId(newThread.id);
        setServerThreadsReady(true);
        targetThreadId = newThread.id;
      } catch {
        toast("Failed to create a chat thread for the upload. Please retry.", {
          variant: "error",
        });
        return;
      }
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("threadId", targetThreadId);

    try {
      const res = await fetch(resolvedDocumentUploadUrl, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Upload failed" }));
        toast(`Failed to upload ${file.name}: ${data.error || "Unknown error"}`, { variant: "error" });
        return;
      }

      const data = await res.json();
      toast(`"${file.name}" uploaded successfully`, { variant: "success" });
      const attachment = normalizeAttachment(data.attachment);
      if (attachment) {
        setThreads((prev) =>
          prev.map((thread) =>
            thread.id === targetThreadId
              ? {
                  ...thread,
                  updatedAt: new Date().toISOString(),
                  attachments: mergeAttachments(thread.attachments, [attachment]),
                }
              : thread,
          ),
        );
      }
      const noticeText = `I've uploaded "${file.name}" for processing. Document ID: ${data.documentId}`;
      if (targetThreadId === activeThreadId) {
        await persistAndSendUserTurn(noticeText, targetThreadId);
      } else {
        setPendingThreadNotice({
          threadId: targetThreadId,
          text: noticeText,
        });
      }
    } catch {
      toast(`Failed to upload ${file.name}: Network error`, { variant: "error" });
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Chat header */}
      <div className="flex min-w-0 items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="size-7 rounded-full bg-primary/20 flex items-center justify-center">
          <Bot className="size-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{resolvedTitle}</p>
          <p className="text-xs text-muted-foreground">{resolvedDescription}</p>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <History className="size-3.5 text-muted-foreground" />
          <Select value={activeThreadId} onValueChange={setActiveThreadId}>
            <SelectTrigger className="h-8 w-[150px] max-w-[38vw] text-xs md:w-[170px]">
              <SelectValue placeholder="History" />
            </SelectTrigger>
            <SelectContent>
              {threadOptions.map((thread) => (
                <SelectItem key={thread.id} value={thread.id}>
                  {thread.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              void createNewThread();
            }}
            disabled={isCreatingThread || isLoading}
            aria-label={defaultThreadTitle}
          >
            {isCreatingThread ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
          </Button>
        </div>
        {isLoading && (
          <Loader2 className="size-3 animate-spin text-primary" />
        )}
      </div>

      {/* Messages */}
      <div
        className="flex-1 min-h-0 relative"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFileDrop(file);
        }}
      >
        {isDragging && (
          <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary/40 rounded-lg flex items-center justify-center z-10">
            <p className="text-sm text-primary font-medium">
              Drop file to upload
            </p>
          </div>
        )}
        <ScrollArea ref={scrollRef} className="h-full overflow-x-hidden px-4">
          <div className="min-w-0 py-4 space-y-4" role="log" aria-label="Chat messages" aria-live="polite">
          {messages.map((message) => (
            <div key={message.id}>
              {message.role === "user" ? (
                <div className="flex justify-end">
                  <div className="flex items-start gap-2 max-w-[92%] min-w-0">
                    <div className="min-w-0 max-w-full rounded-2xl rounded-tr-sm px-4 py-2.5 bg-primary text-primary-foreground text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {message.parts.map((part, i) =>
                        part.type === "text" ? (
                          <span key={i}>{part.text}</span>
                        ) : null
                      )}
                    </div>
                    <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                      <User className="size-3.5 text-muted-foreground" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex justify-start">
                  <div className="flex items-start gap-2 max-w-[92%] min-w-0">
                    <div className="size-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="size-3.5 text-primary" />
                    </div>
                    <div className="space-y-2 min-w-0 flex-1">
                      {message.parts.map((part, i) => {
                        if (part.type === "text") {
                          return (
                            <div
                              key={i}
                              className="min-w-0 max-w-full rounded-2xl rounded-tl-sm px-4 py-2.5 bg-card border border-border text-sm text-foreground prose prose-sm dark:prose-invert max-w-none break-words [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                            >
                              <ReactMarkdown
                                components={{
                                  p: ({ children }) => (
                                    <p className="mb-2 last:mb-0">{children}</p>
                                  ),
                                  ul: ({ children }) => (
                                    <ul className="mb-2 pl-4 list-disc space-y-1">
                                      {children}
                                    </ul>
                                  ),
                                  ol: ({ children }) => (
                                    <ol className="mb-2 pl-4 list-decimal space-y-1">
                                      {children}
                                    </ol>
                                  ),
                                  li: ({ children }) => (
                                    <li className="text-sm">{children}</li>
                                  ),
                                  strong: ({ children }) => (
                                    <strong className="font-semibold text-foreground">
                                      {children}
                                    </strong>
                                  ),
                                  code: ({ children, className }) => {
                                    const isInline = !className;
                                    return isInline ? (
                                      <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">
                                        {children}
                                      </code>
                                    ) : (
                                      <code className={className}>
                                        {children}
                                      </code>
                                    );
                                  },
                                  pre: ({ children }) => (
                                    <pre className="mb-2 p-3 rounded-lg bg-muted overflow-x-auto text-xs">
                                      {children}
                                    </pre>
                                  ),
                                  h1: ({ children }) => (
                                    <h3 className="text-base font-bold mb-1">
                                      {children}
                                    </h3>
                                  ),
                                  h2: ({ children }) => (
                                    <h4 className="text-sm font-bold mb-1">
                                      {children}
                                    </h4>
                                  ),
                                  h3: ({ children }) => (
                                    <h5 className="text-sm font-semibold mb-1">
                                      {children}
                                    </h5>
                                  ),
                                }}
                              >
                                {part.text}
                              </ReactMarkdown>
                            </div>
                          );
                        }

                        if (isToolUIPart(part)) {
                          const toolName = getToolNameFromPart(part);
                          const isDone = part.state === "output-available";
                          const output = isDone && isRecord(part.output) ? part.output : null;
                          const preview = output
                            ? renderCompanyDbToolPreview(
                                output,
                                `${message.id}-${i}-${toolName}`,
                                {
                                  activeThreadId,
                                  artifactRouteBase: `${apiBase}/threads`,
                                  onShowAgentFiles:
                                    surface === "company"
                                      ? () => router.push("/documents?view=agent-files")
                                      : undefined,
                                },
                              )
                            : null;

                          return (
                            <div key={i} className="min-w-0 space-y-2">
                              <div className="flex min-w-0 items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border/50 text-xs text-muted-foreground">
                                {isDone ? (
                                  <span className="text-primary">&#9632;</span>
                                ) : (
                                  <Loader2 className="size-3 animate-spin" />
                                )}
                                <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                                  {TOOL_LABELS[toolName] ||
                                    `Running ${toolName}`}
                                </span>
                              </div>
                              {preview}
                            </div>
                          );
                        }

                        return null;
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {(activeThread?.attachments.length ?? 0) > 0 && (
            <div className="space-y-2">
              {activeThread!.attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-foreground min-w-0">
                      <Paperclip className="size-3.5 text-muted-foreground" />
                      <span className="font-medium break-words [overflow-wrap:anywhere]">
                        {attachment.fileName}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {attachment.fileType ?? "document"}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {attachment.documentStatus ?? attachment.status}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(activeThread?.artifacts.length ?? 0) > 0 && (
            <div className="space-y-2">
              {activeThread!.artifacts.map((artifact) => {
                const preview = artifactPreviews[artifact.id];
                const isOpen = Boolean(preview?.content || preview?.error);
                const previewable = isPreviewableConsultantArtifact(artifact);
                const sharedDocumentId =
                  typeof artifact.metadata?.sharedDocumentId === "string"
                    ? artifact.metadata.sharedDocumentId
                    : null;

                return (
                  <div
                    key={artifact.id}
                    className="rounded-xl border border-border bg-card px-3 py-2"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm text-foreground min-w-0">
                          <FileText className="size-3.5 text-muted-foreground" />
                          <span className="font-medium break-words [overflow-wrap:anywhere]">
                            {artifact.title}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground break-all">
                          {artifact.kind} · {artifact.filePath}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {previewable ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 whitespace-normal"
                            onClick={() => {
                              void handleToggleArtifactPreview(artifact.id);
                            }}
                          >
                            {preview?.isLoading ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Eye className="size-3.5" />
                            )}
                            {isOpen ? "Hide" : "Open"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 whitespace-normal"
                          onClick={() => {
                            void downloadConsultantArtifact(
                              activeThreadId,
                              artifact.id,
                              artifact.title,
                              { routeBase: `${apiBase}/threads` },
                            ).catch((err) => {
                              toast(
                                err instanceof Error
                                  ? err.message
                                  : "Failed to download artifact.",
                                { variant: "error" },
                              );
                            });
                          }}
                        >
                          <Download className="size-3.5" />
                          Download
                        </Button>
                        {resolvedAllowCompanyArtifactShare ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 whitespace-normal"
                            disabled={Boolean(sharedDocumentId)}
                            onClick={() => {
                              void shareConsultantArtifactToCompany(
                                activeThreadId,
                                artifact.id,
                                { routeBase: `${apiBase}/threads` },
                              )
                                .then((result) => {
                                  setThreads((current) =>
                                    current.map((thread) =>
                                      thread.id === activeThreadId
                                        ? {
                                            ...thread,
                                            artifacts: thread.artifacts.map((item) =>
                                              item.id === artifact.id
                                                ? {
                                                    ...item,
                                                    metadata: {
                                                      ...item.metadata,
                                                      sharedDocumentId: result.documentId,
                                                    },
                                                  }
                                                : item,
                                            ),
                                          }
                                        : thread,
                                    ),
                                  );
                                  toast("Shared to company documents.", {
                                    variant: "success",
                                  });
                                })
                                .catch((err) => {
                                  toast(
                                    err instanceof Error
                                      ? err.message
                                      : "Failed to share artifact to company documents.",
                                    { variant: "error" },
                                  );
                                });
                            }}
                          >
                            <FileText className="size-3.5" />
                            {sharedDocumentId ? "Shared to Company" : "Share to Company"}
                          </Button>
                        ) : null}
                        <div
                          className={`rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusBadgeClass(artifact.status)}`}
                        >
                          {formatArtifactStatus(artifact.status)}
                        </div>
                      </div>
                    </div>
                    {preview && (
                      <div className="mt-3">
                        {preview.error ? (
                          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                            {preview.error}
                          </div>
                        ) : preview.content ? (
                          <pre className="max-h-80 overflow-auto rounded-lg bg-background/80 p-3 font-mono text-[11px] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                            {preview.content}
                          </pre>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(activeThread?.approvals.length ?? 0) > 0 && (
            <div className="space-y-2">
              {activeThread!.approvals.map((approval) => {
                const artifact = activeThread?.artifacts.find(
                  (item) => item.id === approval.artifactId,
                );
                const isPending = approval.status === "pending";
                const isResolving = resolvingApprovalIds.includes(approval.id);

                return (
                  <div
                    key={approval.id}
                    className="rounded-xl border border-border bg-card px-3 py-3"
                  >
                    <div className="flex flex-col gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm text-foreground min-w-0">
                          {isPending ? (
                            <Clock3 className="size-3.5 text-amber-500" />
                          ) : (
                            <ShieldCheck className="size-3.5 text-muted-foreground" />
                          )}
                          <span className="font-medium break-words [overflow-wrap:anywhere]">
                            {artifact?.title ?? "Approval request"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatApprovalAction(approval.action)}
                        </p>
                        {isRecord(approval.payload.execution) &&
                          typeof approval.payload.execution.commitSha === "string" && (
                            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                              commit {approval.payload.execution.commitSha}
                            </p>
                          )}
                      </div>
                      <div
                        className={`shrink-0 rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide ${getStatusBadgeClass(approval.status)}`}
                      >
                        {formatArtifactStatus(approval.status)}
                      </div>
                    </div>
                    {isPending && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 whitespace-normal"
                          disabled={isResolving}
                          onClick={() => {
                            void handleResolveApproval(approval.id, "approved");
                          }}
                        >
                          {isResolving ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Check className="size-3.5" />
                          )}
                          Approve
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 whitespace-normal"
                          disabled={isResolving}
                          onClick={() => {
                            void handleResolveApproval(approval.id, "rejected");
                          }}
                        >
                          <X className="size-3.5" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Suggestion chips - show when chat is empty */}
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-wrap gap-2">
              {suggestionChips.map((chip) => (
                <button
                  key={chip}
                  onClick={() => {
                    void persistAndSendUserTurn(chip).catch((err) => {
                      toast(
                        err instanceof Error
                          ? err.message
                          : "Failed to send the suggested prompt.",
                        { variant: "error" },
                      );
                    });
                    setInput("");
                  }}
                  className="text-xs px-3 py-1.5 rounded-full border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          {/* Typing indicator */}
          {isLoading &&
            messages[messages.length - 1]?.role === "user" && (
              <div className="flex justify-start" role="status" aria-label="AI is thinking">
                <div className="flex items-start gap-2">
                  <div className="size-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <Bot className="size-3.5 text-primary" />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 bg-card border border-border">
                    <div className="flex items-center gap-1">
                      <div className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.3s]" />
                      <div className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.15s]" />
                      <div className="size-1.5 rounded-full bg-muted-foreground/40 animate-bounce" />
                    </div>
                  </div>
                </div>
              </div>
            )}

          {/* Error / retry banner */}
          {error && !isLoading && (
            <div className="flex justify-center">
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-sm">
                <span className="text-destructive text-xs">
                  {connectionError
                    ? "Connection lost"
                    : "Failed to get response"}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    setConnectionError(false);
                    // Re-send the last user message
                    const lastUserMsg = [...messages]
                      .reverse()
                      .find((m) => m.role === "user");
                    if (lastUserMsg) {
                      const text = lastUserMsg.parts
                        .filter((p): p is { type: "text"; text: string } => p.type === "text")
                        .map((p) => p.text)
                        .join("");
                      if (text) {
                        void persistAndSendUserTurn(text).catch((err) => {
                          toast(
                            err instanceof Error
                              ? err.message
                              : "Failed to send the message.",
                            { variant: "error" },
                          );
                        });
                      }
                    }
                  }}
                >
                  <RefreshCw className="size-3" />
                  Retry
                </Button>
              </div>
            </div>
          )}
        </div>
        </ScrollArea>
      </div>

      {/* Input */}
      <div className="p-4 border-t border-border shrink-0">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.csv,.xlsx,.xls,.ofx,.qif,.png,.jpg,.jpeg,.txt,.md,.qmd,.html,.htm,.docx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileDrop(file);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="shrink-0"
          >
            <Paperclip className="size-4" />
          </Button>
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={resolvedInputPlaceholder}
            disabled={isLoading}
            className="flex-1 bg-background border-border text-sm"
          />
          <Button
            type="submit"
            size="icon"
            disabled={isLoading || !input.trim()}
            className="shrink-0"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </form>
        <p className="mt-2 text-[10px] text-muted-foreground/70 text-center">
          {resolvedUploadHint}
        </p>
        <p className="text-[10px] text-muted-foreground/50 mt-2 text-center">
          Corpus can be wrong. Verify important financial, legal, hiring,
          compliance, and operational decisions.
        </p>
      </div>
    </div>
  );
}
