import {
  ROUTINE_SOURCE_CHECK_FREQUENCIES,
  ROUTINE_SOURCE_CONTENT_TYPES,
  ROUTINE_SOURCE_FETCH_MODES,
  ROUTINE_SOURCE_STATUSES,
  ROUTINE_SOURCE_STALENESS_RISKS,
  ROUTINE_SOURCE_TRUST_TIERS,
  ROUTINE_SOURCE_TYPES,
  normalizeRoutineSourceUrlPrefix,
  validateRoutineSource,
  type RoutineSourceDefinition,
} from "@/lib/routines/source-registry";
import { assertLegalWatchSafeHttpsUrl } from "@/lib/routines/legal-watch/url-safety";

export const ROUTINE_SOURCE_CONFIG_LIMITS = {
  title: 180,
  authority: 160,
  useFor: 1200,
  note: 500,
  notes: 20,
  provenanceRequirements: 30,
  allowedUrlPrefixes: 20,
  operatorInstructions: 2000,
  apifyGlobs: 20,
  apifyGlob: 240,
} as const;

export const LEGAL_WATCH_COLLECTOR_PROVIDERS = ["native", "apify"] as const;
export type LegalWatchCollectorProvider = (typeof LEGAL_WATCH_COLLECTOR_PROVIDERS)[number];

export const LEGAL_WATCH_APIFY_CRAWLER_TYPES = [
  "playwright:adaptive",
  "playwright:firefox",
  "cheerio",
] as const;
export type LegalWatchApifyCrawlerType = (typeof LEGAL_WATCH_APIFY_CRAWLER_TYPES)[number];

export const DEFAULT_LEGAL_WATCH_APIFY_ACTOR_ID = "apify/website-content-crawler";
export const DEFAULT_LEGAL_WATCH_APIFY_MAX_PAGES = 1;
export const MAX_LEGAL_WATCH_APIFY_MAX_PAGES = 5;
export const DEFAULT_LEGAL_WATCH_APIFY_WAIT_SECS = 90;
export const MAX_LEGAL_WATCH_APIFY_WAIT_SECS = 180;
export const DEFAULT_LEGAL_WATCH_APIFY_REQUEST_TIMEOUT_SECS = 60;
export const MAX_LEGAL_WATCH_APIFY_REQUEST_TIMEOUT_SECS = 180;

export interface LegalWatchApifyProviderConfig {
  actorId: string;
  crawlerType: LegalWatchApifyCrawlerType;
  maxPagesPerRun: number;
  waitForFinishSecs: number;
  requestTimeoutSecs: number;
  respectRobotsTxt: boolean;
  useProxy: boolean;
  includeUrlGlobs: string[];
  excludeUrlGlobs: string[];
}

export interface LegalWatchSourceProviderConfig {
  collectorProvider: LegalWatchCollectorProvider;
  apify: LegalWatchApifyProviderConfig;
}

export type RoutineSourceConfigMetadata = Record<string, unknown>;

export interface RoutineSourceConfigRow {
  sourceKey: string;
  title: string;
  url: string;
  sourceType: string;
  authority: string;
  jurisdiction: string;
  topicTags: string[];
  fetchMode: string;
  checkFrequency: string;
  stalenessRisk: string;
  trustTier: string;
  status: string;
  metadata: RoutineSourceConfigMetadata;
}

export interface RoutineSourceValidationOutcome<T> {
  value?: T;
  error?: string;
}

const SOURCE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOPIC_TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROVENANCE_REQUIREMENT_PATTERN = /^[a-z0-9_:-]+$/;
const JURISDICTION_PATTERN = /^[A-Z]{2}(?:-[A-Z0-9]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boolValue(value: unknown): boolean {
  return value === true;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function numberValue(value: unknown, fallback: number, options: { min: number; max: number }): number {
  const next = typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : typeof value === "string" && value.trim()
      ? Math.trunc(Number(value))
      : fallback;
  if (!Number.isFinite(next)) return fallback;
  return Math.min(Math.max(next, options.min), options.max);
}

function allowedValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export function sourceKeyFromTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "custom-source";
}

export function isOperatorConfiguredSource(source: { metadata?: unknown }): boolean {
  return metadataRecord(source.metadata).operatorConfigured === true;
}

export function readLegalWatchApifyAllowedActorIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = typeof env.LEGAL_WATCH_APIFY_ALLOWED_ACTORS === "string"
    ? env.LEGAL_WATCH_APIFY_ALLOWED_ACTORS.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  return configured.length > 0 ? configured : [DEFAULT_LEGAL_WATCH_APIFY_ACTOR_ID];
}

