"use client";

/**
 * Tool UI registrations for the chat-first onboarding surface.
 *
 * Each registration intercepts a tool call name (matching
 * lib/onboarding/types.ts ONBOARDING_TOOLS.*) and renders an inline
 * React card inside the assistant message bubble. Mirrors the existing
 * ApprovalToolUIs / ArtifactToolUIs pattern.
 *
 * Mount once inside the AssistantRuntimeProvider tree — see chat-v2.tsx
 * surface='onboarding' branch.
 */

import { makeAssistantToolUI, useAui } from "@assistant-ui/react";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAppCopy } from "@/lib/i18n/copy";

import {
  COMPANY_TYPE_OPTIONS,
  FIRST_WORKFLOW_OPTIONS,
  STARTER_QUESTIONS,
} from "@/app/onboarding/_content/onboarding-content";

/* ─── helpers ───────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Submit hook — appends the text directly as a user turn via
 * `aui.thread().append(text)`, which adds the message AND triggers the
 * bot to respond. This is the SAME proven path the autostart greeting
 * uses.
 *
 * NOTE: an earlier version used `aui.composer().setText()+send()`, but
 * that did NOT reliably fire a turn on chip click — `send()` reads the
 * composer state synchronously before `setText()` had settled, so the
 * message was dropped and nothing happened. `thread().append()` has no
 * such race and is verified working end-to-end on prod.
 */
function useComposerSubmit(): (text: string) => void {
  const aui = useAui();
  return useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      try {
        aui.thread().append(trimmed);
      } catch {
        // Thread not ready yet — no-op rather than throw inside render.
      }
    },
    [aui],
  );
}

/**
 * Onboarding card copy — read via the same `getAppCopy(locale).chat.v2.*`
 * pattern the rest of the chat surface uses. `getAppCopy` already falls
 * back to English for unknown locales (see normalizeAppLocale), so callers
 * never need their own fallback branch.
 */
function useOnboardingCopy() {
  const locale = useLocale();
  return getAppCopy(locale).chat.v2.onboarding;
}

/** Minimal `{token}` interpolation for copy strings. */
function fmt(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : `{${key}}`,
  );
}

/* ─── starter questions card ────────────────────────────────────────── */

interface StarterQuestionsResult {
  action?: string;
  card?: string;
  copy?: string;
}

