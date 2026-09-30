import type { DashboardCommitmentItem } from "@/lib/communications/commitments";
import type { CommunicationMessageRow } from "@/lib/communications/types";

export interface CommitmentLifecycleCandidate extends DashboardCommitmentItem {
  provider: string;
  threadKey: string;
}

export interface CommitmentLifecycleResolution {
  filePath: string;
  qualifiedId: string;
  kind: "completion" | "cancellation";
  resolvedAt: string;
  resolutionSummary: string;
  resolutionSourceMessageIds: string[];
  matchScore: number;
}

interface CommitmentLifecycleEvent {
  kind: "completion" | "cancellation";
  messageId: string;
  receivedAt: string;
  text: string;
  senderName: string | null;
  summary: string;
  hasAsPromisedMarker: boolean;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "will",
  "have",
  "has",
  "had",
  "you",
  "your",
  "our",
  "мы",
  "это",
  "как",
  "что",
  "надо",
  "atau",
  "yang",
  "untuk",
  "dari",
  "sudah",
  "udah",
  "akan",
  "saya",
  "kami",
]);

const COMPLETION_PATTERNS = [
  /\b(done|finished|completed|sent|delivered|submitted|shared)\b/i,
  /\b(готово|готов|сделано|выполнено|отправил|отправила|отправлено|выслал|выслала|сдал|сдала)\b/i,
  /\b(selesai|sudah dikirim|udah dikirim|sudah saya kirim|sudah kukirim|terkirim)\b/i,
];

const CANCELLATION_PATTERNS = [
  /\b(cancel(?:led)?|won't|will not|can't|cannot|not going to)\b/i,
  /\b(не смогу|не получится|не получится сделать|отмен[а-я]+|не буду|не успеваю)\b/i,
  /\b(ga jadi|gak jadi|tidak jadi|batal|dibatalkan|nggak bisa)\b/i,
];