export function isLegalWatchApifyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.LEGAL_WATCH_APIFY_ENABLED;
  return value === "1" || value === "true";
}

export function readLegalWatchSourceProviderConfig(
  source: { metadata?: unknown },
): LegalWatchSourceProviderConfig {
  const metadata = metadataRecord(source.metadata);
  const actorId = stringValue(metadata.apifyActorId, DEFAULT_LEGAL_WATCH_APIFY_ACTOR_ID);
  return {
    collectorProvider: allowedValue(
      metadata.collectorProvider,
      LEGAL_WATCH_COLLECTOR_PROVIDERS,
      "native",
    ),
    apify: {
      actorId,
      crawlerType: allowedValue(
        metadata.apifyCrawlerType,
        LEGAL_WATCH_APIFY_CRAWLER_TYPES,
        "playwright:adaptive",
      ),
      maxPagesPerRun: numberValue(
        metadata.apifyMaxPagesPerRun,
        DEFAULT_LEGAL_WATCH_APIFY_MAX_PAGES,
        { min: 1, max: MAX_LEGAL_WATCH_APIFY_MAX_PAGES },
      ),
      waitForFinishSecs: numberValue(
        metadata.apifyWaitForFinishSecs,
        DEFAULT_LEGAL_WATCH_APIFY_WAIT_SECS,
        { min: 10, max: MAX_LEGAL_WATCH_APIFY_WAIT_SECS },
      ),
      requestTimeoutSecs: numberValue(
        metadata.apifyRequestTimeoutSecs,
        DEFAULT_LEGAL_WATCH_APIFY_REQUEST_TIMEOUT_SECS,
        { min: 10, max: MAX_LEGAL_WATCH_APIFY_REQUEST_TIMEOUT_SECS },
      ),
      respectRobotsTxt: metadata.apifyRespectRobotsTxt === true,
      useProxy: metadata.apifyUseProxy !== false,
      includeUrlGlobs: stringArray(metadata.apifyIncludeUrlGlobs)
        .slice(0, ROUTINE_SOURCE_CONFIG_LIMITS.apifyGlobs),
      excludeUrlGlobs: stringArray(metadata.apifyExcludeUrlGlobs)
        .slice(0, ROUTINE_SOURCE_CONFIG_LIMITS.apifyGlobs),
    },
  };
}

export function routineSourceToDefinition(
  source: RoutineSourceConfigRow,
): RoutineSourceDefinition {
  const metadata = metadataRecord(source.metadata);
  const providerConfig = readLegalWatchSourceProviderConfig(source);
  const fetchMode = allowedValue(source.fetchMode, ROUTINE_SOURCE_FETCH_MODES, "http_html");
  return {
    sourceKey: source.sourceKey,
    title: source.title,
    url: source.url,
    sourceType: allowedValue(source.sourceType, ROUTINE_SOURCE_TYPES, "official_guidance"),
    authority: source.authority,
    jurisdiction: source.jurisdiction,
    topicTags: stringArray(source.topicTags),
    fetchMode,
    checkFrequency: allowedValue(source.checkFrequency, ROUTINE_SOURCE_CHECK_FREQUENCIES, "manual"),
    stalenessRisk: allowedValue(source.stalenessRisk, ROUTINE_SOURCE_STALENESS_RISKS, "medium"),
    trustTier: allowedValue(source.trustTier, ROUTINE_SOURCE_TRUST_TIERS, "official"),
    status: allowedValue(source.status, ROUTINE_SOURCE_STATUSES, "paused"),
    allowedContentTypes:
      stringArray(metadata.allowedContentTypes).filter((item) =>
        ROUTINE_SOURCE_CONTENT_TYPES.includes(item as never),
      ) as RoutineSourceDefinition["allowedContentTypes"],
    useFor: stringValue(metadata.useFor, source.title),
    provenanceRequirements: stringArray(metadata.provenanceRequirements),
    verifiedAsOf: stringValue(metadata.verifiedAsOf, new Date().toISOString().slice(0, 10)),
    allowedUrlPrefixes: stringArray(metadata.allowedUrlPrefixes),
    instrumentNumber: typeof metadata.instrumentNumber === "string" ? metadata.instrumentNumber : undefined,
    sourceDate: typeof metadata.sourceDate === "string" ? metadata.sourceDate : undefined,
    discoveryOnly: boolValue(metadata.discoveryOnly),
    primarySourceRequired: boolValue(metadata.primarySourceRequired),
    secondaryCommentaryOnly: boolValue(metadata.secondaryCommentaryOnly),
    notes: stringArray(metadata.notes),
    metadata: {
      operatorConfigured: metadata.operatorConfigured === true,
      operatorInstructions:
        typeof metadata.operatorInstructions === "string"
          ? metadata.operatorInstructions
          : undefined,
      collectorProvider: providerConfig.collectorProvider,
      apifyActorId: providerConfig.apify.actorId,
      apifyCrawlerType: providerConfig.apify.crawlerType,
      apifyMaxPagesPerRun: providerConfig.apify.maxPagesPerRun,
      apifyWaitForFinishSecs: providerConfig.apify.waitForFinishSecs,
      apifyRequestTimeoutSecs: providerConfig.apify.requestTimeoutSecs,
      apifyRespectRobotsTxt: providerConfig.apify.respectRobotsTxt,
      apifyUseProxy: providerConfig.apify.useProxy,
      apifyIncludeUrlGlobs: providerConfig.apify.includeUrlGlobs,
      apifyExcludeUrlGlobs: providerConfig.apify.excludeUrlGlobs,
    },
  };
}

