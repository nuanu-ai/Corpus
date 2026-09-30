import { parseQmd, toQmd } from "@/lib/company-db/summary/qmd";

import { normalizePersonLifecycleStatus } from "./crm";

type LifecycleStatus = "active" | "archived" | "merged";

function toStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (!trimmed) continue;
    next[key] = trimmed;
  }
  return next;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function mergeStringMaps(
  preferred: Record<string, string>,
  fallback: Record<string, string>,
): Record<string, string> {
  return {
    ...fallback,
    ...preferred,
  };
}

function mergeStringArrays(...values: unknown[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    for (const item of toStringArray(value)) {
      if (seen.has(item)) continue;
      seen.add(item);
      next.push(item);
    }
  }
  return next;
}

function minDate(left: unknown, right: unknown): string | null {
  const values = [left, right]
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return values[0] ?? null;
}

function maxDate(left: unknown, right: unknown): string | null {
  const values = [left, right]
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return values[0] ?? null;
}

function parseCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stripSummaryHeading(body: string): string {
  return body.replace(/^## Summary\s*/gim, "").trim();
}

function mergeSummaryBodies(targetBody: string, sourceBody: string): string {
  const parts = [stripSummaryHeading(targetBody), stripSummaryHeading(sourceBody)]
    .map((value) => value.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);

  if (parts.length === 0) {
    return "## Summary\nNo narrative summary recorded yet.";
  }

  return ["## Summary", ...parts].join("\n");
}

function setLifecycleFields(
  frontmatter: Record<string, unknown>,
  input: {
    status: LifecycleStatus;
    updatedBy: string;
    mergedInto?: string | null;
  },
) {
  const now = new Date().toISOString();
  frontmatter.crm_status = input.status;
  frontmatter.crm_updated_by = input.updatedBy;
  frontmatter.crm_updated_at = now;
  frontmatter.updated_at = now;

  if (input.status === "merged" && input.mergedInto) {
    frontmatter.merged_into = input.mergedInto;
  } else {
    delete frontmatter.merged_into;
  }

  if (input.status === "archived") {
    frontmatter.archived_at = now;
    frontmatter.archived_by = input.updatedBy;
  } else {
    delete frontmatter.archived_at;
    delete frontmatter.archived_by;
  }
}

export function archivePersonProfileQmd(
  rawQmd: string,
  input: { updatedBy: string },
): string {
  const parsed = parseQmd(rawQmd);
  const frontmatter = { ...parsed.frontmatter };
  setLifecycleFields(frontmatter, {
    status: "archived",
    updatedBy: input.updatedBy,
  });
  return toQmd(frontmatter, parsed.body);
}

export function mergePersonProfilesQmd(input: {
  targetRawQmd: string;
  sourceRawQmd: string;
  targetFilePath: string;
  updatedBy: string;
}): { targetContent: string; sourceContent: string } {
  const target = parseQmd(input.targetRawQmd);
  const source = parseQmd(input.sourceRawQmd);

  const targetFrontmatter = { ...target.frontmatter };
  const sourceFrontmatter = { ...source.frontmatter };

  const targetSourceMessageIds = mergeStringArrays(
    targetFrontmatter.source_message_ids,
    sourceFrontmatter.source_message_ids,
  );
  const interactionCount = Math.max(
    targetSourceMessageIds.length,
    parseCount(targetFrontmatter.interaction_count) ?? 0,
    parseCount(sourceFrontmatter.interaction_count) ?? 0,
  );

  targetFrontmatter.display_name = firstNonEmpty(
    targetFrontmatter.display_name,
    sourceFrontmatter.display_name,
    targetFrontmatter.name,
    sourceFrontmatter.name,
  );
  targetFrontmatter.role = firstNonEmpty(targetFrontmatter.role, sourceFrontmatter.role);
  targetFrontmatter.organization = firstNonEmpty(
    targetFrontmatter.organization,
    sourceFrontmatter.organization,
  );
  targetFrontmatter.related_companies = mergeStringArrays(
    targetFrontmatter.related_companies,
    sourceFrontmatter.related_companies,
  );
  targetFrontmatter.analysis_context = firstNonEmpty(
    targetFrontmatter.analysis_context,
    sourceFrontmatter.analysis_context,
  );
  targetFrontmatter.channels = mergeStringMaps(
    toStringMap(targetFrontmatter.channels),
    toStringMap(sourceFrontmatter.channels),
  );
  targetFrontmatter.crm_channels = mergeStringMaps(
    toStringMap(targetFrontmatter.crm_channels),
    toStringMap(sourceFrontmatter.crm_channels),
  );
  targetFrontmatter.tags = mergeStringArrays(targetFrontmatter.tags, sourceFrontmatter.tags);
  targetFrontmatter.domains = mergeStringArrays(targetFrontmatter.domains, sourceFrontmatter.domains);
  targetFrontmatter.source_message_ids = targetSourceMessageIds;
  targetFrontmatter.interaction_count = interactionCount;
  targetFrontmatter.first_seen = minDate(
    targetFrontmatter.first_seen,
    sourceFrontmatter.first_seen,
  ) ?? targetFrontmatter.first_seen;
  targetFrontmatter.last_interaction = maxDate(
    targetFrontmatter.last_interaction,
    sourceFrontmatter.last_interaction,
  ) ?? targetFrontmatter.last_interaction;
  targetFrontmatter.overall_confidence = Math.max(
    parseCount(targetFrontmatter.overall_confidence) ?? 0,
    parseCount(sourceFrontmatter.overall_confidence) ?? 0,
  );
  targetFrontmatter.crm_description = firstNonEmpty(
    targetFrontmatter.crm_description,
    sourceFrontmatter.crm_description,
  );
  targetFrontmatter.next_action = firstNonEmpty(
    targetFrontmatter.next_action,
    sourceFrontmatter.next_action,
  );
  targetFrontmatter.owner = firstNonEmpty(targetFrontmatter.owner, sourceFrontmatter.owner);
  targetFrontmatter.action_required =
    targetFrontmatter.action_required === true || sourceFrontmatter.action_required === true;
  setLifecycleFields(targetFrontmatter, {
    status: "active",
    updatedBy: input.updatedBy,
  });

  setLifecycleFields(sourceFrontmatter, {
    status: "merged",
    updatedBy: input.updatedBy,
    mergedInto: input.targetFilePath,
  });

  return {
    targetContent: toQmd(targetFrontmatter, mergeSummaryBodies(target.body, source.body)),
    sourceContent: toQmd(
      sourceFrontmatter,
      "## Summary\nMerged into another CRM profile. Historical evidence is retained here for audit purposes.",
    ),
  };
}

export function isActivePersonLifecycle(value: unknown): boolean {
  return normalizePersonLifecycleStatus(value) === "active";
}
