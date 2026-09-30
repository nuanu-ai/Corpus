import type {
  SemanticEligibilityInput,
  SemanticEligibilityResult,
} from "./types.js";

export const DEFAULT_ALLOWED_DOMAINS = [
  "knowledge",
  "legal",
  "tax",
  "governance",
  "strategy",
  "operations",
  "assets",
  "communications",
  "people",
  "documents",
];
const DEFAULT_MIN_BODY_CHARACTERS = 300;
const FAILED_EXTRACTION_FLAGS = new Set([
  "extraction_failed",
  "artifact_extraction_failed",
  "ocr_failed",
  "sparse_generated_artifacts",
]);

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function topLevelParts(filePath: string): string[] {
  return normalizePath(filePath).split("/").filter(Boolean);
}

export function detectEntitySlug(filePath: string): string {
  const parts = topLevelParts(filePath);
  if (parts[0] === "entities" && parts[1]) {
    return parts[1];
  }
  return "root";
}

export function detectSemanticDomain(filePath: string): string | null {
  const parts = topLevelParts(filePath);
  if (parts.length === 0) return null;
  if (parts[0] === "entities") {
    return parts[2] ?? null;
  }
  return parts[0] ?? null;
}

export function buildSemanticSummaryPath(filePath: string): string | null {
  const parts = topLevelParts(filePath);
  if (parts.length === 0) return null;
  if (parts[0] === "entities") {
    if (!parts[1] || !parts[2]) return null;
    return `entities/${parts[1]}/${parts[2]}/_summary.qmd`;
  }
  return `${parts[0]}/_summary.qmd`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractReviewFlags(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.review_flags;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((flag): flag is string => typeof flag === "string")
    .map((flag) => flag.trim().toLowerCase())
    .filter(Boolean);
}

function hasFailedExtraction(frontmatter: Record<string, unknown>): boolean {
  const reviewFlags = extractReviewFlags(frontmatter);
  if (reviewFlags.some((flag) => FAILED_EXTRACTION_FLAGS.has(flag))) {
    return true;
  }

  for (const key of FAILED_EXTRACTION_FLAGS) {
    if (frontmatter[key] === true) {
      return true;
    }
  }

  return false;
}

function isGeneratedSemanticFile(filePath: string): boolean {
  const parts = topLevelParts(filePath);
  const fileName = parts[parts.length - 1] ?? "";
  if (fileName === "_summary.qmd") return true;
  if (fileName === "manifest.qmd") return true;
  if (fileName.endsWith("_index.qmd")) return true;
  if (fileName.endsWith(".statement-lines.qmd")) return true;
  if (parts.some((part) => part.startsWith("."))) return true;
  return false;
}

function eligibleReasonForDomain(domain: string): SemanticEligibilityResult["reason"] {
  switch (domain) {
    case "knowledge":
      return "eligible_knowledge";
    case "legal":
      return "eligible_legal";
    case "communications":
      return "eligible_communications";
    case "operations":
      return "eligible_operations";
    default:
      return "eligible_domain";
  }
}

export function evaluateSemanticEligibility(
  input: SemanticEligibilityInput,
): SemanticEligibilityResult {
  const domain = detectSemanticDomain(input.filePath);
  const entitySlug = detectEntitySlug(input.filePath);
  const summaryPath = buildSemanticSummaryPath(input.filePath);
  const fileName = topLevelParts(input.filePath).at(-1) ?? "";
  const body = normalizeWhitespace(input.body);
  const allowedDomains = (input.allowedDomains ?? DEFAULT_ALLOWED_DOMAINS)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const minBodyCharacters = input.minBodyCharacters ?? DEFAULT_MIN_BODY_CHARACTERS;

  if (fileName === "_summary.qmd") {
    return { eligible: false, reason: "skip_summary", domain, entitySlug, summaryPath };
  }

  if (fileName === "manifest.qmd") {
    return { eligible: false, reason: "skip_manifest", domain, entitySlug, summaryPath };
  }

  if (isGeneratedSemanticFile(input.filePath)) {
    return { eligible: false, reason: "skip_generated", domain, entitySlug, summaryPath };
  }

  if (!domain || !allowedDomains.includes(domain)) {
    return { eligible: false, reason: "skip_domain", domain, entitySlug, summaryPath };
  }

  if (!body) {
    return { eligible: false, reason: "skip_unreadable", domain, entitySlug, summaryPath };
  }

  if (body.length < minBodyCharacters) {
    return {
      eligible: false,
      reason: hasFailedExtraction(input.frontmatter) ? "skip_failed_extraction" : "skip_body_too_small",
      domain,
      entitySlug,
      summaryPath,
    };
  }

  if (hasFailedExtraction(input.frontmatter) && body.length < minBodyCharacters * 2) {
    return {
      eligible: false,
      reason: "skip_failed_extraction",
      domain,
      entitySlug,
      summaryPath,
    };
  }

  return {
    eligible: true,
    reason: eligibleReasonForDomain(domain),
    domain,
    entitySlug,
    summaryPath,
  };
}