export function validateRoutineSourceConfig(
  source: RoutineSourceConfigRow,
): RoutineSourceValidationOutcome<RoutineSourceDefinition> {
  const definition = routineSourceToDefinition(source);
  try {
    assertLegalWatchSafeHttpsUrl(definition.url, "url");
    for (const prefix of definition.allowedUrlPrefixes ?? []) {
      assertLegalWatchSafeHttpsUrl(prefix, "allowedUrlPrefixes");
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid source URL" };
  }
  const result = validateRoutineSource(definition);
  if (!result.valid) {
    return {
      error: result.issues
        .map((issue) => `${issue.field ?? issue.sourceKey ?? "source"}: ${issue.message}`)
        .join("; "),
    };
  }
  return { value: definition };
}

function validateHttpsUrl(value: unknown, label: string): RoutineSourceValidationOutcome<string> {
  if (typeof value !== "string" || !value.trim()) return { error: `${label} is required` };
  try {
    const url = assertLegalWatchSafeHttpsUrl(value.trim(), label);
    return { value: url.toString() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : `${label} must be a valid URL` };
  }
}

function validateStringArray(
  value: unknown,
  label: string,
  maxItems: number,
  options?: { pattern?: RegExp; maxLength?: number; allowEmpty?: boolean },
): RoutineSourceValidationOutcome<string[]> {
  if (value === undefined) return { value: undefined };
  if (!Array.isArray(value)) return { error: `${label} must be an array` };
  if (value.length > maxItems) return { error: `${label} cannot exceed ${maxItems} items` };
  const items: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") return { error: `${label} must contain strings` };
    const item = raw.trim();
    if (!item) continue;
    if (options?.maxLength && item.length > options.maxLength) {
      return { error: `${label} items cannot exceed ${options.maxLength} characters` };
    }
    if (options?.pattern && !options.pattern.test(item)) {
      return { error: `${label} contains invalid value ${item}` };
    }
    items.push(item);
  }
  if (!options?.allowEmpty && value.length > 0 && items.length === 0) {
    return { error: `${label} cannot contain only empty values` };
  }
  return { value: items };
}

function validateAllowedPrefixes(
  value: unknown,
  sourceUrl: string,
): RoutineSourceValidationOutcome<string[] | undefined> {
  const prefixes = validateStringArray(
    value,
    "allowedUrlPrefixes",
    ROUTINE_SOURCE_CONFIG_LIMITS.allowedUrlPrefixes,
  );
  if (prefixes.error || !prefixes.value) return prefixes;
  const sourceHost = new URL(sourceUrl).hostname;
  const normalized: string[] = [];
  for (const prefix of prefixes.value) {
    const valid = validateHttpsUrl(prefix, "allowedUrlPrefixes");
    if (valid.error || !valid.value) return { error: valid.error };
    const prefixUrl = new URL(valid.value);
    if (prefixUrl.hostname !== sourceHost) {
      return { error: "allowedUrlPrefixes must stay on the source host" };
    }
    normalized.push(normalizeRoutineSourceUrlPrefix(valid.value));
  }
  return { value: normalized };
}

