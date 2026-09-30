import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";

import { toQmd } from "../company-db/summary/qmd";
import { buildCodexBundleRoute } from "./router";
import {
  CODEX_DOCUMENT_KINDS,
  CODEX_TARGET_DOMAINS,
  type CodexAgentOutput,
  type CodexAgentUnitOutput,
  type CodexAnomaly,
  type CodexArtifactManifest,
  type CodexBundleFile,
  type CodexGeneratedBundle,
  type CodexIngestionRecommendation,
  type CodexNormalizedMetadata,
  type CodexToplineFinding,
  type CodexTargetDomain,
} from "./types";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "import";
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function writeText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf8");
}

function unitTitle(unitTitleText: string, fallbackSlug: string): string {
  return unitTitleText.trim().length > 0 ? unitTitleText.trim() : fallbackSlug;
}

function isConfidence(value: unknown): value is "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high";
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string or null.`);
  }
  return value;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value;
}

const ENGLISH_STOPWORDS = new Set<string>([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

const INDONESIAN_STOPWORDS = new Set<string>([
  "adalah",
  "atau",
  "bahwa",
  "bagi",
  "dalam",
  "dan",
  "dari",
  "dengan",
  "di",
  "ini",
  "itu",
  "juga",
  "karena",
  "ke",
  "kepada",
  "oleh",
  "pada",
  "sebagai",
  "serta",
  "tidak",
  "untuk",
  "yang",
]);

function normalizeSourceLanguage(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;

  const isMixed = /\bmix(?:ed)?\b/.test(normalized);

  if (/\b(id|indonesian|bahasa indonesia|bahasa)\b/.test(normalized)) {
    return isMixed ? "mixed-id" : "id";
  }
  if (/\b(en|english)\b/.test(normalized)) {
    return isMixed ? "mixed-en" : "en";
  }
  if (/\b(ru|russian|cyrillic)\b/.test(normalized)) {
    return isMixed ? "mixed-ru" : "ru";
  }
  if (isMixed) return "mixed";
  if (/^[a-z]{2}(?:-[a-z]{2})?$/.test(normalized)) return normalized;

  return normalized.replace(/\s+/g, "-").slice(0, 32);
}

function countStopwordHits(tokens: string[], dictionary: Set<string>): number {
  let hits = 0;
  for (const token of tokens) {
    if (dictionary.has(token)) hits += 1;
  }
  return hits;
}

function validateNormalizedMetadata(value: unknown): CodexNormalizedMetadata {
  const metadata = requireRecord(value, "Codex output normalized_metadata");
  const sourceLanguage = normalizeSourceLanguage(
    requireNullableString(
      metadata.source_language,
      "Codex normalized_metadata.source_language",
    ),
  );
  return {
    report_type: requireNullableString(metadata.report_type, "Codex normalized_metadata.report_type"),
    book: requireNullableString(metadata.book, "Codex normalized_metadata.book"),
    currency: requireNullableString(metadata.currency, "Codex normalized_metadata.currency"),
    entity: requireNullableString(metadata.entity, "Codex normalized_metadata.entity"),
    sheet_name: requireNullableString(metadata.sheet_name, "Codex normalized_metadata.sheet_name"),
    period_start: requireNullableString(
      metadata.period_start,
      "Codex normalized_metadata.period_start",
    ),
    period_end: requireNullableString(metadata.period_end, "Codex normalized_metadata.period_end"),
    period_label: requireNullableString(
      metadata.period_label,
      "Codex normalized_metadata.period_label",
    ),
    company_names_detected: requireStringArray(
      metadata.company_names_detected,
      "Codex normalized_metadata.company_names_detected",
    ),
    source_language: sourceLanguage,
  };
}

function validateToplineFindings(value: unknown): CodexToplineFinding[] {
  if (!Array.isArray(value)) {
    throw new Error("Codex output topline_findings must be an array.");
  }
  return value.map((item, index) => {
    const finding = requireRecord(item, `Codex topline_findings[${index}]`);
    return {
      label: requireString(finding.label, `Codex topline_findings[${index}].label`),
      value: requireString(finding.value, `Codex topline_findings[${index}].value`),
      evidence: requireString(finding.evidence, `Codex topline_findings[${index}].evidence`),
    };
  });
}

function validateAnomalies(value: unknown): CodexAnomaly[] {
  if (!Array.isArray(value)) {
    throw new Error("Codex output anomalies must be an array.");
  }
  return value.map((item, index) => {
    const anomaly = requireRecord(item, `Codex anomalies[${index}]`);
    if (!isConfidence(anomaly.severity)) {
      throw new Error(`Codex anomalies[${index}].severity is invalid.`);
    }
    return {
      severity: anomaly.severity,
      issue: requireString(anomaly.issue, `Codex anomalies[${index}].issue`),
      impact: requireString(anomaly.impact, `Codex anomalies[${index}].impact`),
      evidence: requireString(anomaly.evidence, `Codex anomalies[${index}].evidence`),
    };
  });
}

function validateIngestionRecommendation(value: unknown): CodexIngestionRecommendation {
  const recommendation = requireRecord(value, "Codex output ingestion_recommendation");
  const mode = recommendation.mode;
  if (
    mode !== "auto_ingest" &&
    mode !== "needs_review" &&
    mode !== "knowledge_only" &&
    mode !== "reject"
  ) {
    throw new Error("Codex output ingestion_recommendation.mode is invalid.");
  }
  return {
    mode,
    reason: requireString(recommendation.reason, "Codex ingestion_recommendation.reason"),
  };
}

function renderBullets(title: string, values: string[]): string[] {
  if (values.length === 0) return [];
  return [title, ...values.map((value) => `- ${value}`), ""];
}

function renderMetadata(metadata: CodexNormalizedMetadata): string[] {
  const rows = [
    ["Report Type", metadata.report_type],
    ["Book", metadata.book],
    ["Currency", metadata.currency],
    ["Entity", metadata.entity],
    ["Sheet Name", metadata.sheet_name],
    ["Period Start", metadata.period_start],
    ["Period End", metadata.period_end],
    ["Period Label", metadata.period_label],
    ["Source Language", metadata.source_language],
    [
      "Company Names Detected",
      metadata.company_names_detected.length > 0 ? metadata.company_names_detected.join(", ") : null,
    ],
  ] as Array<[string, string | null]>;

  const filteredRows = rows.filter(([, value]) => value && value.trim().length > 0);

  if (filteredRows.length === 0) return [];

  return [
    "## Normalized Metadata",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...filteredRows.map(([label, value]) => `| ${label} | ${value} |`),
    "",
  ];
}

function renderToplineFindings(findings: CodexToplineFinding[]): string[] {
  if (findings.length === 0) return [];
  return [
    "## Topline Findings",
    "",
    ...findings.flatMap((finding) => [
      `- **${finding.label}:** ${finding.value}`,
      `  - Evidence: ${finding.evidence}`,
    ]),
    "",
  ];
}

function renderAnomalyList(anomalies: CodexAnomaly[]): string[] {
  if (anomalies.length === 0) return [];
  return [
    "## Anomalies",
    "",
    ...anomalies.flatMap((anomaly) => [
      `- **${anomaly.severity.toUpperCase()}** ${anomaly.issue}`,
      `  - Impact: ${anomaly.impact}`,
      `  - Evidence: ${anomaly.evidence}`,
    ]),
    "",
  ];
}

function buildIndexBody(output: CodexAgentOutput, targetDomain: string): string {
  return [
    output.index_markdown.trim(),
    "",
    "## Routing Decision",
    "",
    `- Target domain: ${targetDomain}`,
    `- Target entity type: ${output.target_entity_type}`,
    `- Routing confidence: ${output.routing_confidence}`,
    `- Requires review: ${output.requires_review ? "yes" : "no"}`,
    "",
    ...renderBullets("### Routing Reasons", output.routing_reasons),
    ...renderBullets("### Review Flags", output.review_flags),
    "## Document Summary",
    "",
    output.document_summary.trim(),
    "",
    "## Executive Summary",
    "",
    output.executive_summary.trim(),
    "",
    ...renderMetadata(output.normalized_metadata),
    ...renderToplineFindings(output.topline_findings),
    ...renderAnomalyList(output.anomalies),
    ...renderBullets("## Key Themes", output.key_themes),
    ...renderBullets("## Risks", output.risks),
    ...renderBullets("## Assumptions", output.assumptions),
    "## Ingestion Recommendation",
    "",
    `- Mode: ${output.ingestion_recommendation.mode}`,
    `- Reason: ${output.ingestion_recommendation.reason}`,
    "",
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n")
    .trim();
}

function buildUnitBody(unit: CodexAgentUnitOutput): string {
  return [
    unit.markdown.trim(),
    "",
    ...(unit.candidate_role ? ["## Candidate Role", "", unit.candidate_role, ""] : []),
    ...renderBullets("## Key Figures", unit.key_figures),
    ...renderBullets("## Risks", unit.risks),
    ...renderBullets("## Assumptions", unit.assumptions),
    ...renderBullets("## Evidence", unit.evidence),
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n")
    .trim();
}

function addReviewFlag(output: CodexAgentOutput, flag: string): void {
  if (!output.review_flags.includes(flag)) {
    output.review_flags.push(flag);
  }
  output.requires_review = true;
}

const READABLE_PDF_FALSE_NEGATIVE_FLAGS = new Set([
  "extraction_failed",
  "artifact_extraction_failed",
  "extractor_failed",
  "manual_text_recovery",
  "manual_pdf_review_needed",
  "ocr_failed",
  "ocr_extraction_failed",
  "image_only_pdf",
  "ocr_like_text_recovery",
  "sparse_artifacts",
  "sparse_generated_artifacts",
]);

function isMachineReadablePdfManifest(manifest: CodexArtifactManifest): boolean {
  if (manifest.fileType !== "pdf") return false;
  if (manifest.notes.some((note) => /failed|did not produce page-level content/i.test(note))) {
    return false;
  }

  const pageCharCounts = manifest.units
    .filter((unit) => unit.unitKind === "page")
    .map((unit) => {
      const value = unit.metadata?.char_count;
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    })
    .filter((value) => value > 0);

  if (pageCharCounts.length === 0) return false;

  const totalChars = pageCharCounts.reduce((sum, value) => sum + value, 0);
  const maxChars = Math.max(...pageCharCounts);
  return totalChars >= 600 && maxChars >= 120;
}

function hasRecoveredLegalPdfSignal(
  output: CodexAgentOutput,
  manifest: CodexArtifactManifest,
): boolean {
  if (manifest.fileType !== "pdf") return false;
  if (
    output.target_domain !== "legal" &&
    output.document_kind !== "legal_document" &&
    output.document_kind !== "license_document"
  ) {
    return false;
  }

  const hasFallbackFileUnit = manifest.units.some((unit) => unit.unitKind === "file");
  if (!hasFallbackFileUnit) return false;

  const evidenceCorpus = [
    ...output.units.flatMap((unit) => unit.evidence),
    ...output.topline_findings.map((item) => item.evidence),
    ...output.anomalies.map((item) => item.evidence),
    ...output.routing_reasons,
    ...output.assumptions,
    output.document_summary,
    output.executive_summary,
  ].join("\n");

  const referencesOriginalPdf =
    /pdf asli halaman|original pdf page|original pdf|source pdf|(?:^|\b)hal(?:aman|\.)?\s*\d+\b|(?:^|\b)page\s+\d+\b/i.test(
      evidenceCorpus,
    );

  const keyFigureCount =
    output.units.reduce((total, unit) => total + unit.key_figures.length, 0) +
    output.topline_findings.length;

  const hasStructuredIdentity =
    Boolean(output.normalized_metadata.entity) ||
    output.normalized_metadata.company_names_detected.length > 0 ||
    output.normalized_metadata.period_label !== null;

  const hasLegalRole = output.units.some((unit) => {
    const role = unit.candidate_role?.trim().toLowerCase();
    if (!role) return false;
    return /izin|license|permit|certificate|registration|akta|nib|kbli|legal/.test(role);
  });

  return referencesOriginalPdf && (keyFigureCount >= 2 || hasStructuredIdentity || hasLegalRole);
}

function hasPageUnitAnalysisSignal(output: CodexAgentOutput): boolean {
  const pageUnits = output.units.filter((unit) => unit.unit_kind === "page");
  if (pageUnits.length === 0) return false;
  return true;
}

function sanitizeReadablePdfReviewFlags(
  output: CodexAgentOutput,
  manifest: CodexArtifactManifest,
): void {
  if (
    !isMachineReadablePdfManifest(manifest) &&
    !hasRecoveredLegalPdfSignal(output, manifest) &&
    !hasPageUnitAnalysisSignal(output)
  ) {
    return;
  }

  const nextFlags = output.review_flags.filter(
    (flag) => !READABLE_PDF_FALSE_NEGATIVE_FLAGS.has(flag),
  );
  if (nextFlags.length === output.review_flags.length) return;

  output.review_flags = nextFlags;

  if (
    output.requires_review &&
    nextFlags.length === 0 &&
    output.ingestion_recommendation.mode === "auto_ingest" &&
    output.overall_confidence !== "low"
  ) {
    output.requires_review = false;
  }
}

function assertNarrativeLanguageConsistency(output: CodexAgentOutput): void {
  const sourceLanguage = normalizeSourceLanguage(output.normalized_metadata.source_language);
  if (!sourceLanguage) return;

  const expectsCyrillic = sourceLanguage === "ru" || sourceLanguage === "mixed-ru";
  const narrativeCorpus = [
    output.document_summary,
    output.executive_summary,
    output.index_markdown,
    ...output.routing_reasons,
    ...output.key_themes,
    ...output.risks,
    ...output.assumptions,
    output.ingestion_recommendation.reason,
    ...output.topline_findings.flatMap((item) => [item.label, item.value, item.evidence]),
    ...output.anomalies.flatMap((item) => [item.issue, item.impact, item.evidence]),
    ...output.units.map((unit) => unit.markdown),
  ].join("\n");

  const lettersCount = (narrativeCorpus.match(/\p{L}/gu) ?? []).length;
  if (lettersCount === 0) return;
  const cyrillicCount = (narrativeCorpus.match(/[\u0400-\u04FF]/g) ?? []).length;
  const cyrillicRatio = cyrillicCount / lettersCount;

  if (!expectsCyrillic && cyrillicRatio > 0.12) {
    throw new Error(
      `Codex output language mismatch: source_language=${output.normalized_metadata.source_language}, cyrillic_ratio=${cyrillicRatio.toFixed(
        3,
      )}`,
    );
  }

  if (sourceLanguage.startsWith("mixed")) return;

  const latinTokens = narrativeCorpus.toLowerCase().match(/[a-z]+/g) ?? [];
  if (latinTokens.length < 80) return;

  const englishRatio = countStopwordHits(latinTokens, ENGLISH_STOPWORDS) / latinTokens.length;
  const indonesianRatio = countStopwordHits(latinTokens, INDONESIAN_STOPWORDS) / latinTokens.length;

  if (sourceLanguage === "id" && englishRatio >= 0.09 && englishRatio >= indonesianRatio * 1.6) {
    addReviewFlag(output, "language_mismatch_review_required");
    output.risks = Array.from(
      new Set([
        ...output.risks,
        `Narrative language skews English while source metadata is Indonesian (english_ratio=${englishRatio.toFixed(
          3,
        )}, indonesian_ratio=${indonesianRatio.toFixed(3)}).`,
      ]),
    );
    return;
  }

  if (sourceLanguage === "en" && indonesianRatio >= 0.09 && indonesianRatio >= englishRatio * 1.6) {
    addReviewFlag(output, "language_mismatch_review_required");
    output.risks = Array.from(
      new Set([
        ...output.risks,
        `Narrative language skews Indonesian while source metadata is English (indonesian_ratio=${indonesianRatio.toFixed(
          3,
        )}, english_ratio=${englishRatio.toFixed(3)}).`,
      ]),
    );
  }
}

function localBundlePath(filePath: string, importRootPath: string): string {
  const prefix = `${importRootPath}/`;
  if (filePath.startsWith(prefix)) {
    return join("company-db", filePath.slice(prefix.length));
  }
  return join("company-db", slugify(filePath));
}

export interface CodexReviewSummaryInput {
  documentKind: CodexAgentOutput["document_kind"];
  targetDomain: CodexTargetDomain;
  rawTargetDomain?: CodexTargetDomain;
  requiresReview: boolean;
  reviewFlags: string[];
  overallConfidence: CodexAgentOutput["overall_confidence"];
  normalizedMetadata: CodexNormalizedMetadata;
  ingestionMode: CodexIngestionRecommendation["mode"];
  ingestionReason: string;
}

export function buildCodexReviewSummaryInput(
  output: CodexAgentOutput,
  routedDomain: CodexTargetDomain,
): CodexReviewSummaryInput {
  return {
    documentKind: output.document_kind,
    targetDomain: routedDomain,
    rawTargetDomain: output.target_domain === routedDomain ? undefined : output.target_domain,
    requiresReview: output.requires_review,
    reviewFlags: output.review_flags,
    overallConfidence: output.overall_confidence,
    normalizedMetadata: output.normalized_metadata,
    ingestionMode: output.ingestion_recommendation.mode,
    ingestionReason: output.ingestion_recommendation.reason,
  };
}

export function buildCodexOutputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "document_title",
      "document_kind",
      "target_domain",
      "target_entity_type",
      "routing_confidence",
      "routing_reasons",
      "requires_review",
      "review_flags",
      "overall_confidence",
      "document_summary",
      "executive_summary",
      "key_themes",
      "risks",
      "assumptions",
      "normalized_metadata",
      "topline_findings",
      "anomalies",
      "ingestion_recommendation",
      "index_markdown",
      "units",
    ],
    properties: {
      document_title: { type: "string", minLength: 1 },
      document_kind: {
        type: "string",
        enum: [...CODEX_DOCUMENT_KINDS],
      },
      target_domain: {
        type: "string",
        enum: [...CODEX_TARGET_DOMAINS],
      },
      target_entity_type: { type: "string", minLength: 1 },
      routing_confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      routing_reasons: {
        type: "array",
        items: { type: "string" },
      },
      requires_review: { type: "boolean" },
      review_flags: {
        type: "array",
        items: { type: "string" },
      },
      overall_confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      document_summary: { type: "string", minLength: 1 },
      executive_summary: { type: "string", minLength: 1 },
      key_themes: {
        type: "array",
        items: { type: "string" },
      },
      risks: {
        type: "array",
        items: { type: "string" },
      },
      assumptions: {
        type: "array",
        items: { type: "string" },
      },
      normalized_metadata: {
        type: "object",
        additionalProperties: false,
        required: [
          "report_type",
          "book",
          "currency",
          "entity",
          "sheet_name",
          "period_start",
          "period_end",
          "period_label",
          "company_names_detected",
          "source_language",
        ],
        properties: {
          report_type: { type: ["string", "null"] },
          book: { type: ["string", "null"] },
          currency: { type: ["string", "null"] },
          entity: { type: ["string", "null"] },
          sheet_name: { type: ["string", "null"] },
          period_start: { type: ["string", "null"] },
          period_end: { type: ["string", "null"] },
          period_label: { type: ["string", "null"] },
          company_names_detected: {
            type: "array",
            items: { type: "string" },
          },
          source_language: { type: ["string", "null"] },
        },
      },
      topline_findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "value", "evidence"],
          properties: {
            label: { type: "string", minLength: 1 },
            value: { type: "string", minLength: 1 },
            evidence: { type: "string", minLength: 1 },
          },
        },
      },
      anomalies: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["severity", "issue", "impact", "evidence"],
          properties: {
            severity: { type: "string", enum: ["low", "medium", "high"] },
            issue: { type: "string", minLength: 1 },
            impact: { type: "string", minLength: 1 },
            evidence: { type: "string", minLength: 1 },
          },
        },
      },
      ingestion_recommendation: {
        type: "object",
        additionalProperties: false,
        required: ["mode", "reason"],
        properties: {
          mode: {
            type: "string",
            enum: ["auto_ingest", "needs_review", "knowledge_only", "reject"],
          },
          reason: { type: "string", minLength: 1 },
        },
      },
      index_markdown: { type: "string", minLength: 1 },
      units: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "slug",
            "title",
            "unit_kind",
            "source_ref",
            "confidence",
            "markdown",
            "key_figures",
            "risks",
            "assumptions",
            "evidence",
            "candidate_role",
          ],
          properties: {
            slug: { type: "string", minLength: 1 },
            title: { type: "string", minLength: 1 },
            unit_kind: {
              type: "string",
              enum: ["sheet", "page", "file"],
            },
            source_ref: { type: "string", minLength: 1 },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
            markdown: { type: "string", minLength: 1 },
            key_figures: {
              type: "array",
              items: { type: "string" },
            },
            risks: {
              type: "array",
              items: { type: "string" },
            },
            assumptions: {
              type: "array",
              items: { type: "string" },
            },
            evidence: {
              type: "array",
              items: { type: "string" },
            },
            candidate_role: { type: ["string", "null"] },
          },
        },
      },
    },
  };
}

export function validateCodexOutput(
  candidate: unknown,
  manifest: CodexArtifactManifest,
): CodexAgentOutput {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Codex output must be an object.");
  }

  const output = candidate as Record<string, unknown>;
  requireString(output.document_title, "Codex output document_title");
  requireString(output.target_entity_type, "Codex output target_entity_type");
  requireString(output.executive_summary, "Codex output executive_summary");
  requireString(output.document_summary, "Codex output document_summary");
  requireString(output.index_markdown, "Codex output index_markdown");

  if (!CODEX_DOCUMENT_KINDS.includes(output.document_kind as CodexAgentOutput["document_kind"])) {
    throw new Error("Codex output document_kind is invalid.");
  }

  if (!CODEX_TARGET_DOMAINS.includes(output.target_domain as CodexAgentOutput["target_domain"])) {
    throw new Error("Codex output target_domain is invalid.");
  }

  if (!isConfidence(output.routing_confidence)) {
    throw new Error("Codex output routing_confidence is invalid.");
  }

  if (!isConfidence(output.overall_confidence)) {
    throw new Error("Codex output overall_confidence is invalid.");
  }

  if (!Array.isArray(output.units)) {
    throw new Error("Codex output is missing units.");
  }

  const expected = new Map(manifest.units.map((unit) => [unit.slug, unit]));
  const seen = new Set<string>();
  const units: CodexAgentUnitOutput[] = [];

  for (const item of output.units) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Every Codex unit must be an object.");
    }
    const unit = item as Record<string, unknown>;
    const slug = typeof unit.slug === "string" ? unit.slug : "";
    if (!expected.has(slug)) {
      throw new Error(`Codex output returned unknown unit slug: ${slug || "<empty>"}`);
    }
    if (seen.has(slug)) {
      throw new Error(`Codex output duplicated unit slug: ${slug}`);
    }
    seen.add(slug);

    const expectedUnit = expected.get(slug)!;
    if (unit.unit_kind !== expectedUnit.unitKind) {
      throw new Error(`Codex output unit_kind mismatch for ${slug}.`);
    }
    if (!isConfidence(unit.confidence)) {
      throw new Error(`Codex output confidence is invalid for ${slug}.`);
    }

    units.push({
      slug,
      title: requireString(unit.title, `Codex output title for ${slug}`),
      unit_kind: expectedUnit.unitKind,
      source_ref: requireString(unit.source_ref, `Codex output source_ref for ${slug}`),
      confidence: unit.confidence as CodexAgentUnitOutput["confidence"],
      markdown: requireString(unit.markdown, `Codex output markdown for ${slug}`),
      key_figures: requireStringArray(unit.key_figures, `Codex output key_figures for ${slug}`),
      risks: requireStringArray(unit.risks, `Codex output risks for ${slug}`),
      assumptions: requireStringArray(unit.assumptions, `Codex output assumptions for ${slug}`),
      evidence: requireStringArray(unit.evidence, `Codex output evidence for ${slug}`),
      candidate_role: requireNullableString(unit.candidate_role, `Codex output candidate_role for ${slug}`),
    });
  }

  const missing = manifest.units
    .map((unit) => unit.slug)
    .filter((slug) => !seen.has(slug));
  if (missing.length > 0) {
    throw new Error(`Codex output missed units: ${missing.join(", ")}`);
  }

  const validated: CodexAgentOutput = {
    document_title: output.document_title as string,
    document_kind: output.document_kind as CodexAgentOutput["document_kind"],
    target_domain: output.target_domain as CodexAgentOutput["target_domain"],
    target_entity_type: output.target_entity_type as string,
    routing_confidence: output.routing_confidence as CodexAgentOutput["routing_confidence"],
    routing_reasons: requireStringArray(output.routing_reasons, "Codex output routing_reasons"),
    requires_review: requireBoolean(output.requires_review, "Codex output requires_review"),
    review_flags: requireStringArray(output.review_flags, "Codex output review_flags"),
    overall_confidence: output.overall_confidence as CodexAgentOutput["overall_confidence"],
    document_summary: output.document_summary as string,
    executive_summary: output.executive_summary as string,
    key_themes: requireStringArray(output.key_themes, "Codex output key_themes"),
    risks: requireStringArray(output.risks, "Codex output risks"),
    assumptions: requireStringArray(output.assumptions, "Codex output assumptions"),
    normalized_metadata: validateNormalizedMetadata(output.normalized_metadata),
    topline_findings: validateToplineFindings(output.topline_findings),
    anomalies: validateAnomalies(output.anomalies),
    ingestion_recommendation: validateIngestionRecommendation(output.ingestion_recommendation),
    index_markdown: output.index_markdown as string,
    units,
  };

  sanitizeReadablePdfReviewFlags(validated, manifest);
  assertNarrativeLanguageConsistency(validated);

  return validated;
}

export async function writeCodexBundle(
  workspaceDir: string,
  manifest: CodexArtifactManifest,
  output: CodexAgentOutput,
): Promise<CodexGeneratedBundle> {
  const bundleDir = join(workspaceDir, "bundle");
  const unitsDir = join(bundleDir, "units");
  await ensureDir(unitsDir);

  const route = buildCodexBundleRoute(manifest, output);
  const importRootPath = route.importRootPath;
  const indexFilePath = route.indexFilePath;
  const files: CodexBundleFile[] = [];
  const createdAt = new Date().toISOString();

  const indexBody = buildIndexBody(output, route.domain);
  await writeText(join(bundleDir, "index.md"), `${indexBody}\n`);
  files.push({
    path: indexFilePath,
    frontmatter: {
      id: `codex-import-${route.domain}-${manifest.documentId}`,
      type: route.primaryType,
      subtype: "codex-import-index",
      domain: route.domain,
      target_domain: route.domain,
      target_entity_type: output.target_entity_type,
      title: output.document_title,
      document_id: manifest.documentId,
      source_file_name: manifest.fileName,
      file_type: manifest.fileType,
      document_kind: output.document_kind,
      unit_count: manifest.units.length,
      overall_confidence: output.overall_confidence,
      routing_confidence: output.routing_confidence,
      routing_reasons: output.routing_reasons,
      requires_review: output.requires_review,
      review_flags: output.review_flags,
      ingestion_mode: output.ingestion_recommendation.mode,
      ingestion_reason: output.ingestion_recommendation.reason,
      report_type: output.normalized_metadata.report_type,
      book: output.normalized_metadata.book,
      currency: output.normalized_metadata.currency,
      entity: output.normalized_metadata.entity,
      sheet_name: output.normalized_metadata.sheet_name,
      period_start: output.normalized_metadata.period_start,
      period_end: output.normalized_metadata.period_end,
      period_label: output.normalized_metadata.period_label,
      company_names_detected: output.normalized_metadata.company_names_detected,
      source_language: output.normalized_metadata.source_language,
      topline_findings: output.topline_findings,
      anomalies: output.anomalies,
      key_themes: output.key_themes,
      risks: output.risks,
      assumptions: output.assumptions,
      created_at: createdAt,
    },
    body: indexBody,
  });

  for (const unit of output.units) {
    const unitPath = `${importRootPath}/units/${unit.slug}.qmd`;
    const unitBody = buildUnitBody(unit);
    await writeText(join(unitsDir, `${unit.slug}.md`), `${unitBody}\n`);
    files.push({
      path: unitPath,
      frontmatter: {
        id: `codex-import-unit-${route.domain}-${manifest.documentId}-${slugify(unit.slug)}`,
        type: route.primaryType === "knowledge-doc" ? "knowledge-doc" : "document_import_unit",
        subtype: "codex-import-unit",
        domain: route.domain,
        title: unitTitle(unit.title, unit.slug),
        document_id: manifest.documentId,
        source_file_name: manifest.fileName,
        file_type: manifest.fileType,
        unit_slug: unit.slug,
        unit_kind: unit.unit_kind,
        source_ref: unit.source_ref,
        confidence: unit.confidence,
        candidate_role: unit.candidate_role ?? null,
        key_figures: unit.key_figures,
        risks: unit.risks,
        assumptions: unit.assumptions,
        evidence: unit.evidence,
        created_at: createdAt,
      },
      body: unitBody,
    });
  }

  const manifestPath = join(bundleDir, "manifest.json");
  await writeText(
    manifestPath,
    JSON.stringify(
      {
        document_id: manifest.documentId,
        file_name: manifest.fileName,
        file_type: manifest.fileType,
        target_domain: route.domain,
        target_entity_type: output.target_entity_type,
        route_key: route.routeKey,
        import_root_path: importRootPath,
        index_file_path: indexFilePath,
        unit_count: output.units.length,
        overall_confidence: output.overall_confidence,
        routing_confidence: output.routing_confidence,
        ingestion_recommendation: output.ingestion_recommendation,
        normalized_metadata: output.normalized_metadata,
      },
      null,
      2,
    ),
  );

  const bundleManifestQmdPath = `${importRootPath}/manifest.qmd`;
  files.push({
    path: bundleManifestQmdPath,
    frontmatter: {
      id: `codex-import-manifest-${route.domain}-${manifest.documentId}`,
      type: route.primaryType === "knowledge-doc" ? "knowledge-doc" : "document_import_manifest",
      subtype: "codex-import-manifest",
      domain: route.domain,
      title: `Codex import manifest — ${manifest.fileName}`,
      document_id: manifest.documentId,
      source_file_name: manifest.fileName,
      file_type: manifest.fileType,
      route_key: route.routeKey,
      target_entity_type: output.target_entity_type,
      unit_count: output.units.length,
      created_at: createdAt,
    },
    body: [
      "# Codex Import Manifest",
      "",
      "```json",
      JSON.stringify(
        {
          document_title: output.document_title,
          document_kind: output.document_kind,
          target_domain: route.domain,
          target_entity_type: output.target_entity_type,
          routing_confidence: output.routing_confidence,
          routing_reasons: output.routing_reasons,
          requires_review: output.requires_review,
          review_flags: output.review_flags,
          overall_confidence: output.overall_confidence,
          normalized_metadata: output.normalized_metadata,
          ingestion_recommendation: output.ingestion_recommendation,
          key_themes: output.key_themes,
          risks: output.risks,
          assumptions: output.assumptions,
          units: output.units.map((unit) => ({
            slug: unit.slug,
            title: unit.title,
            unit_kind: unit.unit_kind,
            source_ref: unit.source_ref,
            confidence: unit.confidence,
            candidate_role: unit.candidate_role ?? null,
            evidence: unit.evidence,
          })),
        },
        null,
        2,
      ),
      "```",
    ].join("\n"),
  });

  await Promise.all(
    files.map((file) =>
      writeText(
        join(bundleDir, localBundlePath(file.path, importRootPath)),
        toQmd(file.frontmatter, file.body),
      ),
    ),
  );

  return {
    domain: route.domain,
    rootPath: importRootPath,
    indexFilePath,
    localBundleDir: bundleDir,
    localManifestPath: manifestPath,
    commitMessage: route.commitMessage,
    files,
  };
}
