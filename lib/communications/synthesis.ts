import { anthropic } from "@ai-sdk/anthropic";
import { generateText, type LanguageModelUsage } from "ai";

import {
  COMMUNICATION_ROUTABLE_DOMAINS,
  communicationsSynthesisSchema,
  requiresSignalApproval,
  type CommunicationMessageRow,
  type CommunicationsSynthesis,
} from "@/lib/communications/types";

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getCommunicationSynthesisModel(): string {
  return process.env.COMMUNICATIONS_SYNTHESIS_MODEL ?? "claude-haiku-4-5-20251001";
}

export function getCommunicationSynthesisLimits() {
  return {
    maxMessages: parsePositiveIntEnv(process.env.COMMUNICATIONS_SYNTHESIS_MAX_MESSAGES, 60),
    maxPromptChars: parsePositiveIntEnv(process.env.COMMUNICATIONS_SYNTHESIS_MAX_PROMPT_CHARS, 30_000),
  };
}
const SIGNAL_TYPES = new Set([
  "commitment",
  "decision",
  "request",
  "information",
  "risk",
  "deadline",
  "contact",
  "organization",
]);
const CONTACT_ROLES = new Set(["employee", "client", "partner", "vendor", "contractor", "other"]);
const ORGANIZATION_ROLES = new Set(["vendor", "client", "partner", "government", "bank", "other"]);
const THREAD_STATUSES = new Set(["active", "waiting_for_response", "blocked", "completed", "monitoring"]);

function extractJsonPayload(raw: string): string {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("Model did not return JSON output");
  }
  return raw.slice(firstBrace, lastBrace + 1).trim();
}

function clampMessages(messages: CommunicationMessageRow[]): CommunicationMessageRow[] {
  const limits = getCommunicationSynthesisLimits();
  const reversed = [...messages].reverse();
  const kept: CommunicationMessageRow[] = [];
  let chars = 0;

  for (const message of reversed) {
    const content = (message.content ?? "").trim();
    const serialized = `${message.receivedAt} ${message.senderName ?? message.senderAddress ?? "unknown"}: ${content}`;
    if (kept.length >= limits.maxMessages || chars + serialized.length > limits.maxPromptChars) break;
    kept.push(message);
    chars += serialized.length;
  }

  return kept.reverse();
}

function sanitizeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

function sanitizeStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const entry of value) {
    const next = sanitizeString(entry, maxLength);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    items.push(next);
    if (items.length >= maxItems) break;
  }
  return items;
}

function parseConfidence(value: unknown, fallback = 0.5): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace("%", "");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      const scaled = parsed > 1 ? parsed / 100 : parsed;
      return Math.max(0, Math.min(1, scaled));
    }
  }
  return fallback;
}

function normalizeSignalType(value: unknown): string {
  const normalized = sanitizeString(value, 40)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return "information";
  if (SIGNAL_TYPES.has(normalized)) return normalized;
  if (["action", "task", "todo", "next_step", "promise", "agreement"].includes(normalized)) return "commitment";
  if (["update", "summary", "info", "message", "context"].includes(normalized)) return "information";
  if (["issue", "problem", "escalation", "concern"].includes(normalized)) return "risk";
  if (["question", "ask", "asks", "requested"].includes(normalized)) return "request";
  if (["due", "due_date", "deadline_request", "timeline"].includes(normalized)) return "deadline";
  if (["person", "people", "contact_update"].includes(normalized)) return "contact";
  if (["company", "counterparty", "organization_update", "org"].includes(normalized)) return "organization";
  return "information";
}

function normalizeTargetDomain(value: unknown, signalType: string): string {
  const normalized = sanitizeString(value, 40)?.toLowerCase();
  if (normalized && COMMUNICATION_ROUTABLE_DOMAINS.includes(normalized as (typeof COMMUNICATION_ROUTABLE_DOMAINS)[number])) {
    return normalized;
  }
  if (signalType === "contact" || signalType === "organization") return "people";
  return "communications";
}

