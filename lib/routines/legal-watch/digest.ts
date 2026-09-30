import { toQmd } from "@/lib/company-db/summary/qmd";

export type LegalWatchDigestMetricKey =
  | "sourcesChecked"
  | "changedSources"
  | "newCandidates"
  | "approvedCandidates"
  | "rejectedCandidates"
  | "pendingCandidates"
  | "highConfidenceUpdates"
  | "possiblySupersededItems"
  | "sourceErrors";

export interface LegalWatchDigestWindowStats extends Record<LegalWatchDigestMetricKey, number> {
  [key: string]: number;
  sourcesChecked: number;
  changedSources: number;
  newCandidates: number;
  approvedCandidates: number;
  rejectedCandidates: number;
  pendingCandidates: number;
  highConfidenceUpdates: number;
  possiblySupersededItems: number;
  sourceErrors: number;
}

export interface LegalWatchDigestSource {
  title: string;
  url: string;
  trustTier?: "primary" | "official" | "secondary" | string | null;
  changed?: boolean;
  error?: string | null;
}

export interface LegalWatchDigestCandidate {
  title: string;
  targetPath?: string | null;
  targetDomain?: string | null;
  reviewStatus: string;
  legalStatus: string;
  confidenceScore: number | null;
  jurisdiction?: string | null;
  sourceDate: string | null;
  sourceUrls: string[];
  sourceTitles?: string[];
  summary: string;
  observationIds?: string[];
  rawEventIds?: string[];
}

export interface LegalWatchDigestInput {
  routineSlug: string;
  jurisdiction: string;
  windowStart: string;
  windowEnd: string;
  previousWindowStart?: string | null;
  previousWindowEnd?: string | null;
  scopeType?: string | null;
  scopeId?: string | null;
  impactedCompanyIds?: string[];
  impactedDomains?: string[];
  current: LegalWatchDigestWindowStats;
  previous: LegalWatchDigestWindowStats;
  sources?: LegalWatchDigestSource[];
  candidates: LegalWatchDigestCandidate[];
  operatorGuidance?: {
    collectionInstructions?: string | null;
    watchTopics?: string[];
    includeKeywords?: string[];
    excludeKeywords?: string[];
    reviewerChecklist?: string[];
  };
  generatedAt?: string;
  delivery?: never;
}

export interface LegalWatchDigestMetricDelta {
  metric: LegalWatchDigestMetricKey;
  current: number;
  previous: number;
  delta: number;
  percentDelta: number | null;
}

export interface LegalWatchDigestDeliveryContract {
  status: "disabled";
  telegramDeliveryEnabled: false;
  deliveryInvoked: false;
  channels: [];
  reason: string;
}

export interface LegalWatchDigestPreview {
  path: string;
  markdown: string;
  qmd: string;
  comparison: LegalWatchDigestMetricDelta[];
  delivery: LegalWatchDigestDeliveryContract;
}

const METRIC_KEYS: LegalWatchDigestMetricKey[] = [
  "sourcesChecked",
  "changedSources",
  "newCandidates",
  "approvedCandidates",
  "rejectedCandidates",
  "pendingCandidates",
  "highConfidenceUpdates",
  "possiblySupersededItems",
  "sourceErrors",
];

export const LEGAL_WATCH_DIGEST_DELIVERY_DISABLED: LegalWatchDigestDeliveryContract = {
  status: "disabled",
  telegramDeliveryEnabled: false,
  deliveryInvoked: false,
  channels: [],
  reason: "CORPUS-19 digest preview only; Telegram delivery is disabled.",
};

function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function formatDelta(current: number, previous: number): string {
  const delta = current - previous;
  const pct = percentDelta(current, previous);
  const sign = delta > 0 ? "+" : "";
  if (pct === null) return `${current} (${sign}${delta}, no previous baseline)`;
  return `${current} (${sign}${delta}, ${sign}${pct.toFixed(1)}%)`;
}

function metricLabel(metric: LegalWatchDigestMetricKey): string {
  return String(metric).replace(/([A-Z])/g, " $1").replace(/^./, (value: string) => value.toUpperCase());
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  );
}

function confidenceLabel(value: number | null): string {
  return value === null ? "confidence unknown" : `confidence ${value.toFixed(2)}`;
}

