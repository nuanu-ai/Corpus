import { createHash } from "node:crypto";

import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import * as XLSX from "xlsx";

import { createReportAnswerQualityLog } from "@/lib/advisor-quality/report-answer-log";
import type { EntityResult } from "@/lib/company-db/client";
import type {
  ReportFinanceBreakdownRow,
  ReportFinanceSnapshot,
} from "@/lib/report-jobs/odoo-finance";
import type { ReportSourceEvidenceSnapshot } from "@/lib/report-jobs/source-evidence";
import type { ReportIntent } from "@/lib/report-jobs/types";

export interface ReportArtifactPayload {
  kind: string;
  fileName: string;
  mimeType: string;
  metadata: Record<string, unknown>;
}

function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function buildBaseFileName(intent: ReportIntent): string {
  const period = intent.period.label.length > 0 ? slugifySegment(intent.period.label) : "reporting-period";
  const subject = slugifySegment(intent.subject);
  return `${subject || "report"}-${period || "period"}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function sourceStatusLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractPackDeliveryIdempotencyKey(packs: unknown[] | undefined): string | null {
  for (const pack of packs ?? []) {
    const delivery = asRecord(asRecord(pack)?.delivery);
    const idempotencyKey = delivery?.idempotencyKey;
    if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) return idempotencyKey;
  }
  return null;
}

function extractPackRenderedText(packs: unknown[] | undefined): string | null {
  for (const pack of packs ?? []) {
    const artifact = asRecord(asRecord(pack)?.artifact);
    const renderedText = artifact?.renderedText;
    if (typeof renderedText === "string" && renderedText.length > 0) return renderedText;
  }
  return null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSourceUnavailable(
  sourceEvidence: ReportSourceEvidenceSnapshot | undefined,
  sourceId: string,
): boolean {
  const source = sourceEvidence?.sources.find((item) => item.source === sourceId);
  return source?.status === "unavailable" || source?.status === "failed";
}

function buildSourceAvailabilitySection(
  sourceEvidence: ReportSourceEvidenceSnapshot | undefined,
): string[] {
  if (!sourceEvidence) return [];
  const lines = [
    "## Source availability",
    "",
    `- Sources: ${sourceEvidence.summary.availableSources} available, ${sourceEvidence.summary.partialSources} partial, ${sourceEvidence.summary.unavailableSources} unavailable, ${sourceEvidence.summary.failedSources} failed.`,
  ];
  for (const source of sourceEvidence.sources) {
    const details = [
      source.reason,
      source.error ? `Error: ${source.error}` : null,
      source.unavailableWording,
      source.refs.length > 0 ? `Evidence refs: ${source.refs.length}` : null,
    ].filter((value): value is string => Boolean(value));
    lines.push(
      `- ${source.label}: ${sourceStatusLabel(source.status)}${details.length > 0 ? ` - ${details.join(" ")}` : ""}`,
    );
  }
  return lines;
}

function buildMarkdownContent(input: {
  intent: ReportIntent;
  finance: ReportFinanceSnapshot;
  warnings: string[];
  companyDbEvidence: EntityResult[];
  sourceEvidence?: ReportSourceEvidenceSnapshot;
}): string {
  const { intent, finance, warnings, companyDbEvidence, sourceEvidence } = input;
  const title = `${intent.subject} report for ${intent.period.label}`;
  const odooUnavailable = isSourceUnavailable(sourceEvidence, "odoo");
  const summaryLines = [
    `- Report family: ${intent.reportFamily}`,
    `- Period: ${intent.period.label} (${intent.period.startDate ?? "?"} to ${intent.period.endDate ?? "?"}, ${intent.period.timezone ?? "UTC"})`,
    odooUnavailable
      ? "- Revenue total: unavailable because Odoo source collection failed or was unavailable."
      : `- Revenue total: ${finance.totals.currency ?? ""} ${formatNumber(finance.totals.revenueTotal)}`.trim(),
    odooUnavailable
      ? "- Expense total: unavailable because Odoo source collection failed or was unavailable."
      : `- Expense total: ${finance.totals.currency ?? ""} ${formatNumber(finance.totals.expenseTotal)}`.trim(),
    odooUnavailable
      ? "- Net total: unavailable because Odoo source collection failed or was unavailable."
      : `- Net total: ${finance.totals.currency ?? ""} ${formatNumber(finance.totals.netTotal)}`.trim(),
    odooUnavailable
      ? "- Revenue documents: unavailable"
      : `- Revenue documents: ${finance.totals.revenueCount}`,
    odooUnavailable
      ? "- Expense documents: unavailable"
      : `- Expense documents: ${finance.totals.expenseCount}`,
    ...(finance.breakdowns.length > 0
      ? [`- Segmentation: ${[...new Set(finance.breakdowns.map((row) => row.dimension))].join(", ")}`]
      : []),
  ];

  const evidenceRows = finance.rows
    .slice(0, 20)
    .map(
      (row) =>
        `| ${row.sourceType} | ${row.invoiceDate ?? ""} | ${row.name} | ${row.partnerName ?? ""} | ${row.currency ?? ""} ${formatNumber(row.grossAmount)} |`,
    );
  if (evidenceRows.length === 0 && odooUnavailable) {
    evidenceRows.push("| unavailable |  | Odoo finance source unavailable; not zero |  | unavailable |");
  }

  const companyDbRows = companyDbEvidence.map(
    (entity) => `- ${entity.qualifiedId}${entity.title ? ` — ${entity.title}` : ""}`,
  );
  const breakdownSection = buildMarkdownBreakdowns(finance.breakdowns);

  return [
    `# ${title}`,
    "",
    "## Request",
    "",
    intent.request,
    "",
    "## Summary",
    "",
    ...summaryLines,
    "",
    ...buildSourceAvailabilitySection(sourceEvidence),
    sourceEvidence ? "" : null,
    warnings.length > 0 ? "## Warnings" : null,
    warnings.length > 0 ? "" : null,
    ...(warnings.length > 0 ? warnings.map((warning) => `- ${warning}`) : []),
    warnings.length > 0 ? "" : null,
    "## Sample Odoo evidence",
    "",
    "| Source | Date | Record | Counterparty | Amount |",
    "| --- | --- | --- | --- | --- |",
    ...evidenceRows,
    "",
    ...breakdownSection,
    ...(breakdownSection.length > 0 ? [""] : []),
    "## Company-DB cross-check",
    "",
    ...(companyDbRows.length > 0 ? companyDbRows : ["- No Company-DB finance evidence was returned for the cross-check query."]),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function buildMarkdownBreakdowns(breakdowns: ReportFinanceBreakdownRow[]): string[] {
  if (breakdowns.length === 0) return [];

  const lines: string[] = ["## Segment breakdown", ""];
  for (const dimension of [...new Set(breakdowns.map((row) => row.dimension))]) {
    const rows = breakdowns.filter((row) => row.dimension === dimension);
    lines.push(`### ${dimension}`);
    lines.push("");
    lines.push("| Segment | Revenue | Expense | Net | Revenue rows | Expense rows |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const row of rows) {
      lines.push(
        `| ${row.value} | ${formatNumber(row.revenueTotal)} | ${formatNumber(row.expenseTotal)} | ${formatNumber(row.netTotal)} | ${row.revenueCount} | ${row.expenseCount} |`,
      );
    }
    lines.push("");
  }
  return lines;
}

function workbookToBase64(workbook: XLSX.WorkBook): string {
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buffer).toString("base64");
}

