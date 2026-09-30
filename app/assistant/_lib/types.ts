import type { UIMessage } from "ai";
import type { PersistableChatThread } from "@/lib/consultant/chat-storage";
import type { PersonaSlug } from "@/lib/ai/personas";

export const DEFAULT_THREAD_ID = "thread-default";
export const MAX_THREAD_HISTORY_MESSAGES = 500;
export const MAX_THREAD_COUNT = 20;

export type ChatSurface = "company" | "personal" | "onboarding";

/**
 * Optional persona override on the company surface. When set, drives:
 *   - streamApi = `/api/chat/<persona>` (turn streaming)
 *   - threadsApi stays `/api/chat/threads`; persona is layered as
 *     `?persona=<slug>` query (list) and `personaSlug` POST body (init)
 *   - storageKeyPrefix scoped per-persona
 */
export type ChatPersona = PersonaSlug;

export interface ChatStorageKeys {
  threads: string;
  activeThread: string;
}

// Legacy chat-panel props (used by app/dashboard/_components/chat-panel.legacy.tsx).
// New chat surface uses ChatV2Config from chat-context.tsx instead.
export interface ChatPanelProps {
  surface?: ChatSurface;
  apiBase?: string;
  documentUploadUrl?: string;
  storageKeyPrefix?: string;
  allowCompanyArtifactShare?: boolean;
  title?: string;
  description?: string;
  inputPlaceholder?: string;
  uploadHint?: string;
}

export interface StoredChatThread extends PersistableChatThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: UIMessage[];
  attachments: StoredChatAttachment[];
  artifacts: StoredChatArtifact[];
  approvals: StoredChatApproval[];
}

export interface StoredChatAttachment {
  id: string;
  documentId: string | null;
  fileName: string;
  fileType: string | null;
  status: string;
  documentStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChatArtifact {
  id: string;
  kind: string;
  title: string;
  filePath: string;
  mimeType: string | null;
  status: string;
  uiMessageId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChatApproval {
  id: string;
  artifactId: string | null;
  action: string;
  status: string;
  payload: Record<string, unknown>;
  requestedBy: string | null;
  approvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredChatState {
  threads: StoredChatThread[];
  activeThreadId: string;
}

export interface PendingThreadNotice {
  threadId: string;
  text: string;
}

export interface ArtifactPreviewState {
  content?: string;
  error?: string;
  isLoading: boolean;
}

export interface DurableTurnResult {
  threadId: string;
  thread: StoredChatThread;
}
