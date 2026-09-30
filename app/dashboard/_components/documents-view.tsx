"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodexAuthStatusNotice } from "@/components/codex-auth-status-notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Clock,
  Download,
  Upload,
  Eye,
  Check,
  X,
  RotateCw,
  ChevronDown,
  ChevronUp,
  Trash2,
  MessageSquareWarning,
  Sparkles,
} from "lucide-react";
import { useDocumentsData } from "@/lib/hooks/use-financial-data";
import { hasPendingUserClarification } from "@/lib/documents/question-feed";
import {
  buildDocumentCardViewModel,
  type DocumentCardStage,
} from "@/lib/documents/document-card-view-model";
import {
  compareDocumentHistoryItems,
  needsDocumentHistoryAttention,
  shouldShowInDocumentHistory,
} from "@/lib/documents/document-history";
import { UploadZone } from "@/app/integrations/_components/upload-zone";
import { EmptyState } from "./empty-state";
import { ViewSkeleton } from "./view-skeleton";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatConfidence(score: string | null): string | null {
  if (!score) return null;
  const n = Number(score);
  if (isNaN(n)) return null;
  return `${Math.round(n * 100)}%`;
}

function formatDocType(type: string | null): string | null {
  if (!type) return null;
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface SourceFileDescriptor {
  document: {
    id: string;
    fileName: string;
    fileType: string;
    status: string;
    contentType: string;
  };
  viewPath: string;
  viewUrl: string | null;
  downloadPath: string;
  downloadUrl: string | null;
  requiresAuthorization: true;
}

/** Flat PG document row returned by /api/documents */
interface DocumentRow {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  source: string;
  status: string;
  extractedTxnCount: number;
  confidenceScore: string | null;
  error: string | null;
  documentType: string | null;
  reportingPeriod: string | null;
  createdAt: string;
  reviewRequired: boolean;
  reviewFlags: string[];
  overallConfidence: string | null;
  clarificationPendingCount: number;
  codex: {
    stage: string;
    updatedAt: string | null;
    completedAt: string | null;
    error: string | null;
    artifactCount: number | null;
    unitCount: number | null;
  } | null;
  promotion: {
    stage: string;
    updatedAt: string | null;
    completedAt: string | null;
    error: string | null;
    promotedDomains: string[];
  } | null;
  audit: {
    stage: string;
    updatedAt: string | null;
    completedAt: string | null;
    error: string | null;
    overallStatus: "ok" | "warning" | "fail" | null;
    recommendedDisposition: string | null;
    issueCount: number | null;
    warningCount: number | null;
    auditSummary: string | null;
  } | null;
  sourceContext: {
    provider: string | null;
    sourcePath: string | null;
    rootPath: string | null;
    connectionLabel: string | null;
    ingressSource: string | null;
    driveFileId: string | null;
    inferredPeriod:
      | {
          start: string;
          end: string;
          label?: string | null;
        }
      | null;
  } | null;
  sourceFile: SourceFileDescriptor | null;
}

interface ClarificationQuestion {
  key: string;
  label: string;
  prompt: string;
  type: "text" | "select";
  required: boolean;
  templateEligible: boolean;
  options?: string[];
  currentValue?: string | null;
}

interface ClarificationPayload {
  documentId: string;
  fileName: string;
  status: string;
  sourceFile: SourceFileDescriptor | null;
  review: {
    reviewFlags: string[];
    overallConfidence: string | null;
  } | null;
  questions: ClarificationQuestion[];
  answers: Record<string, string>;
  templateDefaults: Record<string, string>;
  bulkApply?: {
    available: boolean;
    similarDocumentCount: number;
    questionKeys: string[];
  };
}

function hasActiveProcessing(doc: DocumentRow): boolean {
  return (
    doc.status === "processing" ||
    doc.codex?.stage === "queued" ||
    doc.codex?.stage === "artifactizing" ||
    doc.codex?.stage === "running" ||
    doc.codex?.stage === "persisting" ||
    doc.promotion?.stage === "running" ||
    doc.audit?.stage === "queued" ||
    doc.audit?.stage === "artifactizing" ||
    doc.audit?.stage === "running" ||
    doc.audit?.stage === "persisting"
  );
}

function SourceFileActions({
  sourceFile,
  compact = false,
}: {
  sourceFile: SourceFileDescriptor | null;
  compact?: boolean;
}) {
  if (!sourceFile) {
    return null;
  }

  const size = compact ? "xs" : "sm";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size={size}>
        <a href={sourceFile.viewPath} target="_blank" rel="noreferrer">
          <Eye className="size-3.5" />
          Open source
        </a>
      </Button>
      <Button asChild variant="outline" size={size}>
        <a href={sourceFile.downloadPath} download={sourceFile.document.fileName}>
          <Download className="size-3.5" />
          Download source
        </a>
      </Button>
    </div>
  );
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-500 border-0 text-[11px] px-2 py-0.5 font-medium">
          <CheckCircle2 className="size-3 mr-1" />
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-500/15 text-red-400 border-0 text-[11px] px-2 py-0.5 font-medium">
          <AlertCircle className="size-3 mr-1" />
          Failed
        </Badge>
      );
    case "processing":
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-0 text-[11px] px-2 py-0.5 font-medium animate-pulse">
          <Clock className="size-3 mr-1" />
          Processing
        </Badge>
      );
    case "needs_review":
      return (
        <Badge className="bg-yellow-500/15 text-yellow-400 border-0 text-[11px] px-2 py-0.5 font-medium">
          <Eye className="size-3 mr-1" />
          Saved with Flags
        </Badge>
      );
    case "rejected":
      return (
        <Badge className="bg-red-400/15 text-red-400 border-0 text-[11px] px-2 py-0.5 font-medium">
          <X className="size-3 mr-1" />
          Rejected
        </Badge>
      );
    default:
      return null;
  }
}