function patchString(
  patch: Record<string, unknown>,
  key: string,
  maxLength: number,
): RoutineSourceValidationOutcome<string | undefined> {
  if (patch[key] === undefined) return { value: undefined };
  if (typeof patch[key] !== "string" || !patch[key].trim()) {
    return { error: `${key} must be a non-empty string` };
  }
  return { value: truncate(patch[key].trim(), maxLength) };
}

const FORBIDDEN_PROVIDER_METADATA_KEYS = [
  "apifyToken",
  "apifyApiKey",
  "apiKey",
  "token",
  "secret",
  "authorization",
  "headers",
  "customHttpHeaders",
  "initialCookies",
] as const;

const APIFY_PROVIDER_METADATA_KEYS = [
  "collectorProvider",
  "apifyActorId",
  "apifyCrawlerType",
  "apifyMaxPagesPerRun",
  "apifyWaitForFinishSecs",
  "apifyRequestTimeoutSecs",
  "apifyRespectRobotsTxt",
  "apifyUseProxy",
  "apifyIncludeUrlGlobs",
  "apifyExcludeUrlGlobs",
] as const;

function rejectProviderSecrets(metadataPatch: Record<string, unknown>): string | null {
  for (const key of Object.keys(metadataPatch)) {
    if (
      FORBIDDEN_PROVIDER_METADATA_KEYS.includes(key as never) ||
      /token|secret|apikey|api_key|authorization/i.test(key)
    ) {
      return `${key} cannot be stored in source metadata`;
    }
  }
  return null;
}

function patchInteger(
  patch: Record<string, unknown>,
  key: string,
  options: { min: number; max: number },
): RoutineSourceValidationOutcome<number | undefined> {
  if (patch[key] === undefined) return { value: undefined };
  const value = typeof patch[key] === "number" ? patch[key] : Number(patch[key]);
  if (!Number.isInteger(value)) return { error: `${key} must be an integer` };
  if (value < options.min || value > options.max) {
    return { error: `${key} must be between ${options.min} and ${options.max}` };
  }
  return { value };
}

function patchBoolean(
  patch: Record<string, unknown>,
  key: string,
): RoutineSourceValidationOutcome<boolean | undefined> {
  if (patch[key] === undefined) return { value: undefined };
  if (typeof patch[key] !== "boolean") return { error: `${key} must be boolean` };
  return { value: patch[key] };
}

