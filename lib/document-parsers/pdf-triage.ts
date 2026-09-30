export type PdfTableDensity = "none" | "low" | "medium" | "high";
export type PdfTriageVerdict = "born_digital_text" | "ocr_required" | "ambiguous";

export interface PdfTriageInput {
  extractedText?: string | null;
  pageCount?: number | null;
  pagesWithText?: number | null;
  imagePageCount?: number | null;
  tableLikeLineCount?: number | null;
  usedOcr?: boolean | null;
  extractionFailed?: boolean | null;
  reviewFlags?: string[] | null;
}

export interface PdfTriageResult {
  verdict: PdfTriageVerdict;
  ocrNeeded: boolean;
  tableDensity: PdfTableDensity;
  tableLikeLineCount: number;
  pageCount: number;
  pagesWithText: number;
  imagePageCount: number;
  textCoverage: number;
  textDensity: number;
  reasons: string[];
}

const OCR_REVIEW_FLAGS = new Set([
  "extraction_failed",
  "extractor_failed",
  "manual_text_recovery",
  "ocr_failed",
  "image_only_pdf",
  "sparse_generated_artifacts",
]);

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeReviewFlags(reviewFlags: string[] | null | undefined): Set<string> {
  return new Set(
    (reviewFlags ?? [])
      .map((flag) => flag.trim().toLowerCase())
      .filter(Boolean),
  );
}

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function looksTableLike(line: string): boolean {
  if (/\|/.test(line)) return true;
  if (/\t/.test(line)) return true;
  if ((line.match(/\s{2,}/g) ?? []).length >= 2) return true;

  const numericTokens = line.match(/(?:^|[\s|])[-+]?[$€£¥]?\d[\d,./()-]*/g) ?? [];
  return numericTokens.length >= 3;
}

export function countTableLikeLines(text: string): number {
  return nonEmptyLines(text).filter((line) => looksTableLike(line)).length;
}

export function estimatePdfTableDensityFromText(text: string): PdfTableDensity {
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return "none";

  const tableLikeLineCount = countTableLikeLines(text);
  if (tableLikeLineCount === 0) return "none";

  const ratio = tableLikeLineCount / lines.length;
  if (tableLikeLineCount >= 12 || ratio >= 0.35) return "high";
  if (tableLikeLineCount >= 6 || ratio >= 0.18) return "medium";
  return "low";
}

export function triagePdf(input: PdfTriageInput): PdfTriageResult {
  const extractedText = (input.extractedText ?? "").trim();
  const strippedText = extractedText.replace(/\s+/g, "");
  const reviewFlags = normalizeReviewFlags(input.reviewFlags);

  const rawPageCount = input.pageCount ?? null;
  const pageCount =
    rawPageCount && Number.isFinite(rawPageCount) && rawPageCount > 0
      ? Math.floor(rawPageCount)
      : extractedText.length > 0
        ? 1
        : 0;

  const rawPagesWithText = input.pagesWithText ?? null;
  const pagesWithText =
    pageCount > 0
      ? clampInteger(
          rawPagesWithText && Number.isFinite(rawPagesWithText)
            ? Math.floor(rawPagesWithText)
            : extractedText.length > 0
              ? pageCount
              : 0,
          0,
          pageCount,
        )
      : 0;

  const imagePageCount =
    pageCount > 0
      ? clampInteger(
          input.imagePageCount && Number.isFinite(input.imagePageCount)
            ? Math.floor(input.imagePageCount)
            : 0,
          0,
          pageCount,
        )
      : 0;

  const textCoverage = pageCount > 0 ? Number((pagesWithText / pageCount).toFixed(2)) : 0;
  const textDensity = pageCount > 0 ? Math.round(strippedText.length / pageCount) : 0;
  const tableLikeLineCount = Math.max(
    0,
    Math.floor(input.tableLikeLineCount ?? countTableLikeLines(extractedText)),
  );
  const tableDensity = estimatePdfTableDensityFromText(extractedText);

  const reasons: string[] = [];
  const explicitExtractionFailure = input.extractionFailed === true;
  const flaggedForOcr = [...reviewFlags].some((flag) => OCR_REVIEW_FLAGS.has(flag));
  const imageHeavy = pageCount > 0 && imagePageCount > Math.floor(pageCount / 2);
  const sparseText = strippedText.length === 0 || textCoverage < 0.5 || textDensity < 80;
  const mixedSignals = !sparseText && (textCoverage < 0.8 || imagePageCount > 0 || textDensity < 200);

  if (input.usedOcr) reasons.push("ocr_used");
  if (explicitExtractionFailure) reasons.push("extraction_failed");
  if (flaggedForOcr) reasons.push("ocr_review_flags");
  if (imageHeavy) reasons.push("image_heavy_pages");
  if (sparseText) reasons.push("sparse_machine_text");
  if (mixedSignals && !sparseText) reasons.push("mixed_layout_signals");
  if (tableDensity === "medium" || tableDensity === "high") reasons.push(`table_density_${tableDensity}`);
  if (textCoverage >= 0.8 && textDensity >= 200 && imagePageCount === 0) {
    reasons.push("strong_machine_text");
  }

  if (input.usedOcr || explicitExtractionFailure || flaggedForOcr || imageHeavy || sparseText) {
    return {
      verdict: "ocr_required",
      ocrNeeded: true,
      tableDensity,
      tableLikeLineCount,
      pageCount,
      pagesWithText,
      imagePageCount,
      textCoverage,
      textDensity,
      reasons,
    };
  }

  if (textCoverage >= 0.8 && textDensity >= 200 && imagePageCount === 0) {
    return {
      verdict: "born_digital_text",
      ocrNeeded: false,
      tableDensity,
      tableLikeLineCount,
      pageCount,
      pagesWithText,
      imagePageCount,
      textCoverage,
      textDensity,
      reasons,
    };
  }

  return {
    verdict: "ambiguous",
    ocrNeeded: false,
    tableDensity,
    tableLikeLineCount,
    pageCount,
    pagesWithText,
    imagePageCount,
    textCoverage,
    textDensity,
    reasons,
  };
}
