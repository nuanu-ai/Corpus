"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  CalendarClock,
  Check,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  PauseCircle,
  Play,
  PlayCircle,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  TestTube2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  canRunRoutineNow,
  compactId,
  countRecordValue,
  formatDate,
  formatDateTime,
  formatExclusiveEndDate,
  isRoutineSourceUnhealthy,
  labelize,
} from "../../_components/format";
import type {
  AutomationManifest,
  JsonRecord,
  RoutineCandidate,
  RoutineCandidateDetail,
  RoutineDefinition,
  RoutineDigest,
  RoutineObservation,
  RoutineReportJobWithArtifacts,
  RoutineRun,
  RoutineScheduleStatus,
  RoutineSource,
} from "../../_components/types";

type DetailTab = "overview" | "findings" | "sources" | "runs" | "digests" | "settings";
type FindingFilter = "all" | "pending" | "approved" | "rejected";

interface DetailState {
  routine: RoutineDefinition | null;
  manifest: AutomationManifest | null;
  sources: RoutineSource[];
  runs: RoutineRun[];
  schedule: RoutineScheduleStatus | null;
  reportJobs: RoutineReportJobWithArtifacts[];
  observations: RoutineObservation[];
  candidates: RoutineCandidate[];
  digests: RoutineDigest[];
}

interface SourceEditState {
  sourceKey: string;
  title: string;
  url: string;
  sourceType: string;
  authority: string;
  jurisdiction: string;
  topicTagsText: string;
  fetchMode: string;
  status: string;
  checkFrequency: string;
  stalenessRisk: string;
  trustTier: string;
  collectorProvider: string;
  apifyActorId: string;
  apifyCrawlerType: string;
  apifyMaxPagesPerRun: string;
  apifyWaitForFinishSecs: string;
  apifyRequestTimeoutSecs: string;
  apifyRespectRobotsTxt: boolean;
  apifyUseProxy: boolean;
  apifyIncludeUrlGlobsText: string;
  apifyExcludeUrlGlobsText: string;
  useFor: string;
  allowedContentTypesText: string;
  allowedUrlPrefixesText: string;
  provenanceRequirementsText: string;
  primarySourceRequired: boolean;
  discoveryOnly: boolean;
  secondaryCommentaryOnly: boolean;
  operatorInstructions: string;
  notesText: string;
}

interface PolicyEditState {
  maxSourcesPerRun: string;
  collectionInstructions: string;
  watchTopicsText: string;
  includeKeywordsText: string;
  excludeKeywordsText: string;
  reviewerChecklistText: string;
}

interface ReportPolicyEditState {
  timezone: string;
  dueHour: string;
  dueMinute: string;
  dueOffsetDays: string;
  maxBackfillWindowCount: string;
  schedulerEnabled: boolean;
  collectionInstructions: string;
  maxItemsPerSource: string;
  artifactFormatsText: string;
}

interface SourceTestState {
  ok: boolean;
  message: string;
  canonicalUrl?: string;
  contentType?: string;
  fetchedAt?: string;
  bodyTextLength?: number;
  provider?: string;
  apifyRunId?: string;
  apifyDatasetId?: string;
  itemCount?: number;
  itemUrls?: string[];
}

interface ManifestSourceTestState {
  ok: boolean;
  message: string;
  status?: string;
  reason?: string;
  error?: string;
  counts?: JsonRecord;
  refCount?: number;
  generatedAt?: string;
}

interface DigestPreviewState {
  path: string | null;
  content: string | null;
}

interface BackfillEditState {
  latestDue: boolean;
  windowStart: string;
  windowEnd: string;
  maxWindowCount: string;
}

interface BackfillWindowResult {
  periodKey?: string;
  windowStart?: string;
  windowEnd?: string;
  dueAt?: string;
  action: string;
  runId?: string;
  reason?: string;
}

interface BackfillResultState {
  ok: boolean;
  dryRun: boolean;
  windowCount: number;
  queued: number;
  existing: number;
  blocked: number;
  errors: number;
  windows: BackfillWindowResult[];
  error?: string;
}

const tabs: { value: DetailTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "findings", label: "Findings" },
  { value: "sources", label: "Sources" },
  { value: "runs", label: "Runs" },
  { value: "digests", label: "Digests" },
  { value: "settings", label: "Settings" },
];

const findingFilters: { value: FindingFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const sourceStatuses = ["active", "paused", "broken", "retired"] as const;
const sourceTypes = ["primary_law", "regulation", "official_guidance", "official_news", "secondary_commentary", "manual_seed"] as const;
const sourceFetchModes = ["http_html", "http_pdf", "rss", "sitemap", "manual"] as const;
const sourceFrequencies = ["daily", "weekly", "monthly", "manual"] as const;
const sourceStalenessRisks = ["high", "medium", "low"] as const;
const sourceTrustTiers = ["primary", "official", "secondary"] as const;
const sourceContentTypes = ["text/html", "application/pdf", "application/rss+xml", "application/xml", "text/plain"] as const;
const sourceProviders = ["native", "apify"] as const;
const apifyCrawlerTypes = ["playwright:adaptive", "playwright:firefox", "cheerio"] as const;
const reportTemplateKeys = new Set([
  "daily_finance_report",
  "weekly_operating_report",
  "monthly_management_report",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function readNumberString(value: unknown, fallback: number): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback);
}

function sourceMetadata(source: RoutineSource): JsonRecord {
  return isRecord(source.metadata) ? source.metadata : {};
}

function normalizeDisplayLocale(locale: string): "en" | "ru" | "id" {
  if (locale === "ru" || locale.startsWith("ru-")) return "ru";
  if (locale === "id" || locale.startsWith("id-")) return "id";
  return "en";
}

function readCandidateDisplay(candidate: RoutineCandidate, locale: string) {
  const requestedLocale = normalizeDisplayLocale(locale);
  const translations = candidate.proposedFrontmatter.display_translations;
  const translationRecord = isRecord(translations) ? translations : {};
  const entry = translationRecord[requestedLocale] ?? translationRecord.en;
  if (isRecord(entry)) {
    const title = readString(entry.title).trim();
    const summary = readString(entry.summary).trim();
    if (title || summary) {
      return {
        title: title || candidate.title,
        summary: summary || candidate.summary,
        status: readString(entry.status, "fallback"),
        locale: requestedLocale,
      };
    }
  }
  return {
    title: candidate.title,
    summary: candidate.summary,
    status: "source",
    locale: requestedLocale,
  };
}

function sourceEditFromSource(source: RoutineSource): SourceEditState {
  const metadata = sourceMetadata(source);
  return {
    sourceKey: source.sourceKey,
    title: source.title,
    url: source.url,
    sourceType: source.sourceType,
    authority: source.authority,
    jurisdiction: source.jurisdiction,
    topicTagsText: source.topicTags.join(", "),
    fetchMode: source.fetchMode,
    status: source.status,
    checkFrequency: source.checkFrequency,
    stalenessRisk: source.stalenessRisk,
    trustTier: source.trustTier,
    collectorProvider: readString(metadata.collectorProvider, "native"),
    apifyActorId: readString(metadata.apifyActorId, "apify/website-content-crawler"),
    apifyCrawlerType: readString(metadata.apifyCrawlerType, "playwright:adaptive"),
    apifyMaxPagesPerRun: readNumberString(metadata.apifyMaxPagesPerRun, 1),
    apifyWaitForFinishSecs: readNumberString(metadata.apifyWaitForFinishSecs, 90),
    apifyRequestTimeoutSecs: readNumberString(metadata.apifyRequestTimeoutSecs, 60),
    apifyRespectRobotsTxt: metadata.apifyRespectRobotsTxt === true,
    apifyUseProxy: metadata.apifyUseProxy !== false,
    apifyIncludeUrlGlobsText: readStringArray(metadata.apifyIncludeUrlGlobs).join("\n"),
    apifyExcludeUrlGlobsText: readStringArray(metadata.apifyExcludeUrlGlobs).join("\n"),
    useFor: readString(metadata.useFor),
    allowedContentTypesText: readStringArray(metadata.allowedContentTypes).join(", "),
    allowedUrlPrefixesText: readStringArray(metadata.allowedUrlPrefixes).join("\n"),
    provenanceRequirementsText: readStringArray(metadata.provenanceRequirements).join(", "),
    primarySourceRequired: metadata.primarySourceRequired !== false,
    discoveryOnly: metadata.discoveryOnly === true,
    secondaryCommentaryOnly: metadata.secondaryCommentaryOnly === true,
    operatorInstructions: readString(metadata.operatorInstructions),
    notesText: readStringArray(metadata.notes).join("\n"),
  };
}

function sourceEditDefaults(): SourceEditState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    sourceKey: "",
    title: "",
    url: "",
    sourceType: "official_guidance",
    authority: "",
    jurisdiction: "ID",
    topicTagsText: "bkpm",
    fetchMode: "http_html",
    status: "paused",
    checkFrequency: "manual",
    stalenessRisk: "medium",
    trustTier: "official",
    collectorProvider: "native",
    apifyActorId: "apify/website-content-crawler",
    apifyCrawlerType: "playwright:adaptive",
    apifyMaxPagesPerRun: "1",
    apifyWaitForFinishSecs: "90",
    apifyRequestTimeoutSecs: "60",
    apifyRespectRobotsTxt: false,
    apifyUseProxy: true,
    apifyIncludeUrlGlobsText: "",
    apifyExcludeUrlGlobsText: "",
    useFor: "",
    allowedContentTypesText: "text/html",
    allowedUrlPrefixesText: "",
    provenanceRequirementsText: "official_source, review_before_promotion",
    primarySourceRequired: true,
    discoveryOnly: false,
    secondaryCommentaryOnly: false,
    operatorInstructions: "",
    notesText: `Verified by operator on ${today}`,
  };
}

function policyEditFromRoutine(routine: RoutineDefinition): PolicyEditState {
  const sourcePolicy = routine.sourcePolicy;
  return {
    maxSourcesPerRun: String(sourcePolicy.maxSourcesPerRun ?? 20),
    collectionInstructions: readString(sourcePolicy.collectionInstructions),
    watchTopicsText: readStringArray(sourcePolicy.watchTopics).join(", "),
    includeKeywordsText: readStringArray(sourcePolicy.includeKeywords).join(", "),
    excludeKeywordsText: readStringArray(sourcePolicy.excludeKeywords).join(", "),
    reviewerChecklistText: readStringArray(sourcePolicy.reviewerChecklist).join("\n"),
  };
}

function isReportRoutineTemplate(templateKey: string) {
  return reportTemplateKeys.has(templateKey);
}

function reportCadence(templateKey: string): "daily" | "weekly" | "monthly" {
  if (templateKey === "daily_finance_report") return "daily";
  if (templateKey === "monthly_management_report") return "monthly";
  return "weekly";
}

function defaultReportAnchor(cadence: "daily" | "weekly" | "monthly") {
  return {
    hour: 0,
    minute: 0,
    ...(cadence === "weekly" ? { dayOfWeek: 1 } : {}),
    ...(cadence === "monthly" ? { dayOfMonth: 1 } : {}),
  };
}

