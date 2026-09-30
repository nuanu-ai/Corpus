"use client";

// Tool UI registrations for approval-requesting tools. These mount hidden
// components (via `makeAssistantToolUI`) that register render overrides in
// the assistant-ui tools scope. When a matching tool call appears in an
// assistant message, the renderer runs and emits an <ApprovalCard /> inline.
//
// Mirrors the structure of `_lib/artifact-tool-ui.tsx`.

import { makeAssistantToolUI, useAui } from "@assistant-ui/react";

import {
  ApprovalCard,
  ApprovalErrorCard,
} from "@/components/assistant-ui/tool-ui/approval-card";

import { useChatV2Config } from "./chat-context";
import { isRecord, normalizeApproval, toText } from "./normalizers";

// Shape accepted from any approval-emitting tool.
interface ApprovalRequestedResult {
  action?: string;
  error?: string;
  approval?: unknown;
}

function ApprovalToolRender({ result }: { result: unknown }) {
  const config = useChatV2Config();
  const aui = useAui();

  // Resolve remoteId from the active thread list item. `remoteId` is null
  // until the thread is persisted — the card guards against that.
  let threadId: string | null = null;
  try {
    if (aui?.threadListItem?.source) {
      threadId = aui.threadListItem().getState().remoteId ?? null;
    }
  } catch {
    threadId = null;
  }

  if (!isRecord(result)) return null;
  const payload = result as ApprovalRequestedResult;

  const errorText = toText(payload.error);
  if (errorText) {
    return <ApprovalErrorCard error={errorText} />;
  }

  const approval = normalizeApproval(payload.approval);
  if (!approval) return null;

  return (
    <ApprovalCard
      approval={approval}
      threadId={threadId}
      threadsApi={config.threadsApi}
    />
  );
}

// Currently `request_consultant_approval` is the only backend tool that
// emits `action: "approval_requested"`. See app/api/chat/route.ts:2029.
const RequestConsultantApprovalToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "request_consultant_approval",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <ApprovalToolRender result={result} />;
  },
});

/**
 * Mount this once inside the AssistantRuntimeProvider tree. It registers all
 * approval tool UIs with the runtime (side-effect only; renders nothing).
 */
export function ApprovalToolUIs() {
  return (
    <>
      <RequestConsultantApprovalToolUI />
    </>
  );
}
