import { parseQmd } from "@/lib/company-db/summary/qmd";
import type { EntityResult } from "@/lib/company-db/client";

export interface PendingPeopleSignal {
  id: string;
  title: string;
  summary: string;
  targetDomain: string;
  sourceLabel?: string | null;
  structuredData?: Record<string, unknown>;
  proposedFrontmatter?: Record<string, unknown>;
}

export interface PersonActionItem {
  id: string;
  kind: "manual" | "pending_signal";
  title: string;
  summary: string;
  sourceLabel?: string | null;
  targetDomain?: string | null;
}

export interface PersonRecord {
  qualifiedId: string;
  filePath: string;
  profileKind: "contact" | "organization";
  crmStatus: "active" | "archived" | "merged";
  mergedInto: string | null;
  name: string;
  displayName: string | null;
  role: string | null;
  organization: string | null;
  relatedCompanies: string[];
  analysisContext: string | null;
  observedChannels: Record<string, string>;
  crmChannels: Record<string, string>;
  channels: Record<string, string>;
  tags: string[];
  domains: string[];
  lastInteraction: string | null;
  interactionCount: number | null;
  confidence: number | null;
  sourceMessageCount: number;
  autoDescription: string | null;
  manualDescription: string | null;
  manualActionRequired: boolean;
  manualNextAction: string | null;
  description: string | null;
  actionRequired: boolean;
  nextAction: string | null;
  owner: string | null;
  actions: PersonActionItem[];
}

function toStringArray(value: unknown, limit = 24): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
    if (next.length >= limit) break;
  }
  return next;
}

function toStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    next[key] = trimmed;
  }
  return next;
}

function toRelatedCompanyNames(value: unknown, limit = 24): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of value) {
    let rawName: unknown = entry;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const source = entry as Record<string, unknown>;
      rawName = source.name ?? source.company ?? source.company_name ?? source.title;
    }
    if (typeof rawName !== "string") continue;
    const name = rawName.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    next.push(name);
    if (next.length >= limit) break;
  }
  return next;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHeadingBlock(body: string): string {
  return body
    .replace(/^## Summary\s*/gim, "")
    .trim();
}

export function extractAutoDescription(body: string): string | null {
  const stripped = stripHeadingBlock(body);
  if (!stripped) return null;

  const firstParagraph = stripped
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !part.startsWith("#"));

  if (!firstParagraph) return null;
  return firstParagraph.slice(0, 600);
}

function buildNeedles(frontmatter: Record<string, unknown>): string[] {
  const candidates = [
    typeof frontmatter.name === "string" ? frontmatter.name : null,
    typeof frontmatter.display_name === "string" ? frontmatter.display_name : null,
    typeof frontmatter.organization === "string" ? frontmatter.organization : null,
    ...toRelatedCompanyNames(frontmatter.related_companies),
    ...Object.values(toStringMap(frontmatter.channels)),
    ...Object.values(toStringMap(frontmatter.crm_channels)),
  ];

  const seen = new Set<string>();
  const needles: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeText(candidate);
    if (normalized.length < 3 || seen.has(normalized)) continue;
    seen.add(normalized);
    needles.push(normalized);
  }
  return needles;
}

function buildSignalHaystack(signal: PendingPeopleSignal): string {
  const frontmatter = signal.proposedFrontmatter ?? {};
  const structured = signal.structuredData ?? {};
  const parts = [
    signal.title,
    signal.summary,
    signal.sourceLabel ?? "",
    ...toStringArray(structured.participants),
    ...toStringArray(structured.counterparties),
    ...toStringArray(frontmatter.participants),
    ...toStringArray(frontmatter.counterparties),
    typeof frontmatter.title === "string" ? frontmatter.title : "",
    typeof frontmatter.name === "string" ? frontmatter.name : "",
  ];
  return normalizeText(parts.join(" "));
}

function matchSignalAction(
  needles: string[],
  signal: PendingPeopleSignal,
): PersonActionItem | null {
  const haystack = buildSignalHaystack(signal);
  if (!haystack) return null;
  if (!needles.some((needle) => haystack.includes(needle))) return null;

  return {
    id: signal.id,
    kind: "pending_signal",
    title: signal.title,
    summary: signal.summary,
    sourceLabel: signal.sourceLabel ?? null,
    targetDomain: signal.targetDomain,
  };
}

