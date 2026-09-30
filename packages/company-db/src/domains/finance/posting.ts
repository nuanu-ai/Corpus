import type { PeriodStatus } from "../../schema/domain-types/common.js";

// ── Types ────────────────────────────────────────────────────────────────

export type PostingStatus =
  | "draft"
  | "pending_review"
  | "posted"
  | "reconciled"
  | "rejected";

export interface Actor {
  id: string;
  type: "human" | "agent" | "service";
}

export interface PostingTransition {
  from: PostingStatus;
  to: PostingStatus;
  actor: Actor;
  reason?: string;
  timestamp: string;
}

export interface DedupCandidate {
  date: string;
  amount: number;
  description: string;
}

// ── Allowed transitions ─────────────────────────────────────────────────

/**
 * The allowed edges in the posting state machine:
 *
 *   draft -> pending_review -> posted -> reconciled
 *                           -> rejected
 */
const ALLOWED_TRANSITIONS: ReadonlyMap<PostingStatus, readonly PostingStatus[]> =
  new Map([
    ["draft", ["pending_review"]],
    ["pending_review", ["posted", "rejected"]],
    ["posted", ["reconciled"]],
    ["reconciled", []],
    ["rejected", []],
  ]);

// ── Core functions ───────────────────────────────────────────────────────

/**
 * Check whether an actor is authorized to move a document to "posted" status.
 *
 * Only humans may post. Service accounts whose id starts with "svc-" are
 * treated as system services that may post with an explicit override
 * (their type must be "service").
 */
export function canPost(actor: Actor): boolean {
  if (actor.type === "human") return true;
  if (actor.type === "service" && actor.id.startsWith("svc-")) return true;
  return false;
}

/**
 * A status is immutable once the document has been posted.
 * Posted and reconciled documents cannot be modified (only reversed
 * via a new journal entry).
 */
export function isImmutable(status: PostingStatus): boolean {
  return status === "posted" || status === "reconciled";
}

/**
 * Validate a proposed status transition.
 *
 * Checks:
 * 1. The transition itself is allowed by the state machine.
 * 2. If moving to "posted", the actor must be authorized (canPost).
 * 3. If a periodStatus is provided, posting to a soft_closed or
 *    hard_closed period is rejected.
 */
export function validateTransition(
  current: PostingStatus,
  target: PostingStatus,
  actor: Actor,
  context?: { periodStatus?: PeriodStatus },
): { valid: boolean; error?: string } {
  // 1. Check the transition is structurally allowed
  const allowed = ALLOWED_TRANSITIONS.get(current);
  if (!allowed || !allowed.includes(target)) {
    return {
      valid: false,
      error: `Transition ${current} -> ${target} is not allowed`,
    };
  }

  // 2. Authorization gate for posting
  if (target === "posted" && !canPost(actor)) {
    return {
      valid: false,
      error: `Actor ${actor.id} (${actor.type}) is not authorized to post — only humans or svc-* service accounts may post`,
    };
  }

  // 3. Period lock check
  if (target === "posted" && context?.periodStatus) {
    if (
      context.periodStatus === "soft_closed" ||
      context.periodStatus === "hard_closed"
    ) {
      return {
        valid: false,
        error: `Cannot post to a ${context.periodStatus} period`,
      };
    }
  }

  return { valid: true };
}

/**
 * Build a PostingTransition record from a validated transition.
 * Callers should run validateTransition first.
 */
export function buildTransition(
  from: PostingStatus,
  to: PostingStatus,
  actor: Actor,
  reason?: string,
): PostingTransition {
  return {
    from,
    to,
    actor,
    reason,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Detect potential duplicate entries.
 *
 * Two entries are considered duplicates when they share the same date,
 * amount, and description (case-insensitive, trimmed).
 */
export function detectDuplicates(
  candidate: DedupCandidate,
  existing: DedupCandidate[],
): DedupCandidate[] {
  const normDesc = candidate.description.trim().toLowerCase();

  return existing.filter(
    (e) =>
      e.date === candidate.date &&
      e.amount === candidate.amount &&
      e.description.trim().toLowerCase() === normDesc,
  );
}