function applyProviderMetadataPatch(input: {
  metadataPatch: Record<string, unknown>;
  nextMetadata: Record<string, unknown>;
}): RoutineSourceValidationOutcome<{ changed: boolean }> {
  const secretError = rejectProviderSecrets(input.metadataPatch);
  if (secretError) return { error: secretError };

  let changed = false;
  const markChanged = (key: string, value: unknown) => {
    input.nextMetadata[key] = value;
    changed = true;
  };

  if (input.metadataPatch.collectorProvider !== undefined) {
    if (
      typeof input.metadataPatch.collectorProvider !== "string" ||
      !LEGAL_WATCH_COLLECTOR_PROVIDERS.includes(input.metadataPatch.collectorProvider as never)
    ) {
      return { error: "collectorProvider is not allowlisted" };
    }
    markChanged("collectorProvider", input.metadataPatch.collectorProvider);
  }

  const actorId = patchString(input.metadataPatch, "apifyActorId", 120);
  if (actorId.error) return { error: actorId.error };
  if (actorId.value !== undefined) {
    if (!readLegalWatchApifyAllowedActorIds().includes(actorId.value)) {
      return { error: "apifyActorId is not allowlisted" };
    }
    markChanged("apifyActorId", actorId.value);
  }

  if (input.metadataPatch.apifyCrawlerType !== undefined) {
    if (
      typeof input.metadataPatch.apifyCrawlerType !== "string" ||
      !LEGAL_WATCH_APIFY_CRAWLER_TYPES.includes(input.metadataPatch.apifyCrawlerType as never)
    ) {
      return { error: "apifyCrawlerType is not allowlisted" };
    }
    markChanged("apifyCrawlerType", input.metadataPatch.apifyCrawlerType);
  }

  const integerPatches = [
    [
      "apifyMaxPagesPerRun",
      { min: 1, max: MAX_LEGAL_WATCH_APIFY_MAX_PAGES },
    ],
    [
      "apifyWaitForFinishSecs",
      { min: 10, max: MAX_LEGAL_WATCH_APIFY_WAIT_SECS },
    ],
    [
      "apifyRequestTimeoutSecs",
      { min: 10, max: MAX_LEGAL_WATCH_APIFY_REQUEST_TIMEOUT_SECS },
    ],
  ] as const;
  for (const [key, options] of integerPatches) {
    const value = patchInteger(input.metadataPatch, key, options);
    if (value.error) return { error: value.error };
    if (value.value !== undefined) markChanged(key, value.value);
  }

  for (const key of ["apifyRespectRobotsTxt", "apifyUseProxy"]) {
    const value = patchBoolean(input.metadataPatch, key);
    if (value.error) return { error: value.error };
    if (value.value !== undefined) markChanged(key, value.value);
  }

  for (const key of ["apifyIncludeUrlGlobs", "apifyExcludeUrlGlobs"]) {
    const value = validateStringArray(
      input.metadataPatch[key],
      key,
      ROUTINE_SOURCE_CONFIG_LIMITS.apifyGlobs,
      { maxLength: ROUTINE_SOURCE_CONFIG_LIMITS.apifyGlob, allowEmpty: true },
    );
    if (value.error) return { error: value.error };
    if (value.value !== undefined) markChanged(key, value.value);
  }

  const finalProviderConfig = readLegalWatchSourceProviderConfig({ metadata: input.nextMetadata });
  if (
    finalProviderConfig.collectorProvider === "apify" &&
    !readLegalWatchApifyAllowedActorIds().includes(finalProviderConfig.apify.actorId)
  ) {
    return { error: "apifyActorId is not allowlisted" };
  }

  return { value: { changed } };
}

