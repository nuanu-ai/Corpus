import { createHash } from "crypto";
import { readdir, readFile } from "fs/promises";
import { join, relative, resolve } from "path";

import { z } from "zod";

import { parseQmd, toQmd } from "@/lib/company-db/summary/qmd";

import { agentContextConfidenceSchema } from "./schema";

export const AGENT_CONTEXT_SOURCE_ROOT = "operations/agent-context";
export const AGENT_CONTEXT_PROFILE_SOURCE_PATH = `${AGENT_CONTEXT_SOURCE_ROOT}/profile.qmd`;
export const AGENT_CONTEXT_SOURCE_MAP_PATH = `${AGENT_CONTEXT_SOURCE_ROOT}/source-map.qmd`;
export const AGENT_CONTEXT_FRESHNESS_PATH = `${AGENT_CONTEXT_SOURCE_ROOT}/freshness.qmd`;

const MAX_SOURCE_FILES = 24;
const MAX_SOURCE_FILE_BYTES = 64_000;
const MAX_SOURCE_BODY_CHARS = 4_000;

const agentContextSourceKindSchema = z.enum([
  "profile",
  "source_map",
  "rule",
  "caveat",
  "freshness",
  "entity_aliases",
]);

const sourceStringArraySchema = z.array(z.string().min(1)).default([]);

const nullableStringSchema = z.string().min(1).nullable().optional();

const sourceProfileFieldsSchema = z.object({
  website: nullableStringSchema,
  businessType: nullableStringSchema,
  business_type: nullableStringSchema,
  jurisdiction: nullableStringSchema,
  entityType: nullableStringSchema,
  entity_type: nullableStringSchema,
  aliases: sourceStringArraySchema.optional(),
  reportingCurrency: nullableStringSchema,
  reporting_currency: nullableStringSchema,
}).passthrough();

const sourceMapSpecSchema = z.object({
  id: z.string().min(1).optional(),
  claimType: z.string().min(1).optional(),
  claim_type: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  preferredSource: z.string().min(1).optional(),
  preferred_source: z.string().min(1).optional(),
  fallbackSource: z.string().min(1).nullable().optional(),
  fallback_source: z.string().min(1).nullable().optional(),
  verificationRequired: z.boolean().optional(),
  verification_required: z.boolean().optional(),
  forbiddenShortcut: z.string().min(1).nullable().optional(),
  forbidden_shortcut: z.string().min(1).nullable().optional(),
  tags: sourceStringArraySchema.optional(),
  confidence: agentContextConfidenceSchema.optional(),
  updatedAt: z.string().min(1).optional(),
  updated_at: z.string().min(1).optional(),
}).passthrough();

const ruleSpecSchema = z.object({
  id: z.string().min(1).optional(),
  kind: z.enum(["rule", "caveat", "must_not_do"]).optional(),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  tags: sourceStringArraySchema.optional(),
  confidence: agentContextConfidenceSchema.optional(),
  updatedAt: z.string().min(1).optional(),
  updated_at: z.string().min(1).optional(),
}).passthrough();

const freshnessNoteSpecSchema = z.object({
  id: z.string().min(1).optional(),
  sourceKey: z.string().min(1).optional(),
  source_key: z.string().min(1).optional(),
  provider: z.string().min(1).nullable().optional(),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  status: z.enum(["active", "configured", "stale", "missing", "failed", "blocked", "unknown"]).optional(),
  lastSyncedAt: z.string().min(1).nullable().optional(),
  last_synced_at: z.string().min(1).nullable().optional(),
  lastError: z.string().min(1).nullable().optional(),
  last_error: z.string().min(1).nullable().optional(),
  expectedSyncIntervalMs: z.number().int().positive().nullable().optional(),
  expected_sync_interval_ms: z.number().int().positive().nullable().optional(),
  tags: sourceStringArraySchema.optional(),
  confidence: agentContextConfidenceSchema.optional(),
  updatedAt: z.string().min(1).optional(),
  updated_at: z.string().min(1).optional(),
}).passthrough();

const entityAliasSpecSchema = z.object({
  id: z.string().min(1).optional(),
  operatingEntityId: z.string().min(1).optional(),
  operating_entity_id: z.string().min(1).optional(),
  canonicalName: z.string().min(1).optional(),
  canonical_name: z.string().min(1).optional(),
  aliases: sourceStringArraySchema.optional(),
  objectType: z.string().min(1).optional(),
  object_type: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  tags: sourceStringArraySchema.optional(),
  confidence: agentContextConfidenceSchema.optional(),
  updatedAt: z.string().min(1).optional(),
  updated_at: z.string().min(1).optional(),
}).passthrough();

const sourceProvenanceSchema = z.object({
  source: z.string().min(1),
  source_path: z.string().min(1).optional(),
  source_id: z.string().min(1).optional(),
}).passthrough();

