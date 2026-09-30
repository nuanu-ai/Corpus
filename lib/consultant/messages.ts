import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai";
import { z } from "zod";

import { summarizeConnectorPayload } from "@/lib/consultant/connector-output";

export const MAX_CONSULTANT_THREAD_HISTORY_MESSAGES = 500;
export const MAX_CONSULTANT_MODEL_MESSAGES = 60;
const MAX_MODEL_TEXT_CHARS = 6_000;
const MAX_MODEL_TOOL_SUMMARY_CHARS = 1_200;

export const uiMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(z.unknown()),
});

export type ConsultantUIMessage = z.infer<typeof uiMessageSchema>;

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function summarizeValue(value: unknown, maxChars: number): string {
  if (value === null || value === undefined) return "null";

  let serialized: string;
  if (typeof value === "string") {
    serialized = value;
  } else {
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = String(value);
    }
  }

  return truncateText(serialized.replace(/\s+/g, " ").trim(), maxChars);
}

function summarizeToolOutput(output: unknown): string {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return summarizeValue(output, MAX_MODEL_TOOL_SUMMARY_CHARS);
  }

  const candidate = output as Record<string, unknown>;
  const reduced: Record<string, unknown> = {};

  for (const key of [
    "action",
    "query",
    "domain",
    "count",
    "returnedCount",
    "matchingCount",
    "totalCount",
    "retrievalMode",
    "lexicalCount",
    "error",
    "message",
    "status",
    "view",
    "provider",
    "requestedAction",
    "resolvedAction",
    "hasMore",
    "collection",
    "historyBoundaryKnown",
    "historyBoundaryNote",
    "availableDateRange",
    "sampleDateRange",
    "summary",
    "documentId",
    "sourceDocumentName",
    "sourceSheet",
    "sourceRange",
    "filePath",
    "statementLinesPath",
    "canonicalFamily",
    "period",
    "downloadPath",
    "downloadUrl",
    "title",
  ]) {
    if (candidate[key] !== undefined) {
      reduced[key] = candidate[key];
    }
  }

  if (candidate.action === "connector_result" && candidate.result !== undefined) {
    const connectorSummary = summarizeConnectorPayload(candidate.result);
    if (connectorSummary) {
      reduced.result = connectorSummary;
    }
  }

  if (Array.isArray(candidate.results)) {
    reduced.results = candidate.results.slice(0, 3).map((item) => {
      if (!item || typeof item !== "object") return item;
      const record = item as Record<string, unknown>;
      return {
        id: record.id,
        type: record.type,
        title: record.title,
        domain: record.domain,
        filePath: record.filePath,
        canonicalFamily: record.canonicalFamily,
        period: record.period,
        documentId: record.documentId,
        sourceDocumentName: record.sourceDocumentName,
        sourceSheet: record.sourceSheet,
        periodLabel: record.periodLabel,
        managerialSummary: record.managerialSummary,
        requiresReview: record.requiresReview,
      };
    });
  }

  if (candidate.descriptor && typeof candidate.descriptor === "object") {
    const descriptor = candidate.descriptor as Record<string, unknown>;
    reduced.descriptor = {
      document: descriptor.document,
      viewPath: descriptor.viewPath,
      downloadPath: descriptor.downloadPath,
      viewUrl: descriptor.viewUrl,
      downloadUrl: descriptor.downloadUrl,
      requiresAuthorization: descriptor.requiresAuthorization,
    };
  }

  if (candidate.artifact && typeof candidate.artifact === "object") {
    const artifact = candidate.artifact as Record<string, unknown>;
    reduced.artifact = {
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      filePath: artifact.filePath,
      status: artifact.status,
    };
  }

  return summarizeValue(
    Object.keys(reduced).length > 0 ? reduced : candidate,
    MAX_MODEL_TOOL_SUMMARY_CHARS,
  );
}

function sanitizeTextPart(candidate: Record<string, unknown>) {
  if (typeof candidate.text !== "string") return null;

  return {
    type: "text" as const,
    text: candidate.text,
  };
}

function sanitizeFileLikePart(candidate: Record<string, unknown>) {
  const url =
    typeof candidate.url === "string" && candidate.url.trim().length > 0
      ? candidate.url
      : null;
  const mediaType =
    typeof candidate.mediaType === "string" && candidate.mediaType.trim().length > 0
      ? candidate.mediaType
      : null;

  if (!url || !mediaType) return null;

  const filename =
    typeof candidate.filename === "string" && candidate.filename.trim().length > 0
      ? candidate.filename.trim()
      : typeof candidate.name === "string" && candidate.name.trim().length > 0
        ? candidate.name.trim()
        : undefined;
  return {
    type: "file" as const,
    url,
    mediaType,
    ...(filename ? { filename } : {}),
  };
}