function reportPolicyEditFromRoutine(routine: RoutineDefinition): ReportPolicyEditState {
  const schedulePolicy = routine.schedulePolicy;
  const sourcePolicy = routine.sourcePolicy;
  const digestPolicy = routine.digestPolicy;
  const dueTime = readRecord(schedulePolicy.dueTime) ?? {};
  return {
    timezone: readString(schedulePolicy.timezone, "UTC"),
    dueHour: String(readNumber(dueTime.hour, 9)),
    dueMinute: String(readNumber(dueTime.minute, 0)),
    dueOffsetDays: String(readNumber(schedulePolicy.dueOffsetDays, 0)),
    maxBackfillWindowCount: String(readNumber(schedulePolicy.maxBackfillWindowCount, 8)),
    schedulerEnabled: readBoolean(schedulePolicy.schedulerEnabled, false),
    collectionInstructions: readString(sourcePolicy.collectionInstructions),
    maxItemsPerSource: String(readNumber(sourcePolicy.maxItemsPerSource, 50)),
    artifactFormatsText: readStringArray(digestPolicy.artifactFormats).join(", "),
  };
}

function boundedInt(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function reportPolicyPayload(
  routine: RoutineDefinition,
  edit: ReportPolicyEditState,
): {
  schedulePolicy: JsonRecord;
  sourcePolicy: JsonRecord;
  reviewPolicy: JsonRecord;
  digestPolicy: JsonRecord;
} {
  const cadence = reportCadence(routine.templateKey);
  const existingAnchor = readRecord(routine.schedulePolicy.localAnchor);
  const artifactFormats = commaList(edit.artifactFormatsText).filter((format) =>
    format === "markdown" || format === "xlsx" || format === "docx",
  );
  const existingSourcePolicy = readRecord(routine.sourcePolicy);
  const existingBuiltInSources = Array.isArray(existingSourcePolicy?.builtInSources)
    ? existingSourcePolicy.builtInSources
        .filter((source): source is string => typeof source === "string" && source.trim().length > 0)
    : [];
  return {
    schedulePolicy: {
      cadence,
      timezone: edit.timezone.trim() || "UTC",
      localAnchor: existingAnchor ?? defaultReportAnchor(cadence),
      dueTime: {
        hour: boundedInt(edit.dueHour, 9, 0, 23),
        minute: boundedInt(edit.dueMinute, 0, 0, 59),
      },
      dueOffsetDays: boundedInt(edit.dueOffsetDays, 0, 0, 31),
      catchUpPolicy: "last_due_only",
      maxBackfillWindowCount: boundedInt(edit.maxBackfillWindowCount, 8, 1, 366),
      manualRunEnabled: true,
      schedulerEnabled: edit.schedulerEnabled,
    },
    sourcePolicy: {
      sourceStatusModel: "available_partial_unavailable_failed",
      configuredSourcesRequiredBeforeActivation: false,
      builtInSources: existingBuiltInSources.length > 0
        ? existingBuiltInSources
        : ["odoo", "company_db", "documents"],
      collectionInstructions: edit.collectionInstructions.trim() || undefined,
      maxItemsPerSource: boundedInt(edit.maxItemsPerSource, 50, 1, 200),
    },
    reviewPolicy: {
      reviewRequired: true,
      mode: "human_or_scoped_api_key",
      publishPolicy: "review_required",
    },
    digestPolicy: {
      previewOnly: true,
      delivery: "disabled",
      artifactFormats: artifactFormats.length > 0
        ? artifactFormats
        : routine.templateKey === "daily_finance_report"
          ? ["markdown"]
          : ["markdown", "xlsx"],
    },
  };
}

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function lineList(value: string): string[] {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function apiFetch<T>(path: string, init?: RequestInit, companyId?: string | null): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(companyId ? { "x-company-id": companyId } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : `Request failed: ${response.status}`);
  }
  return payload as T;
}

function badgeVariant(value: string) {
  if (["active", "completed", "approved", "committed"].includes(value)) return "default";
  if (["queued", "running", "pending", "paused", "preview"].includes(value)) return "secondary";
  if (["failed", "rejected", "broken"].includes(value)) return "destructive";
  return "outline";
}