export const agentContextSourceFileFrontmatterSchema = z.object({
  id: z.string().min(1),
  type: z.literal("agent_context_source"),
  kind: agentContextSourceKindSchema,
  company_id: z.string().min(1).optional(),
  company_slug: z.string().min(1).optional(),
  title: z.string().min(1),
  status: z.enum(["active", "draft", "archived"]).default("active"),
  confidence: agentContextConfidenceSchema.default("medium"),
  updated_at: z.string().min(1),
  stale_after: z.string().min(1).nullable().optional(),
  provenance: sourceProvenanceSchema.optional(),
  tags: sourceStringArraySchema,
  profile: sourceProfileFieldsSchema.optional(),
  source_maps: z.array(sourceMapSpecSchema).default([]),
  rules: z.array(ruleSpecSchema).default([]),
  caveats: z.array(ruleSpecSchema).default([]),
  freshness_notes: z.array(freshnessNoteSpecSchema).default([]),
  entity_aliases: z.array(entityAliasSpecSchema).default([]),
}).passthrough();

export type AgentContextSourceFileFrontmatter = z.infer<
  typeof agentContextSourceFileFrontmatterSchema
>;
export type AgentContextSourceMapSpec = z.infer<typeof sourceMapSpecSchema>;
export type AgentContextRuleSpec = z.infer<typeof ruleSpecSchema>;
export type AgentContextFreshnessNoteSpec = z.infer<typeof freshnessNoteSpecSchema>;
export type AgentContextEntityAliasSpec = z.infer<typeof entityAliasSpecSchema>;

export type AgentContextSourceFile = {
  path: string;
  frontmatter: AgentContextSourceFileFrontmatter;
  body: string;
  contentHash: string;
};

export type MaterializedAgentContextSourceFile = {
  path: string;
  content: string;
  frontmatter: AgentContextSourceFileFrontmatter;
};

export function normalizeAgentContextSourcePath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return null;

  const sourcePath = parts.join("/");
  if (!sourcePath.startsWith(`${AGENT_CONTEXT_SOURCE_ROOT}/`)) return null;
  if (!sourcePath.endsWith(".qmd")) return null;
  if (sourcePath.endsWith("/_summary.qmd")) return null;

  const relativePath = sourcePath.slice(AGENT_CONTEXT_SOURCE_ROOT.length + 1);
  if (["profile.qmd", "source-map.qmd", "freshness.qmd"].includes(relativePath)) {
    return sourcePath;
  }

  if (/^(rules|caveats|entities|playbooks)\/[A-Za-z0-9][A-Za-z0-9._-]*\.qmd$/.test(relativePath)) {
    return sourcePath;
  }

  return null;
}

export function parseAgentContextSourceFile(input: {
  path: string;
  raw: string;
  maxBodyChars?: number;
}): AgentContextSourceFile | null {
  const sourcePath = normalizeAgentContextSourcePath(input.path);
  if (!sourcePath) return null;
  if (Buffer.byteLength(input.raw, "utf8") > MAX_SOURCE_FILE_BYTES) return null;

  const parsed = parseQmd(input.raw);
  const frontmatter = agentContextSourceFileFrontmatterSchema.safeParse(parsed.frontmatter);
  if (!frontmatter.success) return null;
  if (!isKindCompatibleWithPath(frontmatter.data.kind, sourcePath)) return null;

  const maxBodyChars = input.maxBodyChars ?? MAX_SOURCE_BODY_CHARS;
  const body = parsed.body.length > maxBodyChars
    ? parsed.body.slice(0, maxBodyChars)
    : parsed.body;

  return {
    path: sourcePath,
    frontmatter: frontmatter.data,
    body,
    contentHash: `sha256:${createHash("sha256").update(input.raw).digest("hex")}`,
  };
}

export async function readAgentContextSourceFilesFromDirectory(input: {
  repoRoot: string;
  companyId: string;
  companySlug?: string | null;
  maxFiles?: number;
}): Promise<{ sourceFiles: AgentContextSourceFile[]; warnings: string[] }> {
  const root = resolve(input.repoRoot);
  const sourceRoot = resolve(root, AGENT_CONTEXT_SOURCE_ROOT);
  const maxFiles = Math.min(input.maxFiles ?? MAX_SOURCE_FILES, MAX_SOURCE_FILES);
  const warnings: string[] = [];
  const sourceFiles: AgentContextSourceFile[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (sourceFiles.length >= maxFiles || depth > 4) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (dir !== sourceRoot) warnings.push(`Unable to read Agent Context source directory ${dir}: ${(err as Error).message}`);
      return;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (sourceFiles.length >= maxFiles) break;
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".qmd")) continue;

      const relativePath = relative(root, fullPath).replace(/\\/g, "/");
      const sourcePath = normalizeAgentContextSourcePath(relativePath);
      if (!sourcePath) continue;

      try {
        const raw = await readFile(fullPath, "utf8");
        const parsed = parseAgentContextSourceFile({ path: sourcePath, raw });
        if (!parsed) {
          warnings.push(`Ignored invalid Agent Context source file ${sourcePath}.`);
          continue;
        }
        if (!isAgentContextSourceFileForCompany(parsed, {
          companyId: input.companyId,
          companySlug: input.companySlug ?? null,
        })) {
          warnings.push(`Ignored Agent Context source file outside resolved company scope: ${sourcePath}.`);
          continue;
        }
        sourceFiles.push(parsed);
      } catch (err) {
        warnings.push(`Unable to read Agent Context source file ${sourcePath}: ${(err as Error).message}`);
      }
    }
  }

  await walk(sourceRoot, 0);
  return { sourceFiles, warnings };
}