function sanitizeMessagePartsForModel(
  parts: UIMessage["parts"],
  role: UIMessage["role"],
): UIMessage["parts"] {
  if (!Array.isArray(parts)) return [];

  const sanitized: UIMessage["parts"] = [];

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as Record<string, unknown>;
    const type = typeof candidate.type === "string" ? candidate.type : null;

    if (type === "text") {
      const textPart = sanitizeTextPart(candidate);
      if (textPart) sanitized.push(textPart);
      continue;
    }

    if (type === "file" || type === "image") {
      const filePart = sanitizeFileLikePart(candidate);
      if (filePart) sanitized.push(filePart);
      continue;
    }

    if (role === "assistant" && type === "dynamic-tool") {
      sanitized.push({
        type,
        toolName:
          typeof candidate.toolName === "string" ? candidate.toolName : "dynamic-tool",
        toolCallId:
          typeof candidate.toolCallId === "string" ? candidate.toolCallId : "dynamic-tool-call",
        state:
          typeof candidate.state === "string" ? candidate.state : "output-error",
        ...(candidate.input !== undefined ? { input: candidate.input } : {}),
        ...(candidate.output !== undefined ? { output: candidate.output } : {}),
        ...(typeof candidate.errorText === "string" ? { errorText: candidate.errorText } : {}),
      } as unknown as UIMessage["parts"][number]);
      continue;
    }

    if (role === "assistant" && type?.startsWith("tool-")) {
      sanitized.push({
        type,
        toolCallId:
          typeof candidate.toolCallId === "string" ? candidate.toolCallId : "tool-call",
        state:
          typeof candidate.state === "string" ? candidate.state : "output-error",
        ...(candidate.input !== undefined ? { input: candidate.input } : {}),
        ...(candidate.output !== undefined ? { output: candidate.output } : {}),
        ...(typeof candidate.errorText === "string" ? { errorText: candidate.errorText } : {}),
      } as unknown as UIMessage["parts"][number]);
      continue;
    }
  }

  return sanitized;
}

function compactMessagePartsForModel(
  parts: UIMessage["parts"],
): UIMessage["parts"] {
  if (!Array.isArray(parts)) return [];

  const compacted: UIMessage["parts"] = [];

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as Record<string, unknown>;
    const type = typeof candidate.type === "string" ? candidate.type : null;

    if (type === "text" && typeof candidate.text === "string") {
      const text = truncateText(candidate.text.trim(), MAX_MODEL_TEXT_CHARS);
      if (text) {
        compacted.push({ type: "text", text });
      }
      continue;
    }

    if (type === "step-start" || type === "start-step" || type === "finish-step") {
      continue;
    }

    if (type?.startsWith("tool-")) {
      const toolName = type.slice("tool-".length);
      const state =
        typeof candidate.state === "string" && candidate.state.trim().length > 0
          ? candidate.state
          : null;
      const inputSummary =
        candidate.input !== undefined
          ? summarizeValue(candidate.input, 400)
          : null;
      const outputSummary =
        candidate.output !== undefined
          ? summarizeToolOutput(candidate.output)
          : null;

      const fragments = [`[Tool ${toolName}]`];
      if (state) fragments.push(`state=${state}`);
      if (inputSummary) fragments.push(`input=${inputSummary}`);
      if (outputSummary) fragments.push(`output=${outputSummary}`);

      compacted.push({
        type: "text",
        text: truncateText(fragments.join(" | "), MAX_MODEL_TEXT_CHARS),
      });
    }
  }

  return compacted;
}

export function extractMessageText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";

  const fragments: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as { type?: unknown; text?: unknown };
    if (typeof candidate.text !== "string") continue;
    if (candidate.type === "text" || typeof candidate.type !== "string") {
      const next = candidate.text.trim();
      if (next) fragments.push(next);
    }
  }

  return fragments.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function dedupeAdjacentMessages(
  messages: ConsultantUIMessage[],
): ConsultantUIMessage[] {
  const deduped: ConsultantUIMessage[] = [];

  for (const message of messages) {
    const previous = deduped.at(-1);
    if (!previous) {
      deduped.push(message);
      continue;
    }

    if (previous.role !== message.role) {
      deduped.push(message);
      continue;
    }

    const previousText = extractMessageText(previous.parts);
    const nextText = extractMessageText(message.parts);

    if (previousText.length > 0 && previousText === nextText) {
      continue;
    }

    deduped.push(message);
  }

  return deduped;
}

