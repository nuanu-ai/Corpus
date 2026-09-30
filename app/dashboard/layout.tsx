"use client";

import { WorkspaceShell } from "@/components/workspace-shell";

import { DashboardChatSidePanel } from "./_components/chat-side-panel";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceShell requireCompanyProject enableGlobalAdd>
      {children}
      {/* Chat side-panel mounts the same ChatV2 runtime inside the dashboard
          tree, so `<AssistantVisible>` wrappers on the page feed the
          assistant the rendered card HTML each turn. */}
      <DashboardChatSidePanel />
    </WorkspaceShell>
  );
}
