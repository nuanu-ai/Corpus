import { createHash } from "crypto";

import { toQmd } from "@/lib/company-db/summary/qmd";
import type { LegalWatchDisplayTranslationBundle } from "@/lib/routines/legal-watch/localization";
import type { RoutineLegalStatus, RoutineObservationChangeKind, RoutineSourceFetchResult } from "@/lib/routines/types";

export interface LegalWatchCandidateDraft {
  dedupKey: string;
  targetPath: string;
  title: string;
  summary: string;
  jurisdiction: string;
  sourceDate: Date | null;
  confidenceScore: string;
  legalStatus: RoutineLegalStatus;
  sourceUrls: string[];
  observationIds: string[];
  proposedFrontmatter: Record<string, unknown>;
  proposedBody: string;
  content: string;
}

export interface LegalWatchOperatorGuidance {
  collectionInstructions?: string | null;
  watchTopics?: string[];
  includeKeywords?: string[];
  excludeKeywords?: string[];
  reviewerChecklist?: string[];
  sourceInstructions?: string | null;
}

export interface LegalWatchSourceForDraft {
  sourceKey: string;
  title: string;
  url: string;
  trustTier: string;
  sourceType: string;
  authority: string;
  jurisdiction: string;
  topicTags: string[];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "legal-watch-update";
}

function confidenceForSource(source: LegalWatchSourceForDraft): string {
  if (source.trustTier === "primary") return "0.85";
  if (source.trustTier === "official") return "0.74";
  return "0.45";
}

function legalStatusForSource(source: LegalWatchSourceForDraft): RoutineLegalStatus {
  if (source.trustTier === "secondary") return "commentary_only";
  if (source.sourceType === "official_news" || source.sourceType === "official_guidance") return "unclear";
  return "active";
}

function sourceUrlsForResult(result: RoutineSourceFetchResult): string[] {
  const itemUrls = Array.isArray(result.rawSnapshot.itemUrls)
    ? result.rawSnapshot.itemUrls
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return Array.from(new Set([result.canonicalUrl, ...itemUrls]));
}

function normalizeDedupUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    const normalized = url.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}