function normalizeStoredMessage(
  item: unknown,
  index: number,
): ConsultantUIMessage | null {
  const parsed = uiMessageSchema.safeParse(item);
  if (parsed.success) {
    if (parsed.data.id === "greeting") return null;
    return parsed.data;
  }

  // AI SDK UI stream chunks can occasionally finish without a stable message
  // id. Do not drop those assistant turns from persisted history: losing the
  // assistant row makes later turns look like several unanswered user prompts.
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  const role = candidate.role;
  if (role !== "assistant" && role !== "user" && role !== "system") {
    return null;
  }
  if (!Array.isArray(candidate.parts)) {
    return null;
  }

  const rawId =
    typeof candidate.id === "string" && candidate.id.trim().length > 0
      ? candidate.id.trim()
      : null;

  return {
    id: rawId ?? `stored-${role}-${index}`,
    role,
    parts: candidate.parts,
  };
}

export function normalizeStoredMessages(value: unknown): ConsultantUIMessage[] {
  if (!Array.isArray(value)) return [];

  const normalized: ConsultantUIMessage[] = [];
  for (const [index, item] of value.entries()) {
    const message = normalizeStoredMessage(item, index);
    if (!message) continue;
    normalized.push(message);
  }

  const deduped = dedupeAdjacentMessages(normalized);

  if (deduped.length <= MAX_CONSULTANT_THREAD_HISTORY_MESSAGES) {
    return deduped;
  }

  return deduped.slice(-MAX_CONSULTANT_THREAD_HISTORY_MESSAGES);
}

export function selectMessagesForModel<T>(
  messages: T[],
  maxMessages: number = MAX_CONSULTANT_MODEL_MESSAGES,
): T[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  return messages.slice(-maxMessages);
}

/**
 * Build a synthetic user-role message that summarises a dropped span of older
 * messages so the model still has *some* sense of what came before. Deterministic;
 * does not call an LLM. Counts roles, lists tool names, captures the first user
 * prompt verbatim (truncated) — that is usually the conversation's intent.
 */
export function summarizeDroppedHistory(
  dropped: UIMessage[],
): UIMessage | null {
  if (dropped.length === 0) return null;

  let userCount = 0;
  let assistantCount = 0;
  let firstUserText: string | null = null;
  const toolCounts = new Map<string, number>();

  for (const message of dropped) {
    if (message.role === "user") {
      userCount += 1;
      if (firstUserText === null) {
        const text = extractMessageText(message.parts);
        if (text) firstUserText = text;
      }
    } else if (message.role === "assistant") {
      assistantCount += 1;
      if (Array.isArray(message.parts)) {
        for (const part of message.parts) {
          if (!part || typeof part !== "object") continue;
          const type = (part as { type?: unknown }).type;
          if (typeof type === "string" && type.startsWith("tool-")) {
            const tool = type.slice("tool-".length);
            toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
          }
        }
      }
    }
  }

  const lines: string[] = [
    "[CONTEXT-COMPACTION] Earlier turns in this conversation, compressed to fit the model window:",
    `- ${userCount} user message${userCount === 1 ? "" : "s"} and ${assistantCount} assistant repl${assistantCount === 1 ? "y" : "ies"} omitted.`,
  ];

  if (toolCounts.size > 0) {
    const sorted = Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => `${name}×${count}`);
    lines.push(`- Tool calls: ${sorted.join(", ")}.`);
  }

  if (firstUserText) {
    lines.push(`- First user message: "${truncateText(firstUserText, 400)}"`);
  }

  lines.push(
    "[end of compaction note — actual recent turns continue below]",
  );

  return {
    id: `compaction-${dropped[0]?.id ?? "synthetic"}`,
    role: "user",
    parts: [{ type: "text", text: lines.join("\n") }],
  } as UIMessage;
}