function normalizeContactRole(value: unknown): string {
  const normalized = sanitizeString(value, 80)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return "other";
  if (CONTACT_ROLES.has(normalized)) return normalized;
  if (["owner", "founder", "manager", "director", "employee_contact", "staff", "team", "ceo", "cfo", "coo"].includes(normalized)) {
    return "employee";
  }
  if (["customer", "guest", "lead", "buyer"].includes(normalized)) return "client";
  if (["supplier", "service_provider"].includes(normalized)) return "vendor";
  if (["freelancer", "consultant", "agency"].includes(normalized)) return "contractor";
  if (["investor", "affiliate"].includes(normalized)) return "partner";
  return "other";
}

function normalizeOrganizationRole(value: unknown): string {
  const normalized = sanitizeString(value, 80)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return "other";
  if (ORGANIZATION_ROLES.has(normalized)) return normalized;
  if (["supplier", "service_provider"].includes(normalized)) return "vendor";
  if (["customer", "buyer"].includes(normalized)) return "client";
  if (["authority", "regulator", "ministry"].includes(normalized)) return "government";
  if (["financial_institution", "lender"].includes(normalized)) return "bank";
  return "other";
}

function normalizeThreadStatus(value: unknown): string {
  const normalized = sanitizeString(value, 80)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return "active";
  if (THREAD_STATUSES.has(normalized)) return normalized;
  if (["waiting", "pending_reply", "awaiting_response", "awaiting_reply"].includes(normalized)) {
    return "waiting_for_response";
  }
  if (["on_hold", "stalled"].includes(normalized)) return "blocked";
  if (["done", "resolved", "closed"].includes(normalized)) return "completed";
  if (["watching", "watch"].includes(normalized)) return "monitoring";
  return "active";
}

function normalizeAmounts(value: unknown) {
  if (!Array.isArray(value)) return [];
  const amounts = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const rawValue = record.value;
    const parsedValue = typeof rawValue === "number" ? rawValue : Number(String(rawValue ?? "").replace(/[, ]/g, ""));
    if (!Number.isFinite(parsedValue)) continue;
    amounts.push({
      value: parsedValue,
      currency: sanitizeString(record.currency, 12)?.toUpperCase(),
      unit: sanitizeString(record.unit, 32) ?? undefined,
      context: sanitizeString(record.context, 160) ?? undefined,
    });
    if (amounts.length >= 12) break;
  }
  return amounts;
}

function normalizeDates(value: unknown) {
  if (!Array.isArray(value)) return [];
  const dates = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const date = sanitizeString(record.date, 40);
    const meaning = sanitizeString(record.meaning ?? record.context ?? record.label, 80);
    if (!date || !meaning) continue;
    dates.push({ date, meaning });
    if (dates.length >= 12) break;
  }
  return dates;
}

