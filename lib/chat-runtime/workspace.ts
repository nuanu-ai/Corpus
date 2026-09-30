import {
  ensureConsultantThreadWorkspace,
  type EnsureConsultantWorkspaceInput,
} from "@/lib/consultant/workspace";
import {
  ensureCodexChatThreadWorkspace,
  type EnsureCodexChatWorkspaceInput,
} from "@/lib/codex-chat/workspace";
import {
  CODEX_CHAT_EXECUTOR,
  CONSULTANT_EXECUTOR,
  type ChatThreadExecutor,
} from "@/lib/codex-chat/types";

export interface EnsureExecutorThreadWorkspaceInput
  extends EnsureConsultantWorkspaceInput {
  executor: ChatThreadExecutor;
  authProfileId?: string | null;
}

export async function ensureExecutorThreadWorkspace(
  input: EnsureExecutorThreadWorkspaceInput,
): Promise<{ rootPath: string; manifestPath: string }> {
  if (input.executor === CONSULTANT_EXECUTOR) {
    return ensureConsultantThreadWorkspace(input);
  }

  if (input.executor === CODEX_CHAT_EXECUTOR) {
    const codexInput: EnsureCodexChatWorkspaceInput = {
      companyId: input.companyId,
      threadId: input.threadId,
      userId: input.userId,
      title: input.title,
      authProfileId: input.authProfileId ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
    return ensureCodexChatThreadWorkspace(codexInput);
  }

  throw new Error(`Unsupported chat executor: ${String(input.executor)}`);
}
