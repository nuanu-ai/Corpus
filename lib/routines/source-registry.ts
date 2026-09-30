export const ROUTINE_SOURCE_TYPES = [
  "primary_law",
  "regulation",
  "official_guidance",
  "official_news",
  "secondary_commentary",
  "manual_seed",
] as const;

export type RoutineSourceType = (typeof ROUTINE_SOURCE_TYPES)[number];

export const ROUTINE_SOURCE_TRUST_TIERS = [
  "primary",
  "official",
  "secondary",
] as const;

export type RoutineSourceTrustTier =
  (typeof ROUTINE_SOURCE_TRUST_TIERS)[number];

export const ROUTINE_SOURCE_FETCH_MODES = [
  "http_html",
  "http_pdf",
  "rss",
  "sitemap",
  "manual",
] as const;

export type RoutineSourceFetchMode =
  (typeof ROUTINE_SOURCE_FETCH_MODES)[number];

export const ROUTINE_SOURCE_CHECK_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "manual",
] as const;

export type RoutineSourceCheckFrequency =
  (typeof ROUTINE_SOURCE_CHECK_FREQUENCIES)[number];

export const ROUTINE_SOURCE_STALENESS_RISKS = [
  "high",
  "medium",
  "low",
] as const;

export type RoutineSourceStalenessRisk =
  (typeof ROUTINE_SOURCE_STALENESS_RISKS)[number];

export const ROUTINE_SOURCE_STATUSES = [
  "active",
  "paused",
  "broken",
  "retired",
] as const;

export type RoutineSourceStatus = (typeof ROUTINE_SOURCE_STATUSES)[number];

export const ROUTINE_SOURCE_CONTENT_TYPES = [
  "text/html",
  "application/pdf",
  "application/rss+xml",
  "application/xml",
  "text/plain",
] as const;

export type RoutineSourceContentType =
  (typeof ROUTINE_SOURCE_CONTENT_TYPES)[number];

export interface RoutineSourceDefinition {
  readonly sourceKey: string;
  readonly title: string;
  readonly url: string;
  readonly sourceType: RoutineSourceType;
  readonly authority: string;
  readonly jurisdiction: string;
  readonly topicTags: string[];
  readonly fetchMode: RoutineSourceFetchMode;
  readonly checkFrequency: RoutineSourceCheckFrequency;
  readonly stalenessRisk: RoutineSourceStalenessRisk;
  readonly trustTier: RoutineSourceTrustTier;
  readonly status: RoutineSourceStatus;
  readonly allowedContentTypes: RoutineSourceContentType[];
  readonly useFor: string;
  readonly provenanceRequirements: string[];
  readonly verifiedAsOf: string;
  readonly allowedUrlPrefixes?: string[];
  readonly instrumentNumber?: string;
  readonly sourceDate?: string;
  readonly discoveryOnly?: boolean;
  readonly primarySourceRequired?: boolean;
  readonly secondaryCommentaryOnly?: boolean;
  readonly notes?: string[];
  readonly metadata?: Record<string, unknown>;
}

export interface RoutineSourceValidationIssue {
  readonly sourceKey: string | null;
  readonly field?: string;
  readonly code: string;
  readonly message: string;
}

export interface RoutineSourceValidationResult {
  readonly valid: boolean;
  readonly issues: readonly RoutineSourceValidationIssue[];
}

export class RoutineSourceRegistryValidationError extends Error {
  readonly issues: readonly RoutineSourceValidationIssue[];

