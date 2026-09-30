import { createHash } from "crypto";

import { parseQmd, toQmd } from "@/lib/company-db/summary/qmd";
import {
  normalizeCommitmentEscalationLevel,
  normalizeCommitmentResolutionKind,
  normalizeCommitmentStatus,
  resolveCommitmentDueDate,
} from "@/lib/communications/commitments";
import type {
  BuiltCommunicationFile,
  CommunicationContact,
  CommunicationMessageRow,
  CommunicationOrganization,
  CommunicationSignal,
  CommunicationThreadContext,
  CommunicationsSynthesis,
} from "@/lib/communications/types";

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function slugify(value: string, fallback = "item"): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized.length > 0 ? normalized : fallback;
}

export function buildThreadSlug(
  provider: string,
  providerThreadId: string,
  _fallbackLabel: string,
): string {
  void _fallbackLabel;
  return `${slugify(provider, "provider")}-${shortHash(providerThreadId)}`;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string =>
        Boolean(value && value.trim().length > 0),
      ),
    ),
  );
}

function buildStableEntitySlug(
  value: string | null | undefined,
  prefix: string,
): string {
  const normalized = value ? slugify(value, "") : "";
  if (normalized.length > 0) return normalized;
  return `${prefix}-${shortHash(value?.trim() || prefix)}`;
}

function stripSummaryHeading(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.replace(/^## Summary\s*/gim, "").trim() || null;
}

function mergeSourceMessageIds(existing: unknown, next: string[]): string[] {
  const prior = Array.isArray(existing) ? existing.map(String) : [];
  return uniqueStrings([...prior, ...next]);
}

function formatStructuredAmounts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0)
    return ["- No structured amounts extracted."];
  return value.map((entry) => {
    const amount =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : {};
    const parts = [String(amount.value ?? "")].filter(
      (part) => part.length > 0,
    );
    if (typeof amount.currency === "string" && amount.currency.trim())
      parts.push(amount.currency.trim());
    if (typeof amount.unit === "string" && amount.unit.trim())
      parts.push(amount.unit.trim());
    const context =
      typeof amount.context === "string" ? amount.context.trim() : "";
    if (context) parts.push(`(${context})`);
    return parts.length > 0
      ? `- ${parts.join(" ")}`
      : "- Structured amount present.";
  });
}

function formatStructuredDates(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0)
    return ["- No explicit dates extracted."];
  return value.map((entry) => {
    const record =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : {};
    const date = typeof record.date === "string" ? record.date.trim() : "";
    const meaning =
      typeof record.meaning === "string" ? record.meaning.trim() : "";
    if (date && meaning) return `- ${date}: ${meaning}`;
    if (date) return `- ${date}`;
    return "- Date extracted without normalized label.";
  });
}

function isSignalWithLifecycle(signalType: unknown): boolean {
  return signalType === "commitment" || signalType === "deadline";
}

function buildCommitmentLifecycleLines(
  frontmatter: Record<string, unknown>,
): string[] {
  if (
    !isSignalWithLifecycle(
      frontmatter.signal_type ?? frontmatter.target_entity_type,
    )
  )
    return [];

  const status = normalizeCommitmentStatus(frontmatter.commitment_status);
  const escalationLevel = normalizeCommitmentEscalationLevel(
    frontmatter.escalation_level,
  );
  const due = resolveCommitmentDueDate({
    dates: frontmatter.dates,
    signalType: String(
      frontmatter.signal_type ?? frontmatter.target_entity_type,
    ) as "commitment" | "deadline",
    anchorDayKey:
      typeof frontmatter.day_key === "string" ? frontmatter.day_key : null,
    explicitDueDate: frontmatter.due_date,
    explicitDueDateLabel: frontmatter.due_date_label,
    explicitDueDateMeaning: frontmatter.due_date_meaning,
  });
  const resolutionKind = normalizeCommitmentResolutionKind(
    frontmatter.resolution_kind,
  );
  const resolutionSummary =
    typeof frontmatter.resolution_summary === "string"
      ? frontmatter.resolution_summary.trim()
      : "";
  const resolvedAt =
    typeof frontmatter.resolved_at === "string"
      ? frontmatter.resolved_at.trim()
      : "";

  const lines = [`- Status: ${status}`];
  if (due.dueDate || due.dueDateLabel) {
    lines.push(`- Due: ${due.dueDate ?? due.dueDateLabel}`);
  }
  if (due.dueDateMeaning) {
    lines.push(`- Due context: ${due.dueDateMeaning}`);
  }
  if (escalationLevel) {
    lines.push(`- Escalation: ${escalationLevel.toUpperCase()}`);
  }
  if (resolutionKind) {
    lines.push(`- Resolution: ${resolutionKind}`);
  }
  if (resolvedAt) {
    lines.push(`- Resolved at: ${resolvedAt}`);
  }
  if (resolutionSummary) {
    lines.push(`- Resolution note: ${resolutionSummary}`);
  }
  return lines;
}