function hashDedupParts(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

function urlDedupPartsForResult(input: {
  source: LegalWatchSourceForDraft;
  result: RoutineSourceFetchResult;
  sourceUrls: string[];
}): string[] {
  const sourceUrl = normalizeDedupUrl(input.source.url);
  const urls = Array.from(
    new Set(
      input.sourceUrls
        .map((url) => normalizeDedupUrl(url))
        .filter((url): url is string => Boolean(url)),
    ),
  );
  const crawledChildUrls = urls.filter((url) => sourceUrl !== url);
  if (crawledChildUrls.length > 0) return crawledChildUrls.sort();

  const canonicalUrl = normalizeDedupUrl(input.result.canonicalUrl);
  if (
    canonicalUrl &&
    input.source.sourceType === "official_news" &&
    /\/(news|pengumuman|siaran-pers)\//i.test(canonicalUrl)
  ) {
    return [canonicalUrl];
  }

  return [];
}

function candidateDedup(input: {
  routineSlug: string;
  source: LegalWatchSourceForDraft;
  result: RoutineSourceFetchResult;
  sourceUrls: string[];
}): { key: string; basis: "source_content_hash" | "source_url_set"; sourceUrls: string[] } {
  const urlParts = urlDedupPartsForResult(input);
  if (urlParts.length > 0) {
    return {
      key: `routine:${input.routineSlug}:candidate:${input.source.sourceKey}:urls:${hashDedupParts(urlParts)}`,
      basis: "source_url_set",
      sourceUrls: urlParts,
    };
  }
  return {
    key: `routine:${input.routineSlug}:candidate:${input.source.sourceKey}:${input.result.contentHash}`,
    basis: "source_content_hash",
    sourceUrls: [],
  };
}

function stripCollectionBoilerplate(value: string): string {
  return value
    .replace(/Add Listing\s*-->\s*Sign In\s*-->\s*Your wishlist\s*-->/gi, " ")
    .replace(/Rasuna Said Kav 6-7 Jakarta, Indonesia.*?(?:© 2023 Sisinfo|$)/gi, " ")
    .replace(/Statistik Pengunjung.*?(?:© 2023 Sisinfo|$)/gi, " ")
    .replace(/Invest Indonesia @bkpm.*?(?:BKPM\.?|$)/gi, " ")
    .replace(/Beranda Perencanaan PUU Program Legislasi Program Penyusunan NA penyelarasan Penyusunan Peraturan/gi, " ")
    .replace(/TAP MPR UU PERPPU PP PERPRES PERMEN PERMENKUMHAM Perda Provinsi Perda Kabupaten\/Kota/gi, " ")
    .replace(/JDIHN Utama Sejarah Dasar Hukum Visi-Misi Makna Logo Struktur Organisasi Statistik JDIHN/gi, " ")
    .replace(/Open Menu Beranda Rencana Terbit Produk Layanan Informasi Publik/gi, " ")
    .replace(/\bPanduan campaign\b/gi, "Panduan")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCandidates(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+|(?:\s+-\s+)|(?:\s{2,})/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 40 && part.length <= 600);
}

function isBoilerplateSummary(value: string): boolean {
  const normalized = value.toLowerCase();
  return [
    "add listing",
    "sign in",
    "your wishlist",
    "beranda perencanaan",
    "jaringan dokumentasi dan informasi hukum nasional",
    "jaringan dokumentasi dan informasi hukum kementerian",
    "open menu beranda",
    "rasuna said",
    "statistik pengunjung",
    "contact center",
    "kontak kami",
    "perpu@bkpm",
    "biro hukum",
    "status peraturan",
    "file-file peraturan",
  ].some((needle) => normalized.includes(needle));
}

function isWeakLegalSummary(value: string): boolean {
  const normalized = value.toLowerCase();
  if (value.length < 120 && /;\s*\d+\.?$/.test(value)) return true;
  if (
    value.length < 140 &&
    normalized.includes("peraturan menteri") &&
    normalized.includes("nomor") &&
    normalized.includes("tahun")
  ) {
    return true;
  }
  return false;
}

function chooseCandidateTitle(sourceTitle: string, resultTitle: string): string {
  const normalizedResult = resultTitle.toLowerCase();
  if (
    normalizedResult.includes("jaringan dokumentasi") &&
    !sourceTitle.toLowerCase().includes("jaringan dokumentasi")
  ) {
    return sourceTitle;
  }
  return resultTitle || sourceTitle;
}

export function summarizeLegalWatchBody(input: {
  title: string;
  bodyText: string;
  authority: string;
}): string {
  const cleaned = stripCollectionBoilerplate(input.bodyText);
  const abstractMatch = cleaned.match(/\bAbstrak\s+(.+?)(?:\bCATATAN\b|\bFILE-FILE\b|\bSTATUS PERATURAN\b|$)/i);
  if (abstractMatch?.[1]) {
    const abstract = abstractMatch[1].replace(/\s+/g, " ").trim();
    if (abstract.length >= 40 && !isWeakLegalSummary(abstract)) return abstract.slice(0, 500);
  }

  const preferred = sentenceCandidates(cleaned).find(
    (part) => !isBoilerplateSummary(part) && !isWeakLegalSummary(part),
  );
  if (preferred) return preferred.slice(0, 500);

  return `Official source page from ${input.authority}: ${input.title}. Review the original source before approving legal conclusions.`;
}

export function buildLegalWatchCandidateDraft(input: {
  routineSlug: string;
  source: LegalWatchSourceForDraft;
  result: RoutineSourceFetchResult;
  observationId: string;
  changeKind: Exclude<RoutineObservationChangeKind, "unchanged" | "error">;
  operatorGuidance?: LegalWatchOperatorGuidance;
  displayTranslations?: LegalWatchDisplayTranslationBundle;
  generatedAt?: string;
}): LegalWatchCandidateDraft {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const sourceDate = input.result.sourceDate ? new Date(input.result.sourceDate) : null;
  const datePart = (input.result.sourceDate ?? input.result.fetchedAt).slice(0, 10);
  const title = chooseCandidateTitle(input.source.title, input.result.title);
  const slug = slugify(`${datePart}-${input.source.sourceKey}-${title}`);
  const targetPath = `legal/watch/bkpm/updates/${datePart}-${slug}.qmd`;
  const confidenceScore = confidenceForSource(input.source);
  const legalStatus = legalStatusForSource(input.source);
  const sourceUrls = sourceUrlsForResult(input.result);
  const dedup = candidateDedup({
    routineSlug: input.routineSlug,
    source: input.source,
    result: input.result,
    sourceUrls,
  });
  const summary = summarizeLegalWatchBody({
    title,
    bodyText: input.result.bodyText,
    authority: input.source.authority,
  });
  const reviewStatus = "pending";
  const proposedFrontmatter = {
    type: "routine_legal_update",
    routine_slug: input.routineSlug,
    source_key: input.source.sourceKey,
    jurisdiction: input.source.jurisdiction,
    topic_tags: input.source.topicTags,
    source_urls: sourceUrls,
    source_titles: [input.result.title],
    source_dates: input.result.sourceDate ? [input.result.sourceDate] : [],
    retrieved_at: input.result.fetchedAt,
    review_status: reviewStatus,
    reviewed_by: null,
    reviewed_at: null,
    confidence: Number(confidenceScore),
    legal_status: legalStatus,
    primary_source_required: true,
    secondary_commentary_only: input.source.trustTier === "secondary",
    supersession_status: "unreviewed",
    raw_event_ids: [],
    observation_ids: [input.observationId],
    change_kind: input.changeKind,
    operator_watch_topics: input.operatorGuidance?.watchTopics ?? [],
    operator_include_keywords: input.operatorGuidance?.includeKeywords ?? [],
    operator_exclude_keywords: input.operatorGuidance?.excludeKeywords ?? [],
    operator_instructions_present: Boolean(
      input.operatorGuidance?.collectionInstructions ||
        input.operatorGuidance?.sourceInstructions ||
        input.operatorGuidance?.reviewerChecklist?.length,
    ),
    dedup_basis: dedup.basis,
    dedup_source_urls: dedup.sourceUrls,
    display_translations: input.displayTranslations?.translations ?? null,
    display_translation_metadata: input.displayTranslations
      ? {
          source_language: input.displayTranslations.sourceLanguage,
          provider: input.displayTranslations.provider,
          model: input.displayTranslations.model,
          generated_at: input.displayTranslations.generatedAt,
          error: input.displayTranslations.error ?? null,
        }
      : null,
    generated_at: generatedAt,
  };
  const operatorGuidanceLines = [
    input.operatorGuidance?.collectionInstructions
      ? `- Collection instructions: ${input.operatorGuidance.collectionInstructions}`
      : null,
    input.operatorGuidance?.sourceInstructions
      ? `- Source instructions: ${input.operatorGuidance.sourceInstructions}`
      : null,
    input.operatorGuidance?.watchTopics?.length
      ? `- Watch topics: ${input.operatorGuidance.watchTopics.join(", ")}`
      : null,
    input.operatorGuidance?.includeKeywords?.length
      ? `- Include keywords: ${input.operatorGuidance.includeKeywords.join(", ")}`
      : null,
    input.operatorGuidance?.excludeKeywords?.length
      ? `- Exclude keywords: ${input.operatorGuidance.excludeKeywords.join(", ")}`
      : null,
  ].filter((line): line is string => Boolean(line));
  const reviewerChecklist = [
    "- Confirm primary or official source authority.",
    "- Confirm source date and effective date.",
    "- Confirm supersession status.",
    "- Confirm impacted company, project, KBLI, license, LKPM, or OSS workflow.",
    ...(input.operatorGuidance?.reviewerChecklist ?? []).map((item) => `- ${item}`),
  ];
  const proposedBody = [
    `# ${title}`,
    "",
    `Review status: ${reviewStatus}. This is not approved legal advice.`,
    "",
    "## Source",
    "",
    `- URL: ${input.result.canonicalUrl}`,
    `- Authority: ${input.source.authority}`,
    `- Jurisdiction: ${input.source.jurisdiction}`,
    `- Source date: ${input.result.sourceDate ?? "unknown"}`,
    `- Retrieved at: ${input.result.fetchedAt}`,
    `- Trust tier: ${input.source.trustTier}`,
    "",
    "## What Changed",
    "",
    summary,
    "",
    ...(operatorGuidanceLines.length > 0
      ? [
          "## Operator Guidance",
          "",
          ...operatorGuidanceLines,
          "",
        ]
      : []),
    "## Reviewer Checklist",
    "",
    ...reviewerChecklist,
  ].join("\n");

  return {
    dedupKey: dedup.key,
    targetPath,
    title,
    summary,
    jurisdiction: input.source.jurisdiction,
    sourceDate,
    confidenceScore,
    legalStatus,
    sourceUrls,
    observationIds: [input.observationId],
    proposedFrontmatter,
    proposedBody,
    content: toQmd(proposedFrontmatter, proposedBody),
  };
}