  constructor(issues: readonly RoutineSourceValidationIssue[]) {
    super(
      `Routine source registry validation failed: ${issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
    this.name = "RoutineSourceRegistryValidationError";
    this.issues = issues;
  }
}

const SOURCE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOPIC_TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROVENANCE_REQUIREMENT_PATTERN = /^[a-z0-9_:-]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const JURISDICTION_PATTERN = /^[A-Z]{2}(?:-[A-Z0-9]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function readSourceKey(record: Record<string, unknown> | null): string | null {
  if (!record || typeof record.sourceKey !== "string") return null;
  return record.sourceKey;
}

function pushIssue(
  issues: RoutineSourceValidationIssue[],
  record: Record<string, unknown> | null,
  field: string,
  code: string,
  message: string,
): void {
  issues.push({
    sourceKey: readSourceKey(record),
    field,
    code,
    message,
  });
}

function parseHttpsUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function normalizeComparableUrl(value: string): string {
  const normalized = normalizeUrl(value);
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function normalizeRoutineSourceUrlPrefix(value: string): string {
  const normalized = normalizeUrl(value);
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function validateRequiredString(
  issues: RoutineSourceValidationIssue[],
  record: Record<string, unknown> | null,
  field: keyof RoutineSourceDefinition,
): void {
  const value = record?.[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    pushIssue(
      issues,
      record,
      field,
      "required_string",
      `${field} is required`,
    );
  }
}

function validateStringArray(
  issues: RoutineSourceValidationIssue[],
  record: Record<string, unknown> | null,
  field: keyof RoutineSourceDefinition,
  pattern?: RegExp,
): void {
  const value = record?.[field];
  if (!Array.isArray(value) || value.length === 0) {
    pushIssue(
      issues,
      record,
      field,
      "required_array",
      `${field} must be a non-empty array`,
    );
    return;
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      pushIssue(
        issues,
        record,
        field,
        "invalid_array_item",
        `${field} must contain only non-empty strings`,
      );
      return;
    }
    if (pattern && !pattern.test(item)) {
      pushIssue(
        issues,
        record,
        field,
        "invalid_array_item",
        `${field} contains invalid value ${item}`,
      );
      return;
    }
  }
}

export function validateRoutineSource(
  source: unknown,
): RoutineSourceValidationResult {
  const issues: RoutineSourceValidationIssue[] = [];
  const record = isRecord(source) ? source : null;

  if (!record) {
    issues.push({
      sourceKey: null,
      code: "invalid_source",
      message: "source must be an object",
    });
    return { valid: false, issues };
  }

  validateRequiredString(issues, record, "sourceKey");
  validateRequiredString(issues, record, "title");
  validateRequiredString(issues, record, "url");
  validateRequiredString(issues, record, "authority");
  validateRequiredString(issues, record, "jurisdiction");
  validateRequiredString(issues, record, "useFor");
  validateRequiredString(issues, record, "verifiedAsOf");

  if (
    typeof record.sourceKey === "string" &&
    !SOURCE_KEY_PATTERN.test(record.sourceKey)
  ) {
    pushIssue(
      issues,
      record,
      "sourceKey",
      "invalid_source_key",
      "sourceKey must be a stable lowercase slug",
    );
  }

  const sourceUrl = parseHttpsUrl(record.url);
  if (!sourceUrl) {
    pushIssue(
      issues,
      record,
      "url",
      "invalid_url",
      "url must be a valid https URL",
    );
  }

  if (
    typeof record.jurisdiction === "string" &&
    !JURISDICTION_PATTERN.test(record.jurisdiction)
  ) {
    pushIssue(
      issues,
      record,
      "jurisdiction",
      "invalid_jurisdiction",
      "jurisdiction must be an uppercase jurisdiction code",
    );
  }

  if (
    typeof record.verifiedAsOf === "string" &&
    !ISO_DATE_PATTERN.test(record.verifiedAsOf)
  ) {
    pushIssue(
      issues,
      record,
      "verifiedAsOf",
      "invalid_date",
      "verifiedAsOf must use YYYY-MM-DD",
    );
  }

  if (
    typeof record.sourceDate === "string" &&
    !ISO_DATE_PATTERN.test(record.sourceDate)
  ) {
    pushIssue(
      issues,
      record,
      "sourceDate",
      "invalid_date",
      "sourceDate must use YYYY-MM-DD",
    );
  }

  validateStringArray(issues, record, "topicTags", TOPIC_TAG_PATTERN);
  validateStringArray(issues, record, "allowedContentTypes");
  validateStringArray(
    issues,
    record,
    "provenanceRequirements",
    PROVENANCE_REQUIREMENT_PATTERN,
  );

  if (
    !isAllowedValue(record.sourceType, ROUTINE_SOURCE_TYPES)
  ) {
    pushIssue(
      issues,
      record,
      "sourceType",
      "invalid_source_type",
      "sourceType is not allowlisted",
    );
  }

  if (!isAllowedValue(record.trustTier, ROUTINE_SOURCE_TRUST_TIERS)) {
    pushIssue(
      issues,
      record,
      "trustTier",
      "invalid_trust_tier",
      "trustTier is not allowlisted",
    );
  }

  if (!isAllowedValue(record.fetchMode, ROUTINE_SOURCE_FETCH_MODES)) {
    pushIssue(
      issues,
      record,
      "fetchMode",
      "invalid_fetch_mode",
      "fetchMode is not allowlisted",
    );
  }

  if (
    !isAllowedValue(record.checkFrequency, ROUTINE_SOURCE_CHECK_FREQUENCIES)
  ) {
    pushIssue(
      issues,
      record,
      "checkFrequency",
      "invalid_check_frequency",
      "checkFrequency is not allowlisted",
    );
  }

  if (
    !isAllowedValue(record.stalenessRisk, ROUTINE_SOURCE_STALENESS_RISKS)
  ) {
    pushIssue(
      issues,
      record,
      "stalenessRisk",
      "invalid_staleness_risk",
      "stalenessRisk is not allowlisted",
    );
  }

  if (!isAllowedValue(record.status, ROUTINE_SOURCE_STATUSES)) {
    pushIssue(
      issues,
      record,
      "status",
      "invalid_status",
      "status is not allowlisted",
    );
  }

  if (Array.isArray(record.allowedContentTypes)) {
    for (const contentType of record.allowedContentTypes) {
      if (!isAllowedValue(contentType, ROUTINE_SOURCE_CONTENT_TYPES)) {
        pushIssue(
          issues,
          record,
          "allowedContentTypes",
          "invalid_content_type",
          `${String(contentType)} is not an allowlisted content type`,
        );
      }
    }
  }

  if (
    record.fetchMode === "http_pdf" &&
    Array.isArray(record.allowedContentTypes) &&
    !record.allowedContentTypes.includes("application/pdf")
  ) {
    pushIssue(
      issues,
      record,
      "allowedContentTypes",
      "fetch_mode_content_type_mismatch",
      "http_pdf sources must allow application/pdf",
    );
  }

  if (
    record.fetchMode === "http_html" &&
    Array.isArray(record.allowedContentTypes) &&
    !record.allowedContentTypes.includes("text/html")
  ) {
    pushIssue(
      issues,
      record,
      "allowedContentTypes",
      "fetch_mode_content_type_mismatch",
      "http_html sources must allow text/html",
    );
  }

  if (Array.isArray(record.allowedUrlPrefixes)) {
    for (const prefix of record.allowedUrlPrefixes) {
      const prefixUrl = parseHttpsUrl(prefix);
      if (!prefixUrl) {
        pushIssue(
          issues,
          record,
          "allowedUrlPrefixes",
          "invalid_url_prefix",
          "allowedUrlPrefixes must contain valid https URLs",
        );
        continue;
      }
      if (sourceUrl && prefixUrl.hostname !== sourceUrl.hostname) {
        pushIssue(
          issues,
          record,
          "allowedUrlPrefixes",
          "url_prefix_host_mismatch",
          "allowedUrlPrefixes must stay on the registered source host",
        );
      }
    }
  }

  if (record.sourceType === "secondary_commentary") {
    if (record.trustTier !== "secondary") {
      pushIssue(
        issues,
        record,
        "trustTier",
        "secondary_commentary_trust_tier",
        "secondary commentary sources must use secondary trust tier",
      );
    }
    if (record.secondaryCommentaryOnly !== true) {
      pushIssue(
        issues,
        record,
        "secondaryCommentaryOnly",
        "secondary_commentary_only_required",
        "secondary commentary sources must be secondaryCommentaryOnly",
      );
    }
  }

  if (
    record.trustTier === "secondary" &&
    record.sourceType !== "secondary_commentary"
  ) {
    pushIssue(
      issues,
      record,
      "sourceType",
      "secondary_trust_requires_commentary",
      "secondary trust tier must be sourceType secondary_commentary",
    );
  }

  if (
    record.secondaryCommentaryOnly === true &&
    record.sourceType !== "secondary_commentary"
  ) {
    pushIssue(
      issues,
      record,
      "secondaryCommentaryOnly",
      "secondary_commentary_only_mismatch",
      "secondaryCommentaryOnly can only be true for secondary commentary",
    );
  }

  if (
    (record.sourceType === "primary_law" ||
      record.sourceType === "regulation") &&
    record.trustTier === "secondary"
  ) {
    pushIssue(
      issues,
      record,
      "trustTier",
      "primary_source_cannot_be_secondary",
      "primary law and regulation sources cannot use secondary trust tier",
    );
  }

  if (record.discoveryOnly === true) {
    if (record.primarySourceRequired !== true) {
      pushIssue(
        issues,
        record,
        "primarySourceRequired",
        "discovery_requires_primary_verification",
        "discovery-only sources must require primary source verification",
      );
    }
    if (record.sourceType === "secondary_commentary") {
      pushIssue(
        issues,
        record,
        "sourceType",
        "discovery_source_cannot_be_commentary",
        "discovery-only sources cannot be secondary commentary",
      );
    }
  }

  return { valid: issues.length === 0, issues };
}

export function validateRoutineSources(
  sources: readonly unknown[],
): RoutineSourceValidationResult {
  const issues: RoutineSourceValidationIssue[] = [];
  const seenSourceKeys = new Map<string, number>();
  const seenUrls = new Map<string, string>();

  sources.forEach((source, index) => {
    const result = validateRoutineSource(source);
    issues.push(...result.issues);

    if (!isRecord(source)) return;

    if (typeof source.sourceKey === "string") {
      const priorIndex = seenSourceKeys.get(source.sourceKey);
      if (priorIndex !== undefined) {
        issues.push({
          sourceKey: source.sourceKey,
          field: "sourceKey",
          code: "duplicate_source_key",
          message: `sourceKey ${source.sourceKey} is duplicated at indexes ${priorIndex} and ${index}`,
        });
      } else {
        seenSourceKeys.set(source.sourceKey, index);
      }
    }

    if (typeof source.url === "string" && parseHttpsUrl(source.url)) {
      const normalizedUrl = normalizeComparableUrl(source.url);
      const priorKey = seenUrls.get(normalizedUrl);
      if (priorKey) {
        issues.push({
          sourceKey: readSourceKey(source),
          field: "url",
          code: "duplicate_url",
          message: `url duplicates sourceKey ${priorKey}`,
        });
      } else {
        seenUrls.set(normalizedUrl, readSourceKey(source) ?? `index-${index}`);
      }
    }
  });

  return { valid: issues.length === 0, issues };
}

export function assertValidRoutineSources<T extends RoutineSourceDefinition>(
  sources: readonly T[],
): readonly T[] {
  const result = validateRoutineSources(sources);
  if (!result.valid) {
    throw new RoutineSourceRegistryValidationError(result.issues);
  }
  return sources;
}

export function canPromoteLegalRuleFromSource(
  source: RoutineSourceDefinition,
): boolean {
  if (source.secondaryCommentaryOnly || source.discoveryOnly) return false;
  if (source.trustTier === "primary") return true;
  if (source.trustTier === "official") {
    return source.primarySourceRequired !== true;
  }
  return false;
}

export function isRoutineSourceUrlAllowed(
  source: RoutineSourceDefinition,
  candidateUrl: string,
): boolean {
  const candidate = parseHttpsUrl(candidateUrl);
  if (!candidate) return false;

  if (
    normalizeComparableUrl(candidate.toString()) ===
    normalizeComparableUrl(source.url)
  ) {
    return true;
  }

  for (const prefix of source.allowedUrlPrefixes ?? []) {
    const parsedPrefix = parseHttpsUrl(prefix);
    if (!parsedPrefix) continue;
    if (candidate.toString().startsWith(normalizeRoutineSourceUrlPrefix(parsedPrefix.toString()))) {
      return true;
    }
  }

  return false;
}
