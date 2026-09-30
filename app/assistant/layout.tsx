import { WorkspaceShell } from "@/components/workspace-shell";

import { PersonaSelector } from "./_components/persona-selector";

export default function CorpusChatV2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WorkspaceShell requireCompanyProject enableGlobalAdd mainClassName="min-h-0 flex-1 overflow-hidden p-0">
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-border/50 bg-background/60 px-4 py-2 backdrop-blur sm:px-6">
          <PersonaSelector />
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </WorkspaceShell>
  );
}