export function buildRoutineSourceConfigPatch(input: {
  existing: RoutineSourceConfigRow;
  patch: Record<string, unknown>;
  changedByUserId: string;
}): RoutineSourceValidationOutcome<{
  fields: Partial<Omit<RoutineSourceConfigRow, "metadata" | "sourceKey">>;
  metadata: Record<string, unknown>;
  resetObservationState: boolean;
}> {
  const fields: Partial<Omit<RoutineSourceConfigRow, "metadata" | "sourceKey">> = {};
  const metadataPatch = metadataRecord(input.patch.metadata);
  const existingMetadata = metadataRecord(input.existing.metadata);
  const nextMetadata: Record<string, unknown> = { ...existingMetadata };
  const hasFieldPatch = [
    "title",
    "authority",
    "url",
    "jurisdiction",
    "sourceType",
    "fetchMode",
    "checkFrequency",
    "stalenessRisk",
    "trustTier",
    "status",
    "topicTags",
  ].some((key) => input.patch[key] !== undefined);
  if (!hasFieldPatch && Object.keys(metadataPatch).length === 0) {
    return { error: "Provide source config update" };
  }

  const title = patchString(input.patch, "title", ROUTINE_SOURCE_CONFIG_LIMITS.title);
  if (title.error) return { error: title.error };
  if (title.value !== undefined) fields.title = title.value;

  const authority = patchString(input.patch, "authority", ROUTINE_SOURCE_CONFIG_LIMITS.authority);
  if (authority.error) return { error: authority.error };
  if (authority.value !== undefined) fields.authority = authority.value;

  if (input.patch.url !== undefined) {
    const url = validateHttpsUrl(input.patch.url, "url");
    if (url.error || !url.value) return { error: url.error };
    fields.url = url.value;
  }

  if (input.patch.jurisdiction !== undefined) {
    if (typeof input.patch.jurisdiction !== "string" || !JURISDICTION_PATTERN.test(input.patch.jurisdiction)) {
      return { error: "jurisdiction must be an uppercase jurisdiction code" };
    }
    fields.jurisdiction = input.patch.jurisdiction;
  }

  const enumFields = [
    ["sourceType", ROUTINE_SOURCE_TYPES],
    ["fetchMode", ROUTINE_SOURCE_FETCH_MODES],
    ["checkFrequency", ROUTINE_SOURCE_CHECK_FREQUENCIES],
    ["stalenessRisk", ROUTINE_SOURCE_STALENESS_RISKS],
    ["trustTier", ROUTINE_SOURCE_TRUST_TIERS],
    ["status", ROUTINE_SOURCE_STATUSES],
  ] as const;
  for (const [key, allowed] of enumFields) {
    const value = input.patch[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !allowed.includes(value as never)) {
      return { error: `${key} is not allowlisted` };
    }
    (fields as Record<string, unknown>)[key] = value;
  }

  if (input.patch.topicTags !== undefined) {
    const topicTags = validateStringArray(input.patch.topicTags, "topicTags", 20, {
      pattern: TOPIC_TAG_PATTERN,
    });
    if (topicTags.error || !topicTags.value) return { error: topicTags.error };
    fields.topicTags = topicTags.value;
  }

  const useFor = patchString(metadataPatch, "useFor", ROUTINE_SOURCE_CONFIG_LIMITS.useFor);
  if (useFor.error) return { error: useFor.error };
  if (useFor.value !== undefined) nextMetadata.useFor = useFor.value;

  const operatorInstructions = patchString(
    metadataPatch,
    "operatorInstructions",
    ROUTINE_SOURCE_CONFIG_LIMITS.operatorInstructions,
  );
  if (operatorInstructions.error) return { error: operatorInstructions.error };
  if (operatorInstructions.value !== undefined) nextMetadata.operatorInstructions = operatorInstructions.value;

  const notes = validateStringArray(metadataPatch.notes, "notes", ROUTINE_SOURCE_CONFIG_LIMITS.notes, {
    maxLength: ROUTINE_SOURCE_CONFIG_LIMITS.note,
    allowEmpty: true,
  });
  if (notes.error) return { error: notes.error };
  if (notes.value !== undefined) nextMetadata.notes = notes.value;

  const provenanceRequirements = validateStringArray(
    metadataPatch.provenanceRequirements,
    "provenanceRequirements",
    ROUTINE_SOURCE_CONFIG_LIMITS.provenanceRequirements,
    { pattern: PROVENANCE_REQUIREMENT_PATTERN },
  );
  if (provenanceRequirements.error) return { error: provenanceRequirements.error };
  if (provenanceRequirements.value !== undefined) {
    nextMetadata.provenanceRequirements = provenanceRequirements.value;
  }

  const allowedContentTypes = validateStringArray(
    metadataPatch.allowedContentTypes,
    "allowedContentTypes",
    ROUTINE_SOURCE_CONTENT_TYPES.length,
  );
  if (allowedContentTypes.error) return { error: allowedContentTypes.error };
  if (allowedContentTypes.value !== undefined) {
    const invalid = allowedContentTypes.value.find((item) =>
      !ROUTINE_SOURCE_CONTENT_TYPES.includes(item as never),
    );
    if (invalid) return { error: `allowedContentTypes contains invalid value ${invalid}` };
    nextMetadata.allowedContentTypes = allowedContentTypes.value;
  }

  const nextUrl = fields.url ?? input.existing.url;
  const allowedUrlPrefixes = validateAllowedPrefixes(metadataPatch.allowedUrlPrefixes, nextUrl);
  if (allowedUrlPrefixes.error) return { error: allowedUrlPrefixes.error };
  if (allowedUrlPrefixes.value !== undefined) {
    nextMetadata.allowedUrlPrefixes = allowedUrlPrefixes.value;
  }

  const providerPatch = applyProviderMetadataPatch({ metadataPatch, nextMetadata });
  if (providerPatch.error || !providerPatch.value) return { error: providerPatch.error };

  for (const key of ["primarySourceRequired", "discoveryOnly", "secondaryCommentaryOnly"]) {
    if (metadataPatch[key] === undefined) continue;
    if (typeof metadataPatch[key] !== "boolean") return { error: `${key} must be boolean` };
    nextMetadata[key] = metadataPatch[key];
  }

  nextMetadata.operatorConfigured = true;
  nextMetadata.configRevision = Number(existingMetadata.configRevision ?? 0) + 1;
  nextMetadata.configChangedAt = new Date().toISOString();
  nextMetadata.configChangedByUserId = input.changedByUserId;

  const merged: RoutineSourceConfigRow = {
    ...input.existing,
    ...fields,
    metadata: nextMetadata,
  };
  const validation = validateRoutineSourceConfig(merged);
  if (validation.error) return { error: validation.error };

  const providerConfigChanged = APIFY_PROVIDER_METADATA_KEYS.some((key) => metadataPatch[key] !== undefined);
  const resetObservationState = Boolean(
    fields.url ||
      fields.fetchMode ||
      fields.status ||
      fields.sourceType ||
      fields.trustTier ||
      metadataPatch.allowedContentTypes ||
      metadataPatch.allowedUrlPrefixes ||
      providerConfigChanged,
  );
  return { value: { fields, metadata: nextMetadata, resetObservationState } };
}