export function normalizeCommunicationsSynthesisPayload(payload: unknown): unknown {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const dailySummary =
    sanitizeString(root.dailySummary ?? root.summary ?? root.daily_summary, 4000) ??
    "No decision-grade summary extracted.";

  const signals = Array.isArray(root.signals)
    ? root.signals.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        const type = normalizeSignalType(record.type ?? record.signalType ?? record.kind);
        const summary =
          sanitizeString(record.summary ?? record.description ?? record.details ?? record.body, 2000) ??
          sanitizeString(record.title, 300);
        if (!summary || summary.length < 8) return [];
        const title =
          sanitizeString(record.title ?? record.headline, 160) ??
          summary.slice(0, 157).trimEnd() + (summary.length > 157 ? "..." : "");

        return [{
          type,
          title,
          summary,
          targetDomain: normalizeTargetDomain(record.targetDomain ?? record.domain ?? record.target_domain, type),
          participants: sanitizeStringArray(record.participants, 12, 120),
          counterparties: sanitizeStringArray(record.counterparties ?? record.counterpartiesNames, 12, 120),
          keyThemes: sanitizeStringArray(record.keyThemes ?? record.themes ?? record.tags, 8, 120),
          risks: sanitizeStringArray(record.risks ?? record.concerns, 8, 240),
          amounts: normalizeAmounts(record.amounts),
          dates: normalizeDates(record.dates ?? record.deadlines),
          sourceMessageIds: sanitizeStringArray(record.sourceMessageIds ?? record.source_message_ids, 50, 120),
          confidence: parseConfidence(record.confidence),
        }];
      })
    : [];

  const contacts = Array.isArray(root.contacts)
    ? root.contacts.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        const name = sanitizeString(record.name ?? record.fullName ?? record.displayName, 160);
        if (!name || name.length < 2) return [];
        return [{
          name,
          displayName: sanitizeString(record.displayName ?? record.display_name, 120) ?? undefined,
          role: normalizeContactRole(record.role ?? record.type ?? record.relationship),
          organizationName: sanitizeString(record.organizationName ?? record.organization ?? record.company, 160) ?? undefined,
          email: sanitizeString(record.email, 160) ?? undefined,
          phone: sanitizeString(record.phone ?? record.phoneNumber, 40) ?? undefined,
          telegramHandle: sanitizeString(record.telegramHandle ?? record.telegram ?? record.handle, 80) ?? undefined,
          notes: sanitizeString(record.notes ?? record.summary, 600) ?? undefined,
          tags: sanitizeStringArray(record.tags, 12, 40),
          sourceMessageIds: sanitizeStringArray(record.sourceMessageIds ?? record.source_message_ids, 50, 120),
          confidence: parseConfidence(record.confidence),
        }];
      })
    : [];

  const organizations = Array.isArray(root.organizations)
    ? root.organizations.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        const name = sanitizeString(record.name ?? record.organizationName ?? record.company, 160);
        if (!name || name.length < 2) return [];
        return [{
          name,
          role: normalizeOrganizationRole(record.role ?? record.type ?? record.relationship),
          domains: sanitizeStringArray(record.domains ?? record.tags, 12, 80),
          notes: sanitizeString(record.notes ?? record.summary, 600) ?? undefined,
          sourceMessageIds: sanitizeStringArray(record.sourceMessageIds ?? record.source_message_ids, 50, 120),
          confidence: parseConfidence(record.confidence),
        }];
      })
    : [];

  const rawOngoingThreads = Array.isArray(root.ongoingThreads ?? root.ongoing_threads)
    ? ((root.ongoingThreads ?? root.ongoing_threads) as unknown[])
    : [];

  const ongoingThreads = rawOngoingThreads
    .flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        const topic = sanitizeString(record.topic ?? record.title ?? record.subject ?? record.summary, 160);
        const lastContext = sanitizeString(record.lastContext ?? record.last_context ?? record.context ?? record.summary, 1200);
        if (!topic || !lastContext) return [];
        return [{
          topic,
          status: normalizeThreadStatus(record.status ?? record.state),
          lastContext,
          participants: sanitizeStringArray(record.participants, 12, 120),
          startedMessageId: sanitizeString(record.startedMessageId ?? record.started_message_id, 120) ?? undefined,
        }];
      });

  return {
    language: sanitizeString(root.language ?? root.locale, 32) ?? "en",
    dailySummary,
    signals,
    contacts,
    organizations,
    ongoingThreads,
  };
}

