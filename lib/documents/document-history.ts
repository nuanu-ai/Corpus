export interface DocumentHistoryItem {
  status: string;
  createdAt: string;
  clarificationPendingCount?: number | null;
}

const HISTORY_STATUSES = new Set([
  "completed",
  "failed",
  "needs_review",
  "rejected",
]);

function pendingClarificationCount(document: DocumentHistoryItem): number {
  return Math.max(0, document.clarificationPendingCount ?? 0);
}

function historyPriority(document: DocumentHistoryItem): number {
  if (pendingClarificationCount(document) > 0) return 0;
  if (document.status === "completed" || document.status === "needs_review") return 2;
  if (document.status === "failed") return 3;
  if (document.status === "rejected") return 4;
  return 9;
}

export function shouldShowInDocumentHistory(document: DocumentHistoryItem): boolean {
  return HISTORY_STATUSES.has(document.status) || pendingClarificationCount(document) > 0;
}

export function compareDocumentHistoryItems(
  left: DocumentHistoryItem,
  right: DocumentHistoryItem,
): number {
  const priorityDiff = historyPriority(left) - historyPriority(right);
  if (priorityDiff !== 0) return priorityDiff;

  if (pendingClarificationCount(left) > 0 || pendingClarificationCount(right) > 0) {
    const pendingDiff =
      pendingClarificationCount(right) - pendingClarificationCount(left);
    if (pendingDiff !== 0) return pendingDiff;
  }

  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

export function needsDocumentHistoryAttention(document: DocumentHistoryItem): boolean {
  return pendingClarificationCount(document) > 0;
}
