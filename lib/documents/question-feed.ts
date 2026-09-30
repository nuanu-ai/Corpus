export interface DocumentQuestionSource {
  id: string;
  fileName: string;
  createdAt: string | Date;
  reviewRequired: boolean;
  reviewFlags: string[];
  clarificationPendingCount: number;
  source: string;
  sourceContext?: {
    provider?: string | null;
    sourcePath?: string | null;
    connectionLabel?: string | null;
  } | null;
}

export interface DocumentQuestionFeedItem {
  id: string;
  fileName: string;
  href: string;
  createdAt: string;
  sourceLabel: string;
  sourcePath: string | null;
  requestCount: number;
  clarificationPendingCount: number;
  reviewRequired: boolean;
  reviewFlags: string[];
  summary: string;
}

export interface DocumentQuestionFeed {
  items: DocumentQuestionFeedItem[];
  documentCount: number;
  totalRequestCount: number;
}

export function getDocumentQuestionHref(documentId: string): string {
  const params = new URLSearchParams({
    doc: documentId,
  });
  return `/documents?${params.toString()}#document-questions`;
}

function normalizeCreatedAt(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}

export function getPendingUserClarificationCount(
  document: Pick<DocumentQuestionSource, "clarificationPendingCount">,
): number {
  return Math.max(0, document.clarificationPendingCount);
}

export function hasPendingUserClarification(
  document: Pick<DocumentQuestionSource, "clarificationPendingCount">,
): boolean {
  return getPendingUserClarificationCount(document) > 0;
}

function getRequestCount(document: DocumentQuestionSource): number {
  return getPendingUserClarificationCount(document);
}

function getSummary(document: DocumentQuestionSource): string {
  const parts: string[] = [];

  if (document.clarificationPendingCount > 0) {
    parts.push(
      `${document.clarificationPendingCount} clarification question${document.clarificationPendingCount === 1 ? "" : "s"}`,
    );
  }

  if (document.reviewRequired) {
    if (document.reviewFlags.length > 0) {
      parts.push(`review flags: ${document.reviewFlags.slice(0, 2).join(", ")}`);
    } else {
      parts.push("manual review required");
    }
  }

  return parts.join(" • ");
}

function getSourceLabel(document: DocumentQuestionSource): string {
  return (
    document.sourceContext?.connectionLabel ??
    document.sourceContext?.provider ??
    document.source
  );
}

export function buildDocumentQuestionFeed(
  documents: DocumentQuestionSource[],
  options?: { limit?: number },
): DocumentQuestionFeed {
  const limit = Math.max(1, options?.limit ?? 5);

  const items = documents
    .filter(hasPendingUserClarification)
    .sort((left, right) => {
      const requestDiff = getRequestCount(right) - getRequestCount(left);
      if (requestDiff !== 0) return requestDiff;
      return new Date(normalizeCreatedAt(right.createdAt)).getTime() - new Date(normalizeCreatedAt(left.createdAt)).getTime();
    });

  return {
    items: items.slice(0, limit).map((document) => ({
      id: document.id,
      fileName: document.fileName,
      href: getDocumentQuestionHref(document.id),
      createdAt: normalizeCreatedAt(document.createdAt),
      sourceLabel: getSourceLabel(document),
      sourcePath: document.sourceContext?.sourcePath ?? null,
      requestCount: getRequestCount(document),
      clarificationPendingCount: document.clarificationPendingCount,
      reviewRequired: document.reviewRequired,
      reviewFlags: document.reviewFlags,
      summary: getSummary(document),
    })),
    documentCount: items.length,
    totalRequestCount: items.reduce((sum, document) => sum + getRequestCount(document), 0),
  };
}