function docxHeadingLevel(line: string) {
  if (line.startsWith("# ")) return HeadingLevel.TITLE;
  if (line.startsWith("## ")) return HeadingLevel.HEADING_1;
  if (line.startsWith("### ")) return HeadingLevel.HEADING_2;
  return null;
}

function stripMarkdownPrefix(line: string): string {
  return line
    .replace(/^###\s+/, "")
    .replace(/^##\s+/, "")
    .replace(/^#\s+/, "")
    .replace(/^-\s+/, "");
}

function markdownToDocxParagraphs(markdownContent: string): Paragraph[] {
  return markdownContent.split("\n").map((line) => {
    const heading = docxHeadingLevel(line);
    const isBullet = line.startsWith("- ");
    const text = stripMarkdownPrefix(line);
    return new Paragraph({
      ...(heading ? { heading } : {}),
      ...(isBullet ? { bullet: { level: 0 } } : {}),
      children: [
        new TextRun({
          text,
          bold: heading !== null,
        }),
      ],
      spacing: { after: heading ? 160 : 80 },
    });
  });
}

async function markdownToDocxBase64(markdownContent: string): Promise<string> {
  const document = new Document({
    sections: [
      {
        properties: {},
        children: markdownToDocxParagraphs(markdownContent),
      },
    ],
  });
  const buffer = await Packer.toBuffer(document);
  return Buffer.from(buffer).toString("base64");
}

function buildArtifactSourceEvidenceGraph(sourceEvidence: ReportSourceEvidenceSnapshot | undefined) {
  if (!sourceEvidence) return undefined;
  return {
    version: sourceEvidence.version,
    generatedAt: sourceEvidence.generatedAt,
    summary: sourceEvidence.summary,
    sources: sourceEvidence.sources.map((source) => ({
      source: source.source,
      status: source.status,
      label: source.label,
      reason: source.reason ?? null,
      error: source.error ?? null,
      freshness: source.freshness,
      window: source.window,
      counts: source.counts,
      idempotencyKey: typeof source.metadata.idempotencyKey === "string"
        ? source.metadata.idempotencyKey
        : null,
      zeroValuePolicy: source.zeroValuePolicy ?? null,
      unavailableWording: source.unavailableWording ?? null,
      truncated: source.truncated,
      refs: source.refs.map((ref) => ({
        id: ref.id,
        source: ref.source,
        title: ref.title ?? null,
        url: ref.url ?? null,
        recordType: ref.recordType ?? null,
        observedAt: ref.observedAt ?? null,
      })),
    })),
  };
}

function buildXlsxArtifact(input: {
  intent: ReportIntent;
  finance: ReportFinanceSnapshot;
  warnings: string[];
  sourceEvidence?: ReportSourceEvidenceSnapshot;
  reportJobId?: string;
  routineRunId?: string | null;
  operatingReportPacks?: unknown[];
  weeklyOperatingReportPacks?: unknown[];
}): ReportArtifactPayload {
  const workbook = XLSX.utils.book_new();
  const odooUnavailable = isSourceUnavailable(input.sourceEvidence, "odoo");
  const summaryRows = [
    { metric: "report_family", value: input.intent.reportFamily },
    { metric: "subject", value: input.intent.subject },
    { metric: "period_label", value: input.intent.period.label },
    { metric: "period_start", value: input.intent.period.startDate ?? "" },
    { metric: "period_end", value: input.intent.period.endDate ?? "" },
    { metric: "currency", value: input.finance.totals.currency ?? "" },
    { metric: "revenue_total", value: odooUnavailable ? "unavailable" : input.finance.totals.revenueTotal },
    { metric: "expense_total", value: odooUnavailable ? "unavailable" : input.finance.totals.expenseTotal },
    { metric: "net_total", value: odooUnavailable ? "unavailable" : input.finance.totals.netTotal },
    { metric: "revenue_count", value: odooUnavailable ? "unavailable" : input.finance.totals.revenueCount },
    { metric: "expense_count", value: odooUnavailable ? "unavailable" : input.finance.totals.expenseCount },
  ];
  const evidenceRows = input.finance.rows.map((row) => ({
    source_type: row.sourceType,
    move_type: row.moveType,
    invoice_date: row.invoiceDate ?? "",
    record_name: row.name,
    partner_name: row.partnerName ?? "",
    account_name: row.accountName ?? "",
    account_type: row.accountType ?? "",
    venue: row.dimensionValues?.venue ?? "",
    department: row.dimensionValues?.department ?? "",
    currency: row.currency ?? "",
    gross_amount: row.grossAmount,
    untaxed_amount: row.untaxedAmount,
    tax_amount: row.taxAmount,
    payment_state: row.paymentState ?? "",
    reference: row.reference ?? "",
  }));
  const breakdownRows = input.finance.breakdowns.map((row) => ({
    dimension: row.dimension,
    segment: row.value,
    revenue_total: row.revenueTotal,
    expense_total: row.expenseTotal,
    net_total: row.netTotal,
    revenue_count: row.revenueCount,
    expense_count: row.expenseCount,
  }));
  const warningsRows = input.warnings.map((warning) => ({ warning }));
  const sourceRows = input.sourceEvidence?.sources.map((source) => ({
    source: source.source,
    label: source.label,
    status: source.status,
    reason: source.reason ?? "",
    error: source.error ?? "",
    unavailable_wording: source.unavailableWording ?? "",
    evidence_ref_count: source.refs.length,
  })) ?? [];

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sourceRows), "SourceAvailability");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(evidenceRows), "OdooEvidence");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(breakdownRows), "Breakdown");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(warningsRows), "Warnings");

  return {
    kind: "xlsx",
    fileName: `${buildBaseFileName(input.intent)}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    metadata: {
      base64Content: workbookToBase64(workbook),
      previewable: false,
      period: buildArtifactPeriodContract(input.intent),
      delivery: buildArtifactDeliveryContract(input),
      worker: buildArtifactWorkerContract(input),
      sourceEvidence: input.sourceEvidence?.summary,
      sourceEvidenceGraph: buildArtifactSourceEvidenceGraph(input.sourceEvidence),
    },
  };
}

async function buildDocxArtifact(input: {
  intent: ReportIntent;
  markdownContent: string;
  sourceEvidence?: ReportSourceEvidenceSnapshot;
  reportJobId?: string;
  routineRunId?: string | null;
  operatingReportPacks?: unknown[];
  weeklyOperatingReportPacks?: unknown[];
}): Promise<ReportArtifactPayload> {
  const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return {
    kind: "docx",
    fileName: `${buildBaseFileName(input.intent)}.docx`,
    mimeType,
    metadata: {
      base64Content: await markdownToDocxBase64(input.markdownContent),
      previewable: false,
      period: buildArtifactPeriodContract(input.intent),
      delivery: buildArtifactDeliveryContract(input),
      worker: buildArtifactWorkerContract(input),
      sourceEvidence: input.sourceEvidence?.summary,
      sourceEvidenceGraph: buildArtifactSourceEvidenceGraph(input.sourceEvidence),
      answerQualityLog: createReportAnswerQualityLog({
        intent: input.intent,
        answerText: input.markdownContent,
        artifactKind: "docx",
        mimeType,
        sourceEvidence: input.sourceEvidence,
        reportJobId: input.reportJobId,
        routineRunId: input.routineRunId,
      }),
    },
  };
}

function buildArtifactPeriodContract(intent: ReportIntent) {
  return {
    kind: intent.period.kind,
    label: intent.period.label,
    startDate: intent.period.startDate ?? null,
    endDate: intent.period.endDate ?? null,
    timezone: intent.period.timezone ?? "UTC",
    preset: intent.period.preset ?? null,
    anchorDate: intent.period.anchorDate ?? null,
  };
}

function buildArtifactDeliveryContract(input: {
  intent: ReportIntent;
  reportJobId?: string;
  routineRunId?: string | null;
  operatingReportPacks?: unknown[];
  weeklyOperatingReportPacks?: unknown[];
}) {
  const sourcePacks = [
    ...(input.weeklyOperatingReportPacks ?? []),
    ...(input.operatingReportPacks ?? []),
  ];
  const renderedPayload = extractPackRenderedText(sourcePacks);
  const fallbackKey = [
    "report-job-artifact",
    input.reportJobId ?? "unassigned",
    input.routineRunId ?? "manual",
    input.intent.companyId,
    input.intent.period.startDate ?? input.intent.period.label,
    input.intent.period.endDate ?? input.intent.period.label,
  ].join(":");

  return {
    channel: "artifact",
    mode: "disabled",
    reason: "Report automation delivery is disabled until an explicit delivery adapter is enabled.",
    idempotencyKey: extractPackDeliveryIdempotencyKey(sourcePacks) ?? fallbackKey,
    recipientCount: 0,
    recipients: [],
    deliveryIds: [],
    statusSummary: "not_sent",
    payloadHash: renderedPayload ? sha256(renderedPayload) : null,
    payloadPreview: renderedPayload ? renderedPayload.slice(0, 4000) : null,
    payloadTruncated: renderedPayload ? renderedPayload.length > 4000 : false,
  };
}

function buildArtifactWorkerContract(input: {
  reportJobId?: string;
  routineRunId?: string | null;
}) {
  return {
    status: "completed",
    renderStatus: "completed",
    reportJobId: input.reportJobId ?? null,
    routineRunId: input.routineRunId ?? null,
  };
}

export async function renderReportArtifacts(input: {
  intent: ReportIntent;
  finance: ReportFinanceSnapshot;
  warnings: string[];
  companyDbEvidence: EntityResult[];
  sourceEvidence?: ReportSourceEvidenceSnapshot;
  reportJobId?: string;
  routineRunId?: string | null;
  operatingReportPacks?: unknown[];
  weeklyOperatingReportPacks?: unknown[];
}): Promise<ReportArtifactPayload[]> {
  const artifacts: ReportArtifactPayload[] = [];
  const markdownContent = buildMarkdownContent(input);
  const markdownMimeType = "text/markdown; charset=utf-8";
  artifacts.push({
    kind: "markdown",
    fileName: `${buildBaseFileName(input.intent)}.md`,
    mimeType: markdownMimeType,
    metadata: {
      textContent: markdownContent,
      previewable: true,
      period: buildArtifactPeriodContract(input.intent),
      delivery: buildArtifactDeliveryContract(input),
      worker: buildArtifactWorkerContract(input),
      sourceEvidence: input.sourceEvidence?.summary,
      sourceEvidenceGraph: buildArtifactSourceEvidenceGraph(input.sourceEvidence),
      ...(input.operatingReportPacks?.length
        ? { operatingReportPacks: input.operatingReportPacks }
        : {}),
      ...(input.weeklyOperatingReportPacks?.length
        ? { weeklyOperatingReportPacks: input.weeklyOperatingReportPacks }
        : {}),
      answerQualityLog: createReportAnswerQualityLog({
        intent: input.intent,
        answerText: markdownContent,
        artifactKind: "markdown",
        mimeType: markdownMimeType,
        sourceEvidence: input.sourceEvidence,
        reportJobId: input.reportJobId,
        routineRunId: input.routineRunId,
      }),
    },
  });

  if (input.intent.outputFormat === "xlsx") {
    artifacts.push(buildXlsxArtifact(input));
  }
  if (input.intent.outputFormat === "docx") {
    artifacts.push(await buildDocxArtifact({
      ...input,
      markdownContent,
    }));
  }

  return artifacts;
}