export function buildCustomRoutineSourceConfig(input: {
  body: Record<string, unknown>;
  changedByUserId: string;
}): RoutineSourceValidationOutcome<RoutineSourceDefinition> {
  const title = stringValue(input.body.title, "");
  const url = validateHttpsUrl(input.body.url, "url");
  if (!title) return { error: "title is required" };
  if (url.error || !url.value) return { error: url.error };
  const metadata = metadataRecord(input.body.metadata);
  const sourceKey = stringValue(input.body.sourceKey, `custom-${sourceKeyFromTitle(title)}`);
  if (!SOURCE_KEY_PATTERN.test(sourceKey)) return { error: "sourceKey must be a stable lowercase slug" };
  const source: RoutineSourceConfigRow = {
    sourceKey,
    title: truncate(title, ROUTINE_SOURCE_CONFIG_LIMITS.title),
    url: url.value,
    sourceType: allowedValue(input.body.sourceType, ROUTINE_SOURCE_TYPES, "official_guidance"),
    authority: truncate(stringValue(input.body.authority, "Operator configured source"), ROUTINE_SOURCE_CONFIG_LIMITS.authority),
    jurisdiction: stringValue(input.body.jurisdiction, "ID"),
    topicTags: stringArray(input.body.topicTags).length > 0 ? stringArray(input.body.topicTags) : ["bkpm"],
    fetchMode: allowedValue(input.body.fetchMode, ROUTINE_SOURCE_FETCH_MODES, "http_html"),
    checkFrequency: allowedValue(input.body.checkFrequency, ROUTINE_SOURCE_CHECK_FREQUENCIES, "manual"),
    stalenessRisk: allowedValue(input.body.stalenessRisk, ROUTINE_SOURCE_STALENESS_RISKS, "medium"),
    trustTier: allowedValue(input.body.trustTier, ROUTINE_SOURCE_TRUST_TIERS, "official"),
    status: allowedValue(input.body.status, ROUTINE_SOURCE_STATUSES, "paused"),
    metadata: {
      allowedContentTypes: stringArray(metadata.allowedContentTypes).length > 0
        ? stringArray(metadata.allowedContentTypes)
        : ["text/html"],
      allowedUrlPrefixes: stringArray(metadata.allowedUrlPrefixes).length > 0
        ? stringArray(metadata.allowedUrlPrefixes)
        : [new URL(url.value).origin],
      useFor: stringValue(metadata.useFor, title),
      provenanceRequirements: stringArray(metadata.provenanceRequirements).length > 0
        ? stringArray(metadata.provenanceRequirements)
        : ["official_source", "review_before_promotion"],
      verifiedAsOf: stringValue(metadata.verifiedAsOf, new Date().toISOString().slice(0, 10)),
      notes: stringArray(metadata.notes),
      primarySourceRequired: metadata.primarySourceRequired !== false,
      discoveryOnly: boolValue(metadata.discoveryOnly),
      secondaryCommentaryOnly: boolValue(metadata.secondaryCommentaryOnly),
      operatorInstructions:
        typeof metadata.operatorInstructions === "string"
          ? truncate(metadata.operatorInstructions.trim(), ROUTINE_SOURCE_CONFIG_LIMITS.operatorInstructions)
          : "",
      operatorConfigured: true,
      configRevision: 1,
      configChangedAt: new Date().toISOString(),
      configChangedByUserId: input.changedByUserId,
      customSource: true,
    },
  };
  const providerPatch = applyProviderMetadataPatch({
    metadataPatch: metadata,
    nextMetadata: source.metadata,
  });
  if (providerPatch.error) return { error: providerPatch.error };
  const validation = validateRoutineSourceConfig(source);
  if (validation.error) return { error: validation.error };
  return { value: validation.value };
}