const AS_PROMISED_PATTERNS = [
  /\b(as promised|like i promised|as agreed)\b/i,
  /\b(как и обещал|как обещал|как и договаривались|как договорились)\b/i,
  /\b(sesuai janji|sesuai kesepakatan)\b/i,
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[’']/g, "")
    .replace(
      /\b(отправил|отправила|отправлено|выслал|выслала|пошлю|пришлю)\b/g,
      "send",
    )
    .replace(/\b(sent|sending|send)\b/g, "send")
    .replace(/\b(сделаю|сделал|сделано|готово|готов|выполнено)\b/g, "done")
    .replace(/\b(done|finished|completed)\b/g, "done")
    .replace(/\b(договорились|договор)\b/g, "agree")
    .replace(/\b(agreement|agreed)\b/g, "agree")
    .replace(/\b(конракт|contract)\b/g, "contract")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9а-я]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function firstSentence(value: string, maxLength = 180): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trim()}…`;
}

function buildEventSummary(
  kind: CommitmentLifecycleEvent["kind"],
  text: string,
): string {
  const prefix =
    kind === "completion" ? "Completion detected" : "Cancellation detected";
  return `${prefix}: ${firstSentence(text)}`;
}

function extractLifecycleEvents(
  messages: CommunicationMessageRow[],
): CommitmentLifecycleEvent[] {
  const events: CommitmentLifecycleEvent[] = [];

  for (const message of messages) {
    const text = (message.content ?? "").trim();
    if (!text) continue;

    const isCancellation = CANCELLATION_PATTERNS.some((pattern) =>
      pattern.test(text),
    );
    const isCompletion =
      !isCancellation &&
      COMPLETION_PATTERNS.some((pattern) => pattern.test(text));
    if (!isCompletion && !isCancellation) continue;

    const kind = isCancellation ? "cancellation" : "completion";
    events.push({
      kind,
      messageId: message.id,
      receivedAt: message.receivedAt,
      text,
      senderName:
        message.senderName?.trim() || message.senderAddress?.trim() || null,
      summary: buildEventSummary(kind, text),
      hasAsPromisedMarker: AS_PROMISED_PATTERNS.some((pattern) =>
        pattern.test(text),
      ),
    });
  }

  return events.sort((left, right) =>
    left.receivedAt.localeCompare(right.receivedAt),
  );
}

function overlapScore(leftTokens: string[], rightTokens: string[]): number {
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const right = new Set(rightTokens);
  let matches = 0;
  for (const token of leftTokens) {
    if (right.has(token)) matches += 1;
  }
  return Math.min(0.55, matches * 0.14);
}

function participantMatchScore(
  event: CommitmentLifecycleEvent,
  candidate: CommitmentLifecycleCandidate,
): number {
  if (!event.senderName) return 0;
  const sender = normalizeText(event.senderName);
  if (!sender) return 0;

  const participantMatch = candidate.participants.some((participant) =>
    normalizeText(participant).includes(sender),
  );
  const summaryMatch = normalizeText(
    `${candidate.title} ${candidate.summary ?? ""}`,
  ).includes(sender);
  if (participantMatch || summaryMatch) return 0.18;
  return 0;
}

function scoreLifecycleMatch(
  event: CommitmentLifecycleEvent,
  candidate: CommitmentLifecycleCandidate,
  remainingCandidates: number,
): number {
  const eventTokens = tokenize(event.text);
  const candidateTokens = tokenize(
    `${candidate.title} ${candidate.summary ?? ""} ${(candidate.keyThemes ?? []).join(" ")}`,
  );

  let score = event.kind === "cancellation" ? 0.42 : 0.28;
  score += overlapScore(eventTokens, candidateTokens);
  score += participantMatchScore(event, candidate);
  if (event.hasAsPromisedMarker) score += 0.2;
  if (
    remainingCandidates === 1 &&
    (event.hasAsPromisedMarker ||
      overlapScore(eventTokens, candidateTokens) >= 0.14)
  ) {
    score += 0.08;
  }

  return Math.min(1, score);
}

export function findCommitmentLifecycleResolutions(input: {
  messages: CommunicationMessageRow[];
  candidates: CommitmentLifecycleCandidate[];
}): CommitmentLifecycleResolution[] {
  const events = extractLifecycleEvents(input.messages);
  const openCandidates = input.candidates
    .filter((candidate) => candidate.status === "open")
    .sort((left, right) => {
      const leftDate = left.updatedAt ?? left.createdAt ?? "";
      const rightDate = right.updatedAt ?? right.createdAt ?? "";
      return rightDate.localeCompare(leftDate);
    });
  const consumed = new Set<string>();
  const resolutions: CommitmentLifecycleResolution[] = [];

  for (const event of events) {
    const available = openCandidates.filter(
      (candidate) => !consumed.has(candidate.filePath),
    );
    if (available.length === 0) break;

    let bestCandidate: CommitmentLifecycleCandidate | null = null;
    let bestScore = 0;

    for (const candidate of available) {
      const score = scoreLifecycleMatch(event, candidate, available.length);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate || bestScore < 0.8) continue;

    consumed.add(bestCandidate.filePath);
    resolutions.push({
      filePath: bestCandidate.filePath,
      qualifiedId: bestCandidate.qualifiedId,
      kind: event.kind,
      resolvedAt: event.receivedAt,
      resolutionSummary: event.summary,
      resolutionSourceMessageIds: [event.messageId],
      matchScore: Number(bestScore.toFixed(2)),
    });
  }

  return resolutions;
}

export function determineCommitmentEscalationLevel(input: {
  dueDate: string | null;
  todayDayKey: string;
}): "l1" | "l2" | "l3" | null {
  if (!input.dueDate || input.dueDate >= input.todayDayKey) return null;

  const due = new Date(`${input.dueDate}T00:00:00.000Z`);
  const today = new Date(`${input.todayDayKey}T00:00:00.000Z`);
  const diffMs = today.getTime() - due.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays >= 5) return "l3";
  if (diffDays >= 2) return "l2";
  return "l1";
}
