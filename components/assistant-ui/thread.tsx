"use client";

import type { ComponentType } from "react";
import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import {
  ActionBarPrimitive,
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadListPrimitive,
  ThreadPrimitive,
  useAui,
  AuiIf,
  type Attachment,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import {
  AlertTriangleIcon,
  ArrowUpIcon,
  CheckIcon,
  CircleStopIcon,
  FileIcon,
  ImageIcon,
  Loader2Icon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { getAppCopy } from "@/lib/i18n/copy";
import { cn } from "@/lib/utils";

import { MarkdownText } from "./markdown-text";
import { MobileSidebarTrigger } from "./thread-sidebar";

// ToolFallback renders a compact pill for tool calls that do not have a
// dedicated tool UI registered. It also inspects the result for the
// `action: "artifact_created"` shape — any custom tool that emits that
// envelope still surfaces as an inline artifact card.
import { ArtifactCard, ArtifactErrorCard } from "./tool-ui/artifact-card";
import { ApprovalCard, ApprovalErrorCard } from "./tool-ui/approval-card";
import { CompanyDbResultCard } from "./tool-ui/company-db-result-card";
import { CurrencyConversionCard } from "./tool-ui/currency-conversion-card";
import { DynamicSuggestions } from "./dynamic-suggestions";
import { NavigationHint } from "./tool-ui/navigation-hint";
import { useChatV2Config } from "@/app/assistant/_lib/chat-context";
import {
  isRecord,
  normalizeApproval,
  normalizeArtifact,
  toText,
} from "@/app/assistant/_lib/normalizers";

// Phase 6 mini-telemetry: track which `result.action` values slip through the
// fallback so Phase 6.1 can decide which of the 8 remaining legacy renderers
// to port (or retire). One warn per toolName+action per session keeps noise
// reasonable while still surfacing prod frequencies.
const LOGGED_FALLBACKS = new Set<string>();
function logFallbackOnce(toolName: string, action: string | null): void {
  const key = `${toolName}::${action ?? "<no-action>"}`;
  if (LOGGED_FALLBACKS.has(key)) return;
  LOGGED_FALLBACKS.add(key);
  console.warn("[fallback_rendered]", toolName, { action });
}

const ToolFallback: ComponentType<ToolCallMessagePartProps> = ({
  toolName,
  result,
  status,
}) => {
  // This Thread is only used inside ChatV2Inner (see app/assistant),
  // so ChatV2Provider is always an ancestor. useChatV2Config throws if not,
  // which is the right signal — do not silence it.
  const config = useChatV2Config();
  const locale = useLocale();
  const toolCopy = getAppCopy(locale).chat.v2.tool;
  const aui = useAui();
  let threadId: string | null = null;
  try {
    if (aui?.threadListItem?.source) {
      threadId = aui.threadListItem().getState().remoteId ?? null;
    }
  } catch {
    threadId = null;
  }

  // When the tool result carries `action: "artifact_created"` or
  // `action: "approval_requested"`, render the inline card even though no
  // tool UI is registered by name.
  if (status.type !== "running" && isRecord(result)) {
    const action = toText((result as { action?: unknown }).action);
    if (action === "artifact_created") {
      const errorText = toText((result as { error?: unknown }).error);
      if (errorText) {
        return <ArtifactErrorCard error={errorText} />;
      }
      const artifact = normalizeArtifact(
        (result as { artifact?: unknown }).artifact,
      );
      if (artifact) {
        return (
          <ArtifactCard
            artifact={artifact}
            threadId={threadId}
            threadsApi={config.threadsApi}
            allowShare={config.allowCompanyArtifactShare}
          />
        );
      }
    }
    if (action === "approval_requested") {
      const errorText = toText((result as { error?: unknown }).error);
      if (errorText) {
        return <ApprovalErrorCard error={errorText} />;
      }
      const approval = normalizeApproval(
        (result as { approval?: unknown }).approval,
      );
      if (approval) {
        return (
          <ApprovalCard
            approval={approval}
            threadId={threadId}
            threadsApi={config.threadsApi}
          />
        );
      }
    }
    if (action === "company_db_result" || action === "company_db_search") {
      return <CompanyDbResultCard result={result as Record<string, unknown>} />;
    }
    if (action === "currency_conversion") {
      return (
        <CurrencyConversionCard result={result as Record<string, unknown>} />
      );
    }
    if (action === "switch_view") {
      return <NavigationHint result={result as Record<string, unknown>} />;
    }
    // Phase 6 mini-telemetry: this is an unmatched tool result whose action
    // string does not map to any of the renderers above. Counts are captured
    // via console.warn in dev/prod console so we can audit Phase 6.1 work.
    if (status.type === "complete") {
      logFallbackOnce(toolName, action);
    }
  }

  const label =
    status.type === "running"
      ? toolCopy.runningFormat.replace("{tool}", toolName)
      : status.type === "incomplete"
        ? toolCopy.failedFormat.replace("{tool}", toolName)
        : toolCopy.fallbackFormat.replace("{tool}", toolName);

  return (
    <div className="my-1.5 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground">
      {status.type === "running" ? (
        <Loader2Icon className="size-3 animate-spin" />
      ) : (
        <WrenchIcon className="size-3" />
      )}
      <span className="font-mono">{label}</span>
    </div>
  );
};

export function Thread({
  initialPrompt,
  initialPromptLabel,
}: {
  initialPrompt?: string | null;
  initialPromptLabel?: string | null;
} = {}) {
  const locale = useLocale();
  const copy = getAppCopy(locale).chat.v2;
  return (
    <ThreadPrimitive.Root className="relative flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border/40 px-2 py-2 lg:hidden">
        <MobileSidebarTrigger />
        <ThreadListPrimitive.New asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-9 text-muted-foreground hover:text-foreground"
            aria-label={copy.sidebar.newChat}
          >
            <PlusIcon className="size-5" />
          </Button>
        </ThreadListPrimitive.New>
      </div>

      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto overscroll-contain scroll-smooth">
        <div className="mx-auto flex w-full flex-col px-4 pb-[calc(8rem+var(--chat-viewport-bottom-extra,0px))] pt-4 sm:pb-[calc(9rem+var(--chat-viewport-bottom-extra,0px))] sm:pt-6 md:pb-36 lg:max-w-3xl lg:pb-40 lg:pt-6">
          <ThreadPrimitive.Empty>
            <EmptyState />
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />
        </div>
      </ThreadPrimitive.Viewport>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-[var(--chat-composer-bottom,0px)] z-10 bg-gradient-to-t from-background via-background/95 to-transparent pt-8 md:bottom-0"
        style={{
          paddingBottom:
            "var(--chat-composer-safe-bottom, env(safe-area-inset-bottom))",
        }}
      >
        <div className="pointer-events-auto mx-auto w-full px-3 pb-3 sm:px-4 sm:pb-4 lg:max-w-3xl lg:px-4 lg:pb-4">
          <InitialPromptShortcut
            label={initialPromptLabel}
            prompt={initialPrompt}
          />
          <DynamicSuggestions />
          <Composer />
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
}

function InitialPromptShortcut({
  label,
  prompt,
}: {
  label?: string | null;
  prompt?: string | null;
}) {
  const normalizedPrompt = prompt?.trim();
  const aui = useAui();
  const appliedPromptRef = useRef<string | null>(null);

  useEffect(() => {
    if (!normalizedPrompt) return;
    if (appliedPromptRef.current === normalizedPrompt) return;
    appliedPromptRef.current = normalizedPrompt;
    aui.composer().setText(normalizedPrompt);
  }, [aui, normalizedPrompt]);

  if (!normalizedPrompt) return null;

  return (
    <div className="flex justify-center px-2 pb-2">
      <button
        type="button"
        onClick={() => aui.composer().setText(normalizedPrompt)}
        className="inline-flex max-w-full cursor-pointer items-center rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-left text-xs text-primary shadow-sm transition-colors hover:bg-primary/15 sm:text-sm"
      >
        <span className="font-medium">{label ?? "Suggested prompt"}</span>
        <span className="mx-1.5 text-primary/50">·</span>
        <span className="truncate align-bottom text-primary/80">
          {normalizedPrompt}
        </span>
      </button>
    </div>
  );
}

function EmptyState() {
  const locale = useLocale();
  const config = useChatV2Config();
  const baseCopy = getAppCopy(locale).chat.v2.emptyState;
  // Persona override: when on /assistant/<persona>, use the persona-scoped
  // copy block. Falls back to baseCopy for the unscoped (CEO/company) surface.
  const personaCopy =
    config.persona && config.persona !== "company" && config.persona !== "personal"
      ? baseCopy.personas[config.persona]
      : null;
  const title = personaCopy?.title ?? baseCopy.title;
  const subtitle = personaCopy?.subtitle ?? baseCopy.subtitle;
  const suggestions = personaCopy?.suggestions ?? baseCopy.suggestions;

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-16 text-center sm:gap-6 sm:py-24">
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
        <span className="text-lg font-bold text-primary">AI</span>
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold sm:text-2xl">{title}</h2>
        <p className="max-w-xs px-2 text-sm text-muted-foreground sm:max-w-md sm:px-0">
          {subtitle}
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-2 px-2 sm:max-w-md sm:px-0">
        {suggestions.map((text) => (
          <ThreadPrimitive.Suggestion
            key={text}
            prompt={text}
            className="cursor-pointer rounded-xl border border-border/50 bg-muted/20 px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted/40 active:bg-muted/60 sm:rounded-2xl"
            method="replace"
          >
            {text}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex w-full justify-end py-2 sm:py-3">
      <div className="max-w-[85%] rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground sm:max-w-[75%] sm:px-4 sm:py-2.5">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex w-full py-2 sm:py-3">
      <div className="flex-1 text-sm leading-relaxed text-foreground">
        <MessagePrimitive.Content
          components={{
            Text: MarkdownText,
            tools: { Fallback: ToolFallback },
          }}
        />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantActionBar() {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="mt-1.5 flex items-center gap-0.5 text-muted-foreground"
    >
      <MessagePrimitive.If submittedFeedback="positive">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Feedback recorded"
          disabled
          className="size-7 rounded-full text-foreground"
        >
          <ThumbsUpIcon className="size-3.5" fill="currentColor" />
        </Button>
      </MessagePrimitive.If>
      <MessagePrimitive.If submittedFeedback="negative">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Feedback recorded"
          disabled
          className="size-7 rounded-full text-foreground"
        >
          <ThumbsDownIcon className="size-3.5" fill="currentColor" />
        </Button>
      </MessagePrimitive.If>
      <MessagePrimitive.If submittedFeedback={null}>
        <ActionBarPrimitive.FeedbackPositive asChild>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Mark answer helpful"
            title="Helpful"
            className="size-7 rounded-full hover:bg-background/60 hover:text-foreground"
          >
            <ThumbsUpIcon className="size-3.5" />
          </Button>
        </ActionBarPrimitive.FeedbackPositive>
        <ActionBarPrimitive.FeedbackNegative asChild>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Mark answer not helpful"
            title="Not helpful"
            className="size-7 rounded-full hover:bg-background/60 hover:text-foreground"
          >
            <ThumbsDownIcon className="size-3.5" />
          </Button>
        </ActionBarPrimitive.FeedbackNegative>
      </MessagePrimitive.If>
    </ActionBarPrimitive.Root>
  );
}

function Composer() {
  const locale = useLocale();
  const config = useChatV2Config();
  const composerCopy = getAppCopy(locale).chat.v2.composer;
  // Persona-scoped placeholder; falls back to default for CEO/company.
  const personaPlaceholder =
    config.persona && config.persona !== "company" && config.persona !== "personal"
      ? composerCopy.personas[config.persona]?.placeholder
      : null;
  const placeholder = personaPlaceholder ?? composerCopy.placeholder;
  return (
    <ComposerPrimitive.Root className="relative flex flex-col gap-1.5 rounded-3xl border border-border/70 bg-muted/60 p-1.5 shadow-lg backdrop-blur-xl focus-within:border-border focus-within:bg-muted/80 sm:gap-2 sm:p-2">
      <ComposerAttachmentsList />

      <div className="flex items-end gap-1.5 sm:gap-2">
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.AddAttachment asChild>
            <Button
              size="icon"
              variant="ghost"
              type="button"
              aria-label={composerCopy.addAttachment}
              className="size-9 shrink-0 rounded-full text-muted-foreground hover:bg-background/60 hover:text-foreground"
            >
              <PaperclipIcon className="size-5" />
            </Button>
          </ComposerPrimitive.AddAttachment>

          <ComposerPrimitive.Dictate asChild>
            <Button
              size="icon"
              variant="ghost"
              type="button"
              aria-label={composerCopy.voiceStart}
              title={composerCopy.voiceStart}
              className="size-9 shrink-0 rounded-full text-muted-foreground hover:bg-background/60 hover:text-foreground"
            >
              <MicIcon className="size-5" />
            </Button>
          </ComposerPrimitive.Dictate>
        </ThreadPrimitive.If>

        {/* StopDictation only makes sense while a dictation session is
            active. The upstream primitive renders a disabled button at all
            times instead of hiding — gate it behind <AuiIf> so users don't
            see a stray red square in the composer. */}
        <AuiIf condition={(s) => s.composer.dictation != null}>
          <ComposerPrimitive.StopDictation asChild>
            <Button
              size="icon"
              variant="ghost"
              type="button"
              aria-label={composerCopy.voiceStop}
              title={composerCopy.voiceStop}
              className="size-9 shrink-0 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-500 animate-pulse"
            >
              <SquareIcon className="size-4" fill="currentColor" />
            </Button>
          </ComposerPrimitive.StopDictation>
        </AuiIf>

        <ComposerPrimitive.Input
          rows={1}
          placeholder={placeholder}
          className={cn(
            "flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none sm:px-3 sm:text-sm",
            "min-h-9 max-h-40",
            "placeholder:text-muted-foreground",
          )}
        />

        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel asChild>
            <Button size="icon" variant="ghost" className="size-9 shrink-0 rounded-full">
              <CircleStopIcon className="size-5" />
            </Button>
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>

        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send asChild>
            <Button
              size="icon"
              className="size-9 shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/90 disabled:bg-muted-foreground/40 disabled:text-background"
            >
              <ArrowUpIcon className="size-5" strokeWidth={2.5} />
            </Button>
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>
      </div>
    </ComposerPrimitive.Root>
  );
}

function ComposerAttachmentsList() {
  return (
    <ComposerPrimitive.Attachments>
      {({ attachment }) => <AttachmentChip attachment={attachment} />}
    </ComposerPrimitive.Attachments>
  );
}

function AttachmentChip({ attachment }: { attachment: Attachment }) {
  const locale = useLocale();
  const composerCopy = getAppCopy(locale).chat.v2.composer;
  const { status } = attachment;
  // progress === 1 signals "upload finished but not yet sent" (the composer
  // transitions this to CompleteAttachment on Send). Show "Ready" instead of
  // a spinner so the chip doesn't look stuck.
  const isUploadFinished =
    status.type === "running" && (status.progress ?? 0) >= 1;
  const isUploading = status.type === "running" && !isUploadFinished;
  const isError = status.type === "incomplete" && status.reason === "error";
  const isComplete = status.type === "complete" || isUploadFinished;

  // Size: PendingAttachment always carries `.file`; CompleteAttachment
  // optionally carries it. When absent, fall back to "—".
  const sizeLabel =
    attachment.file && attachment.file.size > 0
      ? formatSize(attachment.file.size)
      : null;

  const Icon =
    attachment.type === "image"
      ? ImageIcon
      : attachment.contentType?.startsWith("image/")
        ? ImageIcon
        : FileIcon;

  return (
    <AttachmentPrimitive.Root className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-border/60 bg-background/70 px-2.5 py-1.5 text-xs">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-foreground">
          <AttachmentPrimitive.Name />
        </span>
        <span
          className={cn(
            "flex items-center gap-1 text-[11px]",
            isError ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {sizeLabel ? <span>{sizeLabel}</span> : null}
          {sizeLabel && (isUploading || isComplete || isError) ? (
            <span aria-hidden>·</span>
          ) : null}
          {isUploading ? (
            <>
              <Loader2Icon className="size-3 animate-spin" aria-hidden />
              <span>{composerCopy.uploading}</span>
            </>
          ) : null}
          {isComplete ? (
            <>
              <CheckIcon className="size-3 text-emerald-500" aria-hidden />
              <span>{composerCopy.uploaded}</span>
            </>
          ) : null}
          {isError ? (
            <>
              <AlertTriangleIcon className="size-3" aria-hidden />
              <span>{composerCopy.uploadFailed}</span>
            </>
          ) : null}
        </span>
      </div>

      <AttachmentPrimitive.Remove asChild>
        <button
          type="button"
          aria-label={composerCopy.removeAttachment}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
