"use client";

// Tool UI registrations for artifact-producing tools. These mount a hidden
// component (via `makeAssistantToolUI`) that registers render overrides in
// the assistant-ui tools scope. When a matching tool call appears in an
// assistant message, the renderer runs and emits an <ArtifactCard /> inline.
//
// See node_modules/@assistant-ui/react/dist/primitives/message/MessagePartsGrouped.d.ts
// (and the core `ToolCallMessagePartProps` type) for the render contract:
// render receives `{ type, toolCallId, toolName, args, result, status, ... }`.

import { makeAssistantToolUI, useAui } from "@assistant-ui/react";

import { ArtifactCard, ArtifactErrorCard } from "@/components/assistant-ui/tool-ui/artifact-card";

import { useChatV2Config } from "./chat-context";
import { isRecord, normalizeArtifact, toText } from "./normalizers";

// Shape we accept from any artifact-emitting tool. `action: "artifact_created"`
// is the canonical signal — legacy tools and current backend both emit it.
interface ArtifactCreatedResult {
  action?: string;
  error?: string;
  artifact?: unknown;
}

function ArtifactToolRender({ result }: { result: unknown }) {
  const config = useChatV2Config();
  const aui = useAui();

  // Resolve remoteId from the active thread list item. `remoteId` is null
  // until the thread is persisted — downstream buttons guard on that.
  let threadId: string | null = null;
  try {
    if (aui?.threadListItem?.source) {
      threadId = aui.threadListItem().getState().remoteId ?? null;
    }
  } catch {
    threadId = null;
  }

  if (!isRecord(result)) return null;
  const payload = result as ArtifactCreatedResult;

  const errorText = toText(payload.error);
  if (errorText) {
    return <ArtifactErrorCard error={errorText} />;
  }

  const artifact = normalizeArtifact(payload.artifact);
  if (!artifact) return null;

  return (
    <ArtifactCard
      artifact={artifact}
      threadId={threadId}
      threadsApi={config.threadsApi}
      allowShare={config.allowCompanyArtifactShare}
    />
  );
}

// `makeAssistantToolUI` requires a concrete toolName. Register one per tool
// we know can emit an artifact. A tool UI only renders while its tool-call
// is present in the message stream, so attaching multiple copies is cheap.
const CreateConsultantArtifactToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "create_consultant_artifact",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <ArtifactToolRender result={result} />;
  },
});

const CreateConsultantExportToolUI = makeAssistantToolUI<
  Record<string, unknown>,
  unknown
>({
  toolName: "create_consultant_export",
  render: ({ result, status }) => {
    if (status.type === "running") return null;
    return <ArtifactToolRender result={result} />;
  },
});

/**
 * Mount this once inside the AssistantRuntimeProvider tree. It registers all
 * artifact tool UIs with the runtime (side-effect only; renders nothing).
 */
export function ArtifactToolUIs() {
  return (
    <>
      <CreateConsultantArtifactToolUI />
      <CreateConsultantExportToolUI />
    </>
  );
}
