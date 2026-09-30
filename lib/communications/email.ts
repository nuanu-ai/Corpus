const RE_PREFIX = /^(?:(?:re|fw|fwd)\s*:\s*)+/i;
const MESSAGE_ID_REGEX = /Message-ID:\s*<?([^>\s]+)>?/i;
const IN_REPLY_TO_REGEX = /In-Reply-To:\s*<?([^>\s]+)>?/i;
const REFERENCES_REGEX = /References:\s*(.+)$/im;
const THREAD_INDEX_REGEX = /Thread-Index:\s*(.+)$/im;
const EMAIL_REGEX = /<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i;

export interface ParsedMailbox {
  name: string | null;
  address: string | null;
}

export function parseMailbox(value: string | null | undefined): ParsedMailbox {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return { name: null, address: null };
  }

  const addressMatch = raw.match(EMAIL_REGEX);
  const address = addressMatch?.[1]?.trim().toLowerCase() ?? null;
  const name = raw
    .replace(/<[^>]+>/g, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();

  return {
    name: name.length > 0 && name.toLowerCase() !== address ? name : null,
    address,
  };
}

export function parseMailboxList(value: string | null | undefined): string[] {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return [];

  return raw
    .split(",")
    .map((item) => parseMailbox(item).address)
    .filter((item): item is string => Boolean(item));
}

export function extractHeaderValue(headers: string, pattern: RegExp): string | null {
  const match = headers.match(pattern);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
}

export function normalizeEmailSubject(subject: string | null | undefined): string {
  const raw = typeof subject === "string" ? subject.trim() : "";
  return raw.replace(RE_PREFIX, "").trim();
}

export function deriveEmailThreadId(subject: string, headers: string): string {
  const threadIndex = extractHeaderValue(headers, THREAD_INDEX_REGEX);
  if (threadIndex) return `thread-index:${threadIndex}`;

  const references = extractHeaderValue(headers, REFERENCES_REGEX);
  if (references) {
    const firstReference = references
      .split(/\s+/)
      .map((token) => token.replace(/[<>]/g, "").trim())
      .find((token) => token.length > 0);
    if (firstReference) return `ref:${firstReference}`;
  }

  const inReplyTo = extractHeaderValue(headers, IN_REPLY_TO_REGEX);
  if (inReplyTo) return `reply:${inReplyTo.replace(/[<>]/g, "")}`;

  const normalizedSubject = normalizeEmailSubject(subject);
  if (normalizedSubject) return `subject:${normalizedSubject.toLowerCase()}`;

  const messageId = extractHeaderValue(headers, MESSAGE_ID_REGEX);
  if (messageId) return `msg:${messageId.replace(/[<>]/g, "")}`;

  return "thread:unknown";
}

export function extractEmailMessageId(headers: string): string | null {
  const messageId = extractHeaderValue(headers, MESSAGE_ID_REGEX);
  return messageId ? messageId.replace(/[<>]/g, "") : null;
}

export function extractEmailBody(text: string | null | undefined, html: string | null | undefined): string {
  const plain = typeof text === "string" ? text.trim() : "";
  if (plain.length > 0) return plain;

  const rawHtml = typeof html === "string" ? html.trim() : "";
  if (!rawHtml) return "";

  return rawHtml
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function buildEmailParticipants(fields: {
  from: string;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
}): string[] {
  const participants = new Set<string>();
  for (const address of [
    parseMailbox(fields.from).address,
    ...parseMailboxList(fields.to),
    ...parseMailboxList(fields.cc),
    ...parseMailboxList(fields.bcc),
  ]) {
    if (address) participants.add(address);
  }
  return Array.from(participants);
}