function buildPrompt(input: {
  sourceLabel: string;
  dayKey: string;
  priorContext: string | null;
  knownContacts: string[];
  messages: CommunicationMessageRow[];
}): string {
  const serializedMessages = clampMessages(input.messages)
    .map((message) => {
      const sender = message.senderName ?? message.senderAddress ?? "unknown";
      const body = (message.content ?? "").trim() || "[no text body]";
      return [
        `message_id: ${message.id}`,
        `provider_message_id: ${message.providerMessageId}`,
        `received_at: ${message.receivedAt}`,
        `sender: ${sender}`,
        `subject: ${message.subject ?? ""}`,
        `content: ${body}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return [
    `Source: ${input.sourceLabel}`,
    `UTC day: ${input.dayKey}`,
    "",
    "Prior context:",
    input.priorContext?.trim() || "None.",
    "",
    "Known people context:",
    input.knownContacts.length > 0 ? input.knownContacts.join("\n") : "None.",
    "",
    "Messages:",
    serializedMessages,
  ].join("\n");
}

const SYSTEM_PROMPT = [
  "You synthesize business-critical communications into structured JSON for an internal CFO/CEO system.",
  "Return JSON only. Do not add commentary, markdown, or code fences unless forced.",
  "Focus on decision-grade facts: commitments, decisions, deadlines, requests, counterparties, pricing, and risks.",
  "Treat explicit promises, agreements, and owner-assigned deliverables as type='commitment' even when phrased casually ('I will', 'I'll send', 'сделаю', 'подготовлю', 'договорились, я ...').",
  "Use type='deadline' when the key signal is the date itself. Put explicit due dates in dates[]. Prefer YYYY-MM-DD when the date can be resolved from context; otherwise keep the raw phrase.",
  "If the message says work was already completed or delivered ('done', 'sent', 'готово', 'отправил', 'как обещал'), do not emit a new open commitment unless there is a fresh future obligation in the same message.",
  "Use targetDomain='communications' for general communication records and people follow-up signals.",
  "For promise-tracking inside chats, default commitments and deadlines to targetDomain='communications'. Escalate to another targetDomain only when the fact itself clearly requires a separate approved write outside communications.",
  "Use targetDomain='people' only when the messages imply a real follow-up on an already-known person. Do not create contacts or organizations from text mentions.",
  "Use other target domains only for materially consequential facts that deserve explicit human approval.",
  "Do not invent amounts, dates, or counterparties. If evidence is thin, lower confidence.",
  "Use known people context, related companies, and analysis_context only as user-provided interpretation context. Do not treat a related company as the storage destination or as proof that the message belongs to that company.",
  "Use the dominant language of the source messages for dailySummary and summaries.",
  "For cross-domain signals, keep the summary factual and concise. No legal or accounting overclaiming.",
  "Leave contacts=[] and organizations=[]. Sender-based people enrichment is handled outside this model.",
].join(" ");

export async function runCommunicationSynthesis(input: {
  sourceLabel: string;
  dayKey: string;
  priorContext: string | null;
  knownContacts: string[];
  messages: CommunicationMessageRow[];
  onUsage?: (usage: LanguageModelUsage) => Promise<void> | void;
}): Promise<CommunicationsSynthesis> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for communications synthesis");
  }

  const prompt = buildPrompt(input);
  const model = getCommunicationSynthesisModel();
  const { text, usage } = await generateText({
    model: anthropic(model),
    system: SYSTEM_PROMPT,
    prompt: `${prompt}\n\nReturn an object with keys: language, dailySummary, signals, contacts, organizations, ongoingThreads.`,
    temperature: 0.1,
    maxRetries: 1,
  });
  await input.onUsage?.(usage);

  const payload = normalizeCommunicationsSynthesisPayload(JSON.parse(extractJsonPayload(text)));
  const parsed = communicationsSynthesisSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid communications synthesis output: ${parsed.error.message}`);
  }

  return {
    ...parsed.data,
    signals: parsed.data.signals.map((signal) => ({
      ...signal,
      sourceMessageIds: signal.sourceMessageIds.length > 0
        ? signal.sourceMessageIds
        : input.messages.map((message) => message.id),
      targetDomain: signal.targetDomain,
      confidence: Math.max(0, Math.min(1, signal.confidence)),
    })),
    contacts: parsed.data.contacts.map((contact) => ({
      ...contact,
      sourceMessageIds: contact.sourceMessageIds.length > 0
        ? contact.sourceMessageIds
        : input.messages.map((message) => message.id),
      confidence: Math.max(0, Math.min(1, contact.confidence)),
    })),
    organizations: parsed.data.organizations.map((organization) => ({
      ...organization,
      sourceMessageIds: organization.sourceMessageIds.length > 0
        ? organization.sourceMessageIds
        : input.messages.map((message) => message.id),
      confidence: Math.max(0, Math.min(1, organization.confidence)),
    })),
  };
}

export function splitSignalsByApproval(synthesis: CommunicationsSynthesis) {
  const automatic = synthesis.signals.filter((signal) => !requiresSignalApproval(signal.targetDomain));
  const approvalRequired = synthesis.signals.filter((signal) => requiresSignalApproval(signal.targetDomain));

  return {
    automatic,
    approvalRequired,
  };
}