export function compactMessagesForModel(
  messages: UIMessage[],
  maxMessages: number = MAX_CONSULTANT_MODEL_MESSAGES,
): UIMessage[] {
  const filtered = messages.filter(
    (message) => Array.isArray(message.parts) && message.parts.length > 0,
  );

  const compactPart = (message: UIMessage): UIMessage =>
    message.role === "assistant"
      ? ({
          ...message,
          parts: compactMessagePartsForModel(
            sanitizeMessagePartsForModel(message.parts, message.role),
          ),
        } as UIMessage)
      : ({
          ...message,
          parts: sanitizeMessagePartsForModel(message.parts, message.role),
        } as UIMessage);

  if (filtered.length <= maxMessages) {
    return filtered.map(compactPart).filter((m) => m.parts.length > 0);
  }

  // Window exceeded. Keep the first user message (intent), prepend a synthetic
  // structural summary of the dropped middle, and keep the last (maxMessages-2)
  // turns. Falls back to plain tail-slice when the head is not a user message.
  // The summary is built from the *original* (pre-part-compaction) messages so
  // tool-* parts can still be enumerated.
  const head =
    filtered[0]?.role === "user" ? filtered.slice(0, 1) : [];
  const tailCount = Math.max(maxMessages - head.length - 1, 1);
  const tail = filtered.slice(-tailCount);
  const droppedStart = head.length;
  const droppedEnd = filtered.length - tailCount;
  const dropped =
    droppedEnd > droppedStart ? filtered.slice(droppedStart, droppedEnd) : [];

  const summary = summarizeDroppedHistory(dropped);
  const recombined = summary ? [...head, summary, ...tail] : [...head, ...tail];
  return recombined.map(compactPart).filter((m) => m.parts.length > 0);
}

function downgradeUserAttachmentsToText(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((message) => {
      if (message.role !== "user" || !Array.isArray(message.parts)) {
        return message;
      }

      const nextParts: UIMessage["parts"] = [];
      const seenLabels = new Set<string>();

      for (const part of message.parts) {
        if (!part || typeof part !== "object") continue;
        const candidate = part as Record<string, unknown>;
        const type = typeof candidate.type === "string" ? candidate.type : null;

        if (type === "text") {
          const textPart = sanitizeTextPart(candidate);
          if (textPart) nextParts.push(textPart);
          continue;
        }

        if (type !== "file" && type !== "image") {
          continue;
        }

        const fallbackName =
          typeof candidate.filename === "string" && candidate.filename.trim().length > 0
            ? candidate.filename.trim()
            : typeof candidate.name === "string" && candidate.name.trim().length > 0
              ? candidate.name.trim()
              : typeof candidate.mediaType === "string" && candidate.mediaType.trim().length > 0
                ? candidate.mediaType.trim()
                : "attachment";
        const label = `[Attached: ${fallbackName}]`;

        if (seenLabels.has(label)) continue;
        seenLabels.add(label);
        nextParts.push({ type: "text", text: label });
      }

      return nextParts.length > 0 ? ({ ...message, parts: nextParts } as UIMessage) : message;
    })
    .filter((message) => Array.isArray(message.parts) && message.parts.length > 0);
}

function isModelMessageSchemaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("ModelMessage[] schema") || error.message.includes("Invalid prompt");
}

export async function convertConsultantMessagesForModel(
  messages: UIMessage[],
): Promise<ModelMessage[]> {
  const compacted = compactMessagesForModel(messages);

  try {
    return await convertToModelMessages(compacted);
  } catch (error) {
    if (!isModelMessageSchemaError(error)) {
      throw error;
    }

    return await convertToModelMessages(downgradeUserAttachmentsToText(compacted));
  }
}

/**
 * Mark the last message with an Anthropic ephemeral cache breakpoint so the
 * entire conversation prefix (system + prior turns + tool results) is cached
 * across the steps of a single multi-step run. Without this breakpoint, only
 * the system block is cached and the growing tool_use/tool_result tail is
 * re-tokenized on every step — a 3.5-step Odoo turn pays full input cost
 * three times. Anthropic supports up to 4 cache breakpoints; we only set one
 * here, so callers can still cache the system block independently.
 */
export function applyTailCacheBreakpoint(messages: ModelMessage[]): ModelMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  const merged = {
    ...last,
    providerOptions: {
      ...(last.providerOptions ?? {}),
      anthropic: {
        ...((last.providerOptions?.anthropic as Record<string, unknown> | undefined) ?? {}),
        cacheControl: { type: "ephemeral" as const },
      },
    },
  } as ModelMessage;
  return [...messages.slice(0, -1), merged];
}