function StarterQuestionsCard({ copy }: { copy: string | null }) {
  const submit = useComposerSubmit();
  const t = useOnboardingCopy();
  const heading = copy ?? t.starterDefault;
  return (
    <Card className="my-2 border-primary/20">
      <CardContent className="p-4">
        <p className="text-sm font-medium mb-3">{heading}</p>
        <div className="flex flex-wrap gap-2">
          {STARTER_QUESTIONS.map((q) => (
            <Button
              key={q.id}
              variant="outline"
              size="sm"
              onClick={() => submit(q.label)}
            >
              {q.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const StarterQuestionsToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  StarterQuestionsResult
>({
  toolName: "onboarding_render_starter_questions",
  render: ({ result, status }) => {
    if (status.type === "running") {
      return <div className="text-sm text-muted-foreground">Loading…</div>;
    }
    if (!isRecord(result)) return null;
    return <StarterQuestionsCard copy={toText(result.copy)} />;
  },
});

/* ─── profile form card ─────────────────────────────────────────────── */

interface ProfileFormResult {
  action?: string;
  card?: string;
  fields?: string[];
  copy?: string;
}

function ProfileFormCard({
  fields,
  copy,
}: {
  fields: string[];
  copy: string | null;
}) {
  const submit = useComposerSubmit();
  const t = useOnboardingCopy();
  const heading = copy ?? t.profileDefault;
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labelFor = (field: string) => {
    if (field === "companyName") return t.profileLabels.companyName;
    if (field === "founderRole") return t.profileLabels.founderRole;
    if (field === "primaryQuestion") return t.profileLabels.primaryQuestion;
    return field;
  };

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/onboarding/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      setSubmitted(true);
      submit(
        `Filled: ${Object.entries(values)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t.saveFailed);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card className="my-2 border-primary/20">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">{t.profileSaved}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="my-2 border-primary/20">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-medium">{heading}</p>
        {fields.map((field) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`onb-${field}`}>{labelFor(field)}</Label>
            <Input
              id={`onb-${field}`}
              value={values[field] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [field]: e.target.value }))
              }
              placeholder=""
              disabled={submitting}
            />
          </div>
        ))}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" onClick={onSubmit} disabled={submitting}>
            {submitting ? t.submitting : t.submit}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => submit("skip")}
            disabled={submitting}
          >
            {t.skip}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const ProfileFormToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  ProfileFormResult
>({
  toolName: "onboarding_render_profile_form",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    if (!isRecord(result) || !Array.isArray(result.fields)) return null;
    const fields = result.fields.filter(
      (f): f is string => typeof f === "string",
    );
    return <ProfileFormCard fields={fields} copy={toText(result.copy)} />;
  },
});

/* ─── document dropzone card ────────────────────────────────────────── */

interface DocumentDropzoneResult {
  action?: string;
  card?: string;
  copy?: string;
  acceptedKinds?: string[];
  threadId?: string;
}

/** Hard client-side cap mirrored from the upload route's server limit. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Build the `<input accept>` value from the tool-provided `acceptedKinds`
 * (e.g. `["pdf","xlsx"]`). Bare extension tokens are prefixed with a dot so
 * the browser file picker filters correctly; tokens already carrying a dot
 * or a `/` (mime types) are passed through untouched. Returns `undefined`
 * when no kinds are provided so the input accepts anything.
 */
function buildAccept(acceptedKinds: string[] | null): string | undefined {
  if (!acceptedKinds || acceptedKinds.length === 0) return undefined;
  const tokens = acceptedKinds
    .map((kind) => kind.trim())
    .filter((kind) => kind.length > 0)
    .map((kind) =>
      kind.startsWith(".") || kind.includes("/") ? kind : `.${kind}`,
    );
  return tokens.length > 0 ? tokens.join(",") : undefined;
}

function DocumentDropzoneCard({
  copy,
  acceptedKinds,
  threadId,
}: {
  copy: string | null;
  acceptedKinds: string[] | null;
  threadId: string | null;
}) {
  const submit = useComposerSubmit();
  const t = useOnboardingCopy();
  const heading = copy ?? t.dropzoneDefault;
  const accept = buildAccept(acceptedKinds);
  const [uploading, setUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErrors([]);
    setUploading(true);
    let done = 0;
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      // Pre-check size client-side so oversized files fail fast with a
      // clear reason instead of round-tripping to the server.
      if (file.size > MAX_UPLOAD_BYTES) {
        failures.push(fmt(t.dropzoneTooLarge, { name: file.name }));
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("fileName", file.name);
        if (threadId) fd.append("threadId", threadId);
        const res = await fetch("/api/documents/upload", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          // Surface the server's real error reason where available rather
          // than a generic "Upload failed".
          let reason: string | null = null;
          try {
            const body = (await res.json()) as { error?: unknown };
            reason = toText(body.error);
          } catch {
            reason = null;
          }
          failures.push(
            reason
              ? `${file.name}: ${reason}`
              : fmt(t.dropzoneUploadFailed, { name: file.name }),
          );
          continue;
        }
        done += 1;
      } catch {
        failures.push(fmt(t.dropzoneUploadFailed, { name: file.name }));
      }
    }
    setUploadedCount((c) => c + done);
    setErrors(failures);
    setUploading(false);
    // Only report success when at least one file actually landed.
    if (done > 0) {
      submit(
        `Uploaded ${done} file${done === 1 ? "" : "s"} — please review.`,
      );
    }
  }

  return (
    <Card className="my-2 border-primary/20">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-medium">{heading}</p>
        <label className="block border-2 border-dashed border-muted-foreground/30 rounded-md p-6 text-center cursor-pointer hover:bg-muted/30 transition-colors">
          <input
            type="file"
            multiple
            accept={accept}
            className="hidden"
            disabled={uploading}
            onChange={(e) => onFiles(e.target.files)}
          />
          <span className="text-sm text-muted-foreground">
            {uploading
              ? t.dropzoneUploading
              : `${t.dropzoneBrowse}${uploadedCount > 0 ? ` (${fmt(t.dropzoneUploadedSoFar, { count: uploadedCount })})` : ""}`}
          </span>
        </label>
        {errors.length > 0 && (
          <ul className="space-y-1">
            {errors.map((msg, i) => (
              <li key={i} className="text-xs text-destructive">
                {msg}
              </li>
            ))}
          </ul>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => submit("skip documents for now")}
          disabled={uploading}
        >
          {t.dropzoneSkip}
        </Button>
      </CardContent>
    </Card>
  );
}

const DocumentDropzoneToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  DocumentDropzoneResult
>({
  toolName: "onboarding_render_document_dropzone",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    if (!isRecord(result)) return null;
    const acceptedKinds = Array.isArray(result.acceptedKinds)
      ? result.acceptedKinds.filter(
          (k): k is string => typeof k === "string",
        )
      : null;
    const threadId = toText(result.threadId);
    return (
      <DocumentDropzoneCard
        copy={toText(result.copy)}
        acceptedKinds={acceptedKinds}
        threadId={threadId}
      />
    );
  },
});

/* ─── connector card ────────────────────────────────────────────────── */

interface ConnectorCardResult {
  action?: string;
  card?: string;
  provider?: string;
  copy?: string;
  trustNote?: string | null;
  threadId?: string;
}

/**
 * Providers with a verified OAuth flow at
 * `/api/connections/oauth/authorize`. Anything outside this set would send
 * the user to a raw `{"error":"Invalid or missing provider"}` page, so we
 * gate the Connect control on membership here (UI-A1 / ONB-3).
 */
const KNOWN_GOOD_PROVIDERS = new Set([
  "stripe",
  "truelayer",
  "slack",
  "google_drive",
]);

/** Aliases for slugs the model still emits under their old/short names. */
const PROVIDER_ALIASES: Record<string, string> = {
  gdrive: "google_drive",
};

/** Resolve aliases, then test against the verified-provider allowlist. */
function resolveProvider(raw: string): { slug: string; known: boolean } {
  const slug = PROVIDER_ALIASES[raw] ?? raw;
  return { slug, known: KNOWN_GOOD_PROVIDERS.has(slug) };
}

function ConnectorCardImpl({
  provider,
  copy,
  trustNote,
  threadId,
}: {
  provider: string;
  copy: string | null;
  trustNote: string | null;
  threadId: string | null;
}) {
  const submit = useComposerSubmit();
  const t = useOnboardingCopy();
  const heading = copy ?? t.connectorDefault;
  const [showTrust, setShowTrust] = useState(false);
  const { slug, known } = resolveProvider(provider);
  const authUrl = `/api/connections/oauth/authorize?provider=${encodeURIComponent(
    slug,
  )}${threadId ? `&thread_id=${encodeURIComponent(threadId)}` : ""}`;
  const providerLabel = slug
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

  // Real Chrome navigation via a button click handler — never a bare
  // `<a href>` that would full-page-navigate to error JSON for an
  // unverified provider.
  const onConnect = () => {
    if (typeof window !== "undefined") {
      window.location.assign(authUrl);
    }
  };

  return (
    <Card className="my-2 border-primary/20">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-medium">{heading}</p>
        <div className="rounded-md border border-muted-foreground/30 p-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{providerLabel}</div>
            {trustNote && (
              <button
                className="text-xs text-muted-foreground underline mt-1"
                onClick={() => setShowTrust((v) => !v)}
                type="button"
              >
                {showTrust ? t.connectorHide : t.connectorWhatConnects}
              </button>
            )}
            {showTrust && trustNote && (
              <p className="text-xs text-muted-foreground mt-2">{trustNote}</p>
            )}
          </div>
          {known ? (
            <Button size="sm" onClick={onConnect}>
              {t.connect}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled>
              {t.connectComingSoon}
            </Button>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => submit(`skip ${slug}`)}
        >
          {t.skip}
        </Button>
      </CardContent>
    </Card>
  );
}

const ConnectorCardToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  ConnectorCardResult
>({
  toolName: "onboarding_render_connector_card",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    if (!isRecord(result) || typeof result.provider !== "string") return null;
    return (
      <ConnectorCardImpl
        provider={result.provider}
        copy={toText(result.copy)}
        trustNote={toText(result.trustNote)}
        threadId={toText(result.threadId)}
      />
    );
  },
});

/* ─── company type choice ───────────────────────────────────────────── */

interface ChoiceResult {
  action?: string;
  card?: string;
  copy?: string;
}

function ChipChoices({
  copy,
  defaultCopy,
  options,
}: {
  copy: string | null;
  defaultCopy: string;
  options: ReadonlyArray<{ id: string; label: string; helper?: string }>;
}) {
  const submit = useComposerSubmit();
  const heading = copy ?? defaultCopy;
  return (
    <Card className="my-2 border-primary/20">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-medium">{heading}</p>
        <div className="flex flex-col gap-2">
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className="text-left rounded-md border border-muted-foreground/30 p-2 hover:bg-muted/30"
              onClick={() => submit(opt.label)}
            >
              <div className="text-sm font-medium">{opt.label}</div>
              {opt.helper && (
                <div className="text-xs text-muted-foreground">{opt.helper}</div>
              )}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CompanyTypeChoiceCard({ copy }: { copy: string | null }) {
  const t = useOnboardingCopy();
  return (
    <ChipChoices
      copy={copy}
      defaultCopy={t.companyTypeDefault}
      options={COMPANY_TYPE_OPTIONS}
    />
  );
}

const CompanyTypeChoiceToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  ChoiceResult
>({
  toolName: "onboarding_render_company_type_choice",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    if (!isRecord(result)) return null;
    return <CompanyTypeChoiceCard copy={toText(result.copy)} />;
  },
});

function FirstWorkflowChoiceCard({ copy }: { copy: string | null }) {
  const t = useOnboardingCopy();
  return (
    <ChipChoices
      copy={copy}
      defaultCopy={t.firstWorkflowDefault}
      options={FIRST_WORKFLOW_OPTIONS}
    />
  );
}

const FirstWorkflowChoiceToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  ChoiceResult
>({
  toolName: "onboarding_render_first_workflow_choice",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    if (!isRecord(result)) return null;
    return <FirstWorkflowChoiceCard copy={toText(result.copy)} />;
  },
});

/* ─── handoff card (goodbye message) ────────────────────────────────── */

interface HandoffResult {
  action?: string;
  goodbyeCopy?: string;
}

const HandoffToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  HandoffResult
>({
  toolName: "onboarding_complete_and_handoff",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    if (!isRecord(result)) return null;
    const copy = toText(result.goodbyeCopy);
    if (!copy) return null;
    return (
      <Card className="my-2 border-primary/30 bg-primary/5">
        <CardContent className="p-4">
          <p className="text-sm whitespace-pre-wrap">{copy}</p>
        </CardContent>
      </Card>
    );
  },
});

/* ─── skip + snapshot (no UI, but registered so the runtime knows) ──── */

const RecordSkipToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  { action?: string; field?: string }
>({
  toolName: "onboarding_record_skip",
  render: () => null,
});

const GetSnapshotToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  Record<string, unknown>
>({
  toolName: "onboarding_get_snapshot",
  render: () => null,
});

const SaveProfileFieldToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  { action?: string; field?: string }
>({
  toolName: "onboarding_save_profile_field",
  render: () => null,
});

/* ─── autostart: first turn + OAuth-return bridge ───────────────────── */

/**
 * Fires exactly one user turn when the onboarding chat first becomes
 * usable, so the bot greets and renders the starter-question card without
 * the user having to type. Also handles the OAuth-return case: when the
 * user comes back from a connector OAuth flow with
 * `?onboarding_oauth=<provider>:<status>`, it submits a brief message so
 * the next turn observes the freshly-linked connector.
 *
 * Mounted INSIDE the AssistantRuntimeProvider (see chat-v2.tsx) so
 * `useAui()` resolves. Replaces the earlier page-level DOM-mutation bridge,
 * which sat outside the provider and could not reach the composer state.
 */
/** Localized opener appended as the first user turn to kick off onboarding. */
function greetingOpener(): string {
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en")
    .toLowerCase();
  return lang.startsWith("ru") ? "Поехали" : "Let's get started";
}

function OnboardingAutostart() {
  const aui = useAui();
  const submit = useComposerSubmit();
  const t = useOnboardingCopy();
  const firedRef = useRef(false);
  // When the onboarding-status probe fails (or the thread never becomes ready)
  // we cannot safely auto-greet, but silently skipping leaves a slow/offline
  // user with a blank chat. Surface a manual "Start setup" affordance instead
  // (UI-A6).
  const [showStartSetup, setShowStartSetup] = useState(false);

  const startManually = () => {
    setShowStartSetup(false);
    firedRef.current = true;
    try {
      aui.thread().append(greetingOpener());
    } catch {
      // Thread not ready yet — fall back to the composer submit path.
      submit(greetingOpener());
    }
  };

  useEffect(() => {
    if (firedRef.current) return;
    if (typeof window === "undefined") return;
    let cancelled = false;

    // OAuth return takes priority over the greeting.
    const params = new URLSearchParams(window.location.search);
    const oauthFlag = params.get("onboarding_oauth");
    if (oauthFlag) {
      const [provider, statusPart] = oauthFlag.split(":");
      if (provider) {
        firedRef.current = true;
        const message =
          statusPart === "error"
            ? `The ${provider} connection failed. Want to retry?`
            : `Connected ${provider}. Please continue.`;
        // Clean the query so a refresh doesn't re-fire.
        params.delete("onboarding_oauth");
        const clean =
          window.location.pathname +
          (params.toString() ? `?${params.toString()}` : "");
        window.history.replaceState({}, "", clean);
        submit(message);
        return;
      }
    }

    // Greeting trigger — only when (a) the company has NOT finished
    // onboarding AND (b) the thread is genuinely empty. The onboarding-
    // status check is what keeps existing onboarded users from getting a
    // greeting when they open a fresh chat in the unified single-chat model.
    let interval: number | null = null;
    void (async () => {
      let incomplete = true;
      let statusKnown = true;
      try {
        const res = await fetch("/api/onboarding/status");
        if (res.ok) {
          const data = (await res.json()) as { complete?: boolean };
          incomplete = data.complete !== true;
        }
      } catch {
        // Status unavailable → don't risk an unsolicited auto-greet, but show
        // a manual "Start setup" button so a slow/offline user isn't stranded.
        statusKnown = false;
      }
      if (cancelled) return;
      if (!statusKnown) {
        setShowStartSetup(true);
        return;
      }
      if (!incomplete) {
        firedRef.current = true;
        return;
      }
      let attempts = 0;
      const tryGreet = (): boolean => {
        try {
          const state = aui.thread().getState();
          if (state.isLoading) return false;
          if (!state.isEmpty) {
            firedRef.current = true; // existing conversation — don't greet
            return true;
          }
          firedRef.current = true;
          aui.thread().append(greetingOpener());
          return true;
        } catch {
          return false;
        }
      };
      if (tryGreet()) return;
      // ~30s of retries (was ~4s): thread init can lag on slow connections,
      // and silently giving up left new users with no onboarding entry point.
      interval = window.setInterval(() => {
        attempts += 1;
        if (tryGreet() || attempts > 150) {
          if (interval != null) window.clearInterval(interval);
          // Never became ready in time → offer the manual affordance.
          if (!firedRef.current) setShowStartSetup(true);
        }
      }, 200);
    })();
    return () => {
      cancelled = true;
      if (interval != null) window.clearInterval(interval);
    };
  }, [aui, submit]);

  if (showStartSetup) {
    return (
      <div className="my-2 flex justify-center">
        <button
          type="button"
          onClick={startManually}
          className="rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-medium hover:bg-primary/10 transition-colors"
        >
          {t.startSetup}
        </button>
      </div>
    );
  }
  return null;
}

/* ─── export mount ──────────────────────────────────────────────────── */

/**
 * Mount this once inside AssistantRuntimeProvider on the onboarding chat
 * surface. Registers all onboarding tool UIs with the runtime + the
 * autostart trigger. Side-effect only — renders nothing.
 */
export function OnboardingToolUIs() {
  return (
    <>
      <StarterQuestionsToolUI />
      <ProfileFormToolUI />
      <DocumentDropzoneToolUI />
      <ConnectorCardToolUI />
      <CompanyTypeChoiceToolUI />
      <FirstWorkflowChoiceToolUI />
      <HandoffToolUI />
      <RecordSkipToolUI />
      <GetSnapshotToolUI />
      <SaveProfileFieldToolUI />
      <OnboardingAutostart />
    </>
  );
}