function buildCommunicationSignalBodyFromFrontmatter(
  frontmatter: Record<string, unknown>,
): string {
  const summary =
    typeof frontmatter.signal_summary === "string" &&
    frontmatter.signal_summary.trim().length > 0
      ? frontmatter.signal_summary.trim()
      : typeof frontmatter.summary === "string" &&
          frontmatter.summary.trim().length > 0
        ? frontmatter.summary.trim()
        : "No narrative summary recorded.";
  const sourceMessageIds = Array.isArray(frontmatter.source_message_ids)
    ? frontmatter.source_message_ids.map(String)
    : [];
  const sourceLabel =
    typeof frontmatter.thread_label === "string"
      ? frontmatter.thread_label
      : "Unknown thread";
  const lifecycleLines = buildCommitmentLifecycleLines(frontmatter);

  return [
    "## Executive summary",
    summary,
    "",
    ...(lifecycleLines.length > 0 ? ["## Status", ...lifecycleLines, ""] : []),
    "## Amounts",
    ...formatStructuredAmounts(frontmatter.amounts),
    "",
    "## Dates and deadlines",
    ...formatStructuredDates(frontmatter.dates),
    "",
    "## Evidence",
    `- Source thread: ${sourceLabel}`,
    `- Source messages: ${sourceMessageIds.join(", ")}`,
  ].join("\n");
}

export interface CommitmentLifecyclePatch {
  status?: "open" | "completed" | "cancelled";
  escalationLevel?: "l1" | "l2" | "l3" | null;
  lastEscalatedAt?: string | null;
  resolvedAt?: string | null;
  resolutionKind?: "completion" | "cancellation" | null;
  resolutionSummary?: string | null;
  resolutionSourceMessageIds?: string[];
}

export function applyCommitmentLifecycleToSignalQmd(
  raw: string,
  patch: CommitmentLifecyclePatch,
): string {
  const parsed = parseQmd(raw);
  const frontmatter = {
    ...parsed.frontmatter,
  };
  if (
    !isSignalWithLifecycle(
      frontmatter.signal_type ?? frontmatter.target_entity_type,
    )
  ) {
    return raw;
  }

  if (patch.status) {
    frontmatter.commitment_status = patch.status;
  }
  if (patch.escalationLevel !== undefined) {
    frontmatter.escalation_level = patch.escalationLevel;
  }
  if (patch.lastEscalatedAt !== undefined) {
    frontmatter.last_escalated_at = patch.lastEscalatedAt;
  }
  if (patch.resolvedAt !== undefined) {
    frontmatter.resolved_at = patch.resolvedAt;
  }
  if (patch.resolutionKind !== undefined) {
    frontmatter.resolution_kind = patch.resolutionKind;
  }
  if (patch.resolutionSummary !== undefined) {
    frontmatter.resolution_summary = patch.resolutionSummary;
  }
  if (patch.resolutionSourceMessageIds !== undefined) {
    frontmatter.resolution_source_message_ids = mergeSourceMessageIds(
      frontmatter.resolution_source_message_ids,
      patch.resolutionSourceMessageIds,
    );
    frontmatter.source_message_ids = mergeSourceMessageIds(
      frontmatter.source_message_ids,
      patch.resolutionSourceMessageIds,
    );
  }

  if (
    frontmatter.commitment_status === "completed" ||
    frontmatter.commitment_status === "cancelled"
  ) {
    frontmatter.escalation_level = null;
  }

  frontmatter.updated_at = new Date().toISOString();
  return toQmd(
    frontmatter,
    buildCommunicationSignalBodyFromFrontmatter(frontmatter),
  );
}

