import type {
  StoredChatApproval,
  StoredChatArtifact,
  StoredChatAttachment,
  StoredChatThread,
} from "./types";

// Pure utility helpers copied from app/dashboard/_components/chat-panel.tsx (~555-567).
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fallbackTitle(): string {
  // Phase 0b keeps the title fallback surface-agnostic. Phase 5 re-introduces
  // locale-aware defaults via the i18n copy layer; until then we use a neutral
  // string rather than importing the dashboard-coupled getAppCopy helper.
  return "New chat";
}

export function normalizeAttachment(value: unknown): StoredChatAttachment | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.fileName !== "string") {
    return null;
  }

  return {
    id: candidate.id,
    documentId: typeof candidate.documentId === "string" ? candidate.documentId : null,
    fileName: candidate.fileName,
    fileType: typeof candidate.fileType === "string" ? candidate.fileType : null,
    status: typeof candidate.status === "string" ? candidate.status : "uploaded",
    documentStatus:
      typeof candidate.documentStatus === "string" ? candidate.documentStatus : null,
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
  };
}

export function normalizeAttachments(value: unknown): StoredChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((attachment) => normalizeAttachment(attachment))
    .filter((attachment): attachment is StoredChatAttachment => attachment !== null);
}

export function mergeAttachments(
  existing: StoredChatAttachment[],
  incoming: StoredChatAttachment[],
): StoredChatAttachment[] {
  const byId = new Map<string, StoredChatAttachment>();
  for (const attachment of [...incoming, ...existing]) {
    byId.set(attachment.id, attachment);
  }
  return Array.from(byId.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function normalizeArtifact(value: unknown): StoredChatArtifact | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.kind !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.filePath !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    kind: candidate.kind,
    title: candidate.title,
    filePath: candidate.filePath,
    mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : null,
    status: typeof candidate.status === "string" ? candidate.status : "draft",
    uiMessageId: typeof candidate.uiMessageId === "string" ? candidate.uiMessageId : null,
    metadata: isRecord(candidate.metadata) ? candidate.metadata : {},
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
  };
}

export function normalizeArtifacts(value: unknown): StoredChatArtifact[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((artifact) => normalizeArtifact(artifact))
    .filter((artifact): artifact is StoredChatArtifact => artifact !== null);
}

export function mergeArtifacts(
  existing: StoredChatArtifact[],
  incoming: StoredChatArtifact[],
): StoredChatArtifact[] {
  const byId = new Map<string, StoredChatArtifact>();
  for (const artifact of [...incoming, ...existing]) {
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function normalizeApproval(value: unknown): StoredChatApproval | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.action !== "string" ||
    typeof candidate.status !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    artifactId: typeof candidate.artifactId === "string" ? candidate.artifactId : null,
    action: candidate.action,
    status: candidate.status,
    payload: isRecord(candidate.payload) ? candidate.payload : {},
    requestedBy:
      typeof candidate.requestedBy === "string" ? candidate.requestedBy : null,
    approvedBy:
      typeof candidate.approvedBy === "string" ? candidate.approvedBy : null,
    resolvedAt:
      typeof candidate.resolvedAt === "string" ? candidate.resolvedAt : null,
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
  };
}

export function normalizeApprovals(value: unknown): StoredChatApproval[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((approval) => normalizeApproval(approval))
    .filter((approval): approval is StoredChatApproval => approval !== null);
}

export function mergeApprovals(
  existing: StoredChatApproval[],
  incoming: StoredChatApproval[],
): StoredChatApproval[] {
  const byId = new Map<string, StoredChatApproval>();
  for (const approval of [...incoming, ...existing]) {
    byId.set(approval.id, approval);
  }
  return Array.from(byId.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function normalizeThread(value: unknown): StoredChatThread | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    id?: unknown;
    title?: unknown;
    updatedAt?: unknown;
    messages?: unknown;
    attachments?: unknown;
    artifacts?: unknown;
    approvals?: unknown;
  };
  if (typeof candidate.id !== "string") return null;

  // Messages are opaque to this pure module; a downstream hook-layer helper
  // validates UIMessage shape. Here we preserve arrays as-is.
  const messages = Array.isArray(candidate.messages)
    ? (candidate.messages as StoredChatThread["messages"])
    : [];

  return {
    id: candidate.id,
    title:
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title
        : fallbackTitle(),
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : new Date().toISOString(),
    messages,
    attachments: normalizeAttachments(candidate.attachments),
    artifacts: normalizeArtifacts(candidate.artifacts),
    approvals: normalizeApprovals(candidate.approvals),
  };
}