function codexStageBadge(doc: DocumentRow) {
  const stage = doc.codex?.stage;
  if (!stage) return null;

  switch (stage) {
    case "queued":
      return (
        <Badge className="bg-slate-500/15 text-slate-300 border-0 text-[11px] px-2 py-0.5 font-medium">
          Queued
        </Badge>
      );
    case "artifactizing":
      return (
        <Badge className="bg-blue-500/15 text-blue-400 border-0 text-[11px] px-2 py-0.5 font-medium">
          Artifactizing
        </Badge>
      );
    case "running":
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-0 text-[11px] px-2 py-0.5 font-medium animate-pulse">
          Codex running
        </Badge>
      );
    case "persisting":
      return (
        <Badge className="bg-violet-500/15 text-violet-400 border-0 text-[11px] px-2 py-0.5 font-medium">
          Persisting
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-[11px] px-2 py-0.5 font-medium">
          Parsed
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-500/15 text-red-400 border-0 text-[11px] px-2 py-0.5 font-medium">
          Parse Failed
        </Badge>
      );
    default:
      return null;
  }
}

function promotionBadge(doc: DocumentRow) {
  const stage = doc.promotion?.stage;
  if (!stage) return null;

  switch (stage) {
    case "running":
      return (
        <Badge className="bg-blue-500/15 text-blue-400 border-0 text-[11px] px-2 py-0.5 font-medium">
          Promoting
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-[11px] px-2 py-0.5 font-medium">
          Promoted
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-500/15 text-red-400 border-0 text-[11px] px-2 py-0.5 font-medium">
          Promotion Failed
        </Badge>
      );
    default:
      return null;
  }
}

function auditBadge(doc: DocumentRow) {
  const audit = doc.audit;
  if (!audit) return null;

  if (audit.stage === "queued") {
    return (
      <Badge className="bg-slate-500/15 text-slate-300 border-0 text-[11px] px-2 py-0.5 font-medium">
        QA queued
      </Badge>
    );
  }
  if (audit.stage === "artifactizing" || audit.stage === "running" || audit.stage === "persisting") {
    return (
      <Badge className="bg-blue-500/15 text-blue-400 border-0 text-[11px] px-2 py-0.5 font-medium">
        QA running
      </Badge>
    );
  }
  if (audit.stage === "failed") {
    return (
      <Badge className="bg-red-500/15 text-red-400 border-0 text-[11px] px-2 py-0.5 font-medium">
        QA failed
      </Badge>
    );
  }
  if (audit.stage === "completed" && audit.overallStatus === "fail") {
    return (
      <Badge className="bg-red-500/15 text-red-400 border-0 text-[11px] px-2 py-0.5 font-medium">
        QA flagged
      </Badge>
    );
  }
  if (audit.stage === "completed" && audit.overallStatus === "warning") {
    return (
      <Badge className="bg-yellow-500/15 text-yellow-400 border-0 text-[11px] px-2 py-0.5 font-medium">
        QA warning
      </Badge>
    );
  }
  if (audit.stage === "completed" && audit.overallStatus === "ok") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-[11px] px-2 py-0.5 font-medium">
        QA ok
      </Badge>
    );
  }
  return null;
}