export function buildCommunicationDailyLogFile(input: {
  provider: string;
  providerThreadId: string;
  threadSlug: string;
  dayKey: string;
  sourceLabel: string;
  synthesis: CommunicationsSynthesis;
  messages: CommunicationMessageRow[];
}): BuiltCommunicationFile {
  const id = `comm-daily-${input.dayKey}-${shortHash(`${input.providerThreadId}:${input.dayKey}`)}`;
  const participants = uniqueStrings(
    input.messages.flatMap((message) => [
      message.senderName,
      message.senderAddress,
      ...message.participantAddresses,
    ]),
  );

  const frontmatter = {
    id,
    type: "communication_daily_log",
    title: `${input.sourceLabel} — ${input.dayKey}`,
    provider: input.provider,
    thread_key: input.providerThreadId,
    thread_slug: input.threadSlug,
    thread_label: input.sourceLabel,
    day_key: input.dayKey,
    source_message_ids: input.messages.map((message) => message.id),
    message_count: input.messages.length,
    participants,
    signal_count: input.synthesis.signals.length,
    key_themes: input.synthesis.signals
      .flatMap((signal) => signal.keyThemes)
      .slice(0, 8),
    risks: input.synthesis.signals
      .flatMap((signal) => signal.risks)
      .slice(0, 8),
    overall_confidence:
      input.synthesis.signals.length > 0
        ? String(
            Math.max(
              0,
              Math.round(
                (input.synthesis.signals.reduce(
                  (sum, signal) => sum + signal.confidence,
                  0,
                ) /
                  input.synthesis.signals.length) *
                  100,
              ) / 100,
            ),
          )
        : "1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const body = [
    "## Executive summary",
    input.synthesis.dailySummary,
    "",
    "## Key signals",
    ...(input.synthesis.signals.length > 0
      ? input.synthesis.signals.map(
          (signal) => `- ${signal.title}: ${signal.summary}`,
        )
      : ["- No decision-grade signals extracted for this batch."]),
    "",
    "## Ongoing threads",
    ...(input.synthesis.ongoingThreads.length > 0
      ? input.synthesis.ongoingThreads.map(
          (thread) =>
            `- ${thread.topic}: ${thread.status} | ${thread.lastContext}`,
        )
      : ["- No open communication threads carried forward."]),
    "",
    "## Source evidence",
    `- Messages in batch: ${input.messages.length}`,
    `- Participants: ${participants.join(", ") || "N/A"}`,
  ].join("\n");

  return {
    path: `communications/daily/${input.dayKey}-${input.threadSlug}.qmd`,
    content: toQmd(frontmatter, body),
  };
}