function formatIsoWeekId(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function digestPath(input: LegalWatchDigestInput): string {
  const sourceSlug = input.routineSlug.toLowerCase().includes("bkpm")
    ? "bkpm"
    : input.routineSlug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `legal/watch/${sourceSlug || "legal-watch"}/digests/${formatIsoWeekId(input.windowStart)}.qmd`;
}

function markdownLink(title: string, url: string): string {
  return `[${title.replace(/\]/g, "\\]")}](${url})`;
}

function sourceLine(source: LegalWatchDigestSource): string {
  const status = source.error ? `error: ${source.error}` : source.changed ? "changed" : "unchanged";
  const tier = source.trustTier ? `; ${source.trustTier}` : "";
  return `- ${markdownLink(source.title, source.url)} - ${status}${tier}`;
}

function candidateLine(candidate: LegalWatchDigestCandidate): string {
  const sourceDate = candidate.sourceDate ?? "source date unknown";
  const path = candidate.targetPath ? ` | ${candidate.targetPath}` : "";
  const targetDomain = candidate.targetDomain ? `; domain: ${candidate.targetDomain}` : "";
  const jurisdiction = candidate.jurisdiction ? `; jurisdiction: ${candidate.jurisdiction}` : "";
  const sourceTitles = candidate.sourceTitles?.length
    ? candidate.sourceTitles
    : candidate.sourceUrls.map((url) => url);
  const sources = candidate.sourceUrls.length > 0
    ? candidate.sourceUrls
        .map((url, index) => markdownLink(sourceTitles[index] ?? url, url))
        .join(", ")
    : "none recorded";
  return [
    `- ${candidate.title}${path}`,
    `  - Review: ${candidate.reviewStatus}; legal status: ${candidate.legalStatus}; ${confidenceLabel(candidate.confidenceScore)}; ${sourceDate}${jurisdiction}${targetDomain}.`,
    `  - Sources: ${sources}.`,
    `  - Summary: ${candidate.summary}`,
  ].join("\n");
}

export function calculateLegalWatchDigestDeltas(
  current: LegalWatchDigestWindowStats,
  previous: LegalWatchDigestWindowStats,
): LegalWatchDigestMetricDelta[] {
  return METRIC_KEYS.map((metric) => ({
    metric,
    current: current[metric],
    previous: previous[metric],
    delta: current[metric] - previous[metric],
    percentDelta: percentDelta(current[metric], previous[metric]),
  }));
}

export function compareLegalWatchDigestStats(
  current: LegalWatchDigestWindowStats,
  previous: LegalWatchDigestWindowStats,
): Record<LegalWatchDigestMetricKey, string> {
  return {
    sourcesChecked: formatDelta(current.sourcesChecked, previous.sourcesChecked),
    changedSources: formatDelta(current.changedSources, previous.changedSources),
    newCandidates: formatDelta(current.newCandidates, previous.newCandidates),
    approvedCandidates: formatDelta(current.approvedCandidates, previous.approvedCandidates),
    rejectedCandidates: formatDelta(current.rejectedCandidates, previous.rejectedCandidates),
    pendingCandidates: formatDelta(current.pendingCandidates, previous.pendingCandidates),
    highConfidenceUpdates: formatDelta(current.highConfidenceUpdates, previous.highConfidenceUpdates),
    possiblySupersededItems: formatDelta(current.possiblySupersededItems, previous.possiblySupersededItems),
    sourceErrors: formatDelta(current.sourceErrors, previous.sourceErrors),
  };
}

export function buildLegalWatchDigestMarkdown(input: LegalWatchDigestInput): string {
  const deltas = compareLegalWatchDigestStats(input.current, input.previous);
  const previousWindow = input.previousWindowStart && input.previousWindowEnd
    ? `${input.previousWindowStart} to ${input.previousWindowEnd}`
    : "not provided";
  const scope = input.scopeType
    ? `${input.scopeType}${input.scopeId ? `:${input.scopeId}` : ""}`
    : "company";
  const impactedCompanies = uniqueStrings(input.impactedCompanyIds ?? []);
  const impactedDomains = uniqueStrings(input.impactedDomains ?? ["legal"]);
  return [
    "# BKPM Legal Watch Digest",
    "",
    `Window: ${input.windowStart} to ${input.windowEnd} (end exclusive)`,
    `Previous window: ${previousWindow}`,
    `Jurisdiction: ${input.jurisdiction}`,
    `Impacted scope: ${scope}`,
    `Impacted companies: ${impactedCompanies.length > 0 ? impactedCompanies.join(", ") : "active company"}`,
    `Impacted domains: ${impactedDomains.join(", ")}`,
    "",
    `Telegram delivery is disabled for this preview. ${LEGAL_WATCH_DIGEST_DELIVERY_DISABLED.reason}`,
    "",
    ...(input.operatorGuidance
      ? [
          "## Operator Rules",
          "",
          input.operatorGuidance.collectionInstructions
            ? `- Collection instructions: ${input.operatorGuidance.collectionInstructions}`
            : "- Collection instructions: default source-specific collection.",
          input.operatorGuidance.watchTopics?.length
            ? `- Watch topics: ${input.operatorGuidance.watchTopics.join(", ")}`
            : "- Watch topics: default BKPM/OSS legal watch.",
          input.operatorGuidance.includeKeywords?.length
            ? `- Include keywords: ${input.operatorGuidance.includeKeywords.join(", ")}`
            : "- Include keywords: none.",
          input.operatorGuidance.excludeKeywords?.length
            ? `- Exclude keywords: ${input.operatorGuidance.excludeKeywords.join(", ")}`
            : "- Exclude keywords: none.",
          input.operatorGuidance.reviewerChecklist?.length
            ? `- Reviewer checklist additions: ${input.operatorGuidance.reviewerChecklist.join("; ")}`
            : "- Reviewer checklist additions: none.",
          "",
        ]
      : []),
    "## Week Over Week",
    "",
    ...METRIC_KEYS.map((metric) => `- ${metricLabel(metric)}: ${deltas[metric]}`),
    "",
    "## Sources",
    "",
    input.sources && input.sources.length > 0
      ? input.sources.map(sourceLine).join("\n")
      : "No sources listed for this digest.",
    "",
    "## Candidates",
    "",
    input.candidates.length > 0
      ? input.candidates.map(candidateLine).join("\n\n")
      : "No candidates in this window.",
  ].join("\n");
}

export function buildLegalWatchDigestQmd(input: LegalWatchDigestInput): {
  path: string;
  content: string;
} {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sourceUrls = uniqueStrings([
    ...(input.sources ?? []).map((source) => source.url),
    ...input.candidates.flatMap((candidate) => candidate.sourceUrls),
  ]);
  const sourceTitles = uniqueStrings([
    ...(input.sources ?? []).map((source) => source.title),
    ...input.candidates.flatMap((candidate) => candidate.sourceTitles ?? []),
  ]);
  const sourceDates = uniqueStrings(input.candidates.map((candidate) => candidate.sourceDate));
  const confidenceValues = input.candidates
    .map((candidate) => candidate.confidenceScore)
    .filter((value): value is number => typeof value === "number");
  const confidence = confidenceValues.length > 0
    ? Number((confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length).toFixed(4))
    : null;
  const frontmatter = {
    type: "routine_digest",
    routine_slug: input.routineSlug,
    scope_type: input.scopeType ?? null,
    scope_id: input.scopeId ?? null,
    jurisdiction: input.jurisdiction,
    topic_tags: [],
    impacted_company_ids: uniqueStrings(input.impactedCompanyIds ?? []),
    impacted_domains: uniqueStrings(input.impactedDomains ?? ["legal"]),
    source_urls: sourceUrls,
    source_titles: sourceTitles,
    source_dates: sourceDates,
    retrieved_at: generatedAt,
    review_status: "preview",
    reviewed_by: null,
    reviewed_at: null,
    confidence,
    legal_status: input.current.possiblySupersededItems > 0 ? "possibly_superseded" : "active",
    primary_source_required: true,
    secondary_commentary_only:
      input.sources !== undefined &&
      input.sources.length > 0 &&
      input.sources.every((source) => source.trustTier === "secondary"),
    supersession_status:
      input.current.possiblySupersededItems > 0 ? "contains_possibly_superseded" : "not_detected",
    raw_event_ids: uniqueStrings(input.candidates.flatMap((candidate) => candidate.rawEventIds ?? [])),
    observation_ids: uniqueStrings(input.candidates.flatMap((candidate) => candidate.observationIds ?? [])),
    window_start: input.windowStart,
    window_end: input.windowEnd,
    generated_at: generatedAt,
    delivery_status: LEGAL_WATCH_DIGEST_DELIVERY_DISABLED.status,
    telegram_delivery_enabled: LEGAL_WATCH_DIGEST_DELIVERY_DISABLED.telegramDeliveryEnabled,
    current_stats: input.current,
    previous_window_stats: input.previous,
  };
  return {
    path: digestPath(input),
    content: toQmd(frontmatter, buildLegalWatchDigestMarkdown(input)),
  };
}

export function buildLegalWatchWeeklyDigest(input: LegalWatchDigestInput): LegalWatchDigestPreview {
  const qmd = buildLegalWatchDigestQmd(input);
  return {
    path: qmd.path,
    markdown: buildLegalWatchDigestMarkdown(input),
    qmd: qmd.content,
    comparison: calculateLegalWatchDigestDeltas(input.current, input.previous),
    delivery: LEGAL_WATCH_DIGEST_DELIVERY_DISABLED,
  };
}