function confidenceBadge(score: string | null) {
  const pct = formatConfidence(score);
  if (!pct) return null;
  const n = Number(score);
  const color =
    n >= 0.8
      ? "text-emerald-400"
      : n >= 0.5
        ? "text-yellow-400"
        : "text-red-400";
  return (
    <span className={`text-[11px] tabular-nums font-medium ${color}`}>
      {pct}
    </span>
  );
}

function stageDotClassName(stage: DocumentCardStage): string {
  switch (stage.state) {
    case "done":
      return "border-emerald-500 bg-emerald-500 text-primary-foreground";
    case "active":
      return "border-blue-400 bg-blue-500 text-white";
    case "blocked":
      return "border-red-500 bg-red-500 text-white";
    case "pending":
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function stageLabelClassName(stage: DocumentCardStage): string {
  switch (stage.state) {
    case "done":
      return "text-emerald-300";
    case "active":
      return "font-medium text-blue-300";
    case "blocked":
      return "font-medium text-red-300";
    case "pending":
    default:
      return "text-muted-foreground";
  }
}

function DocumentStageTimeline({ stages }: { stages: DocumentCardStage[] }) {
  const locale = useLocale();
  const copy =
    locale === "ru"
      ? {
          title: "Состояние документа",
          step: "Шаг",
          of: "из",
          next: "Дальше",
          final: "Финальный статус",
          completed: "завершено",
        }
      : locale === "id"
        ? {
            title: "Status dokumen",
            step: "Langkah",
            of: "dari",
            next: "Berikutnya",
            final: "Status final",
            completed: "selesai",
          }
        : {
            title: "Document status",
            step: "Step",
            of: "of",
            next: "Next",
            final: "Final status",
            completed: "completed",
          };
  const activeStage =
    stages.find((stage) => stage.state === "active" || stage.state === "blocked") ??
    stages.find((stage) => stage.key === "ready" && stage.state === "done") ??
    stages[0];
  const activeIndex = activeStage
    ? Math.max(0, stages.findIndex((stage) => stage.key === activeStage.key))
    : 0;
  const nextStage = stages.slice(activeIndex + 1).find((stage) => stage.state === "pending");
  const completedCount = stages.filter((stage) => stage.state === "done").length;
  const progressValue = stages.length > 1 ? (activeIndex / (stages.length - 1)) * 100 : 100;

  return (
    <div className="mt-3 rounded-md border border-border/50 bg-background/40 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {copy.title}
        </span>
        {activeStage ? (
          <span className={`truncate text-[11px] ${stageLabelClassName(activeStage)}`}>
            {activeStage.label}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${
                activeStage?.state === "blocked" ? "bg-red-400" : "bg-emerald-400"
              }`}
              style={{ width: `${Math.max(8, progressValue)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            {stages.map((stage, index) => (
              <span
                key={stage.key}
                className={`flex size-4 items-center justify-center rounded-full border text-[9px] ${stageDotClassName(stage)}`}
                aria-label={`${stage.label}: ${stage.state}`}
              >
                {stage.state === "done" ? (
                  <Check className="size-2.5" />
                ) : stage.state === "blocked" ? (
                  <X className="size-2.5" />
                ) : stage.state === "active" ? (
                  <Clock className="size-2.5" />
                ) : (
                  index + 1
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right text-[10px] leading-tight text-muted-foreground">
          <div>
            {copy.step} {Math.min(activeIndex + 1, stages.length)} {copy.of} {stages.length}
          </div>
          {nextStage ? <div>{copy.next}: {nextStage.label}</div> : <div>{copy.final}</div>}
          {completedCount > 0 ? <div>{completedCount} {copy.completed}</div> : null}
        </div>
      </div>
    </div>
  );
}

// ── File Icon ──────────────────────────────────────────────────────────────────

function FileIcon({ fileType }: { fileType: string }) {
  if (fileType === "excel") {
    return <FileSpreadsheet className="size-5 text-emerald-500 shrink-0" />;
  }
  return <FileText className="size-5 text-blue-400 shrink-0" />;
}

// ── Section 1: Processing Queue ─────────────────────────────────────────────

function ProcessingQueue({ documents }: { documents: DocumentRow[] }) {
  const locale = useLocale();
  const processing = documents.filter(hasActiveProcessing);

  if (processing.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-muted-foreground font-medium flex items-center gap-2">
          <Upload className="size-4" />
          Processing Queue
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">
            {processing.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {processing.map((doc) => {
            const viewModel = buildDocumentCardViewModel(doc, locale);
            return (
              <div
                key={doc.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/30"
              >
                <FileIcon fileType={doc.fileType} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {doc.fileName}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {doc.fileType.toUpperCase()} via {doc.sourceContext?.provider ?? doc.source}
                  </p>
                  {doc.sourceContext?.sourcePath ? (
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {doc.sourceContext.sourcePath}
                    </p>
                  ) : null}
                  <div className="mt-2 rounded-md border border-border/60 bg-background/40 px-3 py-2">
                    <p className="text-xs font-medium text-foreground">{viewModel.headline}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      {viewModel.detail}
                    </p>
                    <DocumentStageTimeline stages={viewModel.stages} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {statusBadge(doc.status)}
                  {codexStageBadge(doc)}
                  {promotionBadge(doc)}
                  {auditBadge(doc)}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ClarificationQueue({
  documents,
  onReviewed,
  focusedDocumentId,
}: {
  documents: DocumentRow[];
  onReviewed: () => void;
  focusedDocumentId: string | null;
}) {
  const processingCount = documents.filter(hasActiveProcessing).length;
  const items = documents
    .filter((doc) => !hasActiveProcessing(doc))
    .filter(hasPendingUserClarification)
    .sort((left, right) => {
      const pendingDiff = right.clarificationPendingCount - left.clarificationPendingCount;
      if (pendingDiff !== 0) return pendingDiff;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });

  return (
    <Card id="document-questions">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-muted-foreground font-medium flex items-center gap-2">
          <MessageSquareWarning className="size-4" />
          Document Questions
          <Badge className="bg-blue-500/15 text-blue-400 border-0 text-[10px] px-1.5 py-0 ml-1">
            {items.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length > 0 ? (
          <div className="space-y-2">
            {items.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                onReviewed={onReviewed}
                isFocused={focusedDocumentId === doc.id}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            <p>No completed documents currently need clarification in this company.</p>
            {processingCount > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground/80">
                {processingCount} document{processingCount === 1 ? " is" : "s are"} still processing. Questions appear only after parsing completes.
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClarificationPanel({
  doc,
  onSaved,
  autoOpen,
  onReprocess,
  reprocessing = false,
}: {
  doc: DocumentRow;
  onSaved: () => void;
  autoOpen?: boolean;
  onReprocess?: () => void;
  reprocessing?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [rememberTemplate, setRememberTemplate] = useState(true);
  const [applyToSimilar, setApplyToSimilar] = useState(false);
  const [payload, setPayload] = useState<ClarificationPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const loadPayload = useCallback(async () => {
    if (payload !== null || loading) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}/clarifications`);
      if (!res.ok) return;
      const json = (await res.json()) as ClarificationPayload;
      setPayload(json);
      setAnswers({
        ...json.templateDefaults,
        ...json.answers,
      });
    } finally {
      setLoading(false);
    }
  }, [doc.id, loading, payload]);

  function toggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      void loadPayload();
    }
  }

  async function handleSave() {
    if (!payload) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}/clarifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          applyToSimilar,
          saveTemplate: rememberTemplate,
          reprocess: true,
        }),
      });
      if (!res.ok) return;
      onSaved();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!autoOpen || open) return;
    setOpen(true);
    void loadPayload();
  }, [autoOpen, loadPayload, open]);

  if (!doc.reviewRequired && doc.clarificationPendingCount === 0) {
    return null;
  }

  const hasPendingQuestions = hasPendingUserClarification(doc);
  const panelTitle = hasPendingQuestions
    ? "Answer document questions"
    : "Processing notes";
  const panelClassName = hasPendingQuestions
    ? "mt-2 rounded-lg border border-blue-500/20 bg-blue-500/5"
    : "mt-2 rounded-lg border border-yellow-500/20 bg-yellow-500/5";
  const panelAccentClassName = hasPendingQuestions ? "text-blue-400" : "text-yellow-400";
  const panelBorderClassName = hasPendingQuestions ? "border-blue-500/10" : "border-yellow-500/10";

  return (
    <div className={panelClassName}>
      <button
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        onClick={toggleOpen}
      >
        <div className="flex items-center gap-2">
          <MessageSquareWarning className={`size-4 ${panelAccentClassName}`} />
          <span className={`text-sm font-medium ${panelAccentClassName}`}>
            {panelTitle}
          </span>
          {hasPendingQuestions ? (
            <Badge className="bg-blue-500/15 text-blue-400 border-0 text-[10px] px-1.5 py-0">
              {doc.clarificationPendingCount} open
            </Badge>
          ) : null}
        </div>
        {open ? (
          <ChevronUp className={`size-4 ${panelAccentClassName}`} />
        ) : (
          <ChevronDown className={`size-4 ${panelAccentClassName}`} />
        )}
      </button>

      {open ? (
        <div className={`border-t ${panelBorderClassName} px-3 py-3`}>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading document questions...</p>
          ) : payload && payload.questions.length > 0 ? (
            <div className="space-y-4">
              <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Open the original file before answering if the question depends on wording, layout, sheet tabs, or other source details.
                </p>
                <SourceFileActions sourceFile={payload.sourceFile} compact />
              </div>

              {payload.review?.reviewFlags?.length ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Why this needs input</p>
                  <div className="flex flex-wrap gap-1.5">
                    {payload.review.reviewFlags.map((flag) => (
                      <Badge
                        key={flag}
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 border-yellow-400/30 text-yellow-400"
                      >
                        {flag}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              {payload.questions.map((question) => (
                <div key={question.key} className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    {question.label}
                    {question.required ? " *" : ""}
                  </Label>
                  <p className="text-[11px] text-muted-foreground">{question.prompt}</p>
                  {question.type === "select" ? (
                    <Select
                      value={answers[question.key] ?? ""}
                      onValueChange={(value) =>
                        setAnswers((current) => ({ ...current, [question.key]: value }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose an answer" />
                      </SelectTrigger>
                      <SelectContent>
                        {(question.options ?? []).map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={answers[question.key] ?? ""}
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [question.key]: event.target.value,
                        }))
                      }
                      placeholder={question.currentValue ?? ""}
                    />
                  )}
                </div>
              ))}

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={rememberTemplate}
                  onChange={(event) => setRememberTemplate(event.target.checked)}
                />
                Remember reusable answers for similar uploads from the same source folder
              </label>

              {payload.bulkApply?.available ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={applyToSimilar}
                    onChange={(event) => setApplyToSimilar(event.target.checked)}
                  />
                  Apply reusable answers to {payload.bulkApply.similarDocumentCount} similar document
                  {payload.bulkApply.similarDocumentCount === 1 ? "" : "s"} in this company
                </label>
              ) : null}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={handleSave}
                >
                  {saving ? "Saving..." : "Save answers & reprocess"}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  This re-runs parsing with your answers as context.
                </span>
              </div>
            </div>
          ) : payload?.review?.reviewFlags?.length ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                No user action is required. The document is already saved; these flags only tell Corpus to treat the evidence with extra caution.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {payload.review.reviewFlags.map((flag) => (
                  <Badge
                    key={flag}
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 border-yellow-400/30 text-yellow-400"
                  >
                    {flag}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SourceFileActions sourceFile={payload.sourceFile} compact />
                {onReprocess ? (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={reprocessing}
                    onClick={onReprocess}
                  >
                    <RotateCw className={`mr-1 size-3 ${reprocessing ? "animate-spin" : ""}`} />
                    Reprocess
                  </Button>
                ) : null}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Leave it as is unless the source, extracted data, or routing looks wrong. Use reprocess only to rerun extraction from the original file.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              This document is processed and saved. No user clarification is required right now.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Document Card ───────────────────────────────────────────────────────────

function DocumentCard({
  doc,
  onReviewed,
  isFocused = false,
}: {
  doc: DocumentRow;
  onReviewed: () => void;
  isFocused?: boolean;
}) {
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hasError = doc.status === "failed" && doc.error;
  const isReport = !!doc.documentType;
  const needsReview = doc.status === "needs_review";
  const canReprocess = !hasActiveProcessing(doc);
  const viewModel = buildDocumentCardViewModel(doc, locale);
  const showInlineQuestion = viewModel.tone === "needs_input";
  const showSuggestedQuestions = viewModel.suggestedQuestions.length > 0;

  useEffect(() => {
    if (!isFocused || !cardRef.current) return;
    cardRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [isFocused]);

  async function handleReprocess() {
    setReprocessing(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}/reprocess`, {
        method: "POST",
      });
      if (res.ok) {
        onReviewed();
      }
    } finally {
      setReprocessing(false);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `Delete "${doc.fileName}" from the system? This removes the uploaded file and any linked Company-DB records.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onReviewed();
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      id={`document-question-${doc.id}`}
      ref={cardRef}
      className={`p-3 rounded-lg border transition-colors ${
        needsReview
          ? "border-yellow-500/30 bg-yellow-500/5"
          : doc.status === "failed"
            ? "border-red-500/20 bg-red-500/5"
            : "border-border/50"
      } ${isFocused ? "ring-2 ring-blue-500/40 ring-offset-2 ring-offset-background" : ""}`}
    >
      {/* Top row: icon, name, status */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <FileIcon fileType={doc.fileType} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{doc.fileName}</p>
          </div>
          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
            <span className="text-[11px] text-muted-foreground">
              {formatDate(doc.createdAt)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {doc.fileType.toUpperCase()}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {doc.sourceContext?.provider ?? doc.source}
            </span>
            {isReport && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 text-blue-400 border-blue-400/30"
              >
                {formatDocType(doc.documentType)}
              </Badge>
            )}
            {doc.reportingPeriod && doc.reportingPeriod !== "Unknown" && (
              <span className="text-[11px] text-muted-foreground">
                {doc.reportingPeriod}
              </span>
            )}
            {doc.status === "completed" && doc.extractedTxnCount > 0 && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {doc.extractedTxnCount} transactions
              </span>
            )}
            {doc.promotion?.promotedDomains?.length ? (
              <span className="text-[11px] text-muted-foreground">
                {doc.promotion.promotedDomains.join(", ")}
              </span>
            ) : null}
            {doc.reviewRequired && !hasPendingUserClarification(doc) ? (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 text-yellow-400 border-yellow-400/30"
              >
                Confidence flags
              </Badge>
            ) : null}
          </div>
          {doc.sourceContext?.sourcePath ? (
            <p className="mt-1 text-[11px] text-muted-foreground truncate">
              Source: {doc.sourceContext.sourcePath}
            </p>
          ) : null}
          {doc.codex?.updatedAt ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Pipeline updated {formatDate(doc.codex.updatedAt)}
            </p>
          ) : null}
          {doc.audit?.auditSummary ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              QA: {doc.audit.auditSummary}
            </p>
          ) : null}
          <div
            className={`mt-3 rounded-lg border px-3 py-2 ${
              viewModel.tone === "ready"
                ? "border-emerald-500/20 bg-emerald-500/5"
                : viewModel.tone === "review"
                  ? "border-yellow-500/20 bg-yellow-500/5"
                : viewModel.tone === "needs_input"
                  ? "border-blue-500/20 bg-blue-500/5"
                  : viewModel.tone === "failed"
                    ? "border-red-500/20 bg-red-500/5"
                    : "border-border/60 bg-muted/20"
            }`}
          >
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">{viewModel.headline}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {viewModel.detail}
                </p>
              </div>
            </div>
            <DocumentStageTimeline stages={viewModel.stages} />
            {showSuggestedQuestions ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {viewModel.suggestedQuestions.map((question) => (
                  <Button key={question} asChild variant="outline" size="xs">
                    <Link
                      href={`/assistant?sourceDocumentId=${encodeURIComponent(doc.id)}&prompt=${encodeURIComponent(`${question}: ${doc.fileName}`)}`}
                    >
                      {question}
                    </Link>
                  </Button>
                ))}
              </div>
            ) : null}
            {showInlineQuestion ? (
              <p className="mt-2 text-[11px] text-blue-300">
                {locale === "ru"
                  ? "Ответьте на вопрос ниже, и Corpus перезапустит обработку с этим контекстом."
                  : locale === "id"
                    ? "Jawab pertanyaan di bawah, dan Corpus akan memproses ulang dengan konteks ini."
                    : "Answer the question below, and Corpus will rerun processing with this context."}
              </p>
            ) : null}
          </div>
          {doc.sourceFile ? (
            <div className="mt-2">
              <SourceFileActions sourceFile={doc.sourceFile} compact />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0 sm:max-w-[42%] sm:justify-end">
          {confidenceBadge(doc.confidenceScore)}
          {statusBadge(doc.status)}
          {codexStageBadge(doc)}
          {promotionBadge(doc)}
          {auditBadge(doc)}
          {canReprocess ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-blue-400"
              disabled={reprocessing || deleting}
              onClick={handleReprocess}
              title="Reprocess from original file"
            >
              <RotateCw className={`size-4 ${reprocessing ? "animate-spin" : ""}`} />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-red-400"
            disabled={deleting || reprocessing}
            onClick={handleDelete}
            title="Delete document"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Error message for failed documents */}
      {hasError && (
        <button
          className="flex items-center gap-1 mt-2 text-[11px] text-red-400 hover:text-red-300 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
          {expanded ? "Hide error" : "Show error"}
        </button>
      )}
      {hasError && expanded && (
        <div className="mt-1.5 p-2 rounded bg-red-500/10 border border-red-500/20">
          <p className="text-[11px] text-red-400 font-mono break-all">
            {doc.error}
          </p>
        </div>
      )}

      <ClarificationPanel
        doc={doc}
        onSaved={onReviewed}
        autoOpen={isFocused || showInlineQuestion}
        onReprocess={canReprocess ? handleReprocess : undefined}
        reprocessing={reprocessing}
      />
    </div>
  );
}

// ── Section 2: Document History ─────────────────────────────────────────────

function DocumentHistory({
  documents,
  onReviewed,
}: {
  documents: DocumentRow[];
  onReviewed: () => void;
}) {
  const history = documents
    .filter(shouldShowInDocumentHistory)
    .sort(compareDocumentHistoryItems);

  const attentionCount = history.filter(needsDocumentHistoryAttention).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-muted-foreground font-medium flex items-center gap-2">
          <FileText className="size-4" />
          Document History
          {attentionCount > 0 && (
            <Badge className="bg-yellow-500/15 text-yellow-400 border-0 text-[10px] px-1.5 py-0 ml-1">
              {attentionCount} needs attention
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No documents yet
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((doc) => (
              <DocumentCard
                key={doc.id}
                doc={doc}
                onReviewed={onReviewed}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function DocumentsView() {
  const searchParams = useSearchParams();
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(15000);
  const { data, isLoading, error, refetch } = useDocumentsData({
    refreshIntervalMs,
    limit: 50,
  });
  const documents = useMemo(
    () => (Array.isArray(data) ? (data as DocumentRow[]) : []),
    [data],
  );
  const focusedDocumentId = searchParams.get("doc");
  const hasDocuments = documents.length > 0;

  useEffect(() => {
    const nextInterval = documents.some(hasActiveProcessing) ? 5000 : 30000;
    const timeout = window.setTimeout(() => {
      setRefreshIntervalMs((current) =>
        current === nextInterval ? current : nextInterval,
      );
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [documents]);

  function handleUploaded(results: Array<{ status: "success" | "error" }>) {
    if (results.some((result) => result.status === "success")) {
      setRefreshIntervalMs(5000);
      refetch();
    }
  }

  if (isLoading) {
    return <ViewSkeleton variant="list" />;
  }

  if (error && !hasDocuments) {
    return (
      <div className="space-y-4">
        <CodexAuthStatusNotice />
        <UploadZone onUploaded={handleUploaded} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Documents unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The document feed failed to load, so this view cannot confirm upload or processing status.
            </p>
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
            <Button variant="outline" onClick={refetch}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasDocuments) {
    return (
      <div className="space-y-4">
        <CodexAuthStatusNotice />
        <UploadZone onUploaded={handleUploaded} />
        <EmptyState
          icon={FileText}
          title="No documents uploaded"
          description="Upload any business document here or open integrations for connector-based imports. Processing status and extraction progress will appear on this page."
          actionLabel="Open integrations"
          actionHref="/integrations"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CodexAuthStatusNotice />
      <UploadZone onUploaded={handleUploaded} />
      {error ? (
        <Card>
          <CardContent className="pt-6">
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
              Live refresh hit an error: {error}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <ProcessingQueue documents={documents} />
      <ClarificationQueue
        documents={documents}
        onReviewed={refetch}
        focusedDocumentId={focusedDocumentId}
      />
      <DocumentHistory documents={documents} onReviewed={refetch} />
    </div>
  );
}
