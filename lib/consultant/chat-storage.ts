import type { UIMessage } from "ai";

const STORAGE_BYTE_LIMIT = 2_000_000;

export interface PersistableChatThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: UIMessage[];
  attachments: unknown[];
  artifacts: unknown[];
  approvals: unknown[];
}

type StorageStrategy = {
  threadLimit: number;
  messageLimit: number;
  sidecarLimit: number;
  textOnly: boolean;
  maxTextChars: number;
};

const STORAGE_STRATEGIES: StorageStrategy[] = [
  { threadLimit: 20, messageLimit: 500, sidecarLimit: 50, textOnly: false, maxTextChars: 8_000 },
  { threadLimit: 20, messageLimit: 200, sidecarLimit: 25, textOnly: false, maxTextChars: 4_000 },
  { threadLimit: 12, messageLimit: 100, sidecarLimit: 15, textOnly: false, maxTextChars: 2_000 },
  { threadLimit: 8, messageLimit: 50, sidecarLimit: 10, textOnly: true, maxTextChars: 1_500 },
  { threadLimit: 4, messageLimit: 25, sidecarLimit: 5, textOnly: true, maxTextChars: 800 },
];

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function compactMessages(
  messages: UIMessage[],
  strategy: StorageStrategy,
): UIMessage[] {
  const recentMessages = messages.slice(-strategy.messageLimit);
  return recentMessages.map((message) => {
    if (!strategy.textOnly) {
      return message;
    }

    const textParts = message.parts
      .filter((part): part is Extract<UIMessage["parts"][number], { type: "text"; text: string }> => {
        return part.type === "text";
      })
      .map((part) => ({
        ...part,
        text: truncateText(part.text, strategy.maxTextChars),
      }));

    return {
      ...message,
      parts: textParts,
    };
  });
}

function prioritizeActiveThread<T extends { id: string }>(
  threads: T[],
  activeThreadId: string,
): T[] {
  const activeIndex = threads.findIndex((thread) => thread.id === activeThreadId);
  if (activeIndex <= 0) return threads;

  const activeThread = threads[activeIndex];
  return [activeThread, ...threads.slice(0, activeIndex), ...threads.slice(activeIndex + 1)];
}

function compactThread(
  thread: PersistableChatThread,
  strategy: StorageStrategy,
): PersistableChatThread {
  return {
    ...thread,
    messages: compactMessages(thread.messages, strategy),
    attachments: thread.attachments.slice(-strategy.sidecarLimit),
    artifacts: thread.artifacts.slice(-strategy.sidecarLimit),
    approvals: thread.approvals.slice(-strategy.sidecarLimit),
  };
}

function buildStorageCandidate(
  threads: PersistableChatThread[],
  activeThreadId: string,
  strategy: StorageStrategy,
) {
  const prioritized = prioritizeActiveThread(threads, activeThreadId);
  const candidateThreads = prioritized
    .slice(0, strategy.threadLimit)
    .map((thread) => compactThread(thread, strategy));
  const resolvedActiveThreadId =
    candidateThreads.find((thread) => thread.id === activeThreadId)?.id ??
    candidateThreads[0]?.id ??
    activeThreadId;
  const threadsJson = JSON.stringify(candidateThreads);

  return {
    threadsJson,
    activeThreadId: resolvedActiveThreadId,
  };
}

export function serializeChatStateForStorage(input: {
  threads: PersistableChatThread[];
  activeThreadId: string;
}): { threadsJson: string; activeThreadId: string } {
  let fallback = buildStorageCandidate(input.threads, input.activeThreadId, STORAGE_STRATEGIES[0]);

  for (const strategy of STORAGE_STRATEGIES) {
    const candidate = buildStorageCandidate(input.threads, input.activeThreadId, strategy);
    fallback = candidate;
    if (Buffer.byteLength(candidate.threadsJson, "utf8") <= STORAGE_BYTE_LIMIT) {
      return candidate;
    }
  }

  return fallback;
}