export function buildCommunicationSignalFile(input: {
  provider: string;
  providerThreadId: string;
  threadSlug: string;
  sourceLabel: string;
  dayKey: string;
  signal: CommunicationSignal;
  sourceMessageIds: string[];
}): BuiltCommunicationFile {
  const signalHash = shortHash(
    `${input.providerThreadId}:${input.signal.title}:${input.signal.summary}:${input.sourceMessageIds.join(",")}`,
  );
  const due = isSignalWithLifecycle(input.signal.type)
    ? resolveCommitmentDueDate({
        dates: input.signal.dates,
        signalType: input.signal.type as "commitment" | "deadline",
        anchorDayKey: input.dayKey,
      })
    : {
        dueDate: null,
        dueDateLabel: null,
        dueDateMeaning: null,
      };
  const frontmatter = {
    id: `comm-signal-${signalHash}`,
    type: "communication_signal",
    title: input.signal.title,
    signal_summary: input.signal.summary,
    provider: input.provider,
    thread_key: input.providerThreadId,
    thread_slug: input.threadSlug,
    thread_label: input.sourceLabel,
    signal_type: input.signal.type,
    target_domain: input.signal.targetDomain,
    participants: input.signal.participants,
    counterparties: input.signal.counterparties,
    amounts: input.signal.amounts,
    dates: input.signal.dates,
    key_themes: input.signal.keyThemes,
    risks: input.signal.risks,
    source_message_ids: input.sourceMessageIds,
    overall_confidence: String(input.signal.confidence),
    document_kind: "communication_signal",
    target_entity_type: input.signal.type,
    day_key: input.dayKey,
    commitment_status: isSignalWithLifecycle(input.signal.type) ? "open" : null,
    due_date: due.dueDate,
    due_date_label: due.dueDateLabel,
    due_date_meaning: due.dueDateMeaning,
    escalation_level: null,
    last_escalated_at: null,
    resolved_at: null,
    resolution_kind: null,
    resolution_summary: null,
    resolution_source_message_ids: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const body = buildCommunicationSignalBodyFromFrontmatter(frontmatter);

  return {
    path: `communications/signals/${input.dayKey}-${slugify(input.signal.title, "signal")}-${signalHash}.qmd`,
    content: toQmd(frontmatter, body),
  };
}

export function buildCommunicationContextFile(input: {
  provider: string;
  providerThreadId: string;
  threadSlug: string;
  sourceLabel: string;
  ongoingThreads: CommunicationThreadContext[];
  sourceMessageIds: string[];
}): BuiltCommunicationFile {
  const frontmatter = {
    id: `comm-context-${shortHash(input.providerThreadId)}`,
    type: "communication_thread_context",
    title: `${input.sourceLabel} context`,
    provider: input.provider,
    thread_key: input.providerThreadId,
    thread_slug: input.threadSlug,
    thread_label: input.sourceLabel,
    active_topics: input.ongoingThreads.map((thread) => thread.topic),
    active_topic_count: input.ongoingThreads.length,
    source_message_ids: input.sourceMessageIds,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const body = [
    "## Active threads",
    ...(input.ongoingThreads.length > 0
      ? input.ongoingThreads.map(
          (thread) =>
            `- ${thread.topic}: ${thread.status} | ${thread.lastContext}`,
        )
      : ["- No active thread context retained."]),
  ].join("\n");

  return {
    path: `communications/context/${input.threadSlug}.qmd`,
    content: toQmd(frontmatter, body),
  };
}

function mergeEntityNotes(
  existingBody: string | null | undefined,
  nextNotes: string | null | undefined,
): string {
  const parts = uniqueStrings([
    stripSummaryHeading(existingBody),
    stripSummaryHeading(nextNotes),
  ]);
  if (parts.length === 0)
    return "## Summary\nNo narrative summary recorded yet.";
  return ["## Summary", ...parts].join("\n");
}

export function buildContactFile(input: {
  contact: CommunicationContact;
  existing?: { frontmatter: Record<string, unknown>; body: string } | null;
  lastInteraction: string;
  filePath?: string;
}): BuiltCommunicationFile {
  const slugSource =
    input.contact.email ??
    input.contact.telegramHandle ??
    input.contact.phone ??
    input.contact.name;
  const slug = buildStableEntitySlug(slugSource, "contact");
  const existingFrontmatter = input.existing?.frontmatter ?? {};
  const channels: Record<string, string> = {
    ...(typeof existingFrontmatter.channels === "object" &&
    existingFrontmatter.channels !== null
      ? (existingFrontmatter.channels as Record<string, string>)
      : {}),
  };
  if (input.contact.email) channels.email = input.contact.email;
  if (input.contact.phone) channels.phone = input.contact.phone;
  if (input.contact.telegramHandle)
    channels.telegram = input.contact.telegramHandle;

  const mergedSourceMessageIds = mergeSourceMessageIds(
    existingFrontmatter.source_message_ids,
    input.contact.sourceMessageIds,
  );
  const frontmatter = {
    id:
      typeof existingFrontmatter.id === "string"
        ? existingFrontmatter.id
        : `people-contact-${slug}`,
    type: "contact_profile",
    title: input.contact.name,
    name: input.contact.name,
    display_name:
      typeof existingFrontmatter.display_name === "string" &&
      existingFrontmatter.display_name.trim()
        ? existingFrontmatter.display_name
        : (input.contact.displayName ?? input.contact.name),
    role:
      typeof existingFrontmatter.role === "string" &&
      existingFrontmatter.role.trim()
        ? existingFrontmatter.role
        : input.contact.role,
    organization:
      typeof existingFrontmatter.organization === "string" &&
      existingFrontmatter.organization.trim()
        ? existingFrontmatter.organization
        : (input.contact.organizationName ?? null),
    related_companies: Array.isArray(existingFrontmatter.related_companies)
      ? existingFrontmatter.related_companies
      : [],
    analysis_context:
      typeof existingFrontmatter.analysis_context === "string" &&
      existingFrontmatter.analysis_context.trim()
        ? existingFrontmatter.analysis_context
        : null,
    channels,
    crm_channels:
      typeof existingFrontmatter.crm_channels === "object" &&
      existingFrontmatter.crm_channels !== null
        ? existingFrontmatter.crm_channels
        : {},
    tags: uniqueStrings([
      ...(Array.isArray(existingFrontmatter.tags)
        ? existingFrontmatter.tags.map(String)
        : []),
      ...input.contact.tags,
    ]),
    first_seen:
      typeof existingFrontmatter.first_seen === "string"
        ? existingFrontmatter.first_seen
        : input.lastInteraction,
    last_interaction: input.lastInteraction,
    interaction_count: Math.max(1, mergedSourceMessageIds.length),
    overall_confidence: String(input.contact.confidence),
    source_message_ids: mergedSourceMessageIds,
    crm_description:
      typeof existingFrontmatter.crm_description === "string"
        ? existingFrontmatter.crm_description
        : null,
    action_required: existingFrontmatter.action_required === true,
    next_action:
      typeof existingFrontmatter.next_action === "string"
        ? existingFrontmatter.next_action
        : null,
    owner:
      typeof existingFrontmatter.owner === "string"
        ? existingFrontmatter.owner
        : null,
    crm_updated_by:
      typeof existingFrontmatter.crm_updated_by === "string"
        ? existingFrontmatter.crm_updated_by
        : null,
    crm_updated_at:
      typeof existingFrontmatter.crm_updated_at === "string"
        ? existingFrontmatter.crm_updated_at
        : null,
    crm_status:
      typeof existingFrontmatter.crm_status === "string"
        ? existingFrontmatter.crm_status
        : "active",
    merged_into:
      typeof existingFrontmatter.merged_into === "string"
        ? existingFrontmatter.merged_into
        : null,
    created_at:
      typeof existingFrontmatter.created_at === "string"
        ? existingFrontmatter.created_at
        : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    path: input.filePath ?? `people/contacts/${slug}.qmd`,
    content: toQmd(
      frontmatter,
      mergeEntityNotes(input.existing?.body, input.contact.notes ?? null),
    ),
  };
}

export function buildOrganizationFile(input: {
  organization: CommunicationOrganization;
  existing?: { frontmatter: Record<string, unknown>; body: string } | null;
  lastInteraction: string;
}): BuiltCommunicationFile {
  const slug = buildStableEntitySlug(input.organization.name, "organization");
  const existingFrontmatter = input.existing?.frontmatter ?? {};
  const mergedSourceMessageIds = mergeSourceMessageIds(
    existingFrontmatter.source_message_ids,
    input.organization.sourceMessageIds,
  );
  const frontmatter = {
    id:
      typeof existingFrontmatter.id === "string"
        ? existingFrontmatter.id
        : `organization-${slug}`,
    type: "organization_profile",
    title: input.organization.name,
    name: input.organization.name,
    role:
      typeof existingFrontmatter.role === "string" &&
      existingFrontmatter.role.trim()
        ? existingFrontmatter.role
        : input.organization.role,
    display_name:
      typeof existingFrontmatter.display_name === "string" &&
      existingFrontmatter.display_name.trim()
        ? existingFrontmatter.display_name
        : input.organization.name,
    domains: uniqueStrings([
      ...(Array.isArray(existingFrontmatter.domains)
        ? existingFrontmatter.domains.map(String)
        : []),
      ...input.organization.domains,
    ]),
    crm_channels:
      typeof existingFrontmatter.crm_channels === "object" &&
      existingFrontmatter.crm_channels !== null
        ? existingFrontmatter.crm_channels
        : {},
    relationship_since:
      typeof existingFrontmatter.relationship_since === "string"
        ? existingFrontmatter.relationship_since
        : input.lastInteraction,
    last_interaction: input.lastInteraction,
    overall_confidence: String(input.organization.confidence),
    source_message_ids: mergedSourceMessageIds,
    crm_description:
      typeof existingFrontmatter.crm_description === "string"
        ? existingFrontmatter.crm_description
        : null,
    action_required: existingFrontmatter.action_required === true,
    next_action:
      typeof existingFrontmatter.next_action === "string"
        ? existingFrontmatter.next_action
        : null,
    owner:
      typeof existingFrontmatter.owner === "string"
        ? existingFrontmatter.owner
        : null,
    crm_updated_by:
      typeof existingFrontmatter.crm_updated_by === "string"
        ? existingFrontmatter.crm_updated_by
        : null,
    crm_updated_at:
      typeof existingFrontmatter.crm_updated_at === "string"
        ? existingFrontmatter.crm_updated_at
        : null,
    crm_status:
      typeof existingFrontmatter.crm_status === "string"
        ? existingFrontmatter.crm_status
        : "active",
    merged_into:
      typeof existingFrontmatter.merged_into === "string"
        ? existingFrontmatter.merged_into
        : null,
    created_at:
      typeof existingFrontmatter.created_at === "string"
        ? existingFrontmatter.created_at
        : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    path: `people/organizations/${slug}.qmd`,
    content: toQmd(
      frontmatter,
      mergeEntityNotes(input.existing?.body, input.organization.notes ?? null),
    ),
  };
}

export function buildApprovedSignalImportFile(input: {
  signal: CommunicationSignal;
  targetDomain: string;
  sourceLabel: string;
  threadSlug: string;
  providerThreadId: string;
  sourceMessageIds: string[];
}): BuiltCommunicationFile {
  const signalHash = shortHash(
    `${input.targetDomain}:${input.providerThreadId}:${input.signal.title}:${input.signal.summary}`,
  );
  const frontmatter = {
    id: `comm-approved-${signalHash}`,
    type: "communication_signal_import",
    title: input.signal.title,
    document_kind: "communication_signal",
    target_entity_type: input.signal.type,
    target_domain: input.targetDomain,
    thread_key: input.providerThreadId,
    thread_slug: input.threadSlug,
    source: "communications-ingestion",
    source_message_ids: input.sourceMessageIds,
    participants: input.signal.participants,
    counterparties: input.signal.counterparties,
    key_themes: input.signal.keyThemes,
    risks: input.signal.risks,
    amounts: input.signal.amounts,
    dates: input.signal.dates,
    overall_confidence: String(input.signal.confidence),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const body = [
    "## Executive summary",
    input.signal.summary,
    "",
    "## Recommended interpretation",
    `- Target domain: ${input.targetDomain}`,
    `- Source thread: ${input.sourceLabel}`,
    `- Participants: ${input.signal.participants.join(", ") || "N/A"}`,
    "",
    "## Structured facts",
    ...formatStructuredAmounts(input.signal.amounts),
    ...formatStructuredDates(input.signal.dates),
    "",
    "## Evidence",
    `- Source messages: ${input.sourceMessageIds.join(", ")}`,
  ].join("\n");

  return {
    path: `${input.targetDomain}/imports/${slugify(input.signal.title, "signal")}-${signalHash}.qmd`,
    content: toQmd(frontmatter, body),
  };
}