function detectProfileKind(filePath: string): "contact" | "organization" | null {
  if (filePath.startsWith("people/contacts/")) return "contact";
  if (filePath.startsWith("people/organizations/")) return "organization";
  return null;
}

export function normalizePersonLifecycleStatus(value: unknown): "active" | "archived" | "merged" {
  if (value === "archived" || value === "merged") return value;
  return "active";
}

export function buildPersonRecord(
  entity: EntityResult,
  rawQmd: string,
  pendingSignals: PendingPeopleSignal[],
): PersonRecord | null {
  const profileKind = detectProfileKind(entity.filePath);
  if (!profileKind) return null;

  const parsed = parseQmd(rawQmd);
  const frontmatter = parsed.frontmatter;
  const crmStatus = normalizePersonLifecycleStatus(frontmatter.crm_status);
  const name =
    (typeof frontmatter.name === "string" && frontmatter.name.trim()) ||
    (typeof frontmatter.title === "string" && frontmatter.title.trim()) ||
    null;

  if (!name) return null;

  const autoDescription = extractAutoDescription(parsed.body);
  const manualDescription =
    typeof frontmatter.crm_description === "string" && frontmatter.crm_description.trim()
      ? frontmatter.crm_description.trim()
      : null;
  const observedChannels = toStringMap(frontmatter.channels);
  const crmChannels = toStringMap(frontmatter.crm_channels);
  const relatedCompanies = toRelatedCompanyNames(frontmatter.related_companies);
  const analysisContext =
    typeof frontmatter.analysis_context === "string" && frontmatter.analysis_context.trim()
      ? frontmatter.analysis_context.trim()
      : null;

  const needles = buildNeedles(frontmatter);
  const actions = pendingSignals
    .map((signal) => matchSignalAction(needles, signal))
    .filter((item): item is PersonActionItem => item !== null);

  const manualActionRequired = frontmatter.action_required === true;
  const manualNextAction =
    typeof frontmatter.next_action === "string" && frontmatter.next_action.trim()
      ? frontmatter.next_action.trim()
      : null;

  if (manualActionRequired || manualNextAction) {
    actions.unshift({
      id: `${entity.qualifiedId}:manual`,
      kind: "manual",
      title: manualNextAction ?? "Manual follow-up required",
      summary: manualNextAction ?? "This profile is marked for manual follow-up.",
      sourceLabel: null,
      targetDomain: "people",
    });
  }

  return {
    qualifiedId: entity.qualifiedId,
    filePath: entity.filePath,
    profileKind,
    crmStatus,
    mergedInto:
      typeof frontmatter.merged_into === "string" && frontmatter.merged_into.trim()
        ? frontmatter.merged_into.trim()
        : null,
    name,
    displayName:
      typeof frontmatter.display_name === "string" && frontmatter.display_name.trim()
        ? frontmatter.display_name.trim()
        : null,
    role:
      typeof frontmatter.role === "string" && frontmatter.role.trim()
        ? frontmatter.role.trim()
        : null,
    organization:
      typeof frontmatter.organization === "string" && frontmatter.organization.trim()
        ? frontmatter.organization.trim()
        : null,
    relatedCompanies,
    analysisContext,
    observedChannels,
    crmChannels,
    channels: {
      ...observedChannels,
      ...crmChannels,
    },
    tags: toStringArray(frontmatter.tags),
    domains: toStringArray(frontmatter.domains),
    lastInteraction:
      typeof frontmatter.last_interaction === "string" ? frontmatter.last_interaction : null,
    interactionCount: parseNumber(frontmatter.interaction_count),
    confidence: parseNumber(frontmatter.overall_confidence),
    sourceMessageCount: toStringArray(frontmatter.source_message_ids, 200).length,
    autoDescription,
    manualDescription,
    manualActionRequired,
    manualNextAction,
    description: manualDescription ?? autoDescription,
    actionRequired: manualActionRequired || Boolean(manualNextAction) || actions.length > 0,
    nextAction: manualNextAction ?? actions[0]?.title ?? null,
    owner:
      typeof frontmatter.owner === "string" && frontmatter.owner.trim()
        ? frontmatter.owner.trim()
        : null,
    actions,
  };
}
