"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  FileSearch,
  Loader2,
  PauseCircle,
  Play,
  PlayCircle,
  Plus,
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
import { canRunRoutineNow, formatDateTime, isRoutineSourceUnhealthy, labelize } from "./format";
import type {
  JsonRecord,
  RoutineDefinition,
  RoutineDigest,
  RoutineListSummary,
  RoutineReportJobsSummary,
  RoutineReportJobWithArtifacts,
  RoutineRun,
  RoutineSource,
  RoutineTemplate,
} from "./types";

interface ListState {
  routines: RoutineDefinition[];
  templates: RoutineTemplate[];
  summaries: Record<string, RoutineListSummary>;
}

interface CompanyOption {
  id: string;
  name: string;
  slug?: string | null;
  role: string;
}

interface CompaniesResponse {
  companies: CompanyOption[];
  activeCompanyId: string | null;
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

function statusTone(status: string) {
  if (status === "active") return "default";
  if (status === "paused" || status === "draft") return "secondary";
  return "outline";
}

const emptySummary: RoutineListSummary = {
  pendingCandidateCount: 0,
  pendingReportArtifactCount: 0,
  latestReportArtifactStatus: null,
  latestReportArtifactAt: null,
  staleSourceCount: 0,
  latestRunStatus: null,
  latestRunAt: null,
  latestDigestStatus: null,
  latestDigestAt: null,
};

const REPORT_AUTOMATION_TEMPLATE_KEYS = new Set([
  "daily_finance_report",
  "weekly_operating_report",
  "monthly_management_report",
]);

function isReportAutomationTemplateKey(templateKey: string) {
  return REPORT_AUTOMATION_TEMPLATE_KEYS.has(templateKey);
}

function templateDescription(template: RoutineTemplate) {
  if (isReportAutomationTemplateKey(template.templateKey)) {
    return "Source-backed report automation template using built-in Odoo, Company-DB, and document sources. Scheduler rollout stays operator-controlled.";
  }
  if (template.templateKey === "legal_watch_bkpm") {
    return "Legal Watch for BKPM source monitoring, review, and digest previews.";
  }
  return "Automation template for source-backed company work.";
}

function templateNamePlaceholder(templateKey: string) {
  if (templateKey === "daily_finance_report") return "Daily finance report";
  if (templateKey === "weekly_operating_report") return "Weekly operating report";
  if (templateKey === "monthly_management_report") return "Monthly management report";
  return "BKPM Legal Watch - custom sources";
}

interface NewReportPolicyState {
  timezone: string;
  dueHour: string;
  dueMinute: string;
  dueOffsetDays: string;
  schedulerEnabled: boolean;
  maxBackfillWindowCount: string;
  collectionInstructions: string;
  maxItemsPerSource: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function templateCadence(templateKey: string): "daily" | "weekly" | "monthly" {
  if (templateKey === "daily_finance_report") return "daily";
  if (templateKey === "monthly_management_report") return "monthly";
  return "weekly";
}

function defaultAnchorForCadence(cadence: "daily" | "weekly" | "monthly") {
  return {
    hour: 0,
    minute: 0,
    ...(cadence === "weekly" ? { dayOfWeek: 1 } : {}),
    ...(cadence === "monthly" ? { dayOfMonth: 1 } : {}),
  };
}

function policyStateFromTemplate(template: RoutineTemplate | null): NewReportPolicyState {
  const schedule = isRecord(template?.defaultSchedulePolicy) ? template.defaultSchedulePolicy : {};
  const dueTime = isRecord(schedule.dueTime) ? schedule.dueTime : {};
  return {
    timezone: readString(schedule.timezone, "UTC"),
    dueHour: String(readNumber(dueTime.hour, 9)),
    dueMinute: String(readNumber(dueTime.minute, 0)),
    dueOffsetDays: String(readNumber(schedule.dueOffsetDays, 0)),
    schedulerEnabled: schedule.schedulerEnabled === true,
    maxBackfillWindowCount: String(readNumber(schedule.maxBackfillWindowCount, 8)),
    collectionInstructions: "",
    maxItemsPerSource: "50",
  };
}

function boundedInt(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function buildReportCreatePolicies(template: RoutineTemplate, state: NewReportPolicyState) {
  if (!isReportAutomationTemplateKey(template.templateKey)) return {};
  const cadence = templateCadence(template.templateKey);
  const schedule = isRecord(template.defaultSchedulePolicy) ? template.defaultSchedulePolicy : {};
  const localAnchor = isRecord(schedule.localAnchor)
    ? { ...defaultAnchorForCadence(cadence), ...schedule.localAnchor }
    : defaultAnchorForCadence(cadence);
  const artifactFormats =
    template.templateKey === "daily_finance_report" ? ["markdown"] : ["markdown", "xlsx"];
  const builtInSources = ["odoo", "company_db", "documents"];

  return {
    schedulePolicy: {
      cadence,
      timezone: state.timezone.trim() || "UTC",
      localAnchor,
      dueTime: {
        hour: boundedInt(state.dueHour, 9, 0, 23),
        minute: boundedInt(state.dueMinute, 0, 0, 59),
      },
      dueOffsetDays: boundedInt(state.dueOffsetDays, 0, 0, 31),
      catchUpPolicy: "last_due_only",
      maxBackfillWindowCount: boundedInt(state.maxBackfillWindowCount, 8, 1, 366),
      manualRunEnabled: true,
      schedulerEnabled: state.schedulerEnabled,
    },
    sourcePolicy: {
      sourceStatusModel: "available_partial_unavailable_failed",
      configuredSourcesRequiredBeforeActivation: false,
      builtInSources,
      collectionInstructions: state.collectionInstructions.trim() || undefined,
      maxItemsPerSource: boundedInt(state.maxItemsPerSource, 50, 1, 200),
    },
    reviewPolicy: {
      reviewRequired: true,
      mode: "human_or_scoped_api_key",
      publishPolicy: "review_required",
    },
    digestPolicy: {
      previewOnly: true,
      delivery: "disabled",
      artifactFormats,
    },
  };
}

async function loadRoutineSummary(
  routine: RoutineDefinition,
  companyId: string,
): Promise<RoutineListSummary> {
  const isReportRoutine = isReportAutomationTemplateKey(routine.templateKey);
  const [detail, runsResult, pendingResult, digestsResult, reportJobsResult] = await Promise.all([
    apiFetch<{ sources: RoutineSource[] }>(`/api/routines/${routine.id}`, undefined, companyId),
    apiFetch<{ runs: RoutineRun[] }>(`/api/routines/${routine.id}/runs`, undefined, companyId),
    apiFetch<{ candidates: unknown[] }>(`/api/routines/${routine.id}/candidates?status=pending`, undefined, companyId),
    apiFetch<{ digests: RoutineDigest[] }>(`/api/routines/${routine.id}/digests`, undefined, companyId),
    isReportRoutine
      ? apiFetch<{
          reportJobs: RoutineReportJobWithArtifacts[];
          summary: RoutineReportJobsSummary;
        }>(
          `/api/routines/${routine.id}/report-jobs?limit=5`,
          undefined,
          companyId,
        )
      : Promise.resolve({ reportJobs: [], summary: { pendingArtifactCount: 0, latestArtifact: null } }),
  ]);
  const latestRun = runsResult.runs[0] ?? null;
  const latestDigest = digestsResult.digests[0] ?? null;
  const latestReportArtifact = reportJobsResult.summary.latestArtifact;
  return {
    pendingCandidateCount: pendingResult.candidates.length,
    pendingReportArtifactCount: reportJobsResult.summary.pendingArtifactCount,
    latestReportArtifactStatus: latestReportArtifact?.reviewStatus ?? null,
    latestReportArtifactAt: latestReportArtifact?.createdAt ?? null,
    staleSourceCount: detail.sources.filter(isRoutineSourceUnhealthy).length,
    latestRunStatus: latestRun?.status ?? null,
    latestRunAt: latestRun?.createdAt ?? null,
    latestDigestStatus: latestDigest?.status ?? null,
    latestDigestAt: latestDigest?.createdAt ?? null,
  };
}

export function AutomationsList({
  initialCompanyId = null,
}: {
  initialCompanyId?: string | null;
}) {
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(initialCompanyId);
  const [data, setData] = useState<ListState>({ routines: [], templates: [], summaries: {} });
  const [loading, setLoading] = useState(true);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [newTemplateKey, setNewTemplateKey] = useState<string>("");
  const [newRoutineTitle, setNewRoutineTitle] = useState("");
  const [newReportPolicy, setNewReportPolicy] = useState<NewReportPolicyState>(() => policyStateFromTemplate(null));
  const [runningId, setRunningId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId],
  );

  const selectedCompanyLabel = selectedCompany?.name ?? "selected company";
  const selectedNewTemplate = useMemo(
    () => data.templates.find((template) => template.templateKey === newTemplateKey) ?? null,
    [data.templates, newTemplateKey],
  );
  const selectedTemplateIsReport = Boolean(
    selectedNewTemplate && isReportAutomationTemplateKey(selectedNewTemplate.templateKey),
  );

  const detailHref = useCallback(
    (routineId: string) =>
      selectedCompanyId
        ? `/automations/${routineId}?companyId=${encodeURIComponent(selectedCompanyId)}`
        : `/automations/${routineId}`,
    [selectedCompanyId],
  );

  const load = useCallback(async (companyId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [routinesResult, templatesResult] = await Promise.all([
        apiFetch<{ routines: RoutineDefinition[] }>("/api/routines", undefined, companyId),
        apiFetch<{ templates: RoutineTemplate[] }>("/api/routines/templates", undefined, companyId),
      ]);
      const summaries = Object.fromEntries(
        await Promise.all(
          routinesResult.routines.map(async (routine) => [
            routine.id,
            await loadRoutineSummary(routine, companyId).catch(() => emptySummary),
          ]),
        ),
      );
      setData({
        routines: routinesResult.routines,
        templates: templatesResult.templates,
        summaries,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automations");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    setError(null);
    try {
      const result = await apiFetch<CompaniesResponse>("/api/companies");
      setCompanies(result.companies);
      setSelectedCompanyId((current) => {
        const requested = initialCompanyId ?? current;
        if (requested && result.companies.some((company) => company.id === requested)) {
          return requested;
        }
        return result.activeCompanyId ?? result.companies[0]?.id ?? null;
      });
      if (result.companies.length === 0) {
        setData({ routines: [], templates: [], summaries: {} });
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load companies");
      setLoading(false);
    } finally {
      setLoadingCompanies(false);
    }
  }, [initialCompanyId]);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    if (loadingCompanies) return;
    if (!selectedCompanyId) {
      setData({ routines: [], templates: [], summaries: {} });
      setLoading(false);
      return;
    }
    void load(selectedCompanyId);
  }, [load, loadingCompanies, selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("companyId") === selectedCompanyId) return;
    url.searchParams.set("companyId", selectedCompanyId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [selectedCompanyId]);

  const routineByTemplate = useMemo(() => {
    return new Map(
      data.routines.map((routine) => [
        `${routine.templateKey}:${routine.scopeType}:${routine.scopeId ?? ""}`,
        routine,
      ]),
    );
  }, [data.routines]);

  useEffect(() => {
    if (newTemplateKey || data.templates.length === 0) return;
    setNewTemplateKey(data.templates[0]?.templateKey ?? "");
  }, [data.templates, newTemplateKey]);

  useEffect(() => {
    setNewReportPolicy(policyStateFromTemplate(selectedNewTemplate));
  }, [selectedNewTemplate]);

  async function createFromTemplate(
    template: RoutineTemplate,
    options: { createMode?: "ensure" | "new"; title?: string; reportPolicy?: NewReportPolicyState } = {},
  ) {
    if (!selectedCompanyId) {
      setError("Select a company before creating an automation");
      return;
    }
    const createMode = options.createMode ?? "ensure";
    const title = options.title?.trim() || undefined;
    setCreatingKey(`${template.templateKey}:${createMode}`);
    setError(null);
    try {
      const reportPolicies = buildReportCreatePolicies(
        template,
        options.reportPolicy ?? policyStateFromTemplate(template),
      );
      const result = await apiFetch<{ routine: RoutineDefinition }>("/api/routines", {
        method: "POST",
        body: JSON.stringify({
          templateKey: template.templateKey,
          title,
          scopeType: "company",
          scopeId: null,
          createMode,
          ...reportPolicies,
        }),
      }, selectedCompanyId);
      if (typeof window !== "undefined") {
        window.location.assign(detailHref(result.routine.id));
        return;
      }
      await load(selectedCompanyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create routine");
    } finally {
      setCreatingKey(null);
    }
  }

  async function createNewAutomation() {
    const template = data.templates.find((item) => item.templateKey === newTemplateKey) ?? data.templates[0];
    if (!template) {
      setError("No automation template is available for this company");
      return;
    }
    await createFromTemplate(template, {
      createMode: "new",
      title: newRoutineTitle,
      reportPolicy: newReportPolicy,
    });
  }

  async function runNow(routineId: string) {
    if (!selectedCompanyId) {
      setError("Select a company before running an automation");
      return;
    }
    setRunningId(routineId);
    setError(null);
    try {
      await apiFetch(`/api/routines/${routineId}/run`, { method: "POST" }, selectedCompanyId);
      await load(selectedCompanyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to queue run");
    } finally {
      setRunningId(null);
    }
  }

  async function updateRoutineStatus(routine: RoutineDefinition, action: "pause" | "resume") {
    if (!selectedCompanyId) {
      setError("Select a company before updating an automation");
      return;
    }
    const confirmActivation = action === "resume" &&
      routine.createdFrom === "chat_draft" &&
      routine.status === "draft";
    if (confirmActivation && !window.confirm("Activate this agent-created draft routine?")) {
      return;
    }
    setStatusBusyId(routine.id);
    setError(null);
    try {
      await apiFetch(`/api/routines/${routine.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, confirmActivation }),
      }, selectedCompanyId);
      await load(selectedCompanyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} routine`);
    } finally {
      setStatusBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Automations</h2>
          <p className="text-sm text-muted-foreground">
            Company routines for watches, reviews, digests, and controlled agent runs.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="grid gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Company</span>
            <Select
              value={selectedCompanyId ?? ""}
              onValueChange={setSelectedCompanyId}
              disabled={loadingCompanies || companies.length === 0}
            >
              <SelectTrigger className="min-w-64">
                <SelectValue placeholder={loadingCompanies ? "Loading companies" : "Select company"} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {companies.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            onClick={() => selectedCompanyId ? void load(selectedCompanyId) : undefined}
            disabled={loading || loadingCompanies || !selectedCompanyId}
          >
            {loading ? <Loader2 className="animate-spin" /> : <FileSearch />}
            Refresh
          </Button>
          <Button
            onClick={() => setCreatePanelOpen((open) => !open)}
            disabled={loadingCompanies || loading || !selectedCompanyId || data.templates.length === 0}
          >
            <Plus />
            New automation
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {createPanelOpen ? (
        <section className="rounded-md border bg-card p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)_auto] lg:items-end">
            <div className="space-y-1">
              <h3 className="text-base font-semibold">Create automation</h3>
              <p className="text-sm text-muted-foreground">
                Creates a separate paused automation for {selectedCompanyLabel}.
              </p>
            </div>
            <div className="grid gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Template</span>
                <Select
                  value={newTemplateKey}
                  onValueChange={setNewTemplateKey}
                  disabled={data.templates.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {data.templates.map((template) => (
                        <SelectItem key={template.id} value={template.templateKey}>
                          {template.title}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</span>
                <Input
                  value={newRoutineTitle}
                  onChange={(event) => setNewRoutineTitle(event.target.value)}
                  placeholder={templateNamePlaceholder(newTemplateKey)}
                  maxLength={120}
                />
              </div>
              {selectedTemplateIsReport ? (
                <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Timezone</span>
                      <Input
                        value={newReportPolicy.timezone}
                        onChange={(event) => setNewReportPolicy((current) => ({ ...current, timezone: event.target.value }))}
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Due hour</span>
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={newReportPolicy.dueHour}
                        onChange={(event) => setNewReportPolicy((current) => ({ ...current, dueHour: event.target.value }))}
                      />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Due day offset</span>
                      <Input
                        type="number"
                        min={0}
                        max={31}
                        value={newReportPolicy.dueOffsetDays}
                        onChange={(event) => setNewReportPolicy((current) => ({ ...current, dueOffsetDays: event.target.value }))}
                      />
                    </label>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                    <Label className="grid gap-1">
                      <span>Scheduled runs</span>
                      <span className="text-xs font-normal text-muted-foreground">Manual runs stay enabled.</span>
                    </Label>
                    <Switch
                      checked={newReportPolicy.schedulerEnabled}
                      onCheckedChange={(checked) => setNewReportPolicy((current) => ({ ...current, schedulerEnabled: checked }))}
                    />
                  </div>
                  <label className="grid gap-1 text-sm">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Collection instructions</span>
                    <textarea
                      value={newReportPolicy.collectionInstructions}
                      onChange={(event) => setNewReportPolicy((current) => ({ ...current, collectionInstructions: event.target.value }))}
                      className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    />
                  </label>
                </div>
              ) : null}
            </div>
            <Button
              onClick={() => void createNewAutomation()}
              disabled={!selectedCompanyId || !newTemplateKey || creatingKey?.endsWith(":new")}
            >
              {creatingKey?.endsWith(":new") ? <Loader2 className="animate-spin" /> : <Plus />}
              Create paused
            </Button>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Routines</h3>
          <span className="text-xs text-muted-foreground">{data.routines.length} configured</span>
        </div>

        {!selectedCompanyId && !loadingCompanies ? (
          <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
            Select a company to configure automations.
          </div>
        ) : loading ? (
          <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">Loading automations...</div>
        ) : data.routines.length === 0 ? (
          <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
            No routines yet for {selectedCompanyLabel}. Create one from the template below.
          </div>
        ) : (
          <div className="grid gap-3">
            {data.routines.map((routine) => (
              <RoutineCard
                key={routine.id}
                routine={routine}
                summary={data.summaries[routine.id] ?? emptySummary}
                running={runningId === routine.id}
                statusBusy={statusBusyId === routine.id}
                detailHref={detailHref(routine.id)}
                onRun={() => void runNow(routine.id)}
                onStatus={(action) => void updateRoutineStatus(routine, action)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Templates</h3>
          <span className="text-xs text-muted-foreground">{data.templates.length} available</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {data.templates.map((template) => {
            const existing = routineByTemplate.get(
              `${template.templateKey}:company:`,
            );
            return (
              <div key={template.id} className="rounded-md border bg-card p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold">{template.title}</h3>
                      <Badge variant="outline">{labelize(template.riskLevel)} risk</Badge>
                      <Badge variant="secondary">{labelize(template.domain)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {templateDescription(template)}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>{template.defaultSources.length} sources</span>
                      <span>Jurisdiction: {template.defaultJurisdiction ?? "any"}</span>
                      <span>Delivery: disabled</span>
                    </div>
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      Scope: {selectedCompanyLabel}
                    </div>
                  </div>
                  {existing ? (
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <Button asChild variant="outline" size="sm">
                        <Link href={detailHref(existing.id)}>Open routine</Link>
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void createFromTemplate(template, { createMode: "new" })}
                        disabled={!selectedCompanyId || creatingKey === `${template.templateKey}:new`}
                      >
                        {creatingKey === `${template.templateKey}:new` ? <Loader2 className="animate-spin" /> : <Plus />}
                        Create another
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => void createFromTemplate(template)}
                      disabled={!selectedCompanyId || creatingKey === `${template.templateKey}:ensure`}
                    >
                      {creatingKey === `${template.templateKey}:ensure` ? <Loader2 className="animate-spin" /> : <Plus />}
                      Create paused
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function RoutineCard({
  routine,
  summary,
  running,
  statusBusy,
  detailHref,
  onRun,
  onStatus,
}: {
  routine: RoutineDefinition;
  summary: RoutineListSummary;
  running: boolean;
  statusBusy: boolean;
  detailHref: string;
  onRun: () => void;
  onStatus: (action: "pause" | "resume") => void;
}) {
  const setupBlocked = isReportAutomationTemplateKey(routine.templateKey) &&
    routine.metadata?.sourcesConfigured !== true;
  const runnerEnabled = !isReportAutomationTemplateKey(routine.templateKey) || !setupBlocked;
  const canPause = routine.status === "active";
  const canResume = !setupBlocked && (routine.status === "paused" || routine.status === "draft");
  const canRun = runnerEnabled && canRunRoutineNow(routine.status);
  const pendingReviewCount = summary.pendingCandidateCount + summary.pendingReportArtifactCount;
  const isReportRoutine = isReportAutomationTemplateKey(routine.templateKey);
  return (
    <div className="grid gap-4 rounded-md border bg-card p-4 md:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 truncate text-base font-semibold">{routine.title}</h3>
          <Badge variant={statusTone(routine.status)}>{labelize(routine.status)}</Badge>
          <Badge variant="outline">{labelize(routine.domain)}</Badge>
          {pendingReviewCount > 0 ? (
            <Badge variant="secondary">{pendingReviewCount} pending review</Badge>
          ) : null}
          {setupBlocked ? <Badge variant="secondary">Setup required</Badge> : null}
        </div>
        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
          <span>Scope: {labelize(routine.scopeType)}</span>
          <span>Topic: {routine.topic ?? "generic"}</span>
          <span>Updated: {formatDateTime(routine.updatedAt)}</span>
          <span>Template: {labelize(routine.templateKey)}</span>
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <span>
            <span className="text-muted-foreground">Health: </span>
            {summary.staleSourceCount === 0 ? "Sources OK" : `${summary.staleSourceCount} stale/failed sources`}
          </span>
          <span>
            <span className="text-muted-foreground">Last run: </span>
            {summary.latestRunStatus ? `${labelize(summary.latestRunStatus)} ${formatDateTime(summary.latestRunAt)}` : "None"}
          </span>
          <span>
            <span className="text-muted-foreground">{isReportRoutine ? "Artifact: " : "Digest: "}</span>
            {isReportRoutine
              ? summary.latestReportArtifactStatus
                ? `${labelize(summary.latestReportArtifactStatus)} ${formatDateTime(summary.latestReportArtifactAt)}`
                : "None"
              : summary.latestDigestStatus
                ? `${labelize(summary.latestDigestStatus)} ${formatDateTime(summary.latestDigestAt)}`
                : "None"}
          </span>
          <span>
            <span className="text-muted-foreground">Reviews: </span>
            {pendingReviewCount} pending
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {canPause || canResume ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onStatus(canPause ? "pause" : "resume")}
            disabled={statusBusy}
          >
            {statusBusy ? <Loader2 className="animate-spin" /> : canPause ? <PauseCircle /> : <PlayCircle />}
            {canPause ? "Pause" : "Resume"}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={onRun}
          disabled={running || !canRun}
          title={runnerEnabled ? undefined : "Sources must be configured before this automation can run"}
        >
          {running ? <Loader2 className="animate-spin" /> : <Play />}
          {runnerEnabled ? "Run now" : "Setup required"}
        </Button>
        <Button asChild size="sm">
          <Link href={detailHref}>
            Open
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}