function metric(label: string, value: string | number) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function inlineStat(label: string, value: string | number) {
  return (
    <div className="flex justify-between gap-3 border-b py-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function runSchedulerNote(stats: JsonRecord) {
  const event = readRecord(stats.lastSchedulerEvent);
  if (!event) return null;
  const message = readString(event.message);
  const kind = readString(event.kind);
  const observedAt = readString(event.observedAt);
  const periodKey = readString(event.periodKey);
  const windowStart = readString(event.windowStart);
  const windowEnd = readString(event.windowEnd);
  return {
    title: kind ? labelize(kind) : "Scheduler event",
    message,
    observedAt,
    periodKey,
    window: windowStart || windowEnd
      ? `${formatDateTime(windowStart || null)} - ${formatDateTime(windowEnd || null)}`
      : "",
  };
}

function runStaleRecoveryNote(stats: JsonRecord) {
  const recovery = readRecord(stats.staleRecovery);
  if (!recovery) return null;
  return {
    reason: readString(recovery.reason),
    previousStatus: readString(recovery.previousStatus),
    recoveredAt: readString(recovery.recoveredAt),
    cutoff: readString(recovery.cutoff),
  };
}

function runCancellationNote(stats: JsonRecord) {
  const cancellation = readRecord(stats.cancellation);
  if (!cancellation) return null;
  return {
    reason: readString(cancellation.reason),
    previousStatus: readString(cancellation.previousStatus),
    cancelledAt: readString(cancellation.cancelledAt),
  };
}

function isBuiltInReportSource(source: AutomationManifest["sources"][number]) {
  return source.id === "company_db" || source.id === "odoo" || source.id === "documents";
}

function formatCounts(counts: JsonRecord | undefined): string {
  if (!counts) return "No counts";
  const entries = Object.entries(counts)
    .filter(([, value]) => typeof value === "number" || typeof value === "string" || typeof value === "boolean")
    .slice(0, 6);
  if (entries.length === 0) return "No counts";
  return entries.map(([key, value]) => `${labelize(key)}: ${String(value)}`).join(" · ");
}

function formatSourceWindow(window: JsonRecord | undefined): string {
  if (!window) return "";
  const label = readString(window.label);
  if (label) return label;
  const start = readString(window.start);
  const end = readString(window.end);
  const timezone = readString(window.timezone);
  if (!start && !end) return "";
  return `${start || "?"} - ${end || "?"}${timezone ? `, ${timezone}` : ""}`;
}

function asDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function routineReportArtifactHref(input: {
  routineId: string;
  jobId: string;
  artifactId: string;
  download?: boolean;
}) {
  const base = `/api/routines/${input.routineId}/report-jobs/${input.jobId}/artifacts/${input.artifactId}`;
  return input.download ? `${base}?download=1` : base;
}

export function RoutineDetail({
  routineId,
  companyId = null,
}: {
  routineId: string;
  companyId?: string | null;
}) {
  const [data, setData] = useState<DetailState>({
    routine: null,
    manifest: null,
    sources: [],
    runs: [],
    schedule: null,
    reportJobs: [],
    observations: [],
    candidates: [],
    digests: [],
  });
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [findingFilter, setFindingFilter] = useState<FindingFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewingArtifactId, setReviewingArtifactId] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [digesting, setDigesting] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [candidateDetail, setCandidateDetail] = useState<RoutineCandidateDetail | null>(null);
  const [candidateDetailLoading, setCandidateDetailLoading] = useState(false);
  const [sourceEdits, setSourceEdits] = useState<Record<string, SourceEditState>>({});
  const [sourceSavingId, setSourceSavingId] = useState<string | null>(null);
  const [showSourceCreate, setShowSourceCreate] = useState(false);
  const [sourceCreate, setSourceCreate] = useState<SourceEditState>(() => sourceEditDefaults());
  const [sourceCreating, setSourceCreating] = useState(false);
  const [sourceTestingId, setSourceTestingId] = useState<string | null>(null);
  const [sourceTestResults, setSourceTestResults] = useState<Record<string, SourceTestState>>({});
  const [manifestSourceTestingId, setManifestSourceTestingId] = useState<string | null>(null);
  const [manifestSourceTestResults, setManifestSourceTestResults] = useState<Record<string, ManifestSourceTestState>>({});
  const [policyEdit, setPolicyEdit] = useState<PolicyEditState | null>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [reportPolicyEdit, setReportPolicyEdit] = useState<ReportPolicyEditState | null>(null);
  const [reportPolicySaving, setReportPolicySaving] = useState(false);
  const [digestPreview, setDigestPreview] = useState<DigestPreviewState | null>(null);
  const [digestWindow, setDigestWindow] = useState(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { windowStart: asDateInput(start), windowEnd: asDateInput(end) };
  });
  const [backfillEdit, setBackfillEdit] = useState<BackfillEditState>({
    latestDue: true,
    windowStart: "",
    windowEnd: "",
    maxWindowCount: "1",
  });
  const [backfillBusy, setBackfillBusy] = useState<"preview" | "queue" | null>(null);
  const [backfillResult, setBackfillResult] = useState<BackfillResultState | null>(null);
  const [runCancellingId, setRunCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, runs, schedule, candidates, digests, reportJobs, observations] = await Promise.all([
        apiFetch<{ routine: RoutineDefinition; sources: RoutineSource[]; manifest: AutomationManifest }>(`/api/routines/${routineId}`, undefined, companyId),
        apiFetch<{ runs: RoutineRun[] }>(`/api/routines/${routineId}/runs`, undefined, companyId),
        apiFetch<{ schedule: RoutineScheduleStatus }>(`/api/routines/${routineId}/schedule`, undefined, companyId),
        apiFetch<{ candidates: RoutineCandidate[] }>(`/api/routines/${routineId}/candidates`, undefined, companyId),
        apiFetch<{ digests: RoutineDigest[] }>(`/api/routines/${routineId}/digests`, undefined, companyId),
        apiFetch<{ reportJobs: RoutineReportJobWithArtifacts[] }>(`/api/routines/${routineId}/report-jobs`, undefined, companyId),
        apiFetch<{ observations: RoutineObservation[] }>(`/api/routines/${routineId}/observations?limit=50`, undefined, companyId),
      ]);
      setData({
        routine: detail.routine,
        manifest: detail.manifest,
        sources: detail.sources,
        runs: runs.runs,
        schedule: schedule.schedule,
        reportJobs: reportJobs.reportJobs,
        observations: observations.observations,
        candidates: candidates.candidates,
        digests: digests.digests,
      });
      setSourceEdits(Object.fromEntries(
        detail.sources.map((source) => [source.id, sourceEditFromSource(source)]),
      ));
      setPolicyEdit(policyEditFromRoutine(detail.routine));
      setReportPolicyEdit(
        isReportRoutineTemplate(detail.routine.templateKey)
          ? reportPolicyEditFromRoutine(detail.routine)
          : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load routine");
    } finally {
      setLoading(false);
    }
  }, [companyId, routineId]);

  useEffect(() => {
    void load();
  }, [load]);

  const latestRun = data.runs[0];
  const latestDigest = data.digests[0];
  const pendingCandidates = useMemo(
    () => data.candidates.filter((candidate) => candidate.reviewStatus === "pending"),
    [data.candidates],
  );
  const filteredCandidates = useMemo(
    () =>
      findingFilter === "all"
        ? data.candidates
        : data.candidates.filter((candidate) => candidate.reviewStatus === findingFilter),
    [data.candidates, findingFilter],
  );
  const findingFilterSummary = useMemo(() => {
    if (findingFilter === "all") {
      return `${data.candidates.length} findings, ${pendingCandidates.length} pending review`;
    }
    if (findingFilter === "pending") return `${filteredCandidates.length} pending review`;
    return `${filteredCandidates.length} ${findingFilter} findings`;
  }, [data.candidates.length, filteredCandidates.length, findingFilter, pendingCandidates.length]);
  const staleSources = useMemo(() => data.sources.filter(isRoutineSourceUnhealthy), [data.sources]);
  const builtInReportSources = useMemo(
    () => data.manifest?.sources.filter(isBuiltInReportSource) ?? [],
    [data.manifest],
  );
  const reportJobsByRun = useMemo(() => {
    const grouped = new Map<string, RoutineReportJobWithArtifacts[]>();
    for (const item of data.reportJobs) {
      const runId = item.job.routineRunId;
      if (!runId) continue;
      grouped.set(runId, [...(grouped.get(runId) ?? []), item]);
    }
    return grouped;
  }, [data.reportJobs]);
  const observationsByRun = useMemo(() => {
    const grouped = new Map<string, RoutineObservation[]>();
    for (const observation of data.observations) {
      grouped.set(observation.routineRunId, [
        ...(grouped.get(observation.routineRunId) ?? []),
        observation,
      ]);
    }
    return grouped;
  }, [data.observations]);
  const latestReportArtifacts = useMemo(
    () => data.reportJobs.flatMap((item) => item.artifacts).slice(0, 3),
    [data.reportJobs],
  );
  const pendingReportArtifacts = useMemo(
    () => data.reportJobs.flatMap((item) => item.artifacts).filter((artifact) => artifact.reviewStatus === "pending"),
    [data.reportJobs],
  );
  const showStoredSourceWorkbench = data.sources.length > 0 || builtInReportSources.length === 0;

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      await apiFetch(`/api/routines/${routineId}/run`, { method: "POST" }, companyId);
      await load();
      setActiveTab("runs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue run");
    } finally {
      setRunning(false);
    }
  }

  async function runBackfill(mode: "preview" | "queue") {
    setBackfillBusy(mode);
    setError(null);
    try {
      const maxWindowCount = Number(backfillEdit.maxWindowCount);
      const payload = backfillEdit.latestDue
        ? {
            latestDue: true,
            dryRun: mode === "preview",
            confirm: mode === "queue" ? true : undefined,
            maxWindowCount: Number.isFinite(maxWindowCount) ? maxWindowCount : 1,
          }
        : {
            windowStart: backfillEdit.windowStart.trim(),
            windowEnd: backfillEdit.windowEnd.trim(),
            dryRun: mode === "preview",
            confirm: mode === "queue" ? true : undefined,
            maxWindowCount: Number.isFinite(maxWindowCount) ? maxWindowCount : 1,
          };
      const result = await apiFetch<{ result: BackfillResultState }>(
        `/api/routines/${routineId}/backfill`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        companyId,
      );
      setBackfillResult(result.result);
      if (mode === "queue") await load();
      setActiveTab("runs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process backfill");
    } finally {
      setBackfillBusy(null);
    }
  }

  async function cancelRun(runId: string) {
    setRunCancellingId(runId);
    setError(null);
    try {
      await apiFetch(`/api/routines/${routineId}/runs/${runId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel" }),
      }, companyId);
      await load();
      setActiveTab("runs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel run");
    } finally {
      setRunCancellingId(null);
    }
  }

  async function updateRoutineStatus(action: "pause" | "resume" | "archive") {
    const confirmActivation =
      action === "resume" &&
      routine?.createdFrom === "chat_draft" &&
      routine.status === "draft";
    if (
      confirmActivation &&
      !window.confirm("Activate this agent-created draft routine?")
    ) {
      return;
    }
    setStatusBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/routines/${routineId}`, {
        method: "PATCH",
        body: JSON.stringify({ action, confirmActivation }),
      }, companyId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} routine`);
    } finally {
      setStatusBusy(false);
    }
  }

  async function reviewCandidate(candidateId: string, action: "approve" | "reject") {
    setReviewingId(candidateId);
    setError(null);
    try {
      await apiFetch(`/api/routines/${routineId}/candidates/${candidateId}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      }, companyId);
      await load();
      setSelectedCandidateId(null);
      setCandidateDetail(null);
      setActiveTab("findings");
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} finding`);
    } finally {
      setReviewingId(null);
    }
  }

  async function reviewReportArtifact(input: {
    jobId: string;
    artifactId: string;
    action: "approve" | "reject";
  }) {
    setReviewingArtifactId(input.artifactId);
    setError(null);
    try {
      await apiFetch(
        `/api/routines/${routineId}/report-jobs/${input.jobId}/artifacts/${input.artifactId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: input.action }),
        },
        companyId,
      );
      await load();
      setActiveTab("runs");
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${input.action} report artifact`);
    } finally {
      setReviewingArtifactId(null);
    }
  }

  function reportArtifactControls(artifact: RoutineReportJobWithArtifacts["artifacts"][number]) {
    const busy = reviewingArtifactId === artifact.id;
    const isPending = artifact.reviewStatus === "pending";
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <a
            href={routineReportArtifactHref({
              routineId,
              jobId: artifact.reportJobId,
              artifactId: artifact.id,
            })}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink />
            {artifact.fileName}
          </a>
        </Button>
        <Badge variant={badgeVariant(artifact.reviewStatus)}>{labelize(artifact.reviewStatus)}</Badge>
        {artifact.publishedTargetPath ? (
          <span className="max-w-full break-all text-xs text-muted-foreground">
            Published: {artifact.publishedTargetPath}
          </span>
        ) : null}
        {artifact.sourceEvidenceSources?.length ? (
          <div className="basis-full rounded-md border bg-muted/20 p-3 text-xs">
            <div className="mb-2 font-medium text-foreground">Source graph</div>
            <div className="space-y-2">
              {artifact.sourceEvidenceSources.slice(0, 5).map((source) => (
                <div key={`${artifact.id}-${source.source}`} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badgeVariant(source.status)}>{labelize(source.status)}</Badge>
                    <span className="font-medium text-foreground">{source.label}</span>
                    <span className="text-muted-foreground">
                      {source.evidenceRefCount} refs
                    </span>
                  </div>
                  {source.reason ? (
                    <div className="text-muted-foreground">{source.reason}</div>
                  ) : null}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                    <span>{formatCounts(source.counts)}</span>
                    {formatSourceWindow(source.window) ? (
                      <span>Window: {formatSourceWindow(source.window)}</span>
                    ) : null}
                    {source.idempotencyKey ? (
                      <span className="break-all">Idempotency: {source.idempotencyKey}</span>
                    ) : null}
                  </div>
                  {source.unavailableWording ? (
                    <div className="text-muted-foreground">{source.unavailableWording}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {artifact.answerQuality ? (
          <div className="basis-full rounded-md border bg-muted/20 p-3 text-xs">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">Answer quality</span>
              <Badge variant={badgeVariant(artifact.answerQuality.usefulnessSignal.status)}>
                {labelize(artifact.answerQuality.usefulnessSignal.status)}
              </Badge>
            </div>
            <div className="space-y-1 text-muted-foreground">
              {artifact.answerQuality.question.text ? (
                <div className="line-clamp-2 text-foreground">{artifact.answerQuality.question.text}</div>
              ) : null}
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {artifact.answerQuality.question.reportFamily ? (
                  <span>{labelize(artifact.answerQuality.question.reportFamily)}</span>
                ) : null}
                {artifact.answerQuality.question.periodLabel ? (
                  <span>{artifact.answerQuality.question.periodLabel}</span>
                ) : null}
                <span>
                  Evidence: {artifact.answerQuality.evidence.totalEvidenceRefs ?? 0} refs
                  {artifact.answerQuality.evidence.truncated ? " (truncated)" : ""}
                </span>
                <span>
                  Answer: {artifact.answerQuality.answer.charCount ?? 0} chars
                  {artifact.answerQuality.answer.truncated ? " (truncated)" : ""}
                </span>
              </div>
              {artifact.answerQuality.usefulnessSignal.note ? (
                <div>{artifact.answerQuality.usefulnessSignal.note}</div>
              ) : null}
            </div>
          </div>
        ) : null}
        {isPending ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void reviewReportArtifact({
                  jobId: artifact.reportJobId,
                  artifactId: artifact.id,
                  action: "reject",
                })
              }
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin" /> : <X />}
              Decline
            </Button>
            <Button
              size="sm"
              onClick={() =>
                void reviewReportArtifact({
                  jobId: artifact.reportJobId,
                  artifactId: artifact.id,
                  action: "approve",
                })
              }
              disabled={busy || artifact.kind !== "markdown"}
              title={artifact.kind !== "markdown" ? "Only markdown artifacts can be published" : undefined}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              Approve
            </Button>
          </>
        ) : null}
      </div>
    );
  }

  async function openCandidateDetail(candidateId: string) {
    if (selectedCandidateId === candidateId && candidateDetail) {
      setSelectedCandidateId(null);
      setCandidateDetail(null);
      return;
    }
    setSelectedCandidateId(candidateId);
    setCandidateDetail(null);
    setCandidateDetailLoading(true);
    setError(null);
    try {
      const detail = await apiFetch<RoutineCandidateDetail>(
        `/api/routines/${routineId}/candidates/${candidateId}`,
        undefined,
        companyId,
      );
      setCandidateDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load finding detail");
      setSelectedCandidateId(null);
    } finally {
      setCandidateDetailLoading(false);
    }
  }

  async function previewDigest() {
    setDigesting(true);
    setError(null);
    try {
      const result = await apiFetch<{
        digest?: { path?: string; content?: string };
      }>(`/api/routines/${routineId}/digests/preview`, {
        method: "POST",
        body: JSON.stringify(digestWindow),
      }, companyId);
      setDigestPreview({
        path: result.digest?.path ?? null,
        content: result.digest?.content ?? null,
      });
      await load();
      setActiveTab("digests");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create digest preview");
    } finally {
      setDigesting(false);
    }
  }

  function updateSourceEdit(sourceId: string, patch: Partial<SourceEditState>) {
    setSourceEdits((current) => ({
      ...current,
      [sourceId]: {
        ...current[sourceId],
        ...patch,
      },
    }));
  }

  function sourcePayloadFromEdit(edit: SourceEditState, options?: { includeSourceKey?: boolean }) {
    const metadata = {
      useFor: edit.useFor,
      allowedContentTypes: commaList(edit.allowedContentTypesText),
      allowedUrlPrefixes: lineList(edit.allowedUrlPrefixesText),
      provenanceRequirements: commaList(edit.provenanceRequirementsText),
      primarySourceRequired: edit.primarySourceRequired,
      discoveryOnly: edit.discoveryOnly,
      secondaryCommentaryOnly: edit.secondaryCommentaryOnly,
      operatorInstructions: edit.operatorInstructions,
      notes: lineList(edit.notesText),
      collectorProvider: edit.collectorProvider,
      apifyActorId: edit.apifyActorId,
      apifyCrawlerType: edit.apifyCrawlerType,
      apifyMaxPagesPerRun: Number(edit.apifyMaxPagesPerRun),
      apifyWaitForFinishSecs: Number(edit.apifyWaitForFinishSecs),
      apifyRequestTimeoutSecs: Number(edit.apifyRequestTimeoutSecs),
      apifyRespectRobotsTxt: edit.apifyRespectRobotsTxt,
      apifyUseProxy: edit.apifyUseProxy,
      apifyIncludeUrlGlobs: lineList(edit.apifyIncludeUrlGlobsText),
      apifyExcludeUrlGlobs: lineList(edit.apifyExcludeUrlGlobsText),
    };
    return {
      ...(options?.includeSourceKey && edit.sourceKey.trim()
        ? { sourceKey: edit.sourceKey.trim() }
        : {}),
      title: edit.title,
      url: edit.url,
      sourceType: edit.sourceType,
      authority: edit.authority,
      jurisdiction: edit.jurisdiction,
      topicTags: commaList(edit.topicTagsText),
      fetchMode: edit.fetchMode,
      status: edit.status,
      checkFrequency: edit.checkFrequency,
      stalenessRisk: edit.stalenessRisk,
      trustTier: edit.trustTier,
      metadata,
    };
  }

  function updateSourceCreate(patch: Partial<SourceEditState>) {
    setSourceCreate((current) => ({ ...current, ...patch }));
  }

  async function saveSource(source: RoutineSource) {
    const edit = sourceEdits[source.id];
    if (!edit) return;
    setSourceSavingId(source.id);
    setError(null);
    try {
      await apiFetch(`/api/routines/${routineId}/sources/${source.id}`, {
        method: "PATCH",
        body: JSON.stringify(sourcePayloadFromEdit(edit)),
      }, companyId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save source");
    } finally {
      setSourceSavingId(null);
    }
  }

  async function createSource() {
    setSourceCreating(true);
    setError(null);
    try {
      await apiFetch(`/api/routines/${routineId}/sources`, {
        method: "POST",
        body: JSON.stringify(sourcePayloadFromEdit(sourceCreate, { includeSourceKey: true })),
      }, companyId);
      setSourceCreate(sourceEditDefaults());
      setShowSourceCreate(false);
      await load();
      setActiveTab("sources");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create source");
    } finally {
      setSourceCreating(false);
    }
  }

  async function testSource(sourceId: string) {
    setSourceTestingId(sourceId);
    setError(null);
    try {
      const result = await apiFetch<{
        ok: boolean;
        error?: string;
        result?: {
          canonicalUrl: string;
          contentType: string;
          fetchedAt: string;
          bodyTextLength: number;
          provider?: string;
          apifyRunId?: string;
          apifyDatasetId?: string;
          itemCount?: number;
          itemUrls?: string[];
        };
      }>(`/api/routines/${routineId}/sources/${sourceId}/test`, { method: "POST" }, companyId);
      setSourceTestResults((current) => ({
        ...current,
        [sourceId]: result.ok
          ? {
              ok: true,
              message: "Fetch OK",
              canonicalUrl: result.result?.canonicalUrl,
              contentType: result.result?.contentType,
              fetchedAt: result.result?.fetchedAt,
              bodyTextLength: result.result?.bodyTextLength,
              provider: result.result?.provider,
              apifyRunId: result.result?.apifyRunId,
              apifyDatasetId: result.result?.apifyDatasetId,
              itemCount: result.result?.itemCount,
              itemUrls: result.result?.itemUrls,
            }
          : { ok: false, message: result.error ?? "Fetch failed" },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to test source");
    } finally {
      setSourceTestingId(null);
    }
  }

  async function testManifestSource(sourceId: string) {
    setManifestSourceTestingId(sourceId);
    setError(null);
    try {
      const result = await apiFetch<{
        ok: boolean;
        source?: {
          status: string;
          label: string;
          reason?: string;
          error?: string;
          counts?: JsonRecord;
          refs?: unknown[];
        };
        snapshot?: { generatedAt?: string };
      }>(`/api/routines/${routineId}/manifest/sources/${sourceId}/test`, { method: "POST" }, companyId);
      setManifestSourceTestResults((current) => ({
        ...current,
        [sourceId]: {
          ok: result.ok,
          message: result.ok
            ? `${result.source?.label ?? sourceId}: ${labelize(result.source?.status ?? "available")}`
            : result.source?.error ?? result.source?.reason ?? "Source test failed",
          status: result.source?.status,
          reason: result.source?.reason,
          error: result.source?.error,
          counts: result.source?.counts,
          refCount: result.source?.refs?.length ?? 0,
          generatedAt: result.snapshot?.generatedAt,
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to test source");
    } finally {
      setManifestSourceTestingId(null);
    }
  }

  async function savePolicy() {
    if (!policyEdit) return;
    const maxSourcesPerRun = Number(policyEdit.maxSourcesPerRun);
    setPolicySaving(true);
    setError(null);
    try {
      await apiFetch(`/api/routines/${routineId}`, {
        method: "PATCH",
        body: JSON.stringify({
          sourcePolicy: {
            allowlistOnly: true,
            maxSourcesPerRun: Number.isFinite(maxSourcesPerRun) ? maxSourcesPerRun : 20,
            collectionInstructions: policyEdit.collectionInstructions.trim() || undefined,
            watchTopics: commaList(policyEdit.watchTopicsText),
            includeKeywords: commaList(policyEdit.includeKeywordsText),
            excludeKeywords: commaList(policyEdit.excludeKeywordsText),
            reviewerChecklist: lineList(policyEdit.reviewerChecklistText),
          },
        }),
      }, companyId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save collection rules");
    } finally {
      setPolicySaving(false);
    }
  }

  async function saveReportPolicy() {
    if (!routine || !reportPolicyEdit) return;
    setReportPolicySaving(true);
    setError(null);
    try {
      await apiFetch(`/api/routines/${routineId}`, {
        method: "PATCH",
        body: JSON.stringify(reportPolicyPayload(routine, reportPolicyEdit)),
      }, companyId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save report automation policy");
    } finally {
      setReportPolicySaving(false);
    }
  }

  const routine = data.routine;
  const manifest = data.manifest;
  const isReportRoutine = routine ? isReportRoutineTemplate(routine.templateKey) : false;
  const visibleTabs = tabs.filter((tab) => !(isReportRoutine && tab.value === "digests"));
  const automationsHref = companyId
    ? `/automations?companyId=${encodeURIComponent(companyId)}`
    : "/automations";

  useEffect(() => {
    if (isReportRoutine && activeTab === "digests") setActiveTab("runs");
  }, [activeTab, isReportRoutine]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <Button asChild variant="ghost" size="sm" className="px-0">
            <Link href={automationsHref}>
              <ArrowLeft />
              Automations
            </Link>
          </Button>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">{routine?.title ?? "Routine"}</h2>
              {routine ? <Badge variant={badgeVariant(routine.status)}>{labelize(routine.status)}</Badge> : null}
              {routine ? <Badge variant="outline">{labelize(routine.domain)}</Badge> : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Generic routine control plane. Legal Watch is the first production routine.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Refresh
          </Button>
          {routine?.status === "active" ? (
            <Button variant="outline" onClick={() => void updateRoutineStatus("pause")} disabled={statusBusy}>
              {statusBusy ? <Loader2 className="animate-spin" /> : <PauseCircle />}
              Pause
            </Button>
          ) : routine && ["paused", "draft"].includes(routine.status) ? (
            <Button variant="outline" onClick={() => void updateRoutineStatus("resume")} disabled={statusBusy}>
              {statusBusy ? <Loader2 className="animate-spin" /> : <PlayCircle />}
              Resume
            </Button>
          ) : null}
          <Button onClick={() => void runNow()} disabled={running || !routine || !canRunRoutineNow(routine.status)}>
            {running ? <Loader2 className="animate-spin" /> : <Play />}
            Run now
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading && !routine ? (
        <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">Loading routine...</div>
      ) : !routine ? (
        <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">Routine not found.</div>
      ) : (
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DetailTab)}>
          <TabsList className="grid !h-auto w-full grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="h-8 text-xs sm:text-sm">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {metric("Pending review", pendingCandidates.length + pendingReportArtifacts.length)}
              {metric("Sources", data.sources.length || builtInReportSources.length)}
              {metric("Stale sources", staleSources.length)}
              {metric("Latest run", latestRun ? labelize(latestRun.status) : "None")}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-md border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <ShieldCheck className="size-4" />
                  <h3 className="font-semibold">Health</h3>
                </div>
                <div className="grid gap-2 text-sm text-muted-foreground">
                  <div className="flex justify-between gap-3">
                    <span>Last run</span>
                    <span className="text-right text-foreground">{latestRun ? formatDateTime(latestRun.createdAt) : "Never"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Latest digest</span>
                    <span className="text-right text-foreground">{latestDigest ? formatDateTime(latestDigest.createdAt) : "None"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Review policy</span>
                    <span className="text-right text-foreground">
                      {routine.reviewPolicy.reviewRequired === true ? "Human approval required" : "Not required"}
                    </span>
                  </div>
                  {isReportRoutine ? (
                    <div className="flex justify-between gap-3">
                      <span>Pending report artifacts</span>
                      <span className="text-right text-foreground">{pendingReportArtifacts.length}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <span>Delivery</span>
                    <span className="text-right text-foreground">{String(routine.digestPolicy.delivery ?? "disabled")}</span>
                  </div>
                  {data.schedule ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <span>Scheduler</span>
                        <span className="text-right text-foreground">
                          {data.schedule.schedulerEnabled && data.schedule.globalSchedulerEnabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Decision</span>
                        <span className="text-right text-foreground">{labelize(data.schedule.decision.action)}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              </section>

              <section className="rounded-md border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="size-4" />
                  <h3 className="font-semibold">Latest run stats</h3>
                </div>
                {latestRun ? (
                  <div className="grid gap-0 text-sm">
                    {inlineStat("Fetched", countRecordValue(latestRun.stats, "fetchedCount"))}
                    {inlineStat("Changed", countRecordValue(latestRun.stats, "changedCount"))}
                    {inlineStat("Candidates", countRecordValue(latestRun.stats, "candidateCount"))}
                    {inlineStat("Errors", countRecordValue(latestRun.stats, "errorCount"))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No run ledger yet.</p>
                )}
              </section>
            </div>

            {data.schedule ? (
              <section className="rounded-md border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="size-4" />
                    <h3 className="font-semibold">Schedule status</h3>
                  </div>
                  <Badge variant={data.schedule.runnable ? "default" : "secondary"}>
                    {data.schedule.runnable ? "Due now" : labelize(data.schedule.decision.action)}
                  </Badge>
                </div>
                <div className="grid gap-3 text-sm md:grid-cols-3">
                  <div className="space-y-1">
                    <div className="text-xs uppercase text-muted-foreground">Latest due window</div>
                    <div className="font-medium">{data.schedule.latestDueWindow?.periodKey ?? "None"}</div>
                    <div className="text-xs text-muted-foreground">
                      {data.schedule.latestDueWindow
                        ? `${formatDateTime(data.schedule.latestDueWindow.windowStart)} to ${formatDateTime(data.schedule.latestDueWindow.windowEnd)}`
                        : data.schedule.decision.reason ?? "Manual only"}
                    </div>
                    {data.schedule.decision.idempotencyKey ? (
                      <div className="break-all text-xs text-muted-foreground">
                        Idempotency: {data.schedule.decision.idempotencyKey}
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs uppercase text-muted-foreground">Next due</div>
                    <div className="font-medium">{formatDateTime(data.schedule.nextDueWindow?.dueAt ?? null)}</div>
                    <div className="text-xs text-muted-foreground">
                      {data.schedule.nextDueWindow?.periodKey ?? data.schedule.timezone ?? "No recurring schedule"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs uppercase text-muted-foreground">Blocking run</div>
                    <div className="font-medium">
                      {data.schedule.blockingRun ? compactId(data.schedule.blockingRun.id) : "None"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {data.schedule.blockingRun
                        ? `${labelize(data.schedule.blockingRun.trigger)} · ${labelize(data.schedule.blockingRun.status)}`
                        : data.schedule.decision.reason ?? "No active scheduled/backfill run"}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {isReportRoutine && latestReportArtifacts.length > 0 ? (
              <section className="rounded-md border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="size-4" />
                  <h3 className="font-semibold">Latest report artifacts</h3>
                </div>
                <div className="flex flex-col gap-2">
                  {latestReportArtifacts.map((artifact) => (
                    <div key={artifact.id}>{reportArtifactControls(artifact)}</div>
                  ))}
                </div>
              </section>
            ) : null}

            {manifest ? (
              <section className="rounded-md border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="size-4" />
                  <h3 className="font-semibold">Automation contract</h3>
                </div>
                <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-1">
                    <div className="text-xs uppercase text-muted-foreground">Trigger</div>
                    <div className="font-medium">{labelize(manifest.trigger.type)}</div>
                    <div className="text-xs text-muted-foreground">
                      {manifest.trigger.cadence ? labelize(manifest.trigger.cadence) : "Manual"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs uppercase text-muted-foreground">Sources</div>
                    <div className="font-medium">{manifest.sources.length}</div>
                    <div className="text-xs text-muted-foreground">
                      {Array.from(new Set(manifest.sources.map((source) => labelize(source.type)))).join(", ") || "None"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs uppercase text-muted-foreground">Steps</div>
                    <div className="font-medium">{manifest.steps.length}</div>
                    <div className="text-xs text-muted-foreground">
                      {manifest.steps.slice(0, 4).map((step) => labelize(step.type)).join(", ")}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs uppercase text-muted-foreground">Destination</div>
                    <div className="font-medium">
                      {manifest.outputs.map((output) => labelize(output.destination.kind)).join(", ")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Review: {labelize(manifest.reviewPolicy.mode)}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}
          </TabsContent>

          <TabsContent value="findings" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {findingFilters.map((filter) => (
                  <Button
                    key={filter.value}
                    variant={findingFilter === filter.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFindingFilter(filter.value)}
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>
              <span className="text-sm text-muted-foreground">
                {findingFilterSummary}
              </span>
            </div>

            {data.candidates.length === 0 ? (
              <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
                No findings yet. Run the routine to collect candidate updates.
              </div>
            ) : filteredCandidates.length === 0 ? (
              <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
                No findings match this status.
              </div>
            ) : (
              filteredCandidates.map((candidate) => (
                <FindingRow
                  key={candidate.id}
                  candidate={candidate}
                  busy={reviewingId === candidate.id}
                  selected={selectedCandidateId === candidate.id}
                  detail={selectedCandidateId === candidate.id ? candidateDetail : null}
                  detailLoading={selectedCandidateId === candidate.id && candidateDetailLoading}
                  onOpen={() => void openCandidateDetail(candidate.id)}
                  onApprove={() => void reviewCandidate(candidate.id, "approve")}
                  onReject={() => void reviewCandidate(candidate.id, "reject")}
                />
              ))
            )}
          </TabsContent>

          <TabsContent value="sources" className="space-y-3">
            {showStoredSourceWorkbench ? (
              <div className="rounded-md border bg-card p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-semibold">Source workbench</h3>
                    <p className="text-sm text-muted-foreground">
                      Review every website, fetch rule, source purpose, and operator instruction used by this routine.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 md:items-end">
                    <div className="grid gap-1 text-sm text-muted-foreground md:text-right">
                      <span>{data.sources.filter((source) => source.status === "active").length} active</span>
                      <span>{staleSources.length} need attention</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSourceCreate((current) => !current)}
                    >
                      <Plus />
                      Add source
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            {builtInReportSources.length > 0 ? (
              <section className="rounded-md border bg-card p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-semibold">Built-in report sources</h3>
                    <p className="text-sm text-muted-foreground">Availability and evidence checks.</p>
                  </div>
                  <Badge variant="outline">{builtInReportSources.length} sources</Badge>
                </div>
                <div className="mt-4 divide-y">
                  {builtInReportSources.map((source) => {
                    const testResult = manifestSourceTestResults[source.id];
                    return (
                      <div key={source.id} className="grid gap-3 py-3 first:pt-0 last:pb-0 lg:grid-cols-[1fr_auto] lg:items-center">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{source.title}</span>
                            <Badge variant={badgeVariant(source.status)}>{labelize(source.status)}</Badge>
                            <Badge variant="outline">{labelize(source.type)}</Badge>
                            <Badge variant="outline">{labelize(source.trustTier)}</Badge>
                          </div>
                          {testResult ? (
                            <div className={`rounded-md border p-3 text-sm ${testResult.ok ? "bg-background" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
                              <div className="font-medium">{testResult.message}</div>
                              <div className="mt-1 grid gap-1 text-muted-foreground md:grid-cols-2">
                                {testResult.reason ? <span className="md:col-span-2">{testResult.reason}</span> : null}
                                {testResult.error ? <span className="md:col-span-2">Error: {testResult.error}</span> : null}
                                <span>{formatCounts(testResult.counts)}</span>
                                <span>Evidence refs: {testResult.refCount ?? 0}</span>
                                {testResult.generatedAt ? <span>Checked: {formatDateTime(testResult.generatedAt)}</span> : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void testManifestSource(source.id)}
                            disabled={manifestSourceTestingId === source.id}
                          >
                            {manifestSourceTestingId === source.id ? <Loader2 className="animate-spin" /> : <TestTube2 />}
                            Test source
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {showStoredSourceWorkbench && showSourceCreate ? (
              <SourceCreatePanel
                edit={sourceCreate}
                creating={sourceCreating}
                onEdit={updateSourceCreate}
                onCreate={() => void createSource()}
                onCancel={() => setShowSourceCreate(false)}
              />
            ) : null}
            {showStoredSourceWorkbench ? data.sources.map((source) => (
              <SourceWorkbench
                key={source.id}
                source={source}
                edit={sourceEdits[source.id] ?? sourceEditFromSource(source)}
                saving={sourceSavingId === source.id}
                testing={sourceTestingId === source.id}
                testResult={sourceTestResults[source.id] ?? null}
                onEdit={(patch) => updateSourceEdit(source.id, patch)}
                onSave={() => void saveSource(source)}
                onTest={() => void testSource(source.id)}
              />
            )) : null}
          </TabsContent>

          <TabsContent value="runs" className="space-y-3">
            {isReportRoutine ? (
              <section className="rounded-md border bg-card p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CalendarClock className="size-4" />
                      <h3 className="font-semibold">Backfill report window</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Preview exact schedule windows first, then queue missing runs through the same report worker.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runBackfill("preview")}
                      disabled={backfillBusy !== null}
                    >
                      {backfillBusy === "preview" ? <Loader2 className="animate-spin" /> : <Eye />}
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void runBackfill("queue")}
                      disabled={backfillBusy !== null}
                    >
                      {backfillBusy === "queue" ? <Loader2 className="animate-spin" /> : <PlayCircle />}
                      Queue backfill
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem]">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 md:col-span-2">
                      <Label className="grid gap-1">
                        <span>Use latest due window</span>
                        <span className="text-xs font-normal text-muted-foreground">Turn off to enter exact ISO window boundaries.</span>
                      </Label>
                      <Switch
                        checked={backfillEdit.latestDue}
                        onCheckedChange={(checked) => setBackfillEdit((current) => ({ ...current, latestDue: checked }))}
                      />
                    </div>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Window start</span>
                      <Input
                        value={backfillEdit.windowStart}
                        placeholder="2026-05-17T16:00:00.000Z"
                        disabled={backfillEdit.latestDue}
                        onChange={(event) => setBackfillEdit((current) => ({ ...current, windowStart: event.target.value }))}
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Window end</span>
                      <Input
                        value={backfillEdit.windowEnd}
                        placeholder="2026-05-24T16:00:00.000Z"
                        disabled={backfillEdit.latestDue}
                        onChange={(event) => setBackfillEdit((current) => ({ ...current, windowEnd: event.target.value }))}
                      />
                    </label>
                  </div>
                  <label className="grid gap-2 text-sm content-start">
                    <span className="font-medium">Max windows</span>
                    <Input
                      type="number"
                      min={1}
                      max={366}
                      value={backfillEdit.maxWindowCount}
                      onChange={(event) => setBackfillEdit((current) => ({ ...current, maxWindowCount: event.target.value }))}
                    />
                  </label>
                </div>
                {backfillResult ? (
                  <div className="mt-4 rounded-md border bg-background p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={backfillResult.ok ? "default" : "destructive"}>
                        {backfillResult.dryRun ? "Preview" : "Queued"}
                      </Badge>
                      <span>{backfillResult.windowCount} windows</span>
                      <span className="text-muted-foreground">
                        {backfillResult.queued} queued · {backfillResult.existing} existing · {backfillResult.blocked} blocked · {backfillResult.errors} errors
                      </span>
                    </div>
                    {backfillResult.error ? <div className="mt-2 text-destructive">{backfillResult.error}</div> : null}
                    {backfillResult.windows.length > 0 ? (
                      <div className="mt-3 divide-y">
                        {backfillResult.windows.map((window, index) => (
                          <div key={`${window.periodKey ?? "window"}-${index}`} className="grid gap-1 py-2 first:pt-0 last:pb-0 md:grid-cols-[8rem_1fr]">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={badgeVariant(window.action)}>{labelize(window.action)}</Badge>
                              {window.runId ? <span className="font-mono text-xs text-muted-foreground">{compactId(window.runId)}</span> : null}
                            </div>
                            <div className="min-w-0 text-muted-foreground">
                              <span className="font-medium text-foreground">{window.periodKey ?? "window"}</span>
                              {window.windowStart || window.windowEnd ? (
                                <span> · {formatDateTime(window.windowStart ?? null)} to {formatDateTime(window.windowEnd ?? null)}</span>
                              ) : null}
                              {window.reason ? <span> · {window.reason}</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}
            {data.runs.length === 0 ? (
              <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">No run history yet.</div>
            ) : (
              data.runs.map((run) => {
                const schedulerNote = runSchedulerNote(run.stats);
                const staleRecovery = runStaleRecoveryNote(run.stats);
                const cancellation = runCancellationNote(run.stats);
                const runReportJobs = reportJobsByRun.get(run.id) ?? [];
                const runObservations = observationsByRun.get(run.id) ?? [];
                const canCancelRun = run.status === "queued" || run.status === "running";
                return (
                  <section key={run.id} className="rounded-md border bg-card p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={badgeVariant(run.status)}>{labelize(run.status)}</Badge>
                          <span className="font-mono text-xs text-muted-foreground">{compactId(run.id)}</span>
                          <span className="text-sm text-muted-foreground">{labelize(run.trigger)}</span>
                        </div>
                        {run.error ? <p className="text-sm text-destructive">{run.error}</p> : null}
                        <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-5">
                          <span>Sources: {countRecordValue(run.stats, "sourceCount")}</span>
                          <span>Fetched: {countRecordValue(run.stats, "fetchedCount")}</span>
                          <span>Changed: {countRecordValue(run.stats, "changedCount")}</span>
                          <span>Candidates: {countRecordValue(run.stats, "candidateCount")}</span>
                          <span>Errors: {countRecordValue(run.stats, "errorCount")}</span>
                        </div>
                        {schedulerNote ? (
                          <div className="space-y-1 border-l pl-3 text-sm">
                            <div className="font-medium">{schedulerNote.title}</div>
                            {schedulerNote.message ? <div className="text-muted-foreground">{schedulerNote.message}</div> : null}
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              {schedulerNote.periodKey ? <span>Period: {schedulerNote.periodKey}</span> : null}
                              {schedulerNote.window ? <span>Window: {schedulerNote.window}</span> : null}
                              {schedulerNote.observedAt ? <span>Observed: {formatDateTime(schedulerNote.observedAt)}</span> : null}
                            </div>
                          </div>
                        ) : null}
                        {staleRecovery ? (
                          <div className="space-y-1 border-l pl-3 text-sm">
                            <div className="font-medium">Stale run recovery</div>
                            {staleRecovery.reason ? <div className="text-muted-foreground">{staleRecovery.reason}</div> : null}
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              {staleRecovery.previousStatus ? <span>Previous: {labelize(staleRecovery.previousStatus)}</span> : null}
                              {staleRecovery.cutoff ? <span>Cutoff: {formatDateTime(staleRecovery.cutoff)}</span> : null}
                              {staleRecovery.recoveredAt ? <span>Recovered: {formatDateTime(staleRecovery.recoveredAt)}</span> : null}
                            </div>
                          </div>
                        ) : null}
                        {cancellation ? (
                          <div className="space-y-1 border-l pl-3 text-sm">
                            <div className="font-medium">Run cancellation</div>
                            {cancellation.reason ? <div className="text-muted-foreground">{cancellation.reason}</div> : null}
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              {cancellation.previousStatus ? <span>Previous: {labelize(cancellation.previousStatus)}</span> : null}
                              {cancellation.cancelledAt ? <span>Cancelled: {formatDateTime(cancellation.cancelledAt)}</span> : null}
                            </div>
                          </div>
                        ) : null}
                        {runObservations.length > 0 ? (
                          <div className="space-y-2 border-l pl-3 text-sm">
                            <div className="font-medium">Source observations</div>
                            <div className="grid gap-2">
                              {runObservations.slice(0, 5).map((observation) => (
                                <div key={observation.id} className="min-w-0 rounded-md border bg-background p-2">
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <Badge variant={badgeVariant(observation.status)}>
                                      {labelize(observation.status)}
                                    </Badge>
                                    <Badge variant="outline">{labelize(observation.changeKind)}</Badge>
                                    <span className="font-medium">{observation.sourceConfigTitle}</span>
                                    <span className="text-muted-foreground">{formatDateTime(observation.fetchedAt)}</span>
                                  </div>
                                  <div className="mt-1 truncate text-xs text-muted-foreground">
                                    {observation.sourceTitle || observation.canonicalUrl}
                                  </div>
                                  {typeof observation.metadata.error === "string" ? (
                                    <div className="mt-1 text-xs text-destructive">{observation.metadata.error}</div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {runReportJobs.length > 0 ? (
                          <div className="space-y-2 border-l pl-3 text-sm">
                            <div className="font-medium">Report job artifacts</div>
                            {runReportJobs.map((item) => (
                              <div key={item.job.id} className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <Badge variant={badgeVariant(item.job.status)}>{labelize(item.job.status)}</Badge>
                                  <span className="font-mono">{compactId(item.job.id)}</span>
                                  <span>{labelize(item.job.outputFormat)}</span>
                                  <span>{item.artifacts.length} artifacts</span>
                                </div>
                                {item.artifacts.length > 0 ? (
                                  <div className="flex flex-col gap-2">
                                    {item.artifacts.map((artifact) => (
                                      <div key={artifact.id}>{reportArtifactControls(artifact)}</div>
                                    ))}
                                  </div>
                                ) : item.job.error ? (
                                  <div className="text-destructive">{item.job.error}</div>
                                ) : (
                                  <div className="text-muted-foreground">
                                    {readString(item.job.resultSummary.nextAction, "Artifact is not ready yet.")}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="grid gap-1 text-sm text-muted-foreground md:text-right">
                        <span>Created: {formatDateTime(run.createdAt)}</span>
                        <span>Started: {formatDateTime(run.startedAt)}</span>
                        <span>Finished: {formatDateTime(run.finishedAt)}</span>
                        {canCancelRun ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void cancelRun(run.id)}
                            disabled={runCancellingId === run.id}
                            className="mt-2 justify-self-end"
                          >
                            {runCancellingId === run.id ? <Loader2 className="animate-spin" /> : <X />}
                            Cancel run
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </section>
                );
              })
            )}
          </TabsContent>

          {!isReportRoutine ? (
          <TabsContent value="digests" className="space-y-4">
            <section className="rounded-md border bg-card p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-1">
                  <h3 className="font-semibold">Digest preview</h3>
                  <p className="text-sm text-muted-foreground">Preview-only digest generation. Delivery remains disabled.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Start
                    <input
                      type="date"
                      value={digestWindow.windowStart}
                      onChange={(event) => setDigestWindow((current) => ({ ...current, windowStart: event.target.value }))}
                      className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    End (inclusive)
                    <input
                      type="date"
                      value={digestWindow.windowEnd}
                      onChange={(event) => setDigestWindow((current) => ({ ...current, windowEnd: event.target.value }))}
                      className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                  <Button onClick={() => void previewDigest()} disabled={digesting}>
                    {digesting ? <Loader2 className="animate-spin" /> : <FileText />}
                    Preview
                  </Button>
                </div>
              </div>
            </section>

            {digestPreview?.content ? (
              <section className="rounded-md border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">Latest preview body</h3>
                  {digestPreview.path ? <Badge variant="outline">{digestPreview.path}</Badge> : null}
                </div>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs text-foreground">
                  {digestPreview.content}
                </pre>
              </section>
            ) : null}

            {data.digests.length === 0 ? (
              <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">No digest artifacts yet.</div>
            ) : (
              data.digests.map((digest) => (
                <section key={digest.id} className="rounded-md border bg-card p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={badgeVariant(digest.status)}>{labelize(digest.status)}</Badge>
                        <span className="font-mono text-xs text-muted-foreground">{compactId(digest.id)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(digest.windowStart)} to {formatExclusiveEndDate(digest.windowEnd)}
                      </p>
                    </div>
                    <div className="grid gap-1 text-sm text-muted-foreground md:text-right">
                      <span>{digest.candidateCount} candidates</span>
                      <span>{digest.approvedCount} approved / {digest.rejectedCount} rejected</span>
                      <span>{digest.changedSourceCount} changed sources</span>
                      <span>Previous candidates: {countRecordValue(digest.previousWindowStats, "newCandidates")}</span>
                      <span>Delivery: {String(digest.metadata.delivery ?? "disabled")}</span>
                      {digest.artifactPath ? <span className="break-all">Artifact: {digest.artifactPath}</span> : null}
                      <span>Created: {formatDateTime(digest.createdAt)}</span>
                    </div>
                  </div>
                </section>
              ))
            )}
          </TabsContent>
          ) : null}

          <TabsContent value="settings" className="space-y-4">
            <section className="rounded-md border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">Routine definition</h3>
                {routine.status !== "archived" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void updateRoutineStatus("archive")}
                    disabled={statusBusy}
                  >
                    {statusBusy ? <Loader2 className="animate-spin" /> : <Archive />}
                    Archive
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                <span>ID: <span className="font-mono text-foreground">{compactId(routine.id)}</span></span>
                <span>Slug: <span className="text-foreground">{routine.slug}</span></span>
                <span>Scope: <span className="text-foreground">{labelize(routine.scopeType)}</span></span>
                <span>Scope ID: <span className="text-foreground">{routine.scopeId ?? "active company"}</span></span>
                <span>Created from: <span className="text-foreground">{labelize(routine.createdFrom)}</span></span>
                <span>Owner: <span className="font-mono text-foreground">{compactId(routine.ownerUserId)}</span></span>
                <span>Jurisdiction: <span className="text-foreground">{routine.jurisdiction ?? "any"}</span></span>
                <span>Topic: <span className="text-foreground">{routine.topic ?? "generic"}</span></span>
              </div>
            </section>
            <section className="rounded-md border bg-card p-4">
              <h3 className="mb-3 font-semibold">Policies</h3>
              <div className="grid gap-3 lg:grid-cols-3">
                <PolicyBlock title="Schedule" value={routine.schedulePolicy} />
                <PolicyBlock title="Sources" value={routine.sourcePolicy} />
                <PolicyBlock title="Review" value={routine.reviewPolicy} />
                <PolicyBlock title="Digest" value={routine.digestPolicy} />
              </div>
            </section>
            {isReportRoutine ? (
              <section className="rounded-md border bg-card p-4">
                <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-semibold">Report automation policy</h3>
                    <p className="text-sm text-muted-foreground">
                      Schedule, source limits, and review mode for source-backed report runs.
                    </p>
                  </div>
                  <Button onClick={() => void saveReportPolicy()} disabled={reportPolicySaving || !reportPolicyEdit}>
                    {reportPolicySaving ? <Loader2 className="animate-spin" /> : <Save />}
                    Save policy
                  </Button>
                </div>
                {reportPolicyEdit ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="grid gap-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="grid gap-2 text-sm">
                          <span className="font-medium">Timezone</span>
                          <Input
                            value={reportPolicyEdit.timezone}
                            onChange={(event) => setReportPolicyEdit((current) => current ? ({ ...current, timezone: event.target.value }) : current)}
                          />
                        </label>
                        <label className="grid gap-2 text-sm">
                          <span className="font-medium">Due hour</span>
                          <Input
                            type="number"
                            min={0}
                            max={23}
                            value={reportPolicyEdit.dueHour}
                            onChange={(event) => setReportPolicyEdit((current) => current ? ({ ...current, dueHour: event.target.value }) : current)}
                          />
                        </label>
                        <label className="grid gap-2 text-sm">
                          <span className="font-medium">Due minute</span>
                          <Input
                            type="number"
                            min={0}
                            max={59}
                            value={reportPolicyEdit.dueMinute}
                            onChange={(event) => setReportPolicyEdit((current) => current ? ({ ...current, dueMinute: event.target.value }) : current)}
                          />
                        </label>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-2 text-sm">
                          <span className="font-medium">Due day offset</span>
                          <Input
                            type="number"
                            min={0}
                            max={31}
                            value={reportPolicyEdit.dueOffsetDays}
                            onChange={(event) => setReportPolicyEdit((current) => current ? ({ ...current, dueOffsetDays: event.target.value }) : current)}
                          />
                        </label>
                        <label className="grid gap-2 text-sm">
                          <span className="font-medium">Backfill window limit</span>
                          <Input
                            type="number"
                            min={1}
                            max={366}
                            value={reportPolicyEdit.maxBackfillWindowCount}
                            onChange={(event) => setReportPolicyEdit((current) => current ? ({ ...current, maxBackfillWindowCount: event.target.value }) : current)}
                          />
                        </label>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                        <Label className="grid gap-1">
                          <span>Scheduled runs</span>
                          <span className="text-xs font-normal text-muted-foreground">Manual runs remain available.</span>
                        </Label>
                        <Switch
                          checked={reportPolicyEdit.schedulerEnabled}
                          onCheckedChange={(checked) => setReportPolicyEdit((current) => current ? ({ ...current, schedulerEnabled: checked }) : current)}
                        />
                      </div>
                    </div>
                    <div className="grid gap-4">
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium">Collection instructions</span>
                        <textarea
                          value={reportPolicyEdit.collectionInstructions}
                          onChange={(event) => setReportPolicyEdit((current) => current ? ({ ...current, collectionInstructions: event.target.value }) : current)}
                          className="min-h-28 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        />
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-2 text-sm">
                          <span className="font-medium">Max items per source</span>
                          <Input
                            type="number"
                            min={1}
                            max={200}
                            value={reportPolicyEdit.maxItemsPerSource}
                            onChange={(event) => setReportPolicyEdit((current) => current ? ({ ...current, maxItemsPerSource: event.target.value }) : current)}
                          />
                        </label>
                        <label className="grid gap-2 text-sm">
                          <span className="font-medium">Artifact formats</span>
                          <Input
                            value={reportPolicyEdit.artifactFormatsText}
                            onChange={(event) => setReportPolicyEdit((current) => current ? ({ ...current, artifactFormatsText: event.target.value }) : current)}
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : (
              <section className="rounded-md border bg-card p-4">
                <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-semibold">Collection rules</h3>
                    <p className="text-sm text-muted-foreground">
                      Operator instructions are saved as bounded rules for collection and review. They do not enable legal advice or automatic delivery.
                    </p>
                  </div>
                  <Button onClick={() => void savePolicy()} disabled={policySaving || !policyEdit}>
                    {policySaving ? <Loader2 className="animate-spin" /> : <Save />}
                    Save rules
                  </Button>
                </div>
                {policyEdit ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="grid gap-2 text-sm">
                      <span className="font-medium">Collection instructions</span>
                      <textarea
                        value={policyEdit.collectionInstructions}
                        onChange={(event) => setPolicyEdit((current) => current ? ({ ...current, collectionInstructions: event.target.value }) : current)}
                        className="min-h-28 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      />
                    </label>
                    <div className="grid gap-4">
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium">Max sources per run</span>
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          value={policyEdit.maxSourcesPerRun}
                          onChange={(event) => setPolicyEdit((current) => current ? ({ ...current, maxSourcesPerRun: event.target.value }) : current)}
                        />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium">Watch topics</span>
                        <Input
                          value={policyEdit.watchTopicsText}
                          onChange={(event) => setPolicyEdit((current) => current ? ({ ...current, watchTopicsText: event.target.value }) : current)}
                        />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium">Include keywords</span>
                        <Input
                          value={policyEdit.includeKeywordsText}
                          onChange={(event) => setPolicyEdit((current) => current ? ({ ...current, includeKeywordsText: event.target.value }) : current)}
                        />
                      </label>
                      <label className="grid gap-2 text-sm">
                        <span className="font-medium">Exclude keywords</span>
                        <Input
                          value={policyEdit.excludeKeywordsText}
                          onChange={(event) => setPolicyEdit((current) => current ? ({ ...current, excludeKeywordsText: event.target.value }) : current)}
                        />
                      </label>
                    </div>
                    <label className="grid gap-2 text-sm lg:col-span-2">
                      <span className="font-medium">Reviewer checklist additions</span>
                      <textarea
                        value={policyEdit.reviewerChecklistText}
                        onChange={(event) => setPolicyEdit((current) => current ? ({ ...current, reviewerChecklistText: event.target.value }) : current)}
                        className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      />
                    </label>
                  </div>
                ) : null}
              </section>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function SourceWorkbench({
  source,
  edit,
  saving,
  testing,
  testResult,
  onEdit,
  onSave,
  onTest,
}: {
  source: RoutineSource;
  edit: SourceEditState;
  saving: boolean;
  testing: boolean;
  testResult: SourceTestState | null;
  onEdit: (patch: Partial<SourceEditState>) => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const metadata = sourceMetadata(source);
  const provenance = readStringArray(metadata.provenanceRequirements);
  const allowedContentTypes = readStringArray(metadata.allowedContentTypes);
  const allowedUrlPrefixes = readStringArray(metadata.allowedUrlPrefixes);
  const notes = readStringArray(metadata.notes);
  const operatorConfigured = metadata.operatorConfigured === true;

  return (
    <section className="rounded-md border bg-card p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 truncate font-semibold">{source.title}</h3>
              <Badge variant={badgeVariant(source.status)}>{labelize(source.status)}</Badge>
              <Badge variant="outline">{labelize(source.trustTier)}</Badge>
              <Badge variant={edit.collectorProvider === "apify" ? "secondary" : "outline"}>
                {labelize(edit.collectorProvider)}
              </Badge>
              {operatorConfigured ? <Badge variant="secondary">Operator edited</Badge> : null}
            </div>
            <a
              className="mt-2 flex max-w-full items-center gap-1 break-all text-sm text-primary hover:underline"
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink />
              {source.url}
            </a>
            {source.lastError ? <p className="mt-2 text-sm text-destructive">{source.lastError}</p> : null}
          </div>
          <div className="grid gap-1 text-sm text-muted-foreground lg:text-right">
            <span>Last seen: {formatDateTime(source.lastSeenAt)}</span>
            <span>Changed: {formatDateTime(source.lastChangedAt)}</span>
            <span>{labelize(source.fetchMode)} / {labelize(source.checkFrequency)}</span>
          </div>
        </div>

        <SourceFormFields edit={edit} onEdit={onEdit} />

        <div className="grid gap-3 rounded-md border bg-background p-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Authority</div>
            <div className="mt-1 font-medium">{source.authority}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Type</div>
            <div className="mt-1 font-medium">{labelize(source.sourceType)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Allowed content</div>
            <div className="mt-1 break-words">{allowedContentTypes.length ? allowedContentTypes.join(", ") : "Default"}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Verified as of</div>
            <div className="mt-1 font-medium">{readString(metadata.verifiedAsOf, "unknown")}</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs uppercase text-muted-foreground">Allowed URL prefixes</div>
            <div className="mt-1 break-all">{allowedUrlPrefixes.length ? allowedUrlPrefixes.join(", ") : source.url}</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs uppercase text-muted-foreground">Provenance checklist</div>
            <div className="mt-1 break-words">{provenance.length ? provenance.join(", ") : "Not configured"}</div>
          </div>
          {notes.length > 0 ? (
            <div className="md:col-span-2 xl:col-span-4">
              <div className="text-xs uppercase text-muted-foreground">Registry notes</div>
              <ul className="mt-1 grid gap-1">
                {notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </div>
          ) : null}
        </div>

        {testResult ? (
          <div className={`rounded-md border p-3 text-sm ${testResult.ok ? "bg-background" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
            <div className="font-medium">{testResult.message}</div>
            {testResult.ok ? (
              <div className="mt-1 grid gap-1 text-muted-foreground md:grid-cols-2">
                <span>Provider: {labelize(testResult.provider ?? edit.collectorProvider)}</span>
                <span className="break-all">Canonical: {testResult.canonicalUrl ?? "unknown"}</span>
                <span>Content: {testResult.contentType ?? "unknown"}</span>
                <span>Fetched: {formatDateTime(testResult.fetchedAt ?? null)}</span>
                <span>Text length: {testResult.bodyTextLength ?? 0}</span>
                {testResult.itemCount !== undefined ? <span>Items: {testResult.itemCount}</span> : null}
                {testResult.apifyRunId ? <span className="break-all">Apify run: {testResult.apifyRunId}</span> : null}
                {testResult.apifyDatasetId ? <span className="break-all">Dataset: {testResult.apifyDatasetId}</span> : null}
                {testResult.itemUrls?.length ? (
                  <span className="break-all md:col-span-2">Covered URLs: {testResult.itemUrls.slice(0, 5).join(", ")}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : <TestTube2 />}
            Test fetch
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save source
          </Button>
        </div>
      </div>
    </section>
  );
}

function SourceCreatePanel({
  edit,
  creating,
  onEdit,
  onCreate,
  onCancel,
}: {
  edit: SourceEditState;
  creating: boolean;
  onEdit: (patch: Partial<SourceEditState>) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="rounded-md border bg-card p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold">New source</h3>
            <p className="text-sm text-muted-foreground">
              Add an official page, listing, feed, or manual seed to this routine.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onCancel} disabled={creating}>
              Cancel
            </Button>
            <Button size="sm" onClick={onCreate} disabled={creating}>
              {creating ? <Loader2 className="animate-spin" /> : <Plus />}
              Create source
            </Button>
          </div>
        </div>
        <SourceFormFields edit={edit} onEdit={onEdit} allowSourceKey />
      </div>
    </section>
  );
}

function SelectField({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2 text-sm">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {values.map((item) => (
              <SelectItem key={item} value={item}>{labelize(item)}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function SourceFormFields({
  edit,
  onEdit,
  allowSourceKey = false,
}: {
  edit: SourceEditState;
  onEdit: (patch: Partial<SourceEditState>) => void;
  allowSourceKey?: boolean;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {allowSourceKey ? (
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Source key</span>
          <Input
            value={edit.sourceKey}
            placeholder="custom-official-news"
            onChange={(event) => onEdit({ sourceKey: event.target.value })}
          />
        </label>
      ) : null}
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Source title</span>
        <Input value={edit.title} onChange={(event) => onEdit({ title: event.target.value })} />
      </label>
      <label className="grid gap-2 text-sm">
        <span className="font-medium">URL</span>
        <Input value={edit.url} onChange={(event) => onEdit({ url: event.target.value })} />
      </label>
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Authority</span>
        <Input value={edit.authority} onChange={(event) => onEdit({ authority: event.target.value })} />
      </label>
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Jurisdiction</span>
        <Input value={edit.jurisdiction} onChange={(event) => onEdit({ jurisdiction: event.target.value.toUpperCase() })} />
      </label>
      <SelectField label="Source type" value={edit.sourceType} values={sourceTypes} onChange={(value) => onEdit({ sourceType: value })} />
      <SelectField label="Trust tier" value={edit.trustTier} values={sourceTrustTiers} onChange={(value) => onEdit({ trustTier: value })} />
      <SelectField label="Fetch mode" value={edit.fetchMode} values={sourceFetchModes} onChange={(value) => onEdit({ fetchMode: value })} />
      <SelectField label="Status" value={edit.status} values={sourceStatuses} onChange={(value) => onEdit({ status: value })} />
      <SelectField label="Check frequency" value={edit.checkFrequency} values={sourceFrequencies} onChange={(value) => onEdit({ checkFrequency: value })} />
      <SelectField label="Staleness risk" value={edit.stalenessRisk} values={sourceStalenessRisks} onChange={(value) => onEdit({ stalenessRisk: value })} />
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Topic tags</span>
        <Input value={edit.topicTagsText} onChange={(event) => onEdit({ topicTagsText: event.target.value })} />
      </label>
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Allowed content types</span>
        <Input
          value={edit.allowedContentTypesText}
          placeholder={sourceContentTypes.join(", ")}
          onChange={(event) => onEdit({ allowedContentTypesText: event.target.value })}
        />
      </label>
      <label className="grid gap-2 text-sm lg:col-span-2">
        <span className="font-medium">Allowed URL prefixes</span>
        <textarea
          value={edit.allowedUrlPrefixesText}
          onChange={(event) => onEdit({ allowedUrlPrefixesText: event.target.value })}
          className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </label>
      <label className="grid gap-2 text-sm lg:col-span-2">
        <span className="font-medium">Provenance requirements</span>
        <Input
          value={edit.provenanceRequirementsText}
          onChange={(event) => onEdit({ provenanceRequirementsText: event.target.value })}
        />
      </label>
      <SelectField label="Collector provider" value={edit.collectorProvider} values={sourceProviders} onChange={(value) => onEdit({ collectorProvider: value })} />
      {edit.collectorProvider === "apify" ? (
        <>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Apify actor</span>
            <Input value={edit.apifyActorId} onChange={(event) => onEdit({ apifyActorId: event.target.value })} />
          </label>
          <SelectField label="Crawler type" value={edit.apifyCrawlerType} values={apifyCrawlerTypes} onChange={(value) => onEdit({ apifyCrawlerType: value })} />
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Max pages</span>
            <Input
              type="number"
              min={1}
              max={5}
              value={edit.apifyMaxPagesPerRun}
              onChange={(event) => onEdit({ apifyMaxPagesPerRun: event.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Wait seconds</span>
            <Input
              type="number"
              min={10}
              max={180}
              value={edit.apifyWaitForFinishSecs}
              onChange={(event) => onEdit({ apifyWaitForFinishSecs: event.target.value })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Request timeout</span>
            <Input
              type="number"
              min={10}
              max={180}
              value={edit.apifyRequestTimeoutSecs}
              onChange={(event) => onEdit({ apifyRequestTimeoutSecs: event.target.value })}
            />
          </label>
          <CheckboxField label="Use Apify proxy" checked={edit.apifyUseProxy} onChange={(checked) => onEdit({ apifyUseProxy: checked })} />
          <CheckboxField label="Respect robots.txt" checked={edit.apifyRespectRobotsTxt} onChange={(checked) => onEdit({ apifyRespectRobotsTxt: checked })} />
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Include URL globs</span>
            <textarea
              value={edit.apifyIncludeUrlGlobsText}
              onChange={(event) => onEdit({ apifyIncludeUrlGlobsText: event.target.value })}
              className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Exclude URL globs</span>
            <textarea
              value={edit.apifyExcludeUrlGlobsText}
              onChange={(event) => onEdit({ apifyExcludeUrlGlobsText: event.target.value })}
              className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
        </>
      ) : null}
      <CheckboxField label="Primary source required" checked={edit.primarySourceRequired} onChange={(checked) => onEdit({ primarySourceRequired: checked })} />
      <CheckboxField label="Discovery only" checked={edit.discoveryOnly} onChange={(checked) => onEdit({ discoveryOnly: checked })} />
      <CheckboxField label="Secondary commentary only" checked={edit.secondaryCommentaryOnly} onChange={(checked) => onEdit({ secondaryCommentaryOnly: checked })} />
      <label className="grid gap-2 text-sm lg:col-span-2">
        <span className="font-medium">Use for</span>
        <textarea
          value={edit.useFor}
          onChange={(event) => onEdit({ useFor: event.target.value })}
          className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </label>
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Source-specific instructions</span>
        <textarea
          value={edit.operatorInstructions}
          onChange={(event) => onEdit({ operatorInstructions: event.target.value })}
          className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </label>
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Operator notes</span>
        <textarea
          value={edit.notesText}
          onChange={(event) => onEdit({ notesText: event.target.value })}
          className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </label>
    </div>
  );
}

function FindingRow({
  candidate,
  busy,
  selected,
  detail,
  detailLoading,
  onOpen,
  onApprove,
  onReject,
}: {
  candidate: RoutineCandidate;
  busy: boolean;
  selected: boolean;
  detail: RoutineCandidateDetail | null;
  detailLoading: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const locale = useLocale();
  const isPending: boolean = candidate.reviewStatus === "pending";
  const display = readCandidateDisplay(candidate, locale);
  return (
    <section className="rounded-md border bg-card p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate font-semibold">{display.title}</h3>
            <Badge variant={badgeVariant(candidate.reviewStatus)}>{labelize(candidate.reviewStatus)}</Badge>
            <Badge variant="outline">{labelize(candidate.legalStatus)}</Badge>
            {display.status === "translated" ? (
              <Badge variant="secondary">{display.locale.toUpperCase()}</Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{display.summary}</p>
          <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            <span>Target: {candidate.targetPath}</span>
            <span>Source date: {formatDate(candidate.sourceDate)}</span>
            <span>Confidence: {candidate.confidenceScore ?? "not scored"}</span>
            <span>Commit: {compactId(candidate.commitSha)}</span>
          </div>
          {candidate.sourceUrls.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {candidate.sourceUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  Source
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          <Button variant="outline" size="sm" onClick={onOpen}>
            {detailLoading ? <Loader2 className="animate-spin" /> : <Eye />}
            {selected ? "Hide detail" : "Detail"}
          </Button>
          <Button variant="outline" size="sm" onClick={onReject} disabled={!isPending || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <X />}
            Reject
          </Button>
          <Button size="sm" onClick={onApprove} disabled={!isPending || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            Approve
          </Button>
        </div>
      </div>
      {selected ? (
        <FindingDetail detail={detail} loading={detailLoading} fallback={candidate} />
      ) : null}
    </section>
  );
}

function FindingDetail({
  detail,
  loading,
  fallback,
}: {
  detail: RoutineCandidateDetail | null;
  loading: boolean;
  fallback: RoutineCandidate;
}) {
  const locale = useLocale();
  if (loading) {
    return (
      <div className="mt-4 rounded-md border bg-background p-4 text-sm text-muted-foreground">
        Loading finding detail...
      </div>
    );
  }
  const candidate = detail?.candidate ?? fallback;
  const display = readCandidateDisplay(candidate, locale);
  const frontmatter = detail?.proposedFrontmatter ?? candidate.proposedFrontmatter;
  const body = detail?.proposedBody ?? candidate.proposedBody;
  const translationMetadata = isRecord(frontmatter.display_translation_metadata)
    ? frontmatter.display_translation_metadata
    : null;
  return (
    <div className="mt-4 grid gap-4 rounded-md border bg-background p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <div>
          <h4 className="text-sm font-semibold">Interface display</h4>
          <div className="mt-2 grid gap-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{display.title}</span>
            <span>{display.summary}</span>
            <span>
              Display locale: <span className="text-foreground">{display.locale}</span>
              {translationMetadata ? (
                <>
                  {" "}
                  / source language:{" "}
                  <span className="text-foreground">
                    {readString(translationMetadata.source_language, "unknown")}
                  </span>
                  {" "}
                  / provider:{" "}
                  <span className="text-foreground">
                    {readString(translationMetadata.provider, "none")}
                  </span>
                </>
              ) : null}
            </span>
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Reviewer checklist</h4>
          <div className="mt-2 grid gap-2 text-sm text-muted-foreground">
            <span>Jurisdiction: <span className="text-foreground">{candidate.jurisdiction}</span></span>
            <span>Source date: <span className="text-foreground">{formatDate(candidate.sourceDate)}</span></span>
            <span>Review status: <span className="text-foreground">{labelize(candidate.reviewStatus)}</span></span>
            <span>Confidence: <span className="text-foreground">{candidate.confidenceScore ?? "not scored"}</span></span>
            <span>Target path: <span className="break-all text-foreground">{candidate.targetPath}</span></span>
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Evidence</h4>
          <div className="mt-2 grid gap-2 text-sm text-muted-foreground">
            {candidate.sourceUrls.length > 0 ? (
              candidate.sourceUrls.map((url) => (
                <a key={url} className="break-all text-primary hover:underline" href={url} target="_blank" rel="noreferrer">
                  {url}
                </a>
              ))
            ) : (
              <span>No source URL recorded.</span>
            )}
            {candidate.observationIds.length > 0 ? (
              <span className="break-all">Observation refs: {candidate.observationIds.join(", ")}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        <div>
          <h4 className="text-sm font-semibold">Proposed QMD frontmatter</h4>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs text-foreground">
            {JSON.stringify(frontmatter, null, 2)}
          </pre>
        </div>
        <div>
          <h4 className="text-sm font-semibold">Proposed body</h4>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs text-foreground">
            {body || "No proposed body recorded."}
          </pre>
        </div>
      </div>
    </div>
  );
}

function PolicyBlock({ title, value }: { title: string; value: Record<string, unknown> }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-2 text-sm font-medium">{title}</div>
      <dl className="grid gap-1 text-sm text-muted-foreground">
        {Object.entries(value).length === 0 ? (
          <div>Not configured</div>
        ) : (
          Object.entries(value).map(([key, item]) => (
            <div key={key} className="flex justify-between gap-3">
              <dt>{labelize(key)}</dt>
              <dd className="text-right text-foreground">{String(item)}</dd>
            </div>
          ))
        )}
      </dl>
    </div>
  );
}
