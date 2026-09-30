"use client";

import { WorkspaceShell } from "@/components/workspace-shell";

export function SettingsShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceShell enableGlobalAdd mainClassName="min-h-0 flex-1 overflow-y-auto p-6">
      {children}
    </WorkspaceShell>
  );
}