export function isAgentContextSourceFileForCompany(
  file: AgentContextSourceFile,
  company: { companyId: string; companySlug?: string | null },
): boolean {
  const fileCompanyId = file.frontmatter.company_id?.trim();
  const fileCompanySlug = file.frontmatter.company_slug?.trim().toLowerCase();
  const companySlug = company.companySlug?.trim().toLowerCase();

  if (fileCompanyId && fileCompanyId !== company.companyId) return false;
  if (fileCompanySlug && companySlug && fileCompanySlug !== companySlug) return false;
  if (fileCompanySlug && !companySlug) return false;

  return Boolean(fileCompanyId || fileCompanySlug);
}

export function isAgentContextSourceFileStale(
  file: AgentContextSourceFile,
  now: Date,
): boolean {
  const staleAfter = file.frontmatter.stale_after;
  if (!staleAfter) return false;
  const staleAfterMs = new Date(staleAfter).getTime();
  return Number.isFinite(staleAfterMs) && staleAfterMs < now.getTime();
}

export function getAgentContextSourceFileUpdatedAt(file: AgentContextSourceFile): string {
  return normalizeIso(file.frontmatter.updated_at) ?? file.frontmatter.updated_at;
}

export function buildAgentContextProfileSourceFile(input: {
  company: {
    id: string;
    name: string;
    slug?: string | null;
    website?: string | null;
    businessType?: string | null;
    jurisdiction?: string | null;
    entityType?: string | null;
    aliases?: readonly string[] | null;
    reportingCurrency?: string | null;
  };
  updatedAt?: string | Date;
}): MaterializedAgentContextSourceFile {
  const updatedAt = normalizeIso(input.updatedAt ?? new Date()) ?? new Date().toISOString();
  const frontmatter = agentContextSourceFileFrontmatterSchema.parse({
    id: "agent-context-profile",
    type: "agent_context_source",
    kind: "profile",
    company_id: input.company.id,
    company_slug: input.company.slug ?? undefined,
    title: `${input.company.name} Agent Context profile`,
    status: "active",
    confidence: "high",
    updated_at: updatedAt,
    provenance: {
      source: "company_profile",
      source_path: "companies.profile",
      source_id: input.company.id,
    },
    tags: ["company-profile", "materialized"],
    profile: {
      website: normalizeOptionalString(input.company.website),
      business_type: normalizeOptionalString(input.company.businessType),
      jurisdiction: normalizeOptionalString(input.company.jurisdiction),
      entity_type: normalizeOptionalString(input.company.entityType),
      aliases: normalizeStringList(input.company.aliases ?? []),
      reporting_currency: normalizeOptionalString(input.company.reportingCurrency),
    },
  });

  return {
    path: AGENT_CONTEXT_PROFILE_SOURCE_PATH,
    frontmatter,
    content: toQmd(
      frontmatter,
      [
        "Materialized Agent Context source for existing company profile fields.",
        "This file is durable reviewable context; runtime company profile storage remains authoritative for API responses.",
      ].join("\n"),
    ),
  };
}

function isKindCompatibleWithPath(
  kind: AgentContextSourceFileFrontmatter["kind"],
  path: string,
): boolean {
  const relativePath = path.slice(AGENT_CONTEXT_SOURCE_ROOT.length + 1);
  if (relativePath === "profile.qmd") return kind === "profile";
  if (relativePath === "source-map.qmd") return kind === "source_map";
  if (relativePath === "freshness.qmd") return kind === "freshness";
  if (relativePath.startsWith("rules/")) return kind === "rule" || kind === "caveat";
  if (relativePath.startsWith("caveats/")) return kind === "caveat" || kind === "rule";
  if (relativePath.startsWith("entities/")) return kind === "entity_aliases";
  if (relativePath.startsWith("playbooks/")) return kind === "rule" || kind === "caveat";
  return false;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeStringList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const item = normalizeOptionalString(value);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized;
}

function normalizeIso(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
